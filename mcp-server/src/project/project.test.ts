import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
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

function vp(root: string, rel: string): string {
  return join(root, ...rel.split('/'));
}

describe('work-OS project management operations', () => {
  test('project.init creates a work-OS project anchor (no docket store)', async () => {
    const { root, call } = makeHarness();
    try {
      const result = (await call('project.init', { project: 'alpha' })) as { root: string; projectNote: string };
      assert.equal(result.root, '01-Projects/alpha');
      assert.equal(result.projectNote, '01-Projects/alpha/_project.md');
      assert.ok(existsSync(vp(root, '01-Projects/alpha/_project.md')));
      // issues dir is created, but NO docket store.
      assert.ok(existsSync(vp(root, '01-Projects/alpha/issues')));
      assert.equal(existsSync(vp(root, '10-Projects/alpha/docket')), false);
      assert.equal(existsSync(vp(root, '01-Projects/alpha/docket')), false);

      const note = readFileSync(vp(root, '01-Projects/alpha/_project.md'), 'utf-8');
      assert.match(note, /type: project/);
      assert.match(note, /entity: project\/alpha/);
      assert.match(note, /kind: knowledge-task/);
      assert.match(note, /id: alpha\/project/);
      assert.match(note, /status: active/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('project.init validates an existing anchor before creating the registry record', async () => {
    const { root, call } = makeHarness();
    try {
      mkdirSync(vp(root, '01-Projects/alpha'), { recursive: true });
      writeFileSync(
        vp(root, '01-Projects/alpha/_project.md'),
        '---\ntype: project\nentity: project/different\n---\n',
        'utf-8',
      );

      await assert.rejects(
        () => call('project.init', { project: 'alpha' }),
        /Existing Work-OS anchor disagrees/,
      );
      assert.equal(existsSync(vp(root, 'Projects/alpha.md')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('issue lifecycle: create, list, update, board (work-OS notes)', async () => {
    const { root, call } = makeHarness();
    try {
      await call('project.init', { project: 'alpha' });
      const created = (await call('project.issue.create', {
        project: 'alpha',
        title: 'Build local Linear',
        summary: 'Markdown issue tracker',
        state: 'todo',
        priority: 2,
      })) as { entity: string; id: string; slug: string; path: string };
      assert.equal(created.slug, 'build-local-linear');
      assert.equal(created.entity, 'project/alpha/issue/build-local-linear');
      assert.equal(created.id, 'alpha/build-local-linear');
      assert.equal(created.path, '01-Projects/alpha/issues/build-local-linear.md');

      // frontmatter is rhizome-compliant work-OS shape.
      const note = readFileSync(vp(root, '01-Projects/alpha/issues/build-local-linear.md'), 'utf-8');
      assert.match(note, /type: issue/);
      assert.match(note, /entity: project\/alpha\/issue\/build-local-linear/);
      assert.match(note, /state: todo/);
      assert.match(note, /review: reviewed/);
      assert.match(note, /kind: knowledge-task/);
      assert.match(note, /id: alpha\/build-local-linear/);
      assert.match(note, /status: active/);
      assert.match(note, /priority: 2/);

      const listed = (await call('project.issue.list', { project: 'alpha', state: 'todo' })) as { count: number };
      assert.equal(listed.count, 1);

      await call('project.issue.update', {
        project: 'alpha',
        slug: created.slug,
        state: 'in-progress',
        assignee: 'claude',
      });

      const got = (await call('project.issue.get', { project: 'alpha', slug: created.slug })) as {
        issue: { state: string; assignee: string };
      };
      assert.equal(got.issue.state, 'in-progress');
      assert.equal(got.issue.assignee, 'claude');

      const board = (await call('project.board.get', { project: 'alpha', lang: 'en' })) as { content: string };
      assert.ok(board.content.includes('## In Progress'));
      // card label is the body/description first line, NOT an ISSUE-N id.
      assert.ok(board.content.includes('- [ ] Build local Linear'));
      assert.ok(!board.content.includes('ISSUE-1'));
      // obsidian-kanban exact format markers.
      assert.ok(board.content.includes('kanban-plugin: board'));
      assert.ok(board.content.includes('## Blocked'));
      assert.ok(!board.content.includes('```json'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('priority words map to ints and persist as ints', async () => {
    const { root, call } = makeHarness();
    try {
      await call('project.init', { project: 'alpha' });
      const created = (await call('project.issue.create', {
        project: 'alpha',
        title: 'Word priority',
        priority: 'high',
      })) as { slug: string };
      const note = readFileSync(vp(root, `01-Projects/alpha/issues/${created.slug}.md`), 'utf-8');
      assert.match(note, /priority: 2/); // high -> 2
      assert.ok(!/priority: high/.test(note));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('board lanes + blocked: blocked-by entity moves to Blocked, flips when blocker done', async () => {
    const { root, call } = makeHarness();
    try {
      await call('project.init', { project: 'alpha' });
      const blocker = (await call('project.issue.create', { project: 'alpha', title: 'Blocker', state: 'todo' })) as { entity: string; slug: string };
      const blocked = (await call('project.issue.create', {
        project: 'alpha',
        title: 'Blocked task',
        state: 'todo',
        blocked_by: [blocker.entity],
      })) as { slug: string };

      let board = (await call('project.board.get', { project: 'alpha', lang: 'en' })) as { content: string };
      // blocked task renders under Blocked; blocker stays in Todo.
      assert.match(board.content, /## Blocked\n\n- \[ \] Blocked task\n/);
      assert.match(board.content, /## Todo\n\n- \[ \] Blocker\n/);

      // resolve the blocker -> blocked task flips back to Todo.
      await call('project.issue.update', { project: 'alpha', slug: blocker.slug, state: 'done' });
      board = (await call('project.board.get', { project: 'alpha', lang: 'en' })) as { content: string };
      assert.match(board.content, /## Todo\n\n- \[ \] Blocked task\n/);
      assert.match(board.content, /## Done\n\n- \[x\] Blocker\n/);
      // Blocked lane is now empty.
      assert.match(board.content, /## Blocked\n\n\n/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('draft issues are excluded from list and board (authoritative only)', async () => {
    const { root, call } = makeHarness();
    try {
      await call('project.init', { project: 'alpha' });
      await call('project.issue.create', { project: 'alpha', title: 'Reviewed one', state: 'todo' });
      await call('project.issue.create', { project: 'alpha', title: 'Draft capture', state: 'todo', review: 'draft' });

      const listed = (await call('project.issue.list', { project: 'alpha' })) as { count: number; issues: Array<{ slug: string }> };
      assert.equal(listed.count, 1);
      assert.equal(listed.issues[0].slug, 'reviewed-one');

      const board = (await call('project.board.get', { project: 'alpha', lang: 'en' })) as { content: string };
      assert.ok(board.content.includes('- [ ] Reviewed one'));
      assert.ok(!board.content.includes('Draft capture'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('issue.link blocks/blocked_by writes blocked-by entities; relates is a soft notice', async () => {
    const { root, call } = makeHarness();
    try {
      await call('project.init', { project: 'alpha' });
      const first = (await call('project.issue.create', { project: 'alpha', title: 'First issue' })) as { slug: string; entity: string };
      const second = (await call('project.issue.create', { project: 'alpha', title: 'Second issue' })) as { slug: string; entity: string };

      // first blocks second -> second.blocked-by gets first's ENTITY (not an id).
      await call('project.issue.link', { project: 'alpha', slug: first.slug, relation: 'blocks', target: second.slug });
      const secondNote = readFileSync(vp(root, `01-Projects/alpha/issues/${second.slug}.md`), 'utf-8');
      assert.match(secondNote, /blocked-by: \[project\/alpha\/issue\/first-issue\]/);

      // blocked_by writes on the source.
      await call('project.issue.link', { project: 'alpha', slug: first.slug, relation: 'blocked_by', target: second.slug });
      const firstNote = readFileSync(vp(root, `01-Projects/alpha/issues/${first.slug}.md`), 'utf-8');
      assert.match(firstNote, /blocked-by: \[project\/alpha\/issue\/second-issue\]/);

      // relates persists nothing.
      const rel = (await call('project.issue.link', { project: 'alpha', slug: first.slug, relation: 'relates', target: second.slug })) as { note: string };
      assert.match(rel.note, /derived/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('empty project board returns full 6-lane skeleton', async () => {
    const { root, call } = makeHarness();
    try {
      await call('project.init', { project: 'empty' });
      const board = (await call('project.board.get', { project: 'empty', lang: 'en' })) as { content: string };
      for (const lane of ['## Backlog', '## Todo', '## In Progress', '## Blocked', '## Done', '## Canceled']) {
        assert.ok(board.content.includes(lane), `expected lane ${lane}`);
      }
      assert.ok(board.content.startsWith('---\n\nkanban-plugin: board\n\n---\n'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('out-of-range priority note: list/get tolerate it (rank last), do not throw', async () => {
    // Regression: the READ paths used the strict write-validator (normalizePriorityParam),
    // throwing -32602 on a hand-edited `priority: 5` note and aborting the WHOLE list.
    // Python's currency.work_priority tolerates it (None -> rank last). The thin
    // adapter must not be stricter than the source-of-truth brain on the same notes.
    const { root, call } = makeHarness();
    try {
      await call('project.init', { project: 'alpha' });
      // A normal issue plus a hand-edited note carrying an out-of-range priority.
      await call('project.issue.create', { project: 'alpha', title: 'Good one', state: 'todo', priority: 1 });
      const issuesDir = vp(root, '01-Projects/alpha/issues');
      mkdirSync(issuesDir, { recursive: true });
      writeFileSync(
        join(issuesDir, 'bad-priority.md'),
        [
          '---',
          'type: issue',
          'entity: project/alpha/issue/bad-priority',
          'state: todo',
          'review: reviewed',
          'kind: knowledge-task',
          'id: alpha/bad-priority',
          'description: bad priority note',
          'status: active',
          'priority: 5',
          'last-verified: 2026-06-25',
          '---',
          '',
          'Bad priority note',
          '',
        ].join('\n'),
        'utf-8',
      );

      // list MUST NOT throw and MUST include the off-range note (not abort the list).
      const listed = (await call('project.issue.list', { project: 'alpha' })) as {
        count: number;
        issues: Array<{ slug: string; priority: number | null }>;
      };
      assert.equal(listed.count, 2, 'a single off-range note must not break the whole list');
      const bad = listed.issues.find((i) => i.slug === 'bad-priority');
      assert.ok(bad, 'off-range issue must be listed');
      assert.equal(bad!.priority, null, 'out-of-range priority surfaces as null (tolerant, parity with Python None)');

      // get MUST NOT throw for that issue.
      const got = (await call('project.issue.get', { project: 'alpha', slug: 'bad-priority' })) as {
        issue: { priority: number | null };
      };
      assert.equal(got.issue.priority, null);

      // board ranks it last (rank 4, same as None) -- still rendered, in Todo.
      const board = (await call('project.board.get', { project: 'alpha', lang: 'en' })) as { content: string };
      assert.match(board.content, /## Todo\n\n- \[ \] Good one\n- \[ \] Bad priority note\n/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('update is non-lossy: preserves status:frozen + cycle/due/estimate/tags', async () => {
    // Regression: renderIssueNote emitted only a fixed field set and hardcoded
    // status:active, so a read-modify-write through update silently destroyed
    // externally-authored work-OS fields (work_protocol.SNAPSHOT_FIELDS) and reset
    // the rhizome lifecycle status. The thin adapter must not mutilate notes.
    const { root, call } = makeHarness();
    try {
      await call('project.init', { project: 'alpha' });
      const issuesDir = vp(root, '01-Projects/alpha/issues');
      mkdirSync(issuesDir, { recursive: true });
      const notePath = join(issuesDir, 'rich.md');
      writeFileSync(
        notePath,
        [
          '---',
          'type: issue',
          'entity: project/alpha/issue/rich',
          'state: in-progress',
          'review: reviewed',
          'kind: knowledge-task',
          'id: alpha/rich',
          'description: rich note',
          'status: frozen',
          'priority: 2',
          'estimate: 3',
          'due: 2026-07-01',
          'cycle: 2026-W26',
          'tags: [api, infra]',
          'blocked-by: []',
          'last-verified: 2026-06-25',
          '---',
          '',
          'Rich note',
          '',
        ].join('\n'),
        'utf-8',
      );

      // Touch only assignee.
      await call('project.issue.update', { project: 'alpha', slug: 'rich', assignee: 'claude' });

      const after = readFileSync(notePath, 'utf-8');
      assert.match(after, /status: frozen/, 'rhizome status must be preserved (not reset to active)');
      assert.match(after, /estimate: 3/, 'estimate must survive the round trip');
      assert.match(after, /due: 2026-07-01/, 'due must survive');
      assert.match(after, /cycle: 2026-W26/, 'cycle must survive');
      assert.match(after, /tags: \[api, infra\]/, 'tags must survive');
      assert.match(after, /state: in-progress/, 'workflow state unchanged');
      assert.match(after, /assignee: claude/, 'the requested change applied');
      assert.ok(!/status: active/.test(after), 'frozen must NOT be overwritten with active');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('issue.create normalizes a non-kebab project key to a contract-valid id', async () => {
    // Regression: safeSegment did not lowercase/restrict the project segment, so
    // project 'My_Proj' produced id `My_Proj/hello-world`, which fails rhizome
    // contract _ID_RE (^[a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9-]*$). The project key
    // must be slugified for the id/entity FIRST segment.
    const ID_RE = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/;
    const { root, call } = makeHarness();
    try {
      await call('project.init', { project: 'My_Proj' });
      const created = (await call('project.issue.create', { project: 'My_Proj', title: 'Hello World' })) as {
        id: string;
        entity: string;
        path: string;
      };
      assert.equal(created.id, 'my-proj/hello-world');
      assert.ok(ID_RE.test(created.id), `id must match rhizome _ID_RE: ${created.id}`);
      assert.equal(created.entity, 'project/my-proj/issue/hello-world');
      assert.equal(created.path, '01-Projects/my-proj/issues/hello-world.md');
      // The on-disk note carries the contract-valid id, and lives under the
      // normalized folder (consistent project anchor + issues).
      const note = readFileSync(vp(root, '01-Projects/my-proj/issues/hello-world.md'), 'utf-8');
      assert.match(note, /^id: my-proj\/hello-world$/m);
      assert.match(note, /^entity: project\/my-proj\/issue\/hello-world$/m);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('comment.add appends to a sibling comments file without touching the board', async () => {
    const { root, call } = makeHarness();
    try {
      await call('project.init', { project: 'alpha' });
      const issue = (await call('project.issue.create', { project: 'alpha', title: 'Has comments', state: 'todo' })) as { slug: string };
      const res = (await call('project.comment.add', { project: 'alpha', slug: issue.slug, body: 'first comment' })) as { path: string };
      assert.equal(res.path, `01-Projects/alpha/issues/${issue.slug}.comments.md`);
      const comments = readFileSync(vp(root, res.path), 'utf-8');
      assert.ok(comments.includes('first comment'));
      // board is unaffected (comments file is not an entity-bearing issue).
      const board = (await call('project.board.get', { project: 'alpha', lang: 'en' })) as { content: string };
      assert.ok(board.content.includes('- [ ] Has comments'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
