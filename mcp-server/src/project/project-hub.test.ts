import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AdapterRegistry } from '../adapters/registry.js';
import type { VaultMindAdapter } from '../adapters/interface.js';
import type { OperationContext } from '../core/types.js';
import { createSettingsService } from '../settings/settings.js';
import { makeProjectHubOps } from './project-hub.js';

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
      'capabilities', 'identity', 'integrations', 'knowledge', 'runtime', 'settings', 'work', 'workspace',
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
    assert.deepEqual(operations.map((operation) => operation.name), ['project.hub.get']);
    assert.notEqual(operations[0]!.mutating, true);
  });
});
