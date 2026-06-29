import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { makeWorkflowOps } from './workflow.js';
import type { Operation, OperationContext } from '../core/types.js';

function makeHarness() {
  const root = join(tmpdir(), `llmwiki-workflow-${randomUUID()}`);
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

describe('agent project workflow operations', () => {
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
      await call('workflow.agent.step', { project: 'alpha', agent: 'worker', stage: 'test' });

      await assert.rejects(
        () => call('workflow.agent.step', { project: 'alpha', agent: 'worker', stage: 'ship' }),
        /ship stage requires evidence/,
      );

      const shipped = (await call('workflow.agent.step', {
        project: 'alpha',
        agent: 'worker',
        stage: 'ship',
        evidence: ['test:workflow', 'review:passed'],
      })) as { lifetime: { stage: string; evidence: string[] } };
      assert.equal(shipped.lifetime.stage, 'ship');
      assert.deepEqual(shipped.lifetime.evidence, ['test:workflow', 'review:passed']);

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
});