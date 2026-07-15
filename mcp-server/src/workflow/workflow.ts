import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Operation, OperationContext, WriteEffect } from '../core/types.js';
import { conflict, makeErr } from '../core/types.js';
import { resultPath, touchMarkdown, workflowAgentPolicyBasePath, workflowPolicyBasePath } from '../core/write-policy.js';
import { resolveProjectContext } from '../project/project-context.js';

const STAGES = ['intake', 'understand', 'plan', 'execute', 'review', 'verify', 'archive'] as const;
type WorkflowStage = (typeof STAGES)[number];

const CHECKPOINT_STATUSES = ['note', 'passed', 'failed', 'blocked'] as const;
type CheckpointStatus = (typeof CHECKPOINT_STATUSES)[number];

const AGENT_STAGES = ['think', 'plan', 'build', 'review', 'test', 'ship', 'reflect'] as const;
type AgentStage = (typeof AGENT_STAGES)[number];

const workflowAgentEffects = (_ctx: OperationContext, _params: Record<string, unknown>, result: unknown): WriteEffect[] => {
  const eventsPath = typeof result === 'object' && result !== null
    ? (result as { eventsPath?: unknown }).eventsPath
    : undefined;
  const runPath = typeof result === 'object' && result !== null
    ? (result as { runPath?: unknown }).runPath
    : undefined;
  return [touchMarkdown(resultPath(result), 'modify'), touchMarkdown(eventsPath, 'modify'), touchMarkdown(runPath, 'modify')];
};

const workflowAgentTargets = (ctx: OperationContext, params: Record<string, unknown>): string[] => {
  const workflow = workflowPolicyBasePath(ctx.config, params, 'workflow.agent');
  const projectRoot = workflow.slice(0, -'/workflow'.length);
  return [`${workflowAgentPolicyBasePath(ctx.config, params, 'workflow.agent')}/**`, `${projectRoot}/runs/**`];
};

const AGENT_STATUSES = ['active', 'blocked', 'done', 'archived'] as const;
type AgentStatus = (typeof AGENT_STATUSES)[number];

export const WORK_RUN_STATES = [
  'planned',
  'leased',
  'running',
  'awaiting_review',
  'completed',
  'failed',
  'cancelled',
] as const;
export type WorkRunState = (typeof WORK_RUN_STATES)[number];

export const WORK_RUN_TERMINAL_STATES = ['completed', 'failed', 'cancelled'] as const;
const WORK_RUN_OUTPUT_CLASSES = ['view', 'work-state-transition', 'knowledge-claim', 'external-side-effect'] as const;
type WorkRunOutputClass = (typeof WORK_RUN_OUTPUT_CLASSES)[number];
const WORK_RUN_APPROVAL_STATUSES = ['not-required', 'pending', 'approved', 'denied'] as const;
type WorkRunApprovalStatus = (typeof WORK_RUN_APPROVAL_STATUSES)[number];

const WORK_RUN_TRANSITIONS: Readonly<Record<WorkRunState, readonly WorkRunState[]>> = {
  planned: ['leased', 'cancelled'],
  leased: ['running', 'failed', 'cancelled'],
  running: ['awaiting_review', 'completed', 'failed', 'cancelled'],
  awaiting_review: ['running', 'completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

interface WorkRunTransitionReceipt {
  token: string;
  operation: 'join' | 'step' | 'checkpoint' | 'leave';
  workRunState: WorkRunState;
  agentStage: AgentStage;
  agentStatus: AgentStatus;
  outputClass: WorkRunOutputClass;
  approvalStatus: WorkRunApprovalStatus;
  recordedAt: string;
}

const AGENT_STAGE_EVIDENCE_REQUIREMENTS: Partial<Record<AgentStage, readonly string[]>> = {
  test: ['review:'],
  ship: ['review:', 'test:'],
} as const;

interface WorkflowState {
  project: string;
  stage: WorkflowStage;
  objective: string;
  branch: string;
  host: string;
  evidence: string[];
  updatedBy: string;
  updatedAt: string;
  path: string;
}

interface AgentLifetimeState {
  projectId: string;
  project: string;
  workRunId: string;
  workRunState: WorkRunState;
  workItemId: string;
  agent: string;
  role: string;
  host: string;
  stage: AgentStage;
  status: AgentStatus;
  objective: string;
  issue: string;
  evidence: string[];
  provenance: string[];
  outputClass: WorkRunOutputClass;
  approvalStatus: WorkRunApprovalStatus;
  transitions: WorkRunTransitionReceipt[];
  startedAt: string;
  updatedAt: string;
  path: string;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function existingProjectKey(vaultPath: string, value: unknown, operation: string): string {
  if (typeof value !== 'string' || !value.trim()) throw makeErr(-32602, 'project is required');
  return resolveProjectContext(vaultPath, value, operation).slug;
}

function agentKey(value: unknown, fallback: string): string {
  const key = slugify(String(value ?? fallback));
  if (!key) throw makeErr(-32602, 'agent must contain at least one [a-z0-9] character');
  return key;
}

function safeSegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed === '.' ||
    trimmed === '..' ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    /^[A-Za-z]:/.test(trimmed) ||
    trimmed.startsWith('//')
  ) {
    throw makeErr(-32602, `${label} must be a single safe path segment`);
  }
  return trimmed;
}

function actorFromContext(ctx: OperationContext): string {
  return agentKey(undefined, ctx.config.collaboration?.actor || process.env.VAULT_MIND_ACTOR || 'agent');
}

function workflowRoot(project: string): string {
  return `01-Projects/${project}/workflow`;
}

function agentsRoot(project: string): string {
  return `01-Projects/${project}/agents`;
}

function agentRoot(project: string, agent: string): string {
  return `${agentsRoot(project)}/${agent}`;
}

function projectNotePath(project: string): string {
  return `01-Projects/${project}/_project.md`;
}

function issuesRoot(project: string): string {
  return `01-Projects/${project}/issues`;
}

function statePath(project: string): string {
  return `${workflowRoot(project)}/status.md`;
}

function checkpointsPath(project: string): string {
  return `${workflowRoot(project)}/checkpoints.md`;
}

function agentLifetimePath(project: string, agent: string): string {
  return `${agentRoot(project, agent)}/lifetime.md`;
}

function agentEventsPath(project: string, agent: string): string {
  return `${agentRoot(project, agent)}/events.md`;
}

function durableRunPath(project: string, workRunId: string): string {
  return `01-Projects/${project}/runs/${workRunId.slice('work-run/'.length)}.json`;
}

const WORK_RUN_LOCK_PATH = '.vault-mind/_work-run.lock';

function withWorkRunLock<T>(vaultPath: string, action: () => T): T {
  const lockPath = vaultJoin(vaultPath, WORK_RUN_LOCK_PATH);
  const token = `${process.pid}:${randomUUID()}`;
  mkdirSync(dirname(lockPath), { recursive: true });
  const claim = () => writeFileSync(lockPath, token, { encoding: 'utf-8', flag: 'wx' });
  try {
    claim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    throw conflict(
      `Work Run is busy with another runtime; verify the owner and remove ${WORK_RUN_LOCK_PATH} manually only after confirming no writer is active`,
    );
  }
  try {
    return action();
  } finally {
    try {
      if (readFileSync(lockPath, 'utf-8') === token) rmSync(lockPath, { force: true });
    } catch {
      // A missing lock is already released; never remove a successor's token.
    }
  }
}

interface LeasedRunIdentity {
  projectId: string;
  workItemId: string;
  workRunId: string;
  agentId: string;
  state: WorkRunState;
  leaseMode: LeaseMode;
  handoffToken?: string;
}

const LEASE_MODES = ['local', 'portable-handoff'] as const;
type LeaseMode = (typeof LEASE_MODES)[number];

function jsonRecord(path: string, label: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('expected an object');
    }
    return value as Record<string, unknown>;
  } catch (error) {
    throw conflict(`${label} identity conflict: ${(error as Error).message}`);
  }
}

function leaseCandidates(vaultPath: string, workRunId: string): Array<Record<string, unknown>> {
  const registry = jsonRecord(join(vaultPath, '.vault-mind', '_leases.json'), 'Lease registry');
  if (!registry) return [];
  return Object.values(registry).filter((value): value is Record<string, unknown> => (
    Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>).work_run_id === workRunId
  ));
}

function canonicalWorkItemId(value: unknown): string {
  const id = optionalString(value);
  if (!/^project\/[a-z0-9][a-z0-9-]*\/issue\/[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw conflict('Work Item identity conflict: work_item_id must be canonical');
  }
  return id;
}

function identityEquals(label: string, expected: unknown, actual: unknown): void {
  if (typeof expected !== 'string' || expected !== actual) {
    throw conflict(`${label} identity conflict`, { expected, actual });
  }
}

function assertWorkItemOwnership(projectIdentity: string, workItemId: string): void {
  if (!workItemId.startsWith(`${projectIdentity}/issue/`)) {
    throw conflict('Work Item ownership identity conflict', {
      projectId: projectIdentity,
      workItemId,
    });
  }
}

function assertActiveLeaseIdentity(
  vaultPath: string,
  identity: Pick<LeasedRunIdentity, 'projectId' | 'workItemId' | 'workRunId' | 'agentId'>,
): void {
  const leases = leaseCandidates(vaultPath, identity.workRunId);
  if (leases.length !== 1) {
    throw conflict('Lease identity conflict: expected exactly one local lease for Work Run', {
      workRunId: identity.workRunId,
      matches: leases.length,
    });
  }
  const lease = leases[0];
  identityEquals('Project', identity.projectId, lease.project_id);
  identityEquals('Work Item', identity.workItemId, lease.work_item_id);
  identityEquals('Work Run', identity.workRunId, lease.work_run_id);
  identityEquals('agent', identity.agentId, lease.agent_id);
  const expiresAt = lease.expires_at;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || Date.now() / 1000 >= expiresAt) {
    throw conflict('Lease expiry identity conflict: local lease is missing or expired', {
      workRunId: identity.workRunId,
      expiresAt,
    });
  }
}

function parseLeaseMode(value: unknown): LeaseMode {
  const mode = optionalString(value) || 'local';
  if (!LEASE_MODES.includes(mode as LeaseMode)) {
    throw makeErr(-32602, `lease_mode must be one of: ${LEASE_MODES.join(', ')}`);
  }
  return mode as LeaseMode;
}

interface DurableRunAssertion {
  state: WorkRunState;
  record: Record<string, unknown>;
}

const GOVERNED_RUN_LOCKS = [
  { key: 'agent_profile_id', label: 'Agent Profile identity', kind: 'id', pattern: /^(?:agent\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?|agent-profile\/[a-z0-9][a-z0-9-]*)$/ },
  { key: 'agent_profile_revision', label: 'Agent Profile revision', kind: 'revision' },
  { key: 'project_agent_binding_id', label: 'Project Agent Binding identity', kind: 'id', pattern: /^(?:binding\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?|project-agent-binding\/[a-z0-9][a-z0-9-]*)$/ },
  { key: 'project_agent_binding_revision', label: 'Project Agent Binding revision', kind: 'revision' },
  { key: 'assignment_plan_id', label: 'Assignment Plan identity', kind: 'id', pattern: /^assignment-plan\/[a-z0-9][a-z0-9-]*$/ },
  { key: 'assignment_plan_version', label: 'Assignment Plan version', kind: 'revision' },
  { key: 'assignment_plan_fingerprint', label: 'Assignment Plan fingerprint', kind: 'fingerprint' },
  { key: 'context_envelope_fingerprint', label: 'Context Envelope fingerprint', kind: 'fingerprint' },
  { key: 'device_snapshot', label: 'Device Snapshot', kind: 'device-snapshot' },
  { key: 'parent_work_run_id', label: 'Parent Work Run identity', kind: 'work-run' },
] as const;

const GOVERNED_RUN_EXTENSION_KEYS = [
  ...GOVERNED_RUN_LOCKS.map((item) => item.key),
  'child_work_run_ids',
  'capability_grant_summary',
  'artifact_projections',
  'expected_output',
] as const;

function assertGovernedLockValue(
  spec: (typeof GOVERNED_RUN_LOCKS)[number],
  value: unknown,
): void {
  if (spec.kind === 'device-snapshot') {
    assertDeviceSnapshot(value);
    return;
  }
  if (spec.kind === 'revision') {
    if (!Number.isSafeInteger(value) || (value as number) < 1) {
      throw conflict(`${spec.label} conflict`, { actual: value, expected: 'positive integer' });
    }
    return;
  }
  if (typeof value !== 'string') {
    throw conflict(`${spec.label} conflict`, { actual: value, expected: 'string' });
  }
  if (spec.kind === 'fingerprint') {
    if (!/^(?:sha256:)?[a-f0-9]{64}$/.test(value)) throw conflict(`${spec.label} conflict`, { actual: value });
  } else if (spec.kind === 'work-run') {
    if (!/^work-run\/[a-z0-9][a-z0-9-]*$/.test(value)) throw conflict(`${spec.label} conflict`, { actual: value });
  } else if (spec.kind === 'id' && !spec.pattern.test(value)) {
    throw conflict(`${spec.label} conflict`, { actual: value });
  }
  assertPersistedTextSafe(spec.key, value);
}

function fingerprintHex(value: unknown): string | null {
  return typeof value === 'string' && /^(?:sha256:)?[a-f0-9]{64}$/.test(value)
    ? value.replace(/^sha256:/, '')
    : null;
}

function assertDeviceSnapshot(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw conflict('Device Snapshot conflict', { actual: value });
  const snapshot = value as Record<string, unknown>;
  const required = ['snapshotId', 'deviceId', 'revision', 'fingerprint', 'capturedAt', 'expiresAt'] as const;
  const keys = Object.keys(snapshot);
  if (keys.length !== required.length || required.some((key) => !(key in snapshot))) {
    throw conflict('Device Snapshot conflict', { actual: value, expected: required });
  }
  if (typeof snapshot.snapshotId !== 'string' || !/^device-snapshot\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(snapshot.snapshotId)) {
    throw conflict('Device Snapshot identity conflict', { actual: snapshot.snapshotId });
  }
  if (typeof snapshot.deviceId !== 'string' || !/^device\/[a-z0-9][a-z0-9-]*$/.test(snapshot.deviceId)) {
    throw conflict('Device identity conflict', { actual: snapshot.deviceId });
  }
  if (!Number.isSafeInteger(snapshot.revision) || (snapshot.revision as number) < 1) {
    throw conflict('Device Snapshot revision conflict', { actual: snapshot.revision });
  }
  if (fingerprintHex(snapshot.fingerprint) === null) {
    throw conflict('Device Snapshot fingerprint conflict', { actual: snapshot.fingerprint });
  }
  for (const key of ['capturedAt', 'expiresAt'] as const) {
    const timestamp = snapshot[key];
    if (typeof timestamp !== 'string' || !timestamp) {
      throw conflict(`Device Snapshot ${key} conflict`, { actual: timestamp });
    }
    assertPersistedTextSafe(`device_snapshot.${key}`, timestamp);
  }
}

function comparableGovernedLock(
  spec: (typeof GOVERNED_RUN_LOCKS)[number],
  value: unknown,
): unknown {
  if (spec.kind === 'fingerprint') return fingerprintHex(value);
  if (spec.kind === 'device-snapshot' && value && typeof value === 'object' && !Array.isArray(value)) {
    const snapshot = value as Record<string, unknown>;
    return JSON.stringify({
      snapshotId: snapshot.snapshotId,
      deviceId: snapshot.deviceId,
      revision: snapshot.revision,
      fingerprint: fingerprintHex(snapshot.fingerprint),
      capturedAt: snapshot.capturedAt,
      expiresAt: snapshot.expiresAt,
    });
  }
  return value;
}

function assertGovernedRunLocks(params: Record<string, unknown>, durable: Record<string, unknown>): void {
  for (const spec of GOVERNED_RUN_LOCKS) {
    const expected = params[spec.key];
    const actual = durable[spec.key];
    if (expected === undefined && actual === undefined) continue;
    if (expected === undefined || actual === undefined) {
      throw conflict(`${spec.label} conflict`, { expected, actual });
    }
    assertGovernedLockValue(spec, expected);
    assertGovernedLockValue(spec, actual);
    if (comparableGovernedLock(spec, expected) !== comparableGovernedLock(spec, actual)) {
      throw conflict(`${spec.label} conflict`, { expected, actual });
    }
  }
}

const FORBIDDEN_DURABLE_EXTENSION_KEY = /(?:^|_)(?:secret|token|credential|api[_-]?key|workspace|path|process|handle|header|environment|env)(?:_|$)/i;

function assertPortableDurableValue(label: string, value: unknown, depth = 0): void {
  if (depth > 6) throw conflict(`${label} exceeds the durable Work Run nesting limit`);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw conflict(`${label} contains a non-finite number`);
    return;
  }
  if (typeof value === 'string') {
    if (value.length > 4_096) throw conflict(`${label} exceeds the durable Work Run text limit`);
    if (/(?:api[_-]?key|credential|plaintext[_-]?secret)/i.test(value)) {
      throw conflict(`${label} contains secret-bearing material`);
    }
    assertPersistedTextSafe(label, value);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 256) throw conflict(`${label} exceeds the durable Work Run array limit`);
    value.forEach((item, index) => assertPortableDurableValue(`${label}[${index}]`, item, depth + 1));
    return;
  }
  if (!value || typeof value !== 'object') throw conflict(`${label} contains an unsupported value`);
  const record = value as Record<string, unknown>;
  const entries = Object.entries(record);
  if (entries.length > 64) throw conflict(`${label} exceeds the durable Work Run object limit`);
  for (const [key, nested] of entries) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || FORBIDDEN_DURABLE_EXTENSION_KEY.test(key)) {
      throw conflict(`${label} contains forbidden field ${key}`);
    }
    assertPortableDurableValue(`${label}.${key}`, nested, depth + 1);
  }
}

function governedRunExtensions(run: Record<string, unknown>): Record<string, unknown> {
  const extensions: Record<string, unknown> = {};
  for (const spec of GOVERNED_RUN_LOCKS) {
    const value = run[spec.key];
    if (value === undefined) continue;
    assertGovernedLockValue(spec, value);
    extensions[spec.key] = value;
  }
  if (run.child_work_run_ids !== undefined) {
    if (!Array.isArray(run.child_work_run_ids)) throw conflict('Child Work Run identities conflict');
    const children = run.child_work_run_ids.map((value) => {
      if (typeof value !== 'string' || !/^work-run\/[a-z0-9][a-z0-9-]*$/.test(value)) {
        throw conflict('Child Work Run identities conflict', { actual: value });
      }
      return value;
    });
    if (new Set(children).size !== children.length) throw conflict('Child Work Run identities conflict: duplicates');
    extensions.child_work_run_ids = children;
  }
  for (const key of ['capability_grant_summary', 'artifact_projections', 'expected_output'] as const) {
    const value = run[key];
    if (value === undefined) continue;
    assertPortableDurableValue(key, value);
    extensions[key] = structuredClone(value);
  }
  if (Object.keys(extensions).length > 0 && run.schema_version !== 2) {
    throw conflict('Governed Work Run extensions require schema_version=2', { actual: run.schema_version });
  }
  return extensions;
}

function assertPortableHandoffAuthority(durable: Record<string, unknown>, handoffToken: unknown): void {
  const token = typeof handoffToken === 'string' ? handoffToken : '';
  if (token.length < 16 || token.length > 4096) {
    throw makeErr(-32602, 'handoff_token is required for lease_mode=portable-handoff');
  }
  const expectedHash = durable.handoff_token_hash;
  if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    throw conflict('Portable handoff authority conflict: durable handoff_token_hash is missing or invalid');
  }
  const expiresAt = durable.handoff_expires_at;
  if (
    typeof expiresAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(expiresAt)
    || !Number.isFinite(Date.parse(expiresAt))
    || Date.now() >= Date.parse(expiresAt)
  ) {
    throw conflict('Portable handoff authority conflict: durable handoff is missing or expired');
  }
  const actual = createHash('sha256').update(token, 'utf-8').digest();
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw conflict('Portable handoff authority conflict: handoff token mismatch');
  }
}

function assertJoinLeaseAuthority(
  vaultPath: string,
  identity: Pick<LeasedRunIdentity, 'projectId' | 'workItemId' | 'workRunId' | 'agentId' | 'leaseMode' | 'handoffToken'>,
  durable: Record<string, unknown>,
): void {
  const registryPath = join(vaultPath, '.vault-mind', '_leases.json');
  if (identity.leaseMode === 'portable-handoff') {
    assertPortableHandoffAuthority(durable, identity.handoffToken);
    if (!existsSync(registryPath)) return;
  }
  assertActiveLeaseIdentity(vaultPath, identity);
}

function assertDurableRunIdentity(
  vaultPath: string,
  project: string,
  identity: Pick<LeasedRunIdentity, 'projectId' | 'workItemId' | 'workRunId' | 'agentId'>,
): DurableRunAssertion {
  const durablePath = vaultJoin(vaultPath, durableRunPath(project, identity.workRunId));
  const durable = jsonRecord(durablePath, 'Durable Work Run');
  if (!durable) throw conflict(`Work Run identity conflict: durable run not found for ${identity.workRunId}`);
  identityEquals('Project', identity.projectId, durable.project_id);
  identityEquals('Work Item', identity.workItemId, durable.work_item_id);
  identityEquals('Work Run', identity.workRunId, durable.work_run_id);
  identityEquals('agent', identity.agentId, durable.agent_id);
  const state = durable.state as WorkRunState;
  if (!WORK_RUN_STATES.includes(state)) {
    throw conflict(`Work Run identity conflict: invalid durable state ${String(durable.state)}`);
  }
  return { state, record: durable };
}

function assertLeasedRunIdentity(
  vaultPath: string,
  project: string,
  agent: string,
  params: Record<string, unknown>,
): LeasedRunIdentity {
  const workRunId = parseWorkRunId(params.work_run_id);
  const workItemId = canonicalWorkItemId(params.work_item_id);
  const expectedProjectId = projectId(project);
  assertWorkItemOwnership(expectedProjectId, workItemId);
  const leaseMode = parseLeaseMode(params.lease_mode);
  const handoffToken = leaseMode === 'portable-handoff' && typeof params.handoff_token === 'string'
    ? params.handoff_token
    : undefined;
  const identity = { projectId: expectedProjectId, workItemId, workRunId, agentId: agent, leaseMode, handoffToken };
  const durable = assertDurableRunIdentity(vaultPath, project, identity);
  assertGovernedRunLocks(params, durable.record);
  const state = durable.state;
  if (state !== 'leased' && state !== 'running') {
    throw conflict(`Work Run identity conflict: join requires leased or running state, found ${String(state)}`);
  }
  assertJoinLeaseAuthority(vaultPath, identity, durable.record);
  return { ...identity, state };
}

function durableTransitions(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const raw = item as Record<string, unknown>;
    if (typeof raw.transition_token !== 'string') return [];
    return [{
      transition_token: raw.transition_token,
      from: typeof raw.from === 'string' ? raw.from : null,
      to: typeof raw.to === 'string' ? raw.to : null,
      recorded_at: raw.recorded_at ?? null,
    }];
  });
}

function syncDurableWorkRunUnlocked(
  vaultPath: string,
  state: AgentLifetimeState,
  transitionToken: string,
  leasedIdentity?: LeasedRunIdentity,
): string {
  const path = durableRunPath(state.project, state.workRunId);
  const fullPath = vaultJoin(vaultPath, path);
  let run: Record<string, any> = {};
  const original = existsSync(fullPath) ? readFileSync(fullPath, 'utf-8') : null;
  if (original !== null) {
    try {
      run = JSON.parse(original) as Record<string, any>;
    } catch {
      throw makeErr(-32603, `Durable Work Run is malformed: ${path}`);
    }
    identityEquals('Project', state.projectId, run.project_id);
    identityEquals('Work Item', state.workItemId, run.work_item_id);
    identityEquals('Work Run', state.workRunId, run.work_run_id);
    identityEquals('agent', state.agent, run.agent_id);
    const previousState = run.state as WorkRunState;
    if (!WORK_RUN_STATES.includes(previousState)) {
      throw conflict('Work Run state conflict: durable state is invalid', { actual: run.state });
    }
    if (previousState !== state.workRunState && !isWorkRunTransitionAllowed(previousState, state.workRunState)) {
      throw conflict(`Invalid Work Run transition: ${previousState} -> ${state.workRunState}`);
    }
  }
  if (leasedIdentity) assertJoinLeaseAuthority(vaultPath, leasedIdentity, run);
  const transitions = durableTransitions(run.transitions);
  if (!transitions.some((item) => item.transition_token === transitionToken)) {
    const previous = typeof run.state === 'string' ? run.state : state.workRunState === 'running' ? 'leased' : 'planned';
    if (previous !== state.workRunState) {
      transitions.push({ transition_token: transitionToken, from: previous, to: state.workRunState, recorded_at: state.updatedAt });
    }
  }
  const extensions = governedRunExtensions(run);
  const durable = {
    schema_version: Object.keys(extensions).length > 0 ? 2 : 1,
    project_id: state.projectId,
    work_item_id: state.workItemId,
    work_run_id: state.workRunId,
    agent_id: state.agent,
    state: state.workRunState,
    output_class: state.outputClass,
    approval_status: state.approvalStatus,
    created_at: run.created_at ?? state.startedAt,
    updated_at: state.updatedAt,
    provenance: [...state.provenance].sort(),
    transitions,
    ...extensions,
    ...(typeof run.handoff_token_hash === 'string' ? { handoff_token_hash: run.handoff_token_hash } : {}),
    ...(typeof run.handoff_expires_at === 'string' ? { handoff_expires_at: run.handoff_expires_at } : {}),
  };
  mkdirSync(dirname(fullPath), { recursive: true });
  const temporary = `${fullPath}.tmp-${randomUUID()}`;
  writeFileSync(temporary, JSON.stringify(durable, null, 2) + '\n', 'utf-8');
  const unchanged = original === null
    ? !existsSync(fullPath)
    : existsSync(fullPath) && readFileSync(fullPath, 'utf-8') === original;
  if (!unchanged) {
    rmSync(temporary, { force: true });
    throw conflict(`Work Run changed concurrently: ${state.workRunId}`);
  }
  renameSync(temporary, fullPath);
  return path;
}

function assertDurableLifetimeIdentity(vaultPath: string, state: AgentLifetimeState): void {
  const durable = assertDurableRunIdentity(vaultPath, state.project, {
    projectId: state.projectId,
    workItemId: state.workItemId,
    workRunId: state.workRunId,
    agentId: state.agent,
  });
  if (durable.state !== state.workRunState) {
    throw conflict('Work Run state conflict: lifetime and durable run differ', {
      lifetime: state.workRunState,
      durable: durable.state,
    });
  }
}

interface FilePreimage {
  fullPath: string;
  content: Buffer | null;
}

function withFileRollback<T>(vaultPath: string, relPaths: string[], action: () => T): T {
  const preimages: FilePreimage[] = [...new Set(relPaths)].map((relPath) => {
    const fullPath = vaultJoin(vaultPath, relPath);
    return { fullPath, content: existsSync(fullPath) ? readFileSync(fullPath) : null };
  });
  try {
    return action();
  } catch (error) {
    for (const preimage of preimages.reverse()) {
      if (preimage.content === null) {
        rmSync(preimage.fullPath, { force: true });
      } else {
        mkdirSync(dirname(preimage.fullPath), { recursive: true });
        writeFileSync(preimage.fullPath, preimage.content);
      }
    }
    throw error;
  }
}

function vaultJoin(vaultPath: string, relPath: string): string {
  return join(vaultPath, ...relPath.split('/'));
}

function writeVaultBytes(vaultPath: string, relPath: string, content: string): void {
  const fullPath = vaultJoin(vaultPath, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, Buffer.from(content, 'utf-8'));
}

function appendVaultBytes(vaultPath: string, relPath: string, content: string): void {
  const fullPath = vaultJoin(vaultPath, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  const existing = existsSync(fullPath) ? readFileSync(fullPath, 'utf-8').replace(/\s+$/, '') + '\n\n' : '';
  writeFileSync(fullPath, Buffer.from(existing + content, 'utf-8'));
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function oneLine(value: unknown, max = 240): string {
  const text = optionalString(value).replace(/\r?\n/g, ' ');
  return text.length > max ? text.slice(0, max) : text;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const text = item.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function assertPersistedTextSafe(label: string, value: string): void {
  if (!value) return;
  const candidates = [value.trim()];
  const uriReference = /^[a-z][a-z0-9+.-]*:\/\/(.*)$/i.exec(candidates[0]);
  const logicalReference = /^[a-z][a-z0-9+.-]*:(.*)$/i.exec(candidates[0]);
  if (uriReference) candidates.push(uriReference[1]);
  else if (logicalReference) candidates.push(logicalReference[1]);
  const exposesPath = candidates.some((candidate) => {
    if (/^file:/i.test(candidate)) return true;
    if (/^https?:\/\//i.test(candidate)) return false;
    return /^(?:[A-Za-z]:[\\/]|\\\\|\/|~[\\/]|\.{1,2}[\\/])/.test(candidate)
      || /(?:^|[\/:=\s])(?:[A-Za-z]:[\\/]|\\\\|\/(?:[^/\s]+\/)|~[\\/]|\.{1,2}[\\/])/.test(candidate);
  });
  const exposesSecret = /(?:lease|handoff)[-_ ]?token/i.test(value);
  if (exposesPath || exposesSecret) {
    throw makeErr(-32602, `${label} must not contain machine-local paths or lease tokens/handoff tokens`);
  }
}

function persistedOneLine(label: string, value: unknown, max = 240): string {
  const text = oneLine(value, max);
  assertPersistedTextSafe(label, text);
  return text;
}

function persistedStringList(label: string, value: unknown): string[] {
  const values = stringList(value);
  for (const item of values) assertPersistedTextSafe(label, item);
  return values;
}

function assertSecretNotEchoed(secret: string | undefined, fields: Array<[string, string | string[]]>): void {
  if (!secret) return;
  for (const [label, value] of fields) {
    const values = Array.isArray(value) ? value : [value];
    if (values.some((item) => item.includes(secret))) {
      throw makeErr(-32602, `${label} must not contain the handoff token`);
    }
  }
}

function assertAgentLifetimeTextSafe(state: AgentLifetimeState): void {
  assertPersistedTextSafe('role', state.role);
  assertPersistedTextSafe('host', state.host);
  assertPersistedTextSafe('objective', state.objective);
  assertPersistedTextSafe('issue', state.issue);
  for (const item of state.evidence) assertPersistedTextSafe('evidence', item);
  for (const item of state.provenance) assertPersistedTextSafe('provenance', item);
  for (const receipt of state.transitions) assertPersistedTextSafe('transition_token', receipt.token);
}

function mergeStringLists(...lists: string[][]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const item of list) {
      if (!item || seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

function parseStage(value: unknown): WorkflowStage {
  const stage = optionalString(value) as WorkflowStage;
  if (!STAGES.includes(stage)) {
    throw makeErr(-32602, `stage must be one of: ${STAGES.join(', ')}`);
  }
  return stage;
}

function parseCheckpointStatus(value: unknown): CheckpointStatus {
  const status = (optionalString(value) || 'note') as CheckpointStatus;
  if (!CHECKPOINT_STATUSES.includes(status)) {
    throw makeErr(-32602, `status must be one of: ${CHECKPOINT_STATUSES.join(', ')}`);
  }
  return status;
}

function parseAgentStage(value: unknown, fallback?: AgentStage): AgentStage {
  const stage = (optionalString(value) || fallback || 'think') as AgentStage;
  if (!AGENT_STAGES.includes(stage)) {
    throw makeErr(-32602, `stage must be one of: ${AGENT_STAGES.join(', ')}`);
  }
  return stage;
}

function parseAgentStatus(value: unknown, fallback: AgentStatus = 'active'): AgentStatus {
  const status = (optionalString(value) || fallback) as AgentStatus;
  if (!AGENT_STATUSES.includes(status)) {
    throw makeErr(-32602, `status must be one of: ${AGENT_STATUSES.join(', ')}`);
  }
  return status;
}

function projectId(project: string): string {
  return `project/${project}`;
}

function parseWorkRunId(value: unknown, fallbackProject?: string, fallbackAgent?: string): string {
  const id = optionalString(value);
  if (!id && fallbackProject && fallbackAgent) return `work-run/legacy-${fallbackProject}-${fallbackAgent}`;
  if (!/^work-run\/[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw makeErr(-32602, 'work_run_id must match work-run/<lowercase-kebab-id>');
  }
  return id;
}

function createWorkRunId(): string {
  return `work-run/${randomUUID()}`;
}

function parseWorkItemId(value: unknown, project: string, legacyIssue: unknown): string {
  const explicit = optionalString(value);
  if (explicit) {
    const prefix = `${projectId(project)}/issue/`;
    if (!explicit.startsWith(prefix) || !/^project\/[a-z0-9][a-z0-9-]*\/issue\/[a-z0-9][a-z0-9-]*$/.test(explicit)) {
      throw makeErr(-32602, `work_item_id must match ${prefix}<lowercase-kebab-slug>`);
    }
    return explicit;
  }
  const issue = slugify(optionalString(legacyIssue));
  return issue ? `${projectId(project)}/issue/${issue}` : '';
}

function parseWorkRunState(value: unknown, fallback: WorkRunState): WorkRunState {
  const state = (optionalString(value) || fallback) as WorkRunState;
  if (!WORK_RUN_STATES.includes(state)) {
    throw makeErr(-32602, `work_run_state must be one of: ${WORK_RUN_STATES.join(', ')}`);
  }
  return state;
}

function parseOutputClass(value: unknown, fallback: WorkRunOutputClass = 'view'): WorkRunOutputClass {
  const outputClass = (optionalString(value) || fallback) as WorkRunOutputClass;
  if (!WORK_RUN_OUTPUT_CLASSES.includes(outputClass)) {
    throw makeErr(-32602, `output_class must be one of: ${WORK_RUN_OUTPUT_CLASSES.join(', ')}`);
  }
  return outputClass;
}

function defaultApprovalStatus(outputClass: WorkRunOutputClass): WorkRunApprovalStatus {
  return outputClass === 'view' || outputClass === 'work-state-transition' ? 'not-required' : 'pending';
}

function parseApprovalStatus(
  value: unknown,
  outputClass: WorkRunOutputClass,
  fallback?: WorkRunApprovalStatus,
): WorkRunApprovalStatus {
  const approval = (optionalString(value) || fallback || defaultApprovalStatus(outputClass)) as WorkRunApprovalStatus;
  if (!WORK_RUN_APPROVAL_STATUSES.includes(approval)) {
    throw makeErr(-32602, `approval_status must be one of: ${WORK_RUN_APPROVAL_STATUSES.join(', ')}`);
  }
  if ((outputClass === 'view' || outputClass === 'work-state-transition') && approval !== 'not-required') {
    throw makeErr(-32602, `${outputClass} output must use approval_status=not-required`);
  }
  return approval;
}

function parseTransitionToken(value: unknown): string {
  const token = optionalString(value) || `legacy:${randomUUID()}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(token)) {
    throw makeErr(-32602, 'transition_token must be 1-128 safe identifier characters');
  }
  assertPersistedTextSafe('transition_token', token);
  return token;
}

function durableProvenance(value: unknown): string[] {
  return persistedStringList('provenance', value);
}

function isTerminalWorkRunState(state: WorkRunState): boolean {
  return WORK_RUN_TERMINAL_STATES.includes(state as (typeof WORK_RUN_TERMINAL_STATES)[number]);
}

export function isWorkRunTransitionAllowed(from: WorkRunState, to: WorkRunState): boolean {
  return WORK_RUN_TRANSITIONS[from].includes(to);
}

function assertWorkRunMutable(state: AgentLifetimeState): void {
  if (isTerminalWorkRunState(state.workRunState)) {
    throw makeErr(-32602, `Work Run ${state.workRunId} is terminal (${state.workRunState})`);
  }
}

function transitionWorkRun(current: WorkRunState, next: WorkRunState): WorkRunState {
  if (current === next) return current;
  if (!isWorkRunTransitionAllowed(current, next)) {
    throw makeErr(-32602, `invalid Work Run transition: ${current} -> ${next}`);
  }
  return next;
}

function completionState(outputClass: WorkRunOutputClass, approval: WorkRunApprovalStatus): WorkRunState {
  if (outputClass === 'external-side-effect' && approval !== 'approved') {
    return 'awaiting_review';
  }
  if (outputClass === 'knowledge-claim' && approval === 'pending') return 'awaiting_review';
  if (approval === 'denied') return 'failed';
  return 'completed';
}

function assertWorkRunIdentity(current: AgentLifetimeState, supplied: unknown): void {
  const id = optionalString(supplied);
  if (id && parseWorkRunId(id) !== current.workRunId) {
    throw makeErr(-32602, `work_run_id does not match joined Work Run ${current.workRunId}`);
  }
}

function findTransitionReceipt(
  state: AgentLifetimeState,
  token: string,
  operation: WorkRunTransitionReceipt['operation'],
): WorkRunTransitionReceipt | null {
  const receipt = state.transitions.find((item) => item.token === token);
  if (!receipt) return null;
  if (receipt.operation !== operation) {
    throw makeErr(-32602, `transition_token already used by ${receipt.operation}`);
  }
  return receipt;
}

function withTransitionReceipt(
  state: AgentLifetimeState,
  token: string,
  operation: WorkRunTransitionReceipt['operation'],
): AgentLifetimeState {
  return {
    ...state,
    transitions: [
      ...state.transitions,
      {
        token,
        operation,
        workRunState: state.workRunState,
        agentStage: state.stage,
        agentStatus: state.status,
        outputClass: state.outputClass,
        approvalStatus: state.approvalStatus,
        recordedAt: state.updatedAt,
      },
    ],
  };
}

function replayResult(state: AgentLifetimeState, receipt: WorkRunTransitionReceipt, eventsPath: string) {
  return {
    ok: true,
    idempotent: true,
    project: state.project,
    projectId: state.projectId,
    agent: state.agent,
    workRunId: state.workRunId,
    path: state.path,
    eventsPath,
    lifetime: {
      ...state,
      stage: receipt.agentStage,
      status: receipt.agentStatus,
      workRunState: receipt.workRunState,
      outputClass: receipt.outputClass,
      approvalStatus: receipt.approvalStatus,
      updatedAt: receipt.recordedAt,
    },
    receipt,
  };
}

function replayJoin(state: AgentLifetimeState, eventsPath: string) {
  const receipt = [...state.transitions].reverse().find((item) => item.operation === 'join');
  if (receipt) return replayResult(state, receipt, eventsPath);
  return {
    ok: true,
    idempotent: true,
    project: state.project,
    projectId: state.projectId,
    agent: state.agent,
    workRunId: state.workRunId,
    path: state.path,
    eventsPath,
    runPath: durableRunPath(state.project, state.workRunId),
    lifetime: state,
  };
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function isoNow(): string {
  return new Date().toISOString();
}

function renderState(state: WorkflowState, notes: string): string {
  const evidenceLines = state.evidence.length
    ? state.evidence.map((item) => `- ${item}`).join('\n')
    : '- none';

  return [
    '---',
    'type: workflow-state',
    `entity: project/${state.project}/workflow/state`,
    `project: ${state.project}`,
    `stage: ${state.stage}`,
    `objective: ${yamlString(state.objective)}`,
    `branch: ${yamlString(state.branch)}`,
    `host: ${yamlString(state.host)}`,
    `evidence: ${JSON.stringify(state.evidence)}`,
    `updated-by: ${state.updatedBy}`,
    `updated-at: ${yamlString(state.updatedAt)}`,
    '---',
    '',
    `# Workflow State: ${state.project}`,
    '',
    '## Objective',
    '',
    state.objective || 'No objective recorded.',
    '',
    '## Current Branch',
    '',
    state.branch || 'No branch recorded.',
    '',
    '## Evidence',
    '',
    evidenceLines,
    '',
    '## Notes',
    '',
    notes || 'No notes recorded.',
    '',
  ].join('\n');
}

function parseState(project: string, path: string, content: string): WorkflowState {
  const fm = parseFrontmatter(content);
  const rawEvidence = fm.evidence;
  const evidence = Array.isArray(rawEvidence) ? rawEvidence.filter((item): item is string => typeof item === 'string') : [];
  const stage = STAGES.includes(fm.stage as WorkflowStage) ? (fm.stage as WorkflowStage) : 'intake';

  return {
    project,
    stage,
    objective: typeof fm.objective === 'string' ? fm.objective : '',
    branch: typeof fm.branch === 'string' ? fm.branch : '',
    host: typeof fm.host === 'string' ? fm.host : '',
    evidence,
    updatedBy: typeof fm['updated-by'] === 'string' ? fm['updated-by'] : '',
    updatedAt: typeof fm['updated-at'] === 'string' ? fm['updated-at'] : '',
    path,
  };
}

function parseFrontmatter(content: string): Record<string, unknown> {
  if (!content.startsWith('---\n')) return {};
  const end = content.indexOf('\n---', 4);
  if (end === -1) return {};
  const fm: Record<string, unknown> = {};
  for (const line of content.slice(4, end).split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const raw = line.slice(idx + 1).trim();
    if (!key) continue;
    fm[key] = parseYamlScalar(raw);
  }
  return fm;
}

function parseYamlScalar(raw: string): unknown {
  if (!raw) return '';
  if ((raw.startsWith('"') && raw.endsWith('"')) || raw.startsWith('[')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.replace(/^"|"$/g, '');
    }
  }
  return raw;
}

function readState(vaultPath: string, project: string): WorkflowState | null {
  const path = statePath(project);
  const fullPath = vaultJoin(vaultPath, path);
  if (!existsSync(fullPath)) return null;
  return parseState(project, path, readFileSync(fullPath, 'utf-8'));
}

function checkpointHeader(project: string): string {
  return [
    '---',
    'type: workflow-checkpoints',
    `entity: project/${project}/workflow/checkpoints`,
    `project: ${project}`,
    '---',
    '',
    `# Workflow Checkpoints: ${project}`,
    '',
  ].join('\n');
}

function renderAgentLifetime(state: AgentLifetimeState, notes: string): string {
  const evidenceLines = state.evidence.length
    ? state.evidence.map((item) => `- ${item}`).join('\n')
    : '- none';

  return [
    '---',
    'type: agent-lifetime',
    `entity: project/${state.project}/agent/${state.agent}/lifetime`,
    `project-id: ${state.projectId}`,
    `project: ${state.project}`,
    `work-run-id: ${state.workRunId}`,
    `work-run-state: ${state.workRunState}`,
    `work-item-id: ${yamlString(state.workItemId)}`,
    `agent: ${state.agent}`,
    `role: ${yamlString(state.role)}`,
    `host: ${yamlString(state.host)}`,
    `stage: ${state.stage}`,
    `status: ${state.status}`,
    `objective: ${yamlString(state.objective)}`,
    `issue: ${yamlString(state.issue)}`,
    `evidence: ${JSON.stringify(state.evidence)}`,
    `provenance: ${JSON.stringify(state.provenance)}`,
    `output-class: ${state.outputClass}`,
    `approval-status: ${state.approvalStatus}`,
    `transitions: ${JSON.stringify(state.transitions)}`,
    `started-at: ${yamlString(state.startedAt)}`,
    `updated-at: ${yamlString(state.updatedAt)}`,
    '---',
    '',
    `# Agent Lifetime: ${state.agent}`,
    '',
    `- project: ${state.project}`,
    `- project-id: ${state.projectId}`,
    `- work-run-id: ${state.workRunId}`,
    `- work-run-state: ${state.workRunState}`,
    `- work-item-id: ${state.workItemId || 'none'}`,
    `- role: ${state.role || 'agent'}`,
    `- host: ${state.host || 'unknown'}`,
    `- stage: ${state.stage}`,
    `- status: ${state.status}`,
    `- issue: ${state.issue || 'none'}`,
    `- output-class: ${state.outputClass}`,
    `- approval-status: ${state.approvalStatus}`,
    '',
    '## Objective',
    '',
    state.objective || 'No objective recorded.',
    '',
    '## Evidence',
    '',
    evidenceLines,
    '',
    '## Notes',
    '',
    notes || 'No notes recorded.',
    '',
  ].join('\n');
}

function parseAgentLifetime(project: string, agent: string, path: string, content: string): AgentLifetimeState {
  const fm = parseFrontmatter(content);
  const rawEvidence = fm.evidence;
  const evidence = Array.isArray(rawEvidence) ? rawEvidence.filter((item): item is string => typeof item === 'string') : [];
  const stage = AGENT_STAGES.includes(fm.stage as AgentStage) ? (fm.stage as AgentStage) : 'think';
  const status = AGENT_STATUSES.includes(fm.status as AgentStatus) ? (fm.status as AgentStatus) : 'active';
  const workRunState = WORK_RUN_STATES.includes(fm['work-run-state'] as WorkRunState)
    ? (fm['work-run-state'] as WorkRunState)
    : status === 'done'
      ? 'completed'
      : status === 'archived'
        ? 'cancelled'
        : 'running';
  const outputClass = WORK_RUN_OUTPUT_CLASSES.includes(fm['output-class'] as WorkRunOutputClass)
    ? (fm['output-class'] as WorkRunOutputClass)
    : 'view';
  const approvalStatus = WORK_RUN_APPROVAL_STATUSES.includes(fm['approval-status'] as WorkRunApprovalStatus)
    ? (fm['approval-status'] as WorkRunApprovalStatus)
    : defaultApprovalStatus(outputClass);
  const rawProvenance = fm.provenance;
  const provenance = Array.isArray(rawProvenance)
    ? rawProvenance.filter((item): item is string => typeof item === 'string')
    : [];
  const rawTransitions = fm.transitions;
  const transitions = Array.isArray(rawTransitions)
    ? rawTransitions.filter((item): item is WorkRunTransitionReceipt => {
        if (typeof item !== 'object' || item === null) return false;
        const receipt = item as Partial<WorkRunTransitionReceipt>;
        return (
          typeof receipt.token === 'string' &&
          ['join', 'step', 'checkpoint', 'leave'].includes(String(receipt.operation)) &&
          WORK_RUN_STATES.includes(receipt.workRunState as WorkRunState)
        );
      })
    : [];
  const now = isoNow();

  return {
    projectId: typeof fm['project-id'] === 'string' ? fm['project-id'] : projectId(project),
    project,
    workRunId:
      typeof fm['work-run-id'] === 'string'
        ? parseWorkRunId(fm['work-run-id'])
        : parseWorkRunId(undefined, project, agent),
    workRunState,
    workItemId:
      typeof fm['work-item-id'] === 'string'
        ? fm['work-item-id']
        : parseWorkItemId(undefined, project, fm.issue),
    agent,
    role: typeof fm.role === 'string' ? fm.role : 'agent',
    host: typeof fm.host === 'string' ? fm.host : 'unknown',
    stage,
    status,
    objective: typeof fm.objective === 'string' ? fm.objective : '',
    issue: typeof fm.issue === 'string' ? fm.issue : '',
    evidence,
    provenance,
    outputClass,
    approvalStatus,
    transitions,
    startedAt: typeof fm['started-at'] === 'string' ? fm['started-at'] : now,
    updatedAt: typeof fm['updated-at'] === 'string' ? fm['updated-at'] : now,
    path,
  };
}

function readAgentLifetime(vaultPath: string, project: string, agent: string): AgentLifetimeState | null {
  const path = agentLifetimePath(project, agent);
  const fullPath = vaultJoin(vaultPath, path);
  if (!existsSync(fullPath)) return null;
  return parseAgentLifetime(project, agent, path, readFileSync(fullPath, 'utf-8'));
}

function agentEventsHeader(project: string, agent: string): string {
  return [
    '---',
    'type: agent-lifetime-events',
    `entity: project/${project}/agent/${agent}/events`,
    `project: ${project}`,
    `agent: ${agent}`,
    '---',
    '',
    `# Agent Lifetime Events: ${agent}`,
    '',
  ].join('\n');
}

function appendAgentEvent(
  vaultPath: string,
  state: AgentLifetimeState,
  event: {
    kind: string;
    summary: string;
    evidence?: string[];
    next?: string;
    actor: string;
    transitionToken: string;
  },
): string {
  const path = agentEventsPath(state.project, state.agent);
  const fullPath = vaultJoin(vaultPath, path);
  const evidence = event.evidence ?? [];
  const evidenceLines = evidence.length ? evidence.map((item) => `  - ${item}`).join('\n') : '  - none';
  const block = [
    existsSync(fullPath) ? '' : agentEventsHeader(state.project, state.agent),
    `## ${isoNow()} - ${event.kind} - ${event.actor}`,
    '',
    `- stage: ${state.stage}`,
    `- status: ${state.status}`,
    `- work-run-id: ${state.workRunId}`,
    `- work-run-state: ${state.workRunState}`,
    `- transition-token: ${event.transitionToken}`,
    `- output-class: ${state.outputClass}`,
    `- approval-status: ${state.approvalStatus}`,
    `- summary: ${event.summary}`,
    '- evidence:',
    evidenceLines,
    `- next: ${event.next || 'none'}`,
    '',
  ]
    .filter((part) => part !== '')
    .join('\n');

  appendVaultBytes(vaultPath, path, block);
  return path;
}

function canTransitionAgentStage(from: AgentStage, to: AgentStage): boolean {
  if (from === to) return true;
  if ((from === 'review' || from === 'test') && to === 'build') return true;
  return AGENT_STAGES.indexOf(to) === AGENT_STAGES.indexOf(from) + 1;
}

function evidenceMatchesRequirement(evidence: string[], requirement: string): boolean {
  const normalizedRequirement = requirement.toLowerCase();
  return evidence.some((item) => item.trim().toLowerCase().startsWith(normalizedRequirement));
}

function missingEvidenceForStage(stage: AgentStage, evidence: string[]): string[] {
  const requirements = AGENT_STAGE_EVIDENCE_REQUIREMENTS[stage] ?? [];
  return requirements.filter((requirement) => !evidenceMatchesRequirement(evidence, requirement));
}

function formatEvidenceRequirements(requirements: string[]): string {
  return requirements.map((requirement) => `${requirement}*`).join(', ');
}

function assertAgentStageEvidence(stage: AgentStage, evidence: string[]): void {
  const missing = missingEvidenceForStage(stage, evidence);
  if (missing.length > 0) {
    throw makeErr(-32602, `${stage} stage requires evidence matching: ${formatEvidenceRequirements(missing)}`);
  }
}

function assertAgentTransition(current: AgentLifetimeState, nextStage: AgentStage, nextEvidence: string[]): void {
  if (current.status === 'archived') {
    throw makeErr(-32602, `${current.agent} is archived; join again before changing stage`);
  }
  if (!canTransitionAgentStage(current.stage, nextStage)) {
    throw makeErr(-32602, `invalid agent stage transition: ${current.stage} -> ${nextStage}`);
  }
  assertAgentStageEvidence(nextStage, nextEvidence);
}

function workflowDoctor(vaultPath: string, project: string): Record<string, unknown> {
  const checks = [
    { name: 'project-anchor', path: projectNotePath(project), required: true },
    { name: 'issues-dir', path: issuesRoot(project), required: true },
    { name: 'workflow-state', path: statePath(project), required: true },
    { name: 'workflow-checkpoints', path: checkpointsPath(project), required: false },
    { name: 'source-registry', path: '_llmwiki/source-registry.json', required: false },
  ].map((check) => ({ ...check, ok: existsSync(vaultJoin(vaultPath, check.path)) }));

  const missing = checks.filter((check) => check.required && !check.ok).map((check) => check.path);
  const warnings = checks.filter((check) => !check.required && !check.ok).map((check) => check.path);

  return {
    ok: missing.length === 0,
    project,
    checks,
    missing,
    warnings,
  };
}

function agentDoctor(vaultPath: string, project: string, agent: string, expectedWorkRunId?: string): Record<string, unknown> {
  const lifetime = readAgentLifetime(vaultPath, project, agent);
  const lifetimePath = agentLifetimePath(project, agent);
  const eventsPath = agentEventsPath(project, agent);
  const checks = [
    { name: 'agent-lifetime', path: lifetimePath, required: true, ok: lifetime !== null },
    { name: 'agent-events', path: eventsPath, required: false, ok: existsSync(vaultJoin(vaultPath, eventsPath)) },
  ];
  const errors: string[] = [];
  const warnings: string[] = [];

  if (lifetime) {
    if (!AGENT_STAGES.includes(lifetime.stage)) errors.push(`invalid stage: ${lifetime.stage}`);
    if (!AGENT_STATUSES.includes(lifetime.status)) errors.push(`invalid status: ${lifetime.status}`);
    if (lifetime.projectId !== projectId(project)) errors.push(`project-id mismatch: ${lifetime.projectId}`);
    if (!WORK_RUN_STATES.includes(lifetime.workRunState)) errors.push(`invalid Work Run state: ${lifetime.workRunState}`);
    if (expectedWorkRunId && lifetime.workRunId !== expectedWorkRunId) {
      errors.push(`work-run-id mismatch: expected ${expectedWorkRunId}, found ${lifetime.workRunId}`);
    }
    if (isTerminalWorkRunState(lifetime.workRunState) && lifetime.status === 'active') {
      errors.push(`terminal Work Run ${lifetime.workRunState} cannot have active agent status`);
    }
    if (!isTerminalWorkRunState(lifetime.workRunState) && lifetime.status === 'archived') {
      errors.push(`non-terminal Work Run ${lifetime.workRunState} cannot have archived agent status`);
    }
    if (
      (lifetime.outputClass === 'knowledge-claim' || lifetime.outputClass === 'external-side-effect') &&
      lifetime.workRunState === 'completed' &&
      lifetime.approvalStatus !== 'approved'
    ) {
      errors.push(`${lifetime.outputClass} output completed without explicit approval`);
    }
    const tokens = lifetime.transitions.map((item) => item.token);
    if (new Set(tokens).size !== tokens.length) errors.push('duplicate transition token receipts');
    const missingEvidence = missingEvidenceForStage(lifetime.stage, lifetime.evidence);
    if (missingEvidence.length > 0) {
      errors.push(`${lifetime.stage} stage requires evidence matching: ${formatEvidenceRequirements(missingEvidence)}`);
    }
    if (lifetime.status === 'active' && lifetime.stage === 'reflect') warnings.push('reflect stage usually closes with status=done');
  }

  const missing = checks.filter((check) => check.required && !check.ok).map((check) => check.path);
  warnings.push(...checks.filter((check) => !check.required && !check.ok).map((check) => check.path));

  return {
    ok: missing.length === 0 && errors.length === 0,
    project,
    agent,
    checks,
    missing,
    errors,
    warnings,
    lifetime,
  };
}

function beginAgentLifetime(
  vaultPath: string,
  ctx: OperationContext,
  params: Record<string, unknown>,
  mode: 'leased' | 'manual',
) {
  const operation = mode === 'leased' ? 'workflow.agent.join' : 'workflow.agent.start';
  const actor = actorFromContext(ctx);
  const project = existingProjectKey(vaultPath, params.project, operation);
  const agent = agentKey(params.agent, actor);
  const transitionToken = parseTransitionToken(params.transition_token);

  let leasedIdentity: LeasedRunIdentity | null = null;
  let workRunId: string;
  let workItemId: string;
  if (mode === 'leased') {
    if (!optionalString(params.work_run_id) || !optionalString(params.work_item_id)) {
      throw makeErr(
        -32602,
        'workflow.agent.join requires a canonical Work Item, Work Run, and active lease identity',
      );
    }
    const requestedWorkRunId = parseWorkRunId(params.work_run_id);
    const requestedWorkItemId = canonicalWorkItemId(params.work_item_id);
    const leaseMode = parseLeaseMode(params.lease_mode);
    const requestedIdentity = {
      projectId: projectId(project),
      workItemId: requestedWorkItemId,
      workRunId: requestedWorkRunId,
      agentId: agent,
      leaseMode,
      handoffToken: leaseMode === 'portable-handoff' && typeof params.handoff_token === 'string'
        ? params.handoff_token
        : undefined,
    };
    assertWorkItemOwnership(requestedIdentity.projectId, requestedWorkItemId);
    const priorLifetime = readAgentLifetime(vaultPath, project, agent);
    const priorReceipt = priorLifetime
      ? findTransitionReceipt(priorLifetime, transitionToken, 'join')
      : undefined;
    if (priorLifetime && priorReceipt) {
      identityEquals('Project', requestedIdentity.projectId, priorLifetime.projectId);
      identityEquals('Work Item', requestedWorkItemId, priorLifetime.workItemId);
      identityEquals('Work Run', requestedWorkRunId, priorLifetime.workRunId);
      identityEquals('agent', agent, priorLifetime.agent);
      const durable = assertDurableRunIdentity(vaultPath, project, requestedIdentity);
      assertGovernedRunLocks(params, durable.record);
      assertJoinLeaseAuthority(vaultPath, requestedIdentity, durable.record);
      return replayResult(priorLifetime, priorReceipt, agentEventsPath(project, agent));
    }
    leasedIdentity = assertLeasedRunIdentity(vaultPath, project, agent, params);
    workRunId = leasedIdentity.workRunId;
    workItemId = leasedIdentity.workItemId;
  } else {
    if (
      optionalString(params.work_run_id)
      || optionalString(params.work_item_id)
      || optionalString(params.work_run_state)
      || optionalString(params.lease_mode)
      || optionalString(params.handoff_token)
      || GOVERNED_RUN_EXTENSION_KEYS.some((key) => params[key] !== undefined)
    ) {
      throw makeErr(-32602, 'workflow.agent.start creates manual runs and does not accept leased identity fields or governed assignment identity fields');
    }
    workRunId = createWorkRunId();
    workItemId = parseWorkItemId(undefined, project, params.issue);
  }

  const existing = readAgentLifetime(vaultPath, project, agent);
  if (existing) {
    const receipt = findTransitionReceipt(existing, transitionToken, 'join');
    identityEquals('Project', projectId(project), existing.projectId);
    identityEquals('agent', agent, existing.agent);
    if (leasedIdentity) {
      identityEquals('Work Run', workRunId, existing.workRunId);
      identityEquals('Work Item', workItemId, existing.workItemId);
      if (receipt) return replayResult(existing, receipt, agentEventsPath(project, agent));
      return replayJoin(existing, agentEventsPath(project, agent));
    }
    if (receipt) return replayResult(existing, receipt, agentEventsPath(project, agent));
    if (!isTerminalWorkRunState(existing.workRunState)) {
      throw conflict(`${agent} already joined Work Run ${existing.workRunId}`);
    }
  }

  const initialWorkRunState = leasedIdentity?.state ?? 'running';
  const suppliedState = optionalString(params.work_run_state);
  if (leasedIdentity && suppliedState && suppliedState !== initialWorkRunState) {
    throw conflict('Work Run state conflict', { expected: initialWorkRunState, actual: suppliedState });
  }
  if (initialWorkRunState !== 'leased' && initialWorkRunState !== 'running') {
    throw makeErr(-32602, 'workflow.agent.join can attach only a leased or already-running Work Run');
  }

  const now = isoNow();
  const path = agentLifetimePath(project, agent);
  const stage = parseAgentStage(params.stage, 'think');
  const evidence = persistedStringList('evidence', params.evidence);
  assertAgentStageEvidence(stage, evidence);
  const outputClass = parseOutputClass(params.output_class);
  const approvalStatus = parseApprovalStatus(params.approval_status, outputClass);
  let state: AgentLifetimeState = {
    projectId: leasedIdentity?.projectId ?? projectId(project),
    project,
    workRunId,
    workRunState: initialWorkRunState === 'leased' ? transitionWorkRun('leased', 'running') : 'running',
    workItemId,
    agent,
    role: persistedOneLine('role', params.role) || 'agent',
    host: persistedOneLine('host', params.host) || actor,
    stage,
    status: 'active',
    objective: persistedOneLine('objective', params.objective),
    issue: persistedOneLine('issue', params.issue),
    evidence,
    provenance: durableProvenance(params.provenance),
    outputClass,
    approvalStatus,
    transitions: [],
    startedAt: now,
    updatedAt: now,
    path,
  };
  state = withTransitionReceipt(state, transitionToken, 'join');
  assertAgentLifetimeTextSafe(state);
  const notes = persistedOneLine('notes', params.notes, 2_000);
  assertSecretNotEchoed(leasedIdentity?.handoffToken, [
    ['transition_token', transitionToken],
    ['role', state.role],
    ['host', state.host],
    ['objective', state.objective],
    ['issue', state.issue],
    ['evidence', state.evidence],
    ['provenance', state.provenance],
    ['notes', notes],
  ]);
  const lifetimeFullPath = vaultJoin(vaultPath, path);
  const expectedLifetimeBytes = existsSync(lifetimeFullPath) ? readFileSync(lifetimeFullPath, 'utf-8') : null;

  const { runPath, eventsPath } = withWorkRunLock(vaultPath, () => {
    const lockedLifetimeBytes = existsSync(lifetimeFullPath) ? readFileSync(lifetimeFullPath, 'utf-8') : null;
    if (lockedLifetimeBytes !== expectedLifetimeBytes) {
      throw conflict(`${agent} lifetime changed while joining Work Run ${workRunId}; retry the operation`);
    }
    return withFileRollback(vaultPath, [path, agentEventsPath(project, agent), durableRunPath(project, workRunId)], () => {
      const persistedRunPath = syncDurableWorkRunUnlocked(
        vaultPath,
        state,
        transitionToken,
        leasedIdentity ?? undefined,
      );
      writeVaultBytes(vaultPath, path, renderAgentLifetime(state, notes));
      const persistedEventsPath = appendAgentEvent(vaultPath, state, {
        kind: 'join',
        summary: state.objective || `${agent} joined`,
        evidence: state.evidence,
        actor,
        transitionToken,
      });
      return { runPath: persistedRunPath, eventsPath: persistedEventsPath };
    });
  });

  return {
    ok: true,
    idempotent: false,
    project,
    projectId: state.projectId,
    agent,
    workRunId,
    path,
    eventsPath,
    runPath,
    lifetime: state,
  };
}

export function makeWorkflowOps(vaultPath: string): Operation[] {
  return [
    {
  name: 'workflow.state.set',
      namespace: 'workflow' as Operation['namespace'],
      description:
        'Create or update the vault-first agent workflow state at 01-Projects/<project>/workflow/status.md.',
  mutating: true,
  writePolicy: {
    realWrite: 'always',
    targets: (ctx, params) => [`${workflowPolicyBasePath(ctx.config, params, 'workflow.state.set')}/status.md`],
    audit: 'required',
    effects: (_ctx, _params, result) => [touchMarkdown(resultPath(result), 'modify')],
  },
  params: {
        project: { type: 'string', required: true, description: 'Project key' },
        stage: {
          type: 'string',
          required: true,
          enum: [...STAGES],
          description: 'Workflow stage: intake|understand|plan|execute|review|verify|archive',
        },
        objective: { type: 'string', required: false, description: 'Current project objective' },
        branch: { type: 'string', required: false, description: 'Current execution branch or workstream' },
        host: { type: 'string', required: false, description: 'Agent host, e.g. codex or claude-code' },
        evidence: { type: 'array', required: false, description: 'Evidence refs such as test:, source:, commit:, or path:' },
        notes: { type: 'string', required: false, description: 'Short workflow notes' },
      },
      handler: async (ctx, params) => {
        const project = existingProjectKey(vaultPath, params.project, 'workflow.state.set');
        const stage = parseStage(params.stage);
        const actor = actorFromContext(ctx);
        const path = statePath(project);
        const state: WorkflowState = {
          project,
          stage,
          objective: persistedOneLine('objective', params.objective),
          branch: persistedOneLine('branch', params.branch),
          host: persistedOneLine('host', params.host) || actor,
          evidence: persistedStringList('evidence', params.evidence),
          updatedBy: actor,
          updatedAt: isoNow(),
          path,
        };

        writeVaultBytes(vaultPath, path, renderState(state, persistedOneLine('notes', params.notes, 2_000)));

        return {
          ok: true,
          project,
          path,
          state,
          projectInitialized: existsSync(vaultJoin(vaultPath, projectNotePath(project))),
        };
      },
    },
    {
      name: 'workflow.state.get',
      namespace: 'workflow' as Operation['namespace'],
      description: 'Read the current vault-first agent workflow state for a project.',
      mutating: false,
      params: {
        project: { type: 'string', required: true, description: 'Project key' },
      },
      handler: async (_ctx, params) => {
        const project = existingProjectKey(vaultPath, params.project, 'workflow.state.get');
        const path = statePath(project);
        const state = readState(vaultPath, project);
        return { exists: state !== null, project, path, state };
      },
    },
    {
  name: 'workflow.checkpoint.add',
      namespace: 'workflow' as Operation['namespace'],
      description:
        'Append an agent workflow checkpoint under 01-Projects/<project>/workflow/checkpoints.md.',
    mutating: true,
    writePolicy: {
      realWrite: 'always',
      targets: (ctx, params) => [`${workflowPolicyBasePath(ctx.config, params, 'workflow.checkpoint.add')}/checkpoints.md`],
      audit: 'required',
      effects: (_ctx, _params, result) => [touchMarkdown(resultPath(result), 'modify')],
    },
    params: {
        project: { type: 'string', required: true, description: 'Project key' },
        stage: {
          type: 'string',
          required: true,
          enum: [...STAGES],
          description: 'Workflow stage for this checkpoint',
        },
        summary: { type: 'string', required: true, description: 'Checkpoint summary' },
        status: {
          type: 'string',
          required: false,
          enum: [...CHECKPOINT_STATUSES],
          default: 'note',
          description: 'Checkpoint status: note|passed|failed|blocked',
        },
        evidence: { type: 'array', required: false, description: 'Evidence refs for this checkpoint' },
        next: { type: 'string', required: false, description: 'Next action or stop condition' },
      },
      handler: async (ctx, params) => {
        const project = existingProjectKey(vaultPath, params.project, 'workflow.checkpoint.add');
        const stage = parseStage(params.stage);
        const status = parseCheckpointStatus(params.status);
        const summary = persistedOneLine('summary', params.summary);
        if (!summary) throw makeErr(-32602, 'summary required');

        const actor = actorFromContext(ctx);
        const path = checkpointsPath(project);
        const fullPath = vaultJoin(vaultPath, path);
        const evidence = persistedStringList('evidence', params.evidence);
        const next = persistedOneLine('next', params.next);
        const now = isoNow();
        const evidenceLines = evidence.length ? evidence.map((item) => `  - ${item}`).join('\n') : '  - none';
        const block = [
          existsSync(fullPath) ? '' : checkpointHeader(project),
          `## ${now} - ${stage} - ${actor}`,
          '',
          `- status: ${status}`,
          `- summary: ${summary}`,
          '- evidence:',
          evidenceLines,
          `- next: ${next || 'none'}`,
          '',
        ]
          .filter((part) => part !== '')
          .join('\n');

        appendVaultBytes(vaultPath, path, block);

        return { ok: true, project, path, stage, status, actor, evidence };
      },
    },
    {
      name: 'workflow.agent.start',
      namespace: 'workflow' as Operation['namespace'],
      description: 'Create a restricted manual Work Run without accepting or impersonating Work Driver lease identity fields.',
      mutating: true,
      writePolicy: {
        realWrite: 'always',
        targets: workflowAgentTargets,
        audit: 'required',
        effects: workflowAgentEffects,
      },
      params: {
        project: { type: 'string', required: true, description: 'Project key' },
        agent: { type: 'string', required: false, description: 'Agent id; defaults collaboration actor' },
        role: { type: 'string', required: false, description: 'Agent role, e.g. manager|worker|reviewer|verifier' },
        host: { type: 'string', required: false, description: 'Agent host, e.g. codex or claude-code' },
        objective: { type: 'string', required: false, description: 'Lifetime objective' },
        issue: { type: 'string', required: false, description: 'Linked issue slug or entity' },
        transition_token: { type: 'string', required: false, description: 'Stable idempotency token for retrying manual creation' },
        output_class: { type: 'string', required: false, enum: [...WORK_RUN_OUTPUT_CLASSES] },
        approval_status: { type: 'string', required: false, enum: [...WORK_RUN_APPROVAL_STATUSES] },
        provenance: { type: 'array', required: false, description: 'Logical provenance refs; never local paths or secrets' },
        stage: {
          type: 'string',
          required: false,
          enum: [...AGENT_STAGES],
          default: 'think',
          description:
            'Initial lifetime stage: think|plan|build|review|test|ship|reflect. test requires review:* evidence; ship requires review:* and test:* evidence.',
        },
        evidence: {
          type: 'array',
          required: false,
          description: 'Initial evidence refs. Use prefixes such as review:* and test:* for stage gates.',
        },
        notes: { type: 'string', required: false, description: 'Manual start notes' },
      },
      handler: async (ctx, params) => beginAgentLifetime(vaultPath, ctx, params, 'manual'),
    },
    {
  name: 'workflow.agent.join',
      namespace: 'workflow' as Operation['namespace'],
      description: 'Assert and join an existing Work Driver lease without overwriting its durable identities.',
    mutating: true,
    writePolicy: {
      realWrite: 'always',
      targets: workflowAgentTargets,
      audit: 'required',
      effects: workflowAgentEffects,
    },
    params: {
        project: { type: 'string', required: true, description: 'Project key' },
        agent: { type: 'string', required: false, description: 'Agent id; defaults collaboration actor' },
        role: { type: 'string', required: false, description: 'Agent role, e.g. manager|worker|reviewer|verifier' },
        host: { type: 'string', required: false, description: 'Agent host, e.g. codex or claude-code' },
        objective: { type: 'string', required: false, description: 'Lifetime objective' },
        issue: { type: 'string', required: false, description: 'Linked issue slug or entity' },
        work_run_id: { type: 'string', required: true, description: 'Shared Work Run ID from the Work Driver lease' },
        work_run_state: {
          type: 'string',
          required: false,
          enum: [...WORK_RUN_STATES],
          description: 'Existing Work Run state; leased is expected when attaching a Work Driver lease',
        },
        work_item_id: { type: 'string', required: true, description: 'Canonical project/<slug>/issue/<slug> identity' },
        agent_profile_id: { type: 'string', required: false, description: 'Locked Agent Profile identity asserted against the durable Work Run' },
        agent_profile_revision: { type: 'number', required: false, description: 'Locked positive Agent Profile revision' },
        project_agent_binding_id: { type: 'string', required: false, description: 'Locked Project Agent Binding identity' },
        project_agent_binding_revision: { type: 'number', required: false, description: 'Locked positive Project Agent Binding revision' },
        assignment_plan_id: { type: 'string', required: false, description: 'Approved deterministic Assignment Plan identity' },
        assignment_plan_version: { type: 'number', required: false, description: 'Locked positive Assignment Plan version' },
        assignment_plan_fingerprint: { type: 'string', required: false, description: 'Locked SHA-256 Assignment Plan fingerprint' },
        context_envelope_fingerprint: { type: 'string', required: false, description: 'Locked SHA-256 Context Envelope fingerprint' },
        device_snapshot: { type: 'object', required: false, description: 'Locked portable Device Snapshot used by the Assignment Plan' },
        parent_work_run_id: { type: 'string', required: false, description: 'Exactly one parent Work Run identity for a delegated child' },
        lease_mode: {
          type: 'string',
          required: false,
          enum: [...LEASE_MODES],
          default: 'local',
          description:
            'local requires this device active lease. portable-handoff requires a valid expiring handoff token bound to the durable Work Run; any present local lease is still fully validated.',
        },
        handoff_token: {
          type: 'string',
          required: false,
          description: 'Sensitive secret required only for lease_mode=portable-handoff; never persisted or returned.',
        },
        transition_token: { type: 'string', required: false, description: 'Stable idempotency token from the Work Driver transition' },
        output_class: { type: 'string', required: false, enum: [...WORK_RUN_OUTPUT_CLASSES] },
        approval_status: { type: 'string', required: false, enum: [...WORK_RUN_APPROVAL_STATUSES] },
        provenance: { type: 'array', required: false, description: 'Logical provenance refs; never local paths or secrets' },
        stage: {
          type: 'string',
          required: false,
          enum: [...AGENT_STAGES],
          default: 'think',
          description:
            'Initial lifetime stage: think|plan|build|review|test|ship|reflect. test requires review:* evidence; ship requires review:* and test:* evidence.',
        },
        evidence: {
          type: 'array',
          required: false,
          description: 'Initial evidence refs. Use prefixes such as review:* and test:* for stage gates.',
        },
        notes: { type: 'string', required: false, description: 'Join notes' },
      },
      handler: async (ctx, params) => beginAgentLifetime(vaultPath, ctx, params, 'leased'),
    },
    {
  name: 'workflow.agent.step',
      namespace: 'workflow' as Operation['namespace'],
      description:
        'Advance a joined agent and its shared Work Run with idempotent transitions, review/test evidence gates, and terminal-state enforcement.',
    mutating: true,
    writePolicy: {
      realWrite: 'always',
      targets: workflowAgentTargets,
      audit: 'required',
      effects: workflowAgentEffects,
    },
    params: {
        project: { type: 'string', required: true, description: 'Project key' },
        agent: { type: 'string', required: false, description: 'Agent id; defaults collaboration actor' },
        stage: {
          type: 'string',
          required: true,
          enum: [...AGENT_STAGES],
          description: 'Next lifetime stage',
        },
        status: {
          type: 'string',
          required: false,
          enum: [...AGENT_STATUSES],
          description: 'Agent status: active|blocked|done|archived',
        },
        objective: { type: 'string', required: false, description: 'Replacement objective' },
        issue: { type: 'string', required: false, description: 'Replacement linked issue slug or entity' },
        work_run_id: { type: 'string', required: false, description: 'Joined Work Run ID; resolved from lifetime when omitted' },
        work_run_state: { type: 'string', required: false, enum: [...WORK_RUN_STATES] },
        work_item_id: { type: 'string', required: false, description: 'Replacement canonical Work Item identity' },
        transition_token: { type: 'string', required: false, description: 'Idempotency token; generated for legacy calls' },
        output_class: { type: 'string', required: false, enum: [...WORK_RUN_OUTPUT_CLASSES] },
        approval_status: { type: 'string', required: false, enum: [...WORK_RUN_APPROVAL_STATUSES] },
        provenance: { type: 'array', required: false },
        evidence: {
          type: 'array',
          required: false,
          description: 'Evidence refs to merge into lifetime. Use review:* before test and test:* before ship.',
        },
        summary: { type: 'string', required: false, description: 'Transition summary' },
        next: { type: 'string', required: false, description: 'Next action or stop condition' },
      },
      handler: async (ctx, params) => {
        const actor = actorFromContext(ctx);
        const project = existingProjectKey(vaultPath, params.project, 'workflow.agent.step');
        const agent = agentKey(params.agent, actor);
        return withWorkRunLock(vaultPath, () => {
          const current = readAgentLifetime(vaultPath, project, agent);
          if (!current) throw makeErr(-32001, `Agent lifetime not found: ${agent}`);
          assertWorkRunIdentity(current, params.work_run_id);
          assertDurableLifetimeIdentity(vaultPath, current);
          const transitionToken = parseTransitionToken(params.transition_token);
          const receipt = findTransitionReceipt(current, transitionToken, 'step');
          if (receipt) return replayResult(current, receipt, agentEventsPath(project, agent));
          assertWorkRunMutable(current);

          if (params.work_item_id !== undefined) {
            identityEquals('Work Item', current.workItemId, canonicalWorkItemId(params.work_item_id));
          }
          const stage = parseAgentStage(params.stage);
          const incomingEvidence = persistedStringList('evidence', params.evidence);
          const evidence = mergeStringLists(current.evidence, incomingEvidence);
          assertAgentTransition(current, stage, evidence);

          const outputClass = parseOutputClass(params.output_class, current.outputClass);
          const approvalStatus = parseApprovalStatus(
            params.approval_status,
            outputClass,
            outputClass === current.outputClass ? current.approvalStatus : undefined,
          );
          let nextWorkRunState = optionalString(params.work_run_state)
            ? parseWorkRunState(params.work_run_state, current.workRunState)
            : stage === 'reflect'
              ? completionState(outputClass, approvalStatus)
              : current.workRunState;
          if (nextWorkRunState === 'completed' && completionState(outputClass, approvalStatus) !== 'completed') {
            throw makeErr(-32602, `${outputClass} output requires approval before completion`);
          }
          nextWorkRunState = transitionWorkRun(current.workRunState, nextWorkRunState);
          const defaultAgentStatus: AgentStatus = nextWorkRunState === 'completed' || stage === 'reflect'
            ? 'done'
            : nextWorkRunState === 'failed' || nextWorkRunState === 'cancelled'
              ? 'archived'
              : current.status;
          const status = parseAgentStatus(params.status, defaultAgentStatus);
          if (isTerminalWorkRunState(nextWorkRunState) && (status === 'active' || status === 'blocked')) {
            throw makeErr(-32602, `terminal Work Run ${nextWorkRunState} cannot use agent status ${status}`);
          }
          if (!isTerminalWorkRunState(nextWorkRunState) && status === 'archived') {
            throw makeErr(-32602, `non-terminal Work Run ${nextWorkRunState} cannot use agent status archived`);
          }
          const summary = persistedOneLine('summary', params.summary);
          const next = persistedOneLine('next', params.next);
          let state: AgentLifetimeState = {
            ...current,
            stage,
            status,
            workRunState: nextWorkRunState,
            objective: params.objective === undefined ? current.objective : persistedOneLine('objective', params.objective),
            issue: params.issue === undefined ? current.issue : persistedOneLine('issue', params.issue),
            evidence,
            provenance: mergeStringLists(current.provenance, durableProvenance(params.provenance)),
            outputClass,
            approvalStatus,
            updatedAt: isoNow(),
          };
          state = withTransitionReceipt(state, transitionToken, 'step');
          assertAgentLifetimeTextSafe(state);

          const eventsPath = agentEventsPath(project, agent);
          const runPath = durableRunPath(project, state.workRunId);
          return withFileRollback(vaultPath, [state.path, eventsPath, runPath], () => {
            writeVaultBytes(vaultPath, state.path, renderAgentLifetime(state, summary));
            syncDurableWorkRunUnlocked(vaultPath, state, transitionToken);
            appendAgentEvent(vaultPath, state, {
              kind: 'step',
              summary: summary || `${current.stage} -> ${stage}`,
              evidence: incomingEvidence,
              next,
              actor,
              transitionToken,
            });
            return { ok: true, idempotent: false, project, projectId: state.projectId, agent, workRunId: state.workRunId, path: state.path, eventsPath, runPath, lifetime: state };
          });
        });
      },
    },
    {
  name: 'workflow.agent.checkpoint',
      namespace: 'workflow' as Operation['namespace'],
      description: 'Record an idempotent Work Run checkpoint, optionally routing output or moving to review/terminal state.',
    mutating: true,
    writePolicy: {
      realWrite: 'always',
      targets: workflowAgentTargets,
      audit: 'required',
      effects: workflowAgentEffects,
    },
    params: {
        project: { type: 'string', required: true, description: 'Project key' },
        agent: { type: 'string', required: false, description: 'Agent id; defaults collaboration actor' },
        status: {
          type: 'string',
          required: false,
          enum: [...CHECKPOINT_STATUSES],
          default: 'note',
          description: 'Checkpoint status: note|passed|failed|blocked',
        },
        summary: { type: 'string', required: true, description: 'Checkpoint summary' },
        evidence: { type: 'array', required: false, description: 'Evidence refs for this checkpoint' },
        next: { type: 'string', required: false, description: 'Next action or stop condition' },
        work_run_id: { type: 'string', required: false, description: 'Joined Work Run ID; resolved from lifetime when omitted' },
        work_run_state: { type: 'string', required: false, enum: [...WORK_RUN_STATES] },
        transition_token: { type: 'string', required: false, description: 'Idempotency token; generated for legacy calls' },
        output_class: { type: 'string', required: false, enum: [...WORK_RUN_OUTPUT_CLASSES] },
        approval_status: { type: 'string', required: false, enum: [...WORK_RUN_APPROVAL_STATUSES] },
        provenance: { type: 'array', required: false },
      },
      handler: async (ctx, params) => {
        const actor = actorFromContext(ctx);
        const project = existingProjectKey(vaultPath, params.project, 'workflow.agent.checkpoint');
        const agent = agentKey(params.agent, actor);
        return withWorkRunLock(vaultPath, () => {
          const current = readAgentLifetime(vaultPath, project, agent);
          if (!current) throw makeErr(-32001, `Agent lifetime not found: ${agent}`);
          assertWorkRunIdentity(current, params.work_run_id);
          assertDurableLifetimeIdentity(vaultPath, current);
          const transitionToken = parseTransitionToken(params.transition_token);
          const receipt = findTransitionReceipt(current, transitionToken, 'checkpoint');
          if (receipt) return replayResult(current, receipt, agentEventsPath(project, agent));
          assertWorkRunMutable(current);
          const status = parseCheckpointStatus(params.status);
          const summary = persistedOneLine('summary', params.summary);
          if (!summary) throw makeErr(-32602, 'summary required');

          const outputClass = parseOutputClass(params.output_class, current.outputClass);
          const approvalStatus = parseApprovalStatus(
            params.approval_status,
            outputClass,
            outputClass === current.outputClass ? current.approvalStatus : undefined,
          );
          let nextWorkRunState = optionalString(params.work_run_state)
            ? parseWorkRunState(params.work_run_state, current.workRunState)
            : status === 'failed'
              ? 'failed'
              : current.workRunState;
          if (nextWorkRunState === 'completed' && completionState(outputClass, approvalStatus) !== 'completed') {
            throw makeErr(-32602, `${outputClass} output requires approval before completion`);
          }
          nextWorkRunState = transitionWorkRun(current.workRunState, nextWorkRunState);
          const incomingEvidence = persistedStringList('evidence', params.evidence);
          const next = persistedOneLine('next', params.next);
          let state: AgentLifetimeState = {
            ...current,
            workRunState: nextWorkRunState,
            status:
              nextWorkRunState === 'completed'
                ? 'done'
                : nextWorkRunState === 'failed' || nextWorkRunState === 'cancelled'
                  ? 'archived'
                  : current.status,
            evidence: mergeStringLists(current.evidence, incomingEvidence),
            provenance: mergeStringLists(current.provenance, durableProvenance(params.provenance)),
            outputClass,
            approvalStatus,
            updatedAt: isoNow(),
          };
          state = withTransitionReceipt(state, transitionToken, 'checkpoint');
          assertAgentLifetimeTextSafe(state);
          const eventsPath = agentEventsPath(project, agent);
          const runPath = durableRunPath(project, state.workRunId);
          return withFileRollback(vaultPath, [state.path, eventsPath, runPath], () => {
            writeVaultBytes(vaultPath, state.path, renderAgentLifetime(state, summary));
            syncDurableWorkRunUnlocked(vaultPath, state, transitionToken);
            appendAgentEvent(vaultPath, state, {
              kind: `checkpoint:${status}`,
              summary,
              evidence: incomingEvidence,
              next,
              actor,
              transitionToken,
            });

            return {
              ok: true,
              idempotent: false,
              project,
              projectId: state.projectId,
              agent,
              workRunId: state.workRunId,
              path: state.path,
              eventsPath,
              runPath,
              stage: state.stage,
              status,
              workRunState: state.workRunState,
              lifetime: state,
            };
          });
        });
      },
    },
    {
  name: 'workflow.agent.leave',
      namespace: 'workflow' as Operation['namespace'],
      description: 'Leave a Work Run through awaiting-review or terminal state while preserving its durable lifetime and event log.',
    mutating: true,
    writePolicy: {
      realWrite: 'always',
      targets: workflowAgentTargets,
      audit: 'required',
      effects: workflowAgentEffects,
    },
    params: {
        project: { type: 'string', required: true, description: 'Project key' },
        agent: { type: 'string', required: false, description: 'Agent id; defaults collaboration actor' },
        summary: { type: 'string', required: false, description: 'Leave summary' },
        work_run_id: { type: 'string', required: false, description: 'Joined Work Run ID; resolved from lifetime when omitted' },
        work_run_state: {
          type: 'string',
          required: false,
          enum: ['awaiting_review', 'completed', 'failed', 'cancelled'],
          description: 'Final or review handoff state; defaults to cancelled for an unfinished run',
        },
        transition_token: { type: 'string', required: false, description: 'Idempotency token; generated for legacy calls' },
        output_class: { type: 'string', required: false, enum: [...WORK_RUN_OUTPUT_CLASSES] },
        approval_status: { type: 'string', required: false, enum: [...WORK_RUN_APPROVAL_STATUSES] },
        provenance: { type: 'array', required: false },
      },
      handler: async (ctx, params) => {
        const actor = actorFromContext(ctx);
        const project = existingProjectKey(vaultPath, params.project, 'workflow.agent.leave');
        const agent = agentKey(params.agent, actor);
        return withWorkRunLock(vaultPath, () => {
          const current = readAgentLifetime(vaultPath, project, agent);
          if (!current) throw makeErr(-32001, `Agent lifetime not found: ${agent}`);
          assertWorkRunIdentity(current, params.work_run_id);
          assertDurableLifetimeIdentity(vaultPath, current);
          const transitionToken = parseTransitionToken(params.transition_token);
          const receipt = findTransitionReceipt(current, transitionToken, 'leave');
          if (receipt) return replayResult(current, receipt, agentEventsPath(project, agent));
          assertWorkRunMutable(current);
          const outputClass = parseOutputClass(params.output_class, current.outputClass);
          const approvalStatus = parseApprovalStatus(
            params.approval_status,
            outputClass,
            outputClass === current.outputClass ? current.approvalStatus : undefined,
          );
          let nextWorkRunState = parseWorkRunState(params.work_run_state, 'cancelled');
          if (nextWorkRunState === 'completed' && completionState(outputClass, approvalStatus) !== 'completed') {
            throw makeErr(-32602, `${outputClass} output requires approval before completion`);
          }
          nextWorkRunState = transitionWorkRun(current.workRunState, nextWorkRunState);
          const summary = persistedOneLine('summary', params.summary);
          let state: AgentLifetimeState = {
            ...current,
            status: 'archived',
            workRunState: nextWorkRunState,
            provenance: mergeStringLists(current.provenance, durableProvenance(params.provenance)),
            outputClass,
            approvalStatus,
            updatedAt: isoNow(),
          };
          state = withTransitionReceipt(state, transitionToken, 'leave');
          assertAgentLifetimeTextSafe(state);
          const eventsPath = agentEventsPath(project, agent);
          const runPath = durableRunPath(project, state.workRunId);
          return withFileRollback(vaultPath, [state.path, eventsPath, runPath], () => {
            writeVaultBytes(vaultPath, state.path, renderAgentLifetime(state, summary));
            syncDurableWorkRunUnlocked(vaultPath, state, transitionToken);
            appendAgentEvent(vaultPath, state, {
              kind: 'leave',
              summary: summary || `${agent} archived`,
              actor,
              transitionToken,
            });
            return { ok: true, idempotent: false, project, projectId: state.projectId, agent, workRunId: state.workRunId, path: state.path, eventsPath, runPath, lifetime: state };
          });
        });
      },
    },
    {
      name: 'workflow.agent.doctor',
      namespace: 'workflow' as Operation['namespace'],
      description: 'Check one agent lifetime, Work Run identity, transition receipts, output policy, and event log for consistency.',
      mutating: false,
      params: {
        project: { type: 'string', required: true, description: 'Project key' },
        agent: { type: 'string', required: false, description: 'Agent id; defaults collaboration actor' },
        work_run_id: { type: 'string', required: false, description: 'Expected Work Run ID for cross-runtime join diagnosis' },
      },
      handler: async (ctx, params) => {
        const actor = actorFromContext(ctx);
        const project = existingProjectKey(vaultPath, params.project, 'workflow.agent.doctor');
        const agent = agentKey(params.agent, actor);
        const expectedWorkRunId = optionalString(params.work_run_id) ? parseWorkRunId(params.work_run_id) : undefined;
        return agentDoctor(vaultPath, project, agent, expectedWorkRunId);
      },
    },
    {
      name: 'workflow.doctor',
      namespace: 'workflow' as Operation['namespace'],
      description:
        'Check whether a project has the vault-first workflow files needed by Codex, Claude Code, and MCP tools.',
      mutating: false,
      params: {
        project: { type: 'string', required: true, description: 'Project key' },
      },
      handler: async (_ctx, params) => workflowDoctor(
        vaultPath,
        existingProjectKey(vaultPath, params.project, 'workflow.doctor'),
      ),
    },
  ];
}
