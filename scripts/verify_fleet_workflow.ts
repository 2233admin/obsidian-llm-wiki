#!/usr/bin/env bun

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdapterRegistry } from '../mcp-server/src/adapters/registry.ts';
import type { Operation, OperationContext } from '../mcp-server/src/core/types.ts';
import { makeProjectHubOps } from '../mcp-server/src/project/project-hub.ts';
import { makeWorkflowOps } from '../mcp-server/src/workflow/workflow.ts';

type Phase = 'prepare' | 'remote' | 'verify' | 'all';

interface ExternalRef {
  kind: string;
  target: string;
}

interface FleetRun {
  label: string;
  leaseDevice: string;
  executionDevice: string;
  agentId: string;
  workItemId: string;
  workRunId: string;
  joinToken: string;
  checkpointToken: string;
  leaveToken: string;
}

interface FleetFixture {
  schemaVersion: number;
  project: { slug: string; projectId: string; lifecycle: string };
  externalRefs: ExternalRef[];
  runs: FleetRun[];
  deviceLocal: { workspacePath: string; leaseToken: string; leaseStore: string };
  conflictProbe: {
    agentId: string;
    workRunId: string;
    workItemId: string;
    transitionToken: string;
  };
}

interface CliOptions {
  phase: Phase;
  fixturePath: string;
  vaultPath?: string;
  deviceStatePath?: string;
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
  checks: Check[];
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE = resolve(SCRIPT_DIR, '../tests/fixtures/fleet-workflow.v1.json');

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    phase: 'all',
    fixturePath: DEFAULT_FIXTURE,
    keep: false,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]!;
    if (value === '--phase') options.phase = argv[++index] as Phase;
    else if (value === '--fixture') options.fixturePath = resolve(argv[++index]!);
    else if (value === '--vault') options.vaultPath = resolve(argv[++index]!);
    else if (value === '--device-state') options.deviceStatePath = resolve(argv[++index]!);
    else if (value === '--keep') options.keep = true;
    else if (value === '--json') options.json = true;
    else if (value === '--help' || value === '-h') {
      process.stdout.write([
        'Usage: bun scripts/verify_fleet_workflow.ts [options]',
        '',
        '  --phase prepare|remote|verify|all',
        '  --vault PATH          Shared acceptance vault (temporary by default)',
        '  --device-state PATH   Machine-local state directory (outside the shared vault)',
        '  --fixture PATH        Fleet fixture JSON',
        '  --keep                Keep an automatically-created temporary vault',
        '  --json                Emit a JSON report',
        '',
      ].join('\n'));
      process.exit(0);
    } else throw new Error(`Unknown argument: ${value}`);
  }
  if (!['prepare', 'remote', 'verify', 'all'].includes(options.phase)) {
    throw new Error(`Invalid phase: ${options.phase}`);
  }
  return options;
}

function readFixture(path: string): FleetFixture {
  const fixture = JSON.parse(readFileSync(path, 'utf-8')) as FleetFixture;
  assert.equal(fixture.schemaVersion, 1, 'unsupported fixture schemaVersion');
  assert.match(fixture.project.projectId, /^project\/[a-z0-9][a-z0-9-]*$/);
  assert.equal(fixture.project.projectId, `project/${fixture.project.slug}`);
  assert.equal(fixture.runs.length, 2, 'fleet fixture must contain exactly two acceptance runs');
  assert.equal(new Set(fixture.runs.map((run) => run.agentId)).size, fixture.runs.length, 'agent identities must be unique');
  assert.equal(new Set(fixture.runs.map((run) => run.workRunId)).size, fixture.runs.length, 'Work Run identities must be unique');
  assert.ok(fixture.runs.some((run) => run.executionDevice === '5090'), 'fixture must contain a 5090 execution');
  assert.ok(fixture.runs.every((run) => run.workItemId.startsWith(`${fixture.project.projectId}/issue/`)));
  for (const externalRef of fixture.externalRefs) {
    assert.match(externalRef.kind, /^orca-(task|terminal)$/);
    assert.ok(externalRef.target.startsWith(externalRef.kind === 'orca-task' ? 'task_' : 'term_'));
  }
  return fixture;
}

function vaultPath(root: string, relativePath: string): string {
  return join(root, ...relativePath.split('/'));
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function runFile(root: string, workRunId: string): string {
  return vaultPath(root, `01-Projects/fleet-acceptance/runs/${workRunId.slice('work-run/'.length)}.json`);
}

function durableLease(fixture: FleetFixture, run: FleetRun): Record<string, unknown> {
  return {
    schema_version: 1,
    project_id: fixture.project.projectId,
    work_item_id: run.workItemId,
    work_run_id: run.workRunId,
    agent_id: run.agentId,
    state: 'leased',
    output_class: 'view',
    approval_status: 'not-required',
    created_at: 1783987200,
    updated_at: 1783987200,
    provenance: [`work-item:${run.workItemId}`, `lease-device:${run.leaseDevice}`],
    transitions: [{
      transition_token: `driver:lease:${run.label}:1`,
      from: 'planned',
      to: 'leased',
      recorded_at: 1783987200,
    }],
  };
}

function prepareFixture(vault: string, deviceState: string, fixture: FleetFixture): void {
  mkdirSync(vaultPath(vault, 'Projects'), { recursive: true });
  mkdirSync(vaultPath(vault, `01-Projects/${fixture.project.slug}/issues`), { recursive: true });
  const projections = fixture.externalRefs.map((ref) => `${ref.kind}:${ref.target}`);
  writeFileSync(vaultPath(vault, `Projects/${fixture.project.slug}.md`), [
    '---',
    'type: project',
    `entity: ${fixture.project.projectId}`,
    `lifecycle: ${fixture.project.lifecycle}`,
    `external-projections: ${JSON.stringify(projections)}`,
    '---',
    '',
    '# Fleet Acceptance',
    '',
  ].join('\n'), 'utf-8');
  writeFileSync(vaultPath(vault, `01-Projects/${fixture.project.slug}/_project.md`), [
    '---',
    `entity: ${fixture.project.projectId}`,
    '---',
    '',
  ].join('\n'), 'utf-8');

  const leases: Record<string, unknown> = {};
  for (const run of fixture.runs) {
    const issueSlug = run.workItemId.split('/').at(-1)!;
    const issuePath = `01-Projects/${fixture.project.slug}/issues/${issueSlug}.md`;
    writeFileSync(vaultPath(vault, issuePath), [
      '---',
      'type: issue',
      `entity: ${run.workItemId}`,
      'status: active',
      '---',
      '',
    ].join('\n'), 'utf-8');
    writeJson(runFile(vault, run.workRunId), durableLease(fixture, run));
    leases[issuePath] = {
      agent_id: run.agentId,
      project_id: fixture.project.projectId,
      work_item_id: run.workItemId,
      work_run_id: run.workRunId,
      base_head: 'fleet-fixture-head',
      acquired_at: 1783987200,
      expires_at: 1783990800,
    };
  }
  writeJson(join(deviceState, fixture.deviceLocal.leaseStore), {
    workspace_path: fixture.deviceLocal.workspacePath,
    lease_token: fixture.deviceLocal.leaseToken,
    leases,
  });
}

function operationHarness(vault: string): {
  call(name: string, params?: Record<string, unknown>): Promise<unknown>;
} {
  const registry = new AdapterRegistry();
  const operations = [
    ...makeWorkflowOps(vault),
    ...makeProjectHubOps(registry),
  ];
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

async function executeRun(vault: string, fixture: FleetFixture, run: FleetRun): Promise<void> {
  const { call } = operationHarness(vault);
  await call('workflow.agent.join', {
    project: fixture.project.projectId,
    agent: run.agentId,
    host: run.executionDevice === '5090' ? 'orca-5090' : 'codex-local',
    work_run_id: run.workRunId,
    work_run_state: 'leased',
    work_item_id: run.workItemId,
    transition_token: run.joinToken,
    provenance: [`executor-device:${run.executionDevice}`],
  });
  await call('workflow.agent.checkpoint', {
    project: fixture.project.projectId,
    agent: run.agentId,
    work_run_id: run.workRunId,
    transition_token: run.checkpointToken,
    status: 'passed',
    summary: `${run.label} fleet checkpoint passed`,
    evidence: [`fleet:${run.label}:checkpoint`],
  });
  await call('workflow.agent.leave', {
    project: fixture.project.projectId,
    agent: run.agentId,
    work_run_id: run.workRunId,
    work_run_state: 'completed',
    transition_token: run.leaveToken,
    summary: `${run.label} fleet execution completed`,
  });
}

function containsAny(serialized: string, values: string[]): string | undefined {
  return values.find((value) => value && serialized.includes(value));
}

function addCheck(checks: Check[], name: string, run: () => void): void {
  try {
    run();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

async function verifyFixture(vault: string, fixture: FleetFixture): Promise<Check[]> {
  const checks: Check[] = [];
  const { call } = operationHarness(vault);
  const durable = new Map(fixture.runs.map((run) => [
    run.label,
    JSON.parse(readFileSync(runFile(vault, run.workRunId), 'utf-8')) as Record<string, unknown>,
  ]));

  addCheck(checks, 'two agents retain distinct Work Run identities', () => {
    for (const run of fixture.runs) {
      const value = durable.get(run.label)!;
      assert.equal(value.project_id, fixture.project.projectId);
      assert.equal(value.work_item_id, run.workItemId);
      assert.equal(value.work_run_id, run.workRunId);
      assert.equal(value.agent_id, run.agentId);
      assert.equal(value.state, 'completed');
    }
    assert.notEqual(durable.get('local')!.work_run_id, durable.get('5090')!.work_run_id);
    assert.notEqual(durable.get('local')!.agent_id, durable.get('5090')!.agent_id);
  });

  const doctorResults: unknown[] = [];
  for (const run of fixture.runs) {
    doctorResults.push(await call('workflow.agent.doctor', {
      project: fixture.project.projectId,
      agent: run.agentId,
      work_run_id: run.workRunId,
    }));
  }
  addCheck(checks, 'local doctor accepts both durable identities', () => {
    for (const doctor of doctorResults as Array<{ ok: boolean; errors: string[] }>) {
      assert.equal(doctor.ok, true, doctor.errors.join('; '));
      assert.deepEqual(doctor.errors, []);
    }
  });

  const hub = await call('project.hub.get', { ref: fixture.project.projectId }) as Record<string, any>;
  addCheck(checks, 'Project Hub observes both runs without owning their state', () => {
    assert.equal(hub.projectId, fixture.project.projectId);
    assert.equal(hub.readOnly, true);
    assert.equal(hub.sections.runtime.owner, 'runtime');
    assert.equal(hub.sections.runtime.data.runCount, 2);
    const projections = hub.sections.integrations.data.projections as Array<Record<string, unknown>>;
    assert.deepEqual(
      projections.map(({ kind, target, stateOwner, copiedState }) => ({ kind, target, stateOwner, copiedState })),
      fixture.externalRefs.map(({ kind, target }) => ({ kind, target, stateOwner: 'provider', copiedState: false })),
    );
  });

  addCheck(checks, 'Orca externalRef remains a projection, never an internal identity', () => {
    const identities = new Set([
      fixture.project.projectId,
      ...fixture.runs.flatMap((run) => [run.workItemId, run.workRunId, run.agentId]),
    ]);
    for (const ref of fixture.externalRefs) {
      assert.equal(identities.has(ref.target), false);
      for (const run of fixture.runs) {
        const value = durable.get(run.label)!;
        assert.notEqual(value.project_id, ref.target);
        assert.notEqual(value.work_item_id, ref.target);
        assert.notEqual(value.work_run_id, ref.target);
        assert.notEqual(value.agent_id, ref.target);
      }
    }
  });

  addCheck(checks, 'machine-local lease and workspace values do not enter durable runs or Hub', () => {
    const shared = JSON.stringify({ durable: [...durable.values()], hub });
    const leaked = containsAny(shared, [
      fixture.deviceLocal.workspacePath,
      fixture.deviceLocal.leaseToken,
      fixture.deviceLocal.leaseStore,
    ]);
    assert.equal(leaked, undefined, `machine-local value leaked: ${leaked}`);
  });

  const conflict = fixture.conflictProbe;
  const conflictPath = runFile(vault, conflict.workRunId);
  const before = readFileSync(conflictPath, 'utf-8');
  let rejected = false;
  let rejection = '';
  try {
    await call('workflow.agent.join', {
      project: fixture.project.projectId,
      agent: conflict.agentId,
      work_run_id: conflict.workRunId,
      work_run_state: 'leased',
      work_item_id: conflict.workItemId,
      transition_token: conflict.transitionToken,
    });
  } catch (error) {
    rejected = true;
    rejection = error instanceof Error ? error.message : String(error);
  } finally {
    if (!rejected) {
      writeFileSync(conflictPath, before, 'utf-8');
      rmSync(vaultPath(vault, `01-Projects/${fixture.project.slug}/agents/${conflict.agentId}`), {
        recursive: true,
        force: true,
      });
    }
  }
  addCheck(checks, 'mismatched join is rejected before identity overwrite', () => {
    assert.equal(rejected, true, 'conflicting join unexpectedly succeeded');
    assert.match(rejection, /conflict|mismatch|identity|agent|Work Run/i);
    assert.equal(readFileSync(conflictPath, 'utf-8'), before);
  });

  return checks;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const fixture = readFixture(options.fixturePath);
  const automaticVault = !options.vaultPath;
  const vault = options.vaultPath ?? mkdtempSync(join(tmpdir(), 'llmwiki-fleet-acceptance-'));
  const deviceState = options.deviceStatePath ?? `${vault}.device-local`;
  const checks: Check[] = [];

  try {
    if (options.phase === 'prepare' || options.phase === 'all') {
      prepareFixture(vault, deviceState, fixture);
      await executeRun(vault, fixture, fixture.runs.find((run) => run.executionDevice === 'local')!);
      checks.push({ name: 'local lease and execution prepared', ok: true });
    }
    if (options.phase === 'remote' || options.phase === 'all') {
      await executeRun(vault, fixture, fixture.runs.find((run) => run.executionDevice === '5090')!);
      checks.push({ name: '5090 join, checkpoint, and leave completed', ok: true });
    }
    if (options.phase === 'verify' || options.phase === 'all') {
      checks.push(...await verifyFixture(vault, fixture));
    }

    const report: AcceptanceReport = {
      ok: checks.every((check) => check.ok),
      phase: options.phase,
      fixture: options.fixturePath === DEFAULT_FIXTURE ? 'tests/fixtures/fleet-workflow.v1.json' : '<provided-fixture>',
      vault: automaticVault ? '<temporary-vault>' : '<provided-shared-vault>',
      deviceState: '<machine-local-state-redacted>',
      checks,
    };
    if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      for (const check of report.checks) {
        process.stdout.write(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? `: ${check.detail}` : ''}\n`);
      }
      process.stdout.write(`Fleet workflow acceptance: ${report.ok ? 'ok' : 'failed'}\n`);
    }
    if (!report.ok) process.exitCode = 1;
  } finally {
    if (automaticVault && !options.keep) {
      rmSync(vault, { recursive: true, force: true });
      rmSync(deviceState, { recursive: true, force: true });
    }
  }
}

await main();
