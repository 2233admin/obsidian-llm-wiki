import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  type EffectiveSetting,
  type SettingsService,
} from '../../../packages/settings-platform/dist/src/index.js';
import type { AdapterRegistry } from '../adapters/registry.js';
import type { Operation, OperationContext } from '../core/types.js';
import { badRequest } from '../core/types.js';
import { createSettingsService } from '../settings/settings.js';
import { resolveProjectContext, type ProjectContext } from './project-context.js';

type Health = 'healthy' | 'degraded' | 'unavailable' | 'empty';

interface HubSection<T> {
  owner: string;
  freshness: string | null;
  health: Health;
  drift: string[];
  data: T;
}

interface FileSummary {
  path: string;
  modifiedAt: string;
}

function filesBelow(vaultPath: string, root: string): FileSummary[] {
  const fullRoot = join(vaultPath, root);
  if (!existsSync(fullRoot)) return [];
  const out: FileSummary[] = [];
  if (statSync(fullRoot).isFile()) {
    return [{ path: root.replaceAll('\\', '/'), modifiedAt: statSync(fullRoot).mtime.toISOString() }];
  }
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) {
        out.push({
          path: relative(vaultPath, fullPath).replaceAll('\\', '/'),
          modifiedAt: statSync(fullPath).mtime.toISOString(),
        });
      }
    }
  };
  visit(fullRoot);
  return out;
}

function newest(files: FileSummary[]): string | null {
  return files.reduce<string | null>((latest, file) => !latest || file.modifiedAt > latest ? file.modifiedAt : latest, null);
}

function section<T>(owner: string, files: FileSummary[], data: T, drift: string[] = []): HubSection<T> {
  return {
    owner,
    freshness: newest(files),
    health: drift.length > 0 ? 'degraded' : files.length > 0 ? 'healthy' : 'empty',
    drift,
    data,
  };
}

function frontmatterValue(content: string, key: string): string | null {
  const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, 'mi'));
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? null;
}

function workSection(vaultPath: string, context: ProjectContext): HubSection<Record<string, unknown>> {
  const files = filesBelow(vaultPath, context.roots.workOs);
  const issues = files.filter((file) => file.path.includes('/issues/') && file.path.endsWith('.md'));
  const states: Record<string, number> = {};
  for (const issue of issues) {
    const status = frontmatterValue(readFileSync(join(vaultPath, issue.path), 'utf-8'), 'status') ?? 'unknown';
    states[status] = (states[status] ?? 0) + 1;
  }
  const anchor = files.find((file) => file.path.endsWith('/_project.md'));
  return section('work-os', files, { root: context.roots.workOs, anchor: anchor?.path ?? null, issueCount: issues.length, states },
    anchor ? [] : ['missing_work_os_anchor']);
}

function knowledgeSection(vaultPath: string, context: ProjectContext): HubSection<Record<string, unknown>> {
  const files = filesBelow(vaultPath, context.roots.knowledge);
  const markdown = files.filter((file) => file.path.endsWith('.md'));
  return section('knowledge', files, { root: context.roots.knowledge, itemCount: markdown.length });
}

function runtimeSection(vaultPath: string, context: ProjectContext): HubSection<Record<string, unknown>> {
  const runFiles = filesBelow(vaultPath, `${context.roots.workOs}/runs`).filter((file) => file.path.endsWith('.json'));
  const agentFiles = filesBelow(vaultPath, `${context.roots.workOs}/agents`);
  const runs: Array<Record<string, unknown>> = [];
  const drift: string[] = [];
  for (const file of runFiles) {
    try {
      const raw = JSON.parse(readFileSync(join(vaultPath, file.path), 'utf-8')) as Record<string, unknown>;
      runs.push({
        workRunId: raw.workRunId ?? raw.work_run_id ?? null,
        state: raw.state ?? null,
        workItemId: raw.workItemId ?? raw.work_item_id ?? null,
        path: file.path,
      });
    } catch {
      drift.push(`malformed_run:${file.path}`);
    }
  }
  const activeStates = new Set(['planned', 'leased', 'running', 'awaiting_review']);
  return section('runtime', [...runFiles, ...agentFiles], {
    activeRuns: runs.filter((run) => activeStates.has(String(run.state))),
    runCount: runs.length,
    agentStateFiles: agentFiles.map((file) => file.path),
  }, drift);
}

function redactedEffectiveSetting(service: SettingsService, item: EffectiveSetting): Record<string, unknown> {
  const sensitivity = service.registry.definitions.find((definition) => definition.key === item.key)?.sensitivity;
  return {
    ...item,
    value: sensitivity === 'local'
      ? { redacted: true, configured: item.value !== null && item.value !== '' }
      : item.value,
    overriddenCandidates: item.overriddenCandidates.map((candidate) => ({
      ...candidate,
      value: sensitivity === 'local'
        ? { redacted: true, configured: candidate.value !== null && candidate.value !== '' }
        : candidate.value,
    })),
  };
}

async function settingsSection(
  service: SettingsService,
  project: ProjectContext,
): Promise<HubSection<Record<string, unknown>>> {
  try {
    const context = { ...service.defaultContext, workspaceProjectId: project.projectId };
    const resolved = await service.snapshotResolve(context);
    const effective = resolved.snapshot.effective.map((item) => redactedEffectiveSetting(service, item));
    const data = {
      schemaVersion: 1,
      snapshotId: resolved.snapshot.snapshotId,
      registryVersion: resolved.snapshot.registryVersion,
      context: resolved.snapshot.context,
      sourceRevisions: resolved.snapshot.sourceRevisions,
      effective,
      validation: resolved.validation,
      recoveryDiagnostics: resolved.recoveryDiagnostics,
    };
    const drift = [
      ...resolved.validation.issues.map((issue) => issue.code),
      ...resolved.recoveryDiagnostics.map((issue) => issue.code),
    ];
    return {
      owner: 'settings-platform',
      freshness: resolved.snapshot.createdAt,
      health: drift.length > 0 ? 'degraded' : 'healthy',
      drift: [...new Set(drift)].sort(),
      data: {
        ...data,
        snapshotHash: createHash('sha256').update(JSON.stringify(data)).digest('hex'),
      },
    };
  } catch (error) {
    return {
      owner: 'settings-platform',
      freshness: null,
      health: 'unavailable',
      drift: ['settings_unavailable'],
      data: { error: (error as Error).message },
    };
  }
}

function capabilitySection(registry: AdapterRegistry): HubSection<Record<string, unknown>> {
  const adapters = registry.list().map((adapter) => ({
    name: adapter.name,
    capabilities: [...adapter.capabilities].sort(),
    available: adapter.isAvailable !== false,
  })).sort((a, b) => a.name.localeCompare(b.name));
  const unavailable = adapters.filter((adapter) => !adapter.available).map((adapter) => `adapter_unavailable:${adapter.name}`);
  return {
    owner: 'capability-registry',
    freshness: null,
    health: unavailable.length ? 'degraded' : adapters.length ? 'healthy' : 'empty',
    drift: unavailable,
    data: { adapters },
  };
}

function workspaceSection(context: ProjectContext): HubSection<Record<string, unknown>> {
  if (!context.workspace) {
    return { owner: 'workspace-binding', freshness: null, health: 'empty', drift: ['workspace_not_bound'], data: { binding: null } };
  }
  return {
    owner: 'workspace-binding',
    freshness: null,
    health: context.workspace.available ? 'healthy' : 'unavailable',
    drift: context.workspace.available ? [] : ['workspace_unavailable'],
    data: { binding: { configured: true, available: context.workspace.available } },
  };
}

function integrationSection(context: ProjectContext): HubSection<Record<string, unknown>> {
  const projections = context.projections.map((projection) => ({ ...projection, stateOwner: 'provider', copiedState: false }));
  return {
    owner: 'external-provider',
    freshness: null,
    health: projections.length ? 'degraded' : 'empty',
    drift: projections.map((projection) => `projection_unverified:${projection.kind}`),
    data: { projections },
  };
}

export async function composeProjectHub(
  ctx: OperationContext,
  registry: AdapterRegistry,
  reference: string,
  settingsService = createSettingsService({ vaultPath: ctx.config.vault_path }),
): Promise<Record<string, unknown>> {
  const project = resolveProjectContext(ctx.config.vault_path, reference, 'project.hub.get');
  const registryFiles = filesBelow(ctx.config.vault_path, project.roots.registryRecord);
  return {
    projectId: project.projectId,
    slug: project.slug,
    lifecycle: project.lifecycle,
    generatedAt: new Date().toISOString(),
    readOnly: true,
    diagnostics: project.diagnostics,
    sections: {
      identity: section('project-registry', registryFiles, {
        projectId: project.projectId,
        slug: project.slug,
        lifecycle: project.lifecycle,
        aliases: project.aliases,
        registryRecord: project.roots.registryRecord,
      }, project.diagnostics.filter((item) => item.severity !== 'info').map((item) => item.code)),
      work: workSection(ctx.config.vault_path, project),
      knowledge: knowledgeSection(ctx.config.vault_path, project),
      runtime: runtimeSection(ctx.config.vault_path, project),
      settings: await settingsSection(settingsService, project),
      capabilities: capabilitySection(registry),
      workspace: workspaceSection(project),
      integrations: integrationSection(project),
    },
    mutationRoutes: {
      identity: 'project.init',
      work: 'project.issue.* / workflow.agent.*',
      knowledge: 'source.register / memory.*',
      settings: 'settings owner (backend configuration)',
      integrations: 'provider-owned operations',
    },
  };
}

export function makeProjectHubOps(registry: AdapterRegistry, settingsService?: SettingsService): Operation[] {
  return [{
    name: 'project.hub.get',
    namespace: 'project',
    description: 'Compose a read-only Project Hub from registry, Work-OS, knowledge, runtime, settings, capabilities, workspace, and provider-owned integrations.',
    mutating: false,
    params: {
      ref: { type: 'string', required: false, description: 'Canonical Project ID, registered alias/slug, or bound workspace path' },
      project: { type: 'string', required: false, description: 'Compatibility alias for ref' },
    },
    handler: async (ctx, params) => {
      const reference = params.ref ?? params.project;
      if (typeof reference !== 'string' || !reference.trim()) throw badRequest('ref or project is required');
      return composeProjectHub(ctx, registry, reference, settingsService);
    },
  }];
}
