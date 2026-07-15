import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

import {
  AgentDomainService,
  ContextConsultStore,
  DelegationStore,
  DomainConflictError,
  DomainLockTimeoutError,
  DomainNotFoundError,
  DomainValidationError,
  DreamTimeStore,
  SimulatedInterruptionError,
  assertSafeSharedState,
  canonicalDigest,
  canonicalJson,
  compileContextEnvelope,
  createContextConsultRequest,
  createDelegationPlan,
  dreamTimeCadenceIdentity,
  dreamTimeSourceFingerprint,
  makeMemorySection,
  resolveDreamTimeCadenceWindow,
  runDreamTimeProposalWorker,
  validateMemoryProposal,
  type AgentProfileId,
  type ArtifactProjection,
  type CandidateDiff,
  type CapabilityGrant,
  type ChildWorkRun,
  type ChildWorkRunLifecycle,
  type ContextConsultRequest,
  type ContextConsultWorkerOutput,
  type DelegationPlanId,
  type DelegationPlan,
  type DreamTimeOperation,
  type DreamTimeCadence,
  type DreamTimeWorkerInput,
  type MemoryProposal,
  type MemoryProposalCandidate,
  type MemoryProposalId,
  type MemoryRevision,
  type MemoryRevisionId,
  type MemorySourceIdentities,
  type MemoryWarning,
  type ProjectAgentBindingId,
  type ProjectId,
  type ProvenanceRef,
  type JsonValue,
  type ThreadId,
  type ThreadLifecycle,
  type WorkRunId,
} from '../../../packages/agent-domain/dist/src/index.js';
import type { Operation, OperationContext } from '../core/types.js';
import { badRequest, conflict, internal, isOperationError, notFound } from '../core/types.js';
import { DeviceCapabilityRegistry } from '../fleet/device-capability.js';
import { HostCapabilityStore } from '../host-capabilities/store.js';
import { normalizedProjectContext, resolveProjectContext, type ProjectContext } from '../project/project-context.js';
import { createSettingsService } from '../settings/settings.js';
import { createUsageEvent, known, unknown, type UsageEventKind } from '../usage/contracts.js';
import { UsageLedger } from '../usage/ledger.js';
import { makeWorkflowOps } from '../workflow/workflow.js';

export const AGENT_DOMAIN_RELATIVE_ROOT = '_llmwiki/agent-domain/v1' as const;
export const USAGE_RELATIVE_ROOT = '_llmwiki/usage/v1' as const;

const AGENT_DOMAIN_WRITE_POLICY = {
  realWrite: 'always' as const,
  targets: () => [`${AGENT_DOMAIN_RELATIVE_ROOT}/**`],
  audit: 'required' as const,
};

const AGENT_DOMAIN_USAGE_WRITE_POLICY = {
  realWrite: 'always' as const,
  targets: () => [`${AGENT_DOMAIN_RELATIVE_ROOT}/**`, `${USAGE_RELATIVE_ROOT}/**`],
  audit: 'required' as const,
};

const APPROVER_ROLES = new Set(['human', 'approver', 'admin']);
const TERMINAL_WORK_RUN_STATES = new Set(['completed', 'failed', 'cancelled']);
const ACTIVE_CHILD_WORK_RUN_STATES = new Set<ChildWorkRunLifecycle>(['ready', 'running']);
const CADENCE_GOVERNANCE_ID = 'llmwiki/dreamtime-cadence/v1';

const PLATFORM_KERNEL = [{
  chunkId: 'governance/llmwiki-agent-runtime-v1',
  content: {
    product: 'llmwiki',
    rules: [
      'Use only server-loaded governed state.',
      'Treat approved memory as read-only context.',
      'Require explicit capability grants for side effects.',
    ],
  },
  provenance: [{ kind: 'governance' as const, id: 'llmwiki/agent-runtime', revision: 1 }],
  mandatory: true,
}] as const;

interface RoomDiagnostic {
  code: string;
  severity: 'info' | 'warning' | 'error';
  remediationKey: string;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw badRequest(`${field} must be a non-empty trimmed string`);
  }
  return value;
}

function requiredInteger(value: unknown, field: string, minimum = 0): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw badRequest(`${field} must be an integer >= ${minimum}`);
  }
  return value as number;
}

function requiredRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function requiredArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw badRequest(`${field} must be an array`);
  return value;
}

function optionalStringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw badRequest(`${field} must be an array`);
  const items = value.map((item, index) => requiredString(item, `${field}[${index}]`));
  if (new Set(items).size !== items.length) throw badRequest(`${field} must not contain duplicates`);
  return items;
}

function closedParams(params: Record<string, unknown>, allowed: readonly string[]): void {
  const names = new Set(allowed);
  for (const key of Object.keys(params)) {
    if (!names.has(key)) throw badRequest(`Unsupported Agent Domain parameter: ${key}`);
  }
}

function operationFailure(error: unknown): never {
  if (isOperationError(error)) throw error;
  if (error instanceof DomainValidationError || error instanceof TypeError) throw badRequest(error.message);
  if (error instanceof DomainNotFoundError) throw notFound(error.message);
  if (error instanceof DomainConflictError || error instanceof DomainLockTimeoutError) {
    throw conflict(error.message, error instanceof DomainConflictError ? error.details : undefined);
  }
  if (error instanceof SimulatedInterruptionError) throw conflict('Agent Domain commit was interrupted and must be replayed');
  throw internal('Agent Domain operation failed closed');
}

async function boundary<T>(action: () => T | Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    operationFailure(error);
  }
}

function exactProject(vaultPath: string, value: unknown, operation: string): ProjectContext {
  const projectRef = requiredString(value, 'project');
  const context = resolveProjectContext(vaultPath, projectRef, operation);
  if (projectRef !== context.projectId) {
    throw conflict('Agent Domain operations require the canonical Project ID', { projectId: context.projectId });
  }
  return context;
}

function projectFingerprint(context: ProjectContext): string {
  return canonicalDigest(normalizedProjectContext(context));
}

function actor(ctx: OperationContext, requested?: unknown, requireApprover = false): string {
  const authenticated = ctx.config.collaboration?.actor;
  const candidate = requested === undefined
    ? authenticated ?? process.env.VAULT_MIND_ACTOR ?? 'agent'
    : requiredString(requested, 'actor');
  if (authenticated && candidate !== authenticated) {
    throw conflict('Actor must match the authenticated collaboration actor');
  }
  if (requireApprover && (!authenticated || !APPROVER_ROLES.has(ctx.config.collaboration?.role ?? ''))) {
    throw conflict('This transition requires an authenticated human, approver, or admin actor');
  }
  return candidate;
}

function requireCommitted<T>(result: { status: 'committed'; record: T } | { status: 'conflict'; actualRevision: number }): T {
  if (result.status === 'conflict') throw conflict('Agent Domain optimistic revision conflict', { actualRevision: result.actualRevision });
  return result.record;
}

export interface GovernedUsageInput {
  kind: UsageEventKind;
  idempotencyKey: string;
  occurredAt: string;
  projectId: ProjectId;
  profileId?: AgentProfileId;
  threadId?: ThreadId;
  workRunId?: WorkRunId;
  provider?: string;
  model?: string;
  device?: string;
  operation: string;
  provenance: string[];
}

export function appendGovernedUsage(vaultPath: string, input: GovernedUsageInput) {
  const absent = unknown('unattributed');
  const notReported = unknown('not-reported');
  return new UsageLedger(join(vaultPath, ...USAGE_RELATIVE_ROOT.split('/'))).append(createUsageEvent({
    idempotencyKey: input.idempotencyKey,
    kind: input.kind,
    occurredAt: input.occurredAt,
    dimensions: {
      project: known(input.projectId),
      agent: input.profileId ? known(input.profileId) : absent,
      thread: input.threadId ? known(input.threadId) : absent,
      workRun: input.workRunId ? known(input.workRunId) : absent,
      provider: input.provider ? known(input.provider) : notReported,
      model: input.model ? known(input.model) : notReported,
      device: input.device ? known(input.device) : absent,
      operation: known(input.operation),
    },
    providerFacts: {
      inputTokens: notReported,
      outputTokens: notReported,
      providerReportedCost: notReported,
      currency: notReported,
    },
    provenance: input.provenance,
  }));
}

function workRunPath(vaultPath: string, project: ProjectContext, workRunId: WorkRunId): string {
  return join(vaultPath, '01-Projects', project.slug, 'runs', `${workRunId.slice('work-run/'.length)}.json`);
}

function readCanonicalWorkRun(vaultPath: string, project: ProjectContext, workRunId: WorkRunId): Record<string, unknown> {
  const path = workRunPath(vaultPath, project, workRunId);
  if (!existsSync(path)) throw notFound(`Canonical Work Run ${workRunId} does not exist`);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw conflict(`Canonical Work Run ${workRunId} is malformed`);
  }
  const record = requiredRecord(value, 'workRun');
  if (record.work_run_id !== workRunId || record.project_id !== project.projectId) {
    throw conflict('Canonical Work Run identity differs from the requested Project/Run');
  }
  return record;
}

function cadenceSettingKey(cadence: DreamTimeCadence): string {
  return `agents.dream_time.cadence.${cadence}.enabled`;
}

function cadenceWorkRun(
  vaultPath: string,
  project: ProjectContext,
  invocationId: string,
): Record<string, unknown> | null {
  const directory = join(vaultPath, '01-Projects', project.slug, 'runs');
  if (!existsSync(directory)) return null;
  const marker = `dreamtime-cadence:${invocationId}`;
  const matches: Record<string, unknown>[] = [];
  for (const file of readdirSync(directory).filter((candidate) => candidate.endsWith('.json')).sort()) {
    let record: Record<string, unknown>;
    try {
      record = requiredRecord(JSON.parse(readFileSync(join(directory, file), 'utf8')), 'workRun');
    } catch {
      continue;
    }
    if (record.project_id === project.projectId
      && Array.isArray(record.provenance)
      && record.provenance.includes(marker)) {
      matches.push(record);
    }
  }
  if (matches.length > 1) throw conflict('Dream Time cadence invocation is bound to multiple canonical Work Runs', { invocationId });
  return matches[0] ?? null;
}

function workflowOperation(vaultPath: string, name: string): Operation {
  const operation = makeWorkflowOps(vaultPath).find((candidate) => candidate.name === name);
  if (!operation) throw internal(`Required workflow operation ${name} is unavailable`);
  return operation;
}

function normalizeProvenance(value: unknown, field = 'provenance'): ProvenanceRef[] {
  const items = requiredArray(value, field).map((item, index) => requiredRecord(item, `${field}[${index}]`) as unknown as ProvenanceRef);
  const unique = new Map(items.map((item) => [canonicalJson(item), item]));
  return [...unique.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, item]) => item);
}

function cadenceClientProvenance(proposal: MemoryProposal, workRunId: WorkRunId): ProvenanceRef[] {
  return proposal.provenance.filter((reference) => !(
    (reference.kind === 'workRun' && reference.id === workRunId)
    || reference.kind === 'settings'
    || (reference.kind === 'governance' && reference.id === CADENCE_GOVERNANCE_ID)
  ));
}

function assertCadenceReplayBytes(
  proposal: MemoryProposal,
  workRunId: WorkRunId,
  sourceIdentities: MemorySourceIdentities,
  candidateDiff: CandidateDiff[],
  provenance: ProvenanceRef[],
  warnings: MemoryWarning[],
  expiresAt: string,
  requestedActor: string,
  cadenceRequestFingerprint: string,
): string {
  const workRunReference = proposal.provenance.find((reference) => reference.kind === 'workRun' && reference.id === workRunId);
  const cadenceReference = proposal.provenance.find((reference) => reference.kind === 'governance' && reference.id === CADENCE_GOVERNANCE_ID);
  if (!workRunReference?.fingerprint) throw conflict('Dream Time cadence proposal is missing its Context Envelope Work Run lock');
  if (cadenceReference?.fingerprint !== cadenceRequestFingerprint
    || proposal.createdBy !== requestedActor
    || proposal.expiresAt !== expiresAt
    || canonicalJson(proposal.sourceIdentities) !== canonicalJson(sourceIdentities)
    || canonicalJson(proposal.candidateDiff) !== canonicalJson(candidateDiff)
    || canonicalJson(cadenceClientProvenance(proposal, workRunId)) !== canonicalJson(provenance)
    || canonicalJson(proposal.warnings) !== canonicalJson(warnings)) {
    throw conflict('Dream Time cadence invocation was already used for different immutable proposal bytes');
  }
  return workRunReference.fingerprint;
}

async function moveCadenceWorkRunToReview(
  ctx: OperationContext,
  vaultPath: string,
  project: ProjectContext,
  identity: ReturnType<typeof dreamTimeCadenceIdentity>,
  workRunId: WorkRunId,
  proposalId: MemoryProposalId,
): Promise<void> {
  await workflowOperation(vaultPath, 'workflow.agent.step').handler(ctx, {
    project: project.projectId,
    agent: identity.agentId,
    stage: 'review',
    work_run_id: workRunId,
    work_run_state: 'awaiting_review',
    transition_token: `${identity.transitionToken}-proposal`,
    output_class: 'knowledge-claim',
    approval_status: 'pending',
    provenance: [`dreamtime-proposal:${proposalId}`],
    evidence: [`proposal:${proposalId}`],
    summary: 'Dream Time cadence produced an immutable proposal and is awaiting explicit review.',
    next: 'Approve or reject the exact Memory Proposal fingerprint.',
  });
}

function dreamTimeStore(stateRoot: string, projectId: ProjectId, profileId: AgentProfileId): DreamTimeStore {
  return new DreamTimeStore({ memoryRoot: join(stateRoot, 'dreamtime'), projectId, profileId });
}

function proposalDirectory(stateRoot: string, projectId: ProjectId, profileId: AgentProfileId): string {
  return join(
    stateRoot,
    'dreamtime',
    projectId.slice('project/'.length),
    profileId.slice('agent/'.length),
    'proposals',
  );
}

function delegationStore(stateRoot: string, projectId: ProjectId): DelegationStore {
  return new DelegationStore({ collaborationRoot: collaborationRoot(stateRoot), projectId });
}

async function activeServerGrant(
  stateRoot: string,
  service: AgentDomainService,
  project: ProjectContext,
  grantId: CapabilityGrant['grantId'],
): Promise<{ grant: CapabilityGrant; child: ChildWorkRun }> {
  const store = delegationStore(stateRoot, project.projectId as ProjectId);
  const grant = await store.readGrant(grantId);
  if (!grant) throw notFound(`Server-issued Capability Grant ${grantId} does not exist`);
  const child = await store.readChild(grant.workRunId);
  if (!child || !ACTIVE_CHILD_WORK_RUN_STATES.has(child.lifecycle)) {
    throw conflict('Capability Grant Work Run is not an active server-issued Child Work Run');
  }
  if (grant.projectId !== project.projectId
    || child.projectId !== project.projectId
    || child.workRunId !== grant.workRunId
    || child.assignment.profileId !== grant.profileId
    || child.assignment.profileRevision !== grant.profileRevision
    || canonicalJson(child.grantSummary) !== canonicalJson(grant)) {
    throw conflict('Capability Grant does not match its server-issued Work Run assignment');
  }
  const exactProfile = await service.profiles.readRevision(grant.profileId, grant.profileRevision);
  const currentProfile = await service.profiles.read(grant.profileId);
  const exactBinding = await service.bindings.readRevision(child.assignment.bindingId, child.assignment.bindingRevision);
  const currentBinding = await service.bindings.read(child.assignment.bindingId);
  if (!exactProfile || !currentProfile || currentProfile.revision !== grant.profileRevision
    || !exactBinding || !currentBinding || currentBinding.revision !== child.assignment.bindingRevision
    || !exactBinding.enabled || !currentBinding.enabled
    || exactBinding.projectId !== project.projectId
    || exactBinding.profileId !== grant.profileId
    || exactBinding.profileRevision !== grant.profileRevision) {
    throw conflict('Capability Grant requesting assignment is not the active Binding/Profile revision');
  }
  if (Date.parse(grant.expiresAt) <= Date.now()) throw conflict('Capability Grant expired');
  return { grant, child };
}

async function currentMemoryLock(store: DreamTimeStore): Promise<{
  revisionId: MemoryRevisionId | null;
  revision: number;
  fingerprint: string | null;
  revisionRecord: MemoryRevision | null;
}> {
  const revision = await store.readCurrentRevision();
  return {
    revisionId: revision?.revisionId ?? null,
    revision: revision?.revision ?? 0,
    fingerprint: revision?.fingerprint ?? null,
    revisionRecord: revision,
  };
}

function initialMemorySections() {
  return {
    recentContext: makeMemorySection(),
    openItems: makeMemorySection(),
    stableMemory: makeMemorySection(),
  };
}

function readProfileOperation(service: AgentDomainService): Operation {
  return {
    name: 'agent.profile.read', namespace: 'agent', description: 'Read the current immutable revision of one Agent Profile.', mutating: false,
    params: { profileId: { type: 'string', required: true } },
    handler: async (_ctx, params) => boundary(async () => {
      closedParams(params, ['profileId']);
      const profile = await service.profiles.read(requiredString(params.profileId, 'profileId') as AgentProfileId);
      if (!profile) throw notFound(`Agent Profile ${String(params.profileId)} does not exist`);
      return profile;
    }),
  };
}

function profileOperations(service: AgentDomainService): Operation[] {
  return [{
    name: 'agent.profile.create', namespace: 'agent', description: 'Create revision 1 of a vault-scoped Agent Profile.', mutating: true,
    writePolicy: AGENT_DOMAIN_WRITE_POLICY,
    params: { input: { type: 'object', required: true } },
    handler: async (ctx, params) => boundary(async () => {
      closedParams(params, ['input']);
      const input = requiredRecord(params.input, 'input');
      const authenticatedActor = actor(ctx, input.actor);
      return service.createProfile({ ...input, actor: authenticatedActor } as never);
    }),
  }, readProfileOperation(service), {
    name: 'agent.profile.list', namespace: 'agent', description: 'List current Agent Profile revisions deterministically.', mutating: false,
    params: { profileIds: { type: 'array', required: false } },
    handler: async (_ctx, params) => boundary(async () => {
      closedParams(params, ['profileIds']);
      return { profiles: await service.profiles.list(params.profileIds === undefined ? {} : { profileIds: params.profileIds as AgentProfileId[] }) };
    }),
  }, {
    name: 'agent.profile.update', namespace: 'agent', description: 'Create the next Agent Profile revision under an optimistic lock.', mutating: true,
    writePolicy: AGENT_DOMAIN_WRITE_POLICY,
    params: {
      profileId: { type: 'string', required: true }, expectedRevision: { type: 'number', required: true },
      patch: { type: 'object', required: true }, actor: { type: 'string', required: true },
    },
    handler: async (ctx, params) => boundary(async () => {
      closedParams(params, ['profileId', 'expectedRevision', 'patch', 'actor']);
      return service.updateProfile(
        requiredString(params.profileId, 'profileId') as AgentProfileId,
        requiredInteger(params.expectedRevision, 'expectedRevision', 1),
        requiredRecord(params.patch, 'patch'),
        actor(ctx, params.actor),
      );
    }),
  }];
}

function bindingOperations(vaultPath: string, service: AgentDomainService): Operation[] {
  return [{
    name: 'agent.binding.create', namespace: 'agent', description: 'Bind an exact Agent Profile revision to one canonical Project Context.', mutating: true,
    writePolicy: AGENT_DOMAIN_WRITE_POLICY,
    params: { input: { type: 'object', required: true } },
    handler: async (ctx, params) => boundary(async () => {
      closedParams(params, ['input']);
      const input = requiredRecord(params.input, 'input');
      const project = exactProject(vaultPath, input.projectId, 'agent.binding.create');
      if (input.projectContextFingerprint !== projectFingerprint(project)) throw conflict('Project Agent Binding context fingerprint is stale');
      return service.createBinding({ ...input, projectId: project.projectId, actor: actor(ctx, input.actor) } as never);
    }),
  }, {
    name: 'agent.binding.read', namespace: 'agent', description: 'Read the current immutable Project Agent Binding revision.', mutating: false,
    params: { bindingId: { type: 'string', required: true } },
    handler: async (_ctx, params) => boundary(async () => {
      closedParams(params, ['bindingId']);
      const binding = await service.bindings.read(requiredString(params.bindingId, 'bindingId') as ProjectAgentBindingId);
      if (!binding) throw notFound(`Project Agent Binding ${String(params.bindingId)} does not exist`);
      return binding;
    }),
  }, {
    name: 'agent.binding.list', namespace: 'agent', description: 'List current Project Agent Bindings for a canonical Project.', mutating: false,
    params: { project: { type: 'string', required: false }, profileId: { type: 'string', required: false }, enabled: { type: 'boolean', required: false } },
    handler: async (_ctx, params) => boundary(async () => {
      closedParams(params, ['project', 'profileId', 'enabled']);
      const projectId = params.project === undefined ? undefined : exactProject(vaultPath, params.project, 'agent.binding.list').projectId as ProjectId;
      return { bindings: await service.bindings.list({ projectId, profileId: params.profileId as AgentProfileId | undefined, enabled: params.enabled as boolean | undefined }) };
    }),
  }, {
    name: 'agent.binding.update', namespace: 'agent', description: 'Create the next Project Agent Binding revision under exact Project and optimistic locks.', mutating: true,
    writePolicy: AGENT_DOMAIN_WRITE_POLICY,
    params: { bindingId: { type: 'string', required: true }, expectedRevision: { type: 'number', required: true }, patch: { type: 'object', required: true }, actor: { type: 'string', required: true } },
    handler: async (ctx, params) => boundary(async () => {
      closedParams(params, ['bindingId', 'expectedRevision', 'patch', 'actor']);
      const bindingId = requiredString(params.bindingId, 'bindingId') as ProjectAgentBindingId;
      const current = await service.bindings.read(bindingId);
      if (!current) throw notFound(`Project Agent Binding ${bindingId} does not exist`);
      const project = exactProject(vaultPath, current.projectId, 'agent.binding.update');
      const patch = requiredRecord(params.patch, 'patch');
      if (patch.projectContextFingerprint !== undefined && patch.projectContextFingerprint !== projectFingerprint(project)) {
        throw conflict('Updated Project Agent Binding context fingerprint is stale');
      }
      return service.updateBinding(bindingId, requiredInteger(params.expectedRevision, 'expectedRevision', 1), patch, actor(ctx, params.actor));
    }),
  }];
}

function threadOperations(vaultPath: string, service: AgentDomainService): Operation[] {
  return [{
    name: 'agent.thread.create', namespace: 'agent', description: 'Open a durable Thread locked to exact Binding and Profile revisions.', mutating: true,
    writePolicy: AGENT_DOMAIN_WRITE_POLICY,
    params: { input: { type: 'object', required: true } },
    handler: async (ctx, params) => boundary(async () => {
      closedParams(params, ['input']);
      const input = requiredRecord(params.input, 'input');
      const project = exactProject(vaultPath, input.projectId, 'agent.thread.create');
      return service.createThread({ ...input, projectId: project.projectId, actor: actor(ctx, input.actor) } as never);
    }),
  }, {
    name: 'agent.thread.read', namespace: 'agent', description: 'Read the current immutable Thread revision.', mutating: false,
    params: { threadId: { type: 'string', required: true } },
    handler: async (_ctx, params) => boundary(async () => {
      closedParams(params, ['threadId']);
      const thread = await service.threads.read(requiredString(params.threadId, 'threadId') as ThreadId);
      if (!thread) throw notFound(`Thread ${String(params.threadId)} does not exist`);
      return thread;
    }),
  }, {
    name: 'agent.thread.list', namespace: 'agent', description: 'List current durable Threads by canonical identity.', mutating: false,
    params: { project: { type: 'string', required: false }, profileId: { type: 'string', required: false }, bindingId: { type: 'string', required: false }, lifecycle: { type: 'string', required: false, enum: ['open', 'closed', 'archived'] } },
    handler: async (_ctx, params) => boundary(async () => {
      closedParams(params, ['project', 'profileId', 'bindingId', 'lifecycle']);
      const projectId = params.project === undefined ? undefined : exactProject(vaultPath, params.project, 'agent.thread.list').projectId as ProjectId;
      return { threads: await service.threads.list({ projectId, profileId: params.profileId as AgentProfileId | undefined, bindingId: params.bindingId as ProjectAgentBindingId | undefined, lifecycle: params.lifecycle as ThreadLifecycle | undefined }) };
    }),
  }, {
    name: 'agent.thread.append', namespace: 'agent', description: 'Append one ordered message, artifact, or Work Run reference without promoting it to memory.', mutating: true,
    writePolicy: AGENT_DOMAIN_WRITE_POLICY,
    params: { threadId: { type: 'string', required: true }, expectedRevision: { type: 'number', required: true }, reference: { type: 'object', required: true }, actor: { type: 'string', required: true } },
    handler: async (ctx, params) => boundary(() => {
      closedParams(params, ['threadId', 'expectedRevision', 'reference', 'actor']);
      return service.appendThreadReference(requiredString(params.threadId, 'threadId') as ThreadId, requiredInteger(params.expectedRevision, 'expectedRevision', 1), requiredRecord(params.reference, 'reference') as never, actor(ctx, params.actor));
    }),
  }, {
    name: 'agent.thread.transition', namespace: 'agent', description: 'Transition one Thread through its explicit lifecycle under an optimistic lock.', mutating: true,
    writePolicy: AGENT_DOMAIN_WRITE_POLICY,
    params: { threadId: { type: 'string', required: true }, expectedRevision: { type: 'number', required: true }, lifecycle: { type: 'string', required: true, enum: ['open', 'closed', 'archived'] }, actor: { type: 'string', required: true } },
    handler: async (ctx, params) => boundary(() => {
      closedParams(params, ['threadId', 'expectedRevision', 'lifecycle', 'actor']);
      return service.transitionThread(requiredString(params.threadId, 'threadId') as ThreadId, requiredInteger(params.expectedRevision, 'expectedRevision', 1), requiredString(params.lifecycle, 'lifecycle') as ThreadLifecycle, actor(ctx, params.actor));
    }),
  }];
}

async function roomProjection(
  vaultPath: string,
  stateRoot: string,
  service: AgentDomainService,
  params: Record<string, unknown>,
) {
  const project = exactProject(vaultPath, params.project, 'agent.room.get');
  const profileId = requiredString(params.profileId, 'profileId') as AgentProfileId;
  const bindingId = `binding/${project.slug}/${profileId.slice('agent/'.length)}` as ProjectAgentBindingId;
  const currentBinding = await service.bindings.read(bindingId);

  const openThreads = await service.threads.list({ projectId: project.projectId as ProjectId, profileId, bindingId, lifecycle: 'open' });
  const requestedThreadId = params.threadId === undefined ? undefined : requiredString(params.threadId, 'threadId') as ThreadId;
  const thread = requestedThreadId
    ? await service.threads.read(requestedThreadId)
    : [...openThreads].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.threadId.localeCompare(right.threadId))[0];
  if (!thread) throw notFound('No active Thread exists for this Project Agent Binding');
  if (thread.projectId !== project.projectId || thread.profileId !== profileId || thread.bindingId !== bindingId || thread.lifecycle !== 'open') {
    throw conflict('Thread is not the active Thread for the requested Project Agent Binding');
  }

  const binding = await service.bindings.readRevision(bindingId, thread.bindingRevision);
  const profile = await service.profiles.readRevision(profileId, thread.profileRevision);
  if (binding && (binding.projectId !== project.projectId || binding.profileId !== profileId || binding.profileRevision !== thread.profileRevision)) {
    throw conflict('Thread Binding revision lock does not match its Project/Profile assignment');
  }

  const diagnostics: RoomDiagnostic[] = [];
  const expectedContextFingerprint = projectFingerprint(project);
  if (!profile) diagnostics.push({ code: 'profile-revision-missing', severity: 'error', remediationKey: 'restore-or-rebind-agent-profile' });
  if (!binding) diagnostics.push({ code: 'binding-revision-missing', severity: 'error', remediationKey: 'restore-or-recreate-thread-binding' });
  if (binding && !binding.enabled) diagnostics.push({ code: 'binding-disabled', severity: 'error', remediationKey: 'enable-project-agent-binding' });
  if (binding && binding.projectContextFingerprint !== expectedContextFingerprint) {
    diagnostics.push({ code: 'project-context-fingerprint-stale', severity: 'error', remediationKey: 'refresh-project-agent-binding' });
  }
  if (currentBinding && currentBinding.revision !== thread.bindingRevision) {
    diagnostics.push({ code: 'binding-revision-superseded', severity: 'warning', remediationKey: 'resume-or-rebind-thread-to-current-binding' });
  }
  if (openThreads.length > 1 && !requestedThreadId) {
    diagnostics.push({ code: 'multiple-active-threads', severity: 'warning', remediationKey: 'select-thread-id' });
  }

  const relatedWorkRunIds = [...new Set(thread.references
    .filter((reference) => reference.kind === 'workRun')
    .map((reference) => reference.referenceId as WorkRunId))];
  for (const workRunId of relatedWorkRunIds) {
    try {
      const run = readCanonicalWorkRun(vaultPath, project, workRunId);
      if (!TERMINAL_WORK_RUN_STATES.has(String(run.state ?? run.work_run_state))) {
        diagnostics.push({ code: 'work-run-unresolved', severity: 'warning', remediationKey: `inspect-work-run:${workRunId}` });
      }
    } catch (error) {
      if (isOperationError(error) && error.code === -32004) {
        diagnostics.push({ code: 'work-run-missing', severity: 'error', remediationKey: `inspect-work-run:${workRunId}` });
      } else throw error;
    }
  }

  const memory = await dreamTimeStore(stateRoot, project.projectId as ProjectId, profileId).readCurrentRevision();
  const connectorGrantRefs = binding?.connectorGrantRefs ?? [];
  const connectorSummaries = new HostCapabilityStore(vaultPath).listConnectors()
    .filter((registration) => connectorGrantRefs.some((grantRef) => grantRef.slice('grant/'.length) === registration.connector.connectorId.slice('connector/'.length)))
    .map((registration) => ({
      connectorId: registration.connector.connectorId,
      status: registration.health.state,
      grantRef: connectorGrantRefs.find((grantRef) => grantRef.slice('grant/'.length) === registration.connector.connectorId.slice('connector/'.length)),
      remediationKey: registration.health.remediationKeys[0],
    }));
  if (connectorGrantRefs.length > 0 && connectorSummaries.length === 0) {
    diagnostics.push({ code: 'permitted-connectors-unavailable', severity: 'warning', remediationKey: 'inspect-host-capability-grants' });
  }

  return {
    schemaVersion: 1,
    identity: {
      schemaVersion: 1,
      projectId: project.projectId,
      profileId,
      profileRevision: thread.profileRevision,
      bindingId,
      bindingRevision: thread.bindingRevision,
      threadId: thread.threadId,
      threadRevision: thread.revision,
    },
    readOnly: true,
    state: diagnostics.some((diagnostic) => diagnostic.severity === 'error') ? 'degraded' : 'healthy',
    lifecycle: thread.lifecycle,
    relatedWorkRunIds,
    approvedMemory: memory ? { revisionId: memory.revisionId, revision: memory.revision, fingerprint: memory.fingerprint } : null,
    connectorSummaries,
    diagnostics,
  };
}

function roomAndContextOperations(vaultPath: string, stateRoot: string, service: AgentDomainService): Operation[] {
  return [{
    name: 'agent.room.get', namespace: 'agent', description: 'Derive one read-only Room from Project Context, Agent Profile/Binding, and an active Thread.', mutating: false,
    params: { project: { type: 'string', required: true }, profileId: { type: 'string', required: true }, threadId: { type: 'string', required: false } },
    handler: async (_ctx, params) => boundary(async () => {
      closedParams(params, ['project', 'profileId', 'threadId']);
      return roomProjection(vaultPath, stateRoot, service, params);
    }),
  }, {
    name: 'agent.context.compile', namespace: 'agent', description: 'Compile a four-layer Context Envelope locked to current canonical Project, Profile, Binding, and approved Memory bytes.', mutating: false,
    params: {
      project: { type: 'string', required: true }, envelopeId: { type: 'string', required: true }, compiledAt: { type: 'string', required: true }, tokenBudget: { type: 'number', required: true },
      profileId: { type: 'string', required: true }, expectedProfileRevision: { type: 'number', required: true },
      bindingId: { type: 'string', required: true }, expectedBindingRevision: { type: 'number', required: true },
      memoryRevisionId: { type: 'string', required: true }, expectedMemoryRevision: { type: 'number', required: true }, expectedMemoryFingerprint: { type: 'string', required: true },
      threadId: { type: 'string', required: false }, expectedThreadRevision: { type: 'number', required: false },
      deviceId: { type: 'string', required: false }, expectedDeviceRevision: { type: 'number', required: false }, expectedDeviceFingerprint: { type: 'string', required: false },
      capabilityGrantIds: { type: 'array', required: false }, expectedFingerprint: { type: 'string', required: false }, explicitNewAttempt: { type: 'boolean', required: false, default: false },
      input: { type: 'unknown', required: false }, platformKernel: { type: 'unknown', required: false }, runtime: { type: 'unknown', required: false },
      deviceCapabilities: { type: 'unknown', required: false }, capabilityGrants: { type: 'unknown', required: false }, modelLock: { type: 'unknown', required: false },
      profile: { type: 'unknown', required: false }, binding: { type: 'unknown', required: false }, memoryRevision: { type: 'unknown', required: false },
    },
    handler: async (_ctx, params) => boundary(async () => {
      closedParams(params, [
        'project', 'envelopeId', 'compiledAt', 'tokenBudget', 'profileId', 'expectedProfileRevision', 'bindingId', 'expectedBindingRevision',
        'memoryRevisionId', 'expectedMemoryRevision', 'expectedMemoryFingerprint', 'threadId', 'expectedThreadRevision', 'deviceId',
        'expectedDeviceRevision', 'expectedDeviceFingerprint', 'capabilityGrantIds', 'expectedFingerprint', 'explicitNewAttempt',
      ]);
      const project = exactProject(vaultPath, params.project, 'agent.context.compile');
      const profileId = requiredString(params.profileId, 'profileId') as AgentProfileId;
      const profileRevision = requiredInteger(params.expectedProfileRevision, 'expectedProfileRevision', 1);
      const bindingId = requiredString(params.bindingId, 'bindingId') as ProjectAgentBindingId;
      const bindingRevision = requiredInteger(params.expectedBindingRevision, 'expectedBindingRevision', 1);
      const storedProfile = await service.profiles.readRevision(profileId, profileRevision);
      const storedBinding = await service.bindings.readRevision(bindingId, bindingRevision);
      const currentProfile = await service.profiles.read(profileId);
      const currentBinding = await service.bindings.read(bindingId);
      if (!storedProfile || !currentProfile || currentProfile.revision !== profileRevision) throw conflict('Context Envelope Profile reference is not the active stored revision');
      if (!storedBinding || !currentBinding || currentBinding.revision !== bindingRevision) throw conflict('Context Envelope Binding reference is not the active stored revision');
      if (!storedBinding.enabled || storedBinding.projectId !== project.projectId || storedBinding.profileId !== profileId || storedBinding.profileRevision !== profileRevision) {
        throw conflict('Context Envelope Binding does not lock the active Project/Profile revision');
      }
      const canonicalProjectContext = normalizedProjectContext(project);
      const canonicalProjectFingerprint = canonicalDigest(canonicalProjectContext);
      if (storedBinding.projectContextFingerprint !== canonicalProjectFingerprint) throw conflict('Context Envelope Binding uses a stale Project Context fingerprint');

      const memoryRevisionId = requiredString(params.memoryRevisionId, 'memoryRevisionId') as MemoryRevisionId;
      const memoryRevision = requiredInteger(params.expectedMemoryRevision, 'expectedMemoryRevision', 1);
      const memoryFingerprint = requiredString(params.expectedMemoryFingerprint, 'expectedMemoryFingerprint');
      const memoryStore = dreamTimeStore(stateRoot, project.projectId as ProjectId, profileId);
      const lockedMemory = await memoryStore.readRevision(memoryRevisionId);
      const current = await memoryStore.readCurrentRevision();
      if (!lockedMemory || !current || current.revisionId !== memoryRevisionId || current.revision !== memoryRevision
        || current.fingerprint !== memoryFingerprint || canonicalJson(current) !== canonicalJson(lockedMemory)) {
        throw conflict('Context Envelope memory reference is not the current approved revision');
      }

      const threadWindow = [] as Array<{
        chunkId: string; content: JsonValue; provenance: Array<{ kind: 'thread'; id: string; revision: number }>;
      }>;
      if (params.threadId !== undefined || params.expectedThreadRevision !== undefined) {
        if (params.threadId === undefined || params.expectedThreadRevision === undefined) throw badRequest('threadId and expectedThreadRevision must be provided together');
        const threadId = requiredString(params.threadId, 'threadId') as ThreadId;
        const expectedThreadRevision = requiredInteger(params.expectedThreadRevision, 'expectedThreadRevision', 1);
        const thread = await service.threads.read(threadId);
        if (!thread || thread.revision !== expectedThreadRevision || thread.lifecycle !== 'open'
          || thread.projectId !== project.projectId || thread.profileId !== profileId || thread.profileRevision !== profileRevision
          || thread.bindingId !== bindingId || thread.bindingRevision !== bindingRevision) {
          throw conflict('Context Envelope Thread reference is not the active exact Project/Profile/Binding revision');
        }
        threadWindow.push({
          chunkId: thread.threadId,
          content: {
            threadId: thread.threadId,
            lifecycle: thread.lifecycle,
            title: thread.title,
            references: thread.references as unknown as JsonValue,
          },
          provenance: [{ kind: 'thread', id: thread.threadId, revision: thread.revision }],
        });
      }

      const deviceCapabilities = [] as Array<{
        chunkId: string; content: JsonValue; provenance: Array<{ kind: 'deviceCapability'; id: string; revision: number; fingerprint: string }>;
      }>;
      if (params.deviceId !== undefined || params.expectedDeviceRevision !== undefined || params.expectedDeviceFingerprint !== undefined) {
        if (params.deviceId === undefined || params.expectedDeviceRevision === undefined || params.expectedDeviceFingerprint === undefined) {
          throw badRequest('deviceId, expectedDeviceRevision, and expectedDeviceFingerprint must be provided together');
        }
        const deviceId = requiredString(params.deviceId, 'deviceId');
        const expectedDeviceRevision = requiredInteger(params.expectedDeviceRevision, 'expectedDeviceRevision', 1);
        const expectedDeviceFingerprint = requiredString(params.expectedDeviceFingerprint, 'expectedDeviceFingerprint');
        const device = new DeviceCapabilityRegistry(vaultPath).get(deviceId);
        if (!device || device.revision !== expectedDeviceRevision || device.fingerprint !== expectedDeviceFingerprint
          || device.health.status === 'unavailable' || Date.parse(device.expiresAt) <= Date.now()) {
          throw conflict('Context Envelope Device Capability reference is not an active stored revision');
        }
        deviceCapabilities.push({
          chunkId: device.deviceId,
          content: device as unknown as JsonValue,
          provenance: [{ kind: 'deviceCapability', id: device.deviceId, revision: device.revision, fingerprint: device.fingerprint }],
        });
      }

      const capabilityGrants = [] as Array<{
        chunkId: string; content: JsonValue; provenance: Array<{ kind: 'grant'; id: string; fingerprint: string }>;
      }>;
      for (const grantId of optionalStringArray(params.capabilityGrantIds, 'capabilityGrantIds')) {
        const { grant } = await activeServerGrant(stateRoot, service, project, grantId as CapabilityGrant['grantId']);
        if (grant.profileId !== profileId || grant.profileRevision !== profileRevision) {
          throw conflict('Context Envelope Capability Grant belongs to another active Profile assignment');
        }
        capabilityGrants.push({
          chunkId: grant.grantId,
          content: grant as unknown as JsonValue,
          provenance: [{ kind: 'grant', id: grant.grantId, fingerprint: grant.fingerprint }],
        });
      }

      const compiledAt = requiredString(params.compiledAt, 'compiledAt');
      const settingsService = createSettingsService({
        vaultPath,
        workspaceProjectId: project.projectId,
        sessionId: 'agent-context-compile',
        clock: () => compiledAt,
      });
      const { snapshot: settingsSnapshot } = await settingsService.snapshotResolve();
      const settingsFingerprint = canonicalDigest(settingsSnapshot);
      const settingsModel = await settingsService.agentModelInvocationProfile();
      const publicSettingKeys = new Set(settingsService.registry.definitions
        .filter((definition) => definition.sensitivity === 'public')
        .map((definition) => definition.key));
      const settingsProjection = {
        snapshotId: settingsSnapshot.snapshotId,
        registryVersion: settingsSnapshot.registryVersion,
        sourceRevisions: settingsSnapshot.sourceRevisions,
        effective: settingsSnapshot.effective
          .filter((item) => publicSettingKeys.has(item.key))
          .map((item) => ({ key: item.key, value: item.value, winningScope: item.winningScope, applyMode: item.applyMode })),
      };
      const profileModel = storedProfile.defaultModelPolicy;
      const modelLock = {
        provider: profileModel.mode === 'inherit' ? settingsModel.provider || 'inherit' : profileModel.provider!,
        model: profileModel.mode === 'inherit' ? settingsModel.model || 'inherit' : profileModel.model!,
        contextWindow: 32_768,
        tokenizer: 'utf8-bytes-div4/v1',
        policyFingerprint: canonicalDigest({ profileModel, settingsFingerprint }),
      };
      const envelope = compileContextEnvelope({
        envelopeId: requiredString(params.envelopeId, 'envelopeId'),
        compiledAt,
        modelLock,
        tokenBudget: requiredInteger(params.tokenBudget, 'tokenBudget', 1),
        platformKernel: PLATFORM_KERNEL as never,
        profile: storedProfile,
        binding: storedBinding,
        memoryRevision: lockedMemory,
        memoryRevisionLock: { revisionId: memoryRevisionId, revision: memoryRevision, fingerprint: memoryFingerprint },
        runtime: {
          projectContext: {
            chunkId: `project-context/${project.slug}`,
            content: canonicalProjectContext as unknown as JsonValue,
            provenance: [{ kind: 'project', id: project.projectId, fingerprint: canonicalProjectFingerprint }],
            mandatory: true,
          },
          threadWindow,
          settingsSnapshot: {
            chunkId: settingsSnapshot.snapshotId,
            content: settingsProjection as unknown as JsonValue,
            provenance: [{ kind: 'settings', id: settingsSnapshot.snapshotId, fingerprint: settingsFingerprint }],
            mandatory: true,
          },
          deviceCapabilities,
          capabilityGrants,
        },
      });
      if (params.expectedFingerprint !== undefined && params.expectedFingerprint !== envelope.fingerprint && params.explicitNewAttempt !== true) {
        throw conflict('Context Envelope fingerprint drift requires an explicit new execution attempt', { expectedFingerprint: params.expectedFingerprint, actualFingerprint: envelope.fingerprint });
      }
      return envelope;
    }),
  }];
}

function validateProposalSource(
  vaultPath: string,
  project: ProjectContext,
  service: AgentDomainService,
  store: DreamTimeStore,
  operation: DreamTimeOperation,
  input: DreamTimeWorkerInput,
  candidate: MemoryProposalCandidate,
): Promise<void> {
  return boundary(async () => {
    if (input.operation !== operation || candidate.operation !== operation) throw conflict('Dream Time operation changed across the proposal boundary');
    if (input.projectId !== project.projectId || candidate.projectId !== project.projectId || input.profileId !== candidate.profileId) {
      throw conflict('Dream Time proposal is outside the exact Project/Profile scope');
    }
    const cutoff = Date.parse(input.sourceIdentities.cutoffAt);
    if (!Number.isFinite(cutoff) || new Date(cutoff).toISOString() !== input.sourceIdentities.cutoffAt) {
      throw badRequest('sourceIdentities.cutoffAt must be a canonical UTC RFC3339 timestamp');
    }
    const sourceRevisions: MemoryRevision[] = [];
    for (const revisionId of input.sourceIdentities.revisionIds) {
      const revision = await store.readRevision(revisionId);
      if (!revision || revision.lifecycle !== 'approved' || revision.projectId !== project.projectId || revision.profileId !== input.profileId) {
        throw conflict(`Source revision ${revisionId} is not an approved revision for the exact Project/Profile`);
      }
      sourceRevisions.push(revision);
    }
    if (operation === 'checkpoint') {
      const hasThread = input.sourceIdentities.threadId !== undefined;
      const hasRun = input.sourceIdentities.workRunId !== undefined;
      if (hasThread === hasRun) throw badRequest('Checkpoint requires exactly one canonical Thread or Work Run source');
      if (hasThread) {
        const thread = await service.threads.read(input.sourceIdentities.threadId!);
        if (!thread || thread.projectId !== project.projectId || thread.profileId !== input.profileId) throw conflict('Checkpoint Thread is not the exact Project/Profile source');
        const eligibleArtifactIds = new Set(thread.references
          .filter((reference) => reference.kind === 'artifact' && Date.parse(reference.recordedAt) <= cutoff)
          .map((reference) => reference.referenceId));
        for (const artifactId of input.sourceIdentities.artifactIds) {
          if (!eligibleArtifactIds.has(artifactId)) {
            throw conflict(`Checkpoint artifact ${artifactId} is not a canonical Thread reference at or before the source cutoff`);
          }
        }
      } else {
        const run = readCanonicalWorkRun(vaultPath, project, input.sourceIdentities.workRunId!);
        const eligibleArtifactIds = new Set((Array.isArray(run.artifact_projections) ? run.artifact_projections : [])
          .flatMap((item) => item && typeof item === 'object' && !Array.isArray(item)
            ? [String((item as Record<string, unknown>).artifact_id ?? '')]
            : [])
          .filter(Boolean));
        for (const artifactId of input.sourceIdentities.artifactIds) {
          if (!eligibleArtifactIds.has(artifactId)) {
            throw conflict(`Checkpoint artifact ${artifactId} is not a canonical Artifact Projection on the source Work Run`);
          }
        }
      }
    } else {
      if (input.sourceIdentities.revisionIds.length === 0) {
        throw badRequest(`${operation} requires one or more approved source revision identities`);
      }
      if (operation === 'learn' && !sourceRevisions.some((revision) => (
        revision.sections.recentContext.content.length > 0
        && revision.sections.recentContext.citations.length > 0
      ))) {
        throw badRequest('learn requires at least one non-empty approved Recent Context revision with citations');
      }
    }
    const citedSources = new Set<string>([
      ...input.sourceIdentities.artifactIds,
      ...input.sourceIdentities.revisionIds,
    ]);
    const allowed = operation === 'checkpoint' ? new Set(['recentContext', 'openItems']) : new Set(['stableMemory']);
    for (const diff of candidate.candidateDiff) {
      if (!allowed.has(diff.section)) throw badRequest(`${operation} cannot mutate ${diff.section}`);
      if (diff.operation === 'replace' && diff.after?.content && diff.after.citations.length === 0) {
        throw badRequest(`${operation} replacement content requires artifact or revision citations`);
      }
      for (const citation of diff.after?.citations ?? []) {
        if (!citedSources.has(citation)) {
          throw badRequest(`${operation} citation ${citation} is not locked by sourceIdentities.artifactIds/revisionIds`);
        }
      }
      if (operation === 'review' && canonicalJson(diff.after?.citations ?? []) !== canonicalJson(input.currentSections.stableMemory.citations)) {
        throw badRequest('Review must preserve the exact stable-memory citation set and cannot add uncited claims');
      }
    }
  }).then(() => undefined);
}

function assertDreamTimeProposalReplay(
  existing: MemoryProposal,
  candidate: MemoryProposalCandidate,
  proposalActor: string,
): void {
  const {
    schemaVersion: _schemaVersion,
    lifecycle: _lifecycle,
    approvalPolicy: _approvalPolicy,
    createdAt: _createdAt,
    createdBy,
    fingerprint: _fingerprint,
    ...persistedCandidate
  } = existing;
  if (createdBy !== proposalActor || canonicalJson(persistedCandidate) !== canonicalJson(candidate)) {
    throw conflict('Dream Time proposal identity was already used for different immutable proposal bytes');
  }
}

async function proposeDreamTimeResult(
  ctx: OperationContext,
  vaultPath: string,
  stateRoot: string,
  service: AgentDomainService,
  operation: DreamTimeOperation,
  params: Record<string, unknown>,
): Promise<{ proposal: MemoryProposal; idempotent: boolean }> {
  const project = exactProject(vaultPath, params.project, `dreamtime.${operation}.propose`);
  const profileId = requiredString(params.profileId, 'profileId') as AgentProfileId;
  const input = requiredRecord(params.workerInput, 'workerInput') as unknown as DreamTimeWorkerInput;
  const candidate = requiredRecord(params.candidate, 'candidate') as unknown as MemoryProposalCandidate;
  if (!candidate.proposalId) throw badRequest('Dream Time proposal operations require a stable candidate.proposalId for replay');
  const store = dreamTimeStore(stateRoot, project.projectId as ProjectId, profileId);
  const current = await currentMemoryLock(store);
  if (input.profileId !== profileId || canonicalJson(input.expectedRevision) !== canonicalJson({ revisionId: current.revisionId, revision: current.revision, fingerprint: current.fingerprint })) {
    throw conflict('Dream Time proposal expected revision is stale');
  }
  const baselineSections = current.revisionRecord?.sections ?? initialMemorySections();
  const baselineDirectives = current.revisionRecord?.protectedDirectives ?? [];
  const baselineConflicts = current.revisionRecord?.unresolvedConflicts ?? [];
  if (canonicalJson(input.currentSections) !== canonicalJson(baselineSections)
    || canonicalJson(input.protectedDirectives) !== canonicalJson(baselineDirectives)
    || canonicalJson(input.unresolvedConflicts) !== canonicalJson(baselineConflicts)) {
    throw conflict('Dream Time worker input does not byte-lock the current approved Memory Revision baseline');
  }
  if (input.sourceFingerprint !== dreamTimeSourceFingerprint(input)) throw conflict('Dream Time source fingerprint does not lock exact input bytes');
  await validateProposalSource(vaultPath, project, service, store, operation, input, candidate);
  const proposalActor = actor(ctx, params.actor);
  const existing = await store.readProposal(candidate.proposalId);
  let proposal: MemoryProposal;
  let idempotent: boolean;
  if (existing) {
    assertDreamTimeProposalReplay(existing, candidate, proposalActor);
    proposal = existing;
    idempotent = true;
  } else {
    try {
      proposal = await runDreamTimeProposalWorker(store, { generate: async () => candidate }, input, proposalActor);
      idempotent = false;
    } catch (error) {
      if (!(error instanceof DomainConflictError)) throw error;
      const collided = await store.readProposal(candidate.proposalId);
      if (!collided) throw error;
      assertDreamTimeProposalReplay(collided, candidate, proposalActor);
      proposal = collided;
      idempotent = true;
    }
  }
  appendGovernedUsage(vaultPath, {
    kind: 'dreamtime',
    idempotencyKey: `dreamtime-proposal:${proposal.proposalId}`,
    occurredAt: proposal.createdAt,
    projectId: proposal.projectId,
    profileId: proposal.profileId,
    threadId: proposal.sourceIdentities.threadId,
    workRunId: proposal.sourceIdentities.workRunId,
    provider: proposal.modelLock.provider,
    model: proposal.modelLock.model,
    operation: `dreamtime.${operation}.propose`,
    provenance: [`dreamtime-run:${proposal.proposalId}`],
  });
  return { proposal, idempotent };
}

async function proposeDreamTime(
  ctx: OperationContext,
  vaultPath: string,
  stateRoot: string,
  service: AgentDomainService,
  operation: DreamTimeOperation,
  params: Record<string, unknown>,
): Promise<MemoryProposal> {
  return (await proposeDreamTimeResult(ctx, vaultPath, stateRoot, service, operation, params)).proposal;
}

function dreamTimeTransitionOperation(vaultPath: string, stateRoot: string, action: 'approve' | 'reject'): Operation {
  return {
    name: `dreamtime.${action}`, namespace: 'dreamtime', description: `${action === 'approve' ? 'Approve' : 'Reject'} one exact immutable Memory Proposal fingerprint under a manual actor and revision lock.`, mutating: true,
    writePolicy: AGENT_DOMAIN_WRITE_POLICY,
    params: {
      project: { type: 'string', required: true }, profileId: { type: 'string', required: true }, proposalId: { type: 'string', required: true },
      presentedFingerprint: { type: 'string', required: true }, expectedRevision: { type: 'number', required: true }, transitionToken: { type: 'string', required: true },
      actor: { type: 'string', required: true }, reason: { type: 'string', required: false },
    },
    handler: async (ctx, params) => boundary(async () => {
      closedParams(params, ['project', 'profileId', 'proposalId', 'presentedFingerprint', 'expectedRevision', 'transitionToken', 'actor', 'reason']);
      const project = exactProject(vaultPath, params.project, `dreamtime.${action}`);
      const authenticatedActor = actor(ctx, params.actor, true);
      const store = dreamTimeStore(stateRoot, project.projectId as ProjectId, requiredString(params.profileId, 'profileId') as AgentProfileId);
      return store[action](requiredString(params.proposalId, 'proposalId') as MemoryProposalId, {
        presentedFingerprint: requiredString(params.presentedFingerprint, 'presentedFingerprint'),
        expectedRevision: requiredInteger(params.expectedRevision, 'expectedRevision'),
        transitionToken: requiredString(params.transitionToken, 'transitionToken'),
        actor: authenticatedActor,
        reason: params.reason === undefined ? undefined : requiredString(params.reason, 'reason'),
        authorize: async () => ({ allowed: true, policyVersion: 'dreamtime-manual-approval/v1', reason: 'Authenticated manual approval', }),
      });
    }),
  };
}

function dreamTimeOperations(vaultPath: string, stateRoot: string, service: AgentDomainService): Operation[] {
  const proposalParams = {
    project: { type: 'string', required: true } as const,
    profileId: { type: 'string', required: true } as const,
    workerInput: { type: 'object', required: true } as const,
    candidate: { type: 'object', required: true } as const,
    actor: { type: 'string', required: true } as const,
  };
  const propose = (operation: DreamTimeOperation): Operation => ({
    name: `dreamtime.${operation}.propose`, namespace: 'dreamtime', description: `Create an immutable proposal-only ${operation} candidate without granting a worker any write, network, or connector authority.`, mutating: true,
    writePolicy: AGENT_DOMAIN_USAGE_WRITE_POLICY, params: proposalParams,
    handler: async (ctx, params) => boundary(async () => {
      closedParams(params, ['project', 'profileId', 'workerInput', 'candidate', 'actor']);
      return proposeDreamTime(ctx, vaultPath, stateRoot, service, operation, params);
    }),
  });
  const scopedParams = {
    project: { type: 'string', required: true } as const,
    profileId: { type: 'string', required: true } as const,
  };
  return [propose('checkpoint'), propose('learn'), propose('review'), {
    name: 'dreamtime.proposal.read', namespace: 'dreamtime', description: 'Read one immutable proposal with its terminal decision lifecycle projected separately.', mutating: false,
    params: { ...scopedParams, proposalId: { type: 'string', required: true } },
    handler: async (_ctx, params) => boundary(async () => {
      closedParams(params, ['project', 'profileId', 'proposalId']);
      const project = exactProject(vaultPath, params.project, 'dreamtime.proposal.read');
      const store = dreamTimeStore(stateRoot, project.projectId as ProjectId, requiredString(params.profileId, 'profileId') as AgentProfileId);
      const proposalId = requiredString(params.proposalId, 'proposalId') as MemoryProposalId;
      const proposal = await store.readProposal(proposalId);
      if (!proposal) throw notFound(`Memory Proposal ${proposalId} does not exist`);
      const decision = await store.readDecision(proposalId);
      return { proposal: { ...proposal, lifecycle: decision?.state ?? proposal.lifecycle } };
    }),
  }, dreamTimeTransitionOperation(vaultPath, stateRoot, 'approve'), dreamTimeTransitionOperation(vaultPath, stateRoot, 'reject'), {
    name: 'dreamtime.revision.current', namespace: 'dreamtime', description: 'Read the current approved Memory Revision for one Project Agent.', mutating: false,
    params: scopedParams,
    handler: async (_ctx, params) => boundary(async () => {
      closedParams(params, ['project', 'profileId']);
      const project = exactProject(vaultPath, params.project, 'dreamtime.revision.current');
      return dreamTimeStore(stateRoot, project.projectId as ProjectId, requiredString(params.profileId, 'profileId') as AgentProfileId).readCurrentRevision();
    }),
  }, {
    name: 'dreamtime.revision.read', namespace: 'dreamtime', description: 'Read one exact approved Memory Revision identity.', mutating: false,
    params: { ...scopedParams, revisionId: { type: 'string', required: true } },
    handler: async (_ctx, params) => boundary(async () => {
      closedParams(params, ['project', 'profileId', 'revisionId']);
      const project = exactProject(vaultPath, params.project, 'dreamtime.revision.read');
      const revision = await dreamTimeStore(stateRoot, project.projectId as ProjectId, requiredString(params.profileId, 'profileId') as AgentProfileId)
        .readRevision(requiredString(params.revisionId, 'revisionId') as MemoryRevisionId);
      if (!revision) throw notFound(`Memory Revision ${String(params.revisionId)} does not exist`);
      return revision;
    }),
  }, {
    name: 'dreamtime.revision.history', namespace: 'dreamtime', description: 'Project immutable Memory Revisions and append-only decision events.', mutating: false,
    params: scopedParams,
    handler: async (_ctx, params) => boundary(async () => {
      closedParams(params, ['project', 'profileId']);
      const project = exactProject(vaultPath, params.project, 'dreamtime.revision.history');
      const store = dreamTimeStore(stateRoot, project.projectId as ProjectId, requiredString(params.profileId, 'profileId') as AgentProfileId);
      return { revisions: await store.listRevisions(), events: await store.listEvents() };
    }),
  }, {
    name: 'dreamtime.doctor', namespace: 'dreamtime', description: 'Read proposal, decision, warning, conflict, model-lock, provenance, and revision health without mutating memory.', mutating: false,
    params: { project: { type: 'string', required: true }, profileId: { type: 'string', required: false } },
    handler: async (_ctx, params) => boundary(async () => {
      closedParams(params, ['project', 'profileId']);
      const project = exactProject(vaultPath, params.project, 'dreamtime.doctor');
      const profileIds = params.profileId === undefined
        ? (await service.bindings.list({ projectId: project.projectId as ProjectId })).map((binding) => binding.profileId)
        : [requiredString(params.profileId, 'profileId') as AgentProfileId];
      const proposalSummaries: Array<Record<string, unknown>> = [];
      const diagnostics: Array<Record<string, unknown>> = [];
      let revisionCount = 0;
      for (const profileId of [...new Set(profileIds)].sort()) {
        const store = dreamTimeStore(stateRoot, project.projectId as ProjectId, profileId);
        revisionCount += (await store.listRevisions()).length;
        const directory = proposalDirectory(stateRoot, project.projectId as ProjectId, profileId);
        const files = existsSync(directory) ? readdirSync(directory).filter((file) => file.endsWith('.json')).sort() : [];
        for (const file of files) {
          const proposalId = `memory-proposal/${basename(file, '.json')}` as MemoryProposalId;
          const proposal = await store.readProposal(proposalId);
          if (!proposal) continue;
          const decision = await store.readDecision(proposalId);
          proposalSummaries.push({
            proposalId, profileId, operation: proposal.operation, lifecycle: decision?.state ?? proposal.lifecycle,
            fingerprint: proposal.fingerprint, createdAt: proposal.createdAt, expiresAt: proposal.expiresAt,
            warningCount: proposal.warnings.length, conflictCount: proposal.unresolvedConflicts.length,
            modelLock: proposal.modelLock, provenance: proposal.provenance,
          });
          if (!decision && Date.parse(proposal.expiresAt) <= Date.now()) diagnostics.push({ code: 'proposal-expired-unfinalized', severity: 'warning', remediationKey: 'reject-or-refresh-proposal' });
          if (proposal.unresolvedConflicts.length) diagnostics.push({ code: 'memory-conflicts-unresolved', severity: 'error', remediationKey: 'resolve-memory-conflicts' });
        }
      }
      return {
        projectId: project.projectId,
        ...(params.profileId === undefined ? {} : { profileId: params.profileId }),
        state: diagnostics.some((item) => item.severity === 'error') ? 'degraded' : proposalSummaries.length || revisionCount ? 'healthy' : 'empty',
        proposalSummaries,
        revisionCount,
        diagnostics,
      };
    }),
  }, {
    name: 'dreamtime.promotion.handoff', namespace: 'dreamtime', description: 'Route a reviewed Dream Time durable-knowledge candidate into the existing quarantined AI-Output Promotion path.', mutating: true,
    writePolicy: { realWrite: 'always', targets: () => ['00-Inbox/AI-Output/vault-dreamtime/**'], audit: 'required' },
    params: {
      project: { type: 'string', required: true }, profileId: { type: 'string', required: true }, proposalId: { type: 'string', required: true },
      proposalFingerprint: { type: 'string', required: true }, candidateDiff: { type: 'array', required: true }, provenance: { type: 'array', required: true }, actor: { type: 'string', required: true },
    },
    handler: async (ctx, params) => boundary(async () => {
      closedParams(params, ['project', 'profileId', 'proposalId', 'proposalFingerprint', 'candidateDiff', 'provenance', 'actor']);
      const project = exactProject(vaultPath, params.project, 'dreamtime.promotion.handoff');
      actor(ctx, params.actor, true);
      const store = dreamTimeStore(stateRoot, project.projectId as ProjectId, requiredString(params.profileId, 'profileId') as AgentProfileId);
      const proposal = await store.readProposal(requiredString(params.proposalId, 'proposalId') as MemoryProposalId);
      if (!proposal) throw notFound(`Memory Proposal ${String(params.proposalId)} does not exist`);
      if (proposal.fingerprint !== params.proposalFingerprint || canonicalJson(proposal.candidateDiff) !== canonicalJson(params.candidateDiff) || canonicalJson(proposal.provenance) !== canonicalJson(params.provenance)) {
        throw conflict('Promotion handoff bytes differ from the immutable Memory Proposal');
      }
      const candidateId = `promotion-candidate/${proposal.fingerprint.slice('sha256:'.length, 'sha256:'.length + 24)}`;
      const body = [
        '# Dream Time Promotion Candidate', '',
        `Candidate: ${candidateId}`, `Project: ${project.projectId}`, `Agent: ${proposal.profileId}`, `Proposal: ${proposal.proposalId}`, '',
        'This is an unreviewed candidate. It does not modify protected durable knowledge.', '',
        '## Candidate Diff', '```json', JSON.stringify(proposal.candidateDiff, null, 2), '```', '',
        '## Provenance', '```json', JSON.stringify(proposal.provenance, null, 2), '```', '',
      ].join('\n');
      const result = await ctx.vault.execute('vault.writeAIOutput', {
        persona: 'vault-dreamtime', parentQuery: `Review ${candidateId} for ${project.projectId}`,
        sourceNodes: [], agent: 'llmwiki-dreamtime', body, slug: candidateId.replace('/', '-'), scope: 'project', quarantineState: 'new', dryRun: false,
      }) as Record<string, unknown>;
      return { candidateId, reviewPath: result.path, status: 'created' };
    }),
  }];
}

function dreamTimeCadenceOperations(
  vaultPath: string,
  stateRoot: string,
  service: AgentDomainService,
): Operation[] {
  const cadenceParams = {
    project: { type: 'string', required: true } as const,
    profileId: { type: 'string', required: true } as const,
    cadence: { type: 'string' as const, required: true as const, enum: ['daily', 'weekly', 'monthly'] },
    asOf: { type: 'string', required: true } as const,
  };

  const resolveCadence = (params: Record<string, unknown>, operation: string) => {
    const project = exactProject(vaultPath, params.project, operation);
    const profileId = requiredString(params.profileId, 'profileId') as AgentProfileId;
    const cadence = requiredString(params.cadence, 'cadence') as DreamTimeCadence;
    const asOf = requiredString(params.asOf, 'asOf');
    const window = resolveDreamTimeCadenceWindow(cadence, asOf);
    const identity = dreamTimeCadenceIdentity(project.projectId as ProjectId, profileId, window);
    return { project, profileId, cadence, asOf, window, identity };
  };

  const settingsFor = async (
    project: ProjectContext,
    cadence: DreamTimeCadence,
    asOf: string,
  ) => {
    const settingsService = createSettingsService({
      vaultPath,
      workspaceProjectId: project.projectId,
      sessionId: 'dreamtime-cadence',
      clock: () => asOf,
    });
    const { snapshot } = await settingsService.snapshotResolve();
    const settingKey = cadenceSettingKey(cadence);
    const setting = snapshot.effective.find((item) => item.key === settingKey);
    if (!setting || typeof setting.value !== 'boolean') {
      throw conflict(`Dream Time cadence setting ${settingKey} is not a resolved boolean`);
    }
    return { settingsService, settingsSnapshot: snapshot, settingKey, enabled: setting.value };
  };

  const cadenceResult = async (
    store: DreamTimeStore,
    project: ProjectContext,
    profileId: AgentProfileId,
    cadence: DreamTimeCadence,
    asOf: string,
    window: ReturnType<typeof resolveDreamTimeCadenceWindow>,
    identity: ReturnType<typeof dreamTimeCadenceIdentity>,
  ) => {
    const { enabled } = await settingsFor(project, cadence, asOf);
    const proposal = await store.readProposal(identity.proposalId);
    const decision = proposal ? await store.readDecision(identity.proposalId) : null;
    const workRun = cadenceWorkRun(vaultPath, project, identity.invocationId);
    const reason = proposal
      ? 'proposal-exists'
      : !enabled
        ? 'disabled'
        : workRun
          ? 'resumable-work-run'
          : 'due';
    return {
      projectId: project.projectId,
      profileId,
      ...window,
      invocationId: identity.invocationId,
      enabled,
      due: enabled && !proposal && !workRun,
      reason,
      ...(workRun ? { workRunId: workRun.work_run_id } : {}),
      proposal: proposal ? {
        proposalId: proposal.proposalId,
        fingerprint: proposal.fingerprint,
        lifecycle: decision?.state ?? proposal.lifecycle,
        createdAt: proposal.createdAt,
        expiresAt: proposal.expiresAt,
      } : null,
    };
  };

  return [{
    name: 'dreamtime.cadence.status', namespace: 'dreamtime', description: 'Compute one disabled-by-default Project-scoped UTC Dream Time cadence window without running a background scheduler.', mutating: false,
    params: cadenceParams,
    handler: async (_ctx, params) => boundary(async () => {
      closedParams(params, ['project', 'profileId', 'cadence', 'asOf']);
      const resolved = resolveCadence(params, 'dreamtime.cadence.status');
      const store = dreamTimeStore(stateRoot, resolved.project.projectId as ProjectId, resolved.profileId);
      return cadenceResult(store, resolved.project, resolved.profileId, resolved.cadence, resolved.asOf, resolved.window, resolved.identity);
    }),
  }, {
    name: 'dreamtime.cadence.run', namespace: 'dreamtime', description: 'Explicitly run one due Project-scoped cadence as a canonical Work Run and immutable proposal that remains pending manual approval.', mutating: true,
    writePolicy: {
      realWrite: 'always',
      targets: (_ctx, params) => {
        const project = exactProject(vaultPath, params.project, 'dreamtime.cadence.run');
        return [
          `${AGENT_DOMAIN_RELATIVE_ROOT}/**`,
          `${USAGE_RELATIVE_ROOT}/**`,
          `01-Projects/${project.slug}/runs/**`,
          `10-Projects/${project.slug}/agents/**`,
        ];
      },
      audit: 'required',
    },
    params: {
      ...cadenceParams,
      tokenBudget: { type: 'number', required: true },
      sourceIdentities: { type: 'object', required: true },
      candidateDiff: { type: 'array', required: true },
      provenance: { type: 'array', required: true },
      warnings: { type: 'array', required: false },
      expiresAt: { type: 'string', required: true },
      actor: { type: 'string', required: true },
    },
    handler: async (ctx, params) => boundary(async () => {
      closedParams(params, [
        'project', 'profileId', 'cadence', 'asOf', 'tokenBudget', 'sourceIdentities',
        'candidateDiff', 'provenance', 'warnings', 'expiresAt', 'actor',
      ]);
      const { project, profileId, cadence, asOf, window, identity } = resolveCadence(params, 'dreamtime.cadence.run');
      const store = dreamTimeStore(stateRoot, project.projectId as ProjectId, profileId);
      const requestedActor = actor(ctx, params.actor);
      const sourceInput = requiredRecord(params.sourceIdentities, 'sourceIdentities');
      closedParams(sourceInput, ['threadId', 'workRunId', 'revisionIds', 'artifactIds', 'cutoffAt']);
      const sourceIdentities: MemorySourceIdentities = {
        ...(sourceInput.threadId === undefined ? {} : { threadId: requiredString(sourceInput.threadId, 'sourceIdentities.threadId') as ThreadId }),
        ...(sourceInput.workRunId === undefined ? {} : { workRunId: requiredString(sourceInput.workRunId, 'sourceIdentities.workRunId') as WorkRunId }),
        revisionIds: requiredArray(sourceInput.revisionIds, 'sourceIdentities.revisionIds')
          .map((item, index) => requiredString(item, `sourceIdentities.revisionIds[${index}]`) as MemoryRevisionId),
        artifactIds: requiredArray(sourceInput.artifactIds, 'sourceIdentities.artifactIds')
          .map((item, index) => requiredString(item, `sourceIdentities.artifactIds[${index}]`) as MemorySourceIdentities['artifactIds'][number]),
        cutoffAt: requiredString(sourceInput.cutoffAt, 'sourceIdentities.cutoffAt'),
      };
      const candidateDiff = requiredArray(params.candidateDiff, 'candidateDiff') as unknown as CandidateDiff[];
      const provenance = normalizeProvenance(params.provenance);
      if (provenance.some((reference) => reference.kind === 'settings'
        || (reference.kind === 'governance' && reference.id === CADENCE_GOVERNANCE_ID))) {
        throw badRequest('Dream Time cadence reserves Settings and cadence-governance provenance for server-issued locks');
      }
      const warnings = (params.warnings === undefined ? [] : requiredArray(params.warnings, 'warnings')) as unknown as MemoryWarning[];
      const expiresAt = requiredString(params.expiresAt, 'expiresAt');
      const tokenBudget = requiredInteger(params.tokenBudget, 'tokenBudget', 1);
      const cadenceRequestFingerprint = canonicalDigest({
        schemaVersion: 1,
        invocationId: identity.invocationId,
        asOf,
        tokenBudget,
      });
      assertSafeSharedState({ sourceIdentities, candidateDiff, provenance, warnings, requestedActor }, 'DreamTimeCadenceRequest');

      const existingProposal = await store.readProposal(identity.proposalId);
      if (existingProposal) {
        const existingRun = cadenceWorkRun(vaultPath, project, identity.invocationId);
        if (!existingRun) throw conflict('Dream Time cadence proposal is missing its canonical Work Run');
        const workRunId = requiredString(existingRun.work_run_id, 'workRun.work_run_id') as WorkRunId;
        const contextEnvelopeFingerprint = assertCadenceReplayBytes(
          existingProposal,
          workRunId,
          sourceIdentities,
          candidateDiff,
          provenance,
          warnings,
          expiresAt,
          requestedActor,
          cadenceRequestFingerprint,
        );
        await moveCadenceWorkRunToReview(ctx, vaultPath, project, identity, workRunId, existingProposal.proposalId);
        appendGovernedUsage(vaultPath, {
          kind: 'dreamtime',
          idempotencyKey: `dreamtime-cadence:${identity.invocationId}`,
          occurredAt: asOf,
          projectId: project.projectId as ProjectId,
          profileId,
          workRunId,
          provider: existingProposal.modelLock.provider,
          model: existingProposal.modelLock.model,
          operation: 'dreamtime.cadence.run',
          provenance: [`dreamtime-run:${identity.invocationId}`],
        });
        return { ...window, invocationId: identity.invocationId, workRunId, contextEnvelopeFingerprint, proposal: existingProposal, idempotent: true };
      }

      const { settingsService, settingsSnapshot, settingKey, enabled } = await settingsFor(project, cadence, asOf);
      if (!enabled) throw conflict(`Dream Time cadence ${cadence} is disabled for ${project.projectId}`);

      const bindingId = `binding/${project.slug}/${profileId.slice('agent/'.length)}` as ProjectAgentBindingId;
      const profile = await service.profiles.read(profileId);
      const binding = await service.bindings.read(bindingId);
      if (!profile || !binding || !binding.enabled || binding.projectId !== project.projectId
        || binding.profileId !== profileId || binding.profileRevision !== profile.revision) {
        throw conflict('Dream Time cadence requires the active enabled Project Agent Binding and Profile revision');
      }
      const canonicalProjectContext = normalizedProjectContext(project);
      const canonicalProjectFingerprint = canonicalDigest(canonicalProjectContext);
      if (binding.projectContextFingerprint !== canonicalProjectFingerprint) {
        throw conflict('Dream Time cadence Project Agent Binding uses a stale Project Context fingerprint');
      }

      const current = await store.readCurrentRevision();
      if (!current) throw conflict('Dream Time cadence requires an approved Memory Revision bootstrap');
      const settingsFingerprint = canonicalDigest(settingsSnapshot);
      const settingsModel = await settingsService.agentModelInvocationProfile();
      const profileModel = profile.defaultModelPolicy;
      const modelLock = {
        provider: profileModel.mode === 'inherit' ? settingsModel.provider || 'inherit' : profileModel.provider!,
        model: profileModel.mode === 'inherit' ? settingsModel.model || 'inherit' : profileModel.model!,
        contextWindow: 32_768,
        tokenizer: 'utf8-bytes-div4/v1',
        policyFingerprint: canonicalDigest({ profileModel, settingsFingerprint }),
      };
      const workerInput: DreamTimeWorkerInput = {
        operation: window.operation,
        projectId: project.projectId as ProjectId,
        profileId,
        sourceIdentities,
        expectedRevision: { revisionId: current.revisionId, revision: current.revision, fingerprint: current.fingerprint },
        sourceFingerprint: '',
        currentSections: current.sections,
        protectedDirectives: current.protectedDirectives,
        unresolvedConflicts: current.unresolvedConflicts,
        modelLock,
        expiresAt,
      };
      workerInput.sourceFingerprint = dreamTimeSourceFingerprint(workerInput);
      const preflightCandidate: MemoryProposalCandidate = {
        proposalId: identity.proposalId,
        operation: window.operation,
        projectId: project.projectId as ProjectId,
        profileId,
        sourceIdentities,
        expectedRevision: workerInput.expectedRevision,
        sourceFingerprint: workerInput.sourceFingerprint,
        candidateDiff,
        protectedDirectives: current.protectedDirectives,
        unresolvedConflicts: current.unresolvedConflicts,
        provenance,
        warnings,
        modelLock,
        expiresAt,
      };
      assertSafeSharedState({ workerInput, candidate: preflightCandidate, actor: requestedActor }, 'DreamTimeCadenceProposal');
      const preflightCreatedAt = new Date().toISOString();
      const preflightMaterial = {
        ...preflightCandidate,
        schemaVersion: 1,
        proposalId: identity.proposalId,
        lifecycle: 'proposed',
        approvalPolicy: {
          mode: 'manual',
          autoApprovalHook: { enabled: false, warningFreeOnly: true, workingMemoryOnly: true },
        },
        createdAt: preflightCreatedAt,
        createdBy: requestedActor,
      };
      validateMemoryProposal({ ...preflightMaterial, fingerprint: canonicalDigest(preflightMaterial) });
      await validateProposalSource(vaultPath, project, service, store, window.operation, workerInput, preflightCandidate);

      let workRunId: WorkRunId;
      try {
        const started = await workflowOperation(vaultPath, 'workflow.agent.start').handler(ctx, {
          project: project.projectId,
          agent: identity.agentId,
          role: 'memory-maintenance',
          host: 'llmwiki-dreamtime',
          objective: `Dream Time ${window.operation} proposal for ${window.periodKey}`,
          issue: `dreamtime-${cadence}`,
          transition_token: identity.transitionToken,
          output_class: 'knowledge-claim',
          approval_status: 'pending',
          provenance: [`dreamtime-cadence:${identity.invocationId}`],
          stage: 'build',
          evidence: [`settings:${settingKey}`],
          notes: 'Explicit cadence invocation; no background scheduler or automatic approval.',
        }) as Record<string, unknown>;
        workRunId = requiredString(started.workRunId, 'workflow.agent.start.workRunId') as WorkRunId;
      } catch (error) {
        if (!isOperationError(error) || error.code !== -32010) throw error;
        const racedRun = cadenceWorkRun(vaultPath, project, identity.invocationId);
        if (!racedRun) throw error;
        workRunId = requiredString(racedRun.work_run_id, 'workRun.work_run_id') as WorkRunId;
      }
      const durableRun = readCanonicalWorkRun(vaultPath, project, workRunId);

      const threadWindow = [] as Array<{
        chunkId: string; content: JsonValue; provenance: Array<{ kind: 'thread'; id: string; revision: number }>;
      }>;
      if (sourceIdentities.threadId) {
        const thread = await service.threads.read(sourceIdentities.threadId);
        if (!thread || thread.projectId !== project.projectId || thread.profileId !== profileId
          || thread.profileRevision !== profile.revision || thread.bindingId !== bindingId || thread.bindingRevision !== binding.revision) {
          throw conflict('Dream Time cadence Context Envelope Thread is not the active exact Project/Profile/Binding revision');
        }
        threadWindow.push({
          chunkId: thread.threadId,
          content: {
            threadId: thread.threadId,
            lifecycle: thread.lifecycle,
            title: thread.title,
            references: thread.references as unknown as JsonValue,
          },
          provenance: [{ kind: 'thread', id: thread.threadId, revision: thread.revision }],
        });
      }
      const publicSettingKeys = new Set(settingsService.registry.definitions
        .filter((definition) => definition.sensitivity === 'public')
        .map((definition) => definition.key));
      const settingsProjection = {
        snapshotId: settingsSnapshot.snapshotId,
        registryVersion: settingsSnapshot.registryVersion,
        sourceRevisions: settingsSnapshot.sourceRevisions,
        effective: settingsSnapshot.effective
          .filter((item) => publicSettingKeys.has(item.key))
          .map((item) => ({ key: item.key, value: item.value, winningScope: item.winningScope, applyMode: item.applyMode })),
      };
      const envelope = compileContextEnvelope({
        envelopeId: `context-envelope/${identity.invocationId.slice('dreamtime-cadence/'.length)}`,
        compiledAt: asOf,
        modelLock,
        tokenBudget,
        platformKernel: PLATFORM_KERNEL as never,
        profile,
        binding,
        memoryRevision: current,
        memoryRevisionLock: { revisionId: current.revisionId, revision: current.revision, fingerprint: current.fingerprint },
        runtime: {
          projectContext: {
            chunkId: `project-context/${project.slug}`,
            content: canonicalProjectContext as unknown as JsonValue,
            provenance: [{ kind: 'project', id: project.projectId, fingerprint: canonicalProjectFingerprint }],
            mandatory: true,
          },
          workRun: {
            chunkId: workRunId,
            content: {
              projectId: project.projectId,
              workRunId,
              workItemId: String(durableRun.work_item_id),
              agentId: identity.agentId,
              outputClass: 'knowledge-claim',
              cadence,
              operation: window.operation,
              invocationId: identity.invocationId,
            },
            provenance: [{ kind: 'workRun', id: workRunId }],
            mandatory: true,
          },
          threadWindow,
          settingsSnapshot: {
            chunkId: settingsSnapshot.snapshotId,
            content: settingsProjection as unknown as JsonValue,
            provenance: [{ kind: 'settings', id: settingsSnapshot.snapshotId, fingerprint: settingsFingerprint }],
            mandatory: true,
          },
          deviceCapabilities: [],
          capabilityGrants: [],
        },
      });
      const proposalProvenance = normalizeProvenance([
        ...provenance,
        { kind: 'governance', id: CADENCE_GOVERNANCE_ID, fingerprint: cadenceRequestFingerprint },
        { kind: 'workRun', id: workRunId, fingerprint: envelope.fingerprint },
        { kind: 'settings', id: settingsSnapshot.snapshotId, fingerprint: settingsFingerprint },
      ]);
      const { proposal, idempotent: proposalIdempotent } = await proposeDreamTimeResult(ctx, vaultPath, stateRoot, service, window.operation, {
        project: project.projectId,
        profileId,
        workerInput,
        candidate: { ...preflightCandidate, provenance: proposalProvenance },
        actor: requestedActor,
      });
      await moveCadenceWorkRunToReview(ctx, vaultPath, project, identity, workRunId, proposal.proposalId);
      appendGovernedUsage(vaultPath, {
        kind: 'dreamtime',
        idempotencyKey: `dreamtime-cadence:${identity.invocationId}`,
        occurredAt: asOf,
        projectId: project.projectId as ProjectId,
        profileId,
        workRunId,
        provider: proposal.modelLock.provider,
        model: proposal.modelLock.model,
        operation: 'dreamtime.cadence.run',
        provenance: [`dreamtime-run:${identity.invocationId}`],
      });
      return {
        ...window,
        invocationId: identity.invocationId,
        workRunId,
        contextEnvelopeFingerprint: envelope.fingerprint,
        proposal,
        idempotent: proposalIdempotent,
      };
    }),
  }];
}

function collaborationRoot(stateRoot: string): string {
  return join(stateRoot, 'collaboration');
}

function childWorkRunIdFor(plan: DelegationPlan): WorkRunId {
  const suffix = canonicalDigest({ planId: plan.planId, fingerprint: plan.fingerprint }).slice('sha256:'.length);
  return `work-run/child-${suffix.slice(0, 24)}` as WorkRunId;
}

function consultOperations(
  vaultPath: string,
  stateRoot: string,
  service: AgentDomainService,
): Operation[] {
  return [{
    name: 'consult.execute', namespace: 'consult', description: 'Execute one authorized as-of Context Consult and persist only its read-only Artifact Projection.', mutating: true,
    writePolicy: AGENT_DOMAIN_USAGE_WRITE_POLICY,
    params: {
      project: { type: 'string', required: true }, request: { type: 'object', required: true }, invocationToken: { type: 'string', required: true },
      workerOutput: { type: 'object', required: true }, inputArtifactIds: { type: 'array', required: false }, actor: { type: 'string', required: true },
      grant: { type: 'unknown', required: false },
    },
    handler: async (ctx, params) => boundary(async () => {
      closedParams(params, ['project', 'request', 'invocationToken', 'workerOutput', 'inputArtifactIds', 'actor']);
      const project = exactProject(vaultPath, params.project, 'consult.execute');
      const authenticatedActor = actor(ctx, params.actor);
      const requestInput = requiredRecord(params.request, 'request');
      if (requestInput.requestId === undefined) throw badRequest('consult.execute requires a stable request.requestId for replay');
      const grantId = requiredString(requestInput.capabilityGrantId, 'request.capabilityGrantId') as CapabilityGrant['grantId'];
      const { grant, child: requestingWorkRun } = await activeServerGrant(stateRoot, service, project, grantId);
      if (requestInput.authorizationDecision !== undefined
        && canonicalJson(requestInput.authorizationDecision) !== canonicalJson(grant.policyDecision)) {
        throw conflict('Context Consult client authorization does not match the server-issued Capability Grant decision');
      }
      const invocationToken = requiredString(params.invocationToken, 'invocationToken');
      const request = createContextConsultRequest({ ...requestInput, authorizationDecision: grant.policyDecision, invocationToken } as never);
      if (request.projectId !== project.projectId) throw conflict('Context Consult Project differs from the canonical Project Context');
      if (!request.authorizationDecision.allowed || request.authorizationDecision.actor !== authenticatedActor) {
        throw conflict('Context Consult authorization decision must allow the authenticated actor');
      }
      const requestingProfile = await service.profiles.readRevision(request.requestingAgent.profileId, request.requestingAgent.profileRevision);
      const targetProfile = await service.profiles.readRevision(request.targetAgent.profileId, request.targetAgent.profileRevision);
      if (!requestingProfile || !targetProfile) throw conflict('Context Consult Agent Profile revision lock is not current vault state');
      if (request.requestingAgent.workRunId !== requestingWorkRun.workRunId
        || request.requestingAgent.profileId !== requestingWorkRun.assignment.profileId
        || request.requestingAgent.profileRevision !== requestingWorkRun.assignment.profileRevision) {
        throw conflict('Context Consult requester does not match the active server-issued Work Run assignment');
      }
      const targetBindingId = `binding/${project.slug}/${request.targetAgent.profileId.slice('agent/'.length)}` as ProjectAgentBindingId;
      const targetBinding = await service.bindings.read(targetBindingId);
      if (!targetBinding || !targetBinding.enabled || targetBinding.projectId !== project.projectId
        || targetBinding.profileId !== request.targetAgent.profileId || targetBinding.profileRevision !== request.targetAgent.profileRevision) {
        throw conflict('Context Consult target is not an enabled Project-bound Agent at the requested Profile revision');
      }
      if (request.attachTo.kind === 'workRun') {
        if (request.attachTo.id !== requestingWorkRun.workRunId && request.attachTo.id !== requestingWorkRun.parentWorkRunId) {
          readCanonicalWorkRun(vaultPath, project, request.attachTo.id);
        } else if (request.attachTo.id === requestingWorkRun.parentWorkRunId) {
          readCanonicalWorkRun(vaultPath, project, request.attachTo.id);
        }
      } else {
        const thread = await service.threads.read(request.attachTo.id);
        if (!thread || thread.projectId !== project.projectId) throw conflict('Context Consult attachment Thread is outside the exact Project');
      }
      const memory = dreamTimeStore(stateRoot, project.projectId as ProjectId, request.targetAgent.profileId);
      const execution = await new ContextConsultStore({ collaborationRoot: collaborationRoot(stateRoot), projectId: project.projectId as ProjectId }).execute({
        request,
        invocationToken,
        grant,
        targetMemory: {
          readApprovedRevision: async (lock) => {
            const revision = await memory.readRevision(lock.revisionId);
            if (!revision) throw new DomainNotFoundError(`Context Consult Memory Revision ${lock.revisionId} does not exist`);
            return revision;
          },
          readCurrentApprovedRevision: async () => {
            const revision = await memory.readCurrentRevision();
            if (!revision) throw new DomainNotFoundError('Context Consult target has no approved current Memory Revision');
            return revision;
          },
        },
        worker: { generate: async () => requiredRecord(params.workerOutput, 'workerOutput') as unknown as ContextConsultWorkerOutput },
        inputArtifactIds: params.inputArtifactIds as never,
      });
      appendGovernedUsage(vaultPath, {
        kind: 'consult',
        idempotencyKey: `context-consult:${request.requestId}`,
        occurredAt: execution.result.completedAt,
        projectId: request.projectId,
        profileId: request.targetAgent.profileId,
        threadId: request.attachTo.kind === 'thread' ? request.attachTo.id : undefined,
        workRunId: request.requestingAgent.workRunId,
        operation: 'consult.execute',
        provenance: [`invocation:${request.requestId}`],
      });
      return execution;
    }),
  }];
}

function delegationOperations(
  vaultPath: string,
  stateRoot: string,
  service: AgentDomainService,
): Operation[] {
  const storeFor = (projectId: ProjectId) => new DelegationStore({ collaborationRoot: collaborationRoot(stateRoot), projectId });
  return [{
    name: 'delegation.plan', namespace: 'delegation', description: 'Persist one explicit, reviewable Delegation Plan locked to canonical Project, parent Work Run, Agent, Binding, assignment, budget, and side-effect scope.', mutating: true,
    writePolicy: AGENT_DOMAIN_USAGE_WRITE_POLICY,
    params: { project: { type: 'string', required: true }, input: { type: 'object', required: true }, actor: { type: 'string', required: true } },
    handler: async (ctx, params) => boundary(async () => {
      closedParams(params, ['project', 'input', 'actor']);
      const project = exactProject(vaultPath, params.project, 'delegation.plan');
      const input = requiredRecord(params.input, 'input');
      if (input.planId === undefined) throw badRequest('delegation.plan requires a stable input.planId for replay');
      const createdBy = actor(ctx, params.actor);
      const plan = createDelegationPlan({ ...input, projectId: project.projectId, createdBy } as never);
      readCanonicalWorkRun(vaultPath, project, plan.parentWorkRunId);
      const profile = await service.profiles.readRevision(plan.assignment.profileId, plan.assignment.profileRevision);
      const binding = await service.bindings.readRevision(plan.assignment.bindingId, plan.assignment.bindingRevision);
      if (!profile || !binding || binding.projectId !== project.projectId || binding.profileId !== profile.profileId || !binding.enabled) {
        throw conflict('Delegation assignment does not lock an enabled Agent Profile/Project Binding revision in the exact Project');
      }
      const persisted = await storeFor(project.projectId as ProjectId).createPlan(plan);
      appendGovernedUsage(vaultPath, {
        kind: 'delegation',
        idempotencyKey: `delegation-plan:${persisted.planId}`,
        occurredAt: persisted.createdAt,
        projectId: persisted.projectId,
        profileId: persisted.assignment.profileId,
        workRunId: persisted.parentWorkRunId,
        device: persisted.assignment.deviceSnapshot.deviceId,
        operation: 'delegation.plan',
        provenance: [`invocation:${persisted.planId}`],
      });
      return persisted;
    }),
  }, {
    name: 'delegation.approve', namespace: 'delegation', description: 'Approve one exact Delegation Plan and idempotently create one same-Project Child Work Run with an expiring scoped grant.', mutating: true,
    writePolicy: AGENT_DOMAIN_USAGE_WRITE_POLICY,
    params: {
      project: { type: 'string', required: true }, planId: { type: 'string', required: true }, presentedFingerprint: { type: 'string', required: true },
      expectedRevision: { type: 'number', required: true }, transitionToken: { type: 'string', required: true }, approvedExternalClasses: { type: 'array', required: true }, actor: { type: 'string', required: true },
    },
    handler: async (ctx, params) => boundary(async () => {
      closedParams(params, ['project', 'planId', 'presentedFingerprint', 'expectedRevision', 'transitionToken', 'approvedExternalClasses', 'actor']);
      const project = exactProject(vaultPath, params.project, 'delegation.approve');
      if (requiredInteger(params.expectedRevision, 'expectedRevision', 1) !== 1) throw conflict('Delegation Plan revision lock must be 1');
      const authenticatedActor = actor(ctx, params.actor, true);
      const result = await storeFor(project.projectId as ProjectId).approve({
        planId: requiredString(params.planId, 'planId') as DelegationPlanId,
        presentedFingerprint: requiredString(params.presentedFingerprint, 'presentedFingerprint'),
        transitionToken: requiredString(params.transitionToken, 'transitionToken'),
        actor: authenticatedActor,
        approvedExternalClasses: params.approvedExternalClasses as never,
        authorize: async () => ({ allowed: true, policyVersion: 'delegation-manual-approval/v1', reason: 'Authenticated explicit per-run approval', decidedAt: new Date().toISOString(), actor: authenticatedActor }),
      });
      appendGovernedUsage(vaultPath, {
        kind: 'delegation',
        idempotencyKey: `delegation-approval:${result.child.workRunId}`,
        occurredAt: result.child.createdAt,
        projectId: result.child.projectId,
        profileId: result.child.assignment.profileId,
        workRunId: result.child.workRunId,
        device: result.child.assignment.deviceSnapshot.deviceId,
        operation: 'delegation.approve',
        provenance: [`work-run:${result.child.workRunId}`],
      });
      return result;
    }),
  }, {
    name: 'delegation.read', namespace: 'delegation', description: 'Read one immutable Delegation Plan and its deterministic Child Work Run projection when approved.', mutating: false,
    params: { project: { type: 'string', required: true }, planId: { type: 'string', required: true } },
    handler: async (_ctx, params) => boundary(async () => {
      closedParams(params, ['project', 'planId']);
      const project = exactProject(vaultPath, params.project, 'delegation.read');
      const store = storeFor(project.projectId as ProjectId);
      const plan = await store.readPlan(requiredString(params.planId, 'planId') as DelegationPlanId);
      if (!plan) throw notFound(`Delegation Plan ${String(params.planId)} does not exist`);
      return { plan, child: await store.readChild(childWorkRunIdFor(plan)) };
    }),
  }, {
    name: 'delegation.transition', namespace: 'delegation', description: 'Transition one Child Work Run without inferring any parent terminal state.', mutating: true,
    writePolicy: AGENT_DOMAIN_WRITE_POLICY,
    params: {
      project: { type: 'string', required: true }, workRunId: { type: 'string', required: true }, expectedRevision: { type: 'number', required: true },
      lifecycle: { type: 'string', required: true, enum: ['running', 'completed', 'failed', 'cancelled'] }, transitionToken: { type: 'string', required: true }, actor: { type: 'string', required: true }, diagnosticArtifact: { type: 'object', required: false },
    },
    handler: async (ctx, params) => boundary(async () => {
      closedParams(params, ['project', 'workRunId', 'expectedRevision', 'lifecycle', 'transitionToken', 'actor', 'diagnosticArtifact']);
      const project = exactProject(vaultPath, params.project, 'delegation.transition');
      return storeFor(project.projectId as ProjectId).transition(requiredString(params.workRunId, 'workRunId') as WorkRunId, {
        expectedRevision: requiredInteger(params.expectedRevision, 'expectedRevision', 1),
        lifecycle: requiredString(params.lifecycle, 'lifecycle') as ChildWorkRunLifecycle,
        transitionToken: requiredString(params.transitionToken, 'transitionToken'),
        actor: actor(ctx, params.actor),
        diagnosticArtifact: params.diagnosticArtifact as ArtifactProjection | undefined,
      });
    }),
  }, {
    name: 'delegation.artifact.project', namespace: 'delegation', description: 'Project one provenance-preserving artifact from a Child Work Run back to its parent review surface.', mutating: true,
    writePolicy: AGENT_DOMAIN_WRITE_POLICY,
    params: {
      project: { type: 'string', required: true }, workRunId: { type: 'string', required: true }, expectedRevision: { type: 'number', required: true },
      transitionToken: { type: 'string', required: true }, actor: { type: 'string', required: true }, artifact: { type: 'object', required: true },
    },
    handler: async (ctx, params) => boundary(async () => {
      closedParams(params, ['project', 'workRunId', 'expectedRevision', 'transitionToken', 'actor', 'artifact']);
      const project = exactProject(vaultPath, params.project, 'delegation.artifact.project');
      return storeFor(project.projectId as ProjectId).projectArtifact(requiredString(params.workRunId, 'workRunId') as WorkRunId, {
        expectedRevision: requiredInteger(params.expectedRevision, 'expectedRevision', 1),
        transitionToken: requiredString(params.transitionToken, 'transitionToken'),
        actor: actor(ctx, params.actor),
        artifact: requiredRecord(params.artifact, 'artifact') as unknown as ArtifactProjection,
      });
    }),
  }];
}

export function makeAgentDomainOps(vaultPath: string): Operation[] {
  const stateRoot = join(vaultPath, ...AGENT_DOMAIN_RELATIVE_ROOT.split('/'));
  const service = new AgentDomainService({ stateRoot });
  return [
    ...profileOperations(service),
    ...bindingOperations(vaultPath, service),
    ...threadOperations(vaultPath, service),
    ...roomAndContextOperations(vaultPath, stateRoot, service),
    ...dreamTimeOperations(vaultPath, stateRoot, service),
    ...dreamTimeCadenceOperations(vaultPath, stateRoot, service),
    ...consultOperations(vaultPath, stateRoot, service),
    ...delegationOperations(vaultPath, stateRoot, service),
  ];
}
