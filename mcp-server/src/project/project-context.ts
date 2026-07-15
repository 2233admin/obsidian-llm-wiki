import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { Operation } from '../core/types.js';
import { badRequest, conflict, notFound } from '../core/types.js';
import { parseFm, type FmValue, type Frontmatter } from './workos.js';

declare const PROJECT_ID_BRAND: unique symbol;

/** Stable logical Project identity. Paths, remotes, and display names are not IDs. */
export type ProjectId = string & { readonly [PROJECT_ID_BRAND]: true };

export type ProjectRefKind = 'id' | 'name' | 'workspace';

/** An external reference that must be resolved before project-domain work begins. */
export interface ProjectRef {
  readonly kind: ProjectRefKind;
  readonly value: string;
}

export interface ProjectDiagnostic {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  path?: string;
  projectId?: ProjectId;
  candidates?: ProjectId[];
}

export interface WorkspaceBinding {
  path: string;
  available: boolean;
}

export interface ExternalProjectionDescriptor {
  kind: string;
  target: string;
}

export interface ProjectRegistryEntry {
  projectId: ProjectId;
  slug: string;
  lifecycle: string;
  aliases: string[];
  registryPath: string;
  workspace: WorkspaceBinding | null;
  projections: ExternalProjectionDescriptor[];
}

export interface ProjectRegistrySnapshot {
  projects: ProjectRegistryEntry[];
  diagnostics: ProjectDiagnostic[];
}

export interface ProjectContextRoots {
  registry: 'Projects';
  registryRecord: string;
  workOs: string;
  knowledge: string;
  runtime: '.vault-mind';
}

export interface ProjectContext {
  projectId: ProjectId;
  slug: string;
  lifecycle: string;
  aliases: string[];
  roots: ProjectContextRoots;
  workspace: WorkspaceBinding | null;
  projections: ExternalProjectionDescriptor[];
  resolvedBy: 'project_id' | 'slug' | 'alias' | 'workspace_binding';
  diagnostics: ProjectDiagnostic[];
}

export function normalizedProjectContext(context: ProjectContext): Record<string, unknown> {
  return {
    projectId: context.projectId,
    slug: context.slug,
    lifecycle: context.lifecycle,
    aliases: [...context.aliases].sort(),
    roots: {
      registryRecord: context.roots.registryRecord,
      workOs: context.roots.workOs,
      knowledge: context.roots.knowledge,
      runtime: context.roots.runtime,
    },
    projections: context.projections.map((projection) => ({ ...projection })),
    resolvedBy: context.resolvedBy,
  };
}

const PROJECT_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const PROJECT_ID_RE = /^project\/([a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?)$/;
const FORBIDDEN_SHARED_FIELDS = new Set([
  'path',
  'workspace-path',
  'workspace_path',
  'repo-path',
  'repo_path',
  'secret',
  'token',
  'api-key',
  'api_key',
  'credentials',
]);
const SENSITIVE_PROJECTION_KINDS = new Set(['secret', 'token', 'api-key', 'api_key', 'credential', 'credentials']);
const compatibilityReads = new Map<string, number>();
const compatibilityWindowStartedAt = Date.now();

function recordCompatibilityRead(operation: string, projectId: ProjectId): void {
  const key = `${operation}\0${projectId}`;
  compatibilityReads.set(key, (compatibilityReads.get(key) ?? 0) + 1);
}

export function compatibilityReadReport(): Array<{ operation: string; projectId: ProjectId; count: number }> {
  return [...compatibilityReads.entries()].map(([key, count]) => {
    const [operation, projectId] = key.split('\0') as [string, ProjectId];
    return { operation, projectId, count };
  }).sort((a, b) => a.operation.localeCompare(b.operation) || a.projectId.localeCompare(b.projectId));
}

export function isProjectId(value: unknown): value is ProjectId {
  return typeof value === 'string' && PROJECT_ID_RE.test(value);
}

export function parseProjectId(value: unknown): ProjectId {
  if (typeof value !== 'string') throw badRequest('Project ID must be a string in the form project/<slug>');
  const normalized = value.trim();
  if (!PROJECT_ID_RE.test(normalized)) {
    throw badRequest('Project ID must use the canonical form project/<lowercase-kebab-slug>');
  }
  return normalized as ProjectId;
}

export function projectIdFromSlug(value: unknown): ProjectId {
  if (typeof value !== 'string') throw badRequest('Project slug must be a string');
  const slug = value.trim();
  if (!PROJECT_SLUG_RE.test(slug)) throw badRequest('Project slug must be lowercase kebab-case');
  return `project/${slug}` as ProjectId;
}

export function projectSlug(projectId: ProjectId): string {
  return projectId.slice('project/'.length);
}

/** Classify a public reference without resolving or touching the filesystem. */
export function normalizeProjectRef(value: string | ProjectRef): ProjectRef {
  if (typeof value === 'object' && value !== null) {
    const candidate = value as Partial<ProjectRef>;
    if (candidate.kind !== 'id' && candidate.kind !== 'name' && candidate.kind !== 'workspace') {
      throw badRequest('Project reference kind must be id, name, or workspace');
    }
    if (typeof candidate.value !== 'string' || !candidate.value.trim()) {
      throw badRequest('Project reference value is required');
    }
    const normalizedValue = candidate.value.trim();
    if (candidate.kind === 'id') parseProjectId(normalizedValue);
    if (candidate.kind === 'workspace' && !isAbsolute(normalizedValue)) {
      throw badRequest('Workspace Project references must be absolute paths');
    }
    return { kind: candidate.kind, value: normalizedValue };
  }
  if (typeof value !== 'string' || !value.trim()) throw badRequest('Project reference is required');
  const normalizedValue = value.trim();
  if (normalizedValue.startsWith('project/')) {
    parseProjectId(normalizedValue);
    return { kind: 'id', value: normalizedValue };
  }
  return { kind: isAbsolute(normalizedValue) ? 'workspace' : 'name', value: normalizedValue };
}

function scalar(frontmatter: Frontmatter, key: string): string | null {
  const value = frontmatter[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringList(value: FmValue | undefined): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of values) {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function projectionsOf(value: FmValue | undefined): ExternalProjectionDescriptor[] {
  if (!value) return [];
  if (typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value)
      .filter(([kind, target]) => kind.trim() && target.trim() && !unsafeProjection(kind, target))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([kind, target]) => ({ kind, target }));
  }
  return stringList(value)
    .filter((reference) => !looksAbsolutePath(reference))
    .map((reference) => {
      const separator = reference.indexOf(':');
      return separator === -1
        ? { kind: 'reference', target: reference }
        : { kind: reference.slice(0, separator), target: reference.slice(separator + 1) };
    })
    .filter((descriptor) => descriptor.kind && descriptor.target && !unsafeProjection(descriptor.kind, descriptor.target))
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.target.localeCompare(right.target));
}

function looksAbsolutePath(value: string): boolean {
  return isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\');
}

function unsafeProjection(kind: string, target: string): boolean {
  return SENSITIVE_PROJECTION_KINDS.has(kind.trim().toLowerCase()) || looksAbsolutePath(target.trim());
}

function normalizeWorkspacePath(value: string): string {
  const trimmed = value.trim();
  if (/^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith('\\\\')) {
    return trimmed.replaceAll('\\', '/').replace(/\/$/, '');
  }
  return resolve(trimmed).replaceAll('\\', '/').replace(/\/$/, '');
}

function workspacePathKey(value: string): string {
  const normalized = normalizeWorkspacePath(value);
  return process.platform === 'win32' || /^[A-Za-z]:\//.test(normalized)
    ? normalized.toLowerCase()
    : normalized;
}

interface BindingSnapshot {
  bindings: Map<ProjectId, WorkspaceBinding>;
  diagnostics: ProjectDiagnostic[];
}

function loadWorkspaceBindings(vaultPath: string): BindingSnapshot {
  const bindings = new Map<ProjectId, WorkspaceBinding>();
  const diagnostics: ProjectDiagnostic[] = [];
  const relativePath = '.vault-mind/local-bindings.json';
  const fullPath = join(vaultPath, '.vault-mind', 'local-bindings.json');
  if (!existsSync(fullPath)) return { bindings, diagnostics };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(fullPath, 'utf-8').replace(/^\uFEFF/, ''));
  } catch {
    diagnostics.push({
      code: 'malformed_local_bindings',
      severity: 'error',
      message: 'Local workspace bindings are unreadable or malformed JSON.',
      path: relativePath,
    });
    return { bindings, diagnostics };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    diagnostics.push({
      code: 'malformed_local_bindings',
      severity: 'error',
      message: 'Local workspace bindings must be a Project ID keyed object.',
      path: relativePath,
    });
    return { bindings, diagnostics };
  }

  for (const [rawProjectRef, rawBinding] of Object.entries(parsed).sort(([left], [right]) => left.localeCompare(right))) {
    let projectId: ProjectId;
    if (isProjectId(rawProjectRef)) {
      projectId = rawProjectRef;
    } else if (PROJECT_SLUG_RE.test(rawProjectRef)) {
      projectId = projectIdFromSlug(rawProjectRef);
      diagnostics.push({
        code: 'compatibility_binding_identity',
        severity: 'warning',
        message: 'A local binding uses a legacy bare slug; rewrite it with the canonical Project ID.',
        path: relativePath,
        projectId,
      });
    } else {
      diagnostics.push({
        code: 'invalid_binding_project_id',
        severity: 'error',
        message: 'A local binding uses a non-canonical Project ID.',
        path: relativePath,
      });
      continue;
    }
    if (bindings.has(projectId)) {
      diagnostics.push({
        code: 'duplicate_binding_identity',
        severity: 'error',
        message: 'Multiple local bindings normalize to the same Project ID.',
        path: relativePath,
        projectId,
      });
      continue;
    }
    const rawPath = rawBinding && typeof rawBinding === 'object' && !Array.isArray(rawBinding)
      ? (rawBinding as Record<string, unknown>).path
      : undefined;
    if (typeof rawPath !== 'string' || !rawPath.trim() || !looksAbsolutePath(rawPath.trim())) {
      diagnostics.push({
        code: 'invalid_workspace_binding',
        severity: 'error',
        message: 'A local binding must contain one absolute workspace path.',
        path: relativePath,
        projectId,
      });
      continue;
    }
    const normalizedPath = normalizeWorkspacePath(rawPath.trim());
    bindings.set(projectId, { path: normalizedPath, available: existsSync(normalizedPath) });
  }
  return { bindings, diagnostics };
}

/** Read the shared vault-first registry plus machine-local bindings without writing. */
export function scanProjectRegistry(vaultPath: string): ProjectRegistrySnapshot {
  const projects: ProjectRegistryEntry[] = [];
  const diagnostics: ProjectDiagnostic[] = [];
  const bindingSnapshot = loadWorkspaceBindings(vaultPath);
  diagnostics.push(...bindingSnapshot.diagnostics);
  const registryRoot = join(vaultPath, 'Projects');
  if (!existsSync(registryRoot)) return { projects, diagnostics };

  const files = readdirSync(registryRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const file of files) {
    const registryPath = `Projects/${file.name}`;
    let frontmatter: Frontmatter;
    try {
      frontmatter = parseFm(readFileSync(join(registryRoot, file.name), 'utf-8'));
    } catch {
      diagnostics.push({
        code: 'unreadable_project_record',
        severity: 'error',
        message: 'A shared Project record could not be read.',
        path: registryPath,
      });
      continue;
    }
    const recordType = scalar(frontmatter, 'type');
    const rawId = scalar(frontmatter, 'entity');
    if (!isProjectId(rawId)) {
      diagnostics.push({
        code: 'invalid_project_id',
        severity: 'error',
        message: 'A shared Project record does not contain a canonical project/<slug> entity.',
        path: registryPath,
      });
      continue;
    }

    const slug = projectSlug(rawId);
    if (recordType !== 'project') {
      diagnostics.push({
        code: 'project_record_type_mismatch',
        severity: 'warning',
        message: 'A shared Project record is missing type: project or uses a different type.',
        path: registryPath,
        projectId: rawId,
      });
    }
    const expectedPath = `Projects/${slug}.md`;
    if (registryPath !== expectedPath) {
      diagnostics.push({
        code: 'registry_path_mismatch',
        severity: 'warning',
        message: `The shared Project record path does not match its logical slug; expected ${expectedPath}.`,
        path: registryPath,
        projectId: rawId,
      });
    }
    for (const key of Object.keys(frontmatter)) {
      if (!FORBIDDEN_SHARED_FIELDS.has(key.toLowerCase())) continue;
      diagnostics.push({
        code: 'forbidden_registry_field',
        severity: 'error',
        message: `Shared Project records must not contain machine paths or secret fields (${key}).`,
        path: registryPath,
        projectId: rawId,
      });
    }
    const aliases = [
      ...stringList(frontmatter.aliases),
      ...stringList(frontmatter.alias),
    ].filter((alias, index, all) => all.indexOf(alias) === index).sort();
    const projections = [
      ...projectionsOf(frontmatter['external-projections']),
      ...projectionsOf(frontmatter.projections),
    ].filter((projection, index, all) => all.findIndex(
      (candidate) => candidate.kind === projection.kind && candidate.target === projection.target,
    ) === index).sort((left, right) => left.kind.localeCompare(right.kind) || left.target.localeCompare(right.target));
    projects.push({
      projectId: rawId,
      slug,
      lifecycle: (scalar(frontmatter, 'lifecycle') ?? scalar(frontmatter, 'status') ?? 'unknown').toLowerCase(),
      aliases,
      registryPath,
      workspace: bindingSnapshot.bindings.get(rawId) ?? null,
      projections,
    });
  }

  const registeredIds = new Set(projects.map((project) => project.projectId));
  for (const projectId of bindingSnapshot.bindings.keys()) {
    if (registeredIds.has(projectId)) continue;
    diagnostics.push({
      code: 'orphan_workspace_binding',
      severity: 'warning',
      message: 'A local workspace binding has no matching shared Project record.',
      path: '.vault-mind/local-bindings.json',
      projectId,
    });
  }
  return { projects, diagnostics };
}

function ambiguity(reference: ProjectRef, matches: ProjectRegistryEntry[]): never {
  const candidates = [...new Set(matches.map((match) => match.projectId))].sort();
  throw conflict(`Ambiguous Project reference: ${reference.value}`, { candidates });
}

function contextFromEntry(
  entry: ProjectRegistryEntry,
  diagnostics: ProjectDiagnostic[],
  resolvedBy: ProjectContext['resolvedBy'],
): ProjectContext {
  const contextDiagnostics = diagnostics.filter(
    (diagnostic) => !diagnostic.projectId || diagnostic.projectId === entry.projectId,
  );
  if (entry.workspace && !entry.workspace.available) {
    contextDiagnostics.push({
      code: 'workspace_unavailable',
      severity: 'warning',
      message: 'The Project is registered, but its local workspace is unavailable on this device.',
      path: '.vault-mind/local-bindings.json',
      projectId: entry.projectId,
    });
  }
  return {
    projectId: entry.projectId,
    slug: entry.slug,
    lifecycle: entry.lifecycle,
    aliases: [...entry.aliases],
    roots: {
      registry: 'Projects',
      registryRecord: `Projects/${entry.slug}.md`,
      workOs: `01-Projects/${entry.slug}`,
      knowledge: `10-Projects/${entry.slug}`,
      runtime: '.vault-mind',
    },
    workspace: entry.workspace ? { ...entry.workspace } : null,
    projections: entry.projections.map((projection) => ({ ...projection })),
    resolvedBy,
    diagnostics: contextDiagnostics,
  };
}

/** Resolve exact ID, then alias/slug, then local workspace binding; never infer by basename. */
export function resolveProjectContext(
  vaultPath: string,
  input: string | ProjectRef,
  operation = 'internal',
  options: { recordCompatibility?: boolean } = {},
): ProjectContext {
  const reference = normalizeProjectRef(input);
  if (reference.kind !== 'id' && process.env.LLMWIKI_PROJECT_COMPATIBILITY === 'disabled') {
    throw badRequest('Legacy Project references are disabled; use the canonical project/<slug> Project ID');
  }
  const registry = scanProjectRegistry(vaultPath);
  let matches: ProjectRegistryEntry[] = [];
  let resolvedBy: ProjectContext['resolvedBy'];

  if (reference.kind === 'id') {
    const projectId = parseProjectId(reference.value);
    matches = registry.projects.filter((project) => project.projectId === projectId);
    resolvedBy = 'project_id';
  } else if (reference.kind === 'name') {
    const folded = reference.value.toLowerCase();
    matches = registry.projects.filter((project) =>
      project.slug.toLowerCase() === folded
      || project.aliases.some((alias) => alias.toLowerCase() === folded),
    );
    resolvedBy = matches.some((project) => project.slug.toLowerCase() === folded) ? 'slug' : 'alias';
  } else {
    const normalizedPath = workspacePathKey(reference.value);
    matches = registry.projects.filter((project) =>
      project.workspace ? workspacePathKey(project.workspace.path) === normalizedPath : false,
    );
    resolvedBy = 'workspace_binding';
  }

  if (matches.length > 1) ambiguity(reference, matches);
  const entry = matches[0];
  if (!entry) throw notFound(`Project not found: ${reference.value}`);

  const diagnostics = [...registry.diagnostics];
  if (reference.kind === 'name') {
    if (options.recordCompatibility !== false) recordCompatibilityRead(operation, entry.projectId);
    diagnostics.push({
      code: 'compatibility_reference',
      severity: 'info',
      message: 'A legacy project name or alias was resolved; callers should persist the canonical Project ID.',
      projectId: entry.projectId,
    });
  } else if (reference.kind === 'workspace') {
    if (options.recordCompatibility !== false) recordCompatibilityRead(operation, entry.projectId);
    diagnostics.push({
      code: 'workspace_reference',
      severity: 'info',
      message: 'A machine-local workspace path was resolved to a canonical Project ID.',
      projectId: entry.projectId,
    });
  }
  return contextFromEntry(entry, diagnostics, resolvedBy);
}

export function doctorProjectContext(vaultPath: string): Record<string, unknown> {
  const snapshot = scanProjectRegistry(vaultPath);
  const findings = [...snapshot.diagnostics];
  const aliasOwners = new Map<string, Set<ProjectId>>();
  for (const project of snapshot.projects) {
    for (const alias of [project.slug, ...project.aliases]) {
      const key = alias.toLowerCase();
      const owners = aliasOwners.get(key) ?? new Set<ProjectId>();
      owners.add(project.projectId);
      aliasOwners.set(key, owners);
    }
    const anchorPath = `01-Projects/${project.slug}/_project.md`;
    const fullAnchor = join(vaultPath, anchorPath);
    if (!existsSync(fullAnchor)) {
      findings.push({ code: 'missing_work_os_anchor', severity: 'error', message: 'Registered Project has no Work-OS anchor.', path: anchorPath, projectId: project.projectId });
    } else {
      const anchorEntity = scalar(parseFm(readFileSync(fullAnchor, 'utf-8')), 'entity');
      if (anchorEntity !== project.projectId) {
        findings.push({ code: 'cross_runtime_identity_disagreement', severity: 'error', message: 'Work-OS anchor Project ID disagrees with the shared registry.', path: anchorPath, projectId: project.projectId });
      }
    }
    if (project.workspace && !project.workspace.available) {
      findings.push({ code: 'stale_workspace_binding', severity: 'warning', message: 'Workspace binding target is unavailable.', path: '.vault-mind/local-bindings.json', projectId: project.projectId });
    }
  }
  for (const [alias, owners] of aliasOwners) {
    if (owners.size < 2) continue;
    findings.push({ code: 'duplicate_project_alias', severity: 'error', message: `Alias ${alias} belongs to multiple Projects.`, candidates: [...owners].sort() });
  }
  const knownSlugs = new Set(snapshot.projects.map((project) => project.slug));
  for (const root of ['01-Projects', '10-Projects']) {
    const fullRoot = join(vaultPath, root);
    if (!existsSync(fullRoot)) continue;
    for (const entry of readdirSync(fullRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || knownSlugs.has(entry.name)) continue;
      findings.push({ code: 'orphan_project_domain_root', severity: 'warning', message: 'Project domain root has no shared Project record.', path: `${root}/${entry.name}` });
    }
  }
  const compatibility = compatibilityReadReport();
  const configuredWindowSeconds = Math.max(0, Number.parseInt(process.env.LLMWIKI_PROJECT_COMPATIBILITY_WINDOW_SECONDS ?? '0', 10) || 0);
  const elapsedWindowSeconds = Math.floor((Date.now() - compatibilityWindowStartedAt) / 1000);
  const mode = process.env.LLMWIKI_PROJECT_COMPATIBILITY === 'disabled' ? 'disabled' : 'enabled';
  return {
    ok: findings.every((finding) => finding.severity !== 'error'),
    projects: snapshot.projects.length,
    findings,
    compatibility: {
      mode,
      reads: compatibility,
      total: compatibility.reduce((sum, item) => sum + item.count, 0),
      windowStartedAt: new Date(compatibilityWindowStartedAt).toISOString(),
      configuredWindowSeconds,
      elapsedWindowSeconds,
      readyToDisable: mode === 'enabled' && compatibility.length === 0 && elapsedWindowSeconds >= configuredWindowSeconds,
      readersRemoved: mode === 'disabled',
    },
  };
}

function operationReference(params: Record<string, unknown>): string {
  const value = params.ref ?? params.project;
  if (typeof value !== 'string' || !value.trim()) throw badRequest('ref or project is required');
  return value;
}

/** Read-only MCP operations backed by the shared Project Context Resolver. */
export function makeProjectContextOps(vaultPath: string): Operation[] {
  return [
    {
      name: 'project.registry.list',
      namespace: 'project',
      description: 'List shared Project identities with local binding health and registry diagnostics.',
      mutating: false,
      params: {},
      handler: async () => {
        const snapshot = scanProjectRegistry(vaultPath);
        return { count: snapshot.projects.length, ...snapshot };
      },
    },
    {
      name: 'project.registry.get',
      namespace: 'project',
      description: 'Resolve a Project reference and return its shared registry entry without mutation.',
      mutating: false,
      params: {
        ref: { type: 'string', required: false, description: 'Canonical Project ID, registered alias/slug, or bound workspace path' },
        project: { type: 'string', required: false, description: 'Compatibility alias for ref' },
      },
      handler: async (_ctx, params) => {
        const context = resolveProjectContext(vaultPath, operationReference(params), 'project.registry.get');
        const snapshot = scanProjectRegistry(vaultPath);
        const project = snapshot.projects.find((entry) => entry.projectId === context.projectId);
        if (!project) throw notFound(`Project not found: ${context.projectId}`);
        return { project, diagnostics: context.diagnostics };
      },
    },
    {
      name: 'project.context.resolve',
      namespace: 'project',
      description: 'Resolve a Project reference to stable identity, canonical domain roots, bindings, projections, and diagnostics.',
      mutating: false,
      params: {
        ref: { type: 'string', required: false, description: 'Canonical Project ID, registered alias/slug, or bound workspace path' },
        project: { type: 'string', required: false, description: 'Compatibility alias for ref' },
      },
      handler: async (_ctx, params) => resolveProjectContext(vaultPath, operationReference(params), 'project.context.resolve'),
    },
    {
      name: 'project.context.doctor',
      namespace: 'project',
      description: 'Diagnose Project anchors, aliases, bindings, domain roots, identity agreement, and release-gated compatibility reads.',
      mutating: false,
      params: {},
      handler: async () => doctorProjectContext(vaultPath),
    },
  ];
}
