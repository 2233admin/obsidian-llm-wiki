import { createHash } from 'node:crypto';
import { assertClosedRecoveryObject, fingerprintRecoveryValue, safeRecoveryText, type RecoveryFingerprint } from '../project-hub/contract-support.js';
import { validateRecoveryPlanV2, type RecoveryPlanV2 } from '../project-hub/recovery-flow.js';
import { conflict, makeErr, type Operation, type OperationContext } from '../core/types.js';
import type { WorkRunStore } from './work-run-store.js';

export const RECOVERY_APPLY_REQUEST_SCHEMA_VERSION = 'recovery-apply-request/v2' as const;
export const RECOVERY_APPLY_SCHEMA_VERSION = 'recovery-apply/v2' as const;

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

function ownerReceipt(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/path|token|secret|credential|password|environment|workspace/i.test(key)) continue;
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' || item === null) result[key] = item;
    else if (key === 'lifetime' && item && typeof item === 'object' && !Array.isArray(item)) {
      const lifetime = item as Record<string, unknown>;
      result[key] = Object.fromEntries(['projectId', 'workRunId', 'workItemId', 'agent', 'workRunState', 'stage', 'status'].filter((name) => lifetime[name] !== undefined).map((name) => [name, lifetime[name]]));
    }
  }
  return result;
}

function makeReceipt(request: RecoveryApplyRequestV2, claim: RecoveryApplyClaimV2, owner: Record<string, unknown>, recordedAt: string): RecoveryApplyReceiptV2 {
  const safeOwner = ownerReceipt(owner);
  const ownerReceiptFingerprint = fingerprintRecoveryValue(safeOwner);
  const base = { schemaVersion: RECOVERY_APPLY_SCHEMA_VERSION, planFingerprint: request.planFingerprint, tokenDigest: claim.tokenDigest, projectId: request.plan.projectId, kind: request.plan.kind, workItemId: request.plan.workItemId, workRunId: request.plan.workRunId, ownerOperation: request.plan.kind === 'resume' ? 'workflow.agent.join' as const : 'workflow.recovery.create-and-join' as const, ownerReceiptFingerprint, ownerReceipt: safeOwner, recordedAt };
  return { ...base, fingerprint: fingerprintRecoveryValue(base) };
}

export function makeRecoveryApplyOperation(dependencies: RecoveryApplyDependencies | undefined): Operation {
  return {
    name: 'workflow.recovery.apply',
    namespace: 'workflow',
    description: 'Claim-first application of one exact Recovery Plan through Workflow-owned Work Run mutation.',
    mutating: true,
    writePolicy: {
      realWrite: 'always',
      targets: () => ['01-Projects/**/runs/**', '.vault-mind/_leases.json'],
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
      const current = store.withLock(() => {
        const existingPlan = claimFrom(store.readRecoveryClaim(request.plan.projectId.slice('project/'.length), request.planFingerprint));
        const existingToken = claimFrom(store.readRecoveryToken(request.plan.projectId.slice('project/'.length), tokenDigest));
        if (existingPlan) {
          compareClaim(existingPlan, request, actor);
          if (existingToken) compareClaim(existingToken, request, actor);
        } else if (existingToken) {
          compareClaim(existingToken, request, actor);
        }
        return existingPlan ?? existingToken;
      });
      if (current && current.tokenDigest !== tokenDigest) return responseFromClaim(current, actor);
      if (current && current.state === 'applied') return responseFromClaim(current, actor);
      if (current && current.state === 'outcome-unknown') return responseFromClaim(current, actor);

      if (!current) {
        try {
          await dependencies.recomputeCurrentPlanBasis(request.plan, request.planningInput);
        } catch {
          return unavailable(request, tokenDigest, actor, 'Recovery Plan basis is unavailable or stale');
        }
        if (dependencies.now() >= Date.parse(request.plan.expiresAt)) return unavailable(request, tokenDigest, actor, 'Recovery Plan is expired');
      }

      const now = new Date(dependencies.now()).toISOString();
      const claim = store.withLock<RecoveryApplyClaimV2>(() => {
        const planClaim = claimFrom(store.readRecoveryClaim(request.plan.projectId.slice('project/'.length), request.planFingerprint));
        const tokenClaim = claimFrom(store.readRecoveryToken(request.plan.projectId.slice('project/'.length), tokenDigest));
        if (planClaim) {
          compareClaim(planClaim, request, actor);
          if (planClaim.tokenDigest !== tokenDigest) return planClaim;
        }
        if (tokenClaim) {
          compareClaim(tokenClaim, request, actor);
          return tokenClaim;
        }
        const created: RecoveryApplyClaimV2 = {
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
        };
        store.writeRecoveryClaimAtomic(request.plan.projectId.slice('project/'.length), request.planFingerprint, created as unknown as Record<string, unknown>);
        store.writeRecoveryTokenAtomic(request.plan.projectId.slice('project/'.length), tokenDigest, created as unknown as Record<string, unknown>);
        return created;
      });
      if (claim.tokenDigest !== tokenDigest) return responseFromClaim(claim, actor);
      if (claim.state === 'applied' || claim.state === 'outcome-unknown') return responseFromClaim(claim, actor);

      try {
        const owner = request.plan.kind === 'resume'
          ? await dependencies.join(request.plan, actor, request.transitionToken)
          : await dependencies.createAndJoin(request.plan, actor, request.transitionToken);
        const receipt = makeReceipt(request, claim, owner, new Date(dependencies.now()).toISOString());
        const applied = { ...claim, state: 'applied' as const, receipt, updatedAt: new Date(dependencies.now()).toISOString() };
        store.withLock(() => {
          const latest = claimFrom(store.readRecoveryClaim(request.plan.projectId.slice('project/'.length), request.planFingerprint));
          if (latest) compareClaim(latest, request, actor);
          store.writeRecoveryClaimAtomic(request.plan.projectId.slice('project/'.length), request.planFingerprint, applied as unknown as Record<string, unknown>);
          store.writeRecoveryTokenAtomic(request.plan.projectId.slice('project/'.length), tokenDigest, applied as unknown as Record<string, unknown>);
        });
        return responseFromClaim(applied, actor);
      } catch {
        const unknown = { ...claim, state: 'outcome-unknown' as const, receipt: null, updatedAt: new Date(dependencies.now()).toISOString() };
        store.withLock(() => {
          store.writeRecoveryClaimAtomic(request.plan.projectId.slice('project/'.length), request.planFingerprint, unknown as unknown as Record<string, unknown>);
          store.writeRecoveryTokenAtomic(request.plan.projectId.slice('project/'.length), tokenDigest, unknown as unknown as Record<string, unknown>);
        });
        return responseFromClaim(unknown, actor);
      }
    },
  };
}
