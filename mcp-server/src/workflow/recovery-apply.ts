import { createHash } from 'node:crypto';
import { assertClosedRecoveryObject, fingerprintRecoveryValue, hasUnsafeRecoveryMaterial, safeRecoveryText, type RecoveryFingerprint } from '../project-hub/contract-support.js';
import { validateRecoveryPlanV2, type RecoveryPlanV2 } from '../project-hub/recovery-flow.js';
import { conflict, makeErr, type Operation, type OperationContext } from '../core/types.js';
import type { WorkRunStore } from './work-run-store.js';

export const RECOVERY_APPLY_REQUEST_SCHEMA_VERSION = 'recovery-apply-request/v2' as const;
export const RECOVERY_APPLY_SCHEMA_VERSION = 'recovery-apply/v2' as const;

const SAFE_OWNER_LIFETIME_VALUES = {
  workRunState: new Set(['planned', 'leased', 'running', 'awaiting_review', 'completed', 'failed', 'cancelled']),
  stage: new Set(['think', 'plan', 'build', 'review', 'test', 'ship', 'reflect']),
  status: new Set(['active', 'blocked', 'done', 'archived']),
} as const;

export interface RecoveryApplyRequestV2 {
  schemaVersion: typeof RECOVERY_APPLY_REQUEST_SCHEMA_VERSION;
  plan: RecoveryPlanV2;
  planFingerprint: RecoveryFingerprint;
  planningInput: { query: string; limit: number };
  transitionToken: string;
}

export interface RecoveryApplyDependencies {
  store: WorkRunStore;
  recomputeCurrentPlanBasis(
    plan: RecoveryPlanV2,
    planningInput: RecoveryApplyRequestV2['planningInput'],
  ): Promise<void>;
  join(plan: RecoveryPlanV2, actorId: string, token: string): Promise<Record<string, unknown>>;
  createAndJoin(plan: RecoveryPlanV2, actorId: string, token: string): Promise<Record<string, unknown>>;
  now(): number;
  /** Independently resolves the current mutation capability; Plan facts never authorize apply. */
  loadApplyCapability?: () => Promise<RecoveryApplyCapability>;
}

export interface RecoveryApplyCapability {
  capability: 'workflow.recovery.apply';
  state: 'available' | 'degraded' | 'unavailable' | 'disabled';
}

export interface RecoveryApplyReceiptV2 {
  schemaVersion: typeof RECOVERY_APPLY_SCHEMA_VERSION;
  planFingerprint: RecoveryFingerprint;
  tokenDigest: RecoveryFingerprint;
  projectId: string;
  kind: RecoveryPlanV2['kind'];
  workItemId: string;
  workRunId: string | null;
  ownerOperation: 'workflow.agent.join' | 'workflow.recovery.create-and-join';
  ownerReceiptFingerprint: RecoveryFingerprint;
  ownerReceipt: Record<string, unknown>;
  recordedAt: string;
  fingerprint: RecoveryFingerprint;
}

export type RecoveryApplyStateV2 = 'claimed' | 'applied' | 'outcome-unknown' | 'unavailable';

export interface RecoveryApplyResponseV2 {
  schemaVersion: typeof RECOVERY_APPLY_SCHEMA_VERSION;
  state: RecoveryApplyStateV2;
  projectId: string;
  planFingerprint: RecoveryFingerprint;
  tokenDigest: RecoveryFingerprint;
  actorId: string;
  kind: RecoveryPlanV2['kind'];
  workRunId: string | null;
  receipt: RecoveryApplyReceiptV2 | null;
  diagnostics: string[];
  fingerprint: RecoveryFingerprint;
}

interface RecoveryApplyClaimV2 {
  schemaVersion: typeof RECOVERY_APPLY_SCHEMA_VERSION;
  planFingerprint: RecoveryFingerprint;
  tokenDigest: RecoveryFingerprint;
  planningInputDigest: RecoveryFingerprint;
  actorId: string;
  projectId: string;
  kind: RecoveryPlanV2['kind'];
  workItemId: string;
  workRunId: string | null;
  state: Exclude<RecoveryApplyStateV2, 'unavailable'>;
  receipt: RecoveryApplyReceiptV2 | null;
  claimedAt: string;
  updatedAt: string;
  ownerStarted: boolean;
}

function digest(value: string): RecoveryFingerprint {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function validateFingerprint(value: unknown, label: string): RecoveryFingerprint {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) throw makeErr(-32602, `${label} must be a SHA-256 fingerprint`);
  return value as RecoveryFingerprint;
}

function validatePlanningInput(value: unknown): RecoveryApplyRequestV2['planningInput'] {
  const entry = assertClosedRecoveryObject(value, ['query', 'limit'], 'Recovery Apply planningInput');
  const query = safeRecoveryText(entry.query, 'planningInput.query', { minBytes: 1, maxBytes: 2048 });
  if (typeof entry.limit !== 'number' || !Number.isSafeInteger(entry.limit) || entry.limit < 1 || entry.limit > 25) {
    throw makeErr(-32602, 'planningInput.limit must be an integer from 1 through 25');
  }
  return { query, limit: entry.limit };
}

export function validateRecoveryApplyRequestV2(value: unknown): RecoveryApplyRequestV2 {
  const entry = assertClosedRecoveryObject(value, ['schemaVersion', 'plan', 'planFingerprint', 'planningInput', 'transitionToken'], 'Recovery Apply request');
  if (entry.schemaVersion !== RECOVERY_APPLY_REQUEST_SCHEMA_VERSION) throw makeErr(-32602, 'Recovery Apply request has an invalid schema version');
  const plan = validateRecoveryPlanV2(entry.plan);
  const planFingerprint = validateFingerprint(entry.planFingerprint, 'planFingerprint');
  if (planFingerprint !== plan.fingerprint) throw conflict('Recovery Plan fingerprint conflict');
  const planningInput = validatePlanningInput(entry.planningInput);
  const transitionToken = safeRecoveryText(entry.transitionToken, 'transitionToken', { minBytes: 1, maxBytes: 128 });
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(transitionToken)) throw makeErr(-32602, 'transitionToken has an invalid identity');
  return { schemaVersion: RECOVERY_APPLY_REQUEST_SCHEMA_VERSION, plan, planFingerprint, planningInput, transitionToken };
}

function actorId(ctx: OperationContext): string {
  const value = ctx.config.collaboration?.actor ?? process.env.VAULT_MIND_ACTOR ?? 'agent';
  const actor = safeRecoveryText(value, 'authenticated actor', { minBytes: 1, maxBytes: 128 });
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(actor)) throw makeErr(-32602, 'authenticated actor has an invalid identity');
  return actor;
}

function compareClaim(claim: RecoveryApplyClaimV2, request: RecoveryApplyRequestV2, actor: string): void {
  if (claim.planFingerprint !== request.planFingerprint || claim.projectId !== request.plan.projectId || claim.kind !== request.plan.kind || claim.workItemId !== request.plan.workItemId || claim.workRunId !== request.plan.workRunId) {
    throw conflict('Recovery apply claim identity conflict');
  }
  if (claim.tokenDigest !== digest(request.transitionToken)) throw conflict('Recovery apply transition token is already bound to another claim');
  if (claim.actorId !== actor) throw conflict('Recovery apply actor is already bound to another claim');
  if (claim.planningInputDigest !== fingerprintRecoveryValue(request.planningInput)) throw conflict('Recovery apply planning input is already bound to another claim');
}

function claimFrom(value: Record<string, unknown> | null): RecoveryApplyClaimV2 | null {
  if (!value) return null;
  if (value.schemaVersion !== RECOVERY_APPLY_SCHEMA_VERSION || typeof value.planFingerprint !== 'string' || typeof value.tokenDigest !== 'string' || typeof value.planningInputDigest !== 'string' || typeof value.actorId !== 'string' || typeof value.projectId !== 'string' || (value.state !== 'claimed' && value.state !== 'applied' && value.state !== 'outcome-unknown')) throw conflict('Recovery apply claim is malformed');
  return value as unknown as RecoveryApplyClaimV2;
}

function unavailable(request: RecoveryApplyRequestV2, tokenDigest: RecoveryFingerprint, actor: string, reason: string): RecoveryApplyResponseV2 {
  const base = { schemaVersion: RECOVERY_APPLY_SCHEMA_VERSION, state: 'unavailable' as const, projectId: request.plan.projectId, planFingerprint: request.planFingerprint, tokenDigest, actorId: actor, kind: request.plan.kind, workRunId: request.plan.workRunId, receipt: null, diagnostics: [reason.slice(0, 256)] };
  return { ...base, fingerprint: fingerprintRecoveryValue(base) };
}

function responseFromClaim(claim: RecoveryApplyClaimV2, actor: string): RecoveryApplyResponseV2 {
  const base = { schemaVersion: RECOVERY_APPLY_SCHEMA_VERSION, state: claim.state, projectId: claim.projectId, planFingerprint: claim.planFingerprint, tokenDigest: claim.tokenDigest, actorId: actor, kind: claim.kind, workRunId: claim.workRunId, receipt: claim.receipt, diagnostics: claim.state === 'outcome-unknown' ? ['Owner outcome is unknown; reconcile before retrying.'] : [] };
  return { ...base, fingerprint: fingerprintRecoveryValue(base) };
}

function safeOwnerId(value: unknown, expected: string | null, label: string): string | null {
  if (typeof value !== 'string' || value !== expected || hasUnsafeRecoveryMaterial(value)) return null;
  try {
    return safeRecoveryText(value, label, { minBytes: 1, maxBytes: 256 });
  } catch {
    return null;
  }
}

function ownerReceipt(value: Record<string, unknown>, request: RecoveryApplyRequestV2, claim: RecoveryApplyClaimV2): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (value.ok === true || value.ok === false) result.ok = value.ok;
  if (value.idempotent === true || value.idempotent === false) result.idempotent = value.idempotent;
  const expectedProjectId = request.plan.projectId;
  const expectedWorkItemId = request.plan.workItemId;
  const expectedWorkRunId = claim.workRunId;
  const expectedAgent = claim.actorId;
  const projectId = safeOwnerId(value.projectId, expectedProjectId, 'ownerReceipt.projectId');
  const workItemId = safeOwnerId(value.workItemId, expectedWorkItemId, 'ownerReceipt.workItemId');
  const workRunId = expectedWorkRunId === null ? null : safeOwnerId(value.workRunId, expectedWorkRunId, 'ownerReceipt.workRunId');
  const agent = safeOwnerId(value.agent, expectedAgent, 'ownerReceipt.agent');
  if (projectId) result.projectId = projectId;
  if (workItemId) result.workItemId = workItemId;
  if (workRunId) result.workRunId = workRunId;
  if (agent) result.agent = agent;
  if (value.lifetime && typeof value.lifetime === 'object' && !Array.isArray(value.lifetime)) {
    const raw = value.lifetime as Record<string, unknown>;
    const lifetime: Record<string, unknown> = {};
    const lifetimeProjectId = safeOwnerId(raw.projectId, expectedProjectId, 'ownerReceipt.lifetime.projectId');
    const lifetimeWorkItemId = safeOwnerId(raw.workItemId, expectedWorkItemId, 'ownerReceipt.lifetime.workItemId');
    const lifetimeWorkRunId = expectedWorkRunId === null ? null : safeOwnerId(raw.workRunId, expectedWorkRunId, 'ownerReceipt.lifetime.workRunId');
    const lifetimeAgent = safeOwnerId(raw.agent, expectedAgent, 'ownerReceipt.lifetime.agent');
    if (lifetimeProjectId) lifetime.projectId = lifetimeProjectId;
    if (lifetimeWorkItemId) lifetime.workItemId = lifetimeWorkItemId;
    if (lifetimeWorkRunId) lifetime.workRunId = lifetimeWorkRunId;
    if (lifetimeAgent) lifetime.agent = lifetimeAgent;
    for (const key of ['workRunState', 'stage', 'status'] as const) {
      const item = raw[key];
      if (typeof item === 'string' && SAFE_OWNER_LIFETIME_VALUES[key].has(item)) lifetime[key] = item;
    }
    if (Object.keys(lifetime).length > 0) result.lifetime = lifetime;
  }
  return result;
}

function makeReceipt(request: RecoveryApplyRequestV2, claim: RecoveryApplyClaimV2, owner: Record<string, unknown>, recordedAt: string): RecoveryApplyReceiptV2 {
  const safeOwner = ownerReceipt(
    owner,
    request,
    claim.workRunId === null ? { ...claim, workRunId: recoveryCreateWorkRunId(request.plan) } : claim,
  );
  const ownerReceiptFingerprint = fingerprintRecoveryValue(safeOwner);
  const base = { schemaVersion: RECOVERY_APPLY_SCHEMA_VERSION, planFingerprint: request.planFingerprint, tokenDigest: claim.tokenDigest, projectId: request.plan.projectId, kind: request.plan.kind, workItemId: request.plan.workItemId, workRunId: request.plan.workRunId, ownerOperation: request.plan.kind === 'resume' ? 'workflow.agent.join' as const : 'workflow.recovery.create-and-join' as const, ownerReceiptFingerprint, ownerReceipt: safeOwner, recordedAt };
  return { ...base, fingerprint: fingerprintRecoveryValue(base) };
}

function projectSlug(projectId: string): string {
  return projectId.slice('project/'.length);
}

function recoveryCreateWorkRunId(plan: RecoveryPlanV2): string {
  return `work-run/recovery-${plan.fingerprint.slice('sha256:'.length, 'sha256:'.length + 32)}`;
}

/** Every file the apply owner can mutate is enumerated before the handler runs. */
export function recoveryApplyWriteTargets(ctx: OperationContext, params: Record<string, unknown>): string[] {
  const request = validateRecoveryApplyRequestV2(params.request);
  const actor = actorId(ctx);
  const project = projectSlug(request.plan.projectId);
  const workRunId = request.plan.workRunId ?? recoveryCreateWorkRunId(request.plan);
  return [
    `01-Projects/${project}/runs/recovery-plans/${request.planFingerprint.slice('sha256:'.length)}.json`,
    `01-Projects/${project}/runs/recovery-tokens/${digest(request.transitionToken).slice('sha256:'.length)}.json`,
    `01-Projects/${project}/runs/${workRunId.slice('work-run/'.length)}.json`,
    `.vault-mind/_leases.json`,
    `.vault-mind/_work-run.lock`,
    `01-Projects/${project}/agents/${actor}/lifetime.md`,
    `01-Projects/${project}/agents/${actor}/events.md`,
  ];
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function unknownFromTokenClaim(claim: RecoveryApplyClaimV2): RecoveryApplyClaimV2 {
  return { ...claim, state: 'outcome-unknown', receipt: null };
}

export function makeRecoveryApplyOperation(dependencies: RecoveryApplyDependencies | undefined): Operation {
  const inFlight = new Map<string, Deferred>();
  return {
    name: 'workflow.recovery.apply',
    namespace: 'workflow',
    description: 'Claim-first application of one exact Recovery Plan through Workflow-owned Work Run mutation.',
    mutating: true,
    writePolicy: {
      realWrite: 'always',
      targets: recoveryApplyWriteTargets,
      audit: 'required',
    },
    params: {
      request: { type: 'object', required: true, description: `Closed ${RECOVERY_APPLY_REQUEST_SCHEMA_VERSION} request.` },
    },
    handler: async (ctx, params) => {
      const request = validateRecoveryApplyRequestV2(params.request);
      const actor = actorId(ctx);
      const tokenDigest = digest(request.transitionToken);
      if (!dependencies) return unavailable(request, tokenDigest, actor, 'workflow.recovery.apply is unavailable');
      const { store } = dependencies;
      const project = projectSlug(request.plan.projectId);
      const initial = store.withLock(() => {
        const planClaim = claimFrom(store.readRecoveryClaim(project, request.planFingerprint));
        const tokenClaim = claimFrom(store.readRecoveryToken(project, tokenDigest));
        if (planClaim) {
          compareClaim(planClaim, request, actor);
          if (tokenClaim) compareClaim(tokenClaim, request, actor);
          return { claim: planClaim, tokenPresent: tokenClaim !== null, tokenOnly: false };
        }
        if (tokenClaim) {
          compareClaim(tokenClaim, request, actor);
          return { claim: unknownFromTokenClaim(tokenClaim), tokenPresent: true, tokenOnly: true };
        }
        return { claim: null, tokenPresent: false, tokenOnly: false };
      });
      if (initial.tokenOnly && initial.claim) return responseFromClaim(initial.claim, actor);

      const current = initial.claim;
      if (!current) {
        let capability: RecoveryApplyCapability | undefined;
        try {
          capability = await dependencies.loadApplyCapability?.();
        } catch {
          capability = undefined;
        }
        if (capability?.capability !== 'workflow.recovery.apply' || capability.state !== 'available') {
          return unavailable(request, tokenDigest, actor, 'workflow.recovery.apply is unavailable');
        }
        if (Date.parse(request.plan.createdAt) > dependencies.now()) return unavailable(request, tokenDigest, actor, 'Recovery Plan is from the future');
        try {
          await dependencies.recomputeCurrentPlanBasis(request.plan, request.planningInput);
        } catch {
          return unavailable(request, tokenDigest, actor, 'Recovery Plan basis is unavailable or stale');
        }
        const nowMs = dependencies.now();
        if (nowMs >= Date.parse(request.plan.expiresAt)) return unavailable(request, tokenDigest, actor, 'Recovery Plan is expired');
      }

      let startOwner = false;
      let ownerWaiter: Deferred | undefined;
      const claim = store.withLock<RecoveryApplyClaimV2>(() => {
        let planClaim = claimFrom(store.readRecoveryClaim(project, request.planFingerprint));
        const tokenClaim = claimFrom(store.readRecoveryToken(project, tokenDigest));
        if (planClaim) {
          compareClaim(planClaim, request, actor);
          if (tokenClaim) compareClaim(tokenClaim, request, actor);
          if (!tokenClaim) {
            try {
              store.writeRecoveryTokenAtomic(project, tokenDigest, planClaim as unknown as Record<string, unknown>);
            } catch {
              return planClaim;
            }
          }
        } else if (tokenClaim) {
          compareClaim(tokenClaim, request, actor);
          return unknownFromTokenClaim(tokenClaim);
        } else {
          const now = new Date(dependencies.now()).toISOString();
          planClaim = {
            schemaVersion: RECOVERY_APPLY_SCHEMA_VERSION,
            planFingerprint: request.planFingerprint,
            tokenDigest,
            planningInputDigest: fingerprintRecoveryValue(request.planningInput),
            actorId: actor,
            projectId: request.plan.projectId,
            kind: request.plan.kind,
            workItemId: request.plan.workItemId,
            workRunId: request.plan.workRunId,
            state: 'claimed',
            receipt: null,
            claimedAt: now,
            updatedAt: now,
            ownerStarted: false,
          };
          // The Plan index is authoritative and must precede its token index.
          store.writeRecoveryClaimAtomic(project, request.planFingerprint, planClaim as unknown as Record<string, unknown>);
          try {
            store.writeRecoveryTokenAtomic(project, tokenDigest, planClaim as unknown as Record<string, unknown>);
          } catch {
            return planClaim;
          }
        }
        if (planClaim.state === 'claimed' && !planClaim.ownerStarted) {
          const started = { ...planClaim, ownerStarted: true, updatedAt: new Date(dependencies.now()).toISOString() };
          store.writeRecoveryClaimAtomic(project, request.planFingerprint, started as unknown as Record<string, unknown>);
          try {
            store.writeRecoveryTokenAtomic(project, tokenDigest, started as unknown as Record<string, unknown>);
          } catch {
            // The Plan marker is authoritative; the next request repairs the token index.
          }
          ownerWaiter = deferred();
          inFlight.set(`${request.planFingerprint}:${tokenDigest}`, ownerWaiter);
          startOwner = true;
          return started;
        }
        return planClaim;
      });
      if (claim.tokenDigest !== tokenDigest || claim.state === 'outcome-unknown' && !startOwner) return responseFromClaim(claim, actor);
      if (claim.state === 'applied' || claim.state === 'outcome-unknown') return responseFromClaim(claim, actor);

      if (!startOwner) {
        const pending = inFlight.get(`${request.planFingerprint}:${tokenDigest}`);
        if (pending) {
          await pending.promise;
          const latest = store.withLock(() => claimFrom(store.readRecoveryClaim(project, request.planFingerprint)));
          return latest ? responseFromClaim(latest, actor) : responseFromClaim(claim, actor);
        }
        return responseFromClaim(claim, actor);
      }

      try {
        const owner = request.plan.kind === 'resume'
          ? await dependencies.join(request.plan, actor, request.transitionToken)
          : await dependencies.createAndJoin(request.plan, actor, request.transitionToken);
        const receipt = makeReceipt(request, claim, owner, new Date(dependencies.now()).toISOString());
        const applied = { ...claim, state: 'applied' as const, receipt, updatedAt: new Date(dependencies.now()).toISOString() };
        store.withLock(() => {
          const latest = claimFrom(store.readRecoveryClaim(project, request.planFingerprint));
          if (latest) compareClaim(latest, request, actor);
          store.writeRecoveryClaimAtomic(project, request.planFingerprint, applied as unknown as Record<string, unknown>);
          try {
            store.writeRecoveryTokenAtomic(project, tokenDigest, applied as unknown as Record<string, unknown>);
          } catch {
            // The authoritative Plan receipt is durable; the next request repairs this index.
          }
        });
        ownerWaiter?.resolve();
        inFlight.delete(`${request.planFingerprint}:${tokenDigest}`);
        return responseFromClaim(applied, actor);
      } catch {
        const unknown = { ...claim, state: 'outcome-unknown' as const, receipt: null, updatedAt: new Date(dependencies.now()).toISOString() };
        try {
          store.withLock(() => {
            store.writeRecoveryClaimAtomic(project, request.planFingerprint, unknown as unknown as Record<string, unknown>);
            try {
              store.writeRecoveryTokenAtomic(project, tokenDigest, unknown as unknown as Record<string, unknown>);
            } catch {
              // The authoritative Plan outcome-unknown marker is enough to block replay.
            }
          });
        } finally {
          ownerWaiter?.resolve();
          inFlight.delete(`${request.planFingerprint}:${tokenDigest}`);
        }
        return responseFromClaim(unknown, actor);
      }
    },
  };
}
