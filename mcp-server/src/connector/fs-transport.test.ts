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
    writeFileSync(join(outside, 'secret.md'), 'outside markdown secret\n', 'utf8');
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

  test('search does not traverse vault junctions', (t) => {
    const transport = makeEscapingVault(t);
    const result = transport.dispatch('vault.search', { query: 'outside markdown secret', maxResults: 10 }) as {
      results: Array<{ path: string; matches: Array<{ line: number; text: string }> }>;
      totalMatches: number;
    };
    assert.equal(result.totalMatches, 0);
    assert.deepEqual(result.results, []);
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

describe('FsTransport currency annotation (Task 3)', () => {
  function makeCurrencyVault(): string {
    const dir = join(tmpdir(), `vault-currency-${randomUUID()}`);
    mkdirSync(join(dir, 'research', 'wiki', 'entities'), { recursive: true });
    writeFileSync(
      join(dir, 'research', 'wiki', 'entities', 'stale-demo.md'),
      '---\nentity: k-atana/stale-demo\n---\n依赖一个已变更源文件的事实。\n', 'utf8',
    );
    writeFileSync(
      join(dir, 'research', 'wiki', 'entities', 'iii.md'),
      '---\nentity: k-atana/iii\n---\niii pivot 未完成。\n', 'utf8',
    );
    // compiled report exactly as Python `kb_meta currency --apply` emits it
    const report = {
      topic: 'research', compiled: '2026-06-25',
      byNote: {
        'research/wiki/entities/stale-demo.md': {
          marker: 'STALE', reasons: ['source changed: research/raw/iii-spec.md'],
          entity: 'k-atana/stale-demo', currentTruth: true,
        },
        'research/wiki/entities/iii.md': {
          marker: 'SUPERSEDED', reasons: ['explicitly by 00-Inbox/AI-Output/test-agent/iii-done.md'],
          entity: 'k-atana/iii', currentTruth: false,
        },
      },
    };
    writeFileSync(join(dir, 'research', 'wiki', '_currency.json'), JSON.stringify(report), 'utf8');
    tempDirs.push(dir);
    return dir;
  }

  test('vault.search inlines STALE marker + reason onto the matching citation', () => {
    const t = new FsTransport(makeCurrencyVault());
    const res = t.dispatch('vault.search', { query: '依赖' }) as
      { results: Array<{ path: string; currency?: { marker: string; reasons: string[] } }> };
    const hit = res.results.find(r => r.path.endsWith('stale-demo.md'));
    assert.ok(hit, 'expected a search hit on stale-demo.md');
    assert.equal(hit!.currency?.marker, 'STALE');
    assert.match(hit!.currency!.reasons.join(' '), /changed/);
  });

  test('vault.search marks superseded notes too', () => {
    const t = new FsTransport(makeCurrencyVault());
    const res = t.dispatch('vault.search', { query: 'pivot' }) as
      { results: Array<{ path: string; currency?: { marker: string } }> };
    const hit = res.results.find(r => r.path.endsWith('iii.md'));
    assert.equal(hit?.currency?.marker, 'SUPERSEDED');
  });

  test('vault.read attaches currency for the read path', () => {
    const t = new FsTransport(makeCurrencyVault());
    const out = t.dispatch('vault.read', { path: 'research/wiki/entities/stale-demo.md' }) as
      { content: string; currency?: { marker: string } };
    assert.equal(out.currency?.marker, 'STALE');
    assert.ok(out.content.includes('已变更'));
  });

  test('missing report -> no currency field, no throw', () => {
    const dir = join(tmpdir(), `vault-nocur-${randomUUID()}`);
    mkdirSync(join(dir, 'research', 'wiki'), { recursive: true });
    writeFileSync(join(dir, 'research', 'wiki', 'note.md'), '# hello world\n', 'utf8');
    tempDirs.push(dir);
    const t = new FsTransport(dir);
    const res = t.dispatch('vault.search', { query: 'hello' }) as
      { results: Array<{ currency?: unknown }> };
    assert.ok(res.results.length >= 1);
    assert.equal(res.results[0].currency, undefined);
  });
});
