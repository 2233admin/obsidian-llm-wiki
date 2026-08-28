import test from 'node:test';
import assert from 'node:assert/strict';
import { composeRecoveryOpenStage, type RecoveryOpenOwners } from './recovery-open.js';
import { composeRecoveryCandidates } from './action-candidates.js';
import { fingerprintRecoveryValue } from './contract-support.js';

function openOwners(overrides: Partial<RecoveryOpenOwners> = {}): RecoveryOpenOwners {
  const run = { projectId: 'project/alpha', workItemId: 'project/alpha/issue/build', workRunId: 'work-run/current', agentId: 'codex', state: 'running', observedAt: '2026-08-28T00:00:00.000Z', leaseExpiresAt: null, recordFingerprint: fingerprintRecoveryValue('run'), malformed: false };
  return {
    workflow: { readRun: () => run, listRuns: () => [run], listCheckpoints: () => [], checkpointSetFingerprint: () => fingerprintRecoveryValue([]) },
    loadWorkItems: () => [{ entity: 'project/alpha/issue/build', label: 'Build', state: 'in-progress', blockedBy: [], citationTargets: ['issue:build'] }],
    loadProjectMemory: async () => ({}), listSessions: async () => [], loadCapabilities: async () => [], ...overrides,
  };
}
const result = { itemId: 'project/alpha/issue/build', itemType: 'issue', label: 'Build', projectId: 'project/alpha', owner: 'work-os' as const, matchClass: 'exact', score: 1000, freshness: 'current', confidence: 'owner', provenance: 'work-os', citationTargets: ['issue:build'] };
const binding = { role: 'builder', bindingId: 'binding/alpha/builder', bindingRevision: 1, profileId: 'agent/builder', profileRevision: 1 };

test('candidate composition reuses exact resume identity and recommends one', async () => {
  const open = await composeRecoveryOpenStage('project/alpha', openOwners(), '2026-08-28T02:00:00.000Z');
  const stage = composeRecoveryCandidates({ open, search: result, compatibleBindings: [binding] });
  assert.equal(stage.candidates[0]?.candidateId, 'resume:work-run/current');
  assert.equal(stage.candidates.filter((item) => item.recommended).length, 1);
});

test('zero, many, and oversized Binding sets fail closed without truncation', async () => {
  const open = await composeRecoveryOpenStage('project/alpha', openOwners(), '2026-08-28T02:00:00.000Z');
  assert.equal(composeRecoveryCandidates({ open, search: result, compatibleBindings: [] }).reason, 'no_compatible_binding');
  assert.equal(composeRecoveryCandidates({ open, search: result, compatibleBindings: [binding, { ...binding, bindingId: 'binding/alpha/two' }] }).bindings.length, 2);
  const many = Array.from({ length: 17 }, (_, index) => ({ ...binding, bindingId: `binding/alpha/${index}` }));
  const tooLarge = composeRecoveryCandidates({ open, search: result, compatibleBindings: many });
  assert.equal(tooLarge.reason, 'binding_selection_too_large');
  assert.equal(tooLarge.bindings.length, 17);
});

test('Session create is rejected when the current Work Item is blocked', async () => {
  const open = await composeRecoveryOpenStage('project/alpha', openOwners({
    workflow: { readRun: () => null, listRuns: () => [], listCheckpoints: () => [], checkpointSetFingerprint: () => fingerprintRecoveryValue([]) },
    loadWorkItems: () => [{ entity: 'project/alpha/issue/build', label: 'Build', state: 'todo', blockedBy: ['project/alpha/issue/other'], citationTargets: ['issue:build'] }],
    listSessions: async () => [{ sessionId: 'session/current', projectId: 'project/alpha', workItemId: 'project/alpha/issue/build', status: 'captured', citationTargets: ['session:current'] }],
  }), '2026-08-28T02:00:00.000Z');
  assert.equal(composeRecoveryCandidates({ open, search: result, compatibleBindings: [binding] }).reason, 'no_safe_candidate');
});
