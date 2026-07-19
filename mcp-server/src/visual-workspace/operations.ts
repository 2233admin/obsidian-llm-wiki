import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

import {
  acceptGraphRelationEvidence,
  canonicalDigest,
  assertVisualApplyRequest,
  createVisualEditPlan,
  mindMapFingerprint,
  parseManagedMindMapSection,
  parseMindMapDocument,
  parseVaultRelativePath,
  readMarkdownMindMapSource,
  readObsidianCanvasSource,
  renderMindMapProjectionBundle,
  serializeManagedMindMapSection,
  sha256Text,
  VisualWorkspaceError,
  type GraphRelationEvidence,
  type MindMapDocument,
  type Sha256Digest,
  type VisualAdoptionCandidate,
  type VisualApplyRequest,
  type VisualEditPlan,
  type VisualSourceReadResult,
} from '../../../packages/visual-workspace/dist/src/index.js';
import {
  badRequest,
  conflict,
  internal,
  notFound,
  type Operation,
  type OperationContext,
} from '../core/types.js';
import { touchMarkdown } from '../core/write-policy.js';
import { resolveProjectContext } from '../project/project-context.js';

const PROJECT_ID_RE = /^project\/([a-z0-9][a-z0-9-]*)$/;
const RECEIPT_SCHEMA_VERSION = 1;

interface VisualPath {
  projectId: `project/${string}`;
  slug: string;
  path: string;
  fullPath: string;
}

interface VisualReceiptBase {
  schemaVersion: 1;
  status: 'pending' | 'applied';
  projectId: string;
  path: string;
  planFingerprint: Sha256Digest;
  actor: string;
  transitionTokenDigest: Sha256Digest;
  sourceBeforeSha256: Sha256Digest;
  sourceAfterSha256: Sha256Digest;
}

interface PendingReceipt extends VisualReceiptBase {
  status: 'pending';
}

interface AppliedReceipt extends VisualReceiptBase {
  status: 'applied';
}

type VisualReceipt = PendingReceipt | AppliedReceipt;

export interface VisualMapReadResult {
  projectId: string;
  path: string;
  source: string;
  sourceSha256: Sha256Digest;
  document: ReturnType<typeof parseManagedMindMapSection>['document'];
  documentFingerprint: Sha256Digest;
  managedMarkdown: string;
}

export interface VisualMapApplyResult {
  projectId: string;
  path: string;
  sourceSha256: Sha256Digest;
  planFingerprint: Sha256Digest;
  actor: string;
  transitionToken: string;
  replayed: boolean;
  created: boolean;
  receiptPath: string;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw badRequest(`${label} required`);
  return value.trim();
}

function canonicalProject(vaultPath: string, value: unknown, operation: string): {
  projectId: `project/${string}`;
  slug: string;
} {
  const project = requiredString(value, 'project');
  const match = PROJECT_ID_RE.exec(project);
  if (!match) throw badRequest('project must use canonical project/<lowercase-kebab-slug>');
  const validatedProjectId = project as `project/${string}`;
  const context = resolveProjectContext(vaultPath, validatedProjectId, operation, { recordCompatibility: false });
  if (context.projectId !== validatedProjectId || context.slug !== match[1]) {
    throw conflict('Project Context does not match the requested canonical Project ID');
  }
  return { projectId: validatedProjectId, slug: context.slug };
}

function visualPath(
  vaultPath: string,
  projectValue: unknown,
  pathValue: unknown,
  operation: string,
  mustExist = true,
): VisualPath {
  const project = canonicalProject(vaultPath, projectValue, operation);
  let path: string;
  try {
    path = parseVaultRelativePath(pathValue, 'path');
  } catch (error) {
    throw translateVisualError(error);
  }
  const prefix = `01-Projects/${project.slug}/maps/`;
  if (
    !path.startsWith(prefix)
    || path.length <= prefix.length
    || !path.endsWith('.md')
    || path.slice(prefix.length).startsWith('.llmwiki/')
  ) {
    throw badRequest(`path must be a Markdown file under ${prefix} and outside the receipt namespace`);
  }

  const vaultRoot = realpathSync(resolve(vaultPath));
  const fullPath = resolve(vaultRoot, path);
  const rel = relative(vaultRoot, fullPath);
  if (rel.startsWith('..') || isAbsolute(rel)) throw badRequest('path escapes the vault');
  if (mustExist) {
    assertExistingRealPathInsideVault(vaultRoot, fullPath);
  } else {
    safeFuturePath(vaultPath, path);
    if (existsSync(fullPath)) assertExistingRealPathInsideVault(vaultRoot, fullPath);
  }
  return { ...project, path, fullPath };
}

function assertExistingRealPathInsideVault(vaultRoot: string, fullPath: string): void {
  if (!existsSync(fullPath)) throw notFound(`Mind map not found: ${basename(fullPath)}`);
  const realTarget = realpathSync(fullPath);
  const rel = relative(vaultRoot, realTarget);
  if (rel.startsWith('..') || isAbsolute(rel)) throw badRequest('path escapes the vault through a symbolic link');
}

function safeFuturePath(vaultPath: string, relativePath: string): string {
  const vaultRoot = realpathSync(resolve(vaultPath));
  const fullPath = resolve(vaultRoot, relativePath);
  const rel = relative(vaultRoot, fullPath);
  if (rel.startsWith('..') || isAbsolute(rel)) throw badRequest('path escapes the vault');
  let ancestor = dirname(fullPath);
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) throw badRequest('path escapes the vault');
    ancestor = parent;
  }
  const realAncestor = realpathSync(ancestor);
  const ancestorRel = relative(vaultRoot, realAncestor);
  if (ancestorRel.startsWith('..') || isAbsolute(ancestorRel)) {
    throw badRequest('path escapes the vault through a symbolic link');
  }
  return fullPath;
}

function readVisualMap(target: VisualPath): VisualMapReadResult {
  const source = readFileSync(target.fullPath, 'utf8');
  try {
    const section = parseManagedMindMapSection(source);
    return {
      projectId: target.projectId,
      path: target.path,
      source,
      sourceSha256: sha256Text(source),
      document: section.document,
      documentFingerprint: mindMapFingerprint(section.document),
      managedMarkdown: section.raw,
    };
  } catch (error) {
    throw translateVisualError(error);
  }
}

function readVaultSource(
  vaultPath: string,
  pathValue: unknown,
  readContent = true,
): { path: string; source: string } {
  let path: string;
  try {
    path = parseVaultRelativePath(pathValue, 'context.path');
  } catch (error) {
    throw translateVisualError(error);
  }
  const vaultRoot = realpathSync(resolve(vaultPath));
  const fullPath = resolve(vaultRoot, path);
  const rel = relative(vaultRoot, fullPath);
  if (rel.startsWith('..') || isAbsolute(rel)) throw badRequest('context.path escapes the vault');
  assertExistingRealPathInsideVault(vaultRoot, fullPath);
  return { path, source: readContent ? readFileSync(fullPath, 'utf8') : '' };
}

function stableVisualId(prefix: string, identity: string): string {
  return `${prefix}-${sha256Text(identity).slice('sha256:'.length, 'sha256:'.length + 20)}`;
}

function safeMapSlug(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || `map-${sha256Text(value).slice(7, 19)}`;
}

function targetPathForContext(slug: string, sourcePath?: string): string {
  if (!sourcePath) return `01-Projects/${slug}/maps/${slug}-project.md`;
  const label = safeMapSlug(basename(sourcePath));
  const suffix = sha256Text(sourcePath).slice(7, 15);
  return `01-Projects/${slug}/maps/${label}-${suffix}.md`;
}

function provisionalDocument(candidate: VisualAdoptionCandidate): MindMapDocument {
  if (candidate.nodes.length === 0) {
    throw badRequest('The selected source has no supported nodes to adopt');
  }
  const nodeIds = new Set(candidate.nodes.map((node) => node.id));
  const rootId = [...candidate.candidateRootIds].sort()[0] ?? candidate.nodes[0]!.id;
  const incoming = new Map<string, string[]>();
  for (const relation of candidate.relations) {
    if (!nodeIds.has(relation.from) || !nodeIds.has(relation.to) || relation.from === relation.to) continue;
    const values = incoming.get(relation.to) ?? [];
    if (!values.includes(relation.from)) values.push(relation.from);
    incoming.set(relation.to, values);
  }
  const edges: Array<{ from: string; to: string }> = [];
  const attached = new Set([rootId]);
  const remaining = candidate.nodes.map((node) => node.id).filter((id) => id !== rootId);
  while (remaining.length > 0) {
    let progressed = false;
    for (let index = 0; index < remaining.length; index += 1) {
      const nodeId = remaining[index]!;
      const parent = [...(incoming.get(nodeId) ?? [])].sort().find((id) => attached.has(id));
      if (!parent) continue;
      edges.push({ from: parent, to: nodeId });
      attached.add(nodeId);
      remaining.splice(index, 1);
      progressed = true;
      break;
    }
    if (!progressed) {
      const nodeId = remaining.shift()!;
      edges.push({ from: rootId, to: nodeId });
      attached.add(nodeId);
    }
  }
  const selected = new Set(edges.map((edge) => `${edge.from}\0${edge.to}`));
  const crossLinks = candidate.relations
    .filter((relation) => !selected.has(`${relation.from}\0${relation.to}`))
    .filter((relation) => nodeIds.has(relation.from) && nodeIds.has(relation.to) && relation.from !== relation.to)
    .map((relation) => ({
      id: relation.id,
      from: relation.from,
      to: relation.to,
      relation: relation.relation,
      provenance: { kind: 'explicit' as const },
    }));
  return parseMindMapDocument({
    schemaVersion: 1,
    id: stableVisualId(candidate.sourceKind === 'canvas' ? 'canvas-map' : 'markdown-map', candidate.sourcePath),
    title: candidate.title,
    rootId,
    nodes: candidate.nodes,
    edges,
    ...(crossLinks.length ? { crossLinks } : {}),
  });
}

function clarificationsForCandidate(candidate: VisualAdoptionCandidate): Array<Record<string, unknown>> {
  const labels = new Map(candidate.nodes.map((node) => [node.id, node.label]));
  const clarifications: Array<Record<string, unknown>> = [];
  if (candidate.candidateRootIds.length !== 1) {
    const rootOptions = (candidate.candidateRootIds.length
      ? candidate.candidateRootIds
      : candidate.nodes.map((node) => node.id))
      .sort()
      .map((id) => ({ id, label: labels.get(id) ?? id, evidenceRefs: [candidate.sourcePath] }));
    clarifications.push({
      id: 'root',
      prompt: 'Which node should be the map root?',
      kind: 'root',
      required: true,
      options: rootOptions,
    });
  }
  for (const [nodeId, parents] of Object.entries(candidate.parentChoices).sort(([left], [right]) => left.localeCompare(right))) {
    if (parents.length <= 1) continue;
    clarifications.push({
      id: `parent:${nodeId}`,
      prompt: `Which parent should contain ${labels.get(nodeId) ?? nodeId}?`,
      kind: 'parent',
      required: true,
      options: [...parents].sort().map((id) => ({
        id,
        label: labels.get(id) ?? id,
        evidenceRefs: [candidate.sourcePath],
      })),
    });
  }
  return clarifications;
}

function filterCanvasSelection(source: string, nodeIdsValue: unknown): string {
  if (!Array.isArray(nodeIdsValue) || nodeIdsValue.length === 0) return source;
  const selected = new Set(nodeIdsValue.map((value, index) =>
    requiredString(value, `context.canvasNodeIds[${index}]`)));
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return source;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return source;
  const canvas = parsed as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(canvas.nodes) || !Array.isArray(canvas.edges)) return source;
  const nodes = canvas.nodes.filter((value) =>
    value && typeof value === 'object' && !Array.isArray(value)
    && selected.has(String((value as Record<string, unknown>).id ?? '')));
  const edges = canvas.edges.filter((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const edge = value as Record<string, unknown>;
    return selected.has(String(edge.fromNode ?? '')) && selected.has(String(edge.toNode ?? ''));
  });
  return JSON.stringify({ nodes, edges });
}

function contextCapabilities(): Record<string, unknown> {
  return {
    model: 'degraded',
    graphify: 'degraded',
    problemIntake: 'available',
    messages: [
      'Deterministic parsing and manual editing remain available without a model.',
      'Graphify evidence is optional and enters a plan only after explicit selection.',
      'Problem reporting remains a separate plan and confirmation flow.',
    ],
  };
}

function applyClarificationAnswers(
  documentValue: unknown,
  answersValue: unknown,
): MindMapDocument {
  let document = parseMindMapDocument(documentValue);
  if (answersValue === undefined) return document;
  if (!answersValue || typeof answersValue !== 'object' || Array.isArray(answersValue)) {
    throw badRequest('clarificationAnswers must be an object');
  }
  const answers = answersValue as Record<string, unknown>;
  const nodeIds = new Set(document.nodes.map((node) => node.id));
  const requestedRoot = answers.root;
  if (requestedRoot !== undefined) {
    const rootId = requiredString(requestedRoot, 'clarificationAnswers.root');
    if (!nodeIds.has(rootId)) throw badRequest('clarificationAnswers.root does not exist in the map');
    const adjacency = new Map<string, string[]>();
    for (const edge of document.edges) {
      adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
      adjacency.set(edge.to, [...(adjacency.get(edge.to) ?? []), edge.from]);
    }
    const visited = new Set([rootId]);
    const queue = [rootId];
    const edges: Array<{ from: string; to: string }> = [];
    while (queue.length) {
      const parent = queue.shift()!;
      for (const child of [...(adjacency.get(parent) ?? [])].sort()) {
        if (visited.has(child)) continue;
        visited.add(child);
        queue.push(child);
        edges.push({ from: parent, to: child });
      }
    }
    document = parseMindMapDocument({ ...document, rootId, edges });
  }
  for (const [key, rawParent] of Object.entries(answers).sort(([left], [right]) => left.localeCompare(right))) {
    if (!key.startsWith('parent:')) continue;
    const nodeId = key.slice('parent:'.length);
    const parentId = requiredString(rawParent, `clarificationAnswers.${key}`);
    if (!nodeIds.has(nodeId) || !nodeIds.has(parentId) || nodeId === parentId || nodeId === document.rootId) {
      throw badRequest(`${key} is not a valid reparenting choice`);
    }
    const edges = document.edges.filter((edge) => edge.to !== nodeId);
    document = parseMindMapDocument({ ...document, edges: [...edges, { from: parentId, to: nodeId }] });
  }
  return document;
}

function nodeForGraphEndpoint(document: MindMapDocument, endpoint: string): string | undefined {
  if (document.nodes.some((node) => node.id === endpoint)) return endpoint;
  const normalized = endpoint.replaceAll('\\', '/').replace(/\.md$/i, '');
  const matches = document.nodes.filter((node) => {
    const links = [...node.label.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)]
      .map((match) => match[1]!.replaceAll('\\', '/').replace(/\.md$/i, ''));
    return links.includes(normalized)
      || links.some((link) => basename(link) === basename(normalized))
      || node.label === endpoint;
  });
  return matches.length === 1 ? matches[0]!.id : undefined;
}

function applyAcceptedGraphEvidence(documentValue: unknown, evidenceValue: unknown): MindMapDocument {
  let document = parseMindMapDocument(documentValue);
  if (evidenceValue === undefined) return document;
  if (!Array.isArray(evidenceValue)) throw badRequest('acceptedGraphEvidence must be an array');
  for (const [index, raw] of evidenceValue.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw badRequest(`acceptedGraphEvidence[${index}] must be an object`);
    }
    const item = raw as Record<string, unknown>;
    const from = requiredString(item.from, `acceptedGraphEvidence[${index}].from`);
    const to = requiredString(item.to, `acceptedGraphEvidence[${index}].to`);
    const fromNodeId = nodeForGraphEndpoint(document, from);
    const toNodeId = nodeForGraphEndpoint(document, to);
    if (!fromNodeId || !toNodeId) {
      throw badRequest(`acceptedGraphEvidence[${index}] endpoints cannot be mapped to unique map nodes`);
    }
    const refs = Array.isArray(item.evidenceRefs) ? item.evidenceRefs : [];
    const evidence: GraphRelationEvidence = {
      schemaVersion: 1,
      id: requiredString(item.id, `acceptedGraphEvidence[${index}].id`),
      adapter: {
        id: requiredString(item.adapter, `acceptedGraphEvidence[${index}].adapter`),
        version: 'runtime',
      },
      relation: requiredString(item.relation, `acceptedGraphEvidence[${index}].relation`),
      fromNodeId,
      toNodeId,
      confidence: item.confidence as GraphRelationEvidence['confidence'],
      evidence: refs.map((value, refIndex) => ({
        kind: 'vault' as const,
        value: requiredString(value, `acceptedGraphEvidence[${index}].evidenceRefs[${refIndex}]`),
      })),
    };
    try {
      document = acceptGraphRelationEvidence(document, evidence);
    } catch (error) {
      throw translateVisualError(error);
    }
  }
  return document;
}

function makeCreatePlan(input: {
  targetPath: string;
  nextDocument: MindMapDocument;
  actor: string;
  origin: VisualEditPlan['provenance']['origin'];
  warnings: string[];
}): VisualEditPlan {
  const managedMarkdown = serializeManagedMindMapSection(input.nextDocument);
  const snapshot = {
    document: input.nextDocument,
    documentFingerprint: mindMapFingerprint(input.nextDocument),
    managedMarkdown,
  };
  const payload: Omit<VisualEditPlan, 'fingerprint'> = {
    schemaVersion: 1,
    source: { path: input.targetPath, sha256: sha256Text('') },
    preview: { before: snapshot, after: snapshot },
    affectedPaths: [input.targetPath],
    provenance: { actor: input.actor, origin: input.origin },
    warnings: [...new Set(['Creates a new managed Mind Map Document after confirmation.', ...input.warnings])],
  };
  return { ...payload, fingerprint: canonicalDigest(payload) };
}

function transitionTokenDigest(token: string): Sha256Digest {
  return `sha256:${createHash('sha256').update(token, 'utf8').digest('hex')}`;
}

function receiptRelativePath(target: VisualPath, token: string): string {
  const digest = transitionTokenDigest(token).slice('sha256:'.length);
  return `01-Projects/${target.slug}/maps/.llmwiki/receipts/${digest}.json`;
}

function withFileLock<T>(fullPath: string, fn: () => T): T {
  mkdirSync(dirname(fullPath), { recursive: true });
  const lockPath = `${fullPath}.lock`;
  const acquire = () => writeFileSync(
    lockPath,
    JSON.stringify({ pid: process.pid, timestamp: Date.now() }),
    { encoding: 'utf8', flag: 'wx' },
  );
  try {
    acquire();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    throw conflict(`Lock conflict on ${basename(fullPath)}; lock ownership must be reconciled explicitly`);
  }
  try {
    return fn();
  } finally {
    rmSync(lockPath, { force: true });
  }
}

function atomicReplace(fullPath: string, content: string): void {
  const temporaryPath = join(dirname(fullPath), `.${basename(fullPath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporaryPath, fullPath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function canonicalReceipt(receipt: VisualReceipt): string {
  return `${JSON.stringify(receipt, null, 2)}\n`;
}

function parseReceipt(fullPath: string): VisualReceipt | undefined {
  if (!existsSync(fullPath)) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(fullPath, 'utf8'));
  } catch {
    throw conflict('Visual apply receipt is unreadable; automatic replay is blocked');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw conflict('Visual apply receipt is invalid; automatic replay is blocked');
  }
  const receipt = value as Record<string, unknown>;
  const common = [
    'schemaVersion',
    'status',
    'projectId',
    'path',
    'planFingerprint',
    'actor',
    'transitionTokenDigest',
    'sourceBeforeSha256',
  ];
  const expected = [...common, 'sourceAfterSha256'];
  if (
    receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION
    || (receipt.status !== 'pending' && receipt.status !== 'applied')
    || Object.keys(receipt).length !== expected.length
    || expected.some((field) => !(field in receipt))
    || expected.some((field) => field !== 'schemaVersion' && field !== 'status' && typeof receipt[field] !== 'string')
  ) {
    throw conflict('Visual apply receipt is invalid; automatic replay is blocked');
  }
  return receipt as unknown as VisualReceipt;
}

function sameReceiptIntent(
  receipt: VisualReceipt,
  target: VisualPath,
  request: VisualApplyRequest,
): boolean {
  return receipt.projectId === target.projectId
    && receipt.path === target.path
    && receipt.planFingerprint === request.plan.fingerprint
    && receipt.actor === request.actor
    && receipt.transitionTokenDigest === transitionTokenDigest(request.transitionToken)
    && receipt.sourceBeforeSha256 === request.plan.source.sha256
    && /^sha256:[a-f0-9]{64}$/.test(receipt.sourceAfterSha256);
}

function assertActor(ctx: OperationContext, actor: string): void {
  const authenticatedActor = ctx.config.collaboration?.actor?.trim();
  if (authenticatedActor && actor !== authenticatedActor) {
    throw badRequest('actor must match the authenticated collaboration actor');
  }
}

function nextSourceForPlan(currentSource: string, plan: VisualEditPlan): {
  source: string;
  sourceSha256: Sha256Digest;
} {
  if (sha256Text(currentSource) !== plan.source.sha256) {
    throw conflict('The source changed after the visual edit plan was created');
  }
  let currentSection: ReturnType<typeof parseManagedMindMapSection>;
  try {
    currentSection = parseManagedMindMapSection(currentSource);
  } catch (error) {
    throw translateVisualError(error);
  }
  if (
    currentSection.raw !== plan.preview.before.managedMarkdown
    || mindMapFingerprint(currentSection.document) !== plan.preview.before.documentFingerprint
  ) {
    throw conflict('The managed mind-map section changed after preview');
  }
  const source = currentSource.slice(0, currentSection.start)
    + plan.preview.after.managedMarkdown
    + currentSource.slice(currentSection.end);
  return { source, sourceSha256: sha256Text(source) };
}

function nextCreatedSourceForPlan(plan: VisualEditPlan): {
  source: string;
  sourceSha256: Sha256Digest;
} {
  if (plan.source.sha256 !== sha256Text('')) {
    throw conflict('The planned target no longer matches its creation precondition');
  }
  if (
    plan.preview.before.documentFingerprint !== plan.preview.after.documentFingerprint
    || plan.preview.before.managedMarkdown !== plan.preview.after.managedMarkdown
  ) {
    throw badRequest('A creation plan must present the exact new managed map as its preview');
  }
  const source = `${plan.preview.after.managedMarkdown}\n`;
  return { source, sourceSha256: sha256Text(source) };
}

function currentSource(target: VisualPath): string | undefined {
  return existsSync(target.fullPath) ? readFileSync(target.fullPath, 'utf8') : undefined;
}

function applyVisualMap(
  ctx: OperationContext,
  target: VisualPath,
  value: unknown,
): VisualMapApplyResult {
  try {
    assertVisualApplyRequest(value);
  } catch (error) {
    throw translateVisualError(error);
  }
  const request: VisualApplyRequest = value;
  assertActor(ctx, request.actor);
  if (request.plan.source.path !== target.path) {
    throw badRequest('plan source path does not match the requested Project map path');
  }

  const receiptPath = receiptRelativePath(target, request.transitionToken);
  const receiptFullPath = safeFuturePath(ctx.config.vault_path, receiptPath);
  return withFileLock(receiptFullPath, () => {
    const existingReceipt = parseReceipt(receiptFullPath);
    if (existingReceipt) {
      if (!sameReceiptIntent(existingReceipt, target, request)) {
        throw conflict('transitionToken was already used by another visual apply request');
      }
      if (existingReceipt.status === 'pending') {
        const recoveredSourceSha256 = withFileLock(target.fullPath, () => {
          const current = currentSource(target);
          const currentSha256 = sha256Text(current ?? '');
          if (currentSha256 === existingReceipt.sourceAfterSha256) {
            return currentSha256;
          }
          if (currentSha256 !== existingReceipt.sourceBeforeSha256) {
            throw conflict('A prior visual apply has outcome-unknown state; reconcile it before retrying');
          }
          const next = current === undefined
            ? nextCreatedSourceForPlan(request.plan)
            : nextSourceForPlan(current, request.plan);
          if (next.sourceSha256 !== existingReceipt.sourceAfterSha256) {
            throw conflict('Pending visual apply intent does not match the deterministic plan outcome');
          }
          atomicReplace(target.fullPath, next.source);
          return next.sourceSha256;
        });
        const recovered: AppliedReceipt = {
          ...existingReceipt,
          status: 'applied',
          sourceAfterSha256: recoveredSourceSha256,
        };
        atomicReplace(receiptFullPath, canonicalReceipt(recovered));
        return {
          projectId: target.projectId,
          path: target.path,
          sourceSha256: recoveredSourceSha256,
          planFingerprint: request.plan.fingerprint,
          actor: request.actor,
          transitionToken: request.transitionToken,
          replayed: true,
          created: request.plan.source.sha256 === sha256Text(''),
          receiptPath,
        };
      }
      return {
        projectId: target.projectId,
        path: target.path,
        sourceSha256: existingReceipt.sourceAfterSha256,
        planFingerprint: request.plan.fingerprint,
        actor: request.actor,
        transitionToken: request.transitionToken,
        replayed: true,
        created: request.plan.source.sha256 === sha256Text(''),
        receiptPath,
      };
    }

    const sourceAfterSha256 = withFileLock(target.fullPath, () => {
      const current = currentSource(target);
      const next = current === undefined
        ? nextCreatedSourceForPlan(request.plan)
        : nextSourceForPlan(current, request.plan);
      const pending: PendingReceipt = {
        schemaVersion: 1,
        status: 'pending',
        projectId: target.projectId,
        path: target.path,
        planFingerprint: request.plan.fingerprint,
        actor: request.actor,
        transitionTokenDigest: transitionTokenDigest(request.transitionToken),
        sourceBeforeSha256: request.plan.source.sha256,
        sourceAfterSha256: next.sourceSha256,
      };
      mkdirSync(dirname(receiptFullPath), { recursive: true });
      atomicReplace(receiptFullPath, canonicalReceipt(pending));
      mkdirSync(dirname(target.fullPath), { recursive: true });
      atomicReplace(target.fullPath, next.source);
      return next.sourceSha256;
    });

    const applied: AppliedReceipt = {
      schemaVersion: 1,
      status: 'applied',
      projectId: target.projectId,
      path: target.path,
      planFingerprint: request.plan.fingerprint,
      actor: request.actor,
      transitionTokenDigest: transitionTokenDigest(request.transitionToken),
      sourceBeforeSha256: request.plan.source.sha256,
      sourceAfterSha256,
    };
    atomicReplace(receiptFullPath, canonicalReceipt(applied));
    return {
      projectId: target.projectId,
      path: target.path,
      sourceSha256: sourceAfterSha256,
      planFingerprint: request.plan.fingerprint,
      actor: request.actor,
      transitionToken: request.transitionToken,
      replayed: false,
      created: request.plan.source.sha256 === sha256Text(''),
      receiptPath,
    };
  });
}

function translateVisualError(error: unknown): Error {
  if (!(error instanceof VisualWorkspaceError)) {
    return error instanceof Error ? error : internal('Visual Workspace failed');
  }
  switch (error.code) {
    case 'SOURCE_NOT_FOUND':
      return notFound(error.message);
    case 'SOURCE_CHANGED':
    case 'TRANSITION_TOKEN_REUSED':
      return conflict(error.message);
    case 'INVALID_CONTRACT':
    case 'INVALID_GRAPH':
    case 'INVALID_MARKDOWN':
    case 'MAP_ID_MISMATCH':
    case 'PLAN_TAMPERED':
      return badRequest(error.message);
  }
}

export function makeVisualWorkspaceOps(vaultPath: string): Operation[] {
  return [
    {
      name: 'visual.map.read',
      namespace: 'visual',
      description: 'Read one canonical managed mind-map Markdown section without writing.',
      mutating: false,
      params: {
        project: { type: 'string', required: true, description: 'Canonical Project ID (project/<slug>)' },
        path: { type: 'string', required: true, description: '01-Projects/<slug>/maps/**.md path' },
      },
      handler: async (_ctx, params) =>
        readVisualMap(visualPath(vaultPath, params.project, params.path, 'visual.map.read')),
    },
    {
      name: 'visual.context.read',
      namespace: 'visual',
      description: 'Read a managed map, ordinary Markdown, an ephemeral selection, core Canvas, or Project Context without writing.',
      mutating: false,
      params: {
        project: { type: 'string', required: true, description: 'Canonical Project ID (project/<slug>)' },
        context: { type: 'object', required: true, description: 'Ask Mate visual context descriptor' },
      },
      handler: async (_ctx, params) => {
        const project = canonicalProject(vaultPath, params.project, 'visual.context.read');
        if (!params.context || typeof params.context !== 'object' || Array.isArray(params.context)) {
          throw badRequest('context must be an object');
        }
        const context = params.context as Record<string, unknown>;
        const kind = requiredString(context.kind, 'context.kind');
        if (kind === 'managed_map') {
          const target = visualPath(vaultPath, project.projectId, context.path, 'visual.context.read');
          const read = readVisualMap(target);
          return {
            projectId: project.projectId,
            context: { kind, path: target.path, sourceLabel: target.path },
            document: read.document,
            documentFingerprint: read.documentFingerprint,
            targetPath: target.path,
            adoptionRequired: false,
            readOnly: false,
            warnings: [],
            clarifications: [],
            capabilities: contextCapabilities(),
          };
        }

        if (kind === 'project') {
          const issueRoot = resolve(vaultPath, `01-Projects/${project.slug}/issues`);
          const issueNames = existsSync(issueRoot)
            ? readdirSync(issueRoot, { withFileTypes: true })
              .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
              .map((entry) => entry.name.replace(/\.md$/i, ''))
              .sort()
            : [];
          const rootId = stableVisualId('project', project.projectId);
          const nodes = [
            { id: rootId, label: project.projectId },
            ...issueNames.map((name) => ({
              id: stableVisualId('issue', `${project.projectId}\0${name}`),
              label: name,
            })),
          ];
          const document = parseMindMapDocument({
            schemaVersion: 1,
            id: stableVisualId('project-map', project.projectId),
            title: `${project.slug} project map`,
            rootId,
            nodes,
            edges: nodes.slice(1).map((node) => ({ from: rootId, to: node.id })),
          });
          return {
            projectId: project.projectId,
            context: { kind, sourceLabel: project.projectId },
            document,
            documentFingerprint: mindMapFingerprint(document),
            targetPath: targetPathForContext(project.slug),
            adoptionRequired: true,
            readOnly: false,
            warnings: issueNames.length
              ? ['Project Context is a derived snapshot; confirm the exact map before creating it.']
              : ['Project Context currently has no local issues; a root-only map will be created.'],
            clarifications: [],
            capabilities: contextCapabilities(),
          };
        }

        if (kind !== 'markdown_note' && kind !== 'selection' && kind !== 'canvas') {
          throw badRequest('context.kind must be managed_map, markdown_note, selection, canvas, or project');
        }
        const sourceFile = readVaultSource(vaultPath, context.path, kind !== 'selection');
        let read: VisualSourceReadResult;
        if (kind === 'canvas') {
          read = readObsidianCanvasSource(
            filterCanvasSelection(sourceFile.source, context.canvasNodeIds),
            sourceFile.path,
          );
        } else {
          const selection = kind === 'selection'
            ? (context.selection as { text?: unknown } | undefined)?.text
            : undefined;
          const source = kind === 'selection'
            ? requiredString(selection, 'context.selection.text')
            : sourceFile.source;
          read = readMarkdownMindMapSource(source, sourceFile.path);
        }
        if (read.document) {
          const embeddedTargetPath = targetPathForContext(project.slug, read.sourcePath);
          const targetIsManagedProjectMap = read.sourcePath.startsWith(`01-Projects/${project.slug}/maps/`);
          const targetPath = targetIsManagedProjectMap ? read.sourcePath : embeddedTargetPath;
          const existingTarget = existsSync(resolve(vaultPath, targetPath))
            && targetPath !== read.sourcePath
            ? readVisualMap(visualPath(vaultPath, project.projectId, targetPath, 'visual.context.read'))
            : undefined;
          return {
            projectId: project.projectId,
            context: { kind, path: read.sourcePath, sourceLabel: read.sourcePath },
            document: existingTarget?.document ?? read.document,
            documentFingerprint: existingTarget?.documentFingerprint ?? mindMapFingerprint(read.document),
            targetPath,
            adoptionRequired: !targetIsManagedProjectMap && existingTarget === undefined,
            readOnly: false,
            warnings: [
              ...read.diagnostics.map((item) => item.message),
              ...(!targetIsManagedProjectMap
                ? ['The embedded managed section will be adopted into the Project maps directory after confirmation.']
                : []),
            ],
            clarifications: [],
            capabilities: contextCapabilities(),
          };
        }
        if (!read.adoptionCandidate) throw badRequest('The selected source cannot be represented as a mind map');
        const document = provisionalDocument(read.adoptionCandidate);
        const targetPath = targetPathForContext(project.slug, read.sourcePath);
        const existingTarget = existsSync(resolve(vaultPath, targetPath))
          ? readVisualMap(visualPath(vaultPath, project.projectId, targetPath, 'visual.context.read'))
          : undefined;
        return {
          projectId: project.projectId,
          context: { kind, path: read.sourcePath, sourceLabel: read.sourcePath },
          document: existingTarget?.document ?? document,
          documentFingerprint: existingTarget?.documentFingerprint ?? mindMapFingerprint(document),
          targetPath,
          adoptionRequired: existingTarget === undefined,
          readOnly: false,
          warnings: [
            ...read.diagnostics.map((item) => item.message),
            ...(existingTarget ? ['A managed map already exists for this source; Ask Mate opened that map.'] : []),
          ],
          clarifications: existingTarget ? [] : clarificationsForCandidate(read.adoptionCandidate),
          capabilities: contextCapabilities(),
        };
      },
    },
    {
      name: 'visual.map.plan',
      namespace: 'visual',
      description: 'Create an immutable, hash-bound visual edit preview without writing.',
      mutating: false,
      params: {
        project: { type: 'string', required: true, description: 'Canonical Project ID (project/<slug>)' },
        path: { type: 'string', required: true, description: '01-Projects/<slug>/maps/**.md path' },
        nextDocument: { type: 'object', required: true, description: 'Complete next MindMapDocument' },
        actor: { type: 'string', required: true, description: 'Actor recorded in immutable plan provenance' },
        origin: { type: 'string', required: true, enum: ['user', 'assistant', 'import'] },
        warnings: { type: 'array', required: false, description: 'Review warnings retained by the plan' },
        acceptedGraphEvidence: { type: 'array', required: false, description: 'Explicitly selected Graphify relation evidence' },
        clarificationAnswers: { type: 'object', required: false, description: 'Required source-adoption answers' },
      },
      handler: async (_ctx, params) => {
        const target = visualPath(vaultPath, params.project, params.path, 'visual.map.plan', false);
        try {
          const clarified = applyClarificationAnswers(params.nextDocument, params.clarificationAnswers);
          const nextDocument = applyAcceptedGraphEvidence(clarified, params.acceptedGraphEvidence);
          const warnings = Array.isArray(params.warnings)
            ? params.warnings.map((value, index) => requiredString(value, `warnings[${index}]`))
            : [];
          const actor = requiredString(params.actor, 'actor');
          const origin = params.origin as VisualEditPlan['provenance']['origin'];
          const plan = existsSync(target.fullPath)
            ? createVisualEditPlan({
              sourcePath: target.path,
              sourceMarkdown: readFileSync(target.fullPath, 'utf8'),
              nextDocument,
              provenance: { actor, origin },
              warnings,
            })
            : makeCreatePlan({ targetPath: target.path, nextDocument, actor, origin, warnings });
          return { projectId: target.projectId, path: target.path, plan };
        } catch (error) {
          throw translateVisualError(error);
        }
      },
    },
    {
      name: 'visual.map.project',
      namespace: 'visual',
      description: 'Render bounded Markdown, text, Mermaid, and core Canvas projections without writing.',
      mutating: false,
      params: {
        project: { type: 'string', required: true },
        path: { type: 'string', required: true },
        maxNodes: { type: 'number', required: false },
        maxDepth: { type: 'number', required: false },
      },
      handler: async (_ctx, params) => {
        const target = visualPath(vaultPath, params.project, params.path, 'visual.map.project');
        const read = readVisualMap(target);
        try {
          return {
            projectId: target.projectId,
            path: target.path,
            ...renderMindMapProjectionBundle(
              read.document,
              {
                maxNodes: typeof params.maxNodes === 'number' ? params.maxNodes : 200,
                maxDepth: typeof params.maxDepth === 'number' ? params.maxDepth : 12,
              },
              { sourcePath: target.path },
            ),
          };
        } catch (error) {
          throw translateVisualError(error);
        }
      },
    },
    {
      name: 'visual.map.apply',
      namespace: 'visual',
      description: 'Apply one complete verified VisualEditPlan with replay-safe local receipt semantics.',
      mutating: true,
      writePolicy: {
        realWrite: 'always',
        targets: (ctx, params) => {
          const plan = params.plan as { source?: { path?: unknown } } | undefined;
          const target = visualPath(
            ctx.config.vault_path,
            params.project,
            plan?.source?.path,
            'visual.map.apply',
            false,
          );
          const token = requiredString(params.transitionToken, 'transitionToken');
          return [target.path, receiptRelativePath(target, token)];
        },
        audit: 'required',
        effects: (_ctx, _params, result) => {
          const applied = result as { path?: unknown; created?: unknown } | undefined;
          return [touchMarkdown(applied?.path, applied?.created === true ? 'create' : 'modify')];
        },
      },
      params: {
        project: { type: 'string', required: true, description: 'Canonical Project ID (project/<slug>)' },
        plan: { type: 'object', required: true, description: 'Complete immutable VisualEditPlan' },
        presentedFingerprint: { type: 'string', required: true },
        actor: { type: 'string', required: true },
        transitionToken: { type: 'string', required: true },
      },
      handler: async (ctx, params) => {
        const plan = params.plan as { source?: { path?: unknown } } | undefined;
        const target = visualPath(vaultPath, params.project, plan?.source?.path, 'visual.map.apply', false);
        return applyVisualMap(ctx, target, {
          plan: params.plan,
          presentedFingerprint: params.presentedFingerprint,
          actor: params.actor,
          transitionToken: params.transitionToken,
        });
      },
    },
  ];
}
