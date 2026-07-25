import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';

import type { Operation } from '../core/types.js';
import { badRequest, conflict, notFound, unsupported } from '../core/types.js';
import { staticTargets } from '../core/write-policy.js';
import { DurableMaintenanceQueue } from '../maintenance/queue.js';

export interface IngestSourceRecord {
  id: string;
  inputType: string;
  canonical: string;
  title: string;
  notePath: string;
}

export interface IngestPlanStage {
  ordinal: number;
  id: string;
  provider: string;
  capability: string;
  execution: 'deferred';
}

export interface ExecutableIngestPlan {
  schemaVersion: 1;
  planId: string;
  idempotencyKey: string;
  sourceId: string;
  sourceVersion: string;
  inputType: 'url' | 'vaultPath';
  canonical: string;
  status: 'ready' | 'needs_capability' | 'needs_access' | 'manual_required';
  stages: IngestPlanStage[];
}

export interface IngestRunLease {
  owner: string;
  acquiredAt: string;
  expiresAt: string;
}

export interface PersistedIngestRun {
  schemaVersion: 1;
  runId: string;
  idempotencyKey: string;
  sourceId: string;
  sourceRevision: string;
  requestedOperation: string;
  profileRevision: string;
  state: 'planned' | 'running' | 'paused' | 'succeeded' | 'partial' | 'failed';
  completedStages: string[];
  receiptIds: string[];
  createdAt: string;
  updatedAt: string;
  lease?: IngestRunLease;
}

export interface IngestExecutionReceipt {
  schemaVersion: 1;
  receiptId: string;
  operation: string;
  status: 'succeeded' | 'partial' | 'failed' | 'skipped';
  startedAt: string;
  completedAt: string;
  outputDigests: string[];
  diagnosticCodes: string[];
  providerId?: string;
  profileRevision?: string;
}

interface IngestRunDeps {
  getSource(params: Record<string, unknown>): IngestSourceRecord;
  plan(params: Record<string, unknown>): ExecutableIngestPlan;
  now?: () => Date;
  executionEnabled?: boolean;
  executeProvider?: ProviderExecutor;
}

interface CaptureOutput {
  bytes: Buffer;
  providerId: string;
  profileRevision: string;
  mediaType: string;
}

export type ProviderExecutor = (
  source: IngestSourceRecord,
  plan: ExecutableIngestPlan,
  timeoutMs: number,
) => CaptureOutput;

interface RunResult {
  run: PersistedIngestRun;
  receipts: IngestExecutionReceipt[];
  replay: boolean;
  verified?: boolean;
  contentChanged?: boolean;
  evidencePath?: string;
  maintenanceEntryIds?: string[];
}

const RUN_ROOT = '_llmwiki/ingest-runs/v1';
const ARTIFACT_ROOT = '_llmwiki/ingest-artifacts/v1';
const ACTIVE_ROOT = '_llmwiki/ingest-active/v1';
const EVIDENCE_ROOT = '00-Inbox/Evidence';
const RUN_LEASE_MS = 60_000;
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

export function makeSourceIngestRunOps(vaultPath: string, deps: IngestRunDeps): Operation[] {
  const store = new IngestRunStore(vaultPath);
  const execute = (params: Record<string, unknown>, resumeRun?: PersistedIngestRun) =>
    executeRun(vaultPath, store, deps, params, resumeRun);
  const writeTargets = staticTargets(
    `${RUN_ROOT}/**`,
    `${ARTIFACT_ROOT}/**`,
    `${ACTIVE_ROOT}/**`,
    `${EVIDENCE_ROOT}/**`,
    '_llmwiki/maintenance/queue.v1.json',
  );
  return [
    {
      name: 'source.ingest.run',
      namespace: 'source',
      description: 'Execute a previously reviewed deterministic Source ingest plan with durable receipts and resumable stages.',
      mutating: true,
      writePolicy: { realWrite: 'always', targets: writeTargets, audit: 'required' },
      params: {
        id: { type: 'string', required: false, description: 'Registered Source id' },
        input: { type: 'string', required: false, description: 'Registered Source URL or vault-relative path' },
        inputType: { type: 'string', required: false, enum: ['url', 'vaultPath'], default: 'url' },
        planId: { type: 'string', required: true, description: 'Exact plan id returned by source.ingest.plan' },
        leaseOwner: { type: 'string', required: false, description: 'Stable worker identity for restart-safe execution' },
        timeoutMs: { type: 'number', required: false, default: 30_000, description: 'Bounded optional-provider timeout' },
      },
      handler: async (_ctx, params) => {
        requireExecutionEnabled(deps);
        return execute(params);
      },
    },
    {
      name: 'source.ingest.resume',
      namespace: 'source',
      description: 'Resume a partial, failed, paused, or expired-lease Ingest Run at its first incomplete stage.',
      mutating: true,
      writePolicy: { realWrite: 'always', targets: writeTargets, audit: 'required' },
      params: {
        runId: { type: 'string', required: true, description: 'Durable Ingest Run id' },
        leaseOwner: { type: 'string', required: false, description: 'Stable worker identity' },
        timeoutMs: { type: 'number', required: false, default: 30_000 },
      },
      handler: async (_ctx, params) => {
        requireExecutionEnabled(deps);
        const run = store.get(requiredString(params.runId, 'runId'));
        return execute({ ...params, id: run.sourceId, planId: planIdForRun(run) }, run);
      },
    },
    {
      name: 'source.ingest.inspect',
      namespace: 'source',
      description: 'Inspect one durable Ingest Run and its immutable execution receipts.',
      mutating: false,
      params: { runId: { type: 'string', required: true, description: 'Durable Ingest Run id' } },
      handler: async (_ctx, params) => {
        const run = store.get(requiredString(params.runId, 'runId'));
        return { run, receipts: store.receipts(run), replay: false } satisfies RunResult;
      },
    },
    {
      name: 'source.ingest.verify',
      namespace: 'source',
      description: 'Verify immutable hashes and stage receipts for a completed or partial Ingest Run without mutating it.',
      mutating: false,
      params: { runId: { type: 'string', required: true, description: 'Durable Ingest Run id' } },
      handler: async (_ctx, params) => verifyRun(vaultPath, store, requiredString(params.runId, 'runId')),
    },
  ];
}

function requireExecutionEnabled(deps: IngestRunDeps): void {
  if (deps.executionEnabled === false) {
    throw unsupported('Source ingest execution is disabled by compatibility flag', {
      diagnosticCode: 'FEATURE_DISABLED',
      remediation: 'Unset VAULT_MIND_AGENT_WIKI_INGEST=disabled after migration/rollback review.',
    });
  }
}

function executeRun(
  vaultPath: string,
  store: IngestRunStore,
  deps: IngestRunDeps,
  params: Record<string, unknown>,
  resumeRun?: PersistedIngestRun,
): RunResult {
  const now = deps.now ?? (() => new Date());
  const source = deps.getSource({ ...params, ...(resumeRun ? { id: resumeRun.sourceId } : {}) });
  const plan = deps.plan({ ...params, id: source.id });
  const requestedPlanId = requiredString(params.planId, 'planId');
  if (requestedPlanId !== plan.planId) {
    throw conflict('Ingest plan is stale; run source.ingest.plan again before execution');
  }
  if (plan.status !== 'ready') {
    throw unsupported(`Ingest plan is not executable: ${plan.status}`, { status: plan.status, planId: plan.planId });
  }
  const runId = runIdFor(plan.idempotencyKey);
  if (resumeRun && resumeRun.runId !== runId) {
    throw conflict('Source revision or capability profile changed; create a new Ingest Run instead of resuming');
  }
  const owner = optionalString(params.leaseOwner) ?? `mcp/${process.pid}`;
  const timeoutMs = boundedTimeout(params.timeoutMs);
  let run = store.maybeGet(runId) ?? newRun(runId, plan, now());
  if (run.state === 'succeeded') {
    return { run, receipts: store.receipts(run), replay: true };
  }
  if (run.lease && Date.parse(run.lease.expiresAt) > now().getTime() && run.lease.owner !== owner) {
    throw conflict(`Ingest Run is leased by ${run.lease.owner}`);
  }
  run = store.claim(run, owner, now());

  let contentChanged: boolean | undefined;
  let evidencePath: string | undefined;
  let maintenanceEntryIds: string[] | undefined;
  try {
    let capture = loadAcceptedCapture(vaultPath, store.receipts(run));
    if (!run.completedStages.includes('capture')) {
      const startedAt = now();
      capture = (deps.executeProvider ?? defaultProviderExecutor(vaultPath))(source, plan, timeoutMs);
      validateCapture(capture);
      const digest = digestBytes(capture.bytes);
      writeImmutable(artifactPath(vaultPath, 'captures', digest, extensionFor(capture.mediaType)), capture.bytes);
      const receipt = successReceipt('capture', startedAt, now(), [digest], capture.providerId, capture.profileRevision);
      store.putReceipt(run, receipt);
      run = store.completeStage(run, 'capture', receipt.receiptId, owner, now());
    }
    if (!capture) throw new IngestFailure('INCOMPATIBLE_OUTPUT', false);

    const normalized = normalizeDerivative(capture.bytes);
    const normalizedDigest = digestBytes(normalized);
    if (!run.completedStages.includes('derive')) {
      const startedAt = now();
      writeImmutable(artifactPath(vaultPath, 'derivatives', normalizedDigest, '.md'), normalized);
      const receipt = successReceipt('derive', startedAt, now(), [normalizedDigest], capture.providerId, capture.profileRevision);
      store.putReceipt(run, receipt);
      run = store.completeStage(run, 'derive', receipt.receiptId, owner, now());
    }

    if (!run.completedStages.includes('materialize')) {
      const startedAt = now();
      evidencePath = evidenceRelativePath(source, normalizedDigest);
      const evidence = evidenceNote(source, plan, capture, normalized, normalizedDigest);
      atomicWrite(join(vaultPath, ...evidencePath.split('/')), evidence);
      const activePath = join(vaultPath, ...`${ACTIVE_ROOT}/${source.id}.json`.split('/'));
      const previous = readOptionalJson(activePath) as { normalizedDigest?: string } | undefined;
      contentChanged = previous?.normalizedDigest !== normalizedDigest;
      if (contentChanged) {
        atomicJson(activePath, {
          schemaVersion: 1,
          sourceId: source.id,
          sourceRevision: plan.sourceVersion,
          normalizedDigest,
          evidencePath,
          activatedAt: now().toISOString(),
        });
        const queue = new DurableMaintenanceQueue(vaultPath);
        maintenanceEntryIds = queue.enqueue({
          sourceIds: [source.id],
          topicKeys: maintenanceTopicKeys(vaultPath, source),
          dirtyReasons: [previous ? 'source-revised' : 'source-ingested'],
          now: now(),
        }).map((entry) => entry.entryId);
      } else {
        maintenanceEntryIds = [];
      }
      const receipt = successReceipt(
        'materialize',
        startedAt,
        now(),
        [normalizedDigest],
        'filesystem',
        'llmwiki/evidence-v1',
      );
      store.putReceipt(run, receipt);
      run = store.completeStage(run, 'materialize', receipt.receiptId, owner, now());
    }
    run = store.finish(run, owner, now());
    return {
      run,
      receipts: store.receipts(run),
      replay: false,
      contentChanged,
      evidencePath,
      maintenanceEntryIds,
    };
  } catch (error) {
    const failure = normalizeFailure(error);
    const receipt = failureReceipt(failure.code, now());
    store.putReceipt(run, receipt);
    run = store.fail(run, receipt.receiptId, owner, now());
    return { run, receipts: store.receipts(run), replay: false };
  }
}

function verifyRun(vaultPath: string, store: IngestRunStore, runId: string): RunResult {
  const run = store.get(runId);
  const receipts = store.receipts(run);
  const missing: string[] = [];
  for (const receipt of receipts.filter((item) => item.status === 'succeeded')) {
    for (const digest of receipt.outputDigests) {
      if (!findArtifact(vaultPath, digest)) missing.push(digest);
    }
  }
  if (missing.length > 0) {
    throw conflict('Ingest Run verification failed: immutable artifact missing', { diagnosticCode: 'ARTIFACT_MISSING', digests: missing });
  }
  const expectedStages = ['capture', 'derive', 'materialize'];
  const verified = run.state === 'succeeded' && expectedStages.every((stage) => run.completedStages.includes(stage));
  return { run, receipts, replay: false, verified };
}

class IngestRunStore {
  constructor(private readonly vaultPath: string) {}

  get(runId: string): PersistedIngestRun {
    const run = this.maybeGet(runId);
    if (!run) throw notFound(`Ingest Run not found: ${runId}`);
    return run;
  }

  maybeGet(runId: string): PersistedIngestRun | undefined {
    safeId(runId, 'runId');
    const path = this.runPath(runId);
    if (!existsSync(path)) return undefined;
    return readCompatibleIngestRun(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  }

  claim(run: PersistedIngestRun, owner: string, now: Date): PersistedIngestRun {
    return this.mutate(run.runId, run, (current) => ({
      ...current,
      state: 'running',
      lease: { owner, acquiredAt: now.toISOString(), expiresAt: new Date(now.getTime() + RUN_LEASE_MS).toISOString() },
      updatedAt: now.toISOString(),
    }));
  }

  completeStage(run: PersistedIngestRun, stage: string, receiptId: string, owner: string, now: Date): PersistedIngestRun {
    return this.mutate(run.runId, run, (current) => {
      requireLease(current, owner);
      return {
        ...current,
        completedStages: unique([...current.completedStages, stage]),
        receiptIds: unique([...current.receiptIds, receiptId]),
        updatedAt: now.toISOString(),
      };
    });
  }

  finish(run: PersistedIngestRun, owner: string, now: Date): PersistedIngestRun {
    return this.mutate(run.runId, run, (current) => {
      requireLease(current, owner);
      const { lease: _lease, ...withoutLease } = current;
      return { ...withoutLease, state: 'succeeded', updatedAt: now.toISOString() };
    });
  }

  fail(run: PersistedIngestRun, receiptId: string, owner: string, now: Date): PersistedIngestRun {
    return this.mutate(run.runId, run, (current) => {
      requireLease(current, owner);
      const { lease: _lease, ...withoutLease } = current;
      return {
        ...withoutLease,
        state: current.completedStages.length > 0 ? 'partial' : 'failed',
        receiptIds: unique([...current.receiptIds, receiptId]),
        updatedAt: now.toISOString(),
      };
    });
  }

  putReceipt(run: PersistedIngestRun, receipt: IngestExecutionReceipt): void {
    const path = this.receiptPath(run.runId, receipt.receiptId);
    if (existsSync(path)) {
      const existing = readCompatibleIngestReceipt(JSON.parse(readFileSync(path, 'utf8')) as unknown);
      const sameAcceptedOutput = existing.operation === receipt.operation
        && existing.status === receipt.status
        && JSON.stringify(existing.outputDigests) === JSON.stringify(receipt.outputDigests)
        && JSON.stringify(existing.diagnosticCodes) === JSON.stringify(receipt.diagnosticCodes)
        && existing.providerId === receipt.providerId
        && existing.profileRevision === receipt.profileRevision;
      if (!sameAcceptedOutput) throw conflict(`Immutable receipt collision: ${receipt.receiptId}`);
      return;
    }
    atomicJson(path, receipt);
  }

  receipts(run: PersistedIngestRun): IngestExecutionReceipt[] {
    return run.receiptIds.map((receiptId) => {
      const path = this.receiptPath(run.runId, receiptId);
      if (!existsSync(path)) throw conflict(`Ingest receipt missing: ${receiptId}`);
      return readCompatibleIngestReceipt(JSON.parse(readFileSync(path, 'utf8')) as unknown);
    });
  }

  private mutate(
    runId: string,
    initial: PersistedIngestRun,
    update: (current: PersistedIngestRun) => PersistedIngestRun,
  ): PersistedIngestRun {
    const path = this.runPath(runId);
    return withLock(path, () => {
      const current = existsSync(path)
        ? readCompatibleIngestRun(JSON.parse(readFileSync(path, 'utf8')) as unknown)
        : initial;
      const next = update(current);
      atomicJson(path, next);
      return next;
    });
  }

  private runPath(runId: string): string {
    return join(this.vaultPath, ...`${RUN_ROOT}/${runId}.json`.split('/'));
  }

  private receiptPath(runId: string, receiptId: string): string {
    safeId(runId, 'runId');
    safeId(receiptId, 'receiptId');
    return join(this.vaultPath, ...`${RUN_ROOT}/${runId}/receipts/${receiptId}.json`.split('/'));
  }
}

/** Additive compatibility reader; any resumed mutation writes canonical v1. */
export function readCompatibleIngestRun(raw: unknown): PersistedIngestRun {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw conflict('Unsupported or corrupt Ingest Run state');
  const value = raw as Record<string, unknown>;
  if (value.schemaVersion === 1) return value as unknown as PersistedIngestRun;
  if (value.schemaVersion !== undefined && value.schemaVersion !== 0) throw conflict('Unsupported Ingest Run schema version');
  const runId = requiredCompatibleString(value.runId, 'runId');
  const sourceId = requiredCompatibleString(value.sourceId, 'sourceId');
  const at = compatibleTimestamp(value.updatedAt ?? value.createdAt);
  const state = compatibleRunState(value.state ?? value.status);
  return {
    schemaVersion: 1,
    runId,
    idempotencyKey: compatibleString(value.idempotencyKey) ?? `legacy:${runId}`,
    sourceId,
    sourceRevision: compatibleString(value.sourceRevision ?? value.revision) ?? 'legacy-unknown',
    requestedOperation: compatibleString(value.requestedOperation ?? value.operation) ?? 'capture-derive-materialize',
    profileRevision: compatibleString(value.profileRevision) ?? 'legacy-unknown',
    state,
    completedStages: compatibleStrings(value.completedStages ?? value.stages),
    receiptIds: compatibleStrings(value.receiptIds ?? value.receipts),
    createdAt: compatibleTimestamp(value.createdAt, at),
    updatedAt: at,
    ...(value.lease && typeof value.lease === 'object' ? { lease: value.lease as IngestRunLease } : {}),
  };
}

export function readCompatibleIngestReceipt(raw: unknown): IngestExecutionReceipt {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw conflict('Unsupported or corrupt Ingest receipt');
  const value = raw as Record<string, unknown>;
  if (value.schemaVersion === 1) return value as unknown as IngestExecutionReceipt;
  if (value.schemaVersion !== undefined && value.schemaVersion !== 0) throw conflict('Unsupported Ingest receipt schema version');
  const at = compatibleTimestamp(value.completedAt ?? value.startedAt);
  const status = value.status === 'partial' || value.status === 'failed' || value.status === 'skipped'
    ? value.status
    : 'succeeded';
  return {
    schemaVersion: 1,
    receiptId: requiredCompatibleString(value.receiptId, 'receiptId'),
    operation: compatibleString(value.operation) ?? 'legacy',
    status,
    startedAt: compatibleTimestamp(value.startedAt, at),
    completedAt: at,
    outputDigests: compatibleStrings(value.outputDigests ?? (value.outputDigest ? [value.outputDigest] : [])),
    diagnosticCodes: compatibleStrings(value.diagnosticCodes ?? value.diagnostics),
    ...(compatibleString(value.providerId ?? value.provider) ? { providerId: compatibleString(value.providerId ?? value.provider) } : {}),
    ...(compatibleString(value.profileRevision ?? value.profile) ? { profileRevision: compatibleString(value.profileRevision ?? value.profile) } : {}),
  };
}

function compatibleRunState(value: unknown): PersistedIngestRun['state'] {
  if (value === 'planned' || value === 'running' || value === 'paused' || value === 'succeeded' || value === 'partial' || value === 'failed') return value;
  if (value === 'completed' || value === 'success') return 'succeeded';
  return 'paused';
}

function compatibleString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function requiredCompatibleString(value: unknown, name: string): string {
  const result = compatibleString(value);
  if (!result) throw conflict(`Legacy Ingest state is missing ${name}`);
  return result;
}

function compatibleStrings(value: unknown): string[] {
  return Array.isArray(value) ? unique(value.filter((item): item is string => typeof item === 'string' && item.length > 0)) : [];
}

function compatibleTimestamp(value: unknown, fallback = new Date(0).toISOString()): string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : fallback;
}

function defaultProviderExecutor(vaultPath: string): ProviderExecutor {
  return (source, plan, timeoutMs) => {
    if (source.inputType === 'vaultPath') {
      const relativePath = source.canonical.slice('vault:'.length);
      const fullPath = resolveInside(vaultPath, relativePath);
      if (!statSync(fullPath).isFile()) throw new IngestFailure('INCOMPATIBLE_OUTPUT', false);
      return {
        bytes: readFileSync(fullPath),
        providerId: 'filesystem',
        profileRevision: 'filesystem/1',
        mediaType: mediaTypeFor(fullPath),
      };
    }
    const provider = plan.stages.find((stage) => stage.id.startsWith('capture-'))?.provider;
    if (!provider) throw new IngestFailure('CAPABILITY_MISSING', false);
    const commandText = provider === 'media'
      ? process.env.VAULT_MIND_MEDIA_CMD ?? process.env.MEDIA_TRANSCRIBE_CMD
      : process.env.VAULT_MIND_OPENCLI_CMD ?? process.env.OPENCLI_CMD;
    if (!commandText) throw new IngestFailure('PROVIDER_UNAVAILABLE', false);
    const [command, ...prefixArgs] = splitCommand(commandText);
    if (!command) throw new IngestFailure('PROVIDER_UNAVAILABLE', false);
    const result = spawnSync(command, [...prefixArgs, 'capture', source.canonical, '--format', 'json'], {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: MAX_CAPTURE_BYTES,
      windowsHide: true,
      shell: false,
    });
    if (result.error && (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
      throw new IngestFailure('PROVIDER_TIMEOUT', true);
    }
    if (result.status !== 0 || !result.stdout.trim()) throw new IngestFailure('PROVIDER_UNAVAILABLE', true);
    let content = result.stdout;
    let mediaType = 'text/markdown';
    try {
      const structured = JSON.parse(result.stdout) as { content?: unknown; markdown?: unknown; mediaType?: unknown };
      const candidate = typeof structured.content === 'string' ? structured.content : structured.markdown;
      if (typeof candidate !== 'string') throw new Error('missing content');
      content = candidate;
      if (typeof structured.mediaType === 'string') mediaType = structured.mediaType;
    } catch {
      if (/^[\[{]/.test(result.stdout.trim())) throw new IngestFailure('INCOMPATIBLE_OUTPUT', false);
    }
    return {
      bytes: Buffer.from(content, 'utf8'),
      providerId: provider,
      profileRevision: `${provider}/configured-v1`,
      mediaType,
    };
  };
}

function newRun(runId: string, plan: ExecutableIngestPlan, now: Date): PersistedIngestRun {
  return {
    schemaVersion: 1,
    runId,
    idempotencyKey: plan.idempotencyKey,
    sourceId: plan.sourceId,
    sourceRevision: plan.sourceVersion,
    requestedOperation: 'capture-derive-materialize',
    profileRevision: profileRevisionFor(plan),
    state: 'planned',
    completedStages: [],
    receiptIds: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function profileRevisionFor(plan: ExecutableIngestPlan): string {
  const capture = plan.stages.find((stage) => stage.id.startsWith('capture-'));
  return capture ? `${capture.provider}/planned-v1` : 'filesystem/1';
}

function planIdForRun(run: PersistedIngestRun): string {
  return `ingest_plan_${run.idempotencyKey.slice('sha256:'.length, 'sha256:'.length + 16)}`;
}

function loadAcceptedCapture(vaultPath: string, receipts: IngestExecutionReceipt[]): CaptureOutput | undefined {
  const receipt = receipts.find((item) => item.operation === 'capture' && item.status === 'succeeded');
  const digest = receipt?.outputDigests[0];
  if (!receipt || !digest) return undefined;
  const path = findArtifact(vaultPath, digest, 'captures');
  if (!path) return undefined;
  return {
    bytes: readFileSync(path),
    providerId: receipt.providerId ?? 'filesystem',
    profileRevision: receipt.profileRevision ?? 'unknown',
    mediaType: mediaTypeFor(path),
  };
}

function validateCapture(capture: CaptureOutput): void {
  if (capture.bytes.length === 0 || capture.bytes.length > MAX_CAPTURE_BYTES) {
    throw new IngestFailure('INCOMPATIBLE_OUTPUT', false);
  }
  if (!capture.providerId || !capture.profileRevision) throw new IngestFailure('MISSING_PROVENANCE', false);
}

function normalizeDerivative(bytes: Buffer): Buffer {
  if (bytes.includes(0)) throw new IngestFailure('INCOMPATIBLE_OUTPUT', false);
  const normalized = bytes.toString('utf8').replace(/\r\n?/g, '\n').trim();
  if (!normalized) throw new IngestFailure('INCOMPATIBLE_OUTPUT', false);
  return Buffer.from(`${normalized}\n`, 'utf8');
}

function evidenceNote(
  source: IngestSourceRecord,
  plan: ExecutableIngestPlan,
  capture: CaptureOutput,
  normalized: Buffer,
  normalizedDigest: string,
): string {
  return [
    '---',
    'llmwiki-evidence: true',
    `source-id: ${JSON.stringify(source.id)}`,
    `source-revision: ${JSON.stringify(plan.sourceVersion)}`,
    `normalized-digest: ${JSON.stringify(normalizedDigest)}`,
    `provider-id: ${JSON.stringify(capture.providerId)}`,
    `profile-revision: ${JSON.stringify(capture.profileRevision)}`,
    `captured-from: ${JSON.stringify(redactedCanonical(source))}`,
    'validation-status: accepted',
    '---',
    '',
    `# Evidence · ${source.title}`,
    '',
    normalized.toString('utf8').trimEnd(),
    '',
  ].join('\n');
}

function evidenceRelativePath(source: IngestSourceRecord, digest: string): string {
  return `${EVIDENCE_ROOT}/${safeSlug(source.id)}-${digest.slice('sha256:'.length, 'sha256:'.length + 12)}.md`;
}

/**
 * Route an in-vault compiler Source to its owning topic so the same durable
 * queue entry is executable by CompileTrigger. Other Sources retain a
 * source-keyed entry for a provider/source maintenance worker.
 */
function maintenanceTopicKeys(vaultPath: string, source: IngestSourceRecord): string[] {
  if (source.inputType !== 'vaultPath' || !source.canonical.startsWith('vault:')) return [source.id];
  const relativePath = source.canonical.slice('vault:'.length).replace(/\\/g, '/').replace(/^\/+/, '');
  const [topic, child] = relativePath.split('/');
  if (!topic || !child || !existsSync(join(vaultPath, topic, '_meta.json'))) return [source.id];
  return [topic];
}

function redactedCanonical(source: IngestSourceRecord): string {
  if (source.inputType === 'vaultPath') return source.canonical;
  const url = new URL(source.canonical);
  url.username = '';
  url.password = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/(?:token|key|secret|password|auth)/i.test(key)) url.searchParams.set(key, '[redacted]');
  }
  return url.toString();
}

function successReceipt(
  operation: string,
  startedAt: Date,
  completedAt: Date,
  outputDigests: string[],
  providerId: string,
  profileRevision: string,
  diagnosticCodes: string[] = [],
): IngestExecutionReceipt {
  const seed = `${operation}\0${outputDigests.join(',')}\0${providerId}\0${profileRevision}`;
  return {
    schemaVersion: 1,
    receiptId: `receipt_${createHash('sha256').update(seed).digest('hex').slice(0, 20)}`,
    operation,
    status: diagnosticCodes.length ? 'skipped' : 'succeeded',
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    outputDigests,
    diagnosticCodes,
    providerId,
    profileRevision,
  };
}

function failureReceipt(code: string, at: Date): IngestExecutionReceipt {
  const receiptId = `receipt_${createHash('sha256').update(`${code}\0${at.toISOString()}`).digest('hex').slice(0, 20)}`;
  return {
    schemaVersion: 1,
    receiptId,
    operation: 'ingest',
    status: 'failed',
    startedAt: at.toISOString(),
    completedAt: at.toISOString(),
    outputDigests: [],
    diagnosticCodes: [code],
  };
}

class IngestFailure extends Error {
  constructor(readonly code: string, readonly transient: boolean) {
    super(code);
  }
}

function normalizeFailure(error: unknown): IngestFailure {
  if (error instanceof IngestFailure) return error;
  return new IngestFailure('INCOMPATIBLE_OUTPUT', false);
}

function runIdFor(idempotencyKey: string): string {
  return `ingest_run_${idempotencyKey.slice('sha256:'.length, 'sha256:'.length + 20)}`;
}

function digestBytes(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function artifactPath(vaultPath: string, kind: 'captures' | 'derivatives', digest: string, extension: string): string {
  return join(vaultPath, ...`${ARTIFACT_ROOT}/${kind}/${digest.slice('sha256:'.length)}${extension}`.split('/'));
}

function findArtifact(vaultPath: string, digest: string, kind?: 'captures' | 'derivatives'): string | undefined {
  const hash = digest.slice('sha256:'.length);
  const kinds = kind ? [kind] : ['captures', 'derivatives'] as const;
  for (const candidateKind of kinds) {
    const root = join(vaultPath, ...`${ARTIFACT_ROOT}/${candidateKind}`.split('/'));
    if (!existsSync(root)) continue;
    for (const extension of ['.md', '.txt', '.html', '.json', '.bin']) {
      const candidate = join(root, `${hash}${extension}`);
      if (!existsSync(candidate)) continue;
      if (digestBytes(readFileSync(candidate)) === digest) return candidate;
    }
  }
  return undefined;
}

function writeImmutable(path: string, bytes: Buffer): void {
  if (existsSync(path)) {
    if (!readFileSync(path).equals(bytes)) throw conflict(`Immutable artifact collision: ${basename(path)}`);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes, { flag: 'wx' });
}

function atomicJson(path: string, value: unknown): void {
  atomicWrite(path, JSON.stringify(value, null, 2) + '\n');
}

function atomicWrite(path: string, value: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, value);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function withLock<T>(path: string, work: () => T): T {
  mkdirSync(dirname(path), { recursive: true });
  const lock = `${path}.lock`;
  try {
    try {
      writeFileSync(lock, String(process.pid), { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const age = existsSync(lock) ? Date.now() - statSync(lock).mtimeMs : RUN_LEASE_MS + 1;
      if (age <= RUN_LEASE_MS) throw conflict(`Ingest Run store is locked: ${basename(path)}`);
      rmSync(lock, { force: true });
      writeFileSync(lock, String(process.pid), { flag: 'wx' });
    }
    return work();
  } finally {
    rmSync(lock, { force: true });
  }
}

function resolveInside(vaultPath: string, relativePath: string): string {
  if (!relativePath || relativePath.split(/[\\/]/).some((part) => part === '..' || part === '.')) {
    throw badRequest('Invalid vault-relative Source path');
  }
  const root = resolve(vaultPath);
  const full = resolve(root, relativePath);
  const rel = relative(root, full);
  if (rel.startsWith('..') || resolve(rel) === rel) throw badRequest('Source path escapes vault');
  return full;
}

function splitCommand(value: string): string[] {
  const matches = value.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  return matches.map((part) => part.replace(/^"|"$/g, ''));
}

function extensionFor(mediaType: string): string {
  if (mediaType.includes('markdown')) return '.md';
  if (mediaType.includes('json')) return '.json';
  if (mediaType.startsWith('text/')) return '.txt';
  return '.bin';
}

function mediaTypeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.md': return 'text/markdown';
    case '.txt': return 'text/plain';
    case '.json': return 'application/json';
    case '.html': return 'text/html';
    default: return 'application/octet-stream';
  }
}

function boundedTimeout(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 30_000;
  return Math.max(100, Math.min(120_000, Math.floor(value)));
}

function requiredString(value: unknown, name: string): string {
  const normalized = optionalString(value);
  if (!normalized) throw badRequest(`${name} required`);
  return normalized;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function safeId(value: string, name: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) throw badRequest(`Invalid ${name}`);
}

function safeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'source';
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function readOptionalJson(path: string): unknown {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
}

function requireLease(run: PersistedIngestRun, owner: string): void {
  if (run.state !== 'running' || run.lease?.owner !== owner) throw conflict(`Ingest Run ${run.runId} lease lost`);
}
