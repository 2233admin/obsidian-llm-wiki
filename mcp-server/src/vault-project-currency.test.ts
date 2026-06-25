// Task 7C: vault.project / vault.decide stamp currency fields so the notes they
// write participate in the project status-drift guard + project-status view
// (compiler/kb_meta.py currency). Importing index.js is side-effect-free: the
// stdio server start is guarded to entry-point invocation only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { VaultFs } from './index.js';

function freshVault(): { v: VaultFs; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'vfs-7c-'));
  // a real vault has these (vault.init); the write handlers mkdir inside the
  // file lock, so the target dir must already exist for the lock to acquire.
  mkdirSync(join(dir, 'Projects'), { recursive: true });
  mkdirSync(join(dir, 'Decisions'), { recursive: true });
  return { v: new VaultFs(dir), dir };
}

function onlyDecision(dir: string): string {
  const decDir = join(dir, 'Decisions');
  const f = readdirSync(decDir).find((n) => n.endsWith('.md'));
  assert.ok(f, 'a decision note was written');
  return readFileSync(join(decDir, f!), 'utf8');
}

test('vault.project stamps currency entity + last-verified', () => {
  const { v, dir } = freshVault();
  try {
    v.dispatch('vault.project', { name: 'III Pivot', status: 'active', dryRun: false });
    const text = readFileSync(join(dir, 'Projects', 'III Pivot.md'), 'utf8');
    assert.match(text, /\ntype: project\n/, 'type preserved');
    assert.match(text, /\nstatus: active\n/, 'status preserved');
    assert.match(text, /\nentity: project\/iii-pivot\n/, 'entity stamped (name slug)');
    assert.match(text, /\nlast-verified: \d{4}-\d{2}-\d{2}\n/, 'last-verified stamped (today)');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('vault.decide namespaces the entity under its project + stamps source', () => {
  const { v, dir } = freshVault();
  try {
    v.dispatch('vault.decide', {
      title: 'Use Postgres', context: 'c', decision: 'pg',
      project: 'III Pivot', source: 'commit:abc1234', dryRun: false,
    });
    const text = onlyDecision(dir);
    assert.match(text, /\nentity: project\/iii-pivot\/decision\/use-postgres\n/, 'entity namespaced under project');
    assert.match(text, /\ntype: decision\n/);
    assert.match(text, /\nlast-verified: \d{4}-\d{2}-\d{2}\n/);
    assert.match(text, /\nsource: commit:abc1234\n/, 'source stamped when given');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('vault.decide without a project falls back to decision/<slug> and no source line', () => {
  const { v, dir } = freshVault();
  try {
    v.dispatch('vault.decide', { title: 'Lone Call', context: 'c', decision: 'd', dryRun: false });
    const text = onlyDecision(dir);
    assert.match(text, /\nentity: decision\/lone-call\n/, 'fallback entity');
    assert.doesNotMatch(text, /\nsource:/, 'no source line when none given');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('dry-run still writes nothing (default safety preserved)', () => {
  const { v, dir } = freshVault();
  try {
    const r = v.dispatch('vault.project', { name: 'Ghost' }) as { dryRun?: boolean };
    assert.equal(r.dryRun, true);
    assert.throws(() => readFileSync(join(dir, 'Projects', 'Ghost.md'), 'utf8'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
