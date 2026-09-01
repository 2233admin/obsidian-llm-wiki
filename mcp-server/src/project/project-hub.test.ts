import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AdapterRegistry } from '../adapters/registry.js';
import type { VaultMindAdapter } from '../adapters/interface.js';
import type { OperationContext } from '../core/types.js';
import { createDefaultRecoveryRuntime, makeProjectHubOps } from './project-hub.js';
import { createProjectSearchSource } from '../project-hub/search-source.js';
import { fingerprintRecoveryValue } from '../project-hub/contract-support.js';
import type { RecoveryOpenOwners } from '../project-hub/recovery-open.js';
import type { WorkflowReadModel } from '../workflow/workflow-read-model.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
type RuntimeHub = {
  sections: {
    runtime: {
      data: {
        activeRuns: readonly Record<string, unknown>[];
        staleRuns: readonly Record<string, unknown>[];
        runCount: number;
        agentStateFiles: readonly string[];
        workflowState: unknown;
        stage: string | null;
        stageCitation: string | null;
      };
      drift: readonly string[];
      health: string;
      citationTargets: readonly string[];
      freshness: string | null;
    };
  };
};

function fixture(): { root: string; ctx: OperationContext; registry: AdapterRegistry; openOwners: RecoveryOpenOwners } {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-hub-')); roots.push(root);
  mkdirSync(join(root, 'Projects'), { recursive: true });
  mkdirSync(join(root, '01-Projects', 'alpha', 'issues'), { recursive: true });
  mkdirSync(join(root, '01-Projects', 'alpha', 'runs'), { recursive: true });
  writeFileSync(join(root, 'Projects', 'alpha.md'), '---\ntype: project\nentity: project/alpha\nlifecycle: active\n---\n# Alpha\n');
  writeFileSync(join(root, '01-Projects', 'alpha', '_project.md'), '---\nentity: project/alpha\n---\n');
  writeFileSync(join(root, '01-Projects', 'alpha', 'issues', 'build.md'), '---\ntype: issue\nentity: project/alpha/issue/build\nstate: in-progress\nreview: reviewed\n---\nBuild recovery\n');
  writeFileSync(join(root, '01-Projects', 'alpha', 'runs', 'current.json'), JSON.stringify({ project_id: 'project/alpha', work_run_id: 'work-run/current', state: 'running', work_item_id: 'project/alpha/issue/build', agent_id: 'codex', observed_at: '2026-08-28T00:00:00.000Z' }));
  const run = { projectId: 'project/alpha', workItemId: 'project/alpha/issue/build', workRunId: 'work-run/current', agentId: 'codex', state: 'running', observedAt: '2026-08-28T00:00:00.000Z', leaseExpiresAt: null, recordFingerprint: fingerprintRecoveryValue('run'), malformed: false };
  const openOwners: RecoveryOpenOwners = {
    workflow: { readRun: () => run, listRuns: () => [run], listCheckpoints: () => [], checkpointSetFingerprint: () => fingerprintRecoveryValue([]), readRuntimeProjection: () => ({ activeRuns: [], staleRuns: [], runCount: 0, agentStateFiles: [], workflowState: null, stage: null, stageCitation: null, sourceFiles: [], drift: [] }) },
    loadWorkItems: () => [{ entity: 'project/alpha/issue/build', label: 'Build recovery', state: 'in-progress', blockedBy: [], citationTargets: ['issue:build'] }],
    loadProjectMemory: async () => ({ revision: 1, fingerprint: fingerprintRecoveryValue('memory'), freshness: 'current', reviewedDecisions: [] }),
    listSessions: async () => [],
    listSourceEvidence: async () => ({ records: [] }),
    loadAgentDomainCapabilities: async () => ({ records: [{ capability: 'workflow.recovery.plan', state: 'available', citationTargets: ['capability:plan'] }] }),
    loadSettingsCapabilities: async () => ({ records: [] }),
  };
  const registry = new AdapterRegistry();
  const adapter: VaultMindAdapter = { name: 'filesystem', capabilities: ['search', 'read'], isAvailable: true, async init() {}, async dispose() {} };
  registry.register(adapter);
  const ctx = { vault: { async execute() { return {}; } }, adapters: registry, config: { vault_path: root, collaboration: { role: 'agent', enforce: true, allowed_write_paths: [] } }, logger: { info() {}, warn() {}, error() {} }, dryRun: true } satisfies OperationContext;
  return { root, ctx, registry, openOwners };
}

describe('project.hub', () => {
  test('keeps ordinary Hub composition separate from Recovery Flow', async () => {
    const { ctx, registry, openOwners } = fixture();
    const operations = makeProjectHubOps(registry, undefined, {
      recoveryFlow: {
        openOwners,
        searchSource: createProjectSearchSource({ 'work-os': () => [{ itemId: 'project/alpha/issue/build', itemType: 'issue', label: 'Build recovery', text: 'recovery', projectId: 'project/alpha', citationTargets: ['issue:build'] }] }),
        agentSelection: { listCompatible: async () => [{ role: 'builder', bindingId: 'binding/alpha/builder', bindingRevision: 2, profileId: 'agent/builder', profileRevision: 3 }] },
        now: () => Date.parse('2026-08-28T02:00:00.000Z'),
      },
    });
    assert.deepEqual(operations.map((operation) => operation.name), ['project.hub.get', 'project.hub.recovery.flow', 'project.hub.text', 'project.hub.base', 'project.hub.canvas']);
    assert.ok(operations.every((operation) => operation.mutating !== true));
    const hub = await operations[0]!.handler(ctx, { ref: 'project/alpha' }) as Record<string, unknown>;
    assert.equal('recovery' in hub, false);
  });

  test('runs open, cited search, and one exact immutable Plan through one read operation', async () => {
    const { ctx, registry, openOwners } = fixture();
    const options = { recoveryFlow: {
      openOwners,
      searchSource: createProjectSearchSource({ 'work-os': () => [{ itemId: 'project/alpha/issue/build', itemType: 'issue', label: 'Build recovery', text: 'recovery', projectId: 'project/alpha', citationTargets: ['issue:build'] }] }),
      agentSelection: { listCompatible: async () => [{ role: 'builder', bindingId: 'binding/alpha/builder', bindingRevision: 2, profileId: 'agent/builder', profileRevision: 3 }] },
      now: () => Date.parse('2026-08-28T02:00:00.000Z'),
    } };
    const flow = makeProjectHubOps(registry, undefined, options)[1]!;
    const open = await flow.handler(ctx, { request: { schemaVersion: 'project-hub-recovery-flow-request/v2', projectId: 'project/alpha', action: 'open' } }) as any;
    assert.equal(open.stage, 'open');
    const search = await flow.handler(ctx, { request: open.nextRequests[0] }) as any;
    assert.equal(search.stage, 'searched');
    assert.equal(search.nextRequests.length, 1);
    const planned = await flow.handler(ctx, { request: search.nextRequests[0] }) as any;
    assert.equal(planned.stage, 'planned');
    assert.equal(planned.payload.plan.owningOperation, 'workflow.recovery.apply');
    assert.equal(planned.payload.plan.workRunId, 'work-run/current');
    assert.equal(planned.payload.plan.agentSelection.bindingRevision, 2);
    assert.equal('agentId' in planned.payload.plan, false);
    assert.equal('host' in planned.payload.plan, false);
  });

  test('requires explicit Binding selection when compatible Bindings are multiple', async () => {
    const { ctx, registry, openOwners } = fixture();
    const flow = makeProjectHubOps(registry, undefined, { recoveryFlow: {
      openOwners,
      searchSource: createProjectSearchSource({ 'work-os': () => [{ itemId: 'project/alpha/issue/build', itemType: 'issue', label: 'Build recovery', text: 'recovery', projectId: 'project/alpha', citationTargets: ['issue:build'] }] }),
      agentSelection: { listCompatible: async () => [
        { role: 'one', bindingId: 'binding/alpha/one', bindingRevision: 1, profileId: 'agent/one', profileRevision: 1 },
        { role: 'two', bindingId: 'binding/alpha/two', bindingRevision: 1, profileId: 'agent/two', profileRevision: 1 },
      ] },
    } })[1]!;
    const open = await flow.handler(ctx, { request: { schemaVersion: 'project-hub-recovery-flow-request/v2', projectId: 'project/alpha', action: 'open' } }) as any;
    const result = await flow.handler(ctx, { request: open.nextRequests[0] }) as any;
    assert.equal(result.stage, 'needs-agent-selection');
    assert.equal(result.payload.bindings.length, 2);
    assert.equal(result.nextRequests.length, 0);
  });

  test('default Recovery Flow wiring does not advertise an unregistered apply capability', async () => {
    const { ctx, registry } = fixture();
    const flow = makeProjectHubOps(registry)[1]!;
    const open = await flow.handler(ctx, { request: { schemaVersion: 'project-hub-recovery-flow-request/v2', projectId: 'project/alpha', action: 'open' } }) as any;
    assert.equal(open.stage, 'open');
    assert.equal(open.payload.capabilities?.some((item: any) => item.capability === 'workflow.recovery.apply'), false);
  });
  test('default Recovery owners keep Settings separate from Agent Domain planning facts', async () => {
    const { ctx, registry } = fixture();
    const flow = makeProjectHubOps(registry)[1]!;
    const open = await flow.handler(ctx, { request: { schemaVersion: 'project-hub-recovery-flow-request/v2', projectId: 'project/alpha', action: 'open' } }) as {
      ownerLocks: Array<{ owner: string; revision?: string | number | null; fingerprint?: string | null }>;
      payload: { capabilities: Array<{ capability: string }> };
    };
    const locks = new Map(open.ownerLocks.map((lock) => [lock.owner, lock]));
    assert.equal(locks.get('settings')?.revision, 'settings-owner/v1');
    assert.notEqual(locks.get('agent-domain')?.fingerprint, locks.get('settings')?.fingerprint);
    assert.equal(open.payload.capabilities.some((item) => item.capability === 'workflow.recovery.plan'), true);
  });

  test('default Recovery search reads every canonical owner and exposes an alternate Work Run', async () => {
    const { ctx, registry, root } = fixture();
    writeFileSync(join(root, '01-Projects', 'alpha', 'runs', 'alternate.json'), JSON.stringify({ project_id: 'project/alpha', work_run_id: 'work-run/alternate', state: 'running', work_item_id: 'project/alpha/issue/build', agent_id: 'codex', observed_at: '2026-08-28T01:00:00.000Z' }));
    mkdirSync(join(root, '10-Projects', 'alpha', 'agents', 'codex', 'research', 'records'), { recursive: true });
    writeFileSync(join(root, '10-Projects', 'alpha', 'agents', 'codex', 'research', 'records', 'decision.json'), JSON.stringify({ schemaVersion: 'research-record/v1', recordId: 'research/decision', projectId: 'project/alpha', sessionRefs: [], decisions: ['Recovery remains read-only'], sources: ['decision:recovery'], reviewStatus: 'reviewed' }));
    mkdirSync(join(root, '10-Projects', 'alpha', 'sessions', 'records'), { recursive: true });
    writeFileSync(join(root, '10-Projects', 'alpha', 'sessions', 'records', 'session.json'), JSON.stringify({ schemaVersion: 'session-record/v1', sessionId: 'session/current', projectId: 'project/alpha', source: 'import', status: 'captured', host: 'codex', capturedAt: '2026-08-28T01:00:00.000Z', sourceRefs: ['session:current'], revision: 1 }));
    mkdirSync(join(root, '_llmwiki'), { recursive: true });
    writeFileSync(join(root, '_llmwiki', 'source-registry.json'), JSON.stringify({ version: 1, updated_at: '2026-08-28T01:00:00.000Z', sources: { src_alpha: { id: 'src_alpha', inputType: 'url', input: 'https://example.test/recovery', canonical: 'https://example.test/recovery', platform: 'web', sourceKind: 'post', title: 'Recovery source', project: 'alpha', projectId: 'project/alpha', actor: 'agent', notePath: '10-Projects/alpha/sources/web/recovery.md', tags: ['recovery'], created_at: '2026-08-28T00:00:00.000Z', updated_at: '2026-08-28T00:00:00.000Z' } } }));
    mkdirSync(join(root, '00-Inbox', 'Evidence'), { recursive: true });
    writeFileSync(join(root, '00-Inbox', 'Evidence', 'recovery.md'), ['---', 'llmwiki-evidence: true', 'source-id: src_alpha', 'validation-status: accepted', '---', '', '# Evidence · Recovery source', '', 'Recovery evidence is safe and cited.'].join('\n'));

    const runtime = createDefaultRecoveryRuntime({ vaultPath: root, registry, capabilityFact: { capability: 'workflow.recovery.plan', state: 'available' } });
    const sourceRegistryPath = join(root, '_llmwiki', 'source-registry.json');
    const sourceRegistry = JSON.parse(readFileSync(sourceRegistryPath, 'utf8')) as { version: number; updated_at: string; sources: Record<string, Record<string, unknown>> };
    sourceRegistry.sources.src_beta = { ...sourceRegistry.sources.src_alpha, id: 'src_beta', title: 'Second recovery source' };
    writeFileSync(sourceRegistryPath, JSON.stringify(sourceRegistry));
    const firstEvidence = await runtime.dependencies.openOwners.listSourceEvidence('project/alpha');
    sourceRegistry.sources = Object.fromEntries(Object.entries(sourceRegistry.sources).reverse());
    writeFileSync(sourceRegistryPath, JSON.stringify(sourceRegistry));
    const secondEvidence = await runtime.dependencies.openOwners.listSourceEvidence('project/alpha');
    assert.deepEqual(secondEvidence.records, firstEvidence.records);
    assert.equal(secondEvidence.fingerprint, firstEvidence.fingerprint);
    const snapshots = await runtime.dependencies.searchSource!.snapshot('project/alpha');
    assert.deepEqual(snapshots.map((snapshot) => snapshot.owner), ['work-os', 'project-memory', 'source-evidence', 'session-record', 'workflow']);
    assert.ok(snapshots.find((snapshot) => snapshot.owner === 'project-memory')?.items.length);
    assert.ok(snapshots.find((snapshot) => snapshot.owner === 'source-evidence')?.items.length);
    assert.ok(snapshots.find((snapshot) => snapshot.owner === 'session-record')?.items.length);
    assert.ok(snapshots.find((snapshot) => snapshot.owner === 'workflow')?.items.some((item) => item.itemType === 'work-run'));
    assert.doesNotMatch(JSON.stringify(snapshots), /absolute|private|token|prompt|transcript|C:\\\\Users/u);

    const flow = makeProjectHubOps(registry, undefined, {
      recoveryRuntime: runtime,
      recoveryFlow: {
        agentSelection: { listCompatible: async () => [{ role: 'builder', bindingId: 'binding/alpha/builder', bindingRevision: 1, profileId: 'agent/builder', profileRevision: 1 }] },
        now: () => Date.parse('2026-08-28T02:00:00.000Z'),
      },
    })[1]!;
    const open = await flow.handler(ctx, { request: { schemaVersion: 'project-hub-recovery-flow-request/v2', projectId: 'project/alpha', action: 'open' } }) as any;
    const searched = await flow.handler(ctx, { request: { ...open.nextRequests[0], query: 'build', limit: 25 } }) as any;
    assert.equal(searched.stage, 'searched');
    assert.deepEqual(searched.payload.candidates.map((candidate: any) => candidate.workRunId), ['work-run/alternate', 'work-run/current']);
    assert.equal(searched.payload.recommendedCandidateId, 'resume:work-run/alternate');
    const planned = await flow.handler(ctx, { request: searched.nextRequests[0] }) as any;
    assert.equal(planned.stage, 'planned');
    assert.deepEqual(planned.payload.candidates, ['resume:work-run/alternate', 'resume:work-run/current']);
    const replacement = await flow.handler(ctx, { request: planned.nextRequests[0] }) as any;
    assert.equal(replacement.stage, 'planned');
    assert.equal(replacement.payload.plan.workRunId, 'work-run/current');
  });

  test('default Source Registry search owner treats missing as empty and malformed as unavailable', async () => {
    const { registry, root } = fixture();
    const runtime = createDefaultRecoveryRuntime({ vaultPath: root, registry, capabilityFact: { capability: 'workflow.recovery.plan', state: 'available' } });
    const missing = await runtime.dependencies.searchSource!.snapshot('project/alpha');
    assert.equal(missing.find((snapshot) => snapshot.owner === 'source-evidence')?.state, 'current');
    mkdirSync(join(root, '_llmwiki'), { recursive: true });
    writeFileSync(join(root, '_llmwiki', 'source-registry.json'), '{ malformed');
    const malformed = await runtime.dependencies.searchSource!.snapshot('project/alpha');
    const source = malformed.find((snapshot) => snapshot.owner === 'source-evidence');
    assert.equal(source?.state, 'unavailable');
    assert.ok(source?.diagnostics.some((item) => item.code === 'owner_unavailable'));
    writeFileSync(join(root, '_llmwiki', 'source-registry.json'), JSON.stringify({ version: 1, sources: { broken: 'not-a-source-record' } }));
    const malformedRecord = await runtime.dependencies.searchSource!.snapshot('project/alpha');
    assert.equal(malformedRecord.find((snapshot) => snapshot.owner === 'source-evidence')?.state, 'unavailable');
  });

  test('default Recovery owners stay deterministic, project-scoped, and read-only across query branches', async () => {
    const { ctx, registry, root } = fixture();
    writeFileSync(join(root, '01-Projects', 'alpha', 'issues', 'foreign.md'), '---\ntype: issue\nentity: project/beta/issue/secret\nstate: in-progress\nreview: reviewed\n---\nprivate token transcript must not appear\n');
    writeFileSync(join(root, '01-Projects', 'alpha', 'runs', 'foreign.json'), JSON.stringify({ project_id: 'project/beta', work_run_id: 'work-run/foreign', state: 'running', work_item_id: 'project/beta/issue/secret', agent_id: 'codex', observed_at: '2026-08-28T01:30:00.000Z' }));
    mkdirSync(join(root, '10-Projects', 'alpha', 'sessions', 'records'), { recursive: true });
    writeFileSync(join(root, '10-Projects', 'alpha', 'sessions', 'records', 'foreign.json'), JSON.stringify({ schemaVersion: 'session-record/v1', sessionId: 'session/foreign', projectId: 'project/beta', status: 'captured', sourceRefs: ['private-token'] }));
    mkdirSync(join(root, '_llmwiki'), { recursive: true });
    writeFileSync(join(root, '_llmwiki', 'source-registry.json'), JSON.stringify({ version: 1, updated_at: '2026-08-28T01:00:00.000Z', sources: {
      src_alpha: { id: 'src_alpha', inputType: 'url', input: 'https://example.test/alpha', canonical: 'https://example.test/alpha', platform: 'web', sourceKind: 'post', title: 'Alpha source', project: 'alpha', projectId: 'project/alpha', actor: 'agent', notePath: '10-Projects/alpha/sources/web/alpha.md', tags: ['recovery'], created_at: '2026-08-28T00:00:00.000Z', updated_at: '2026-08-28T00:00:00.000Z' },
      src_beta: { id: 'src_beta', inputType: 'url', input: 'https://example.test/beta', canonical: 'https://example.test/beta', platform: 'web', sourceKind: 'post', title: 'Beta private token transcript', project: 'beta', projectId: 'project/beta', actor: 'agent', notePath: '10-Projects/beta/sources/web/beta.md', tags: ['private'], created_at: '2026-08-28T00:00:00.000Z', updated_at: '2026-08-28T00:00:00.000Z' },
    } }));
    mkdirSync(join(root, '00-Inbox', 'Evidence'), { recursive: true });
    writeFileSync(join(root, '00-Inbox', 'Evidence', 'alpha.md'), '---\nllmwiki-evidence: true\nsource-id: src_alpha\n---\n\nAlpha evidence for build recovery.');
    writeFileSync(join(root, '00-Inbox', 'Evidence', 'beta.md'), '---\nllmwiki-evidence: true\nsource-id: src_beta\n---\n\nPrivate token transcript.');
    const tracked = [
      '01-Projects/alpha/issues/build.md', '01-Projects/alpha/issues/foreign.md',
      '01-Projects/alpha/runs/current.json', '01-Projects/alpha/runs/foreign.json',
      '10-Projects/alpha/sessions/records/foreign.json', '_llmwiki/source-registry.json',
      '00-Inbox/Evidence/alpha.md', '00-Inbox/Evidence/beta.md',
    ];
    const hash = () => createHash('sha256').update(tracked.map((path) => `${path}\0${readFileSync(join(root, path), 'utf8')}`).join('\0')).digest('hex');
    const before = hash();
    const runtime = createDefaultRecoveryRuntime({ vaultPath: root, registry, capabilityFact: { capability: 'workflow.recovery.plan', state: 'available' } });
    const first = await runtime.dependencies.searchSource!.snapshot('project/alpha');
    const second = await runtime.dependencies.searchSource!.snapshot('project/alpha');
    assert.deepEqual(second, first);
    assert.doesNotMatch(JSON.stringify(first), /project\/beta|private|token|transcript|secret/i);
    const flow = makeProjectHubOps(registry, undefined, { recoveryRuntime: runtime, recoveryFlow: { agentSelection: { listCompatible: async () => [{ role: 'builder', bindingId: 'binding/alpha/builder', bindingRevision: 1, profileId: 'agent/builder', profileRevision: 1 }] } } })[1]!;
    const open = await flow.handler(ctx, { request: { schemaVersion: 'project-hub-recovery-flow-request/v2', projectId: 'project/alpha', action: 'open' } }) as any;
    const searchedBuild = await flow.handler(ctx, { request: { ...open.nextRequests[0], query: 'build', limit: 25 } }) as any;
    const searchedRecovery = await flow.handler(ctx, { request: { ...open.nextRequests[0], query: 'recovery', limit: 25 } }) as any;
    assert.equal(searchedBuild.stage, 'searched');
    assert.equal(searchedRecovery.stage, 'searched');
    const mixed = await flow.handler(ctx, { request: { ...searchedBuild.nextRequests[0], query: 'recovery' } }) as any;
    assert.equal(mixed.stage, 'stale');
    assert.equal(hash(), before);
  });
  test('runtime assembly reads one projection and never legacy Work Run readers', async () => {
    const { ctx, registry, root } = fixture();
    const observedAt = Date.parse('2026-08-28T02:00:00.000Z');
    let projectionCalls = 0;
    let projectionArguments: [string, number | undefined] | undefined;
    let legacyReaderCalls = 0;
    const workflowReadModel: WorkflowReadModel = {
      readRun() {
        legacyReaderCalls += 1;
        return null;
      },
      listRuns() {
        legacyReaderCalls += 1;
        return [];
      },
      listCheckpoints() {
        legacyReaderCalls += 1;
        return [];
      },
      checkpointSetFingerprint() {
        legacyReaderCalls += 1;
        return fingerprintRecoveryValue([]);
      },
      readRuntimeProjection(projectId, requestedObservedAt) {
        projectionCalls += 1;
        projectionArguments = [projectId, requestedObservedAt];
        return {
          activeRuns: [{
            projectId,
            workRunId: 'work-run/injected',
            workItemId: 'project/alpha/issue/build',
            state: 'running',
            stage: 'execute',
            resumable: true,
            path: '01-Projects/alpha/runs/current.json',
            stale: false,
            citationTargets: ['01-Projects/alpha/runs/current.json'],
          }],
          staleRuns: [],
          runCount: 1,
          agentStateFiles: [],
          workflowState: null,
          stage: 'execute',
          stageCitation: '01-Projects/alpha/runs/current.json',
          sourceFiles: ['01-Projects/alpha/runs/current.json'],
          drift: ['injected_projection_drift'],
        };
      },
    };
    const hub = await makeProjectHubOps(registry, undefined, {
      now: () => observedAt,
      workflowReadModel,
    })[0]!.handler(ctx, { ref: 'project/alpha' }) as RuntimeHub;
    const runtime = hub.sections.runtime;
    assert.equal(projectionCalls, 1);
    assert.deepEqual(projectionArguments, ['project/alpha', observedAt]);
    assert.equal(legacyReaderCalls, 0);
    assert.deepEqual(runtime.data.activeRuns, [{
      projectId: 'project/alpha',
      workRunId: 'work-run/injected',
      workItemId: 'project/alpha/issue/build',
      state: 'running',
      stage: 'execute',
      resumable: true,
      path: '01-Projects/alpha/runs/current.json',
      stale: false,
      citationTargets: ['01-Projects/alpha/runs/current.json'],
    }]);
    assert.deepEqual(runtime.data.staleRuns, []);
    assert.equal(runtime.data.runCount, 1);
    assert.equal(runtime.data.stage, 'execute');
    assert.equal(runtime.data.stageCitation, '01-Projects/alpha/runs/current.json');
    assert.deepEqual(runtime.drift, ['injected_projection_drift']);
    assert.deepEqual(runtime.citationTargets, ['01-Projects/alpha/runs/current.json']);
  });

  test('runtime section preserves the normal completed-state projection shape', async () => {
    const { ctx, registry, root } = fixture();
    writeFileSync(join(root, '01-Projects', 'alpha', 'runs', 'current.json'), JSON.stringify({
      project_id: 'project/alpha',
      work_run_id: 'work-run/current',
      work_item_id: 'project/alpha/issue/build',
      agent_id: 'codex',
      state: 'completed',
      stage: 'verify',
      observed_at: '2026-08-28T00:00:00.000Z',
    }));
    const hub = await makeProjectHubOps(registry)[0]!.handler(ctx, { ref: 'project/alpha' }) as RuntimeHub;
    const runtime = hub.sections.runtime;
    assert.deepEqual(runtime.data, {
      activeRuns: [],
      staleRuns: [],
      runCount: 1,
      agentStateFiles: [],
      workflowState: null,
      stage: null,
      stageCitation: null,
    });
    assert.deepEqual(runtime.citationTargets, ['01-Projects/alpha/runs/current.json']);
    assert.equal(typeof runtime.freshness, 'string');
    assert.equal(runtime.health, 'healthy');
  });

  test('runtime section preserves resumability metadata for expired valid runs', async () => {
    const { ctx, registry, root } = fixture();
    writeFileSync(join(root, '01-Projects', 'alpha', 'runs', 'current.json'), JSON.stringify({
      project_id: 'project/alpha',
      work_run_id: 'work-run/expired',
      work_item_id: 'project/alpha/issue/build',
      agent_id: 'codex',
      state: 'running',
      lease_expires_at: '2026-08-28T01:00:00.000Z',
      observed_at: '2026-08-28T00:00:00.000Z',
    }));
    const hub = await makeProjectHubOps(registry, undefined, { now: () => Date.parse('2026-08-28T02:00:00.000Z') })[0]!.handler(ctx, { ref: 'project/alpha' }) as RuntimeHub;
    const runtime = hub.sections.runtime;
    assert.deepEqual(runtime.data.activeRuns, []);
    assert.equal(runtime.data.staleRuns.length, 1);
    assert.equal(runtime.data.staleRuns[0]?.resumable, true);
    assert.ok(runtime.drift.includes('expired_work_run:01-Projects/alpha/runs/current.json'));
  });

  test('runtime section preserves lexical run ordering for staged fallback', async () => {
    const { ctx, registry, root } = fixture();
    writeFileSync(join(root, '01-Projects', 'alpha', 'runs', 'current.json'), JSON.stringify({
      project_id: 'project/alpha',
      work_run_id: 'work-run/completed',
      work_item_id: 'project/alpha/issue/build',
      agent_id: 'codex',
      state: 'completed',
      observed_at: '2026-08-28T00:00:00.000Z',
    }));
    writeFileSync(join(root, '01-Projects', 'alpha', 'runs', 'a-first.json'), JSON.stringify({
      project_id: 'project/alpha',
      work_run_id: 'work-run/a-first',
      work_item_id: 'project/alpha/issue/first',
      agent_id: 'codex',
      state: 'running',
      stage: 'first',
      observed_at: '2026-08-28T00:00:00.000Z',
    }));
    writeFileSync(join(root, '01-Projects', 'alpha', 'runs', 'z-second.json'), JSON.stringify({
      project_id: 'project/alpha',
      work_run_id: 'work-run/z-second',
      work_item_id: 'project/alpha/issue/second',
      agent_id: 'codex',
      state: 'running',
      stage: 'second',
      observed_at: '2026-08-28T01:00:00.000Z',
    }));
    const hub = await makeProjectHubOps(registry, undefined, { now: () => Date.parse('2026-08-28T02:00:00.000Z') })[0]!.handler(ctx, { ref: 'project/alpha' }) as RuntimeHub;
    const runtime = hub.sections.runtime;
    assert.deepEqual(runtime.data.activeRuns.map((run) => run.path), [
      '01-Projects/alpha/runs/a-first.json',
      '01-Projects/alpha/runs/z-second.json',
    ]);
    assert.equal(runtime.data.stage, 'first');
    assert.equal(runtime.data.stageCitation, '01-Projects/alpha/runs/a-first.json');
  });

  test('runtime section preserves missing-project diagnostics for arrays/scalars and malformed diagnostics for null JSON', async () => {
    const { ctx, registry, root } = fixture();
    writeFileSync(join(root, '01-Projects', 'alpha', 'runs', 'array.json'), '[]');
    writeFileSync(join(root, '01-Projects', 'alpha', 'runs', 'scalar.json'), JSON.stringify('runtime'));
    writeFileSync(join(root, '01-Projects', 'alpha', 'runs', 'null.json'), 'null');
    const hub = await makeProjectHubOps(registry)[0]!.handler(ctx, { ref: 'project/alpha' }) as RuntimeHub;
    const runtime = hub.sections.runtime;
    assert.equal(runtime.data.runCount, 1);
    assert.ok(runtime.drift.includes('run_project_id_missing:01-Projects/alpha/runs/array.json'));
    assert.ok(runtime.drift.includes('run_project_id_missing:01-Projects/alpha/runs/scalar.json'));
    assert.ok(runtime.drift.includes('malformed_run:01-Projects/alpha/runs/null.json'));
    assert.ok(!runtime.drift.includes('malformed_run:01-Projects/alpha/runs/array.json'));
    assert.ok(!runtime.drift.includes('malformed_run:01-Projects/alpha/runs/scalar.json'));
  });

  test('runtime section preserves legacy Work Run aliases', async () => {
    const { ctx, registry, root } = fixture();
    writeFileSync(join(root, '01-Projects', 'alpha', 'runs', 'current.json'), JSON.stringify({
      project_id: 'project/alpha',
      work_run_id: 'work-run/legacy',
      work_item_id: 'project/alpha/issue/build',
      agent_id: 'codex',
      state: 'awaiting_review',
      agentStage: 'review',
      handoff_expires_at: '2026-08-28T03:00:00.000Z',
      observed_at: '2026-08-28T01:00:00.000Z',
    }));
    mkdirSync(join(root, '01-Projects', 'alpha', 'agents', 'codex'), { recursive: true });
    mkdirSync(join(root, '01-Projects', 'alpha', 'workflow'), { recursive: true });
    writeFileSync(join(root, '01-Projects', 'alpha', 'agents', 'codex', 'events.md'), '## legacy state\n');
    writeFileSync(join(root, '01-Projects', 'alpha', 'workflow', 'status.md'), [
      '---',
      'type: workflow-state',
      'project: alpha',
      'stage: execute',
      'objective: Verify the legacy runtime',
      '---',
      '',
      '# Workflow State: alpha',
    ].join('\n'));
    const hub = await makeProjectHubOps(registry, undefined, { now: () => Date.parse('2026-08-28T02:00:00.000Z') })[0]!.handler(ctx, { ref: 'project/alpha' }) as RuntimeHub;
    const runtime = hub.sections.runtime;
    assert.deepEqual(runtime.data, {
      activeRuns: [{
        projectId: 'project/alpha',
        workRunId: 'work-run/legacy',
        workItemId: 'project/alpha/issue/build',
        state: 'awaiting_review',
        stage: 'review',
        resumable: true,
        path: '01-Projects/alpha/runs/current.json',
        stale: false,
        citationTargets: ['01-Projects/alpha/runs/current.json'],
      }],
      staleRuns: [],
      runCount: 1,
      agentStateFiles: ['01-Projects/alpha/agents/codex/events.md'],
      workflowState: {
        stage: 'execute',
        objective: 'Verify the legacy runtime',
        path: '01-Projects/alpha/workflow/status.md',
      },
      stage: 'execute',
      stageCitation: '01-Projects/alpha/workflow/status.md',
    });
    assert.deepEqual(runtime.citationTargets, [
      '01-Projects/alpha/agents/codex/events.md',
      '01-Projects/alpha/runs/current.json',
      '01-Projects/alpha/workflow/status.md',
    ]);
    assert.equal(typeof runtime.freshness, 'string');
    assert.deepEqual(runtime.drift, []);
  });

  test('runtime section reports malformed and mismatched Work Run drift', async () => {
    const { ctx, registry, root } = fixture();
    writeFileSync(join(root, '01-Projects', 'alpha', 'runs', 'current.json'), '{ malformed');
    writeFileSync(join(root, '01-Projects', 'alpha', 'runs', 'foreign.json'), JSON.stringify({
      project_id: 'project/beta',
      work_run_id: 'work-run/foreign',
      work_item_id: 'project/beta/issue/private',
      agent_id: 'codex',
      state: 'running',
      observed_at: '2026-08-28T01:00:00.000Z',
    }));
    const hub = await makeProjectHubOps(registry)[0]!.handler(ctx, { ref: 'project/alpha' }) as RuntimeHub;
    const runtime = hub.sections.runtime;
    assert.deepEqual(runtime.data, {
      activeRuns: [],
      staleRuns: [],
      runCount: 0,
      agentStateFiles: [],
      workflowState: null,
      stage: null,
      stageCitation: null,
    });
    assert.deepEqual(runtime.citationTargets, [
      '01-Projects/alpha/runs/current.json',
      '01-Projects/alpha/runs/foreign.json',
    ]);
    assert.equal(typeof runtime.freshness, 'string');
    assert.ok(runtime.drift.includes('malformed_run:01-Projects/alpha/runs/current.json'));
    assert.ok(runtime.drift.includes('run_project_mismatch:01-Projects/alpha/runs/foreign.json'));
    assert.equal(runtime.health, 'degraded');
  });
});
