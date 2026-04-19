import { after, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { FsTransport } from './fs-transport.js';

const tempDirs: string[] = [];

function makeVault(): string {
  const dir = join(tmpdir(), `vault-list-test-${randomUUID()}`);
  mkdirSync(join(dir, '00-Index'), { recursive: true });
  mkdirSync(join(dir, 'notes'), { recursive: true });
  writeFileSync(join(dir, 'Home.md'), '# Home\n', 'utf8');
  writeFileSync(join(dir, '00-Index', 'README.md'), '# Index\n', 'utf8');
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('FsTransport vault.list', () => {
  let transport: FsTransport;

  beforeEach(() => {
    transport = new FsTransport(makeVault());
  });

  test('lists vault root for empty path', () => {
    const result = transport.dispatch('vault.list', { path: '' }) as { files: string[]; folders: string[] };
    assert.deepEqual(result.files, ['Home.md']);
    assert.deepEqual(result.folders, ['00-Index', 'notes']);
  });

  test('lists vault root for dot path', () => {
    const result = transport.dispatch('vault.list', { path: '.' }) as { files: string[]; folders: string[] };
    assert.deepEqual(result.files, ['Home.md']);
    assert.deepEqual(result.folders, ['00-Index', 'notes']);
  });

  test('lists vault root for slash path', () => {
    const result = transport.dispatch('vault.list', { path: '/' }) as { files: string[]; folders: string[] };
    assert.deepEqual(result.files, ['Home.md']);
    assert.deepEqual(result.folders, ['00-Index', 'notes']);
  });

  test('rejects parent traversal while listing', () => {
    assert.throws(
      () => transport.dispatch('vault.list', { path: '../escape' }),
      (err: unknown) => (
        typeof err === 'object' &&
        err !== null &&
        'message' in err &&
        err.message === 'path traversal blocked'
      ),
    );
  });

  test('rejects absolute POSIX paths while listing', () => {
    assert.throws(
      () => transport.dispatch('vault.list', { path: '/etc' }),
      (err: unknown) => (
        typeof err === 'object' &&
        err !== null &&
        'message' in err &&
        err.message === 'path traversal blocked'
      ),
    );
  });

  test('rejects absolute Windows paths while listing', () => {
    assert.throws(
      () => transport.dispatch('vault.list', { path: 'C:\\escape' }),
      (err: unknown) => (
        typeof err === 'object' &&
        err !== null &&
        'message' in err &&
        err.message === 'path traversal blocked'
      ),
    );
  });

  test('keeps nested list paths unchanged', () => {
    const result = transport.dispatch('vault.list', { path: '00-Index' }) as { files: string[]; folders: string[] };
    assert.deepEqual(result.files, ['00-Index/README.md']);
    assert.deepEqual(result.folders, []);
  });
});
