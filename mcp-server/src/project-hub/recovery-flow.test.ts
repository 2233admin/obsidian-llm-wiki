import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
  RECOVERY_FLOW_SCHEMA_VERSION,
  RECOVERY_PLAN_SCHEMA_VERSION,
  RECOVERY_STALE_PROOF_SCHEMA_VERSION,
  deriveRecoveryFlowRequests,
  fingerprintRecoveryFlowIntrinsicStage,
  validateRecoveryFlowRequestV2,
  validateRecoveryFlowResponseV2,
  validateRecoveryPlanV2,
  type RecoveryFlowResponseV2,
  type RecoveryOwnerLock,
  type RecoveryStaleProofV2,
} from './recovery-flow.js';
import { fingerprintRecoveryValue } from './contract-support.js';

const digest = (seed: string) => `sha256:${seed.padEnd(64, '0').slice(0, 64)}` as `sha256:${string}`;
const lock: RecoveryOwnerLock = { owner: 'project', revision: 1, fingerprint: digest('a'), state: 'current' };
const locks = [lock];
const proofWithoutFingerprint = {
  schemaVersion: RECOVERY_STALE_PROOF_SCHEMA_VERSION,
  projectId: 'project/alpha',
  rootOpenFlowFingerprint: digest('b'),
  priorFlowFingerprint: digest('c'),
  priorActionInputFingerprint: digest('d'),
  recoveryFingerprint: digest('e'),
  changedOwners: ['project' as const],
  citationTargets: ['01-Projects/alpha/issues/one.md'],
};
const staleProof: RecoveryStaleProofV2 = {
  ...proofWithoutFingerprint,
  fingerprint: fingerprintRecoveryValue(proofWithoutFingerprint),
};

function openResponse(): RecoveryFlowResponseV2 {
  const payload = { kind: 'open' as const, workItemId: 'project/alpha/issue/one', workRunId: null, contextSource: 'session-record' as const, citations: ['01-Projects/alpha/issues/one.md'] };
  const intents = [{ action: 'search' as const, query: 'recovery', limit: 5 }];
  const intrinsic = {
    schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION,
    stage: 'open' as const,
    projectId: 'project/alpha',
    previousFlowFingerprint: null,
    actionInputFingerprint: digest('f'),
    recoveryFingerprint: digest('7'),
    ownerLocks: locks,
    payloadFingerprint: fingerprintRecoveryValue(payload),
    nextRequestIntents: intents,
    diagnostics: [],
    omitted: { items: 0, citations: 0, diagnostics: 0, bytes: 0 },
  };
  const flowFingerprint = fingerprintRecoveryFlowIntrinsicStage(intrinsic);
  return {
    schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION,
    stage: 'open',
    projectId: intrinsic.projectId,
    previousFlowFingerprint: intrinsic.previousFlowFingerprint,
    actionInputFingerprint: intrinsic.actionInputFingerprint,
    recoveryFingerprint: intrinsic.recoveryFingerprint,
    ownerLocks: intrinsic.ownerLocks,
    payload,
    nextRequestIntents: intents,
    diagnostics: intrinsic.diagnostics,
    omitted: intrinsic.omitted,
    rootOpenFlowFingerprint: flowFingerprint,
    nextRequests: [{ schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION, projectId: 'project/alpha', action: 'search', openFlowFingerprint: flowFingerprint, query: 'recovery', limit: 5 }],
    generatedAt: '2026-08-28T12:00:00.000Z',
    flowFingerprint,
  };
}

test('validates every request action and exact plan nullability', () => {
  const open = validateRecoveryFlowRequestV2({ schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION, projectId: 'project/alpha', action: 'open' });
  assert.equal(open.action, 'open');
  const search = validateRecoveryFlowRequestV2({ schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION, projectId: 'project/alpha', action: 'search', openFlowFingerprint: digest('a'), query: '  Ｒｅｃｏｖｅｒｙ  ', limit: 5 });
  if (search.action !== 'search') throw new Error('fixture validation did not preserve discriminants');
  assert.equal(search.query, 'Recovery');
  const fromSearch = validateRecoveryFlowRequestV2({ schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION, projectId: 'project/alpha', action: 'plan', mode: 'from-search', openFlowFingerprint: digest('a'), searchedBasisFlowFingerprint: digest('b'), plannedFlowFingerprint: null, query: 'recovery', limit: 5, candidateId: 'resume:one', agentSelection: { bindingId: 'binding/one', bindingRevision: 1 }, priorPlan: null });
  if (fromSearch.action !== 'plan') throw new Error('fixture validation did not preserve discriminants');
  assert.equal(fromSearch.mode, 'from-search');
  assert.throws(() => validateRecoveryFlowRequestV2({ ...fromSearch, plannedFlowFingerprint: digest('c') }), /nullable|mode/i);
  assert.throws(() => validateRecoveryFlowRequestV2({ ...fromSearch, extra: true }), /unknown field/i);
  const refresh = { schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION, projectId: 'project/alpha', action: 'refresh-plan', openFlowFingerprint: digest('a'), searchedBasisFlowFingerprint: digest('b'), plannedFlowFingerprint: digest('c'), query: 'recovery', limit: 5, priorPlan: null };
  assert.throws(() => validateRecoveryFlowRequestV2(refresh), /priorPlan/);
  assert.throws(() => validateRecoveryFlowRequestV2({ schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION, projectId: 'Project/alpha', action: 'restart', staleProof }), /canonical Project ID/i);
  assert.equal(validateRecoveryFlowRequestV2({ schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION, projectId: 'project/alpha', action: 'restart', staleProof }).action, 'restart');
});

test('rejects unsafe and oversized search input without accepting alternate normalization', () => {
  const base = { schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION, projectId: 'project/alpha', action: 'search' as const, openFlowFingerprint: digest('a'), query: 'ok', limit: 1 };
  assert.throws(() => validateRecoveryFlowRequestV2({ ...base, query: '\u0000secret' }), /control|unsafe/i);
  assert.throws(() => validateRecoveryFlowRequestV2({ ...base, query: 'x'.repeat(2049) }), /exceeds|bound/i);
  assert.throws(() => validateRecoveryFlowRequestV2({ ...base, limit: 0 }), /1 through 25/i);
  assert.throws(() => validateRecoveryFlowRequestV2({ ...base, query: 'C:\\Users\\Admin\\vault' }), /unsafe|material/i);
});

test('validates finite stale proof and rejects response or next-request nesting', () => {
  assert.equal(validateRecoveryFlowRequestV2({ schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION, projectId: 'project/alpha', action: 'restart', staleProof }).action, 'restart');
  assert.throws(() => validateRecoveryFlowRequestV2({ schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION, projectId: 'project/alpha', action: 'restart', staleProof: { ...staleProof, response: { stage: 'open' } } }), /unknown field/i);
  assert.throws(() => validateRecoveryFlowRequestV2({ schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION, projectId: 'project/alpha', action: 'restart', staleProof: { ...staleProof, fingerprint: digest('dead') } }), /fingerprint does not match/i);
});

test('open response hashes intrinsic data before deriving fingerprint-bound requests', () => {
  const response = openResponse();
  assert.equal(response.rootOpenFlowFingerprint, response.flowFingerprint);
  assert.deepEqual(validateRecoveryFlowResponseV2(response), response);
  assert.deepEqual(deriveRecoveryFlowRequests(response), response.nextRequests);
  assert.throws(() => validateRecoveryFlowResponseV2({ ...response, nextRequests: [{ ...response.nextRequests[0], openFlowFingerprint: digest('dead') }] }), /nextRequests|fingerprint-bound/i);
  assert.throws(() => validateRecoveryFlowResponseV2({ ...response, nextRequestIntents: [{ action: 'search', query: 'recovery', limit: 5, flowFingerprint: digest('cycle') }] }), /fingerprint/i);
});

test('response stage arms are literal and cross-stage payloads are rejected', () => {
  const response = openResponse();
  assert.throws(() => validateRecoveryFlowResponseV2({ ...response, stage: 'searched', payload: response.payload }), /payload|stage/i);
  assert.throws(() => validateRecoveryFlowResponseV2({ ...response, stage: 'open', nextRequestIntents: [{ action: 'plan', mode: 'from-search', query: 'recovery', limit: 5, candidateId: 'resume:one', agentSelection: { bindingId: 'binding/one', bindingRevision: 1 }, priorPlan: null }] }), /not allowed|action/i);
  const plannedPayload = {
    kind: 'planned' as const,
    plan: { schemaVersion: RECOVERY_PLAN_SCHEMA_VERSION },
    candidates: [],
  };
  assert.throws(() => validateRecoveryFlowResponseV2({ ...response, payload: plannedPayload }), /priorPlan|schemaVersion|kind|unknown field/i);
});

test('owner locks and diagnostics are closed, ordered, and bounded', () => {
  const response = openResponse();
  assert.throws(() => validateRecoveryFlowResponseV2({ ...response, ownerLocks: [{ ...lock, owner: 'settings' }] }), /owner-lock order/i);
  assert.throws(() => validateRecoveryFlowResponseV2({ ...response, diagnostics: [{ owner: 'project', code: 'x', severity: 'info', message: 'x', remediation: 'x', citationTargets: [], extra: true }] }), /unknown field/i);
  assert.throws(() => validateRecoveryFlowResponseV2({ ...response, omitted: { items: -1, citations: 0, diagnostics: 0, bytes: 0 } }), /non-negative/i);
});

 test('plan validator requires the complete prior Plan and exact five-minute lifetime', () => {
  const plan = {
    schemaVersion: RECOVERY_PLAN_SCHEMA_VERSION,
    projectId: 'project/alpha',
    rootOpenFlowFingerprint: digest('a'),
    searchedBasisFlowFingerprint: digest('b'),
    recoveryFingerprint: digest('c'),
    searchInputFingerprint: digest('d'),
    searchFingerprint: digest('e'),
    candidateSetFingerprint: digest('f'),
    candidateId: 'resume:one',
    kind: 'resume' as const,
    workItemId: 'project/alpha/issue/one',
    workRunId: 'work-run/one',
    agentSelection: { role: 'coder', bindingId: 'binding/one', bindingRevision: 1, profileId: 'profile/one', profileRevision: 2 },
    ownerLocks: locks,
    capabilityFacts: [{ capability: 'workflow.join', state: 'available' as const }],
    citationTargets: ['01-Projects/alpha/issues/one.md'],
    owningOperation: 'workflow.recovery.apply' as const,
    createdAt: '2026-08-28T12:00:00.000Z',
    expiresAt: '2026-08-28T12:05:00.000Z',
    leaseDurationMs: 0 as const,
  };
  const complete = { ...plan, fingerprint: fingerprintRecoveryValue(plan) };
  assert.deepEqual(validateRecoveryPlanV2(complete), complete);
  assert.throws(() => validateRecoveryPlanV2({ ...complete, expiresAt: '2026-08-28T12:05:01.000Z' }), /five minutes/i);
  assert.throws(() => validateRecoveryPlanV2({ ...complete, fingerprint: digest('bad') }), /fingerprint does not match/i);
  assert.throws(() => validateRecoveryPlanV2({ ...complete, workRunId: null }), /required for resume/i);
});
