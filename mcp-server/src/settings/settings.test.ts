import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import { createSettingsService, makeSettingsOps, resolveAgentModelProcessEnvironment } from './settings.js';
import { validateParams } from '../core/validate.js';

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('thin settings operation adapter', () => {
  test('registers the host-neutral settings surface', () => {
    const vaultPath = mkdtempSync(join(tmpdir(), 'llmwiki-settings-mcp-'));
    roots.push(vaultPath);
    const operations = makeSettingsOps({
      vaultPath,
      userDevicePath: join(vaultPath, 'device.json'),
      userDeviceId: 'mcp-test-device',
      pythonPath: 'python',
      compilerPath: join(vaultPath, 'compiler', 'kb_meta.py'),
      clock: () => '2026-07-14T00:00:00.000Z',
    });

    assert.deepEqual(
      operations.map(operation => operation.name),
      [
        'settings.definitions.list',
        'settings.definitions.get',
        'settings.scopes.get',
        'settings.snapshot.resolve',
        'settings.snapshot.explain',
        'settings.assignment.set',
        'settings.assignment.unset',
        'settings.validate',
        'settings.migrations.plan',
        'settings.doctor',
      ],
    );
    const set = operations.find(operation => operation.name === 'settings.assignment.set')!;
    assert.equal(validateParams(set.params, {
      scope: 'session',
      key: 'query.semantic.enabled',
      value: false,
      expectedRevision: 0,
    }).value, false);
    const scopes = operations.find(operation => operation.name === 'settings.scopes.get')!;
    assert.equal(validateParams(scopes.params, { scope: 'product' }).scope, 'product');
  });

  test('resolves and diagnoses settings with no Obsidian process', async () => {
    const vaultPath = mkdtempSync(join(tmpdir(), 'llmwiki-settings-mcp-'));
    roots.push(vaultPath);
    const operations = makeSettingsOps({
      vaultPath,
      userDevicePath: join(vaultPath, 'device.json'),
      userDeviceId: 'mcp-test-device',
      pythonPath: 'python',
      compilerPath: join(vaultPath, 'compiler', 'kb_meta.py'),
      clock: () => '2026-07-14T00:00:00.000Z',
    });
    const context = {
      vault: { execute: async () => null },
      adapters: null,
      config: { vault_path: vaultPath },
      logger: { info() {}, warn() {}, error() {} },
      dryRun: false,
    };
    const resolve = operations.find(operation => operation.name === 'settings.snapshot.resolve')!;
    const doctor = operations.find(operation => operation.name === 'settings.doctor')!;
    const scopes = operations.find(operation => operation.name === 'settings.scopes.get')!;
    const set = operations.find(operation => operation.name === 'settings.assignment.set')!;

    const snapshot = await resolve.handler(context, {});
    const health = await doctor.handler(context, {});
    const product = await scopes.handler(context, { scope: 'product' });

    assert.equal((snapshot as { snapshot?: { context: { userDeviceId: string } } }).snapshot?.context.userDeviceId, 'mcp-test-device');
    assert.ok(Array.isArray((health as { capabilities: unknown[] }).capabilities));
    assert.equal((product as { scope: string }).scope, 'product');
    const runtime = (snapshot as { snapshot: { context: { sessionId: string } } }).snapshot.context;
    assert.deepEqual(set.mutating && set.writePolicy.targets(context, { scope: 'session' }), [
      `_llmwiki/settings/session/${runtime.sessionId}`,
    ]);
  });

  test('resolves every workspace-project operation through Project Context', async () => {
    const vaultPath = mkdtempSync(join(tmpdir(), 'llmwiki-settings-project-'));
    roots.push(vaultPath);
    mkdirSync(join(vaultPath, 'Projects'), { recursive: true });
    writeFileSync(
      join(vaultPath, 'Projects', 'alpha.md'),
      ['---', 'entity: project/alpha', 'type: project', 'status: active', '---', '', '# Alpha', ''].join('\n'),
      'utf8',
    );
    const operations = makeSettingsOps({
      vaultPath,
      userDevicePath: join(vaultPath, 'device.json'),
      userDeviceId: 'mcp-test-device',
      pythonPath: 'python',
      compilerPath: join(vaultPath, 'compiler', 'kb_meta.py'),
      clock: () => '2026-07-14T00:00:00.000Z',
    });
    const byName = new Map(operations.map(operation => [operation.name, operation]));
    const context = {
      vault: { execute: async () => null },
      adapters: null,
      config: { vault_path: vaultPath },
      logger: { info() {}, warn() {}, error() {} },
      dryRun: false,
    };
    const set = byName.get('settings.assignment.set')!;
    assert.deepEqual(set.mutating && set.writePolicy.targets(context, {
      scope: 'workspace-project',
      targetId: 'project/alpha',
    }), ['_llmwiki/settings/projects/alpha.json']);
    const committed = await set.handler(context, {
      scope: 'workspace-project',
      targetId: 'project/alpha',
      key: 'query.semantic.enabled',
      value: true,
      expectedRevision: 0,
    }) as { status: string; document: { targetId: string } };
    assert.equal(committed.status, 'committed');
    assert.equal(committed.document.targetId, 'project/alpha');
    assert.equal(existsSync(join(vaultPath, '_llmwiki', 'settings', 'projects', 'alpha.json')), true);
    assert.equal(existsSync(join(vaultPath, '_llmwiki', 'settings', 'projects', 'project-alpha.json')), false);

    const unknown = 'project/not-registered';
    const calls: Array<[string, Record<string, unknown>]> = [
      ['settings.scopes.get', { scope: 'workspace-project', targetId: unknown }],
      ['settings.snapshot.resolve', { context: { workspaceProjectId: unknown } }],
      ['settings.snapshot.explain', { key: 'query.semantic.enabled', context: { workspaceProjectId: unknown } }],
      ['settings.assignment.set', {
        scope: 'workspace-project', targetId: unknown, key: 'query.semantic.enabled', value: true, expectedRevision: 0,
      }],
      ['settings.assignment.unset', {
        scope: 'workspace-project', targetId: unknown, key: 'query.semantic.enabled', expectedRevision: 0,
      }],
      ['settings.validate', { context: { workspaceProjectId: unknown } }],
      ['settings.migrations.plan', { context: { workspaceProjectId: unknown } }],
      ['settings.doctor', { context: { workspaceProjectId: unknown } }],
    ];
    for (const [name, params] of calls) {
      await assert.rejects(() => byName.get(name)!.handler(context, params), { code: -32004 }, name);
    }
    assert.throws(() => set.mutating && set.writePolicy.targets(context, {
      scope: 'workspace-project',
      targetId: unknown,
    }), { code: -32004 });
    assert.equal(existsSync(join(vaultPath, '_llmwiki', 'settings', 'projects', 'not-registered.json')), false);
  });

  test('resolves Agent credentials only in the host child-process bridge', async () => {
    const vaultPath = mkdtempSync(join(tmpdir(), 'llmwiki-agent-model-host-'));
    roots.push(vaultPath);
    const environment = { CLOUD_AGENT_KEY: 'host-only-secret', OPENAI_API_KEY: 'legacy-secret' };
    const service = createSettingsService({
      vaultPath,
      userDevicePath: join(vaultPath, 'device.json'),
      userDeviceId: 'mcp-test-device',
      environment,
    });
    for (const [key, value] of [
      ['models.agent.mode', 'cloud'],
      ['models.agent.provider', 'openai-compatible'],
      ['models.agent.base_url', 'https://models.example.test/v1'],
      ['models.agent.model', 'cloud-model'],
      ['models.agent.secret_ref', { provider: 'environment', locator: 'CLOUD_AGENT_KEY' }],
    ] as const) {
      const scope = await service.scopesGet('session');
      const result = await service.assignmentSet({
        scope: 'session',
        key,
        value,
        expectedRevision: scope.document.revision,
        updatedBy: 'mcp-test',
      });
      assert.equal(result.status, 'committed');
    }

    const child = await resolveAgentModelProcessEnvironment(service, environment);
    const snapshot = await service.snapshotResolve();
    assert.equal(child.OPENAI_API_KEY, 'host-only-secret');
    assert.equal(child.CLOUD_AGENT_KEY, undefined);
    assert.equal(child.OPENAI_BASE_URL, 'https://models.example.test/v1');
    assert.equal(child.COMPILE_MODEL, 'cloud-model');
    assert.equal(JSON.stringify(snapshot).includes('host-only-secret'), false);

    const session = await service.scopesGet('session');
    const local = await service.assignmentSet({
      scope: 'session',
      key: 'models.agent.mode',
      value: 'local',
      expectedRevision: session.document.revision,
      updatedBy: 'mcp-test',
    });
    assert.equal(local.status, 'committed');
    const localChild = await resolveAgentModelProcessEnvironment(service, environment);
    assert.equal(localChild.OPENAI_API_KEY, undefined);
    assert.equal(localChild.ANTHROPIC_API_KEY, undefined);
    assert.equal(localChild.CLOUD_AGENT_KEY, undefined);
  });
});
