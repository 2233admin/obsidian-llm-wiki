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
