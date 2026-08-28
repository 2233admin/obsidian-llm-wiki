import test from 'node:test';
import assert from 'node:assert/strict';
import { composeRecoveryOpenStage, type RecoveryOpenOwners } from './recovery-open.js';
import { fingerprintRecoveryValue } from './contract-support.js';
import { createProjectSearchSource } from './search-source.js';
import { searchRecovery } from './search.js';

const digest = (value: unknown) => fingerprintRecoveryValue(value);

function openOwners(): RecoveryOpenOwners {
  const run = {
    projectId: 'project/alpha', workItemId: 'project/alpha/issue/build', workRunId: 'work-run/current', agentId: 'codex', state: 'running', observedAt: '2026-08-28T00:00:00.000Z', leaseExpiresAt: null,
    recordFingerprint: digest({ run: 'current' }), malformed: false,
  };
  return {
    workflow: { readRun: () => run, listRuns: () => [run], listCheckpoints: () => [], checkpointSetFingerprint: () => digest([]) },
    loadWorkItems: () => [{ entity: 'project/alpha/issue/build', label: 'Build recovery', state: 'in-progress', blockedBy: [], citationTargets: ['issue:build'], currentStage: 'build' }],
    loadProjectMemory: async () => ({ revision: 2, fingerprint: digest({ memory: 2 }), freshness: 'current', reviewedDecisions: [] }),
    listSessions: async () => [],
    loadCapabilities: async () => [],
  };
}

function source(queryLabel = 'recovery') {
  return createProjectSearchSource({
    'work-os': () => [{ itemId: 'project/alpha/issue/build', itemType: 'issue', label: 'Build recovery', text: queryLabel, citationTargets: ['issue:build'], freshness: 'current', confidence: 'reviewed', provenance: 'work-os' }],
    'project-memory': () => [{ itemId: 'project/alpha/memory/decision', itemType: 'memory', label: 'Recovery decision', text: 'recovery decision', citationTargets: ['memory:decision'], confidence: 'reviewed', provenance: 'project-memory' }],
    'source-evidence': () => [{ itemId: 'project/alpha/evidence/source', itemType: 'evidence', label: 'Source evidence', text: 'recovery source evidence', citationTargets: ['source:evidence'], provenance: 'source-evidence' }],
    'session-record': () => [{ itemId: 'project/alpha/session/one', itemType: 'session', label: 'Session metadata', text: 'recovery session', citationTargets: ['session:one'], provenance: 'session-record' }],
    workflow: () => [{ itemId: 'project/alpha/work-run/current/checkpoint/one', itemType: 'checkpoint', label: 'Checkpoint', text: 'recovery checkpoint', citationTargets: ['checkpoint:one'], provenance: 'workflow' }],
  });
}

test('search returns bounded deterministic cited results and independent query branches', async () => {
  const currentOpen = await composeRecoveryOpenStage('project/alpha', openOwners(), '2026-08-28T02:00:00.000Z');
  assert.equal(currentOpen.stage, 'open');
  if (currentOpen.stage !== 'open') return;
  const deps = { openOwners: openOwners(), searchSource: source(), now: () => Date.parse('2026-08-28T02:00:00.000Z'), currentOpen };
  const first = await searchRecovery({ request: { schemaVersion: 'project-hub-recovery-flow-request/v2', projectId: 'project/alpha', action: 'search', openFlowFingerprint: currentOpen.flowFingerprint, query: '  RECOVERY  ', limit: 25 }, dependencies: deps });
  const second = await searchRecovery({ request: { schemaVersion: 'project-hub-recovery-flow-request/v2', projectId: 'project/alpha', action: 'search', openFlowFingerprint: currentOpen.flowFingerprint, query: 'decision', limit: 25 }, dependencies: deps });
  const repeat = await searchRecovery({ request: { schemaVersion: 'project-hub-recovery-flow-request/v2', projectId: 'project/alpha', action: 'search', openFlowFingerprint: currentOpen.flowFingerprint, query: '  RECOVERY  ', limit: 25 }, dependencies: deps });
  assert.equal(first.stage, 'searched');
  assert.equal(second.stage, 'searched');
  if (first.stage !== 'searched' || second.stage !== 'searched') return;
  assert.equal(first.payload.query, 'RECOVERY');
  assert.ok(first.flowFingerprint !== second.flowFingerprint);
  assert.deepEqual(first.payload.results, (repeat as Extract<typeof repeat, { stage: 'searched' }>).payload.results);
  assert.deepEqual(first.ownerLocks.map((lock) => lock.owner), ['project', 'work-os', 'workflow', 'project-memory', 'session-record', 'source-evidence', 'agent-domain', 'settings']);
  assert.ok(first.payload.results.every((item) => item.projectId === 'project/alpha' && item.citationTargets.length >= 1 && item.citationTargets.length <= 4));
});

test('search recomputes open and returns an explicit stale branch when an owner changes', async () => {
  const priorOpen = await composeRecoveryOpenStage('project/alpha', openOwners(), '2026-08-28T02:00:00.000Z');
  assert.equal(priorOpen.stage, 'open');
  if (priorOpen.stage !== 'open') return;
  const changedOwners = { ...openOwners(), loadWorkItems: () => [{ entity: 'project/alpha/issue/build', label: 'Changed recovery', state: 'in-progress', blockedBy: [], citationTargets: ['issue:build'], currentStage: 'build' }] };
  const result = await searchRecovery({ request: { schemaVersion: 'project-hub-recovery-flow-request/v2', projectId: 'project/alpha', action: 'search', openFlowFingerprint: priorOpen.flowFingerprint, query: 'recovery', limit: 1 }, dependencies: { openOwners: changedOwners, searchSource: source(), now: () => Date.parse('2026-08-28T02:00:00.000Z'), currentOpen: priorOpen } });
  assert.equal(result.stage, 'stale');
  if (result.stage !== 'stale') return;
  assert.equal(result.payload.priorFlowFingerprint, priorOpen.flowFingerprint);
  assert.ok(result.payload.changedOwners.includes('work-os'));
  assert.equal(result.nextRequests[0]?.action, 'restart');
});

test('unsafe and oversized queries reject before owner search', async () => {
  let calls = 0;
  const owners = openOwners();
  const sourceSpy = createProjectSearchSource({ 'work-os': () => { calls += 1; return []; } });
  const open = await composeRecoveryOpenStage('project/alpha', owners, '2026-08-28T02:00:00.000Z');
  assert.equal(open.stage, 'open');
  if (open.stage !== 'open') return;
  await assert.rejects(() => searchRecovery({ request: { schemaVersion: 'project-hub-recovery-flow-request/v2', projectId: 'project/alpha', action: 'search', openFlowFingerprint: open.flowFingerprint, query: 'x'.repeat(2049), limit: 1 }, dependencies: { openOwners: owners, searchSource: sourceSpy } }), /maximum byte bound/u);
  assert.equal(calls, 0);
});
