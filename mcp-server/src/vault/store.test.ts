import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import type { OperationContext } from '../core/types.js';
import { makeProjectOps } from '../project/project.js';
import { makeSourceOps } from '../source/source.js';
import { FileVaultStore } from './store.js';

const roots: string[] = [];

function makeStore(options: { lockTtlMs?: number } = {}): FileVaultStore {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-vault-store-'));
  roots.push(root);
  return new FileVaultStore(root, options);
}

function context(root: string): OperationContext {
  return {
    vault: { execute: async () => ({}) },
    adapters: null,
    config: {
      vault_path: root,
      collaboration: { actor: 'store-test' },
    },
    logger: { info() {}, warn() {}, error() {} },
    dryRun: false,
  };
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('FileVaultStore', () => {
  it('keeps vault-relative paths safe and writes stable UTF-8 bytes', () => {
    const store = makeStore();
    store.writeText('01-Projects/demo/issues/first.md', '标题\n\nbody\n');

    assert.equal(store.readText('01-Projects/demo/issues/first.md'), '标题\n\nbody\n');
    assert.equal(store.isFile('01-Projects/demo/issues/first.md'), true);
    assert.throws(() => store.resolvePath('../outside.md'), /path traversal blocked/);
    assert.throws(() => store.resolvePath('.obsidian/app.json'), /protected path/);
  });

  it('serializes writes and rejects a live lock', () => {
    const store = makeStore();
    store.withLock('notes/locked.md', () => {
      assert.throws(
        () => store.withLock('notes/locked.md', () => undefined),
        /Lock conflict on locked.md/,
      );
    });
    assert.equal(store.exists('notes/locked.md'), false);
  });

  it('takes over a stale lock and cleans it up', () => {
    const store = makeStore({ lockTtlMs: 10 });
    store.ensureDirectory('notes');
    const target = store.resolvePath('notes/stale.md');
    const lock = `${target}.lock`;
    writeFileSync(lock, '{}');
    const stale = new Date(Date.now() - 1000);
    utimesSync(lock, stale, stale);

    store.writeText('notes/stale.md', 'recovered');

    assert.equal(store.readText('notes/stale.md'), 'recovered');
    assert.equal(store.exists('notes/stale.md.lock'), false);
  });

  it('is the persistence seam used by project and source operations', async () => {
    const store = makeStore();
    const ctx = context(store.rootPath);
    const init = makeProjectOps(store.rootPath, { store }).find((operation) => operation.name === 'project.init');
    await init!.handler(ctx, { project: 'demo' });
    assert.equal(store.exists('01-Projects/demo/_project.md'), true);

    store.writeText('reference.md', 'reference');
    const register = makeSourceOps(store.rootPath, { store }).find((operation) => operation.name === 'source.register');
    const result = await register!.handler(ctx, { input: 'reference.md', inputType: 'vaultPath' }) as { path: string };
    assert.equal(store.exists(result.path), true);
    assert.match(store.readTextRequired('_llmwiki/source-registry.json'), /reference\.md/);
  });
});
