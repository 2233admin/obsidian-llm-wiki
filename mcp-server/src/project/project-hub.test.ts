import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AdapterRegistry } from '../adapters/registry.js';
import type { VaultMindAdapter } from '../adapters/interface.js';
import type { OperationContext } from '../core/types.js';
import { AgentDomainService, canonicalDigest } from '../../../packages/agent-domain/dist/src/index.js';
import { createSettingsService } from '../settings/settings.js';
import { makeProjectHubOps } from './project-hub.js';
import { normalizedProjectContext, resolveProjectContext } from './project-context.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): { root: string; ctx: OperationContext; registry: AdapterRegistry } {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-hub-'));
  roots.push(root);
  mkdirSync(join(root, 'Projects'), { recursive: true });
  mkdirSync(join(root, '01-Projects', 'alpha', 'issues'), { recursive: true });
  mkdirSync(join(root, '01-Projects', 'alpha', 'runs'), { recursive: true });
  mkdirSync(join(root, '10-Projects', 'alpha'), { recursive: true });
  mkdirSync(join(root, '.vault-mind'), { recursive: true });
  writeFileSync(join(root, 'Projects', 'alpha.md'), [
    '---', 'type: project', 'entity: project/alpha', 'lifecycle: active',
    'external-projections:', '  github: Radiant303/alpha', '---', '# Alpha', '',
  ].join('\n'));
  writeFileSync(join(root, '01-Projects', 'alpha', '_project.md'), '---\nentity: project/alpha\n---\n');
  writeFileSync(join(root, '01-Projects', 'alpha', 'issues', 'one.md'), '---\nstatus: active\n---\n');
  writeFileSync(join(root, '01-Projects', 'alpha', 'runs', 'run.json'), JSON.stringify({
    project_id: 'project/alpha', work_run_id: 'work-run/one', state: 'running', work_item_id: 'project/alpha/issue/one',
  }));
  writeFileSync(join(root, '10-Projects', 'alpha', 'knowledge.md'), '# Knowledge\n');
  writeFileSync(join(root, '.vault-mind', 'local-bindings.json'), JSON.stringify({
    'project/alpha': { path: join(root, 'missing-workspace') },
  }));
  const registry = new AdapterRegistry();
  const adapter: VaultMindAdapter = {
    name: 'filesystem', capabilities: ['search', 'read'], isAvailable: true,
    async init() {}, async dispose() {},
  };
  registry.register(adapter);
  const ctx = {
    vault: { async execute() { return {}; } },
    adapters: registry,
    config: {
      vault_path: root,
      auth_token: 'must-never-leak',
      adapters: ['filesystem'],
      adapter_weights: { filesystem: 1 },
      collaboration: { role: 'agent', enforce: true, allowed_write_paths: ['01-Projects/**'] },
    },
    logger: { info() {}, warn() {}, error() {} },
    dryRun: true,
  } satisfies OperationContext;
  return { root, ctx, registry };
}

describe('project.hub.get', () => {
  test('composes every owner section and remains readable with unavailable workspace', async () => {
    const { ctx, registry } = fixture();
    const operation = makeProjectHubOps(registry)[0]!;
    const hub = await operation.handler(ctx, { ref: 'project/alpha' }) as Record<string, any>;
    assert.equal(hub.projectId, 'project/alpha');
    assert.equal(hub.readOnly, true);
    assert.deepEqual(Object.keys(hub.sections).sort(), [
      'agents', 'capabilities', 'hostCapabilities', 'identity', 'integrations', 'knowledge', 'runtime', 'settings', 'triage', 'usage', 'visual', 'work', 'workspace',
    ]);
    for (const value of Object.values(hub.sections) as Array<Record<string, unknown>>) {
      assert.ok('owner' in value);
      assert.ok('freshness' in value);
      assert.ok('health' in value);
      assert.ok('drift' in value);
    }
    assert.equal(hub.sections.workspace.health, 'unavailable');
    assert.equal(hub.sections.work.data.issueCount, 1);
    assert.equal(hub.sections.runtime.data.activeRuns[0].workRunId, 'work-run/one');
    assert.equal(hub.sections.hostCapabilities.data.externalConnectionsOpened, 0);
    assert.deepEqual(hub.sections.hostCapabilities.data.descriptors, []);
    assert.equal(hub.sections.usage.data.projection.sourceEventCount, 0);
    assert.equal(hub.sections.usage.data.chartReady, false);
    assert.equal(hub.sections.agents.owner, 'agent-domain');
    assert.equal(hub.sections.agents.health, 'empty');
    assert.deepEqual(hub.sections.agents.data.bindings, []);
  });

  test('returns secret references and snapshot metadata but never secret values', async () => {
    const { root, ctx, registry } = fixture();
    const userDevicePath = join(root, '.device', 'settings.json');
    const settings = createSettingsService({
      vaultPath: root,
      userDevicePath,
      pythonPath: 'C:/private/python.exe',
      environment: { TAVILY_API_KEY: 'must-never-leak-either' },
    });
    const session = await settings.scopesGet('session');
    const secret = await settings.assignmentSet({
      scope: 'session',
      key: 'providers.web_search.secret_ref',
      value: { provider: 'environment', locator: 'TAVILY_API_KEY' },
      expectedRevision: session.document.revision,
      updatedBy: 'test',
    });
    assert.equal(secret.status, 'committed');
    const hub = await makeProjectHubOps(registry, settings)[0]!.handler(ctx, { project: 'alpha' });
    const serialized = JSON.stringify(hub);
    assert.doesNotMatch(serialized, /must-never-leak/);
    assert.doesNotMatch(serialized, /C:\/private\/python\.exe/);
    assert.match(serialized, /TAVILY_API_KEY/);
    assert.match(serialized, /settings-platform/);
    assert.match(serialized, /snapshotHash/);
  });

  test('reports Settings as unavailable when the authoritative store cannot be resolved', async () => {
    const { root, ctx, registry } = fixture();
    const brokenPath = join(root, 'broken-device-settings');
    mkdirSync(brokenPath, { recursive: true });
    const settings = createSettingsService({ vaultPath: root, userDevicePath: brokenPath });
    const hub = await makeProjectHubOps(registry, settings)[0]!.handler(ctx, { project: 'alpha' }) as Record<string, any>;
    assert.equal(hub.sections.settings.health, 'unavailable');
    assert.deepEqual(hub.sections.settings.drift, ['settings_unavailable']);
  });

  test('publishes no writable Project Hub state', () => {
    const { registry } = fixture();
    const operations = makeProjectHubOps(registry);
    assert.deepEqual(operations.map((operation) => operation.name), [
      'project.hub.get',
      'project.hub.text',
      'project.hub.base',
      'project.hub.canvas',
    ]);
    assert.ok(operations.every((operation) => operation.mutating !== true));
  });

  test('merges visual and triage freshness and exposes deterministic read-only derived projections', async () => {
    const { root, ctx, registry } = fixture();
    const now = Date.parse('2026-07-19T12:00:00.000Z');
    const operations = new Map(
      makeProjectHubOps(registry, undefined, {
        now: () => now,
        loadVisualTriage: ({ projectId, generatedAt, vaultPath }) => {
          assert.equal(projectId, 'project/alpha');
          assert.equal(generatedAt, '2026-07-19T12:00:00.000Z');
          assert.equal(vaultPath, root);
          return {
            schemaVersion: 1,
            projectId,
            generatedAt,
            visualDocuments: [{
              documentId: 'mind-map/alpha',
              path: '10-Projects/alpha/maps/alpha.md',
              revision: 2,
              sourceObservedAt: '2026-07-19T10:00:00.000Z',
              sourceHash: `sha256:${'a'.repeat(64)}`,
              currentSourceHash: `sha256:${'a'.repeat(64)}`,
              projectionStatus: 'current',
              linkedWorkItems: [{
                entity: 'project/alpha/issue/one',
                state: 'in-progress',
              }],
            }],
            observations: [{
              observationId: 'problem/plugin-one',
              lifecycle: 'untriaged',
              providerId: 'obsidian-plugin/dataview-diagnostics',
              severity: 'warning',
              occurrenceCount: 2,
              firstObservedAt: '2026-07-18T00:00:00.000Z',
              lastObservedAt: '2026-07-19T09:00:00.000Z',
              linkedIssue: {
                entity: 'project/alpha/issue/one',
                state: 'in-progress',
              },
              contributions: [{
                kind: 'issue',
                provider: 'github',
                remoteRef: 'https://github.com/example/plugin/issues/1',
                state: 'open',
              }],
              workRuns: [{
                workRunId: 'work-run/plugin-one',
                state: 'running',
              }],
              verifications: [{
                verificationId: 'verification/plugin-one',
                status: 'passed',
                observedAt: '2026-07-19T09:30:00.000Z',
                evidenceRefs: ['diagnostic/plugin-one'],
              }],
            }],
            providerHealth: [{
              providerId: 'obsidian-plugin/dataview-diagnostics',
              health: 'unavailable',
              observedAt: '2026-07-19T10:00:00.000Z',
              diagnosticCode: 'runtime-failed',
            }],
          };
        },
      }).map((operation) => [operation.name, operation]),
    );
    const call = async (name: string) => {
      const operation = operations.get(name);
      assert.ok(operation);
      return operation.handler(ctx, { ref: 'project/alpha' }) as Promise<Record<string, any>>;
    };

    const hub = await call('project.hub.get');
    assert.equal(hub.sections.visual.owner, 'visual-workspace');
    assert.equal(hub.sections.visual.data.documents[0].revision, 2);
    assert.equal(hub.sections.triage.owner, 'problem-intake');
    assert.equal(hub.sections.triage.data.freshness, 'stale');
    assert.equal(hub.sections.triage.data.observations[0].newlyVerified, false);
    assert.equal(
      hub.sections.triage.data.observations[0].trace.workRuns[0].workRunId,
      'work-run/plugin-one',
    );
    assert.match(hub.mutationRoutes.triage, /problem\.intake\.lifecycle\.apply/);

    const text = await call('project.hub.text');
    assert.equal(text.readOnly, true);
    assert.equal(text.format, 'markdown');
    assert.match(text.projection, /problem\/plugin-one/);

    const base = await call('project.hub.base');
    assert.equal(base.readOnly, true);
    assert.equal(base.projection.rows[0].linkedIssue, 'project/alpha/issue/one');

    const canvas = await call('project.hub.canvas');
    assert.equal(canvas.readOnly, true);
    assert.ok(canvas.projection.nodes.some(
      (node: Record<string, unknown>) => node.llmwikiOwner === 'work-driver',
    ));
    assert.ok(canvas.projection.nodes.some(
      (node: Record<string, unknown>) => node.llmwikiOwner === 'governed-tracker-or-forge',
    ));
  });

  test('projects canonical Agent, Binding, Thread, and Dream Time identities without copying memory content', async () => {
    const { root, ctx, registry } = fixture();
    const service = new AgentDomainService({ stateRoot: join(root, '_llmwiki', 'agent-domain', 'v1') });
    await service.createProfile({
      profileId: 'agent/reviewer',
      displayName: 'Reviewer',
      role: 'reviewer',
      responsibilities: ['review'],
      capabilityClaims: ['code-review'],
      constitution: { principles: ['evidence first'], instructions: ['cite artifacts'] },
      actor: 'test',
    });
    const project = resolveProjectContext(root, 'project/alpha', 'test.agent-hub');
    const binding = await service.createBinding({
      projectId: 'project/alpha',
      projectContextFingerprint: canonicalDigest(normalizedProjectContext(project)),
      profileId: 'agent/reviewer',
      profileRevision: 1,
      role: 'reviewer',
      connectorGrantRefs: [],
      actor: 'test',
    });
    assert.equal(binding.status, 'committed');
    await service.createThread({
      threadId: 'thread/review',
      projectId: 'project/alpha',
      bindingId: 'binding/alpha/reviewer',
      bindingRevision: 1,
      profileId: 'agent/reviewer',
      profileRevision: 1,
      title: 'Review',
      actor: 'test',
    });

    const hub = await makeProjectHubOps(registry)[0]!.handler(ctx, { ref: 'project/alpha' }) as Record<string, any>;
    assert.equal(hub.sections.agents.health, 'healthy');
    assert.equal(hub.sections.agents.data.profiles[0].profileId, 'agent/reviewer');
    assert.equal(hub.sections.agents.data.bindings[0].bindingId, 'binding/alpha/reviewer');
    assert.equal(hub.sections.agents.data.threads[0].threadId, 'thread/review');
    assert.equal(hub.sections.agents.data.dreamTime[0].approvedMemory, null);
    assert.doesNotMatch(JSON.stringify(hub.sections.agents), /evidence first|cite artifacts/);
  });
});
