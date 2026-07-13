import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import { makeSettingsOps } from './settings.js';
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
});
