import test from 'node:test';
import assert from 'node:assert/strict';
import { composeRecoveryOpenStage, type RecoveryOpenOwners } from './recovery-open.js';
import { fingerprintRecoveryValue } from './contract-support.js';

function owners(overrides: Partial<RecoveryOpenOwners> = {}): RecoveryOpenOwners {
  const run = {
    projectId: 'project/alpha', workItemId: 'project/alpha/issue/build', workRunId: 'work-run/current', agentId: 'codex', state: 'running', observedAt: '2026-08-28T00:00:00.000Z', leaseExpiresAt: null,
    recordFingerprint: fingerprintRecoveryValue({ run: 'current' }), malformed: false,
  };
  return {
    workflow: {
      readRun: () => run,
      listRuns: () => [run],
      listCheckpoints: () => [{ checkpointId: 'checkpoint/one', stage: 'build', status: 'passed', summary: 'build is resumable', recordedAt: '2026-08-28T00:01:00.000Z', citationTargets: ['test:build'] }],
      checkpointSetFingerprint: () => fingerprintRecoveryValue({ checkpoint: 'one' }),
      readRuntimeProjection: () => ({ activeRuns: [], staleRuns: [], runCount: 0, agentStateFiles: [], workflowState: null, stage: null, stageCitation: null, sourceFiles: [], drift: [] }),
    },
    loadWorkItems: () => [{ entity: 'project/alpha/issue/build', label: 'Build recovery', state: 'in-progress', blockedBy: [], citationTargets: ['issue:build'], currentStage: 'build' }],
    loadProjectMemory: async () => ({ revision: 2, fingerprint: fingerprintRecoveryValue({ memory: 2 }), freshness: 'current', reviewedDecisions: [{ decisionId: 'decision/one', text: 'Keep recovery read-only', citationTargets: ['decision:one'], reviewStatus: 'reviewed' }, { decisionId: 'decision/draft', text: 'Do not expose this', citationTargets: [], reviewStatus: 'draft' }] }),
    listSessions: async () => [{ sessionId: 'session/old', projectId: 'project/alpha', workItemId: 'project/alpha/issue/build', capturedAt: '2026-08-27T00:00:00.000Z', status: 'captured', citationTargets: ['session:old'] }],
    listSourceEvidence: async () => ({ records: [], fingerprint: fingerprintRecoveryValue('source-evidence') }),
    loadAgentDomainCapabilities: async () => ({ records: [{ capability: 'repository.read', state: 'available', citationTargets: ['capability:read'] }] }),
    loadSettingsCapabilities: async () => ({ records: [] }),
    ...overrides,
  };
}

test('open composes V1-equivalent work facts with Work Run context before Session fallback', async () => {
  const response = await composeRecoveryOpenStage('project/alpha', owners(), '2026-08-28T02:00:00.000Z');
  assert.equal(response.stage, 'open');
  assert.equal(response.payload.contextSource, 'work-run');
  assert.equal(response.payload.workRunId, 'work-run/current');
  assert.equal(response.payload.workItemId, 'project/alpha/issue/build');
  assert.equal(response.payload.currentStage?.value, 'build');
  assert.deepEqual(response.payload.workGroups?.inProgress.map((item) => item.entity), ['project/alpha/issue/build']);
  assert.deepEqual(response.payload.context?.decisions.map((item) => item.decisionId), ['decision/one']);
  assert.equal(response.payload.context?.checkpoints[0]?.checkpointId, 'checkpoint/one');
  assert.ok(response.nextRequests[0]?.openFlowFingerprint === response.flowFingerprint);
  assert.deepEqual(response.ownerLocks.map((lock) => lock.owner), ['project', 'work-os', 'workflow', 'project-memory', 'session-record', 'source-evidence', 'agent-domain', 'settings']);
  assert.doesNotMatch(JSON.stringify(response), /Do not expose|transcript|prompt|C:\\|must-never/u);
});
test('keeps source evidence, Agent Domain, and Settings owner inputs independent', async () => {
  const base = owners();
  const response = await composeRecoveryOpenStage('project/alpha', {
    ...base,
    listSourceEvidence: async () => ({ records: [{ itemId: 'evidence/recovery', projectId: 'project/alpha', citationTargets: ['evidence:recovery'] }], revision: 4 }),
    loadAgentDomainCapabilities: async () => ({ records: [
      { capability: 'agent.binding', state: 'available', citationTargets: ['capability:binding'] },
      { capability: 'repository.read', state: 'available', citationTargets: ['capability:read'] },
    ], revision: 5 }),
    loadSettingsCapabilities: async () => ({ records: [{ capability: 'settings.vault', state: 'degraded', citationTargets: ['capability:vault'] }], revision: 6 }),
  }, '2026-08-28T02:00:00.000Z');
  assert.equal(response.stage, 'open');
  assert.ok(response.payload.context?.citations.includes('evidence:recovery'));
  assert.deepEqual(response.payload.capabilities, [
    { capability: 'agent.binding', state: 'available' },
    { capability: 'repository.read', state: 'available' },
    { capability: 'settings.vault', state: 'degraded' },
  ]);
  const locks = new Map(response.ownerLocks.map((lock) => [lock.owner, lock]));
  assert.equal(locks.get('source-evidence')?.revision, 4);
  assert.equal(locks.get('agent-domain')?.revision, 5);
  assert.equal(locks.get('settings')?.revision, 6);
  assert.notEqual(locks.get('agent-domain')?.fingerprint, locks.get('settings')?.fingerprint);
});

test('open safely falls back to current Session metadata and never returns reviewed-out memory', async () => {
  const base = owners();
  const response = await composeRecoveryOpenStage('project/alpha', {
    ...base,
    workflow: { ...base.workflow, listRuns: () => [] },
  }, '2026-08-28T02:00:00.000Z');
  assert.equal(response.stage, 'open');
  assert.equal(response.payload.contextSource, 'session-record');
  assert.equal(response.payload.workRunId, null);
  assert.equal(response.payload.context?.workRunId, null);
  assert.equal(response.payload.context?.decisions.length, 1);
});

test('open truncates optional decisions/checkpoints under the explicit bounds', async () => {
  const base = owners();
  const decisions = Array.from({ length: 40 }, (_, index) => ({ decisionId: `decision/${String(index).padStart(2, '0')}`, text: `Decision ${index}`, citationTargets: [`decision:${index}`], reviewStatus: 'reviewed' }));
  const checkpoints = Array.from({ length: 40 }, (_, index) => ({ checkpointId: `checkpoint/${String(index).padStart(2, '0')}`, stage: 'build', status: 'passed', summary: `Checkpoint ${index}`, recordedAt: `2026-08-28T00:${String(index).padStart(2, '0')}:00.000Z`, citationTargets: [`test:${index}`] }));
  const response = await composeRecoveryOpenStage('project/alpha', {
    ...base,
    loadProjectMemory: async () => ({ freshness: 'current', decisions }),
    workflow: { ...base.workflow, listCheckpoints: () => checkpoints },
  }, '2026-08-28T02:00:00.000Z');
  assert.equal(response.stage, 'open');
  assert.ok((response.payload.context?.decisions.length ?? 0) <= 32);
  assert.ok((response.payload.context?.checkpoints.length ?? 0) <= 32);
  assert.ok(response.omitted.items >= 16);
});

test('open returns unavailable when a mandatory owner cannot be read', async () => {
  const response = await composeRecoveryOpenStage('project/alpha', { ...owners(), loadWorkItems: () => { throw new Error('broken'); } }, '2026-08-28T02:00:00.000Z');
  assert.equal(response.stage, 'unavailable');
  assert.equal(response.payload.kind, 'unavailable');
  assert.equal(response.payload.reason, 'mandatory_owner_unavailable');
});

test('open binds the selected Work Run to its exact Work Item and rejects unsafe session/memory records', async () => {
  const base = owners();
  const runB = {
    ...base.workflow.listRuns('project/alpha')[0]!,
    workItemId: 'project/alpha/issue/review',
    workRunId: 'work-run/review',
    observedAt: '2026-08-28T01:00:00.000Z',
  };
  const response = await composeRecoveryOpenStage('project/alpha', {
    ...base,
    workflow: { ...base.workflow, listRuns: () => [base.workflow.listRuns('project/alpha')[0]!, runB] },
    loadWorkItems: () => [
      { entity: 'project/alpha/issue/build', label: 'Build', state: 'in-progress', blockedBy: [], citationTargets: ['issue:build'] },
      { entity: 'project/alpha/issue/review', label: 'Review', state: 'todo', blockedBy: [], citationTargets: ['issue:review'] },
    ],
    listSessions: async () => [
      { sessionId: 'session/foreign', projectId: 'project/beta', workItemId: 'project/alpha/issue/build', status: 'captured', citationTargets: ['foreign'] },
      { sessionId: 'session/unknown', projectId: 'project/alpha', workItemId: 'project/alpha/issue/build', status: 'draft', citationTargets: ['unknown'] },
    ],
    loadProjectMemory: async () => ({ decisions: [
      { decisionId: 'decision/reviewed', text: 'safe', citationTargets: ['decision:safe'], reviewStatus: 'reviewed' },
      { decisionId: 'decision/unknown', text: 'unsafe to trust', citationTargets: ['decision:unknown'], reviewStatus: 'unknown' },
    ] }),
  }, '2026-08-28T02:00:00.000Z');
  assert.equal(response.stage, 'open');
  assert.equal(response.payload.workItemId, 'project/alpha/issue/review');
  assert.equal(response.payload.workRunId, 'work-run/review');
  assert.deepEqual(response.payload.context?.decisions.map((item) => item.decisionId), ['decision/reviewed']);
});

test('open omits malformed owner arrays instead of throwing', async () => {
  const base = owners();
  const response = await composeRecoveryOpenStage('project/alpha', {
    ...base,
    loadWorkItems: () => undefined as never,
    loadProjectMemory: async () => ({ decisions: {} as never }),
  }, '2026-08-28T02:00:00.000Z');
  assert.equal(response.stage, 'open');
  assert.equal(response.payload.workItemId, null);
  assert.ok(response.diagnostics.some((item) => item.code === 'work_items_unavailable'));
});
test('open omits malformed capability-owner snapshots instead of throwing', async () => {
  const base = owners();
  const response = await composeRecoveryOpenStage('project/alpha', {
    ...base,
    listSourceEvidence: async () => ({ records: [null] as never[] }),
    loadAgentDomainCapabilities: async () => ({ records: [null] as never[] }),
    loadSettingsCapabilities: async () => ({ records: [null] as never[] }),
  }, '2026-08-28T02:00:00.000Z');
  assert.equal(response.stage, 'open');
  assert.deepEqual(response.payload.capabilities, []);
});
test('new-owner read failures fail closed with independent locks and diagnostics', async () => {
  const throwing = async (): Promise<never> => { throw new Error('RAW_SECRET_CANARY'); };
  for (const owner of ['source-evidence', 'agent-domain', 'settings'] as const) {
    const overrides: Partial<RecoveryOpenOwners> = owner === 'source-evidence'
      ? { listSourceEvidence: throwing }
      : owner === 'agent-domain'
        ? { loadAgentDomainCapabilities: throwing }
        : { loadSettingsCapabilities: throwing };
    const response = await composeRecoveryOpenStage('project/alpha', { ...owners(), ...overrides }, '2026-08-28T02:00:00.000Z');
    assert.equal(response.stage, 'unavailable');
    assert.equal(response.payload.kind, 'unavailable');
    assert.equal(response.nextRequests.length, 0);
    const locks = new Map(response.ownerLocks.map((lock) => [lock.owner, lock]));
    assert.equal(locks.get(owner)?.state, 'unavailable');
    assert.equal([...locks.values()].filter((lock) => lock.state === 'unavailable').length, 1);
    assert.ok(response.diagnostics.some((item) => item.owner === owner && item.code === 'owner_unavailable'));
    assert.doesNotMatch(JSON.stringify(response), /RAW_SECRET_CANARY/u);
  }
  const base = owners();
  const combined = await composeRecoveryOpenStage('project/alpha', {
    ...base,
    listSourceEvidence: throwing,
    workflow: { ...base.workflow, listRuns: () => { throw new Error('RAW_WORKFLOW_CANARY'); } },
  }, '2026-08-28T02:00:00.000Z');
  assert.equal(combined.stage, 'unavailable');
  const combinedLocks = new Map(combined.ownerLocks.map((lock) => [lock.owner, lock]));
  assert.equal(combinedLocks.get('source-evidence')?.state, 'unavailable');
  assert.equal(combinedLocks.get('workflow')?.state, 'unavailable');
  assert.ok(combined.diagnostics.some((item) => item.owner === 'source-evidence' && item.code === 'owner_unavailable'));
  assert.ok(combined.diagnostics.some((item) => item.owner === 'workflow' && item.code === 'owner_unavailable'));
  assert.doesNotMatch(JSON.stringify(combined), /RAW_SECRET_CANARY|RAW_WORKFLOW_CANARY/u);
});
