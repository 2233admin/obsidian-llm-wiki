import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, test } from 'bun:test';

const ROOT = resolve(import.meta.dir, '..');
const SCRIPT = resolve(import.meta.dir, 'verify_fleet_workflow.ts');
const FIXTURE = resolve(ROOT, 'tests/fixtures/fleet-workflow.v1.json');

function invoke(args: string[], extraEnv: Record<string, string> = {}) {
  const env = { ...process.env };
  delete env.LLMWIKI_FLEET_HANDOFF_TOKEN;
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    env: { ...env, ...extraEnv },
    windowsHide: true,
  });
}

function entries(root: string, directory = root): Array<{ path: string; directory: boolean }> {
  if (!existsSync(directory)) return [];
  const result: Array<{ path: string; directory: boolean }> = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    const item = { path: relative(root, path).replaceAll('\\', '/'), directory: entry.isDirectory() };
    result.push(item);
    if (entry.isDirectory()) result.push(...entries(root, path));
  }
  return result;
}

function manifest(root: string): Record<string, string> {
  return Object.fromEntries(entries(root).map((entry) => [
    entry.path,
    entry.directory ? '<directory>' : createHash('sha256').update(readFileSync(join(root, entry.path))).digest('hex'),
  ]));
}

function assertSharedTokenFree(vault: string, token: string): void {
  for (const entry of entries(vault)) {
    if (entry.directory || entry.path === '.vault-mind' || entry.path.startsWith('.vault-mind/')) continue;
    assert.equal(readFileSync(join(vault, entry.path)).includes(Buffer.from(token)), false, entry.path);
  }
}

describe('fleet workflow acceptance harness safety', () => {
  test('all uses two vault copies and completes the real Work Driver handoff', () => {
    const result = invoke(['--phase', 'all', '--json']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout) as { ok: boolean; checks: Array<{ ok: boolean }>; correlationId: string };
    assert.equal(report.ok, true);
    assert.ok(report.checks.every((check) => check.ok));
    assert.match(report.correlationId, /^[0-9a-f-]{36}$/i);
  });

  test('never deletes user-supplied vault or device-state paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'llmwiki-fleet-user-paths-'));
    const vault = join(root, 'vault');
    const deviceState = join(root, 'device');
    mkdirSync(vault, { recursive: true });
    mkdirSync(deviceState, { recursive: true });
    const sentinel = join(deviceState, 'owned-by-user.txt');
    writeFileSync(sentinel, 'keep me', 'utf-8');
    try {
      const result = invoke(['--phase', 'all', '--vault', vault, '--device-state', deviceState, '--json']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const proof = JSON.parse(readFileSync(join(deviceState, 'fleet-local-proof.json'), 'utf-8')) as { handoffToken: string };
      assert.ok(proof.handoffToken.length >= 16);
      assert.equal(result.stdout.includes(proof.handoffToken), false);
      assert.equal(result.stderr.includes(proof.handoffToken), false);
      assert.equal(readFileSync(join(vault, '.llmwiki-fleet-acceptance.json'), 'utf-8').includes(proof.handoffToken), false);
      assertSharedTokenFree(vault, proof.handoffToken);
      assert.equal(readFileSync(sentinel, 'utf-8'), 'keep me');
      assert.equal(readFileSync(join(vault, '.llmwiki-fleet-acceptance.json'), 'utf-8').includes('correlationId'), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('missing and wrong capabilities reject without mutation; secure file injection succeeds without leakage', () => {
    const root = mkdtempSync(join(tmpdir(), 'llmwiki-fleet-capability-'));
    const localVault = join(root, 'local-vault');
    const remoteVault = join(root, 'remote-vault');
    const localDevice = join(root, 'local-device');
    const tokenFile = join(root, '5090-device', 'handoff-token.txt');
    mkdirSync(localVault, { recursive: true });
    mkdirSync(localDevice, { recursive: true });
    try {
      const prepared = invoke([
        '--phase', 'prepare', '--vault', localVault, '--device-state', localDevice, '--json',
      ]);
      assert.equal(prepared.status, 0, prepared.stderr || prepared.stdout);
      const proof = JSON.parse(readFileSync(join(localDevice, 'fleet-local-proof.json'), 'utf-8')) as { handoffToken: string };
      const token = proof.handoffToken;
      assert.equal(prepared.stdout.includes(token), false);
      assert.equal(prepared.stderr.includes(token), false);
      cpSync(localVault, remoteVault, {
        recursive: true,
        filter: (source) => !relative(localVault, source).replaceAll('\\', '/').split('/').includes('.vault-mind'),
      });
      const before = manifest(remoteVault);

      const missing = invoke(['--phase', 'remote', '--vault', remoteVault, '--json']);
      assert.notEqual(missing.status, 0);
      assert.match(missing.stderr, /portable handoff token required/i);
      assert.deepEqual(manifest(remoteVault), before);

      const wrongToken = 'wrong-fleet-capability-token-000000000000';
      const wrong = invoke(
        ['--phase', 'remote', '--vault', remoteVault, '--json'],
        { LLMWIKI_FLEET_HANDOFF_TOKEN: wrongToken },
      );
      assert.notEqual(wrong.status, 0);
      assert.equal(wrong.stdout.includes(wrongToken), false);
      assert.equal(wrong.stderr.includes(wrongToken), false);
      assert.deepEqual(manifest(remoteVault), before);

      mkdirSync(dirname(tokenFile), { recursive: true });
      writeFileSync(tokenFile, `${token}\n`, { encoding: 'utf-8', mode: 0o600 });
      const accepted = invoke([
        '--phase', 'remote', '--vault', remoteVault, '--handoff-token-file', tokenFile, '--json',
      ]);
      assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
      assert.equal(accepted.stdout.includes(token), false);
      assert.equal(accepted.stderr.includes(token), false);
      assertSharedTokenFree(remoteVault, token);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('refuses a collision without overwriting user data', () => {
    const root = mkdtempSync(join(tmpdir(), 'llmwiki-fleet-collision-'));
    const vault = join(root, 'vault');
    const collision = join(vault, 'Projects', 'fleet-acceptance.md');
    mkdirSync(dirname(collision), { recursive: true });
    writeFileSync(collision, 'user owned', 'utf-8');
    try {
      const result = invoke(['--phase', 'prepare', '--vault', vault, '--json']);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /refusing to overwrite existing acceptance data/i);
      assert.equal(readFileSync(collision, 'utf-8'), 'user owned');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects traversal identities before creating a vault', () => {
    const root = mkdtempSync(join(tmpdir(), 'llmwiki-fleet-traversal-'));
    const vault = join(root, 'vault');
    const badFixture = join(root, 'bad-fixture.json');
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf-8')) as Record<string, any>;
    fixture.project.slug = '../escape';
    writeFileSync(badFixture, `${JSON.stringify(fixture, null, 2)}\n`, 'utf-8');
    try {
      const result = invoke(['--phase', 'prepare', '--fixture', badFixture, '--vault', vault, '--json']);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /invalid project slug/i);
      assert.equal(readFileSync(badFixture, 'utf-8').includes('../escape'), true);
      assert.equal(existsSync(vault), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
