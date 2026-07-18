import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

import {
  assertVisualApplyRequest,
  createVisualEditPlan,
  mindMapFingerprint,
  parseManagedMindMapSection,
  parseVaultRelativePath,
  sha256Text,
  VisualWorkspaceError,
  type Sha256Digest,
  type VisualApplyRequest,
  type VisualEditPlan,
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

function visualPath(vaultPath: string, projectValue: unknown, pathValue: unknown, operation: string): VisualPath {
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
  assertExistingRealPathInsideVault(vaultRoot, fullPath);
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
          const currentSource = readFileSync(target.fullPath, 'utf8');
          const currentSha256 = sha256Text(currentSource);
          if (currentSha256 === existingReceipt.sourceAfterSha256) {
            return currentSha256;
          }
          if (currentSha256 !== existingReceipt.sourceBeforeSha256) {
            throw conflict('A prior visual apply has outcome-unknown state; reconcile it before retrying');
          }
          const next = nextSourceForPlan(currentSource, request.plan);
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
        receiptPath,
      };
    }

    const sourceAfterSha256 = withFileLock(target.fullPath, () => {
      const currentSource = readFileSync(target.fullPath, 'utf8');
      const next = nextSourceForPlan(currentSource, request.plan);
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
      },
      handler: async (_ctx, params) => {
        const target = visualPath(vaultPath, params.project, params.path, 'visual.map.plan');
        const source = readFileSync(target.fullPath, 'utf8');
        try {
          const plan = createVisualEditPlan({
            sourcePath: target.path,
            sourceMarkdown: source,
            nextDocument: params.nextDocument,
            provenance: {
              actor: requiredString(params.actor, 'actor'),
              origin: params.origin as VisualEditPlan['provenance']['origin'],
            },
            warnings: params.warnings as string[] | undefined,
          });
          return { projectId: target.projectId, path: target.path, plan };
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
          );
          const token = requiredString(params.transitionToken, 'transitionToken');
          return [target.path, receiptRelativePath(target, token)];
        },
        audit: 'required',
        effects: (_ctx, _params, result) => [touchMarkdown(
          (result as { path?: unknown } | undefined)?.path,
          'modify',
        )],
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
        const target = visualPath(vaultPath, params.project, plan?.source?.path, 'visual.map.apply');
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
