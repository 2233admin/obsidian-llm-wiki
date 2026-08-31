import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeRecoveryPlanOperation, validateWorkflowRecoveryPlanEnvelopeV1, WORKFLOW_RECOVERY_PLAN_REQUEST_SCHEMA_VERSION } from './recovery-plan.js';
import { composeRecoveryOpenStage, type RecoveryOpenOwners } from '../project-hub/recovery-open.js';
import { createProjectSearchSource } from '../project-hub/search-source.js';
import { searchRecovery } from '../project-hub/search.js';
import { createRecoveryPlanningService } from '../project-hub/recovery-planning-service.js';
import { fingerprintRecoveryValue } from '../project-hub/contract-support.js';

const service = {
  capabilityFact: { capability: 'workflow.recovery.plan' as const, state: 'available' as const },
  plan: async (request: unknown) => ({ request, stage: 'planned' }),
};

test('workflow.recovery.plan is read-only and exposes the exact outer envelope', () => {
  const operation = makeRecoveryPlanOperation(service as never);
  assert.equal(operation.name, 'workflow.recovery.plan');
  assert.equal(operation.namespace, 'workflow');
  assert.equal(operation.mutating, false);
  assert.deepEqual(Object.keys(operation.params), ['request']);
  assert.match(operation.params.request?.description ?? '', new RegExp(WORKFLOW_RECOVERY_PLAN_REQUEST_SCHEMA_VERSION));
  assert.equal('writePolicy' in operation, false);
});

test('workflow.recovery.plan accepts only closed plan and refresh arms', async () => {
  const operation = makeRecoveryPlanOperation(service as never);
  const request = {
    schemaVersion: 'project-hub-recovery-flow-request/v2',
    projectId: 'project/alpha',
    action: 'plan',
    mode: 'from-search',
    openFlowFingerprint: 'sha256:' + '1'.repeat(64),
    searchedBasisFlowFingerprint: 'sha256:' + '2'.repeat(64),
    plannedFlowFingerprint: null,
    query: 'recovery',
    limit: 1,
    candidateId: 'resume:work-run/current',
    agentSelection: { bindingId: 'binding/alpha/builder', bindingRevision: 1 },
    priorPlan: null,
  };
  const result = await operation.handler(null as never, { request: { schemaVersion: WORKFLOW_RECOVERY_PLAN_REQUEST_SCHEMA_VERSION, request } });
  assert.equal((result as { stage: string }).stage, 'planned');
  assert.throws(() => validateWorkflowRecoveryPlanEnvelopeV1({ schemaVersion: WORKFLOW_RECOVERY_PLAN_REQUEST_SCHEMA_VERSION, request: { ...request, action: 'open' } }), /unknown|plan or refresh-plan/);
  assert.throws(() => validateWorkflowRecoveryPlanEnvelopeV1({ schemaVersion: WORKFLOW_RECOVERY_PLAN_REQUEST_SCHEMA_VERSION, request, extra: true }), /unknown|closed|request/);
});

test('compiled direct Operation reaches planned with apply absent', async () => {
  const fixtureRoot = join(tmpdir(), `llmwiki-recovery-plan-smoke-${randomUUID()}`);
  mkdirSync(join(fixtureRoot, '_llmwiki', 'recovery'), { recursive: true });
  const fixturePath = join(fixtureRoot, '_llmwiki', 'recovery', 'fixture.md');
  writeFileSync(fixturePath, 'read-only fixture\n', 'utf8');
  const beforeBytes = readFileSync(fixturePath);
  const beforeHash = createHash('sha256').update(beforeBytes).digest('hex');
  try {
    const run = { projectId: 'project/alpha', workItemId: 'project/alpha/issue/build', workRunId: 'work-run/current', agentId: 'codex', state: 'running', observedAt: '2026-08-28T00:00:00.000Z', leaseExpiresAt: null, recordFingerprint: fingerprintRecoveryValue('run'), malformed: false };
    const openOwners: RecoveryOpenOwners = {
      workflow: { readRun: () => run, listRuns: () => [run], listCheckpoints: () => [], checkpointSetFingerprint: () => fingerprintRecoveryValue([]) },
      loadWorkItems: () => [{ entity: 'project/alpha/issue/build', label: 'Build recovery', state: 'in-progress', blockedBy: [], citationTargets: ['issue:build'] }],
      loadProjectMemory: async () => ({}),
      listSessions: async () => [],
      listSourceEvidence: async () => ({ records: [] }),
      loadAgentDomainCapabilities: async () => ({ records: [{ capability: 'workflow.recovery.plan', state: 'available' as const }] }),
      loadSettingsCapabilities: async () => ({ records: [] }),
    };
    const dependencies = {
      openOwners,
      searchSource: createProjectSearchSource({ 'work-os': () => [{ itemId: 'project/alpha/issue/build', itemType: 'issue', label: 'Build recovery', text: 'recovery', projectId: 'project/alpha', citationTargets: ['issue:build'] }] }),
      agentSelection: { listCompatible: async () => [{ role: 'builder', bindingId: 'binding/alpha/builder', bindingRevision: 2, profileId: 'agent/builder', profileRevision: 3 }] },
      now: () => Date.parse('2026-08-28T02:00:00.000Z'),
    };
    const open = await composeRecoveryOpenStage('project/alpha', openOwners, '2026-08-28T02:00:00.000Z');
    assert.equal(open.stage, 'open');
    if (open.stage !== 'open') return;
    const searched = await searchRecovery({ request: open.nextRequests[0]!, dependencies });
    assert.equal(searched.stage, 'searched');
    if (searched.stage !== 'searched') return;
    const operation = makeRecoveryPlanOperation(createRecoveryPlanningService(dependencies));
    const planned = await operation.handler(null as never, { request: { schemaVersion: WORKFLOW_RECOVERY_PLAN_REQUEST_SCHEMA_VERSION, request: searched.nextRequests[0] } });
    assert.equal((planned as { stage: string }).stage, 'planned');
    const plan = (planned as { payload: { plan: { owningOperation: string; capabilityFacts: Array<{ capability: string }> } } }).payload.plan;
    assert.equal(plan.owningOperation, 'workflow.recovery.apply');
    assert.deepEqual(plan.capabilityFacts.map((fact) => fact.capability), ['workflow.recovery.plan']);
    const afterBytes = readFileSync(fixturePath);
    assert.equal(afterBytes.byteLength, beforeBytes.byteLength);
    assert.equal(createHash('sha256').update(afterBytes).digest('hex'), beforeHash);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
