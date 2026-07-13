import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, test } from 'bun:test';

const ROOT = resolve(import.meta.dir, '..');
const SCRIPT = resolve(import.meta.dir, 'verify_fleet_workflow.ts');
const FIXTURE = resolve(ROOT, 'tests/fixtures/fleet-workflow.v1.json');

function invoke(args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    windowsHide: true,
  });
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
      assert.equal(readFileSync(sentinel, 'utf-8'), 'keep me');
      assert.equal(readFileSync(join(vault, '.llmwiki-fleet-acceptance.json'), 'utf-8').includes('correlationId'), true);
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
