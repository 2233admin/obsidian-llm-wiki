import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { isWorkRunTransitionAllowed, makeWorkflowOps, WORK_RUN_STATES, type WorkRunState } from './workflow.js';
import type { Operation, OperationContext } from '../core/types.js';

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
  return { root, call };
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

function readWorkRunFixture(): WorkRunContractFixture {
  return JSON.parse(
    readFileSync(new URL('../../../tests/fixtures/work-run-contract.json', import.meta.url), 'utf-8'),
  ) as WorkRunContractFixture;
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
        evidence: ['repo:C:/tmp/lazycodex', 'test:workflow'],
        notes: 'Keep vault as source of truth.',
      })) as { path: string; state: { project: string; stage: string; evidence: string[] }; projectInitialized: boolean };

      assert.equal(result.path, '01-Projects/my-project/workflow/status.md');
      assert.equal(result.state.project, 'my-project');
      assert.equal(result.state.stage, 'plan');
      assert.deepEqual(result.state.evidence, ['repo:C:/tmp/lazycodex', 'test:workflow']);
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

  test('workflow.agent.join creates lifetime state and event log', async () => {
    const { root, call } = makeHarness();
    try {
      const result = (await call('workflow.agent.join', {
        project: 'Alpha Project',
        agent: 'Codex Worker',
        role: 'worker',
        host: 'codex',
        objective: 'Build agent lifetime contract',
        issue: 'agent-lifetime',
      })) as { path: string; eventsPath: string; lifetime: { project: string; agent: string; stage: string; status: string } };

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
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('workflow.agent.join attaches the Work Driver identity and transition tokens are idempotent', async () => {
    const { root, call } = makeHarness();
    const fixture = readWorkRunFixture();
    try {
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
      assert.equal(checkpointedRun.transitions.length, 1);

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

  test('workflow.agent.step enforces ordered lifetime stages and allows review rework', async () => {
    const { root, call } = makeHarness();
    try {
      await call('workflow.agent.join', { project: 'alpha', agent: 'worker', role: 'worker' });

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
      await call('workflow.agent.join', { project: 'alpha', agent: 'worker', role: 'worker' });
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

test('workflow.agent.join and doctor enforce stage evidence requirements', async () => {
  const { root, call } = makeHarness();
  try {
    await assert.rejects(
      () =>
        call('workflow.agent.join', {
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

      await call('workflow.agent.join', { project: 'alpha', agent: 'worker', role: 'worker' });
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
      await call('workflow.agent.join', {
        project: 'alpha',
        agent: 'worker',
        work_run_id: 'work-run/terminal-contract',
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
      await call('workflow.agent.join', {
        project: 'alpha',
        agent: 'worker',
        work_run_id: 'work-run/review-contract',
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
      await call('workflow.agent.join', {
        project: 'alpha',
        agent: 'worker',
        work_run_id: 'work-run/external-policy',
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
