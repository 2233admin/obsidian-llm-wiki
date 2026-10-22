import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWorkflowReadModel } from './workflow-read-model.js';

function seed(vault: string, id: string, updatedAt: string, state = 'running', agent = 'codex') {
  mkdirSync(join(vault, '01-Projects/alpha/runs'), { recursive: true });
  writeFileSync(join(vault, `01-Projects/alpha/runs/${id}.json`), JSON.stringify({ project_id: 'project/alpha', work_item_id: 'project/alpha/issue/build', work_run_id: `work-run/${id}`, agent_id: agent, state, updated_at: updatedAt }, null, 2), 'utf8');
}
function projectionFixture(): { vault: string; observedAt: number } {
  const vault = mkdtempSync(join(tmpdir(), 'llmwiki-workflow-projection-'));
  mkdirSync(join(vault, '01-Projects/alpha/runs/nested'), { recursive: true });
  mkdirSync(join(vault, '01-Projects/alpha/runs/output-runs'), { recursive: true });
  mkdirSync(join(vault, '01-Projects/alpha/runs/recovery-plans'), { recursive: true });
  mkdirSync(join(vault, '01-Projects/alpha/agents/agent-1'), { recursive: true });
  mkdirSync(join(vault, '01-Projects/alpha/workflow'), { recursive: true });
  const writeRun = (path: string, value: unknown): void => {
    const bytes = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
    writeFileSync(join(vault, path), bytes, 'utf8');
  };
  writeRun('01-Projects/alpha/runs/run-1.json', {
    projectId: 'project/alpha',
    workRunId: 'work-run/run-1',
    workItemId: 'project/alpha/issue/task-1',
    agentId: 'agent-1',
    state: 'running',
    stage: 'execute',
    updatedAt: '2026-09-01T10:00:00.000Z',
    leaseExpiresAt: '2026-09-01T11:00:00.000Z',
  });
  writeRun('01-Projects/alpha/runs/run-2.json', {
    project_id: 'project/alpha',
    work_run_id: 'work-run/run-2',
    work_item_id: 'project/alpha/issue/task-2',
    agent_id: 'agent-1',
    state: 'awaiting_review',
    agentStage: 'review',
    updated_at: '2026-09-01T10:00:00.000Z',
    handoff_expires_at: '2026-09-01T09:00:00.000Z',
  });
  writeRun('01-Projects/alpha/runs/run-4.json', {
    project_id: 'project/alpha',
    work_run_id: 'work-run/run-4',
    work_item_id: 'project/alpha/issue/task-4',
    agent_id: 'agent-1',
    state: 'planned',
    updated_at: '2026-09-01T10:00:00.000Z',
    lease_expires_at: '2026-09-01T12:00:00.000Z',
  });
  writeRun('01-Projects/alpha/runs/run-5.json', {
    project_id: 'project/alpha',
    work_run_id: 'work-run/run-5',
    work_item_id: 'project/alpha/issue/task-5',
    agent_id: 'agent-1',
    state: 'awaiting_review',
    updated_at: '2026-09-01T09:00:00.000Z',
    lease_expires_at: '2026-09-01T09:30:00.000Z',
  });
  writeRun('01-Projects/alpha/runs/missing-project.json', {
    work_run_id: 'work-run/missing-project',
    work_item_id: 'project/alpha/issue/task-missing',
    agent_id: 'agent-1',
    state: 'running',
    updated_at: '2026-09-01T07:30:00.000Z',
  });
  writeRun('01-Projects/alpha/runs/malformed.json', '{not-json');
  writeRun('01-Projects/alpha/runs/conflict.json', {
    project_id: 'project/alpha',
    work_run_id: 'work-run/conflict',
    work_item_id: 'project/alpha/issue/task-3',
    agent_id: 'agent-1',
    state: 'completed',
    updated_at: '2026-09-01T08:00:00.000Z',
    leaseExpiresAt: '2026-09-01T13:00:00.000Z',
    lease_expires_at: '2026-09-01T14:00:00.000Z',
  });
  writeRun('01-Projects/alpha/runs/invalid-id.json', {
    project_id: 'project/alpha',
    work_run_id: 'not-a-work-run',
    work_item_id: 'project/alpha/not-an-issue',
    agent_id: 'agent-1',
    state: 'running',
    updated_at: '2026-09-01T08:30:00.000Z',
  });
  writeRun('01-Projects/alpha/runs/mismatch.json', {
    project_id: 'project/beta',
    work_run_id: 'work-run/mismatch',
    work_item_id: 'project/beta/issue/task-4',
    agent_id: 'agent-1',
    state: 'running',
    updated_at: '2026-09-01T07:00:00.000Z',
  });
  writeRun('01-Projects/alpha/runs/invalid-expiry.json', {
    project_id: 'project/alpha',
    work_run_id: 'work-run/invalid-expiry',
    work_item_id: 'project/alpha/issue/task-5',
    agent_id: 'agent-1',
    state: 'completed',
    updated_at: '2026-09-01T06:00:00.000Z',
    expires_at: 'not-a-timestamp',
  });
  writeRun('01-Projects/alpha/runs/nested/run-3.json', {
    project_id: 'project/alpha',
    work_run_id: 'work-run/run-3',
    work_item_id: 'project/alpha/issue/task-6',
    agent_id: 'agent-1',
    state: 'completed',
    updated_at: '2026-09-01T05:00:00.000Z',
  });
  writeRun('01-Projects/alpha/runs/output-runs/ignored.json', {
    project_id: 'project/alpha',
    work_run_id: 'work-run/ignored-output',
    work_item_id: 'project/alpha/issue/ignored',
    agent_id: 'agent-1',
    state: 'running',
  });
  writeRun('01-Projects/alpha/runs/recovery-plans/ignored.json', {
    project_id: 'project/alpha',
    work_run_id: 'work-run/ignored-recovery',
    work_item_id: 'project/alpha/issue/ignored',
    agent_id: 'agent-1',
    state: 'running',
  });
  writeFileSync(join(vault, '01-Projects/alpha/agents/agent-1/events.md'), '## 2026-09-01T10:01:00.000Z - step - agent-1\n', 'utf8');
  writeFileSync(join(vault, '01-Projects/alpha/workflow/status.md'), [
    '---',
    'type: workflow-state',
    'project: alpha',
    'stage: execute',
    'objective: Ship the read projection',
    '---',
    '',
    '# Workflow State: alpha',
  ].join('\n'), 'utf8');
  return { vault, observedAt: Date.parse('2026-09-01T10:30:00.000Z') };
}

test('Workflow read model reads safe runs, deterministic order, and matching checkpoints', () => {
  const vault = mkdtempSync(join(tmpdir(), 'llmwiki-workflow-read-'));
  try {
    seed(vault, 'older', '2026-08-28T00:00:00.000Z');
    seed(vault, 'newer', '2026-08-28T01:00:00.000Z');
    mkdirSync(join(vault, '01-Projects/alpha/agents/codex'), { recursive: true });
    writeFileSync(join(vault, '01-Projects/alpha/agents/codex/events.md'), [
      '## 2026-08-28T01:02:00.000Z - checkpoint:passed - codex', '',
      '- stage: build', '- status: passed', '- work-run-id: work-run/newer', '- transition-token: secret-token', '- summary: retained checkpoint', '- evidence:', '  - test:unit', '',
      '## 2026-08-28T01:01:00.000Z - step - codex', '',
      '- work-run-id: work-run/older', '- summary: not a checkpoint', '',
    ].join('\n'), 'utf8');
    writeFileSync(join(vault, '01-Projects/alpha/runs/broken.json'), '{not-json', 'utf8');
    writeFileSync(join(vault, '01-Projects/alpha/runs/foreign.json'), JSON.stringify({ project_id: 'project/other', work_item_id: 'project/other/issue/build', work_run_id: 'work-run/foreign', agent_id: 'codex', state: 'running', updated_at: '2026-08-28T02:00:00.000Z' }), 'utf8');
    const model = createWorkflowReadModel(vault);
    const runs = model.listRuns('project/alpha');
    assert.deepEqual(runs.map((run) => run.workRunId), ['work-run/newer', 'work-run/older', 'work-run/broken', 'work-run/foreign']);
    assert.equal(runs[2]?.malformed, true);
    assert.equal(runs[3]?.malformed, true);
    const checkpoints = model.listCheckpoints('project/alpha', 'work-run/newer');
    assert.equal(checkpoints.length, 1);
    assert.equal(checkpoints[0]?.summary, 'retained checkpoint');
    assert.deepEqual(checkpoints[0]?.citationTargets, ['test:unit']);
    assert.doesNotMatch(JSON.stringify(checkpoints), /secret-token|events\.md/u);
    const fingerprint = model.checkpointSetFingerprint('project/alpha', 'work-run/newer');
    assert.equal(fingerprint, model.checkpointSetFingerprint('project/alpha', 'work-run/newer'));
    const before = readdirSync(join(vault, '01-Projects/alpha/agents/codex')).sort();
    model.readRun('project/alpha', 'work-run/newer');
    assert.deepEqual(readdirSync(join(vault, '01-Projects/alpha/agents/codex')).sort(), before);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('Workflow read model excludes mismatched work items and expired runs from open candidates', () => {
  const vault = mkdtempSync(join(tmpdir(), 'llmwiki-workflow-read-mismatch-'));
  try {
    mkdirSync(join(vault, '01-Projects/alpha/runs'), { recursive: true });
    writeFileSync(join(vault, '01-Projects/alpha/runs/mismatch.json'), JSON.stringify({ project_id: 'project/alpha', work_item_id: 'project/beta/issue/build', work_run_id: 'work-run/mismatch', agent_id: 'codex', state: 'running', updated_at: '2026-08-28T00:00:00.000Z' }), 'utf8');
    writeFileSync(join(vault, '01-Projects/alpha/runs/expired.json'), JSON.stringify({ project_id: 'project/alpha', work_item_id: 'project/alpha/issue/build', work_run_id: 'work-run/expired', agent_id: 'codex', state: 'running', lease_expires_at: '2026-08-27T00:00:00.000Z', updated_at: '2026-08-28T00:00:00.000Z' }), 'utf8');
    const model = createWorkflowReadModel(vault);
    assert.equal(model.readRun('project/alpha', 'work-run/mismatch')?.malformed, true);
    assert.equal(model.readRun('project/alpha', 'work-run/expired')?.leaseExpiresAt, '2026-08-27T00:00:00.000Z');
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});
test('Workflow read projection contract normalizes aliases, diagnostics, discovery, and expiry', () => {
  const { vault, observedAt } = projectionFixture();
  try {
    const model = createWorkflowReadModel(vault);
    const projection = model.readRuntimeProjection('project/alpha', observedAt);
    assert.deepEqual(projection.activeRuns.map((run) => ({
      projectId: run.projectId,
      workRunId: run.workRunId,
      workItemId: run.workItemId,
      state: run.state,
      stage: run.stage,
      resumable: run.resumable,
      path: run.path,
      stale: run.stale,
      citationTargets: run.citationTargets,
    })), [
      {
        projectId: 'project/alpha',
        workRunId: null,
        workItemId: null,
        state: 'running',
        stage: null,
        resumable: false,
        path: '01-Projects/alpha/runs/invalid-id.json',
        stale: false,
        citationTargets: ['01-Projects/alpha/runs/invalid-id.json'],
      },
      {
        projectId: 'project/alpha',
        workRunId: 'work-run/run-1',
        workItemId: 'project/alpha/issue/task-1',
        state: 'running',
        stage: 'execute',
        resumable: true,
        path: '01-Projects/alpha/runs/run-1.json',
        stale: false,
        citationTargets: ['01-Projects/alpha/runs/run-1.json'],
      },
      {
        projectId: 'project/alpha',
        workRunId: 'work-run/run-4',
        workItemId: 'project/alpha/issue/task-4',
        state: 'planned',
        stage: null,
        resumable: true,
        path: '01-Projects/alpha/runs/run-4.json',
        stale: false,
        citationTargets: ['01-Projects/alpha/runs/run-4.json'],
      },
    ]);
    assert.deepEqual(projection.staleRuns.map((run) => run.workRunId), ['work-run/run-2', 'work-run/run-5']);
    assert.equal(projection.staleRuns[0]?.stage, 'review');
    assert.equal(projection.staleRuns[0]?.resumable, true);
    const invalidId = [...projection.activeRuns, ...projection.staleRuns].find((run) => run.path.endsWith('/invalid-id.json'));
    assert.deepEqual(invalidId, {
      projectId: 'project/alpha',
      workRunId: null,
      workItemId: null,
      state: 'running',
      stage: null,
      resumable: false,
      path: '01-Projects/alpha/runs/invalid-id.json',
      stale: false,
      citationTargets: ['01-Projects/alpha/runs/invalid-id.json'],
    });
    assert.equal(projection.runCount, 8);
    assert.deepEqual(projection.workflowState, {
      stage: 'execute',
      objective: 'Ship the read projection',
      path: '01-Projects/alpha/workflow/status.md',
    });
    assert.equal(projection.stage, 'execute');
    assert.equal(projection.stageCitation, '01-Projects/alpha/workflow/status.md');
    assert.deepEqual(projection.agentStateFiles, ['01-Projects/alpha/agents/agent-1/events.md']);
    assert.deepEqual(projection.sourceFiles, [
      '01-Projects/alpha/agents/agent-1/events.md',
      '01-Projects/alpha/runs/conflict.json',
      '01-Projects/alpha/runs/invalid-expiry.json',
      '01-Projects/alpha/runs/invalid-id.json',
      '01-Projects/alpha/runs/malformed.json',
      '01-Projects/alpha/runs/mismatch.json',
      '01-Projects/alpha/runs/missing-project.json',
      '01-Projects/alpha/runs/nested/run-3.json',
      '01-Projects/alpha/runs/run-1.json',
      '01-Projects/alpha/runs/run-2.json',
      '01-Projects/alpha/runs/run-4.json',
      '01-Projects/alpha/runs/run-5.json',
      '01-Projects/alpha/workflow/status.md',
    ]);
    assert.deepEqual(projection.drift, [
      'run_expiry_conflict:01-Projects/alpha/runs/conflict.json',
      'run_expiry_invalid:01-Projects/alpha/runs/invalid-expiry.json',
      'run_work_id_invalid:01-Projects/alpha/runs/invalid-id.json',
      'run_work_item_id_invalid:01-Projects/alpha/runs/invalid-id.json',
      'malformed_run:01-Projects/alpha/runs/malformed.json',
      'run_project_mismatch:01-Projects/alpha/runs/mismatch.json',
      'run_project_id_missing:01-Projects/alpha/runs/missing-project.json',
      'run_noncanonical_path:01-Projects/alpha/runs/nested/run-3.json',
      'expired_work_run:01-Projects/alpha/runs/run-2.json',
      'expired_work_run:01-Projects/alpha/runs/run-5.json',
    ]);
    assert.doesNotMatch(JSON.stringify(projection), /ignored-(?:output|recovery)|output-runs|recovery-plans/u);
    const later = model.readRuntimeProjection('project/alpha', Date.parse('2026-09-01T11:00:00.000Z'));
    const repeated = model.readRuntimeProjection('project/alpha', observedAt);
    assert.notEqual(repeated, projection);
    assert.deepEqual(repeated, projection);
    assert.deepEqual(later.activeRuns.map((run) => run.workRunId), [null, 'work-run/run-4']);
    assert.deepEqual(later.staleRuns.map((run) => run.workRunId), ['work-run/run-1', 'work-run/run-2', 'work-run/run-5']);
    assert.notEqual(later, projection);
    assert.notEqual(later.activeRuns, projection.activeRuns);
    const mutableRun = projection.activeRuns[0] as unknown as { stage: string | null; citationTargets: string[] };
    mutableRun.stage = 'tampered';
    mutableRun.citationTargets.push('tampered');
    const mutableAgentStateFiles = projection.agentStateFiles as unknown as string[];
    mutableAgentStateFiles.push('tampered');
    const isolated = model.readRuntimeProjection('project/alpha', observedAt);
    assert.deepEqual(isolated, repeated);
    assert.equal(isolated.activeRuns.find((run) => run.path.endsWith('/run-1.json'))?.stage, 'execute');
    assert.deepEqual(isolated.activeRuns.find((run) => run.path.endsWith('/run-1.json'))?.citationTargets, ['01-Projects/alpha/runs/run-1.json']);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});
test('Workflow runtime projection preserves protocol whitespace for classification and output', () => {
  const vault = mkdtempSync(join(tmpdir(), 'llmwiki-workflow-projection-protocol-'));
  try {
    mkdirSync(join(vault, '01-Projects/alpha/runs'), { recursive: true });
    writeFileSync(join(vault, '01-Projects/alpha/runs/active.json'), JSON.stringify({
      projectId: 'project/alpha',
      workRunId: 'work-run/active',
      workItemId: 'project/alpha/issue/active',
      state: 'planned',
      stage: ' execute ',
      leaseExpiresAt: '2026-09-01T11:00:00.000Z',
    }), 'utf8');
    writeFileSync(join(vault, '01-Projects/alpha/runs/padded.json'), JSON.stringify({
      projectId: 'project/alpha',
      workRunId: 'work-run/padded',
      workItemId: 'project/alpha/issue/padded',
      state: ' running ',
      stage: 'resume',
    }), 'utf8');
    const projection = createWorkflowReadModel(vault).readRuntimeProjection(
      'project/alpha',
      Date.parse('2026-09-01T10:30:00.000Z'),
    );
    assert.deepEqual(projection.activeRuns.map((run) => ({ state: run.state, stage: run.stage })), [
      { state: 'planned', stage: ' execute ' },
    ]);
    assert.equal(projection.stage, ' execute ');
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});
test('Workflow runtime projection does not cite a directory as workflow status', () => {
  const vault = mkdtempSync(join(tmpdir(), 'llmwiki-workflow-projection-status-dir-'));
  try {
    mkdirSync(join(vault, '01-Projects/alpha/workflow/status.md'), { recursive: true });
    const projection = createWorkflowReadModel(vault).readRuntimeProjection('project/alpha', 0);
    assert.ok(projection.drift.includes('malformed_workflow_state'));
    assert.equal(projection.sourceFiles.includes('01-Projects/alpha/workflow/status.md'), false);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('Workflow projection resolves ID aliases, sanitizes unsafe fields, and falls back from malformed status', () => {
  const vault = mkdtempSync(join(tmpdir(), 'llmwiki-workflow-projection-safety-'));
  try {
    mkdirSync(join(vault, '01-Projects/alpha/runs'), { recursive: true });
    mkdirSync(join(vault, '01-Projects/alpha/workflow'), { recursive: true });
    const writeRun = (name: string, value: Record<string, unknown>): void => {
      writeFileSync(join(vault, `01-Projects/alpha/runs/${name}.json`), JSON.stringify(value), 'utf8');
    };
    const base = {
      projectId: 'project/alpha',
      workRunId: 'work-run/alias',
      workItemId: 'project/alpha/issue/alias',
      agentId: 'agent-1',
      state: 'running',
      stage: 'build',
      updatedAt: '2026-09-01T10:00:00.000Z',
    };
    writeRun('alias-equal', {
      ...base,
      project_id: 'project/alpha',
      work_run_id: 'work-run/alias',
      work_item_id: 'project/alpha/issue/alias',
    });
    writeRun('project-conflict', { ...base, project_id: 'project/beta' });
    writeRun('run-conflict', { ...base, work_run_id: 'work-run/other' });
    writeRun('item-conflict', { ...base, work_item_id: 'project/alpha/issue/other' });
    writeRun('unsafe', { ...base, stage: 'token: leaked' });
    writeFileSync(join(vault, '01-Projects/alpha/workflow/status.md'), [
      'type: workflow-state',
      'project: alpha',
      'stage: invalid',
      'objective: raw prompt body',
      '---',
    ].join('\n'), 'utf8');

    const model = createWorkflowReadModel(vault);
    const projection = model.readRuntimeProjection(
      'project/alpha',
      Date.parse('2026-09-01T10:30:00.000Z'),
    );
    const equal = projection.activeRuns.find((run) => run.path.endsWith('/alias-equal.json'));
    assert.deepEqual(
      { workRunId: equal?.workRunId, workItemId: equal?.workItemId, resumable: equal?.resumable },
      { workRunId: 'work-run/alias', workItemId: 'project/alpha/issue/alias', resumable: true },
    );
    assert.equal(projection.activeRuns.find((run) => run.path.endsWith('/run-conflict.json'))?.workRunId, null);
    assert.equal(projection.activeRuns.find((run) => run.path.endsWith('/item-conflict.json'))?.workItemId, null);
    assert.equal(projection.activeRuns.find((run) => run.path.endsWith('/unsafe.json'))?.stage, null);
    assert.equal(projection.workflowState, null);
    assert.equal(projection.stage, 'build');
    assert.equal(projection.stageCitation, '01-Projects/alpha/runs/alias-equal.json');
    assert.equal(projection.runCount, 4);
    assert.ok(projection.drift.includes('malformed_workflow_state'));
    assert.ok(projection.drift.includes('run_projectId_conflict:01-Projects/alpha/runs/project-conflict.json'));
    assert.ok(projection.drift.includes('run_project_id_missing:01-Projects/alpha/runs/project-conflict.json'));
    assert.ok(projection.drift.includes('run_workRunId_conflict:01-Projects/alpha/runs/run-conflict.json'));
    assert.ok(projection.drift.includes('run_work_id_invalid:01-Projects/alpha/runs/run-conflict.json'));
    assert.ok(projection.drift.includes('run_workItemId_conflict:01-Projects/alpha/runs/item-conflict.json'));
    assert.ok(projection.drift.includes('run_work_item_id_invalid:01-Projects/alpha/runs/item-conflict.json'));
    assert.doesNotMatch(JSON.stringify(projection), /raw prompt body|token: leaked/u);
    writeFileSync(join(vault, '01-Projects/alpha/workflow/status.md'), [
      '---',
      'type: workflow-state',
      'project: alpha',
      'stage: execute',
      'objective: raw prompt body',
      '---',
    ].join('\n'), 'utf8');
    const sanitized = model.readRuntimeProjection('project/alpha', Date.parse('2026-09-01T10:30:00.000Z'));
    assert.deepEqual(sanitized.workflowState, {
      stage: 'execute',
      objective: '',
      path: '01-Projects/alpha/workflow/status.md',
    });
    assert.doesNotMatch(JSON.stringify(sanitized), /raw prompt body/u);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});
