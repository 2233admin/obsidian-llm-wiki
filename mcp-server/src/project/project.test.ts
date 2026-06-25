import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { makeProjectOps } from './project.js';
import type { Operation, OperationContext } from '../core/types.js';

function makeHarness() {
  const root = join(tmpdir(), `llmwiki-project-${randomUUID()}`);
  const ops = makeProjectOps(root);
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

describe('local project management operations', () => {
  test('project.init seeds docket board rhizome and project index', async () => {
    const { root, call } = makeHarness();
    try {
      const result = (await call('project.init', { project: 'alpha' })) as { root: string; files: string[] };
      assert.equal(result.root, '10-Projects/alpha');
      assert.ok(result.files.includes('10-Projects/alpha/project.md'));
      assert.ok(existsSync(join(root, '10-Projects/alpha/project.md')));
      assert.ok(existsSync(join(root, '10-Projects/alpha/docket/board.md')));
      assert.ok(existsSync(join(root, '10-Projects/alpha/docket/rhizome.md')));
      const board = readFileSync(join(root, '10-Projects/alpha/docket/board.md'), 'utf-8');
      assert.ok(board.includes('kanban-plugin: board'));
      assert.ok(board.includes('## In Progress'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('issue lifecycle creates lists updates and regenerates board', async () => {
    const { root, call } = makeHarness();
    try {
      await call('project.init', { project: 'alpha' });
      const created = (await call('project.issue.create', {
        project: 'alpha',
        title: 'Build local Linear',
        summary: 'Markdown issue tracker',
        status: 'todo',
        priority: 'high',
        tags: ['docket', 'linear'],
      })) as { id: string; path: string };
      assert.equal(created.id, 'ISSUE-1');
      assert.equal(created.path, '10-Projects/alpha/docket/issues/ISSUE-1.md');

      const listed = (await call('project.issue.list', { project: 'alpha', status: 'todo' })) as { count: number };
      assert.equal(listed.count, 1);

      await call('project.issue.update', {
        project: 'alpha',
        id: created.id,
        status: 'started',
        assignee: 'claude',
      });

      const got = (await call('project.issue.get', { project: 'alpha', id: created.id })) as {
        issue: { status: string; assignee: string };
      };
      assert.equal(got.issue.status, 'In Progress');
      assert.equal(got.issue.assignee, 'claude');

      const board = (await call('project.board.get', { project: 'alpha' })) as { content: string };
      assert.ok(board.content.includes('## In Progress'));
      assert.ok(board.content.includes('ISSUE-1 Build local Linear'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('issue.link writes rhizome relationship and issue link section', async () => {
    const { root, call } = makeHarness();
    try {
      await call('project.init', { project: 'alpha' });
      const first = (await call('project.issue.create', { project: 'alpha', title: 'First issue' })) as { id: string };
      const second = (await call('project.issue.create', { project: 'alpha', title: 'Second issue' })) as { id: string };
      await call('project.issue.link', {
        project: 'alpha',
        id: first.id,
        relation: 'blocks',
        target: second.id,
      });
      const issue = readFileSync(join(root, '10-Projects/alpha/docket/issues/ISSUE-1.md'), 'utf-8');
      const rhizome = readFileSync(join(root, '10-Projects/alpha/docket/rhizome.md'), 'utf-8');
      assert.ok(issue.includes('- blocks: ISSUE-2'));
      assert.ok(rhizome.includes('- ISSUE-1 blocks ISSUE-2'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
