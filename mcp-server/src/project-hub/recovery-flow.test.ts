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
  type RecoveryFlowPayloadV2,
  type RecoveryFlowRequestIntentV2,
  type RecoveryFlowRequestV2,
  type RecoveryFlowResponseV2,
  type RecoveryOwnerLock,
  type RecoveryStaleProofV2,
} from './recovery-flow.js';
import { fingerprintRecoveryValue, utf8JsonBytes, type RecoveryFingerprint } from './contract-support.js';

function digest(seed: string): `sha256:${string}` {
  return `sha256:${seed.padEnd(64, '0').slice(0, 64)}` as `sha256:${string}`;
}

const lock: RecoveryOwnerLock = { owner: 'project', revision: 1, fingerprint: digest('a'), state: 'current' };
const locks = [lock];
const planLocks: RecoveryOwnerLock[] = [
  lock,
  { owner: 'work-os', revision: 1, fingerprint: digest('b'), state: 'current' },
  { owner: 'workflow', revision: 1, fingerprint: digest('c'), state: 'current' },
  { owner: 'project-memory', revision: 1, fingerprint: digest('d'), state: 'current' },
  { owner: 'session-record', revision: 1, fingerprint: digest('e'), state: 'current' },
  { owner: 'source-evidence', revision: 1, fingerprint: digest('f'), state: 'current' },
  { owner: 'agent-domain', revision: 1, fingerprint: digest('7'), state: 'current' },
  { owner: 'settings', revision: 1, fingerprint: digest('8'), state: 'current' },
];
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

const basePlan = {
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
  ownerLocks: planLocks,
  capabilityFacts: [{ capability: 'workflow.recovery.plan', state: 'available' as const }],
  citationTargets: ['01-Projects/alpha/issues/one.md'],
  owningOperation: 'workflow.recovery.apply' as const,
  createdAt: '2026-08-28T12:00:00.000Z',
  expiresAt: '2026-08-28T12:05:00.000Z',
  leaseDurationMs: 0 as const,
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
test('rejects searched and Binding-selection responses with mismatched root fingerprints', () => {
  const build = (stage: 'searched' | 'needs-agent-selection', payload: RecoveryFlowPayloadV2) => {
    const previousFlowFingerprint = digest('a');
    const intrinsic = {
      schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION,
      stage,
      projectId: 'project/alpha',
      previousFlowFingerprint,
      actionInputFingerprint: digest('1'),
      recoveryFingerprint: digest('2'),
      ownerLocks: locks,
      payloadFingerprint: fingerprintRecoveryValue(payload),
      nextRequestIntents: [],
      diagnostics: [],
      omitted: { items: 0, citations: 0, diagnostics: 0, bytes: 0 },
    };
    const flowFingerprint = fingerprintRecoveryFlowIntrinsicStage(intrinsic);
    return {
      schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION,
      stage,
      projectId: 'project/alpha',
      previousFlowFingerprint,
      actionInputFingerprint: intrinsic.actionInputFingerprint,
      recoveryFingerprint: intrinsic.recoveryFingerprint,
      ownerLocks: locks,
      payload,
      nextRequestIntents: [],
      diagnostics: [],
      omitted: intrinsic.omitted,
      rootOpenFlowFingerprint: digest('0'),
      nextRequests: [],
      generatedAt: '2026-08-28T12:00:00.000Z',
      flowFingerprint,
    };
  };
  const searched = build('searched', {
    kind: 'searched',
    query: 'recovery',
    limit: 1,
    searchInputFingerprint: digest('1'),
    searchFingerprint: digest('2'),
    results: [],
  });
  assert.throws(() => validateRecoveryFlowResponseV2(searched), /rootOpenFlowFingerprint.*previousFlowFingerprint/i);
  const needsSelection = build('needs-agent-selection', {
    kind: 'needs-agent-selection',
    candidates: ['resume:one'],
    bindings: [
      { role: 'one', bindingId: 'binding/one', bindingRevision: 1, profileId: 'profile/one', profileRevision: 1 },
      { role: 'two', bindingId: 'binding/two', bindingRevision: 2, profileId: 'profile/two', profileRevision: 1 },
    ],
  });
  assert.throws(() => validateRecoveryFlowResponseV2(needsSelection), /rootOpenFlowFingerprint.*previousFlowFingerprint/i);
});


test('rejects unsafe and oversized search input without accepting alternate normalization', () => {
  const base = { schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION, projectId: 'project/alpha', action: 'search' as const, openFlowFingerprint: digest('a'), query: 'ok', limit: 1 };
  assert.throws(() => validateRecoveryFlowRequestV2({ ...base, query: '\u0000secret' }), /control|unsafe/i);
  assert.throws(() => validateRecoveryFlowRequestV2({ ...base, query: 'x'.repeat(2049) }), /exceeds|bound/i);
  assert.throws(() => validateRecoveryFlowRequestV2({ ...base, limit: 0 }), /1 through 25/i);
  assert.throws(() => validateRecoveryFlowRequestV2({ ...base, query: 'C:\\Users\\Admin\\vault' }), /unsafe|material/i);
});
test('rejects assigned local paths in direct search requests without rejecting URL schemes', () => {
  const base = {
    schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
    projectId: 'project/alpha',
    action: 'search' as const,
    openFlowFingerprint: digest('a'),
    limit: 1,
  };
  for (const query of [
    'workspace=/Users/admin/vault',
    'cwd=\\\\server\\share',
    'home=~/vault',
    'path:C:\\vault',
    'file=/tmp/evidence.md',
  ]) {
    assert.throws(() => validateRecoveryFlowRequestV2({ ...base, query }), /unsafe|path|material/i);
  }
  const httpsResult = validateRecoveryFlowRequestV2({ ...base, query: 'https://example.com/workspace' });
  if (httpsResult.action !== 'search') throw new Error('URL fixture did not preserve search action');
  assert.equal(httpsResult.query, 'https://example.com/workspace');
  const gitResult = validateRecoveryFlowRequestV2({ ...base, query: 'git+ssh://git.example.com/repo' });
  if (gitResult.action !== 'search') throw new Error('URL fixture did not preserve search action');
  assert.equal(gitResult.query, 'git+ssh://git.example.com/repo');
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
  assert.throws(() => validateRecoveryFlowResponseV2({ ...response, ownerLocks: [{ ...lock, owner: 'settings' }, lock] }), /owner-lock order/i);
  assert.throws(() => validateRecoveryFlowResponseV2({ ...response, diagnostics: [{ owner: 'project', code: 'x', severity: 'info', message: 'x', remediation: 'x', citationTargets: [], extra: true }] }), /unknown field/i);
  assert.throws(() => validateRecoveryFlowResponseV2({ ...response, omitted: { items: -1, citations: 0, diagnostics: 0, bytes: 0 } }), /non-negative/i);
  assert.throws(() => validateRecoveryFlowResponseV2({ ...response, payload: { ...response.payload, contextSource: 'work-run' } }), /workRunId|required/i);
});

test('requires complete owner locks and rejects cross-project Work-OS identities', () => {
  const workflowLock: RecoveryOwnerLock = { owner: 'workflow', revision: 2, fingerprint: digest('b'), state: 'current' };
  const plan = { ...basePlan, ownerLocks: [lock, workflowLock] };
  const complete = { ...plan, fingerprint: fingerprintRecoveryValue(plan) };
  assert.throws(() => validateRecoveryPlanV2(complete), /ownerLocks/i);
  const valid = { ...basePlan, fingerprint: fingerprintRecoveryValue(basePlan) };
  assert.throws(() => validateRecoveryPlanV2({ ...valid, workItemId: 'project/beta/issue/one' }), /canonical Work Item|Project/i);
  assert.throws(() => validateRecoveryPlanV2({ ...valid, workRunId: 'run/one' }), /canonical Work Run/i);
  assert.throws(() => validateRecoveryPlanV2({ ...valid, citationTargets: [] }), /at least 1/i);
});

test('plan validator requires the complete prior Plan and exact five-minute lifetime', () => {
  const complete = { ...basePlan, fingerprint: fingerprintRecoveryValue(basePlan) };
  assert.deepEqual(validateRecoveryPlanV2(complete), complete);
  assert.throws(() => validateRecoveryPlanV2({ ...complete, expiresAt: '2026-08-28T12:05:01.000Z' }), /five minutes/i);
  assert.throws(() => validateRecoveryPlanV2({ ...complete, fingerprint: digest('bad') }), /fingerprint does not match/i);
  assert.throws(() => validateRecoveryPlanV2({ ...complete, workRunId: null }), /required for resume/i);
});

test('plan validator rejects self-fingerprinted Plans with incomplete locks or capabilities', () => {
  const incomplete = { ...basePlan, ownerLocks: [], capabilityFacts: [], fingerprint: fingerprintRecoveryValue({ ...basePlan, ownerLocks: [], capabilityFacts: [] }) };
  assert.throws(() => validateRecoveryPlanV2(incomplete), /ownerLocks|capabilit/i);
});
test('rejects mixed prior Plan roots and bases for override and refresh', () => {
  const complete = { ...basePlan, fingerprint: fingerprintRecoveryValue(basePlan) };
  const override = {
    schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
    projectId: 'project/alpha',
    action: 'plan' as const,
    mode: 'override' as const,
    openFlowFingerprint: complete.rootOpenFlowFingerprint,
    searchedBasisFlowFingerprint: complete.searchedBasisFlowFingerprint,
    plannedFlowFingerprint: digest('3'),
    query: 'recovery',
    limit: 5,
    candidateId: 'resume:two',
    agentSelection: { bindingId: 'binding/one', bindingRevision: 1 },
    priorPlan: complete,
  };
  assert.deepEqual(validateRecoveryFlowRequestV2(override), override);
  assert.throws(
    () => validateRecoveryFlowRequestV2({ ...override, openFlowFingerprint: digest('1') }),
    /openFlowFingerprint.*match|priorPlan.*root/i,
  );
  assert.throws(
    () => validateRecoveryFlowRequestV2({ ...override, searchedBasisFlowFingerprint: digest('2') }),
    /searchedBasisFlowFingerprint.*match|priorPlan.*searched/i,
  );
  const refresh = {
    schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
    projectId: 'project/alpha',
    action: 'refresh-plan' as const,
    openFlowFingerprint: complete.rootOpenFlowFingerprint,
    searchedBasisFlowFingerprint: complete.searchedBasisFlowFingerprint,
    plannedFlowFingerprint: digest('3'),
    query: 'recovery',
    limit: 5,
    priorPlan: complete,
  };
  assert.deepEqual(validateRecoveryFlowRequestV2(refresh), refresh);
  assert.throws(
    () => validateRecoveryFlowRequestV2({ ...refresh, openFlowFingerprint: digest('1') }),
    /openFlowFingerprint.*match|priorPlan.*root/i,
  );
});

test('binds searched plan intents to the searched payload query and limit', () => {
  const payload = {
    kind: 'searched' as const,
    query: 'recovery',
    limit: 5,
    searchInputFingerprint: digest('a'),
    searchFingerprint: digest('b'),
    results: [],
  };
  const intents = [{
    action: 'plan' as const,
    mode: 'from-search' as const,
    query: 'other',
    limit: 5,
    candidateId: 'resume:one',
    agentSelection: { bindingId: 'binding/one', bindingRevision: 1 },
    priorPlan: null,
  }];
  const intrinsic = {
    schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION,
    stage: 'searched' as const,
    projectId: 'project/alpha',
    previousFlowFingerprint: digest('a'),
    actionInputFingerprint: digest('b'),
    recoveryFingerprint: digest('c'),
    ownerLocks: locks,
    payloadFingerprint: fingerprintRecoveryValue(payload),
    nextRequestIntents: intents,
    diagnostics: [],
    omitted: { items: 0, citations: 0, diagnostics: 0, bytes: 0 },
  };
  const response = {
    schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION,
    stage: 'searched' as const,
    projectId: 'project/alpha',
    previousFlowFingerprint: intrinsic.previousFlowFingerprint,
    actionInputFingerprint: intrinsic.actionInputFingerprint,
    recoveryFingerprint: intrinsic.recoveryFingerprint,
    ownerLocks: locks,
    payload,
    nextRequestIntents: intents,
    diagnostics: [],
    omitted: intrinsic.omitted,
    rootOpenFlowFingerprint: digest('d'),
    nextRequests: [],
    generatedAt: '2026-08-28T12:00:00.000Z',
    flowFingerprint: fingerprintRecoveryFlowIntrinsicStage(intrinsic),
  };
  assert.throws(() => validateRecoveryFlowResponseV2(response), /query and limit|payload/i);
});

test('enforces safe owner revisions and positive Binding/Profile revisions', () => {
  const revisionResponse = openResponse();
  assert.throws(
    () => validateRecoveryFlowResponseV2({
      ...revisionResponse,
      ownerLocks: [{ ...lock, revision: Number.MAX_SAFE_INTEGER + 1 }],
    }),
    /safe integer/i,
  );
  assert.throws(
    () => validateRecoveryFlowResponseV2({
      ...revisionResponse,
      ownerLocks: [{ ...lock, revision: 'x'.repeat(257) }],
    }),
    /maximum|bound/i,
  );
  const base = {
    schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
    projectId: 'project/alpha',
    action: 'search' as const,
    openFlowFingerprint: digest('a'),
    query: 'recovery',
    limit: 1,
  };
  assert.throws(
    () => validateRecoveryFlowRequestV2({
      ...base,
      action: 'plan',
      mode: 'from-search',
      searchedBasisFlowFingerprint: digest('b'),
      plannedFlowFingerprint: null,
      candidateId: 'resume:one',
      agentSelection: { bindingId: 'binding/one', bindingRevision: 0 },
      priorPlan: null,
    }),
    /positive|greater than zero/i,
  );
  assert.throws(
    () => validateRecoveryFlowRequestV2({
      ...base,
      action: 'plan',
      mode: 'from-search',
      searchedBasisFlowFingerprint: digest('b'),
      plannedFlowFingerprint: null,
      candidateId: 'resume:one',
      agentSelection: { bindingId: 'binding/one', bindingRevision: 1.5 },
      priorPlan: null,
    }),
    /positive integer|safe integer/i,
  );
  const complete = { ...basePlan, fingerprint: fingerprintRecoveryValue(basePlan) };
  assert.throws(
    () => validateRecoveryPlanV2({
      ...complete,
      agentSelection: { ...complete.agentSelection, profileRevision: 0 },
    }),
    /positive safe integer/i,
  );
});

test('rejects credential assignments and escaped search results over 4096 bytes', () => {
  for (const query of ['password=secret', 'token:secret', 'api_key = secret', 'private_key: secret']) {
    assert.throws(
      () => validateRecoveryFlowRequestV2({
        schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
        projectId: 'project/alpha',
        action: 'search',
        openFlowFingerprint: digest('a'),
        query,
        limit: 1,
      }),
      /unsafe|credential|material/i,
    );
  }
  const oversizedResult = {
    itemId: 'item/one',
    itemType: 'issue',
    label: 'x'.repeat(512),
    projectId: 'project/alpha',
    owner: 'project' as const,
    matchClass: 'exact',
    score: 1,
    freshness: 'current',
    confidence: 'high',
    citationTargets: ['"'.repeat(512), '"'.repeat(512), '"'.repeat(512), '"'.repeat(512)],
    provenance: 'issue',
  };
  assert.ok(utf8JsonBytes(oversizedResult) > 4096);
  const searched = {
    kind: 'searched' as const,
    query: 'recovery',
    limit: 1,
    searchInputFingerprint: digest('a'),
    searchFingerprint: digest('b'),
    results: [oversizedResult],
  };
  const intrinsic = {
    schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION,
    stage: 'searched' as const,
    projectId: 'project/alpha',
    previousFlowFingerprint: digest('open'),
    actionInputFingerprint: digest('input'),
    recoveryFingerprint: digest('recovery'),
    ownerLocks: locks,
    payloadFingerprint: fingerprintRecoveryValue(searched),
    nextRequestIntents: [],
    diagnostics: [],
    omitted: { items: 0, citations: 0, diagnostics: 0, bytes: 0 },
  };
  assert.throws(() => validateRecoveryFlowResponseV2({
    schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION,
    stage: 'searched',
    projectId: 'project/alpha',
    previousFlowFingerprint: intrinsic.previousFlowFingerprint,
    actionInputFingerprint: intrinsic.actionInputFingerprint,
    recoveryFingerprint: intrinsic.recoveryFingerprint,
    ownerLocks: locks,
    payload: searched,
    nextRequestIntents: [],
    diagnostics: [],
    omitted: intrinsic.omitted,
    rootOpenFlowFingerprint: digest('root'),
    nextRequests: [],
    generatedAt: '2026-08-28T12:00:00.000Z',
    flowFingerprint: fingerprintRecoveryFlowIntrinsicStage(intrinsic),
  }), /4096|maximum|bytes/i);
});
test('enforces the aggregate open-context byte budget including diagnostics and omissions', () => {
  const payload = {
    kind: 'open' as const,
    workItemId: 'project/alpha/issue/one',
    workRunId: null,
    contextSource: 'session-record' as const,
    citations: Array.from({ length: 32 }, () => '"'.repeat(512)),
  };
  const diagnostics = Array.from({ length: 32 }, (_, index) => ({
    owner: 'project' as const,
    code: `diagnostic-${index}`,
    severity: 'warning' as const,
    message: 'm'.repeat(1024),
    remediation: 'r'.repeat(1024),
    citationTargets: ['citation'],
  }));
  const omitted = { items: 0, citations: 0, diagnostics: 0, bytes: 1024 };
  assert.ok(utf8JsonBytes(payload) < 64 * 1024);
  assert.ok(utf8JsonBytes({ payload, diagnostics, omitted }) > 64 * 1024);
  const intrinsic = {
    schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION,
    stage: 'open' as const,
    projectId: 'project/alpha',
    previousFlowFingerprint: null,
    actionInputFingerprint: digest('1'),
    recoveryFingerprint: digest('2'),
    ownerLocks: locks,
    payloadFingerprint: fingerprintRecoveryValue(payload),
    nextRequestIntents: [{ action: 'search' as const, query: 'recovery', limit: 1 }],
    diagnostics,
    omitted,
  };
  const flowFingerprint = fingerprintRecoveryFlowIntrinsicStage(intrinsic);
  assert.throws(() => validateRecoveryFlowResponseV2({
    schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION,
    stage: 'open',
    projectId: 'project/alpha',
    previousFlowFingerprint: null,
    actionInputFingerprint: intrinsic.actionInputFingerprint,
    recoveryFingerprint: intrinsic.recoveryFingerprint,
    ownerLocks: locks,
    payload,
    nextRequestIntents: intrinsic.nextRequestIntents,
    diagnostics,
    omitted,
    rootOpenFlowFingerprint: flowFingerprint,
    nextRequests: [{
      schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
      projectId: 'project/alpha',
      action: 'search',
      openFlowFingerprint: flowFingerprint,
      query: 'recovery',
      limit: 1,
    }],
    generatedAt: '2026-08-28T12:00:00.000Z',
    flowFingerprint,
  }), /64 KiB|aggregate|context|bytes/i);
});


test('enforces stale, Binding-selection, and planned candidate invariants', () => {
  const emptyProof = {
    ...proofWithoutFingerprint,
    changedOwners: [],
    fingerprint: fingerprintRecoveryValue({ ...proofWithoutFingerprint, changedOwners: [] }),
  };
  assert.throws(
    () => validateRecoveryFlowRequestV2({
      schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
      projectId: 'project/alpha',
      action: 'restart',
      staleProof: emptyProof,
    }),
    /at least one|changedOwners/i,
  );
  const needsPayload = {
    kind: 'needs-agent-selection' as const,
    candidates: ['resume:one', 'resume:one'],
    bindings: [
      { bindingId: 'binding/one', bindingRevision: 1 },
      { bindingId: 'binding/one', bindingRevision: 1 },
    ],
  };
  assert.throws(
    () => validateRecoveryFlowResponseV2({
      ...openResponse(),
      stage: 'needs-agent-selection',
      previousFlowFingerprint: digest('previous'),
      payload: needsPayload,
      nextRequestIntents: [],
      nextRequests: [],
    }),
    /unique|at least|candidate/i,
  );
  const complete = { ...basePlan, fingerprint: fingerprintRecoveryValue(basePlan) };
  const plannedPayload = { kind: 'planned' as const, plan: complete, candidates: ['resume:two'] };
  assert.throws(
    () => validateRecoveryFlowResponseV2({
      ...openResponse(),
      stage: 'planned',
      previousFlowFingerprint: digest('previous'),
      recoveryFingerprint: complete.recoveryFingerprint,
      rootOpenFlowFingerprint: complete.rootOpenFlowFingerprint,
      payload: plannedPayload,
      nextRequestIntents: [],
      nextRequests: [],
    }),
    /candidate.*contain|candidates/i,
  );
});
test('requires one refresh intent and unique alternative planned overrides', () => {
  const complete = { ...basePlan, fingerprint: fingerprintRecoveryValue(basePlan) };
  const refreshIntent: Extract<RecoveryFlowRequestIntentV2, { action: 'refresh-plan' }> = {
    action: 'refresh-plan',
    query: 'recovery',
    limit: 5,
    priorPlan: complete,
  };
  const overrideIntent: Extract<RecoveryFlowRequestIntentV2, { action: 'plan' }> = {
    action: 'plan',
    mode: 'override',
    query: 'recovery',
    limit: 5,
    candidateId: 'resume:two',
    agentSelection: { bindingId: 'binding/two', bindingRevision: 2 },
    priorPlan: complete,
  };
  const make = (intents: Array<Extract<RecoveryFlowRequestIntentV2, { action: 'plan' | 'refresh-plan' }>>, candidates = [complete.candidateId, 'resume:two']) => {
    const payload = { kind: 'planned' as const, plan: complete, candidates };
    const intrinsic = {
      schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION,
      stage: 'planned' as const,
      projectId: 'project/alpha',
      previousFlowFingerprint: digest('3'),
      actionInputFingerprint: digest('4'),
      recoveryFingerprint: complete.recoveryFingerprint,
      ownerLocks: locks,
      payloadFingerprint: fingerprintRecoveryValue(payload),
      nextRequestIntents: intents,
      diagnostics: [],
      omitted: { items: 0, citations: 0, diagnostics: 0, bytes: 0 },
    };
    const flowFingerprint = fingerprintRecoveryFlowIntrinsicStage(intrinsic);
    const nextRequests = intents.map((intent) => {
      if (intent.action === 'refresh-plan') {
        return {
          schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
          projectId: 'project/alpha',
          action: 'refresh-plan' as const,
          openFlowFingerprint: complete.rootOpenFlowFingerprint,
          searchedBasisFlowFingerprint: complete.searchedBasisFlowFingerprint,
          plannedFlowFingerprint: flowFingerprint,
          query: intent.query,
          limit: intent.limit,
          priorPlan: complete,
        };
      }
      return {
        schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
        projectId: 'project/alpha',
        action: 'plan' as const,
        mode: 'override' as const,
        openFlowFingerprint: complete.rootOpenFlowFingerprint,
        searchedBasisFlowFingerprint: complete.searchedBasisFlowFingerprint,
        plannedFlowFingerprint: flowFingerprint,
        query: intent.query,
        limit: intent.limit,
        candidateId: intent.candidateId,
        agentSelection: intent.agentSelection,
        priorPlan: complete,
      };
    });
    return {
      ...openResponse(),
      stage: 'planned' as const,
      previousFlowFingerprint: intrinsic.previousFlowFingerprint,
      actionInputFingerprint: intrinsic.actionInputFingerprint,
      recoveryFingerprint: intrinsic.recoveryFingerprint,
      ownerLocks: locks,
      payload,
      nextRequestIntents: intents,
      diagnostics: [],
      omitted: intrinsic.omitted,
      rootOpenFlowFingerprint: complete.rootOpenFlowFingerprint,
      nextRequests,
      flowFingerprint,
    };
  };
  const valid = make([refreshIntent, overrideIntent]);
  assert.deepEqual(validateRecoveryFlowResponseV2(valid), valid);
  assert.throws(() => validateRecoveryFlowResponseV2(make([])), /exactly one.*refresh|refresh.*required/i);
  assert.throws(() => validateRecoveryFlowResponseV2(make([refreshIntent, overrideIntent, overrideIntent])), /duplicate|unique|override/i);
  assert.throws(() => validateRecoveryFlowResponseV2(make([refreshIntent, { ...overrideIntent, candidateId: 'resume:three' }])), /candidate.*member|candidate/i);
  assert.throws(() => validateRecoveryFlowResponseV2(make([refreshIntent, { ...overrideIntent, candidateId: complete.candidateId }])), /different|current candidate|override/i);
});

test('requires exactly one stale restart intent and request', () => {
  const intent: RecoveryFlowRequestIntentV2 = { action: 'restart', staleProof };
  const intrinsic = {
    schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION,
    stage: 'stale' as const,
    projectId: 'project/alpha',
    previousFlowFingerprint: staleProof.priorFlowFingerprint,
    actionInputFingerprint: staleProof.priorActionInputFingerprint,
    recoveryFingerprint: staleProof.recoveryFingerprint,
    ownerLocks: locks,
    payloadFingerprint: fingerprintRecoveryValue(staleProof),
    nextRequestIntents: [intent],
    diagnostics: [],
    omitted: { items: 0, citations: 0, diagnostics: 0, bytes: 0 },
  };
  const flowFingerprint = fingerprintRecoveryFlowIntrinsicStage(intrinsic);
  const nextRequest = {
    schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
    projectId: 'project/alpha',
    action: 'restart' as const,
    staleProof,
  };
  const response = {
    ...openResponse(),
    stage: 'stale' as const,
    previousFlowFingerprint: staleProof.priorFlowFingerprint,
    actionInputFingerprint: staleProof.priorActionInputFingerprint,
    recoveryFingerprint: staleProof.recoveryFingerprint,
    payload: staleProof,
    nextRequestIntents: [intent],
    nextRequests: [nextRequest],
    rootOpenFlowFingerprint: staleProof.rootOpenFlowFingerprint,
    flowFingerprint,
  };
  assert.deepEqual(validateRecoveryFlowResponseV2(response), response);
  const duplicateIntents = [intent, intent];
  const duplicateIntrinsic = { ...intrinsic, nextRequestIntents: duplicateIntents };
  const duplicateFlowFingerprint = fingerprintRecoveryFlowIntrinsicStage(duplicateIntrinsic);
  assert.throws(
    () => validateRecoveryFlowResponseV2({
      ...response,
      nextRequestIntents: duplicateIntents,
      nextRequests: [nextRequest, nextRequest],
      flowFingerprint: duplicateFlowFingerprint,
    }),
    /exactly one|one.*restart|duplicate/i,
  );
});

test('binds planned and stale response fingerprints to their finite payload proofs', () => {
  const complete = { ...basePlan, fingerprint: fingerprintRecoveryValue(basePlan) };
  const planned = {
    ...openResponse(),
    stage: 'planned' as const,
    previousFlowFingerprint: digest('a'),
    recoveryFingerprint: complete.recoveryFingerprint,
    payload: { kind: 'planned' as const, plan: complete, candidates: [complete.candidateId] },
    nextRequestIntents: [],
    nextRequests: [],
    rootOpenFlowFingerprint: digest('b'),
  };
  assert.throws(() => validateRecoveryFlowResponseV2(planned), /rootOpenFlowFingerprint.*payload\.plan|planned responses require.*refresh/i);
  const stale = {
    ...openResponse(),
    stage: 'stale' as const,
    previousFlowFingerprint: staleProof.priorFlowFingerprint,
    actionInputFingerprint: staleProof.priorActionInputFingerprint,
    recoveryFingerprint: staleProof.recoveryFingerprint,
    payload: staleProof,
    nextRequestIntents: [{ action: 'restart' as const, staleProof }],
    nextRequests: [{ schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION, projectId: staleProof.projectId, action: 'restart' as const, staleProof }],
    rootOpenFlowFingerprint: staleProof.rootOpenFlowFingerprint,
  };
  assert.throws(
    () => validateRecoveryFlowResponseV2({ ...stale, actionInputFingerprint: digest('f') }),
    /actionInputFingerprint.*stale proof/i,
  );
  assert.throws(
    () => validateRecoveryFlowResponseV2({ ...stale, previousFlowFingerprint: null }),
    /previousFlowFingerprint.*present|stale proof/i,
  );
  assert.throws(
    () => validateRecoveryFlowResponseV2({
      ...openResponse(),
      stage: 'unavailable' as const,
      previousFlowFingerprint: null,
      payload: { kind: 'unavailable' as const, reason: 'no-candidate', remediation: 'review settings' },
      nextRequestIntents: [],
      nextRequests: [],
    }),
    /previousFlowFingerprint.*present/i,
  );
});
test('accepts valid fixtures for every response stage', () => {
  const make = (
    stage: RecoveryFlowResponseV2['stage'],
    payload: RecoveryFlowPayloadV2,
    previousFlowFingerprint: RecoveryFingerprint,
    actionInputFingerprint: RecoveryFingerprint,
    recoveryFingerprint: RecoveryFingerprint,
    rootOpenFlowFingerprint: RecoveryFingerprint,
    nextRequestIntents: RecoveryFlowRequestIntentV2[],
    nextRequests: RecoveryFlowRequestV2[],
  ): RecoveryFlowResponseV2 => {
    const intrinsic = {
      schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION,
      stage,
      projectId: 'project/alpha',
      previousFlowFingerprint,
      actionInputFingerprint,
      recoveryFingerprint,
      ownerLocks: locks,
      payloadFingerprint: fingerprintRecoveryValue(payload),
      nextRequestIntents,
      diagnostics: [],
      omitted: { items: 0, citations: 0, diagnostics: 0, bytes: 0 },
    };
    return {
      schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION,
      stage,
      projectId: 'project/alpha',
      previousFlowFingerprint,
      actionInputFingerprint,
      recoveryFingerprint,
      ownerLocks: locks,
      payload,
      nextRequestIntents,
      diagnostics: [],
      omitted: intrinsic.omitted,
      rootOpenFlowFingerprint,
      nextRequests,
      generatedAt: '2026-08-28T12:00:00.000Z',
      flowFingerprint: fingerprintRecoveryFlowIntrinsicStage(intrinsic),
    } as RecoveryFlowResponseV2;
  };
  const searched = make(
    'searched',
    { kind: 'searched', query: 'recovery', limit: 5, searchInputFingerprint: digest('1'), searchFingerprint: digest('2'), results: [] },
    digest('3'),
    digest('4'),
    digest('5'),
    digest('3'),
    [],
    [],
  );
  const needsSelection = make(
    'needs-agent-selection',
    {
      kind: 'needs-agent-selection',
      candidates: ['resume:one'],
      bindings: [{ role: 'one', bindingId: 'binding/one', bindingRevision: 1, profileId: 'profile/one', profileRevision: 1 }, { role: 'two', bindingId: 'binding/two', bindingRevision: 2, profileId: 'profile/two', profileRevision: 1 }],
    },
    digest('7'),
    digest('8'),
    digest('9'),
    digest('7'),
    [],
    [],
  );
  const complete = { ...basePlan, fingerprint: fingerprintRecoveryValue(basePlan) };
  const plannedIntents: RecoveryFlowRequestIntentV2[] = [
    { action: 'refresh-plan', query: 'recovery', limit: 5, priorPlan: complete },
    {
      action: 'plan',
      mode: 'override',
      query: 'recovery',
      limit: 5,
      candidateId: 'resume:two',
      agentSelection: { bindingId: 'binding/two', bindingRevision: 2 },
      priorPlan: complete,
    },
  ];
  const planned = make(
    'planned',
    { kind: 'planned', plan: complete, candidates: [complete.candidateId, 'resume:two'] },
    digest('b'),
    digest('c'),
    complete.recoveryFingerprint,
    complete.rootOpenFlowFingerprint,
    plannedIntents,
    [],
  );
  planned.nextRequests = [
    {
      schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
      projectId: 'project/alpha',
      action: 'refresh-plan',
      openFlowFingerprint: complete.rootOpenFlowFingerprint,
      searchedBasisFlowFingerprint: complete.searchedBasisFlowFingerprint,
      plannedFlowFingerprint: planned.flowFingerprint,
      query: 'recovery',
      limit: 5,
      priorPlan: complete,
    },
    {
      schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
      projectId: 'project/alpha',
      action: 'plan',
      mode: 'override',
      openFlowFingerprint: complete.rootOpenFlowFingerprint,
      searchedBasisFlowFingerprint: complete.searchedBasisFlowFingerprint,
      plannedFlowFingerprint: planned.flowFingerprint,
      query: 'recovery',
      limit: 5,
      candidateId: 'resume:two',
      agentSelection: { bindingId: 'binding/two', bindingRevision: 2 },
      priorPlan: complete,
    },
  ];
  const stale = make(
    'stale',
    staleProof,
    staleProof.priorFlowFingerprint,
    staleProof.priorActionInputFingerprint,
    staleProof.recoveryFingerprint,
    staleProof.rootOpenFlowFingerprint,
    [{ action: 'restart', staleProof }],
    [{ schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION, projectId: 'project/alpha', action: 'restart', staleProof }],
  );
  const unavailable = make(
    'unavailable',
    { kind: 'unavailable', reason: 'no-candidate', remediation: 'review settings' },
    digest('d'),
    digest('e'),
    digest('f'),
    digest('1'),
    [],
    [],
  );
  for (const response of [searched, needsSelection, planned, stale, unavailable]) {
    assert.deepEqual(validateRecoveryFlowResponseV2(response), response);
  }
});
