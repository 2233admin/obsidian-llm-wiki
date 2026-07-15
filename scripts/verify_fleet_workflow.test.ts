import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, test } from 'bun:test';
import { assertArtifactOnlyCommitRange } from './verify_fleet_workflow';

const ROOT = resolve(import.meta.dir, '..');
const SCRIPT = resolve(import.meta.dir, 'verify_fleet_workflow.ts');
const FIXTURE_V1 = resolve(ROOT, 'tests/fixtures/fleet-workflow.v1.json');
const FIXTURE_V2 = resolve(ROOT, 'tests/fixtures/fleet-workflow.v2.json');

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
  test('--require-clean is exposed as an explicit final-SHA acceptance gate', () => {
    const result = invoke(['--help']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /--require-clean\s+Reject tracked or untracked worktree changes before acceptance/);
  });

  test('descendant acceptance rejects product changes even with --tested-commit', () => {
    const marker = 'a'.repeat(40);
    const head = 'b'.repeat(40);

    assert.throws(
      () => assertArtifactOnlyCommitRange(
        marker,
        head,
        marker,
        '_acceptance/fleet-vault',
        ['_acceptance/fleet-vault/report.json', 'mcp-server/src/index.ts'],
      ),
      /artifact branch changed product files: mcp-server\/src\/index\.ts/,
    );
  });

  test('descendant acceptance requires an explicit tested product commit', () => {
    assert.throws(
      () => assertArtifactOnlyCommitRange(
        'a'.repeat(40),
        'b'.repeat(40),
        undefined,
        '_acceptance/fleet-vault',
        ['_acceptance/fleet-vault/report.json'],
      ),
      /descendant HEAD requires --tested-commit/,
    );
  });

  test('all uses two vault copies and completes a governed schema v2 Child Work Run handoff', () => {
    const result = invoke(['--phase', 'all', '--json']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      fixture: string;
      vault: string;
      deviceState: string;
      checks: Array<{ name: string; ok: boolean }>;
      correlationId: string;
    };
    assert.equal(report.ok, true);
    assert.ok(report.checks.every((check) => check.ok));
    assert.match(report.correlationId, /^[0-9a-f-]{36}$/i);
    assert.equal(report.fixture, 'tests/fixtures/fleet-workflow.v2.json');
    assert.equal(report.vault, '<temporary-vault>');
    assert.equal(report.deviceState, '<machine-local-state-redacted>');
    assert.ok(report.checks.some((check) => check.name === '5090 completed the exact locally leased Work Run'));
    assert.ok(report.checks.some((check) => check.name === 'schema v2 preserves the governed parent/child Work Run graph and locked assignment'));
    assert.ok(report.checks.some((check) => check.name === 'remote replay reported the existing Child Work Run without changing shared bytes'));
    assert.ok(report.checks.some((check) => check.name === 'child Artifact Projection returns to the non-terminal parent with complete provenance'));
    assert.ok(report.checks.some((check) => check.name === 'local and remote shared durable files have byte-identical manifests'));
  });

  test('legacy schema v1 fixture remains supported', () => {
    const result = invoke(['--phase', 'all', '--fixture', FIXTURE_V1, '--json']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout) as { ok: boolean; fixture: string; checks: Array<{ name: string; ok: boolean }> };
    assert.equal(report.ok, true);
    assert.equal(report.fixture, 'tests/fixtures/fleet-workflow.v1.json');
    assert.ok(report.checks.every((check) => check.ok));
    assert.ok(report.checks.some((check) => check.name === 'makeProjectOps and Python Work Driver created one legacy local lease'));
  });

  test('schema v2 still accepts legacy profile and binding IDs with raw digest locks', () => {
    const root = mkdtempSync(join(tmpdir(), 'llmwiki-fleet-legacy-v2-'));
    const fixturePath = join(root, 'fleet-workflow.legacy-v2.json');
    const fixture = JSON.parse(readFileSync(FIXTURE_V2, 'utf-8')) as Record<string, any>;
    fixture.governedAssignment.agent_profile_id = 'agent-profile/cloud-worker-5090';
    fixture.governedAssignment.project_agent_binding_id = 'project-agent-binding/fleet-cloud-worker';
    fixture.governedAssignment.assignment_plan_fingerprint = 'a'.repeat(64);
    fixture.governedAssignment.context_envelope_fingerprint = 'b'.repeat(64);
    fixture.governedAssignment.device_snapshot.fingerprint = 'e'.repeat(64);
    writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf-8');
    try {
      const result = invoke(['--phase', 'all', '--fixture', fixturePath, '--json']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const report = JSON.parse(result.stdout) as { ok: boolean; checks: Array<{ ok: boolean }> };
      assert.equal(report.ok, true);
      assert.ok(report.checks.every((check) => check.ok));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
      const markerText = readFileSync(join(vault, '.llmwiki-fleet-acceptance.json'), 'utf-8');
      assert.equal(markerText.includes(proof.handoffToken), false);
      const marker = JSON.parse(markerText) as Record<string, any>;
      assert.equal(marker.schemaVersion, 2);
      assert.equal(marker.childWorkRunId, marker.workRunId);
      assert.equal(marker.parentWorkRunId, marker.governedAssignment.parent_work_run_id);
      assert.equal(marker.governedAssignment.agent_profile_id, 'agent/cloud-worker-5090');
      assert.equal(marker.governedAssignment.project_agent_binding_id, 'binding/fleet-acceptance/cloud-worker-5090');
      assert.match(marker.governedAssignment.context_envelope_fingerprint, /^sha256:[a-f0-9]{64}$/);
      assert.equal(marker.governedAssignment.assignment_plan_version, 4);
      assert.equal(marker.governedAssignment.device_snapshot.deviceId, 'device/cloud-5090');
      assert.deepEqual(marker.governedAssignment.child_work_run_ids, []);
      assert.ok(marker.governedAssignment.artifact_projections.length > 0);
      assert.equal(marker.governedAssignment.expected_output.kind, 'implementation-evidence');
      for (const name of ['joinToken', 'checkpointToken', 'leaveToken']) {
        assert.ok(marker[name].startsWith(`fleet:${marker.correlationId}:`), name);
      }
      const durable = JSON.parse(readFileSync(join(
        vault,
        '01-Projects',
        'fleet-acceptance',
        'runs',
        `${marker.workRunId.slice('work-run/'.length)}.json`,
      ), 'utf-8')) as Record<string, unknown>;
      assert.equal(durable.schema_version, 2);
      assert.equal(durable.parent_work_run_id, marker.parentWorkRunId);
      assertSharedTokenFree(vault, proof.handoffToken);
      assert.equal(readFileSync(sentinel, 'utf-8'), 'keep me');
      assert.equal(markerText.includes('correlationId'), true);
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
      const completed = manifest(remoteVault);
      const completedWrong = invoke(
        ['--phase', 'remote', '--vault', remoteVault, '--json'],
        { LLMWIKI_FLEET_HANDOFF_TOKEN: wrongToken },
      );
      assert.notEqual(completedWrong.status, 0);
      assert.equal(completedWrong.stdout.includes(wrongToken), false);
      assert.equal(completedWrong.stderr.includes(wrongToken), false);
      assert.deepEqual(manifest(remoteVault), completed);
      const replayed = invoke([
        '--phase', 'remote', '--vault', remoteVault, '--handoff-token-file', tokenFile, '--json',
      ]);
      assert.equal(replayed.status, 0, replayed.stderr || replayed.stdout);
      assert.deepEqual(manifest(remoteVault), completed, 'complete portable handoff replay changed shared bytes');
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
    const fixture = JSON.parse(readFileSync(FIXTURE_V2, 'utf-8')) as Record<string, any>;
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

  test('locked governed identity drift rejects before remote mutation', () => {
    const root = mkdtempSync(join(tmpdir(), 'llmwiki-fleet-governed-drift-'));
    const localVault = join(root, 'local-vault');
    const remoteVault = join(root, 'remote-vault');
    const localDevice = join(root, 'local-device');
    try {
      const prepared = invoke(['--phase', 'prepare', '--vault', localVault, '--device-state', localDevice, '--json']);
      assert.equal(prepared.status, 0, prepared.stderr || prepared.stdout);
      const proof = JSON.parse(readFileSync(join(localDevice, 'fleet-local-proof.json'), 'utf-8')) as { handoffToken: string };
      const marker = JSON.parse(readFileSync(join(localVault, '.llmwiki-fleet-acceptance.json'), 'utf-8')) as { workRunId: string };
      cpSync(localVault, remoteVault, {
        recursive: true,
        filter: (source) => !relative(localVault, source).replaceAll('\\', '/').split('/').includes('.vault-mind'),
      });
      const childPath = join(remoteVault, '01-Projects', 'fleet-acceptance', 'runs', `${marker.workRunId.slice('work-run/'.length)}.json`);
      const child = JSON.parse(readFileSync(childPath, 'utf-8')) as Record<string, unknown>;
      child.context_envelope_fingerprint = 'e'.repeat(64);
      writeFileSync(childPath, `${JSON.stringify(child, null, 2)}\n`, 'utf-8');
      const before = manifest(remoteVault);
      const result = invoke(
        ['--phase', 'remote', '--vault', remoteVault, '--json'],
        { LLMWIKI_FLEET_HANDOFF_TOKEN: proof.handoffToken },
      );
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Context Envelope fingerprint conflict/i);
      assert.deepEqual(manifest(remoteVault), before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('completed remote run without full child Artifact Projection provenance remains failed', () => {
    const root = mkdtempSync(join(tmpdir(), 'llmwiki-fleet-artifact-provenance-'));
    const localVault = join(root, 'local-vault');
    const remoteVault = join(root, 'remote-vault');
    const localDevice = join(root, 'local-device');
    try {
      const prepared = invoke(['--phase', 'prepare', '--vault', localVault, '--device-state', localDevice, '--json']);
      assert.equal(prepared.status, 0, prepared.stderr || prepared.stdout);
      const proof = JSON.parse(readFileSync(join(localDevice, 'fleet-local-proof.json'), 'utf-8')) as { handoffToken: string };
      const marker = JSON.parse(readFileSync(join(localVault, '.llmwiki-fleet-acceptance.json'), 'utf-8')) as {
        parentWorkRunId: string;
      };
      cpSync(localVault, remoteVault, {
        recursive: true,
        filter: (source) => !relative(localVault, source).replaceAll('\\', '/').split('/').includes('.vault-mind'),
      });
      const completed = invoke(
        ['--phase', 'remote', '--vault', remoteVault, '--json'],
        { LLMWIKI_FLEET_HANDOFF_TOKEN: proof.handoffToken },
      );
      assert.equal(completed.status, 0, completed.stderr || completed.stdout);
      const parentPath = join(remoteVault, '01-Projects', 'fleet-acceptance', 'runs', `${marker.parentWorkRunId.slice('work-run/'.length)}.json`);
      const parent = JSON.parse(readFileSync(parentPath, 'utf-8')) as { artifact_projections: Array<Record<string, unknown>> };
      delete parent.artifact_projections.at(-1)!.source_work_run_id;
      writeFileSync(parentPath, `${JSON.stringify(parent, null, 2)}\n`, 'utf-8');
      const before = manifest(remoteVault);
      const replay = invoke(
        ['--phase', 'remote', '--vault', remoteVault, '--json'],
        { LLMWIKI_FLEET_HANDOFF_TOKEN: proof.handoffToken },
      );
      assert.notEqual(replay.status, 0);
      assert.match(replay.stderr, /Artifact Projection.*provenance|provenance-preserving child Artifact Projection/i);
      assert.deepEqual(manifest(remoteVault), before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('governed fixture rejects machine paths, secrets, and grant tokens before writes', () => {
    const unsafeFields: Array<[string, unknown]> = [
      ['workspace_path', 'C:/private/fleet-worktree'],
      ['client_secret', 'plaintext-secret-value'],
      ['grant_token', 'grant-token:usable-authority'],
    ];
    for (const [field, value] of unsafeFields) {
      const root = mkdtempSync(join(tmpdir(), `llmwiki-fleet-unsafe-${field}-`));
      const vault = join(root, 'vault');
      const fixturePath = join(root, 'unsafe-fixture.json');
      const fixture = JSON.parse(readFileSync(FIXTURE_V2, 'utf-8')) as Record<string, any>;
      fixture.governedAssignment.capability_grant_summary[field] = value;
      writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf-8');
      try {
        const result = invoke(['--phase', 'prepare', '--fixture', fixturePath, '--vault', vault, '--json']);
        assert.notEqual(result.status, 0, field);
        assert.match(result.stderr, /forbidden field|machine-local path|secret.*authority/i, field);
        assert.equal(existsSync(vault), false, field);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });
});
