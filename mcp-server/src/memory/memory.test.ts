/**
 * Unit tests for Phase 8 MCP memory.* tools.
 *
 * Uses mkdtempSync to create an isolated vault dir per test run; no real
 * vault, no git, no MCP stdio. Exercises makeMemoryOps() handlers directly.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { makeMemoryOps } from './memory.js';
import type { OperationContext } from '../core/types.js';

let vaultDir: string;
let memFile: string;
let ops: ReturnType<typeof makeMemoryOps>;
const CTX = {} as OperationContext;

before(() => {
  vaultDir = mkdtempSync(join(tmpdir(), 'vault-mind-mem-'));
  memFile  = join(vaultDir, '_ai_memory.json');
  ops      = makeMemoryOps(vaultDir);
});

after(() => {
  if (existsSync(vaultDir)) rmSync(vaultDir, { recursive: true, force: true });
});

function findOp(name: string) {
  const op = ops.find(o => o.name === name);
  if (!op) throw new Error(`op not found: ${name}`);
  return op;
}

describe('memory.set / get', () => {
  test('set then get round-trips a string value with tags', async () => {
    const set = findOp('memory.set');
    const get = findOp('memory.get');
    const entry = await set.handler(CTX, {
      key: 'greeting', value: 'hello world', tags: ['smoke'],
    }) as { key: string; value: string; tags: string[] };
    assert.equal(entry.key, 'greeting');
    assert.equal(entry.value, 'hello world');
    assert.deepEqual(entry.tags, ['smoke']);

    const res = await get.handler(CTX, { key: 'greeting' }) as {
      count: number; memories: Array<{ value: string }>;
    };
    assert.equal(res.count, 1);
    assert.equal(res.memories[0].value, 'hello world');
  });

  test('set preserves created_at on update, bumps updated_at', async () => {
    const set = findOp('memory.set');
    const e1 = await set.handler(CTX, { key: 'k1', value: 'v1' }) as { created_at: string; updated_at: string };
    // Wait a tick so timestamps would differ if not preserved
    await new Promise(r => setTimeout(r, 5));
    const e2 = await set.handler(CTX, { key: 'k1', value: 'v2' }) as { created_at: string; updated_at: string };
    assert.equal(e1.created_at, e2.created_at, 'created_at must be preserved across updates');
    assert.notEqual(e1.updated_at, e2.updated_at, 'updated_at must change on update');
  });
});

describe('memory.list', () => {
  test('returns all entries with key, tags, preview, updated_at', async () => {
    const set  = findOp('memory.set');
    const list = findOp('memory.list');
    await set.handler(CTX, { key: 'list-k1', value: 'first memory', tags: ['t1'] });
    await set.handler(CTX, { key: 'list-k2', value: 'second memory', tags: ['t2'] });

    const res = await list.handler(CTX, {}) as {
      count: number;
      memories: Array<{ key: string; tags: string[]; preview: string; updated_at: string }>;
    };
    assert.ok(res.count >= 2);
    const keys = res.memories.map(m => m.key);
    assert.ok(keys.includes('list-k1'));
    assert.ok(keys.includes('list-k2'));
    for (const m of res.memories) {
      assert.equal(typeof m.preview, 'string');
      assert.ok(m.preview.length <= 120);
      assert.equal(typeof m.updated_at, 'string');
    }
  });

  // Regression: previous handler did `e.value.slice(0, 120)` unconditionally
  // and crashed if a non-string value was stored. Schema says string, but
  // the file may have been hand-edited or written by an older client.

  test('does not crash when stored value is a number (defensive coercion)', async () => {
    // Bypass the schema-validated `memory.set` and write a non-string directly
    // to the underlying file, simulating a hand-edit or older writer.
    const handEdited = { 'numeric-key': { key: 'numeric-key', value: 42, tags: [], created_at: 'x', updated_at: 'x' } };
    writeFileSync(memFile, JSON.stringify(handEdited), 'utf-8');

    const list = findOp('memory.list');
    // Must not throw
    const res = await list.handler(CTX, {}) as {
      count: number;
      memories: Array<{ key: string; preview: string }>;
    };
    assert.equal(res.count, 1);
    assert.equal(res.memories[0].key, 'numeric-key');
    assert.equal(res.memories[0].preview, '42', 'number value must be coerced to its string form');
  });

  test('does not crash when stored value is a boolean', async () => {
    const handEdited = { 'bool-key': { key: 'bool-key', value: true, tags: [], created_at: 'x', updated_at: 'x' } };
    writeFileSync(memFile, JSON.stringify(handEdited), 'utf-8');

    const list = findOp('memory.list');
    const res = await list.handler(CTX, {}) as {
      memories: Array<{ preview: string }>;
    };
    assert.equal(res.memories[0].preview, 'true');
  });

  test('does not crash when stored value is null', async () => {
    const handEdited = { 'null-key': { key: 'null-key', value: null, tags: [], created_at: 'x', updated_at: 'x' } };
    writeFileSync(memFile, JSON.stringify(handEdited), 'utf-8');

    const list = findOp('memory.list');
    const res = await list.handler(CTX, {}) as { memories: Array<{ preview: string }> };
    assert.equal(res.memories[0].preview, 'null');
  });

  test('does not crash when stored value is an object', async () => {
    const handEdited = { 'obj-key': { key: 'obj-key', value: { foo: 'bar' }, tags: [], created_at: 'x', updated_at: 'x' } };
    writeFileSync(memFile, JSON.stringify(handEdited), 'utf-8');

    const list = findOp('memory.list');
    const res = await list.handler(CTX, {}) as { memories: Array<{ preview: string }> };
    assert.equal(res.memories[0].preview, '[object Object]');
  });

  test('truncates long string previews to 120 chars', async () => {
    const set  = findOp('memory.set');
    const list = findOp('memory.list');
    const longText = 'x'.repeat(500);
    await set.handler(CTX, { key: 'long-key', value: longText });

    const res = await list.handler(CTX, {}) as {
      memories: Array<{ key: string; preview: string }>;
    };
    const entry = res.memories.find(m => m.key === 'long-key');
    assert.ok(entry);
    assert.equal(entry!.preview.length, 120);
  });
});

describe('memory.forget', () => {
  test('deletes existing key and returns ok=true', async () => {
    const set    = findOp('memory.set');
    const forget = findOp('memory.forget');
    const get    = findOp('memory.get');

    await set.handler(CTX, { key: 'to-delete', value: 'bye' });
    const before = await get.handler(CTX, { key: 'to-delete' }) as { count: number };
    assert.equal(before.count, 1);

    const res = await forget.handler(CTX, { key: 'to-delete' }) as { ok: boolean; message: string };
    assert.equal(res.ok, true);
    assert.equal(res.message, 'Deleted');

    const after = await get.handler(CTX, { key: 'to-delete' }) as { count: number };
    assert.equal(after.count, 0);
  });

  test('returns ok=false for unknown key without throwing', async () => {
    const forget = findOp('memory.forget');
    const res = await forget.handler(CTX, { key: 'never-existed' }) as { ok: boolean; message: string };
    assert.equal(res.ok, false);
    assert.match(res.message, /not found/i);
  });
});

describe('memory persistence (file round-trip)', () => {
  test('writes _ai_memory.json into the vault root, not elsewhere', async () => {
    const set = findOp('memory.set');
    await set.handler(CTX, { key: 'persist-test', value: 'hello' });
    assert.ok(existsSync(memFile), 'memory file must exist in vault root');
    const raw = JSON.parse(readFileSync(memFile, 'utf-8'));
    assert.ok(raw['persist-test']);
    assert.equal(raw['persist-test'].value, 'hello');
  });
});
