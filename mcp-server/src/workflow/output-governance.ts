import { createHash } from 'node:crypto';
import {
  assertClosedRecoveryObject,
  fingerprintRecoveryValue,
  hasUnsafeRecoveryMaterial,
  safeRecoveryText,
  utf8JsonBytes,
  type RecoveryFingerprint,
} from '../project-hub/contract-support.js';
import type { RecoveryFlowDiagnosticV2 } from '../project-hub/recovery-flow.js';
import { badRequest, conflict, type OperationContext } from '../core/types.js';
import type { WorkRunStore } from './work-run-store.js';

export const WORK_RUN_OUTPUT_SUBMISSION_SCHEMA = 'work-run-output-submission/v1' as const;
export const WORK_RUN_OUTPUT_SCHEMA = 'work-run-output/v1' as const;
export const WORK_RUN_OUTPUT_ROUTE_SCHEMA = 'work-run-output-route/v1' as const;

export const WORK_RUN_OUTPUT_CLASSES = [
  'view', 'work-state-transition', 'knowledge-claim', 'external-side-effect',
] as const;
export type WorkRunOutputClass = (typeof WORK_RUN_OUTPUT_CLASSES)[number];

export interface WorkRunOutputV1 {
  schemaVersion: typeof WORK_RUN_OUTPUT_SCHEMA;
  projectId: string;
  workItemId: string;
  workRunId: string;
  outputClass: WorkRunOutputClass;
  payload: unknown;
  citations: string[];
  provenance: string[];
  producedAt: string;
  fingerprint: RecoveryFingerprint;
  approval?: { status: 'approved'; fingerprint: RecoveryFingerprint; actor: string };
}

export interface WorkRunOutputQuarantineV1 {
  schemaVersion: 'work-run-output-quarantine/v1';
  projectId: string;
  workItemId: string;
  workRunId: string;
  observedClass: WorkRunOutputClass | null;
  payloadFingerprint: RecoveryFingerprint | null;
  provenance: string[];
  diagnostics: RecoveryFlowDiagnosticV2[];
  producedAt: string;
  fingerprint: RecoveryFingerprint;
}

export interface WorkRunOutputSubmissionV1 {
  schemaVersion: typeof WORK_RUN_OUTPUT_SUBMISSION_SCHEMA;
  result: 'output' | 'quarantine';
  output: WorkRunOutputV1 | null;
  quarantine: WorkRunOutputQuarantineV1 | null;
}

export type WorkflowAgentLeaveRequestV2 =
  | {
      mode: 'complete'; project: string; agent: string; work_run_id: string; transition_token: string;
      target_state: 'completed' | 'awaiting_review'; submission: WorkRunOutputSubmissionV1; summary: string;
    }
  | {
      mode: 'terminate'; project: string; agent: string; work_run_id: string; transition_token: string;
      target_state: 'failed' | 'cancelled'; submission: null; summary: string;
    };

export interface WorkRunOutputRouteReceiptV1 {
  schemaVersion: typeof WORK_RUN_OUTPUT_ROUTE_SCHEMA;
  outputFingerprint: RecoveryFingerprint;
  tokenDigest: RecoveryFingerprint;
  state: 'accepted' | 'review-required' | 'denied' | 'outcome-unknown';
  ownerOperation: string | null;
  ownerReceiptFingerprint: RecoveryFingerprint | null;
  diagnostics: RecoveryFlowDiagnosticV2[];
  recordedAt: string;
  fingerprint: RecoveryFingerprint;
}

export interface OutputGovernanceOwnerResult {
  ownerOperation: string | null;
  ownerReceipt: Record<string, unknown> | null;
  state?: WorkRunOutputRouteReceiptV1['state'];
  diagnostics?: RecoveryFlowDiagnosticV2[];
}

export interface OutputGovernanceDependencies {
  store: WorkRunStore;
  now?: () => number;
  owner: (
    request: WorkflowAgentLeaveRequestV2,
    actor: string,
    output: WorkRunOutputV1 | null,
    quarantine: WorkRunOutputQuarantineV1 | null,
  ) => Promise<OutputGovernanceOwnerResult>;
}

const OWNER: RecoveryFlowDiagnosticV2['owner'] = 'workflow';
const RECOVERY_OWNERS = new Set(['project', 'work-os', 'workflow', 'project-memory', 'session-record', 'source-evidence', 'agent-domain', 'settings']);
const DIAGNOSTIC_KEYS = ['owner', 'code', 'severity', 'message', 'remediation', 'citationTargets'] as const;

function digest(value: unknown): RecoveryFingerprint {
  return `sha256:${createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')}`;
}

function bounded(value: unknown, label: string, max = 512): string {
  try { return safeRecoveryText(value, label, { minBytes: 1, maxBytes: max }); }
  catch (error) { throw badRequest((error as Error).message); }
}

function fingerprint(value: unknown, label: string): RecoveryFingerprint {
  const result = bounded(value, label, 80);
  if (!/^sha256:[a-f0-9]{64}$/u.test(result)) throw badRequest(`${label} must be a SHA-256 fingerprint`);
  return result as RecoveryFingerprint;
}

function identity(value: unknown, label: string, expression: RegExp): string {
  const result = bounded(value, label, 256);
  if (!expression.test(result)) throw badRequest(`${label} has an invalid identity`);
  return result;
}

function list(value: unknown, label: string, maxItems: number, maxBytes = 1024): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxItems) throw badRequest(`${label} must contain 1-${maxItems} items`);
  const result = value.map((item) => bounded(item, label, maxBytes));
  if (new Set(result).size !== result.length) throw badRequest(`${label} must not contain duplicates`);
  return result;
}

function diagnostic(value: unknown, label: string): RecoveryFlowDiagnosticV2 {
  const entry = assertClosedRecoveryObject(value, DIAGNOSTIC_KEYS, label);
  const severity = entry.severity;
  if (severity !== 'info' && severity !== 'warning' && severity !== 'error') throw badRequest(`${label}.severity is invalid`);
  const owner = bounded(entry.owner, `${label}.owner`, 64);
  if (!RECOVERY_OWNERS.has(owner)) throw badRequest(`${label}.owner is invalid`);
  return {
    owner: owner as RecoveryFlowDiagnosticV2['owner'],
    code: bounded(entry.code, `${label}.code`, 128), severity,
    message: bounded(entry.message, `${label}.message`, 1024),
    remediation: bounded(entry.remediation, `${label}.remediation`, 1024),
    citationTargets: Array.isArray(entry.citationTargets) ? entry.citationTargets.map((item) => bounded(item, `${label}.citationTargets`, 256)).slice(0, 8) : [],
  };
}

function validateOutput(value: unknown, projectId: string, workItemId: string, workRunId: string): WorkRunOutputV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw badRequest('output must be an object');
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) if (key === 'approval') continue; else if (!['schemaVersion', 'projectId', 'workItemId', 'workRunId', 'outputClass', 'payload', 'citations', 'provenance', 'producedAt', 'fingerprint'].includes(key)) throw badRequest(`output contains unknown field ${key}`);
  const entry = assertClosedRecoveryObject(Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'approval')), ['schemaVersion', 'projectId', 'workItemId', 'workRunId', 'outputClass', 'payload', 'citations', 'provenance', 'producedAt', 'fingerprint'], 'output');
  if (Object.prototype.hasOwnProperty.call(raw, 'approval')) entry.approval = raw.approval;
  if (entry.schemaVersion !== WORK_RUN_OUTPUT_SCHEMA) throw badRequest('output has an invalid schema version');
  if (entry.projectId !== projectId || entry.workItemId !== workItemId || entry.workRunId !== workRunId) throw conflict('Output identity does not match the Work Run');
  if (!WORK_RUN_OUTPUT_CLASSES.includes(entry.outputClass as WorkRunOutputClass)) throw badRequest('output.outputClass is invalid');
  if (hasUnsafeRecoveryMaterial(entry.payload)) throw badRequest('output.payload contains unsafe material');
  if (utf8JsonBytes(entry.payload) > 64 * 1024) throw badRequest('output.payload exceeds 64 KiB');
  const citations = list(entry.citations, 'output.citations', 16, 512);
  const provenance = list(entry.provenance, 'output.provenance', 16, 512);
  const producedAt = bounded(entry.producedAt, 'output.producedAt', 64);
  const suppliedFingerprint = fingerprint(entry.fingerprint, 'output.fingerprint');
  const material = { schemaVersion: WORK_RUN_OUTPUT_SCHEMA, projectId, workItemId, workRunId, outputClass: entry.outputClass, payload: entry.payload, citations, provenance, producedAt, ...(entry.approval === undefined ? {} : { approval: entry.approval }) };
  if (fingerprintRecoveryValue(material) !== suppliedFingerprint) throw conflict('output.fingerprint does not match output content');
  let approval: WorkRunOutputV1['approval'];
  if (entry.approval !== undefined) {
    const approvalEntry = assertClosedRecoveryObject(entry.approval, ['status', 'fingerprint', 'actor'], 'output.approval');
    if (approvalEntry.status !== 'approved') throw badRequest('output.approval.status must be approved');
    approval = { status: 'approved', fingerprint: fingerprint(approvalEntry.fingerprint, 'output.approval.fingerprint'), actor: bounded(approvalEntry.actor, 'output.approval.actor', 128) };
  }
  return { schemaVersion: WORK_RUN_OUTPUT_SCHEMA, projectId, workItemId, workRunId, outputClass: entry.outputClass as WorkRunOutputClass, payload: entry.payload, citations, provenance, producedAt, fingerprint: suppliedFingerprint, ...(approval ? { approval } : {}) };
}

function validateQuarantine(value: unknown, projectId: string, workItemId: string, workRunId: string): WorkRunOutputQuarantineV1 {
  const entry = assertClosedRecoveryObject(value, ['schemaVersion', 'projectId', 'workItemId', 'workRunId', 'observedClass', 'payloadFingerprint', 'provenance', 'diagnostics', 'producedAt', 'fingerprint'], 'quarantine');
  if (entry.schemaVersion !== 'work-run-output-quarantine/v1') throw badRequest('quarantine has an invalid schema version');
  if (entry.projectId !== projectId || entry.workItemId !== workItemId || entry.workRunId !== workRunId) throw conflict('Quarantine identity does not match the Work Run');
  if (entry.observedClass !== null && !WORK_RUN_OUTPUT_CLASSES.includes(entry.observedClass as WorkRunOutputClass)) throw badRequest('quarantine.observedClass is invalid');
  const payloadFingerprint = entry.payloadFingerprint === null ? null : fingerprint(entry.payloadFingerprint, 'quarantine.payloadFingerprint');
  const provenance = list(entry.provenance, 'quarantine.provenance', 16, 512);
  if (!Array.isArray(entry.diagnostics) || entry.diagnostics.length < 1 || entry.diagnostics.length > 16) throw badRequest('quarantine.diagnostics must contain 1-16 items');
  const diagnostics = entry.diagnostics.map((item, index) => diagnostic(item, `quarantine.diagnostics[${index}]`));
  const producedAt = bounded(entry.producedAt, 'quarantine.producedAt', 64);
  const suppliedFingerprint = fingerprint(entry.fingerprint, 'quarantine.fingerprint');
  const material = { schemaVersion: 'work-run-output-quarantine/v1', projectId, workItemId, workRunId, observedClass: entry.observedClass, payloadFingerprint, provenance, diagnostics, producedAt };
  if (fingerprintRecoveryValue(material) !== suppliedFingerprint) throw conflict('quarantine.fingerprint does not match quarantine content');
  return { schemaVersion: 'work-run-output-quarantine/v1', projectId, workItemId, workRunId, observedClass: entry.observedClass as WorkRunOutputClass | null, payloadFingerprint, provenance, diagnostics, producedAt, fingerprint: suppliedFingerprint };
}

export function validateWorkRunOutputSubmissionV1(value: unknown, projectId: string, workItemId: string, workRunId: string): WorkRunOutputSubmissionV1 {
  const entry = assertClosedRecoveryObject(value, ['schemaVersion', 'result', 'output', 'quarantine'], 'submission');
  if (entry.schemaVersion !== WORK_RUN_OUTPUT_SUBMISSION_SCHEMA) throw badRequest('submission has an invalid schema version');
  if (entry.result === 'output') {
    if (entry.output === null || entry.quarantine !== null) throw badRequest('output submission must contain output and quarantine:null');
    return { schemaVersion: WORK_RUN_OUTPUT_SUBMISSION_SCHEMA, result: 'output', output: validateOutput(entry.output, projectId, workItemId, workRunId), quarantine: null };
  }
  if (entry.result === 'quarantine') {
    if (entry.output !== null || entry.quarantine === null) throw badRequest('quarantine submission must contain quarantine and output:null');
    return { schemaVersion: WORK_RUN_OUTPUT_SUBMISSION_SCHEMA, result: 'quarantine', output: null, quarantine: validateQuarantine(entry.quarantine, projectId, workItemId, workRunId) };
  }
  throw badRequest('submission.result must be output or quarantine');
}

export function validateWorkflowAgentLeaveRequestV2(value: unknown): WorkflowAgentLeaveRequestV2 {
  const entry = assertClosedRecoveryObject(value, ['mode', 'project', 'agent', 'work_run_id', 'transition_token', 'target_state', 'submission', 'summary'], 'workflow.agent.leave');
  const project = identity(entry.project, 'project', /^project\/[a-z0-9][a-z0-9-]*$/u);
  const agent = identity(entry.agent, 'agent', /^[A-Za-z0-9][A-Za-z0-9._-]*$/u);
  const workRunId = identity(entry.work_run_id, 'work_run_id', /^work-run\/[a-z0-9][a-z0-9-]*$/u);
  const token = identity(entry.transition_token, 'transition_token', /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
  const summary = bounded(entry.summary, 'summary', 2_000);
  if (entry.mode === 'complete') {
    if (entry.target_state !== 'completed' && entry.target_state !== 'awaiting_review') throw badRequest('complete target_state must be completed or awaiting_review');
    if (entry.submission === null) throw badRequest('complete mode requires submission');
    if (typeof entry.submission !== 'object' || entry.submission === null || Array.isArray(entry.submission)) throw badRequest('complete mode submission must be an object');
    const rawSubmission = entry.submission as Record<string, unknown>;
    const rawArm = rawSubmission.result === 'output' ? rawSubmission.output : rawSubmission.quarantine;
    const workItemId = rawArm && typeof rawArm === 'object' && !Array.isArray(rawArm)
      ? (rawArm as Record<string, unknown>).workItemId
      : undefined;
    if (!workItemId) throw badRequest('complete mode requires exact work item identity');
    if (typeof workItemId !== 'string') throw badRequest('complete mode requires exact work item identity');
    return { mode: 'complete', project, agent, work_run_id: workRunId, transition_token: token, target_state: entry.target_state, submission: validateWorkRunOutputSubmissionV1(entry.submission, project, workItemId, workRunId), summary };
  }
  if (entry.mode === 'terminate') {
    if (entry.target_state !== 'failed' && entry.target_state !== 'cancelled') throw badRequest('terminate target_state must be failed or cancelled');
    if (entry.submission !== null) throw badRequest('terminate mode requires submission:null');
    return { mode: 'terminate', project, agent, work_run_id: workRunId, transition_token: token, target_state: entry.target_state, submission: null, summary };
  }
  throw badRequest('mode must be complete or terminate');
}

interface OutputClaim {
  schemaVersion: typeof WORK_RUN_OUTPUT_ROUTE_SCHEMA;
  outputFingerprint: RecoveryFingerprint;
  requestDigest: RecoveryFingerprint;
  tokenDigest: RecoveryFingerprint;
  actorId: string;
  projectId: string;
  workItemId: string | null;
  workRunId: string;
  targetState: string;
  state: 'claimed' | 'routed' | 'outcome-unknown';
  receipt: WorkRunOutputRouteReceiptV1 | null;
  ownerStarted: boolean;
  claimedAt: string;
  updatedAt: string;
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

const inFlight = new Map<string, Deferred>();

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function actorFromContext(ctx: OperationContext): string {
  return identity(ctx.config.collaboration?.actor ?? process.env.VAULT_MIND_ACTOR ?? 'agent', 'authenticated actor', /^[A-Za-z0-9][A-Za-z0-9._-]*$/u);
}

function tokenDigest(token: string): RecoveryFingerprint { return digest({ transitionToken: token }); }

function requestFingerprint(request: WorkflowAgentLeaveRequestV2): RecoveryFingerprint {
  return fingerprintRecoveryValue({ ...request, transition_token: undefined });
}

function receipt(request: WorkflowAgentLeaveRequestV2, claim: OutputClaim, result: OutputGovernanceOwnerResult, now: string): WorkRunOutputRouteReceiptV1 {
  const ownerReceipt = result.ownerReceipt && !hasUnsafeRecoveryMaterial(result.ownerReceipt) ? result.ownerReceipt : null;
  const ownerReceiptFingerprint = ownerReceipt ? fingerprintRecoveryValue(ownerReceipt) : null;
  const base = { schemaVersion: WORK_RUN_OUTPUT_ROUTE_SCHEMA, outputFingerprint: claim.outputFingerprint, tokenDigest: claim.tokenDigest, state: result.state ?? (request.mode === 'complete' && request.submission?.result === 'quarantine' ? 'review-required' : 'accepted'), ownerOperation: result.ownerOperation, ownerReceiptFingerprint, diagnostics: (result.diagnostics ?? []).slice(0, 16), recordedAt: now } satisfies Omit<WorkRunOutputRouteReceiptV1, 'fingerprint'>;
  return { ...base, fingerprint: fingerprintRecoveryValue(base) };
}

function outputFingerprint(request: WorkflowAgentLeaveRequestV2): RecoveryFingerprint {
  if (request.mode === 'terminate') return requestFingerprint(request);
  return request.submission.result === 'output' ? request.submission.output!.fingerprint : request.submission.quarantine!.fingerprint;
}

function claimFrom(value: Record<string, unknown> | null): OutputClaim | null {
  if (!value) return null;
  if (value.schemaVersion !== WORK_RUN_OUTPUT_ROUTE_SCHEMA || typeof value.outputFingerprint !== 'string' || typeof value.requestDigest !== 'string' || typeof value.tokenDigest !== 'string' || typeof value.actorId !== 'string' || typeof value.projectId !== 'string' || typeof value.workRunId !== 'string' || (value.state !== 'claimed' && value.state !== 'routed' && value.state !== 'outcome-unknown')) throw conflict('Work Run output claim is malformed');
  return value as unknown as OutputClaim;
}

function responseFrom(claim: OutputClaim): WorkRunOutputRouteReceiptV1 {
  if (!claim.receipt) return receipt({ mode: 'terminate', project: claim.projectId, agent: claim.actorId, work_run_id: claim.workRunId, transition_token: 'recovery', target_state: 'failed', submission: null, summary: 'recovery' }, claim, { ownerOperation: null, ownerReceipt: null, state: claim.state === 'outcome-unknown' || claim.ownerStarted ? 'outcome-unknown' : 'review-required', diagnostics: [{ owner: OWNER, code: 'owner-receipt-unavailable', severity: 'error', message: 'Owner receipt is unavailable.', remediation: 'Reconcile the Work Run before retrying.', citationTargets: [] }] }, claim.updatedAt);
  return claim.receipt;
}

export async function governWorkRunOutput(
  dependencies: OutputGovernanceDependencies,
  ctx: OperationContext,
  request: unknown,
): Promise<WorkRunOutputRouteReceiptV1> {
  const normalized = validateWorkflowAgentLeaveRequestV2(request);
  const actor = actorFromContext(ctx);
  const outputFp = outputFingerprint(normalized);
  const tokenFp = tokenDigest(normalized.transition_token);
  const requestFp = requestFingerprint(normalized);
  const project = normalized.project.slice('project/'.length);
  const now = () => new Date(dependencies.now?.() ?? Date.now()).toISOString();
  let startOwner = false;
  let waiter: Deferred | undefined;
  const claim = dependencies.store.withLock(() => {
    const outputClaim = claimFrom(dependencies.store.readOutputClaim(project, outputFp));
    const tokenClaim = claimFrom(dependencies.store.readOutputToken(project, tokenFp));
    if (outputClaim || tokenClaim) {
      const current = outputClaim ?? tokenClaim!;
      if (current.outputFingerprint !== outputFp || current.requestDigest !== requestFp || current.tokenDigest !== tokenFp || current.actorId !== actor || current.projectId !== normalized.project || current.workRunId !== normalized.work_run_id) throw conflict('Work Run output claim is already bound to another request');
      if (tokenClaim && !outputClaim) return current;
      if (current.state === 'claimed' && current.ownerStarted) waiter = inFlight.get(`${project}:${outputFp}`);
      return current;
    }
    const created: OutputClaim = {
      schemaVersion: WORK_RUN_OUTPUT_ROUTE_SCHEMA, outputFingerprint: outputFp, requestDigest: requestFp, tokenDigest: tokenFp, actorId: actor,
      projectId: normalized.project, workItemId: normalized.mode === 'complete' ? (normalized.submission.output?.workItemId ?? normalized.submission.quarantine?.workItemId ?? null) : null,
      workRunId: normalized.work_run_id, targetState: normalized.target_state, state: 'claimed', receipt: null, ownerStarted: true, claimedAt: now(), updatedAt: now(),
    };
    dependencies.store.writeOutputClaimAtomic(project, outputFp, created as unknown as Record<string, unknown>);
    try { dependencies.store.writeOutputTokenAtomic(project, tokenFp, created as unknown as Record<string, unknown>); } catch { /* canonical output claim repairs the token index */ }
    startOwner = true;
    waiter = deferred();
    inFlight.set(`${project}:${outputFp}`, waiter);
    return created;
  });
  if (!startOwner) {
    if (waiter) {
      await waiter.promise;
      const latest = dependencies.store.withLock(() => claimFrom(dependencies.store.readOutputClaim(project, outputFp)));
      return latest ? responseFrom(latest) : responseFrom(claim);
    }
    return responseFrom(claim);
  }
  try {
    const result = await dependencies.owner(normalized, actor, normalized.mode === 'complete' && normalized.submission.result === 'output' ? normalized.submission.output : null, normalized.mode === 'complete' && normalized.submission.result === 'quarantine' ? normalized.submission.quarantine : null);
    const routed = receipt(normalized, claim, result, now());
    const completed: OutputClaim = { ...claim, state: routed.state === 'outcome-unknown' ? 'outcome-unknown' : 'routed', receipt: routed, updatedAt: now() };
    dependencies.store.withLock(() => {
      dependencies.store.writeOutputClaimAtomic(project, outputFp, completed as unknown as Record<string, unknown>);
      try { dependencies.store.writeOutputTokenAtomic(project, tokenFp, completed as unknown as Record<string, unknown>); } catch { /* output claim remains authoritative */ }
    });
    waiter?.resolve();
    inFlight.delete(`${project}:${outputFp}`);
    return routed;
  } catch {
    const unknown: OutputClaim = { ...claim, state: 'outcome-unknown', receipt: null, updatedAt: now() };
    try {
      dependencies.store.withLock(() => {
        dependencies.store.writeOutputClaimAtomic(project, outputFp, unknown as unknown as Record<string, unknown>);
        try { dependencies.store.writeOutputTokenAtomic(project, tokenFp, unknown as unknown as Record<string, unknown>); } catch { /* canonical claim is durable */ }
      });
    } finally {
      waiter?.resolve();
      inFlight.delete(`${project}:${outputFp}`);
    }
    return receipt(normalized, unknown, { ownerOperation: null, ownerReceipt: null, state: 'outcome-unknown', diagnostics: [{ owner: OWNER, code: 'owner-outcome-unknown', severity: 'error', message: 'Owner outcome is unknown.', remediation: 'Reconcile before retrying.', citationTargets: [] }] }, now());
  }
}
