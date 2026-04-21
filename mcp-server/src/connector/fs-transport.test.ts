import { after, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

describe('FsTransport symlink traversal guard', () => {
  function makeEscapingVault(t: import('node:test').TestContext): FsTransport {
    const vault = makeVault();
    const outside = join(tmpdir(), `vault-outside-${randomUUID()}`);
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'secret.txt'), 'outside secret\n', 'utf8');
    tempDirs.push(outside);
    try {
      symlinkSync(outside, join(vault, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EPERM') t.skip('symlink/junction creation requires elevated permissions on this platform');
      throw err;
    }
    return new FsTransport(vault);
  }

  test('read through vault junction is blocked', (t) => {
    const transport = makeEscapingVault(t);
    assert.throws(
      () => transport.dispatch('vault.read', { path: 'escape/secret.txt' }),
      (err: unknown) => typeof err === 'object' && err !== null && 'message' in err && err.message === 'path traversal blocked',
    );
  });

  test('list through vault junction is blocked', (t) => {
    const transport = makeEscapingVault(t);
    assert.throws(
      () => transport.dispatch('vault.list', { path: 'escape' }),
      (err: unknown) => typeof err === 'object' && err !== null && 'message' in err && err.message === 'path traversal blocked',
    );
  });
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

describe('FsTransport vault.exists root', () => {
  let transport: FsTransport;
  beforeEach(() => { transport = new FsTransport(makeVault()); });

  test('exists("") returns true for vault root', () => {
    const result = transport.dispatch('vault.exists', { path: '' }) as { exists: boolean };
    assert.equal(result.exists, true);
  });

  test('exists(".") returns true for vault root', () => {
    const result = transport.dispatch('vault.exists', { path: '.' }) as { exists: boolean };
    assert.equal(result.exists, true);
  });

  test('exists still blocks traversal', () => {
    assert.throws(
      () => transport.dispatch('vault.exists', { path: '../escape' }),
      (err: unknown) => typeof err === 'object' && err !== null && 'message' in err && err.message === 'path traversal blocked',
    );
  });
});

describe('FsTransport vault.stat root', () => {
  let transport: FsTransport;
  beforeEach(() => { transport = new FsTransport(makeVault()); });

  test('stat("") returns folder type for vault root', () => {
    const result = transport.dispatch('vault.stat', { path: '' }) as { type: string; name: string; children: number };
    assert.equal(result.type, 'folder');
    assert.ok(result.children >= 2, `expected >=2 children at root, got ${result.children}`);
    assert.ok(result.name.length > 0, 'expected non-empty name (basename of vault path)');
  });

  test('stat(".") returns folder type for vault root', () => {
    const result = transport.dispatch('vault.stat', { path: '.' }) as { type: string };
    assert.equal(result.type, 'folder');
  });

  test('stat still blocks traversal', () => {
    assert.throws(
      () => transport.dispatch('vault.stat', { path: '../escape' }),
      (err: unknown) => typeof err === 'object' && err !== null && 'message' in err && err.message === 'path traversal blocked',
    );
  });

  test('stat on nested file returns file type', () => {
    const result = transport.dispatch('vault.stat', { path: 'Home.md' }) as { type: string; name: string; ext: string };
    assert.equal(result.type, 'file');
    assert.equal(result.name, 'Home.md');
    assert.equal(result.ext, 'md');
  });
});
