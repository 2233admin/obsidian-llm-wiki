/**
 * withFileLock advisory locking tests (via VaultFs dispatch surface).
 *
 * Covers the three lock states: fresh conflict, stale takeover (>60s),
 * and post-operation cleanup. Uses node:test + tmpdir isolation.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { VaultFs } from './index.js';

const tempDirs: string[] = [];

function makeTempVault(): { vault: string; vaultFs: VaultFs } {
  const dir = join(tmpdir(), `file-lock-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return { vault: dir, vaultFs: new VaultFs(dir) };
}

after(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe('withFileLock via vault.modify', () => {
  test('fresh lock blocks write with -32010', () => {
    const { vault, vaultFs } = makeTempVault();
    writeFileSync(join(vault, 'note.md'), 'original', 'utf-8');
    writeFileSync(join(vault, 'note.md.lock'), JSON.stringify({ pid: 99999, timestamp: Date.now() }), 'utf-8');

    assert.throws(
      () => vaultFs.dispatch('vault.modify', { path: 'note.md', content: 'changed', dryRun: false }),
      (e: unknown) => (e as { code: number }).code === -32010,
    );
    assert.equal(readFileSync(join(vault, 'note.md'), 'utf-8'), 'original');
  });

  test('stale lock (>60s) is taken over and write succeeds', () => {
    const { vault, vaultFs } = makeTempVault();
    writeFileSync(join(vault, 'note.md'), 'original', 'utf-8');
    const lockPath = join(vault, 'note.md.lock');
    writeFileSync(lockPath, JSON.stringify({ pid: 99999, timestamp: Date.now() - 120_000 }), 'utf-8');
    const staleEpoch = (Date.now() - 120_000) / 1000;
    utimesSync(lockPath, staleEpoch, staleEpoch);

    const result = vaultFs.dispatch('vault.modify', { path: 'note.md', content: 'changed', dryRun: false }) as { ok: boolean };
    assert.equal(result.ok, true);
    assert.equal(readFileSync(join(vault, 'note.md'), 'utf-8'), 'changed');
    assert.equal(existsSync(lockPath), false);
  });

  test('lock is cleaned up after a normal write', () => {
    const { vault, vaultFs } = makeTempVault();
    writeFileSync(join(vault, 'note.md'), 'original', 'utf-8');

    vaultFs.dispatch('vault.modify', { path: 'note.md', content: 'changed', dryRun: false });
    assert.equal(existsSync(join(vault, 'note.md.lock')), false);
  });

  test('dryRun path never touches the lock', () => {
    const { vault, vaultFs } = makeTempVault();
    writeFileSync(join(vault, 'note.md'), 'original', 'utf-8');
    writeFileSync(join(vault, 'note.md.lock'), JSON.stringify({ pid: 99999, timestamp: Date.now() }), 'utf-8');

    const result = vaultFs.dispatch('vault.modify', { path: 'note.md', content: 'changed' }) as { dryRun: boolean };
    assert.equal(result.dryRun, true);
    assert.equal(readFileSync(join(vault, 'note.md'), 'utf-8'), 'original');
  });
});

describe('vault.rename locks both endpoints', () => {
  test('fresh lock on destination blocks rename', () => {
    const { vault, vaultFs } = makeTempVault();
    writeFileSync(join(vault, 'a.md'), 'content', 'utf-8');
    writeFileSync(join(vault, 'b.md.lock'), JSON.stringify({ pid: 99999, timestamp: Date.now() }), 'utf-8');

    assert.throws(
      () => vaultFs.dispatch('vault.rename', { from: 'a.md', to: 'b.md', dryRun: false }),
      (e: unknown) => (e as { code: number }).code === -32010,
    );
    assert.equal(existsSync(join(vault, 'a.md')), true);
    assert.equal(existsSync(join(vault, 'b.md')), false);
    // source lock must not leak after destination conflict
    assert.equal(existsSync(join(vault, 'a.md.lock')), false);
  });
});
