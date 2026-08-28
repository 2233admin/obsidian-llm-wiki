import test from 'node:test';
import assert from 'node:assert/strict';
import { composeRecoveryOpenStage, type RecoveryOpenOwners } from './recovery-open.js';
import { createProjectSearchSource } from './search-source.js';
import { composeRecoveryPlannedStage } from './action-plan.js';
import { fingerprintRecoveryValue } from './contract-support.js';
import { fingerprintRecoveryFlowIntrinsicStage, RECOVERY_FLOW_SCHEMA_VERSION, RECOVERY_FLOW_REQUEST_SCHEMA_VERSION } from './recovery-flow.js';

function deps(): RecoveryOpenOwners {
  const run = { projectId: 'project/alpha', workItemId: 'project/alpha/issue/build', workRunId: 'work-run/current', agentId: 'codex', state: 'running', observedAt: '2026-08-28T00:00:00.000Z', leaseExpiresAt: null, recordFingerprint: fingerprintRecoveryValue('run'), malformed: false };
  return {
    workflow: { readRun: () => run, listRuns: () => [run], listCheckpoints: () => [], checkpointSetFingerprint: () => fingerprintRecoveryValue([]) },
    loadWorkItems: () => [{ entity: 'project/alpha/issue/build', label: 'Build recovery', state: 'in-progress', blockedBy: [], citationTargets: ['issue:build'] }],
    loadProjectMemory: async () => ({}), listSessions: async () => [], loadCapabilities: async () => [{ capability: 'workflow.recovery.apply', state: 'available' as const }],
  };
}

test('from-search emits an immutable five-minute Plan without runtime identity', async () => {
  const openOwners = deps();
  const searchSource = createProjectSearchSource({ 'work-os': () => [{ itemId: 'project/alpha/issue/build', itemType: 'issue', label: 'Build recovery', text: 'recovery', projectId: 'project/alpha', citationTargets: ['issue:build'] }] });
  const agentSelection = { listCompatible: async () => [{ role: 'builder', bindingId: 'binding/alpha/builder', bindingRevision: 2, profileId: 'agent/builder', profileRevision: 3 }] };
  const open = await composeRecoveryOpenStage('project/alpha', openOwners, '2026-08-28T02:00:00.000Z');
  assert.equal(open.stage, 'open');
  if (open.stage !== 'open') return;
  const searchRequest = open.nextRequests[0]!;
  const search = await (await import('./search.js')).searchRecovery({ request: searchRequest, dependencies: { openOwners, searchSource, agentSelection, now: () => Date.parse('2026-08-28T02:00:00.000Z') } });
  assert.equal(search.stage, 'searched');
  if (search.stage !== 'searched') return;
  const openAgain = await composeRecoveryOpenStage('project/alpha', openOwners, '2026-08-28T02:00:00.000Z');
  assert.equal(openAgain.stage, 'open');
  if (openAgain.stage === 'open') assert.equal(search.nextRequests[0]!.openFlowFingerprint, openAgain.flowFingerprint);
  const planned = await composeRecoveryPlannedStage(search.nextRequests[0]!, { openOwners, searchSource, agentSelection, now: () => Date.parse('2026-08-28T02:00:00.000Z') });
  assert.equal(planned.stage, 'planned');
  if (planned.stage !== 'planned') return;
  assert.equal(Date.parse(planned.payload.plan.expiresAt) - Date.parse(planned.payload.plan.createdAt), 300000);
  assert.equal(planned.payload.plan.leaseDurationMs, 0);
  assert.equal('agentId' in planned.payload.plan, false);
  assert.equal('query' in planned.payload.plan, false);
});

test('a mismatched searched basis returns stale with a finite restart proof', async () => {
  const openOwners = deps();
  const open = await composeRecoveryOpenStage('project/alpha', openOwners, '2026-08-28T02:00:00.000Z');
  assert.equal(open.stage, 'open');
  if (open.stage !== 'open') return;
  const request = { schemaVersion: 'project-hub-recovery-flow-request/v2' as const, projectId: 'project/alpha', action: 'plan' as const, mode: 'from-search' as const, openFlowFingerprint: open.flowFingerprint, searchedBasisFlowFingerprint: fingerprintRecoveryValue('wrong'), plannedFlowFingerprint: null, query: 'recovery', limit: 5, candidateId: 'resume:work-run/current', agentSelection: { bindingId: 'binding/alpha/builder', bindingRevision: 2 }, priorPlan: null };
  const result = await composeRecoveryPlannedStage(request, { openOwners, searchSource: createProjectSearchSource({}), agentSelection: { listCompatible: async () => [{ role: 'builder', bindingId: 'binding/alpha/builder', bindingRevision: 2, profileId: 'agent/builder', profileRevision: 3 }] }, now: () => Date.parse('2026-08-28T02:00:00.000Z') });
  assert.equal(result.stage, 'stale');
  if (result.stage !== 'stale') return;
  assert.equal(result.nextRequests[0]?.action, 'restart');
  assert.equal('response' in result.payload, false);
});

test('refresh rejects a self-consistent prior Plan whose bound owner lock is not current', async () => {
  const openOwners = deps();
  const searchSource = createProjectSearchSource({ 'work-os': () => [{ itemId: 'project/alpha/issue/build', itemType: 'issue', label: 'Build recovery', text: 'recovery', projectId: 'project/alpha', citationTargets: ['issue:build'] }] });
  const agentSelection = { listCompatible: async () => [{ role: 'builder', bindingId: 'binding/alpha/builder', bindingRevision: 2, profileId: 'agent/builder', profileRevision: 3 }] };
  const now = () => Date.parse('2026-08-28T02:00:00.000Z');
  const open = await composeRecoveryOpenStage('project/alpha', openOwners, '2026-08-28T02:00:00.000Z');
  assert.equal(open.stage, 'open');
  if (open.stage !== 'open') return;
  const search = await (await import('./search.js')).searchRecovery({ request: open.nextRequests[0]!, dependencies: { openOwners, searchSource, agentSelection, now } });
  assert.equal(search.stage, 'searched');
  if (search.stage !== 'searched') return;
  const planned = await composeRecoveryPlannedStage(search.nextRequests[0]!, { openOwners, searchSource, agentSelection, now });
  assert.equal(planned.stage, 'planned');
  if (planned.stage !== 'planned') return;
  const tamperedPlan = {
    ...planned.payload.plan,
    ownerLocks: planned.payload.plan.ownerLocks.map((lock) => lock.owner === 'workflow' ? { ...lock, revision: 999 } : lock),
  };
  const priorPlan = { ...tamperedPlan, fingerprint: fingerprintRecoveryValue(tamperedPlan) };
  const intent = { action: 'refresh-plan' as const, query: 'recovery', limit: 25, priorPlan };
  const intrinsic = {
    schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION,
    stage: 'planned' as const,
    projectId: priorPlan.projectId,
    previousFlowFingerprint: priorPlan.searchedBasisFlowFingerprint,
    actionInputFingerprint: fingerprintRecoveryValue({ action: 'plan', projectId: priorPlan.projectId, candidateId: priorPlan.candidateId }),
    recoveryFingerprint: priorPlan.recoveryFingerprint,
    ownerLocks: priorPlan.ownerLocks,
    payloadFingerprint: fingerprintRecoveryValue({ kind: 'planned' as const, plan: priorPlan, candidates: [priorPlan.candidateId] }),
    nextRequestIntents: [intent], diagnostics: [], omitted: { items: 0, citations: 0, diagnostics: 0, bytes: 0 },
  };
  const result = await composeRecoveryPlannedStage({
    schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
    projectId: priorPlan.projectId,
    action: 'refresh-plan',
    openFlowFingerprint: priorPlan.rootOpenFlowFingerprint,
    searchedBasisFlowFingerprint: priorPlan.searchedBasisFlowFingerprint,
    plannedFlowFingerprint: fingerprintRecoveryFlowIntrinsicStage(intrinsic),
    query: 'recovery', limit: 25, priorPlan,
  }, { openOwners, searchSource, agentSelection, now });
  assert.equal(result.stage, 'stale');
});
