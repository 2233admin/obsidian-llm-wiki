import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFileWorkRunStore, withFileRollback } from './work-run-store.js';

test('file Work Run store preserves durable JSON, claim paths, and local leases', () => {
  const vault = mkdtempSync(join(tmpdir(), 'llmwiki-work-run-store-'));
  try {
    const store = createFileWorkRunStore(vault);
    const run = { schema_version: 1, project_id: 'project/alpha', work_run_id: 'work-run/one', state: 'running' };
    store.writeRunAtomic('alpha', 'work-run/one', run);
    assert.deepEqual(store.readRun('alpha', 'work-run/one'), run);
    const fingerprint = `sha256:${'a'.repeat(64)}` as `sha256:${string}`;
    store.writeRecoveryClaimAtomic('alpha', fingerprint, { state: 'claimed' });
    store.writeRecoveryTokenAtomic('alpha', fingerprint, { plan: fingerprint });
    assert.deepEqual(store.readRecoveryClaim('alpha', fingerprint), { state: 'claimed' });
    assert.deepEqual(store.readRecoveryToken('alpha', fingerprint), { plan: fingerprint });
    store.writeLocalLeaseAtomic('worker', { work_run_id: 'work-run/one', agent_id: 'worker' });
    assert.deepEqual(store.readLocalLease('work-run/one'), { work_run_id: 'work-run/one', agent_id: 'worker' });
    assert.match(readFileSync(join(vault, '01-Projects/alpha/runs/one.json'), 'utf8'), /"state": "running"/u);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('Work Run lock fails closed and rollback restores bytes', () => {
  const vault = mkdtempSync(join(tmpdir(), 'llmwiki-work-run-lock-'));
  try {
    const store = createFileWorkRunStore(vault);
    assert.equal(store.withLock(() => 7), 7);
    const lockPath = join(vault, '.vault-mind/_work-run.lock');
    mkdirSync(join(vault, '.vault-mind'), { recursive: true });
    writeFileSync(lockPath, 'still-owned', 'utf8');
    assert.throws(() => store.withLock(() => 1), /Work Run is busy/u);
    assert.equal(readFileSync(lockPath, 'utf8'), 'still-owned');
    const target = join(vault, 'state.md');
    writeFileSync(target, 'before', 'utf8');
    assert.throws(() => withFileRollback(vault, ['state.md'], () => { writeFileSync(target, 'after', 'utf8'); throw new Error('stop'); }), /stop/u);
    assert.equal(readFileSync(target, 'utf8'), 'before');
    assert.equal(existsSync(lockPath), true);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('output claim token scan is bounded and leaves validation to governance', () => {
  const vault = mkdtempSync(join(tmpdir(), 'llmwiki-work-run-scan-'));
  try {
    const store = createFileWorkRunStore(vault);
    const token = `sha256:${'b'.repeat(64)}` as `sha256:${string}`;
    const output = `sha256:${'c'.repeat(64)}` as `sha256:${string}`;
    store.writeOutputClaimAtomic('alpha', output, { tokenDigest: token, outputFingerprint: output });
    assert.deepEqual(store.listOutputClaims('alpha'), [{ tokenDigest: token, outputFingerprint: output }]);
    writeFileSync(join(vault, '01-Projects/alpha/runs/output-claims/unsafe.txt'), '{}', 'utf8');
    assert.throws(() => store.listOutputClaims('alpha'), /unsafe entry/u);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('output claim scan enforces file and aggregate limits', () => {
  const vault = mkdtempSync(join(tmpdir(), 'llmwiki-work-run-scan-limits-'));
  try {
    const store = createFileWorkRunStore(vault);
    const directory = join(vault, '01-Projects/alpha/runs/output-claims');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `${'a'.repeat(64)}.json`), JSON.stringify({ payload: 'x'.repeat(128 * 1024) }), 'utf8');
    assert.throws(() => store.listOutputClaims('alpha'), /file limit/u);
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(directory, { recursive: true });
    for (let index = 0; index < 257; index += 1) {
      const hex = index.toString(16).padStart(64, '0');
      writeFileSync(join(directory, `${hex}.json`), '{}', 'utf8');
    }
    assert.throws(() => store.listOutputClaims('alpha'), /entry limit/u);
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(directory, { recursive: true });
    for (let index = 0; index < 35; index += 1) {
      const hex = (index + 300).toString(16).padStart(64, '0');
      writeFileSync(join(directory, `${hex}.json`), JSON.stringify({ payload: 'x'.repeat(120 * 1024) }), 'utf8');
    }
    assert.throws(() => store.listOutputClaims('alpha'), /byte limit/u);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});
