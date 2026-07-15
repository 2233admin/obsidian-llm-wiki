import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { isWorkRunTransitionAllowed, makeWorkflowOps, WORK_RUN_STATES, type WorkRunState } from './workflow.js';
import type { Operation, OperationContext } from '../core/types.js';
import { compatibilityReadReport } from '../project/project-context.js';

function makeHarness() {
  const root = join(tmpdir(), `llmwiki-workflow-${randomUUID()}`);
  mkdirSync(join(root, 'Projects'), { recursive: true });
  for (const [slug, alias] of [['alpha', 'alpha'], ['alpha-project', 'Alpha Project'], ['my-project', 'My Project']]) {
    writeFileSync(
      join(root, 'Projects', `${slug}.md`),
      ['---', 'type: project', `entity: project/${slug}`, 'lifecycle: active', `aliases: [${alias}]`, '---', ''].join('\n'),
      'utf-8',
    );
  }
  const ops = makeWorkflowOps(root);
  const byName = new Map(ops.map((op) => [op.name, op]));
  const ctx: OperationContext = {
    vault: null as never,
    adapters: null,
    config: {
      vault_path: root,
      collaboration: { actor: 'codex', role: 'agent' },
    },
    logger: { info() {}, warn() {}, error() {} },
    dryRun: false,
  };
  const call = async (name: string, params: Record<string, unknown> = {}) => {
    const op = byName.get(name) as Operation | undefined;
    assert.ok(op, `missing op: ${name}`);
    return op.handler(ctx, params);
  };
  return { root, call, byName, ctx };
}

function vp(root: string, rel: string): string {
  return join(root, ...rel.split('/'));
}

interface WorkRunContractFixture {
  lifecycle: WorkRunState[];
  terminalStates: WorkRunState[];
  transitions: Record<WorkRunState, WorkRunState[]>;
  outputClasses: string[];
  approvalStatuses: string[];
  example: {
    projectId: string;
    workItemId: string;
    workRunId: string;
    transitionToken: string;
    provenance: string[];
  };
}

const PORTABLE_HANDOFF_TOKEN = 'portable-handoff-secret-32-bytes';

function readWorkRunFixture(): WorkRunContractFixture {
  return JSON.parse(
    readFileSync(new URL('../../../tests/fixtures/work-run-contract.json', import.meta.url), 'utf-8'),
  ) as WorkRunContractFixture;
}

function seedDriverLease(root: string, overrides: Partial<{
  projectId: string;
  workItemId: string;
  workRunId: string;
  agentId: string;
  leaseAgentId: string;
  expiresAt: number;
  handoffToken: string;
  handoffExpiresAt: string;
}> = {}) {
  const fixture = readWorkRunFixture();
  const projectId = overrides.projectId ?? fixture.example.projectId;
  const workItemId = overrides.workItemId ?? fixture.example.workItemId;
  const workRunId = overrides.workRunId ?? fixture.example.workRunId;
  const agentId = overrides.agentId ?? 'worker';
  const leaseAgentId = overrides.leaseAgentId ?? agentId;
  const handoffToken = overrides.handoffToken ?? PORTABLE_HANDOFF_TOKEN;
  const slug = projectId.slice('project/'.length);
  const runPath = vp(root, `01-Projects/${slug}/runs/${workRunId.slice('work-run/'.length)}.json`);
  const leasePath = vp(root, '.vault-mind/_leases.json');
  mkdirSync(join(root, '.vault-mind'), { recursive: true });
  mkdirSync(join(root, '01-Projects', slug, 'runs'), { recursive: true });
  writeFileSync(leasePath, JSON.stringify({
    [`01-Projects/${slug}/issues/${workItemId.split('/').at(-1)}.md`]: {
      agent_id: leaseAgentId,
      project_id: projectId,
      work_item_id: workItemId,
      work_run_id: workRunId,
      base_head: 'baseline',
      acquired_at: 1,
      expires_at: overrides.expiresAt ?? 9_999_999_999,
      lease_token: 'machine-local-lease-token',
      workspace_path: 'C:/machine-local/worktree',
    },
  }, null, 2), 'utf-8');
  writeFileSync(runPath, JSON.stringify({
    schema_version: 1,
    project_id: projectId,
    work_item_id: workItemId,
    work_run_id: workRunId,
    agent_id: agentId,
    state: 'leased',
    output_class: 'view',
    approval_status: 'not-required',
    created_at: 1,
    updated_at: 1,
    provenance: [`work-item:${workItemId}`],
    transitions: [{
      transition_token: `driver:lease:${workRunId.slice('work-run/'.length)}`,
      from: 'planned',
      to: 'leased',
      recorded_at: 1,
    }],
    handoff_token_hash: createHash('sha256').update(handoffToken, 'utf-8').digest('hex'),
    handoff_expires_at: overrides.handoffExpiresAt ?? '2999-01-01T00:00:00.000Z',
    lease_token: 'must-be-scrubbed',
    workspace_path: 'C:/must-not-cross-devices',
  }, null, 2), 'utf-8');
  return { leasePath, runPath, projectId, workItemId, workRunId, agentId, handoffToken };
}

describe('agent project workflow operations', () => {
  test('language-neutral Work Run fixture matches the TypeScript lifecycle table', () => {
    const fixture = readWorkRunFixture();
    assert.deepEqual(fixture.lifecycle, [...WORK_RUN_STATES]);
    for (const from of fixture.lifecycle) {
      for (const to of fixture.lifecycle) {
        assert.equal(
          isWorkRunTransitionAllowed(from, to),
          fixture.transitions[from].includes(to),
          `${from} -> ${to}`,
        );
      }
    }
    assert.deepEqual(fixture.terminalStates, ['completed', 'failed', 'cancelled']);
    assert.deepEqual(fixture.outputClasses, [
      'view',
      'work-state-transition',
      'knowledge-claim',
      'external-side-effect',
    ]);
    assert.deepEqual(fixture.approvalStatuses, ['not-required', 'pending', 'approved', 'denied']);
  });

  test('workflow.state.set writes vault-first status and workflow.state.get reads it', async () => {
    const { root, call } = makeHarness();
    try {
      const result = (await call('workflow.state.set', {
        project: 'My Project',
        stage: 'plan',
        objective: 'Decide whether to learn LazyCodex workflow logic',
        branch: 'workflow-module',
        host: 'codex',
        evidence: ['repo:radiant303/lazycodex', 'test:workflow'],
        notes: 'Keep vault as source of truth.',
      })) as { path: string; state: { project: string; stage: string; evidence: string[] }; projectInitialized: boolean };

      assert.equal(result.path, '01-Projects/my-project/workflow/status.md');
      assert.equal(result.state.project, 'my-project');
      assert.equal(result.state.stage, 'plan');
      assert.deepEqual(result.state.evidence, ['repo:radiant303/lazycodex', 'test:workflow']);
      assert.equal(result.projectInitialized, false);

      const note = readFileSync(vp(root, result.path), 'utf-8');
      assert.match(note, /type: workflow-state/);
      assert.match(note, /entity: project\/my-project\/workflow\/state/);
      assert.match(note, /stage: plan/);
      assert.match(note, /Keep vault as source of truth\./);

      const got = (await call('workflow.state.get', { project: 'My Project' })) as {
        exists: boolean;
        state: { stage: string; objective: string; host: string; updatedBy: string };
      };
      assert.equal(got.exists, true);
      assert.equal(got.state.stage, 'plan');
      assert.equal(got.state.objective, 'Decide whether to learn LazyCodex workflow logic');
      assert.equal(got.state.host, 'codex');
      assert.equal(got.state.updatedBy, 'codex');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('workflow audit targets resolve aliases and strict mode rejects bare slugs', () => {
    const { root, byName, ctx } = makeHarness();
    const previous = process.env.LLMWIKI_PROJECT_COMPATIBILITY;
    try {
      const stateSet = byName.get('workflow.state.set')!;
      const beforeCount = compatibilityReadReport().find(
        (item) => item.operation === 'workflow.state.set' && item.projectId === 'project/alpha-project',
      )?.count ?? 0;
      assert.deepEqual(stateSet.writePolicy!.targets(ctx, { project: 'Alpha Project' }), [
        '01-Projects/alpha-project/workflow/status.md',
      ]);
      const afterCount = compatibilityReadReport().find(
        (item) => item.operation === 'workflow.state.set' && item.projectId === 'project/alpha-project',
      )?.count ?? 0;
      assert.equal(afterCount, beforeCount, 'write-policy resolution must not count as a public compatibility read');
      assert.throws(
        () => stateSet.writePolicy!.targets(ctx, { project: 'missing' }),
        /Project not found: missing/,
      );
      assert.equal(existsSync(vp(root, '01-Projects')), false);

      process.env.LLMWIKI_PROJECT_COMPATIBILITY = 'disabled';
      assert.throws(
        () => stateSet.writePolicy!.targets(ctx, { project: 'alpha-project' }),
        /Legacy Project references are disabled/,
      );
      assert.equal(existsSync(vp(root, '01-Projects')), false);
    } finally {
      if (previous === undefined) delete process.env.LLMWIKI_PROJECT_COMPATIBILITY;
      else process.env.LLMWIKI_PROJECT_COMPATIBILITY = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('workflow.checkpoint.add appends shared host-neutral checkpoints', async () => {
    const { root, call } = makeHarness();
    try {
      const result = (await call('workflow.checkpoint.add', {
        project: 'alpha',
        stage: 'verify',
        status: 'passed',
        summary: 'workflow tests passed',
        evidence: ['npm:test'],
        next: 'archive decision',
      })) as { path: string; stage: string; status: string; actor: string };

      assert.equal(result.path, '01-Projects/alpha/workflow/checkpoints.md');
      assert.equal(result.stage, 'verify');
      assert.equal(result.status, 'passed');
      assert.equal(result.actor, 'codex');

      const note = readFileSync(vp(root, result.path), 'utf-8');
      assert.match(note, /type: workflow-checkpoints/);
      assert.match(note, /# Workflow Checkpoints: alpha/);
      assert.match(note, /- summary: workflow tests passed/);
      assert.match(note, /  - npm:test/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('workflow.doctor reports required project workflow files', async () => {
    const { root, call } = makeHarness();
    try {
      const before = (await call('workflow.doctor', { project: 'alpha' })) as { ok: boolean; missing: string[] };
      assert.equal(before.ok, false);
      assert.deepEqual(before.missing, [
        '01-Projects/alpha/_project.md',
        '01-Projects/alpha/issues',
        '01-Projects/alpha/workflow/status.md',
      ]);

      mkdirSync(vp(root, '01-Projects/alpha/issues'), { recursive: true });
      writeFileSync(vp(root, '01-Projects/alpha/_project.md'), '# alpha\n', 'utf-8');
      await call('workflow.state.set', { project: 'alpha', stage: 'execute' });

      const after = (await call('workflow.doctor', { project: 'alpha' })) as { ok: boolean; missing: string[]; warnings: string[] };
      assert.equal(after.ok, true);
      assert.deepEqual(after.missing, []);
      assert.ok(after.warnings.includes('01-Projects/alpha/workflow/checkpoints.md'));
      assert.ok(after.warnings.includes('_llmwiki/source-registry.json'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('workflow.agent.start creates an explicit manual lifetime and replays idempotently', async () => {
    const { root, call } = makeHarness();
    try {
      const params = {
        project: 'Alpha Project',
        agent: 'Codex Worker',
        role: 'worker',
        host: 'codex',
        objective: 'Build agent lifetime contract',
        issue: 'agent-lifetime',
        transition_token: 'manual:start:codex-worker',
      };
      const result = (await call('workflow.agent.start', params)) as {
        path: string;
        eventsPath: string;
        workRunId: string;
        lifetime: { project: string; agent: string; stage: string; status: string };
      };

      assert.equal(result.path, '01-Projects/alpha-project/agents/codex-worker/lifetime.md');
      assert.equal(result.eventsPath, '01-Projects/alpha-project/agents/codex-worker/events.md');
      assert.equal(result.lifetime.project, 'alpha-project');
      assert.equal(result.lifetime.agent, 'codex-worker');
      assert.equal(result.lifetime.stage, 'think');
      assert.equal(result.lifetime.status, 'active');

      const lifetime = readFileSync(vp(root, result.path), 'utf-8');
      assert.match(lifetime, /type: agent-lifetime/);
      assert.match(lifetime, /entity: project\/alpha-project\/agent\/codex-worker\/lifetime/);
      assert.match(lifetime, /stage: think/);

      const events = readFileSync(vp(root, result.eventsPath), 'utf-8');
      assert.match(events, /type: agent-lifetime-events/);
      assert.match(events, /- summary: Build agent lifetime contract/);

      const runPath = vp(root, `01-Projects/alpha-project/runs/${result.workRunId.slice('work-run/'.length)}.json`);
      const before = {
        lifetime,
        events,
        run: readFileSync(runPath, 'utf-8'),
      };
      const replay = (await call('workflow.agent.start', params)) as { idempotent: boolean; workRunId: string };
      assert.equal(replay.idempotent, true);
      assert.equal(replay.workRunId, result.workRunId);
      assert.equal(readFileSync(vp(root, result.path), 'utf-8'), before.lifetime);
      assert.equal(readFileSync(vp(root, result.eventsPath), 'utf-8'), before.events);
      assert.equal(readFileSync(runPath, 'utf-8'), before.run);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('workflow.agent.join attaches the Work Driver identity and transition tokens are idempotent', async () => {
    const { root, call } = makeHarness();
    const fixture = readWorkRunFixture();
    try {
      const seeded = seedDriverLease(root);
      const leaseBefore = readFileSync(seeded.leasePath, 'utf-8');
      const joined = (await call('workflow.agent.join', {
        project: 'alpha',
        agent: 'worker',
        issue: 'build-index',
        work_run_id: fixture.example.workRunId,
        work_run_state: 'leased',
        work_item_id: fixture.example.workItemId,
        transition_token: fixture.example.transitionToken,
        provenance: fixture.example.provenance,
      })) as {
        workRunId: string;
        lifetime: {
          projectId: string;
          workRunId: string;
          workRunState: string;
          workItemId: string;
          provenance: string[];
        };
      };
      assert.equal(joined.workRunId, fixture.example.workRunId);
      assert.equal(joined.lifetime.projectId, fixture.example.projectId);
      assert.equal(joined.lifetime.workRunState, 'running');
      assert.equal(joined.lifetime.workItemId, fixture.example.workItemId);
      assert.deepEqual(joined.lifetime.provenance, fixture.example.provenance);
      const runPath = vp(root, `01-Projects/alpha/runs/${fixture.example.workRunId.slice('work-run/'.length)}.json`);
      const joinedRun = JSON.parse(readFileSync(runPath, 'utf-8')) as Record<string, unknown>;
      assert.equal(joinedRun.project_id, fixture.example.projectId);
      assert.equal(joinedRun.state, 'running');
      assert.equal('lease_token' in joinedRun, false);
      assert.equal('workspace_path' in joinedRun, false);
      assert.equal(readFileSync(seeded.leasePath, 'utf-8'), leaseBefore);

      const lifetimeAfterJoin = readFileSync(vp(root, '01-Projects/alpha/agents/worker/lifetime.md'), 'utf-8');
      const eventsAfterJoin = readFileSync(vp(root, '01-Projects/alpha/agents/worker/events.md'), 'utf-8');
      const runAfterJoin = readFileSync(runPath, 'utf-8');
      const exactReplay = (await call('workflow.agent.join', {
        project: 'alpha',
        agent: 'worker',
        issue: 'build-index',
        work_run_id: fixture.example.workRunId,
        work_run_state: 'leased',
        work_item_id: fixture.example.workItemId,
        transition_token: fixture.example.transitionToken,
        provenance: fixture.example.provenance,
      })) as { idempotent: boolean; workRunId: string };
      assert.equal(exactReplay.idempotent, true);
      assert.equal(exactReplay.workRunId, fixture.example.workRunId);
      assert.equal(readFileSync(vp(root, '01-Projects/alpha/agents/worker/lifetime.md'), 'utf-8'), lifetimeAfterJoin);
      assert.equal(readFileSync(vp(root, '01-Projects/alpha/agents/worker/events.md'), 'utf-8'), eventsAfterJoin);
      assert.equal(readFileSync(runPath, 'utf-8'), runAfterJoin);
      const rejoined = (await call('workflow.agent.join', {
        project: fixture.example.projectId,
        agent: 'worker',
        issue: 'build-index',
        work_run_id: fixture.example.workRunId,
        work_run_state: 'running',
        work_item_id: fixture.example.workItemId,
        transition_token: 'agent:join:retry',
        provenance: fixture.example.provenance,
      })) as { idempotent: boolean; workRunId: string };
      assert.equal(rejoined.idempotent, true);
      assert.equal(rejoined.workRunId, fixture.example.workRunId);
      assert.equal(readFileSync(vp(root, '01-Projects/alpha/agents/worker/lifetime.md'), 'utf-8'), lifetimeAfterJoin);
      assert.equal(readFileSync(vp(root, '01-Projects/alpha/agents/worker/events.md'), 'utf-8'), eventsAfterJoin);
      assert.equal(readFileSync(runPath, 'utf-8'), runAfterJoin);
      assert.equal(readFileSync(seeded.leasePath, 'utf-8'), leaseBefore);

      const checkpointParams = {
        project: 'alpha',
        agent: 'worker',
        work_run_id: fixture.example.workRunId,
        transition_token: 'checkpoint:build-index:1',
        status: 'passed',
        summary: 'index fixture verified',
        evidence: ['test:index'],
      };
      const first = (await call('workflow.agent.checkpoint', checkpointParams)) as {
        idempotent: boolean;
        workRunState: string;
      };
      const replay = (await call('workflow.agent.checkpoint', checkpointParams)) as {
        idempotent: boolean;
        lifetime: { workRunState: string };
      };
      assert.equal(first.idempotent, false);
      assert.equal(first.workRunState, 'running');
      assert.equal(replay.idempotent, true);
      assert.equal(replay.lifetime.workRunState, 'running');
      const checkpointedRun = JSON.parse(readFileSync(runPath, 'utf-8')) as { transitions: unknown[] };
      assert.equal(checkpointedRun.transitions.length, 2);

      const events = readFileSync(vp(root, '01-Projects/alpha/agents/worker/events.md'), 'utf-8');
      assert.equal(events.match(/transition-token: checkpoint:build-index:1/g)?.length, 1);
      const lifetime = readFileSync(vp(root, '01-Projects/alpha/agents/worker/lifetime.md'), 'utf-8');
      assert.match(lifetime, /project-id: project\/alpha/);
      assert.match(lifetime, /work-run-state: running/);
      assert.match(lifetime, /output-class: view/);
      assert.match(lifetime, /approval-status: not-required/);

      const doctor = (await call('workflow.agent.doctor', {
        project: 'alpha',
        agent: 'worker',
        work_run_id: fixture.example.workRunId,
      })) as { ok: boolean; errors: string[] };
      assert.equal(doctor.ok, true);
      assert.deepEqual(doctor.errors, []);
      const mismatch = (await call('workflow.agent.doctor', {
        project: 'alpha',
        agent: 'worker',
        work_run_id: 'work-run/different-run',
      })) as { ok: boolean; errors: string[] };
      assert.equal(mismatch.ok, false);
      assert.deepEqual(mismatch.errors, [
        `work-run-id mismatch: expected work-run/different-run, found ${fixture.example.workRunId}`,
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('workflow.agent.join replay still requires a valid local lease', async () => {
    const { root, call } = makeHarness();
    const fixture = readWorkRunFixture();
    try {
      const seeded = seedDriverLease(root);
      const params = {
        project: fixture.example.projectId,
        agent: 'worker',
        work_run_id: fixture.example.workRunId,
        work_run_state: 'leased',
        work_item_id: fixture.example.workItemId,
        transition_token: fixture.example.transitionToken,
        provenance: fixture.example.provenance,
      };
      const joined = (await call('workflow.agent.join', params)) as { path: string; eventsPath: string };
      const before = {
        lifetime: readFileSync(vp(root, joined.path), 'utf-8'),
        events: readFileSync(vp(root, joined.eventsPath), 'utf-8'),
        run: readFileSync(seeded.runPath, 'utf-8'),
      };
      const leases = JSON.parse(readFileSync(seeded.leasePath, 'utf-8')) as Record<string, Record<string, unknown>>;
      Object.values(leases)[0].expires_at = 1;
      writeFileSync(seeded.leasePath, JSON.stringify(leases, null, 2), 'utf-8');

      await assert.rejects(() => call('workflow.agent.join', params), /local lease is missing or expired/);
      assert.equal(readFileSync(vp(root, joined.path), 'utf-8'), before.lifetime);
      assert.equal(readFileSync(vp(root, joined.eventsPath), 'utf-8'), before.events);
      assert.equal(readFileSync(seeded.runPath, 'utf-8'), before.run);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('workflow.agent.join defaults to a local lease and rejects a missing durable run without mutation', async () => {
    const fixture = readWorkRunFixture();

    for (const portable of [false, true]) {
      const { root, call } = makeHarness();
      try {
        const params = {
          project: fixture.example.projectId,
          agent: 'worker',
          work_run_id: fixture.example.workRunId,
          work_item_id: fixture.example.workItemId,
          transition_token: `join:missing-durable:${portable}`,
          ...(portable ? { lease_mode: 'portable-handoff' } : {}),
        };
        await assert.rejects(
          () => call('workflow.agent.join', params),
          /durable run not found/,
        );
        assert.equal(existsSync(vp(root, '01-Projects/alpha')), false);
        assert.equal(existsSync(vp(root, '.vault-mind')), false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  test('workflow.agent.join rejects a durable run without a local lease by default', async () => {
    const { root, call } = makeHarness();
    const fixture = readWorkRunFixture();
    try {
      const seeded = seedDriverLease(root);
      rmSync(seeded.leasePath);
      const runBefore = readFileSync(seeded.runPath, 'utf-8');
      await assert.rejects(
        () => call('workflow.agent.join', {
          project: fixture.example.projectId,
          agent: 'worker',
          work_run_id: fixture.example.workRunId,
          work_item_id: fixture.example.workItemId,
          transition_token: 'join:local-required',
        }),
        /expected exactly one local lease/,
      );
      assert.equal(readFileSync(seeded.runPath, 'utf-8'), runBefore);
      assert.equal(existsSync(vp(root, '01-Projects/alpha/agents')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('workflow.agent.join supports an explicit portable handoff and replays it idempotently', async () => {
    const { root, call } = makeHarness();
    const fixture = readWorkRunFixture();
    try {
      const seeded = seedDriverLease(root);
      rmSync(seeded.leasePath);
      const params = {
        project: fixture.example.projectId,
        agent: 'worker',
        work_run_id: fixture.example.workRunId,
        work_run_state: 'leased',
        work_item_id: fixture.example.workItemId,
        lease_mode: 'portable-handoff',
        handoff_token: seeded.handoffToken,
        transition_token: 'join:portable-handoff',
        provenance: ['work-driver:portable-handoff'],
      };
      const joined = (await call('workflow.agent.join', params)) as {
        idempotent: boolean;
        path: string;
        eventsPath: string;
        runPath: string;
        lifetime: { projectId: string; workItemId: string; workRunId: string; agent: string; workRunState: string };
      };
      assert.equal(joined.idempotent, false);
      assert.deepEqual(
        {
          projectId: joined.lifetime.projectId,
          workItemId: joined.lifetime.workItemId,
          workRunId: joined.lifetime.workRunId,
          agent: joined.lifetime.agent,
          state: joined.lifetime.workRunState,
        },
        {
          projectId: fixture.example.projectId,
          workItemId: fixture.example.workItemId,
          workRunId: fixture.example.workRunId,
          agent: 'worker',
          state: 'running',
        },
      );
      const before = {
        lifetime: readFileSync(vp(root, joined.path), 'utf-8'),
        events: readFileSync(vp(root, joined.eventsPath), 'utf-8'),
        run: readFileSync(vp(root, joined.runPath), 'utf-8'),
      };
      const replay = (await call('workflow.agent.join', params)) as { idempotent: boolean; workRunId: string };
      assert.equal(replay.idempotent, true);
      assert.equal(replay.workRunId, fixture.example.workRunId);
      assert.equal(readFileSync(vp(root, joined.path), 'utf-8'), before.lifetime);
      assert.equal(readFileSync(vp(root, joined.eventsPath), 'utf-8'), before.events);
      assert.equal(readFileSync(vp(root, joined.runPath), 'utf-8'), before.run);
      assert.equal(existsSync(seeded.leasePath), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('portable handoff requires the exact unexpired durable token and never persists or returns it', async () => {
    const fixture = readWorkRunFixture();
    const cases = [
      { name: 'missing', token: undefined, expected: /handoff_token is required/ },
      { name: 'wrong', token: 'wrong-portable-handoff-secret', expected: /handoff token mismatch/ },
      { name: 'expired', token: PORTABLE_HANDOFF_TOKEN, expires: '2000-01-01T00:00:00.000Z', expected: /missing or expired/ },
    ];
    for (const item of cases) {
      const { root, call } = makeHarness();
      try {
        const seeded = seedDriverLease(root, item.expires ? { handoffExpiresAt: item.expires } : {});
        rmSync(seeded.leasePath);
        const runBefore = readFileSync(seeded.runPath, 'utf-8');
        await assert.rejects(
          () => call('workflow.agent.join', {
            project: fixture.example.projectId,
            agent: 'worker',
            work_run_id: fixture.example.workRunId,
            work_item_id: fixture.example.workItemId,
            lease_mode: 'portable-handoff',
            ...(item.token ? { handoff_token: item.token } : {}),
            transition_token: `join:portable-token:${item.name}`,
          }),
          item.expected,
        );
        assert.equal(readFileSync(seeded.runPath, 'utf-8'), runBefore);
        assert.equal(existsSync(vp(root, '01-Projects/alpha/agents')), false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }

    {
      const { root, call } = makeHarness();
      try {
        const seeded = seedDriverLease(root);
        rmSync(seeded.leasePath);
        const runBefore = readFileSync(seeded.runPath, 'utf-8');
        await assert.rejects(
          () => call('workflow.agent.join', {
            project: fixture.example.projectId,
            agent: 'worker',
            work_run_id: fixture.example.workRunId,
            work_item_id: fixture.example.workItemId,
            lease_mode: 'portable-handoff',
            handoff_token: seeded.handoffToken,
            objective: `never echo ${seeded.handoffToken}`,
            transition_token: 'join:portable-echo',
          }),
          /objective must not contain the handoff token/,
        );
        assert.equal(readFileSync(seeded.runPath, 'utf-8'), runBefore);
        assert.equal(existsSync(vp(root, '01-Projects/alpha/agents')), false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }

    const { root, call } = makeHarness();
    try {
      const seeded = seedDriverLease(root);
      rmSync(seeded.leasePath);
      const result = await call('workflow.agent.join', {
        project: fixture.example.projectId,
        agent: 'worker',
        work_run_id: fixture.example.workRunId,
        work_item_id: fixture.example.workItemId,
        lease_mode: 'portable-handoff',
        handoff_token: seeded.handoffToken,
        transition_token: 'join:portable-redaction',
      });
      const persisted = [
        readFileSync(seeded.runPath, 'utf-8'),
        readFileSync(vp(root, '01-Projects/alpha/agents/worker/lifetime.md'), 'utf-8'),
        readFileSync(vp(root, '01-Projects/alpha/agents/worker/events.md'), 'utf-8'),
        JSON.stringify(result),
      ].join('\n');
      assert.equal(persisted.includes(seeded.handoffToken), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('portable handoff rejects durable identity mismatches without mutation', async () => {
    const fixture = readWorkRunFixture();
    const cases: Array<{ name: string; params: Record<string, unknown> }> = [
      {
        name: 'Project',
        params: { project: 'project/my-project', agent: 'worker', work_run_id: fixture.example.workRunId,
          work_item_id: 'project/my-project/issue/build-index' },
      },
      {
        name: 'Work Item',
        params: { project: fixture.example.projectId, agent: 'worker', work_run_id: fixture.example.workRunId,
          work_item_id: 'project/alpha/issue/other' },
      },
      {
        name: 'Work Run',
        params: { project: fixture.example.projectId, agent: 'worker', work_run_id: 'work-run/other-run',
          work_item_id: fixture.example.workItemId },
      },
      {
        name: 'agent',
        params: { project: fixture.example.projectId, agent: 'other-agent', work_run_id: fixture.example.workRunId,
          work_item_id: fixture.example.workItemId },
      },
    ];

    for (const [index, mismatch] of cases.entries()) {
      const { root, call } = makeHarness();
      try {
        const seeded = seedDriverLease(root);
        rmSync(seeded.leasePath);
        const runBefore = readFileSync(seeded.runPath, 'utf-8');
        await assert.rejects(
          () => call('workflow.agent.join', {
            ...mismatch.params,
            lease_mode: 'portable-handoff',
            handoff_token: PORTABLE_HANDOFF_TOKEN,
            transition_token: `join:portable-mismatch:${index}`,
          }),
          /identity conflict|durable run not found/i,
        );
        assert.equal(readFileSync(seeded.runPath, 'utf-8'), runBefore);
        assert.equal(existsSync(vp(root, '01-Projects/alpha/agents')), false);
        assert.equal(existsSync(vp(root, '01-Projects/my-project/agents')), false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  test('portable handoff cannot bypass a present mismatched or expired local lease', async () => {
    const fixture = readWorkRunFixture();
    for (const overrides of [{ leaseAgentId: 'other-agent' }, { expiresAt: 1 }]) {
      const { root, call } = makeHarness();
      try {
        const seeded = seedDriverLease(root, overrides);
        const before = {
          lease: readFileSync(seeded.leasePath, 'utf-8'),
          run: readFileSync(seeded.runPath, 'utf-8'),
        };
        await assert.rejects(
          () => call('workflow.agent.join', {
            project: fixture.example.projectId,
            agent: 'worker',
            work_run_id: fixture.example.workRunId,
            work_item_id: fixture.example.workItemId,
            lease_mode: 'portable-handoff',
            handoff_token: seeded.handoffToken,
            transition_token: 'join:portable-local-conflict',
          }),
          /identity conflict/,
        );
        assert.equal(readFileSync(seeded.leasePath, 'utf-8'), before.lease);
        assert.equal(readFileSync(seeded.runPath, 'utf-8'), before.run);
        assert.equal(existsSync(vp(root, '01-Projects/alpha/agents')), false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  test('workflow.agent.join rejects unleased creation without mutation', async () => {
    const { root, call } = makeHarness();
    try {
      await assert.rejects(
        () => call('workflow.agent.join', {
          project: 'alpha',
          agent: 'worker',
          work_run_id: 'work-run/unleased',
          transition_token: 'join:unleased',
        }),
        /requires a canonical Work Item, Work Run, and active lease identity/,
      );
      assert.equal(existsSync(vp(root, '01-Projects/alpha')), false);
      await assert.rejects(
        () => call('workflow.agent.start', {
          project: 'alpha',
          agent: 'worker',
          work_run_id: 'work-run/impersonated',
        }),
        /does not accept leased identity fields/,
      );
      assert.equal(existsSync(vp(root, '01-Projects/alpha')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('workflow.agent.join conflicts on Project, Work Item, Work Run, agent, or lease mismatch without mutation', async () => {
    const fixture = readWorkRunFixture();
    const cases: Array<{ name: string; overrides?: Parameters<typeof seedDriverLease>[1]; params: Record<string, unknown> }> = [
      {
        name: 'Project',
        params: { project: 'project/my-project', agent: 'worker', work_run_id: fixture.example.workRunId,
          work_run_state: 'leased', work_item_id: fixture.example.workItemId, transition_token: 'mismatch:project' },
      },
      {
        name: 'Work Item',
        params: { project: fixture.example.projectId, agent: 'worker', work_run_id: fixture.example.workRunId,
          work_run_state: 'leased', work_item_id: 'project/alpha/issue/other', transition_token: 'mismatch:item' },
      },
      {
        name: 'Work Item ownership',
        overrides: { workItemId: 'project/my-project/issue/build-index' },
        params: { project: fixture.example.projectId, agent: 'worker', work_run_id: fixture.example.workRunId,
          work_run_state: 'leased', work_item_id: 'project/my-project/issue/build-index', transition_token: 'mismatch:item-owner' },
      },
      {
        name: 'Work Run',
        params: { project: fixture.example.projectId, agent: 'worker', work_run_id: 'work-run/other-run',
          work_run_state: 'leased', work_item_id: fixture.example.workItemId, transition_token: 'mismatch:run' },
      },
      {
        name: 'agent',
        params: { project: fixture.example.projectId, agent: 'other-agent', work_run_id: fixture.example.workRunId,
          work_run_state: 'leased', work_item_id: fixture.example.workItemId, transition_token: 'mismatch:agent' },
      },
      {
        name: 'lease',
        overrides: { leaseAgentId: 'other-agent' },
        params: { project: fixture.example.projectId, agent: 'worker', work_run_id: fixture.example.workRunId,
          work_run_state: 'leased', work_item_id: fixture.example.workItemId, transition_token: 'mismatch:lease' },
      },
      {
        name: 'Lease expiry',
        overrides: { expiresAt: 1 },
        params: { project: fixture.example.projectId, agent: 'worker', work_run_id: fixture.example.workRunId,
          work_run_state: 'leased', work_item_id: fixture.example.workItemId, transition_token: 'mismatch:expired-lease' },
      },
    ];

    for (const mismatch of cases) {
      const { root, call } = makeHarness();
      try {
        const seeded = seedDriverLease(root, mismatch.overrides);
        const leaseBefore = readFileSync(seeded.leasePath, 'utf-8');
        const runBefore = readFileSync(seeded.runPath, 'utf-8');
        await assert.rejects(
          () => call('workflow.agent.join', mismatch.params),
          new RegExp(`${mismatch.name}.*conflict|identity conflict`, 'i'),
        );
        assert.equal(readFileSync(seeded.leasePath, 'utf-8'), leaseBefore);
        assert.equal(readFileSync(seeded.runPath, 'utf-8'), runBefore);
        assert.equal(existsSync(vp(root, '01-Projects/alpha/agents')), false);
        assert.equal(existsSync(vp(root, '01-Projects/my-project/agents')), false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  test('workflow.agent.join does not resurrect a durable run changed after identity assertion', async () => {
    const { root, call } = makeHarness();
    const fixture = readWorkRunFixture();
    try {
      const seeded = seedDriverLease(root);
      const provenance = ['work-driver:lease-acquired'];
      Object.defineProperty(provenance, 0, {
        enumerable: true,
        get() {
          const run = JSON.parse(readFileSync(seeded.runPath, 'utf-8')) as Record<string, unknown>;
          run.state = 'failed';
          writeFileSync(seeded.runPath, JSON.stringify(run, null, 2), 'utf-8');
          return 'work-driver:lease-acquired';
        },
      });

      await assert.rejects(
        () => call('workflow.agent.join', {
          project: fixture.example.projectId,
          agent: 'worker',
          work_run_id: fixture.example.workRunId,
          work_run_state: 'leased',
          work_item_id: fixture.example.workItemId,
          transition_token: 'join:concurrent-terminal',
          provenance,
        }),
        /Invalid Work Run transition: failed -> running/,
      );
      const durable = JSON.parse(readFileSync(seeded.runPath, 'utf-8')) as Record<string, unknown>;
      assert.equal(durable.state, 'failed');
      assert.equal(existsSync(vp(root, '01-Projects/alpha/agents')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('workflow.agent.join honors the Python and TypeScript shared mutation lock', async () => {
    const { root, call } = makeHarness();
    const fixture = readWorkRunFixture();
    try {
      const seeded = seedDriverLease(root);
      const lockPath = vp(root, '.vault-mind/_work-run.lock');
      writeFileSync(lockPath, 'python-owner', 'utf-8');
      const runBefore = readFileSync(seeded.runPath, 'utf-8');
      await assert.rejects(
        () => call('workflow.agent.join', {
          project: fixture.example.projectId,
          agent: 'worker',
          work_run_id: fixture.example.workRunId,
          work_run_state: 'leased',
          work_item_id: fixture.example.workItemId,
          transition_token: 'join:contended',
        }),
        /Work Run is busy with another runtime/,
      );
      assert.equal(readFileSync(lockPath, 'utf-8'), 'python-owner');
      assert.equal(readFileSync(seeded.runPath, 'utf-8'), runBefore);
      assert.equal(existsSync(vp(root, '01-Projects/alpha/agents')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('workflow mutation lock fails closed even when its timestamp is stale', async () => {
    const { root, call } = makeHarness();
    const fixture = readWorkRunFixture();
    try {
      const seeded = seedDriverLease(root);
      const lockPath = vp(root, '.vault-mind/_work-run.lock');
      writeFileSync(lockPath, 'unknown-stale-owner', 'utf-8');
      const old = new Date('2000-01-01T00:00:00.000Z');
      utimesSync(lockPath, old, old);
      const runBefore = readFileSync(seeded.runPath, 'utf-8');
      await assert.rejects(
        () => call('workflow.agent.join', {
          project: fixture.example.projectId,
          agent: 'worker',
          work_run_id: fixture.example.workRunId,
          work_item_id: fixture.example.workItemId,
          transition_token: 'join:stale-lock',
        }),
        /busy.*remove .*_work-run\.lock manually only after confirming no writer is active/i,
      );
      assert.equal(readFileSync(lockPath, 'utf-8'), 'unknown-stale-owner');
      assert.equal(readFileSync(seeded.runPath, 'utf-8'), runBefore);
      assert.equal(existsSync(vp(root, '01-Projects/alpha/agents')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('workflow.agent.join rejects machine-local provenance before durable writes', async () => {
    const { root, call } = makeHarness();
    const fixture = readWorkRunFixture();
    try {
      const seeded = seedDriverLease(root);
      const leaseBefore = readFileSync(seeded.leasePath, 'utf-8');
      const runBefore = readFileSync(seeded.runPath, 'utf-8');
      const forbidden = [
        'workspace:C:/private/worktree',
        'repo:/opt/private',
        'workspace:/mnt/c/worktree',
        'workspace=/opt/private',
        'file:///Users/me/repo',
        'workspace://C:/private',
        'repo://C:/checkout',
        'vscode://file/C:/repo',
        '~/repo',
        '../checkout',
        'lease_token=never-cross',
      ];
      for (const [index, provenance] of forbidden.entries()) {
        await assert.rejects(
          () => call('workflow.agent.join', {
            project: fixture.example.projectId,
            agent: 'worker',
            work_run_id: fixture.example.workRunId,
            work_run_state: 'leased',
            work_item_id: fixture.example.workItemId,
            transition_token: `join:local-provenance:${index}`,
            provenance: [provenance],
          }),
          /must not contain machine-local paths or lease tokens/,
          provenance,
        );
      }
      assert.equal(readFileSync(seeded.leasePath, 'utf-8'), leaseBefore);
      assert.equal(readFileSync(seeded.runPath, 'utf-8'), runBefore);
      assert.equal(existsSync(vp(root, '01-Projects/alpha/agents')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('workflow agent transitions reject machine-local provenance without mutation', async () => {
    const fixture = readWorkRunFixture();
    const cases = [
      { operation: 'workflow.agent.step', params: { stage: 'plan' } },
      { operation: 'workflow.agent.checkpoint', params: { status: 'passed', summary: 'checkpoint' } },
      { operation: 'workflow.agent.leave', params: { summary: 'leave' } },
    ];
    for (const item of cases) {
      const { root, call } = makeHarness();
      try {
        const seeded = seedDriverLease(root);
        await call('workflow.agent.join', {
          project: fixture.example.projectId,
          agent: 'worker',
          work_run_id: fixture.example.workRunId,
          work_run_state: 'leased',
          work_item_id: fixture.example.workItemId,
          transition_token: `join:${item.operation}`,
        });
        const lifetimePath = vp(root, '01-Projects/alpha/agents/worker/lifetime.md');
        const eventsPath = vp(root, '01-Projects/alpha/agents/worker/events.md');
        const before = {
          lifetime: readFileSync(lifetimePath, 'utf-8'),
          events: readFileSync(eventsPath, 'utf-8'),
          run: readFileSync(seeded.runPath, 'utf-8'),
        };
        await assert.rejects(
          () => call(item.operation, {
            project: fixture.example.projectId,
            agent: 'worker',
            work_run_id: fixture.example.workRunId,
            transition_token: `local-provenance:${item.operation}`,
            provenance: ['repo:/opt/private'],
            ...item.params,
          }),
          /must not contain machine-local paths or lease tokens/,
        );
        assert.equal(readFileSync(lifetimePath, 'utf-8'), before.lifetime);
        assert.equal(readFileSync(eventsPath, 'utf-8'), before.events);
        assert.equal(readFileSync(seeded.runPath, 'utf-8'), before.run);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  test('step rejects Work Item rewriting and durable identity or state drift byte-for-byte', async () => {
    const fixture = readWorkRunFixture();
    const cases = [
      {
        name: 'requested Work Item rewrite',
        mutate: (_run: Record<string, unknown>) => {},
        params: { work_item_id: 'project/alpha/issue/other' },
        expected: /Work Item identity conflict/,
      },
      {
        name: 'durable Work Item drift',
        mutate: (run: Record<string, unknown>) => { run.work_item_id = 'project/alpha/issue/other'; },
        params: {},
        expected: /Work Item identity conflict/,
      },
      {
        name: 'durable state drift',
        mutate: (run: Record<string, unknown>) => { run.state = 'awaiting_review'; },
        params: {},
        expected: /lifetime and durable run differ/,
      },
    ];
    for (const item of cases) {
      const { root, call } = makeHarness();
      try {
        const seeded = seedDriverLease(root);
        await call('workflow.agent.join', {
          project: fixture.example.projectId,
          agent: 'worker',
          work_run_id: fixture.example.workRunId,
          work_item_id: fixture.example.workItemId,
          transition_token: `join:drift:${item.name.replaceAll(' ', '-')}`,
        });
        const lifetimePath = vp(root, '01-Projects/alpha/agents/worker/lifetime.md');
        const eventsPath = vp(root, '01-Projects/alpha/agents/worker/events.md');
        const run = JSON.parse(readFileSync(seeded.runPath, 'utf-8')) as Record<string, unknown>;
        item.mutate(run);
        writeFileSync(seeded.runPath, JSON.stringify(run, null, 2) + '\n', 'utf-8');
        const before = {
          lifetime: readFileSync(lifetimePath, 'utf-8'),
          events: readFileSync(eventsPath, 'utf-8'),
          run: readFileSync(seeded.runPath, 'utf-8'),
        };
        await assert.rejects(
          () => call('workflow.agent.step', {
            project: fixture.example.projectId,
            agent: 'worker',
            work_run_id: fixture.example.workRunId,
            stage: 'plan',
            transition_token: `step:drift:${item.name.replaceAll(' ', '-')}`,
            ...item.params,
          }),
          item.expected,
        );
        assert.equal(readFileSync(lifetimePath, 'utf-8'), before.lifetime);
        assert.equal(readFileSync(eventsPath, 'utf-8'), before.events);
        assert.equal(readFileSync(seeded.runPath, 'utf-8'), before.run);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  test('checkpoint and leave reject durable drift byte-for-byte', async () => {
    const fixture = readWorkRunFixture();
    for (const operation of ['workflow.agent.checkpoint', 'workflow.agent.leave']) {
      const { root, call } = makeHarness();
      try {
        const seeded = seedDriverLease(root);
        await call('workflow.agent.join', {
          project: fixture.example.projectId,
          agent: 'worker',
          work_run_id: fixture.example.workRunId,
          work_item_id: fixture.example.workItemId,
          transition_token: `join:drift:${operation}`,
        });
        const lifetimePath = vp(root, '01-Projects/alpha/agents/worker/lifetime.md');
        const eventsPath = vp(root, '01-Projects/alpha/agents/worker/events.md');
        const run = JSON.parse(readFileSync(seeded.runPath, 'utf-8')) as Record<string, unknown>;
        run.agent_id = 'other-agent';
        writeFileSync(seeded.runPath, JSON.stringify(run, null, 2) + '\n', 'utf-8');
        const before = {
          lifetime: readFileSync(lifetimePath, 'utf-8'),
          events: readFileSync(eventsPath, 'utf-8'),
          run: readFileSync(seeded.runPath, 'utf-8'),
        };
        await assert.rejects(
          () => call(operation, {
            project: fixture.example.projectId,
            agent: 'worker',
            work_run_id: fixture.example.workRunId,
            transition_token: `drift:${operation}`,
            ...(operation.endsWith('checkpoint') ? { summary: 'checkpoint' } : { summary: 'leave' }),
          }),
          /agent identity conflict/,
        );
        assert.equal(readFileSync(lifetimePath, 'utf-8'), before.lifetime);
        assert.equal(readFileSync(eventsPath, 'utf-8'), before.events);
        assert.equal(readFileSync(seeded.runPath, 'utf-8'), before.run);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  test('all persisted workflow free-text fields reject machine paths and lease or handoff token material', async () => {
    const unsafe = 'workspace:C:/private/worktree';
    const topLevelCases: Array<{ operation: string; params: Record<string, unknown>; field: string }> = [
      { operation: 'workflow.state.set', params: { project: 'alpha', stage: 'plan' }, field: 'objective' },
      { operation: 'workflow.state.set', params: { project: 'alpha', stage: 'plan' }, field: 'branch' },
      { operation: 'workflow.state.set', params: { project: 'alpha', stage: 'plan' }, field: 'host' },
      { operation: 'workflow.state.set', params: { project: 'alpha', stage: 'plan' }, field: 'evidence' },
      { operation: 'workflow.state.set', params: { project: 'alpha', stage: 'plan' }, field: 'notes' },
      { operation: 'workflow.checkpoint.add', params: { project: 'alpha', stage: 'plan', summary: 'safe' }, field: 'summary' },
      { operation: 'workflow.checkpoint.add', params: { project: 'alpha', stage: 'plan', summary: 'safe' }, field: 'evidence' },
      { operation: 'workflow.checkpoint.add', params: { project: 'alpha', stage: 'plan', summary: 'safe' }, field: 'next' },
      { operation: 'workflow.agent.start', params: { project: 'alpha', agent: 'worker' }, field: 'role' },
      { operation: 'workflow.agent.start', params: { project: 'alpha', agent: 'worker' }, field: 'host' },
      { operation: 'workflow.agent.start', params: { project: 'alpha', agent: 'worker' }, field: 'objective' },
      { operation: 'workflow.agent.start', params: { project: 'alpha', agent: 'worker' }, field: 'issue' },
      { operation: 'workflow.agent.start', params: { project: 'alpha', agent: 'worker' }, field: 'evidence' },
      { operation: 'workflow.agent.start', params: { project: 'alpha', agent: 'worker' }, field: 'provenance' },
      { operation: 'workflow.agent.start', params: { project: 'alpha', agent: 'worker' }, field: 'notes' },
    ];
    for (const item of topLevelCases) {
      const { root, call } = makeHarness();
      try {
        const value = item.field === 'evidence' || item.field === 'provenance' ? [unsafe] : unsafe;
        await assert.rejects(
          () => call(item.operation, { ...item.params, [item.field]: value }),
          /machine-local paths or lease tokens\/handoff tokens/,
          `${item.operation}.${item.field}`,
        );
        assert.equal(existsSync(vp(root, '01-Projects/alpha')), false, `${item.operation}.${item.field}`);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }

    const fixture = readWorkRunFixture();
    const transitionCases: Array<{ operation: string; base: Record<string, unknown>; field: string; unsafe: string }> = [
      { operation: 'workflow.agent.step', base: { stage: 'plan' }, field: 'objective', unsafe },
      { operation: 'workflow.agent.step', base: { stage: 'plan' }, field: 'issue', unsafe },
      { operation: 'workflow.agent.step', base: { stage: 'plan' }, field: 'evidence', unsafe },
      { operation: 'workflow.agent.step', base: { stage: 'plan' }, field: 'provenance', unsafe },
      { operation: 'workflow.agent.step', base: { stage: 'plan' }, field: 'summary', unsafe },
      { operation: 'workflow.agent.step', base: { stage: 'plan' }, field: 'next', unsafe },
      { operation: 'workflow.agent.checkpoint', base: { summary: 'safe' }, field: 'summary', unsafe: 'handoff_token=secret-value' },
      { operation: 'workflow.agent.checkpoint', base: { summary: 'safe' }, field: 'evidence', unsafe },
      { operation: 'workflow.agent.checkpoint', base: { summary: 'safe' }, field: 'provenance', unsafe },
      { operation: 'workflow.agent.checkpoint', base: { summary: 'safe' }, field: 'next', unsafe },
      { operation: 'workflow.agent.leave', base: {}, field: 'summary', unsafe },
      { operation: 'workflow.agent.leave', base: {}, field: 'provenance', unsafe: 'lease_token=secret-value' },
    ];
    for (const item of transitionCases) {
      const { root, call } = makeHarness();
      try {
        const seeded = seedDriverLease(root);
        await call('workflow.agent.join', {
          project: fixture.example.projectId,
          agent: 'worker',
          work_run_id: fixture.example.workRunId,
          work_item_id: fixture.example.workItemId,
          transition_token: `join:leak-matrix:${item.operation.split('.').at(-1)}:${item.field}`,
        });
        const lifetimePath = vp(root, '01-Projects/alpha/agents/worker/lifetime.md');
        const eventsPath = vp(root, '01-Projects/alpha/agents/worker/events.md');
        const before = {
          lifetime: readFileSync(lifetimePath, 'utf-8'),
          events: readFileSync(eventsPath, 'utf-8'),
          run: readFileSync(seeded.runPath, 'utf-8'),
        };
        const value = item.field === 'evidence' || item.field === 'provenance' ? [item.unsafe] : item.unsafe;
        await assert.rejects(
          () => call(item.operation, {
            project: fixture.example.projectId,
            agent: 'worker',
            work_run_id: fixture.example.workRunId,
            transition_token: `leak-matrix:${item.operation.split('.').at(-1)}:${item.field}`,
            ...item.base,
            [item.field]: value,
          }),
          /machine-local paths or lease tokens\/handoff tokens/,
          `${item.operation}.${item.field}`,
        );
        assert.equal(readFileSync(lifetimePath, 'utf-8'), before.lifetime);
        assert.equal(readFileSync(eventsPath, 'utf-8'), before.events);
        assert.equal(readFileSync(seeded.runPath, 'utf-8'), before.run);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  test('workflow.agent.step enforces ordered lifetime stages and allows review rework', async () => {
    const { root, call } = makeHarness();
    try {
      await call('workflow.agent.start', { project: 'alpha', agent: 'worker', role: 'worker' });

      await assert.rejects(
        () => call('workflow.agent.step', { project: 'alpha', agent: 'worker', stage: 'build' }),
        /invalid agent stage transition: think -> build/,
      );

      await call('workflow.agent.step', { project: 'alpha', agent: 'worker', stage: 'plan', summary: 'plan ready' });
      await call('workflow.agent.step', { project: 'alpha', agent: 'worker', stage: 'build', summary: 'build started' });
      await call('workflow.agent.step', { project: 'alpha', agent: 'worker', stage: 'review', summary: 'ready for review' });
      const rework = (await call('workflow.agent.step', {
        project: 'alpha',
        agent: 'worker',
        stage: 'build',
        summary: 'review requested rework',
      })) as { lifetime: { stage: string; status: string } };

      assert.equal(rework.lifetime.stage, 'build');
      assert.equal(rework.lifetime.status, 'active');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('workflow.agent.step requires evidence to ship and reflect closes lifetime', async () => {
    const { root, call } = makeHarness();
    try {
      await call('workflow.agent.start', { project: 'alpha', agent: 'worker', role: 'worker' });
      await call('workflow.agent.step', { project: 'alpha', agent: 'worker', stage: 'plan' });
      await call('workflow.agent.step', { project: 'alpha', agent: 'worker', stage: 'build' });
    await call('workflow.agent.step', { project: 'alpha', agent: 'worker', stage: 'review' });

    await assert.rejects(
      () => call('workflow.agent.step', { project: 'alpha', agent: 'worker', stage: 'test' }),
      /test stage requires evidence matching: review:\*/,
    );

    await call('workflow.agent.step', {
      project: 'alpha',
      agent: 'worker',
      stage: 'test',
      evidence: ['review:passed'],
    });

    await assert.rejects(
      () => call('workflow.agent.step', { project: 'alpha', agent: 'worker', stage: 'ship' }),
      /ship stage requires evidence matching: test:\*/,
    );

    const shipped = (await call('workflow.agent.step', {
      project: 'alpha',
      agent: 'worker',
      stage: 'ship',
      evidence: ['test:workflow'],
    })) as { lifetime: { stage: string; evidence: string[] } };
    assert.equal(shipped.lifetime.stage, 'ship');
    assert.deepEqual(shipped.lifetime.evidence, ['review:passed', 'test:workflow']);

      const reflected = (await call('workflow.agent.step', {
        project: 'alpha',
        agent: 'worker',
        stage: 'reflect',
        summary: 'lifetime closed',
      })) as { lifetime: { stage: string; status: string } };
      assert.equal(reflected.lifetime.stage, 'reflect');
      assert.equal(reflected.lifetime.status, 'done');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('workflow.agent.start and doctor enforce stage evidence requirements', async () => {
  const { root, call } = makeHarness();
  try {
    await assert.rejects(
      () =>
        call('workflow.agent.start', {
          project: 'alpha',
          agent: 'worker',
          stage: 'ship',
          evidence: ['review:passed'],
        }),
      /ship stage requires evidence matching: test:\*/,
    );

    const agentDir = vp(root, '01-Projects/alpha/agents/worker');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, 'lifetime.md'),
      [
        '---',
        'type: agent-lifetime',
        'entity: project/alpha/agent/worker/lifetime',
        'project: alpha',
        'agent: worker',
        'role: "worker"',
        'host: "codex"',
        'stage: ship',
        'status: active',
        'objective: "ship without tests"',
        'issue: ""',
        'evidence: ["review:passed"]',
        'started-at: "2026-06-30T00:00:00.000Z"',
        'updated-at: "2026-06-30T00:00:00.000Z"',
        '---',
        '',
      ].join('\n'),
      'utf-8',
    );

    const doctor = (await call('workflow.agent.doctor', { project: 'alpha', agent: 'worker' })) as {
      ok: boolean;
      errors: string[];
    };
    assert.equal(doctor.ok, false);
    assert.deepEqual(doctor.errors, ['ship stage requires evidence matching: test:*']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('workflow.agent.checkpoint leave and doctor preserve lifetime evidence', async () => {
  const { root, call } = makeHarness();
  try {
      const missing = (await call('workflow.agent.doctor', { project: 'alpha', agent: 'worker' })) as {
        ok: boolean;
        missing: string[];
      };
      assert.equal(missing.ok, false);
      assert.deepEqual(missing.missing, ['01-Projects/alpha/agents/worker/lifetime.md']);

      await call('workflow.agent.start', { project: 'alpha', agent: 'worker', role: 'worker' });
      const checkpoint = (await call('workflow.agent.checkpoint', {
        project: 'alpha',
        agent: 'worker',
        status: 'passed',
        summary: 'local validation passed',
        evidence: ['npm:typecheck'],
      })) as { eventsPath: string; stage: string; status: string };
      assert.equal(checkpoint.stage, 'think');
      assert.equal(checkpoint.status, 'passed');

      const left = (await call('workflow.agent.leave', {
        project: 'alpha',
        agent: 'worker',
        summary: 'session ended',
      })) as { lifetime: { status: string } };
      assert.equal(left.lifetime.status, 'archived');

      const doctor = (await call('workflow.agent.doctor', { project: 'alpha', agent: 'worker' })) as {
        ok: boolean;
        warnings: string[];
        lifetime: { status: string };
      };
      assert.equal(doctor.ok, true);
      assert.deepEqual(doctor.warnings, []);
      assert.equal(doctor.lifetime.status, 'archived');

      const events = readFileSync(vp(root, checkpoint.eventsPath), 'utf-8');
      assert.match(events, /checkpoint:passed/);
      assert.match(events, /leave/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('Work Run terminal states reject steps and checkpoints', async () => {
    const { root, call } = makeHarness();
    try {
      await call('workflow.agent.start', {
        project: 'alpha',
        agent: 'worker',
        transition_token: 'join:terminal-contract',
      });
      await call('workflow.agent.step', { project: 'alpha', agent: 'worker', stage: 'plan', transition_token: 'step:plan' });
      await call('workflow.agent.step', { project: 'alpha', agent: 'worker', stage: 'build', transition_token: 'step:build' });
      await call('workflow.agent.step', { project: 'alpha', agent: 'worker', stage: 'review', transition_token: 'step:review' });
      await call('workflow.agent.step', {
        project: 'alpha',
        agent: 'worker',
        stage: 'test',
        evidence: ['review:passed'],
        transition_token: 'step:test',
      });
      await call('workflow.agent.step', {
        project: 'alpha',
        agent: 'worker',
        stage: 'ship',
        evidence: ['test:workflow'],
        transition_token: 'step:ship',
      });
      const completed = (await call('workflow.agent.step', {
        project: 'alpha',
        agent: 'worker',
        stage: 'reflect',
        transition_token: 'step:reflect',
      })) as { lifetime: { workRunState: string } };
      assert.equal(completed.lifetime.workRunState, 'completed');

      await assert.rejects(
        () => call('workflow.agent.checkpoint', {
          project: 'alpha',
          agent: 'worker',
          transition_token: 'checkpoint:after-completion',
          summary: 'must not append',
        }),
        /is terminal \(completed\)/,
      );
      await assert.rejects(
        () => call('workflow.agent.step', {
          project: 'alpha',
          agent: 'worker',
          stage: 'reflect',
          transition_token: 'step:after-completion',
        }),
        /is terminal \(completed\)/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('review-required outputs cannot complete without explicit approval', async () => {
    const { root, call } = makeHarness();
    try {
      await call('workflow.agent.start', {
        project: 'alpha',
        agent: 'worker',
        transition_token: 'join:review-contract',
        output_class: 'knowledge-claim',
      });
      await call('workflow.agent.step', { project: 'alpha', agent: 'worker', stage: 'plan', transition_token: 'review:plan' });
      await call('workflow.agent.step', { project: 'alpha', agent: 'worker', stage: 'build', transition_token: 'review:build' });
      await call('workflow.agent.step', { project: 'alpha', agent: 'worker', stage: 'review', transition_token: 'review:review' });
      await call('workflow.agent.step', {
        project: 'alpha',
        agent: 'worker',
        stage: 'test',
        evidence: ['review:passed'],
        transition_token: 'review:test',
      });
      await call('workflow.agent.step', {
        project: 'alpha',
        agent: 'worker',
        stage: 'ship',
        evidence: ['test:workflow'],
        transition_token: 'review:ship',
      });
      const pending = (await call('workflow.agent.step', {
        project: 'alpha',
        agent: 'worker',
        stage: 'reflect',
        transition_token: 'review:reflect',
      })) as { lifetime: { workRunState: string; outputClass: string; approvalStatus: string } };
      assert.deepEqual(
        [pending.lifetime.workRunState, pending.lifetime.outputClass, pending.lifetime.approvalStatus],
        ['awaiting_review', 'knowledge-claim', 'pending'],
      );

      await assert.rejects(
        () => call('workflow.agent.leave', {
          project: 'alpha',
          agent: 'worker',
          work_run_state: 'completed',
          transition_token: 'review:complete-without-approval',
        }),
        /requires approval before completion/,
      );
      const approved = (await call('workflow.agent.leave', {
        project: 'alpha',
        agent: 'worker',
        work_run_state: 'completed',
        approval_status: 'approved',
        transition_token: 'review:approved',
      })) as { lifetime: { workRunState: string; approvalStatus: string } };
      assert.deepEqual([approved.lifetime.workRunState, approved.lifetime.approvalStatus], ['completed', 'approved']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('an unapproved external side effect is denied and remains reviewable', async () => {
    const { root, call } = makeHarness();
    try {
      await call('workflow.agent.start', {
        project: 'alpha',
        agent: 'worker',
        transition_token: 'external:join',
      });
      const denied = (await call('workflow.agent.checkpoint', {
        project: 'alpha',
        agent: 'worker',
        transition_token: 'external:route',
        summary: 'push requested without approval',
        output_class: 'external-side-effect',
        approval_status: 'denied',
        work_run_state: 'awaiting_review',
      })) as { lifetime: { workRunState: string; outputClass: string; approvalStatus: string } };
      assert.deepEqual(
        [denied.lifetime.workRunState, denied.lifetime.outputClass, denied.lifetime.approvalStatus],
        ['awaiting_review', 'external-side-effect', 'denied'],
      );
      await assert.rejects(
        () => call('workflow.agent.leave', {
          project: 'alpha',
          agent: 'worker',
          transition_token: 'external:complete-denied',
          work_run_state: 'completed',
        }),
        /requires approval before completion/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
