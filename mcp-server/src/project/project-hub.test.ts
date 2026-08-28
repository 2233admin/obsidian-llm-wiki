import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AdapterRegistry } from '../adapters/registry.js';
import type { VaultMindAdapter } from '../adapters/interface.js';
import type { OperationContext } from '../core/types.js';
import { makeProjectHubOps } from './project-hub.js';
import { createProjectSearchSource } from '../project-hub/search-source.js';
import { fingerprintRecoveryValue } from '../project-hub/contract-support.js';
import type { RecoveryOpenOwners } from '../project-hub/recovery-open.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

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
    workflow: { readRun: () => run, listRuns: () => [run], listCheckpoints: () => [], checkpointSetFingerprint: () => fingerprintRecoveryValue([]) },
    loadWorkItems: () => [{ entity: 'project/alpha/issue/build', label: 'Build recovery', state: 'in-progress', blockedBy: [], citationTargets: ['issue:build'] }],
    loadProjectMemory: async () => ({ revision: 1, fingerprint: fingerprintRecoveryValue('memory'), freshness: 'current', reviewedDecisions: [] }),
    listSessions: async () => [],
    loadCapabilities: async () => [{ capability: 'workflow.recovery.plan', state: 'available', citationTargets: ['capability:plan'] }],
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
});
