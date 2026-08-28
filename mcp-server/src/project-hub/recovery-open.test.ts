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
    },
    loadWorkItems: () => [{ entity: 'project/alpha/issue/build', label: 'Build recovery', state: 'in-progress', blockedBy: [], citationTargets: ['issue:build'], currentStage: 'build' }],
    loadProjectMemory: async () => ({ revision: 2, fingerprint: fingerprintRecoveryValue({ memory: 2 }), freshness: 'current', reviewedDecisions: [{ decisionId: 'decision/one', text: 'Keep recovery read-only', citationTargets: ['decision:one'], reviewStatus: 'reviewed' }, { decisionId: 'decision/draft', text: 'Do not expose this', citationTargets: [], reviewStatus: 'draft' }] }),
    listSessions: async () => [{ sessionId: 'session/old', projectId: 'project/alpha', workItemId: 'project/alpha/issue/build', capturedAt: '2026-08-27T00:00:00.000Z', status: 'captured', citationTargets: ['session:old'] }],
    loadCapabilities: async () => [{ capability: 'repository.read', state: 'available', citationTargets: ['capability:read'] }],
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
