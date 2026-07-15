#!/usr/bin/env bun

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdapterRegistry } from '../mcp-server/src/adapters/registry.ts';
import type { Operation, OperationContext } from '../mcp-server/src/core/types.ts';
import { makeProjectHubOps } from '../mcp-server/src/project/project-hub.ts';
import { makeProjectOps } from '../mcp-server/src/project/project.ts';
import { makeWorkflowOps } from '../mcp-server/src/workflow/workflow.ts';

type Phase = 'prepare' | 'remote' | 'verify' | 'all';

interface ExternalRef {
  kind: 'orca-task' | 'orca-terminal';
  target: string;
}

interface FleetRun {
  label: string;
  leaseDevice: 'local';
  executionDevice: '5090';
  agentId: string;
  workItemId: string;
}

interface FleetFixture {
  schemaVersion: 1;
  project: { slug: string; projectId: string; lifecycle: string };
  externalRefs: ExternalRef[];
  run: FleetRun;
  deviceLocal: { leaseStore: '.vault-mind/_leases.json' };
  conflictProbe: {
    agentId: string;
    projectId: string;
    workRunId: string;
    workItemId: string;
    transitionToken: string;
  };
}

interface CliOptions {
  phase: Phase;
  fixturePath: string;
  vaultPath?: string;
  remoteVaultPath?: string;
  deviceStatePath?: string;
  handoffTokenFile?: string;
  testedCommit?: string;
  keep: boolean;
  json: boolean;
}

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

interface AcceptanceReport {
  ok: boolean;
  phase: Phase;
  fixture: string;
  vault: string;
  deviceState: string;
  commit: string;
  fixtureDigest: string;
  correlationId: string;
  externalRefs: ExternalRef[];
  checks: Check[];
}

interface WorkDriverLease {
  agent_id: string;
  project_id: string;
  work_item_id: string;
  work_run_id: string;
  base_head: string;
  acquired_at: number;
  expires_at: number;
}

interface RawWorkDriverLease extends WorkDriverLease {
  handoff_token: string;
}

interface AcceptanceMarker {
  schemaVersion: 1;
  correlationId: string;
  commit: string;
  fixtureDigest: string;
  projectId: string;
  workItemId: string;
  workRunId: string;
  agentId: string;
  joinToken: string;
  checkpointToken: string;
  leaveToken: string;
  externalRefs: ExternalRef[];
}

interface LocalProof {
  schemaVersion: 1;
  correlationId: string;
  leaseBytesSha256: string;
  lease: WorkDriverLease;
  handoffToken: string;
}

type ByteManifest = Record<string, string>;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_FIXTURE = resolve(SCRIPT_DIR, '../tests/fixtures/fleet-workflow.v1.json');
const KB_META = resolve(SCRIPT_DIR, '../compiler/kb_meta.py');
const COMPILER_DIR = dirname(KB_META);
const LOCAL_PROOF_FILE = 'fleet-local-proof.json';
const MARKER_FILE = '.llmwiki-fleet-acceptance.json';
const HANDOFF_TOKEN_ENV = 'LLMWIKI_FLEET_HANDOFF_TOKEN';

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { phase: 'all', fixturePath: DEFAULT_FIXTURE, keep: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]!;
    if (value === '--phase') options.phase = argv[++index] as Phase;
    else if (value === '--fixture') options.fixturePath = resolve(argv[++index]!);
    else if (value === '--vault') options.vaultPath = resolve(argv[++index]!);
    else if (value === '--remote-vault') options.remoteVaultPath = resolve(argv[++index]!);
    else if (value === '--device-state') options.deviceStatePath = resolve(argv[++index]!);
    else if (value === '--handoff-token-file') options.handoffTokenFile = resolve(argv[++index]!);
    else if (value === '--tested-commit') options.testedCommit = argv[++index]!;
    else if (value === '--keep') options.keep = true;
    else if (value === '--json') options.json = true;
    else if (value === '--help' || value === '-h') {
      process.stdout.write([
        'Usage: bun scripts/verify_fleet_workflow.ts [options]',
        '',
        '  --phase prepare|remote|verify|all',
        '  --vault PATH          Local/shared acceptance vault (temporary by default)',
        '  --remote-vault PATH   5090 copy used by --phase all (temporary by default)',
        '  --device-state PATH   Machine-local proof directory (outside the shared vault)',
        '  --handoff-token-file PATH  Gitignored/out-of-repo token file for remote phase',
        '  --tested-commit SHA   Explicit product commit when HEAD also carries vault artifacts',
        '  --fixture PATH        Fleet fixture JSON',
        '  --keep                Keep automatically-created temporary directories',
        '  --json                Emit a JSON report',
        '',
      ].join('\n'));
      process.exit(0);
    } else throw new Error(`Unknown argument: ${value}`);
  }
  if (!['prepare', 'remote', 'verify', 'all'].includes(options.phase)) throw new Error(`Invalid phase: ${options.phase}`);
  if (options.phase !== 'all' && options.remoteVaultPath) throw new Error('--remote-vault is valid only with --phase all');
  if (options.phase !== 'remote' && options.handoffTokenFile) {
    throw new Error('--handoff-token-file is valid only with --phase remote');
  }
  if (options.phase === 'verify' && !options.deviceStatePath) {
    throw new Error('--phase verify requires the machine-local --device-state from prepare');
  }
  return options;
}

function readFixture(path: string): FleetFixture {
  const fixture = JSON.parse(readFileSync(path, 'utf-8')) as FleetFixture;
  assert.equal(fixture.schemaVersion, 1, 'unsupported fixture schemaVersion');
  assert.match(fixture.project.slug, /^[a-z0-9][a-z0-9-]*$/, 'invalid project slug');
  assert.equal(fixture.project.projectId, `project/${fixture.project.slug}`, 'Project identity mismatch');
  assert.match(fixture.project.lifecycle, /^[a-z][a-z-]*$/, 'invalid Project lifecycle');
  assert.equal(fixture.run.leaseDevice, 'local', 'the Work Driver lease must originate locally');
  assert.equal(fixture.run.executionDevice, '5090', 'the leased Work Run must execute on 5090');
  assert.match(fixture.run.agentId, /^[a-z0-9][a-z0-9-]*$/, 'invalid agent identity');
  assert.equal(
    fixture.run.workItemId,
    `${fixture.project.projectId}/issue/${fixture.run.workItemId.split('/').at(-1)}`,
    'Work Item must belong to the fixture Project',
  );
  assert.match(fixture.run.workItemId, /^project\/[a-z0-9][a-z0-9-]*\/issue\/[a-z0-9][a-z0-9-]*$/, 'invalid Work Item');
  assert.equal(fixture.deviceLocal.leaseStore, '.vault-mind/_leases.json', 'unsupported lease store path');
  assert.match(fixture.conflictProbe.agentId, /^[a-z0-9][a-z0-9-]*$/, 'invalid conflict agent');
  assert.match(fixture.conflictProbe.projectId, /^project\/[a-z0-9][a-z0-9-]*$/, 'invalid conflict Project');
  assert.match(fixture.conflictProbe.workRunId, /^work-run\/[a-z0-9][a-z0-9-]*$/, 'invalid conflict Work Run');
  assert.match(fixture.conflictProbe.workItemId, /^project\/[a-z0-9][a-z0-9-]*\/issue\/[a-z0-9][a-z0-9-]*$/, 'invalid conflict Work Item');
  assert.match(fixture.conflictProbe.transitionToken, /^[a-z0-9][a-z0-9:._-]*$/, 'invalid conflict token');
  assert.notEqual(fixture.conflictProbe.agentId, fixture.run.agentId, 'conflict agent must differ');
  assert.notEqual(fixture.conflictProbe.projectId, fixture.project.projectId, 'conflict Project must differ');
  assert.notEqual(fixture.conflictProbe.workItemId, fixture.run.workItemId, 'conflict Work Item must differ');
  assert.equal(fixture.externalRefs.length, 2, 'fixture must contain the real Orca task and terminal refs');
  for (const externalRef of fixture.externalRefs) {
    assert.match(externalRef.kind, /^orca-(task|terminal)$/);
    assert.match(externalRef.target, externalRef.kind === 'orca-task' ? /^task_[a-z0-9-]+$/ : /^term_[a-z0-9-]+$/);
  }
  assert.equal(new Set(fixture.externalRefs.map((ref) => ref.kind)).size, 2, 'Orca refs must include task and terminal');
  return fixture;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function currentCommit(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf-8' }).trim();
}

function resolvedCommit(value: string): string {
  return execFileSync('git', ['rev-parse', '--verify', `${value}^{commit}`], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  }).trim();
}

function assertCommitCompatibility(markerCommit: string, vault: string, testedCommit?: string): void {
  assert.match(markerCommit, /^[0-9a-f]{40}$/i, 'invalid marker commit');
  const head = currentCommit();
  if (testedCommit) assert.equal(resolvedCommit(testedCommit), markerCommit, '--tested-commit does not match the marker');
  const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', markerCommit, head], {
    cwd: REPO_ROOT,
    windowsHide: true,
  });
  assert.equal(ancestor.status, 0, 'marker commit is not an ancestor of the current HEAD');
  if (head === markerCommit || testedCommit) return;

  const relativeVault = relative(REPO_ROOT, resolve(vault)).replaceAll('\\', '/');
  const vaultIsArtifact = relativeVault !== '' && relativeVault !== '..' && !relativeVault.startsWith('../');
  assert.equal(vaultIsArtifact, true, 'descendant HEAD requires --tested-commit when the acceptance vault is outside the repo');
  const changed = execFileSync('git', ['diff', '--name-only', `${markerCommit}..${head}`], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  }).split(/\r?\n/).filter(Boolean).map((path) => path.replaceAll('\\', '/'));
  const unrelated = changed.filter((path) => path !== relativeVault && !path.startsWith(`${relativeVault}/`));
  assert.deepEqual(unrelated, [], `artifact branch changed product files: ${unrelated.join(', ')}`);
}

function safePath(root: string, relativePath: string): string {
  assert.equal(isAbsolute(relativePath), false, `vault-relative path required: ${relativePath}`);
  const normalizedRoot = resolve(root);
  const target = resolve(normalizedRoot, relativePath);
  assert.ok(target === normalizedRoot || target.startsWith(`${normalizedRoot}${sep}`), `path escapes root: ${relativePath}`);
  return target;
}

function isInside(parent: string, child: string): boolean {
  const parentRoot = resolve(parent);
  const childRoot = resolve(child);
  return childRoot === parentRoot || childRoot.startsWith(`${parentRoot}${sep}`);
}

function assertLocalSecretPath(path: string, label: string): void {
  if (!isInside(REPO_ROOT, path)) return;
  const repoPath = relative(REPO_ROOT, resolve(path)).replaceAll('\\', '/');
  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', repoPath], {
    cwd: REPO_ROOT,
    windowsHide: true,
  });
  assert.notEqual(tracked.status, 0, `${label} must not be tracked by Git`);
  const ignored = spawnSync('git', ['check-ignore', '--quiet', '--', repoPath], {
    cwd: REPO_ROOT,
    windowsHide: true,
  });
  assert.equal(ignored.status, 0, `${label} must be outside the repo or covered by .gitignore`);
}

function assertIndependentRoots(localVault: string, remoteVault: string, deviceState: string, phase: Phase): void {
  if (existsSync(localVault)) assert.equal(lstatSync(localVault).isSymbolicLink(), false, 'local vault root cannot be a symlink');
  if (existsSync(deviceState)) assert.equal(lstatSync(deviceState).isSymbolicLink(), false, 'device-state root cannot be a symlink');
  assert.equal(
    isInside(localVault, deviceState) || isInside(deviceState, localVault),
    false,
    '--device-state and --vault must be independent roots',
  );
  if (phase === 'all') {
    if (existsSync(remoteVault)) assert.equal(lstatSync(remoteVault).isSymbolicLink(), false, 'remote vault root cannot be a symlink');
    assert.equal(
      isInside(localVault, remoteVault) || isInside(remoteVault, localVault),
      false,
      '--remote-vault and --vault must be independent roots',
    );
    assert.equal(
      isInside(remoteVault, deviceState) || isInside(deviceState, remoteVault),
      false,
      '--remote-vault and --device-state must be independent roots',
    );
  }
}

function assertNoSymlinkSegments(root: string, relativePath: string): void {
  const parts = relativePath.replaceAll('\\', '/').split('/').filter(Boolean);
  let cursor = resolve(root);
  for (const part of parts.slice(0, -1)) {
    cursor = join(cursor, part);
    if (!existsSync(cursor)) break;
    assert.equal(lstatSync(cursor).isSymbolicLink(), false, `refusing symlinked acceptance path: ${cursor}`);
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function writeSecretJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
}

function acceptanceMarker(root: string): string {
  return safePath(root, MARKER_FILE);
}

function localProof(deviceState: string): string {
  return safePath(deviceState, LOCAL_PROOF_FILE);
}

function readLocalProof(deviceState: string): LocalProof {
  const path = localProof(deviceState);
  assert.ok(existsSync(path), `machine-local fleet proof not found: ${path}`);
  const proof = JSON.parse(readFileSync(path, 'utf-8')) as LocalProof;
  assert.equal(proof.schemaVersion, 1, 'unsupported local proof');
  assert.match(proof.correlationId, /^[0-9a-f-]{36}$/i, 'invalid local proof correlation');
  assert.ok(typeof proof.handoffToken === 'string' && proof.handoffToken.length >= 16 && proof.handoffToken.length <= 4096,
    'local proof contains no valid handoff token');
  return proof;
}

function tokenFromFile(path: string): string {
  assertLocalSecretPath(path, '--handoff-token-file');
  const content = readFileSync(path, 'utf-8').trim();
  if (content.startsWith('{')) {
    const value = JSON.parse(content) as { handoffToken?: unknown };
    return typeof value.handoffToken === 'string' ? value.handoffToken : '';
  }
  return content;
}

function resolveRemoteHandoffToken(options: CliOptions, deviceState: string): string {
  const candidates: string[] = [];
  if (options.handoffTokenFile) candidates.push(tokenFromFile(options.handoffTokenFile));
  const environmentToken = process.env[HANDOFF_TOKEN_ENV];
  if (environmentToken) candidates.push(environmentToken);
  if (options.deviceStatePath && existsSync(localProof(deviceState))) {
    candidates.push(readLocalProof(deviceState).handoffToken);
  }
  assert.ok(candidates.length > 0,
    `portable handoff token required via --handoff-token-file, ${HANDOFF_TOKEN_ENV}, or remote --device-state`);
  assert.ok(candidates.every((token) => token.length >= 16 && token.length <= 4096), 'invalid portable handoff token');
  assert.ok(candidates.every((token) => token === candidates[0]), 'conflicting portable handoff token sources');
  return candidates[0]!;
}

function sanitizedError(error: unknown, secret: string): Error {
  const raw = error instanceof Error ? error.message : String(error);
  return new Error(secret ? raw.replaceAll(secret, '<redacted-handoff-token>') : raw);
}

function leasePath(vault: string, fixture: FleetFixture): string {
  return safePath(vault, fixture.deviceLocal.leaseStore);
}

function issueSlug(fixture: FleetFixture): string {
  return fixture.run.workItemId.split('/').at(-1)!;
}

function runPath(root: string, projectSlug: string, workRunId: string): string {
  assert.match(workRunId, /^work-run\/[a-z0-9][a-z0-9-]*$/, 'invalid Work Run identity');
  return safePath(root, `01-Projects/${projectSlug}/runs/${workRunId.slice('work-run/'.length)}.json`);
}

function readMarker(
  vault: string,
  fixture: FleetFixture,
  digest: string,
  testedCommit?: string,
): AcceptanceMarker {
  const path = acceptanceMarker(vault);
  assert.ok(existsSync(path), `acceptance marker not found: ${path}`);
  const marker = JSON.parse(readFileSync(path, 'utf-8')) as AcceptanceMarker;
  assert.deepEqual(Object.keys(marker).sort(), [
    'agentId', 'checkpointToken', 'commit', 'correlationId', 'externalRefs', 'fixtureDigest',
    'joinToken', 'leaveToken', 'projectId', 'schemaVersion', 'workItemId', 'workRunId',
  ].sort(), 'marker contains an unknown or machine-local field');
  assert.equal(marker.schemaVersion, 1, 'unsupported acceptance marker');
  assert.match(marker.correlationId, /^[0-9a-f-]{36}$/i, 'invalid fleet correlation');
  assertCommitCompatibility(marker.commit, vault, testedCommit);
  assert.equal(marker.fixtureDigest, digest, 'fixture changed between fleet phases');
  assert.equal(marker.projectId, fixture.project.projectId, 'marker Project mismatch');
  assert.equal(marker.workItemId, fixture.run.workItemId, 'marker Work Item mismatch');
  assert.equal(marker.agentId, fixture.run.agentId, 'marker agent mismatch');
  assert.match(marker.workRunId, /^work-run\/[a-z0-9][a-z0-9-]*$/, 'invalid marker Work Run');
  assert.notEqual(marker.workRunId, fixture.conflictProbe.workRunId, 'conflict Work Run must differ');
  assert.deepEqual(marker.externalRefs, fixture.externalRefs, 'external refs changed between phases');
  for (const token of [marker.joinToken, marker.checkpointToken, marker.leaveToken]) {
    assert.ok(token.startsWith(`fleet:${marker.correlationId}:`), 'transition token is not correlated');
  }
  return marker;
}

function operationHarness(vault: string): { call(name: string, params?: Record<string, unknown>): Promise<unknown> } {
  const registry = new AdapterRegistry();
  const operations = [...makeProjectOps(vault), ...makeWorkflowOps(vault), ...makeProjectHubOps(registry)];
  const byName = new Map(operations.map((operation) => [operation.name, operation]));
  const context: OperationContext = {
    vault: { async execute() { return {}; } },
    adapters: registry,
    config: {
      vault_path: vault,
      collaboration: { actor: 'fleet-acceptance', role: 'agent' },
    },
    logger: { info() {}, warn() {}, error() {} },
    dryRun: false,
  };
  return {
    async call(name, params = {}) {
      const operation = byName.get(name) as Operation | undefined;
      assert.ok(operation, `missing operation: ${name}`);
      return operation.handler(context, params);
    },
  };
}

function addExternalRefs(vault: string, fixture: FleetFixture): void {
  const path = safePath(vault, `Projects/${fixture.project.slug}.md`);
  const content = readFileSync(path, 'utf-8');
  assert.equal(content.includes('external-projections:'), false, 'Project already owns external projections');
  const projections = fixture.externalRefs.map((ref) => JSON.stringify(`${ref.kind}:${ref.target}`)).join(', ');
  const updated = content.replace(/^last-verified:/m, `external-projections: [${projections}]\nlast-verified:`);
  assert.notEqual(updated, content, 'canonical Project registry has no last-verified field');
  writeFileSync(path, updated, 'utf-8');
}

function runPythonWorkNext(vault: string, fixture: FleetFixture): Record<string, any> {
  const args = [KB_META, 'work', 'next', vault, '--claim', fixture.run.agentId, '--ttl', '86400', '--project', fixture.project.slug];
  const candidates: Array<{ command: string; prefix: string[] }> = process.env.PYTHON
    ? [{ command: process.env.PYTHON, prefix: [] }]
    : process.platform === 'win32'
      ? [{ command: 'py', prefix: ['-3'] }, { command: 'python', prefix: [] }]
      : [{ command: 'python3', prefix: [] }, { command: 'python', prefix: [] }];
  let lastError = '';
  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...candidate.prefix, ...args], {
      cwd: COMPILER_DIR,
      encoding: 'utf-8',
      windowsHide: true,
    });
    if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') continue;
    if (result.status !== 0) {
      lastError = `${candidate.command} exited ${String(result.status)} while acquiring the fleet lease`;
      break;
    }
    return JSON.parse(result.stdout) as Record<string, any>;
  }
  throw new Error(lastError || 'Python 3 was not found');
}

function protectedPaths(vault: string, deviceState: string, fixture: FleetFixture): string[] {
  return [
    acceptanceMarker(vault),
    localProof(deviceState),
    safePath(vault, `Projects/${fixture.project.slug}.md`),
    safePath(vault, `01-Projects/${fixture.project.slug}/_project.md`),
    safePath(vault, `01-Projects/${fixture.project.slug}/issues/${issueSlug(fixture)}.md`),
    leasePath(vault, fixture),
  ];
}

async function prepareFixture(
  vault: string,
  deviceState: string,
  fixture: FleetFixture,
  digest: string,
  testedCommit?: string,
): Promise<AcceptanceMarker> {
  mkdirSync(vault, { recursive: true });
  mkdirSync(deviceState, { recursive: true });
  for (const relativePath of [
    MARKER_FILE,
    `Projects/${fixture.project.slug}.md`,
    `01-Projects/${fixture.project.slug}/_project.md`,
    `01-Projects/${fixture.project.slug}/issues/${issueSlug(fixture)}.md`,
    fixture.deviceLocal.leaseStore,
  ]) assertNoSymlinkSegments(vault, relativePath);
  assertNoSymlinkSegments(deviceState, LOCAL_PROOF_FILE);
  const collision = protectedPaths(vault, deviceState, fixture).find((path) => existsSync(path));
  assert.equal(collision, undefined, `refusing to overwrite existing acceptance data: ${collision}`);

  const { call } = operationHarness(vault);
  await call('project.init', {
    project: fixture.project.slug,
    description: 'Disposable LLM Wiki fleet workflow acceptance Project',
  });
  addExternalRefs(vault, fixture);
  const issue = await call('project.issue.create', {
    project: fixture.project.projectId,
    title: 'Cloud workflow fleet acceptance',
    slug: issueSlug(fixture),
    summary: 'One locally leased Work Run executed through a portable 5090 handoff',
    state: 'todo',
    review: 'reviewed',
    priority: '1',
    assignee: fixture.run.agentId,
  }) as { entity: string; path: string };
  assert.equal(issue.entity, fixture.run.workItemId, 'project.issue.create returned another Work Item');

  const driver = runPythonWorkNext(vault, fixture);
  assert.equal(driver.status, 'selected', 'Work Driver did not select the acceptance Work Item');
  assert.equal(driver.selected?.entity, fixture.run.workItemId, 'Work Driver selected another Work Item');
  assert.equal(driver.lease?.outcome, 'ACQUIRED', 'Work Driver did not acquire the lease');
  const lease = driver.lease as RawWorkDriverLease & { outcome: string };
  assert.equal(lease.project_id, fixture.project.projectId);
  assert.equal(lease.work_item_id, fixture.run.workItemId);
  assert.equal(lease.agent_id, fixture.run.agentId);
  assert.match(lease.work_run_id, /^work-run\/[a-z0-9][a-z0-9-]*$/);
  assert.ok(typeof lease.handoff_token === 'string' && lease.handoff_token.length >= 16 && lease.handoff_token.length <= 4096,
    'Work Driver did not issue a valid portable handoff token');
  assert.ok(existsSync(runPath(vault, fixture.project.slug, lease.work_run_id)), 'Work Driver did not persist the Work Run');

  const leaseBytes = readFileSync(leasePath(vault, fixture));
  const correlationId = randomUUID();
  const marker: AcceptanceMarker = {
    schemaVersion: 1,
    correlationId,
    commit: testedCommit ? resolvedCommit(testedCommit) : currentCommit(),
    fixtureDigest: digest,
    projectId: fixture.project.projectId,
    workItemId: fixture.run.workItemId,
    workRunId: lease.work_run_id,
    agentId: fixture.run.agentId,
    joinToken: `fleet:${correlationId}:join`,
    checkpointToken: `fleet:${correlationId}:checkpoint`,
    leaveToken: `fleet:${correlationId}:leave`,
    externalRefs: fixture.externalRefs,
  };
  const proof: LocalProof = {
    schemaVersion: 1,
    correlationId,
    leaseBytesSha256: sha256(leaseBytes),
    lease: {
      agent_id: lease.agent_id,
      project_id: lease.project_id,
      work_item_id: lease.work_item_id,
      work_run_id: lease.work_run_id,
      base_head: lease.base_head,
      acquired_at: lease.acquired_at,
      expires_at: lease.expires_at,
    },
    handoffToken: lease.handoff_token,
  };
  writeSecretJson(localProof(deviceState), proof);
  writeJson(acceptanceMarker(vault), marker);
  assertSharedSecretFree(vault, lease.handoff_token);
  return marker;
}

function walkEntries(root: string, directory = root): Array<{ path: string; directory: boolean }> {
  if (!existsSync(directory)) return [];
  const out: Array<{ path: string; directory: boolean }> = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    const relativePath = relative(root, path).replaceAll('\\', '/');
    if (entry.isDirectory()) {
      out.push({ path: relativePath, directory: true }, ...walkEntries(root, path));
    } else if (entry.isFile()) out.push({ path: relativePath, directory: false });
  }
  return out;
}

function mutationManifest(vault: string): ByteManifest {
  const entries = walkEntries(vault).filter(({ path }) =>
    path === '.vault-mind'
    || path === '.vault-mind/_leases.json'
    || path.split('/').includes('runs')
    || path.split('/').includes('agents')
    || path.endsWith('.events.jsonl'),
  );
  return Object.fromEntries(entries.map(({ path, directory }) => [
    path,
    directory ? '<directory>' : sha256(readFileSync(safePath(vault, path))),
  ]));
}

function assertSharedSecretFree(vault: string, handoffToken: string): void {
  for (const entry of walkEntries(vault)) {
    if (entry.directory || entry.path === '.vault-mind' || entry.path.startsWith('.vault-mind/')) continue;
    assert.equal(
      readFileSync(safePath(vault, entry.path)).includes(Buffer.from(handoffToken, 'utf-8')),
      false,
      `shared fleet artifact contains the raw handoff token: ${entry.path}`,
    );
  }
}

function assertResultSecretFree(value: unknown, handoffToken: string, label: string): void {
  assert.equal(JSON.stringify(value).includes(handoffToken), false, `${label} exposed the raw handoff token`);
}

async function assertRejectedWithoutMutation(
  call: (name: string, params?: Record<string, unknown>) => Promise<unknown>,
  vault: string,
  params: Record<string, unknown>,
  label: string,
): Promise<void> {
  const before = mutationManifest(vault);
  await assert.rejects(
    () => call('workflow.agent.join', params),
    /conflict|mismatch|not found|unknown|Project|required|token/i,
    `${label} join unexpectedly succeeded`,
  );
  assert.deepEqual(mutationManifest(vault), before, `${label} join mutated runs/agents/events/lease state`);
}

async function executeRemote(
  vault: string,
  fixture: FleetFixture,
  marker: AcceptanceMarker,
  handoffToken: string,
): Promise<void> {
  try {
    assert.equal(existsSync(leasePath(vault, fixture)), false, 'remote vault received the machine-local lease registry');
    const { call } = operationHarness(vault);
    const capabilityFreeBase = {
      project: marker.projectId,
      agent: marker.agentId,
      work_run_id: marker.workRunId,
      work_run_state: 'leased',
      work_item_id: marker.workItemId,
      lease_mode: 'portable-handoff',
      provenance: [`orca-task:${fixture.externalRefs.find((ref) => ref.kind === 'orca-task')!.target}`],
    };
    await assertRejectedWithoutMutation(call, vault, {
      ...capabilityFreeBase,
      transition_token: `${fixture.conflictProbe.transitionToken}:missing-token`,
    }, 'missing handoff token');
    await assertRejectedWithoutMutation(call, vault, {
      ...capabilityFreeBase,
      handoff_token: 'invalid-fleet-handoff-token-000000000000',
      transition_token: `${fixture.conflictProbe.transitionToken}:wrong-token`,
    }, 'wrong handoff token');

    const base = { ...capabilityFreeBase, handoff_token: handoffToken };
    const conflict = fixture.conflictProbe;
    const mismatches: Array<[string, Record<string, unknown>]> = [
      ['wrong agent', { ...base, agent: conflict.agentId }],
      ['wrong Work Item', { ...base, work_item_id: conflict.workItemId }],
      ['wrong Work Run', { ...base, work_run_id: conflict.workRunId }],
      ['wrong Project', { ...base, project: conflict.projectId }],
    ];
    for (const [label, params] of mismatches) {
      await assertRejectedWithoutMutation(call, vault, {
        ...params,
        transition_token: `${conflict.transitionToken}:${label.toLowerCase().replaceAll(' ', '-')}`,
      }, label);
    }

    const joinParams = { ...base, transition_token: marker.joinToken };
    const joined = await call('workflow.agent.join', joinParams) as { idempotent: boolean };
    assert.equal(joined.idempotent, false);
    assertResultSecretFree(joined, handoffToken, 'join result');
    const afterJoin = mutationManifest(vault);
    const joinReplay = await call('workflow.agent.join', joinParams) as { idempotent: boolean };
    assert.equal(joinReplay.idempotent, true);
    assertResultSecretFree(joinReplay, handoffToken, 'join replay result');
    assert.deepEqual(mutationManifest(vault), afterJoin, 'join replay changed bytes');

    const checkpointParams = {
      project: marker.projectId,
      agent: marker.agentId,
      work_run_id: marker.workRunId,
      transition_token: marker.checkpointToken,
      status: 'passed',
      summary: `${fixture.run.label} fleet checkpoint passed`,
      evidence: [`orca-terminal:${fixture.externalRefs.find((ref) => ref.kind === 'orca-terminal')!.target}`],
    };
    const checkpoint = await call('workflow.agent.checkpoint', checkpointParams);
    assertResultSecretFree(checkpoint, handoffToken, 'checkpoint result');
    const afterCheckpoint = mutationManifest(vault);
    const checkpointReplay = await call('workflow.agent.checkpoint', checkpointParams);
    assertResultSecretFree(checkpointReplay, handoffToken, 'checkpoint replay result');
    assert.deepEqual(mutationManifest(vault), afterCheckpoint, 'checkpoint replay changed bytes');

    const leaveParams = {
      project: marker.projectId,
      agent: marker.agentId,
      work_run_id: marker.workRunId,
      work_run_state: 'completed',
      transition_token: marker.leaveToken,
      summary: `${fixture.run.label} fleet execution completed`,
    };
    const leave = await call('workflow.agent.leave', leaveParams);
    assertResultSecretFree(leave, handoffToken, 'leave result');
    const afterLeave = mutationManifest(vault);
    const leaveReplay = await call('workflow.agent.leave', leaveParams);
    assertResultSecretFree(leaveReplay, handoffToken, 'leave replay result');
    assert.deepEqual(mutationManifest(vault), afterLeave, 'leave replay changed bytes');
    assert.equal(existsSync(leasePath(vault, fixture)), false, 'remote workflow created a lease registry');
    assertSharedSecretFree(vault, handoffToken);
  } catch (error) {
    throw sanitizedError(error, handoffToken);
  }
}

function copySharedVault(source: string, destination: string, requireEmpty: boolean): void {
  mkdirSync(destination, { recursive: true });
  const destinationEntries = readdirSync(destination).filter((entry) => entry !== '.vault-mind');
  if (requireEmpty) assert.deepEqual(destinationEntries, [], `refusing to overwrite non-empty remote vault: ${destination}`);
  const copy = (from: string, to: string): void => {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.vault-mind') continue;
      const sourcePath = join(from, entry.name);
      const targetPath = join(to, entry.name);
      if (entry.isDirectory()) copy(sourcePath, targetPath);
      else if (entry.isFile()) {
        mkdirSync(dirname(targetPath), { recursive: true });
        writeFileSync(targetPath, readFileSync(sourcePath));
      } else {
        throw new Error(`refusing non-file fleet artifact: ${sourcePath}`);
      }
    }
  };
  copy(source, destination);
}

function addCheck(checks: Check[], name: string, run: () => void): void {
  try {
    run();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

async function verifyFixture(
  vault: string,
  deviceState: string,
  fixture: FleetFixture,
  marker: AcceptanceMarker,
): Promise<Check[]> {
  const checks: Check[] = [];
  const proof = readLocalProof(deviceState);
  const currentLeaseBytes = readFileSync(leasePath(vault, fixture));
  const leases = JSON.parse(currentLeaseBytes.toString('utf-8')) as Record<string, RawWorkDriverLease>;
  const matchingLeases = Object.values(leases).filter((lease) => lease.work_run_id === marker.workRunId);
  const durable = JSON.parse(readFileSync(runPath(vault, fixture.project.slug, marker.workRunId), 'utf-8')) as Record<string, unknown>;
  const { call } = operationHarness(vault);

  addCheck(checks, 'local Work Driver lease bytes and identity remain unchanged', () => {
    assert.equal(proof.schemaVersion, 1);
    assert.equal(proof.correlationId, marker.correlationId);
    assert.equal(sha256(currentLeaseBytes), proof.leaseBytesSha256);
    assert.equal(matchingLeases.length, 1);
    const localLease = matchingLeases[0]!;
    if (localLease.handoff_token !== proof.handoffToken) {
      throw new Error('local handoff token no longer matches the Work Driver lease');
    }
    const nonSecretLease: WorkDriverLease = {
      agent_id: localLease.agent_id,
      project_id: localLease.project_id,
      work_item_id: localLease.work_item_id,
      work_run_id: localLease.work_run_id,
      base_head: localLease.base_head,
      acquired_at: localLease.acquired_at,
      expires_at: localLease.expires_at,
    };
    assert.deepEqual(nonSecretLease, proof.lease);
    assert.equal(proof.lease.project_id, marker.projectId);
    assert.equal(proof.lease.work_item_id, marker.workItemId);
    assert.equal(proof.lease.work_run_id, marker.workRunId);
    assert.equal(proof.lease.agent_id, marker.agentId);
  });

  addCheck(checks, '5090 completed the exact locally leased Work Run', () => {
    assert.equal(durable.project_id, marker.projectId);
    assert.equal(durable.work_item_id, marker.workItemId);
    assert.equal(durable.work_run_id, marker.workRunId);
    assert.equal(durable.agent_id, marker.agentId);
    assert.equal(durable.state, 'completed');
  });

  const doctor = await call('workflow.agent.doctor', {
    project: marker.projectId,
    agent: marker.agentId,
    work_run_id: marker.workRunId,
  }) as { ok: boolean; errors: string[] };
  addCheck(checks, 'local doctor accepts the completed remote Work Run', () => {
    assert.equal(doctor.ok, true, doctor.errors.join('; '));
    assert.deepEqual(doctor.errors, []);
  });

  const hub = await call('project.hub.get', { ref: marker.projectId }) as Record<string, any>;
  addCheck(checks, 'Project Hub observes one Work Run without owning provider state', () => {
    assert.equal(hub.projectId, marker.projectId);
    assert.equal(hub.readOnly, true);
    assert.equal(hub.sections.runtime.owner, 'runtime');
    assert.equal(hub.sections.runtime.data.runCount, 1);
    assert.deepEqual(
      hub.sections.integrations.data.projections.map(
        ({ kind, target, stateOwner, copiedState }: Record<string, unknown>) => ({ kind, target, stateOwner, copiedState }),
      ),
      fixture.externalRefs.map(({ kind, target }) => ({ kind, target, stateOwner: 'provider', copiedState: false })),
    );
  });

  addCheck(checks, 'Orca refs remain projections rather than internal identities', () => {
    const identities = new Set([marker.projectId, marker.workItemId, marker.workRunId, marker.agentId]);
    for (const ref of fixture.externalRefs) assert.equal(identities.has(ref.target), false);
  });

  addCheck(checks, 'machine-local paths and lease fields never enter shared state', () => {
    const shared = JSON.stringify({ marker, durable, hub });
    for (const value of [vault, deviceState, resolve(leasePath(vault, fixture)), proof.lease.base_head]) {
      assert.equal(shared.includes(value), false, `machine-local value leaked: ${value}`);
    }
    assert.equal(Object.hasOwn(marker, 'lease'), false);
    assert.equal(Object.hasOwn(marker, 'vault'), false);
    assert.equal(Object.hasOwn(marker, 'deviceState'), false);
    assert.equal(shared.includes(proof.handoffToken), false, 'raw handoff token leaked into shared state');
    assertSharedSecretFree(vault, proof.handoffToken);
  });
  return checks;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const fixture = readFixture(options.fixturePath);
  const digest = sha256(readFileSync(options.fixturePath));
  const automaticVault = !options.vaultPath;
  const automaticRemoteVault = options.phase === 'all' && !options.remoteVaultPath;
  const automaticDeviceState = !options.deviceStatePath;
  const vault = options.vaultPath ?? mkdtempSync(join(tmpdir(), 'llmwiki-fleet-local-'));
  const remoteVault = options.phase === 'all'
    ? options.remoteVaultPath ?? mkdtempSync(join(tmpdir(), 'llmwiki-fleet-5090-'))
    : vault;
  const deviceState = options.deviceStatePath ?? mkdtempSync(join(tmpdir(), 'llmwiki-fleet-device-'));
  assertIndependentRoots(vault, remoteVault, deviceState, options.phase);
  assertLocalSecretPath(deviceState, '--device-state');
  const checks: Check[] = [];
  let marker: AcceptanceMarker | undefined;
  let handoffToken: string | undefined;

  try {
    if (options.phase === 'prepare' || options.phase === 'all') {
      marker = await prepareFixture(vault, deviceState, fixture, digest, options.testedCommit);
      handoffToken = readLocalProof(deviceState).handoffToken;
      checks.push({ name: 'makeProjectOps and Python Work Driver created one local lease', ok: true });
    }
    if (options.phase === 'remote') {
      marker = readMarker(vault, fixture, digest, options.testedCommit);
      handoffToken = resolveRemoteHandoffToken(options, deviceState);
    }
    if (options.phase === 'all') {
      copySharedVault(vault, remoteVault, true);
      const remoteMarker = readMarker(remoteVault, fixture, digest, options.testedCommit);
      await executeRemote(remoteVault, fixture, remoteMarker, handoffToken!);
      copySharedVault(remoteVault, vault, false);
      marker = readMarker(vault, fixture, digest, options.testedCommit);
      checks.push({ name: '5090 handoff rejected missing/wrong capabilities and identities, then replayed byte-identically', ok: true });
    } else if (options.phase === 'remote') {
      await executeRemote(vault, fixture, marker!, handoffToken!);
      checks.push({ name: '5090 handoff rejected missing/wrong capabilities and identities, then replayed byte-identically', ok: true });
    }
    if (options.phase === 'verify') {
      marker = readMarker(vault, fixture, digest, options.testedCommit);
      handoffToken = readLocalProof(deviceState).handoffToken;
    }
    if (options.phase === 'verify' || options.phase === 'all') {
      checks.push(...await verifyFixture(vault, deviceState, fixture, marker!));
    }

    const report: AcceptanceReport = {
      ok: checks.every((check) => check.ok),
      phase: options.phase,
      fixture: options.fixturePath === DEFAULT_FIXTURE ? 'tests/fixtures/fleet-workflow.v1.json' : '<provided-fixture>',
      vault: automaticVault ? '<temporary-vault>' : '<provided-acceptance-vault>',
      deviceState: '<machine-local-state-redacted>',
      commit: marker?.commit ?? currentCommit(),
      fixtureDigest: digest,
      correlationId: marker?.correlationId ?? '<not-created>',
      externalRefs: fixture.externalRefs,
      checks,
    };
    if (handoffToken) assertResultSecretFree(report, handoffToken, 'acceptance report');
    if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      for (const check of report.checks) {
        process.stdout.write(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? `: ${check.detail}` : ''}\n`);
      }
      process.stdout.write(`Fleet workflow acceptance: ${report.ok ? 'ok' : 'failed'}\n`);
    }
    if (!report.ok) process.exitCode = 1;
  } finally {
    if (automaticVault && !options.keep) rmSync(vault, { recursive: true, force: true });
    if (automaticRemoteVault && !options.keep) rmSync(remoteVault, { recursive: true, force: true });
    if (automaticDeviceState && !options.keep) rmSync(deviceState, { recursive: true, force: true });
  }
}

await main();
