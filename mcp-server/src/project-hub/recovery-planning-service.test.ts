import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecoveryPlanningService } from './recovery-planning-service.js';
import type { RecoveryPlanDependencies } from './recovery-planning-service.js';
import { composeRecoveryOpenStage } from './recovery-open.js';

test('planning service exposes only the independent planning capability', () => {
  const dependencies = {} as RecoveryPlanDependencies;
  const service = createRecoveryPlanningService(dependencies);
  assert.deepEqual(service.capabilityFact, {
    capability: 'workflow.recovery.plan',
    state: 'available',
  });
  assert.equal('workflow.recovery.apply' in service.capabilityFact, false);
});

test('planning service delegates the shared Plan composer without adding mutation inputs', async () => {
  const serviceDependencies: RecoveryPlanDependencies = {
    openOwners: {
      workflow: { readRun: () => null, listRuns: () => [], listCheckpoints: () => [], checkpointSetFingerprint: () => ('sha256:' + '0'.repeat(64)) as `sha256:${string}` },
      loadWorkItems: () => [],
      loadProjectMemory: async () => ({}),
      listSessions: async () => [],
      loadCapabilities: async () => [{ capability: 'workflow.recovery.plan', state: 'available' }],
    },
  };
  const service = createRecoveryPlanningService(serviceDependencies);
  const open = await composeRecoveryOpenStage('project/alpha', serviceDependencies.openOwners, '2026-08-28T00:00:00.000Z');
  const request = {
    schemaVersion: 'project-hub-recovery-flow-request/v2' as const,
    projectId: 'project/alpha',
    action: 'plan' as const,
    mode: 'from-search' as const,
    openFlowFingerprint: open.flowFingerprint,
    searchedBasisFlowFingerprint: 'sha256:' + '2'.repeat(64) as `sha256:${string}`,
    plannedFlowFingerprint: null,
    query: 'recovery',
    limit: 1,
    candidateId: 'resume:work-run/current',
    agentSelection: { bindingId: 'binding/alpha/builder', bindingRevision: 1 },
    priorPlan: null,
  };
  const result = await service.plan(request);
  assert.equal(result.stage, 'stale');
});
