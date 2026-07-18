// Anti-drift parity test: the TS work-OS board renderer (workos.ts) must agree
// with the Python renderer (compiler/kb_meta.py work board) for the SAME notes.
//
// Layer 1 (STRUCTURAL, always runs): lanes/cards/order/'## Blocked'/plain fence/
//   no H1, for en/zh/ja + the blocked-by->Blocked flip.
// Layer 2 (BYTE-EQUAL, guarded): when python is on PATH, shell out ONCE
//   (test-only, never in the server) and assert stdout.board === the TS string.
//   test.skip when python absent so Python-less CI still passes.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { scanWorkNotes, isAuthoritative, renderKanbanBoard, detectVaultLang, detectLang } from './workos.js';

// The 6-issue fixture: byte-for-byte twin of compiler KanbanRenderTest._notes.
// Each body's first non-blank line is the entity leaf (a..f) so cardLabel
// matches the Python body=='' -> entity.rsplit('/',1)[-1] fallback.
interface Issue {
  slug: string;
  state: string;
  priority: number;
  blockedBy?: string[];
}
const ISSUES: Issue[] = [
  { slug: 'a', state: 'done', priority: 2 },
  { slug: 'b', state: 'todo', priority: 1 },
  { slug: 'c', state: 'todo', priority: 2, blockedBy: ['project/t/issue/b'] },
  { slug: 'd', state: 'in-progress', priority: 2 },
  { slug: 'e', state: 'canceled', priority: 2 },
  { slug: 'f', state: 'backlog', priority: 3 },
];

function issueNote(it: Issue): string {
  const lines = [
    '---',
    'type: issue',
    `entity: project/t/issue/${it.slug}`,
    `state: ${it.state}`,
    'review: reviewed',
    'kind: knowledge-task',
    `id: t/${it.slug}`,
    `description: issue ${it.slug}`,
    'status: active',
    `priority: ${it.priority}`,
  ];
  if (it.blockedBy) lines.push(`blocked-by: [${it.blockedBy.join(', ')}]`);
  lines.push('last-verified: 2026-06-25');
  lines.push('---');
  // body first non-blank line == entity leaf
  return lines.join('\n') + `\n\n${it.slug}\n`;
}

function buildFixture(issues: Issue[]): string {
  const vault = mkdtempSync(join(tmpdir(), 'workos-parity-'));
  const issuesDir = join(vault, '01-Projects', 't', 'issues');
  mkdirSync(issuesDir, { recursive: true });
  const projectNote = [
    '---',
    'type: project',
    'entity: project/t',
    'kind: knowledge-task',
    'id: t/project',
    'description: parity fixture project',
    'status: active',
    'last-verified: 2026-06-25',
    '---',
    '',
    'Project t',
    '',
  ].join('\n');
  writeFileSync(join(vault, '01-Projects', 't', '_project.md'), projectNote, 'utf-8');
  for (const it of issues) writeFileSync(join(issuesDir, `${it.slug}.md`), issueNote(it), 'utf-8');
  return vault;
}

function tsBoard(vault: string, lang: string): string {
  const notes = scanWorkNotes(vault);
  const authoritative = notes.filter((n) => isAuthoritative(n.raw));
  return renderKanbanBoard(authoritative, 't', lang);
}

function pythonAvailable(): boolean {
  const r = spawnSync('python', ['--version'], { encoding: 'utf-8' });
  return r.status === 0;
}

const COMPILER = join(process.cwd(), '..', 'compiler');

function pythonBoard(vault: string, lang: string): string {
  // Shell out ONCE, test-only. Pin lang for determinism. PYTHONUTF8=1 so
  // Windows GBK consoles do not mangle the CJK lane labels.
  const r = spawnSync('python', [join(COMPILER, 'kb_meta.py'), 'work', 'board', vault, '--project', 't', '--lang', lang], {
    encoding: 'utf-8',
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  });
  assert.equal(r.status, 0, `python work board failed: ${r.stderr}`);
  const parsed = JSON.parse(r.stdout) as { board: string };
  return parsed.board;
}

describe('work-OS board parity (TS vs Python)', () => {
  test('machine-local dot directories are excluded from the authoritative scan', () => {
    const vault = buildFixture([ISSUES[0]]);
    try {
      const nestedIssues = join(vault, '.orca', 'worktrees', 'run-1', '01-Projects', 't', 'issues');
      mkdirSync(nestedIssues, { recursive: true });
      writeFileSync(join(nestedIssues, 'a.md'), issueNote(ISSUES[0]), 'utf-8');

      const matches = scanWorkNotes(vault).filter((note) => note.entity === 'project/t/issue/a');

      assert.deepEqual(matches.map((note) => note.note_id), ['01-Projects/t/issues/a.md']);
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test('layer 1 structural: lanes, cards, order (en)', () => {
    const vault = buildFixture(ISSUES);
    try {
      const board = tsBoard(vault, 'en');
      // header is exactly the blank-padded plugin frontmatter, no H1.
      assert.ok(board.startsWith('---\n\nkanban-plugin: board\n\n---\n'));
      assert.ok(!/^#\s/m.test(board), 'no H1 heading');
      // '## Blocked' present; plain settings fence (not ```json).
      assert.ok(board.includes('## Blocked'));
      assert.ok(board.includes('```\n{"kanban-plugin":"board","show-checkboxes":true}\n```'));
      assert.ok(!board.includes('```json'));
      // lane assignment: Done=[a], Todo=[b], Blocked=[c], In Progress=[d], Canceled=[e], Backlog=[f]
      assert.match(board, /## Backlog\n\n- \[ \] f\n/);
      assert.match(board, /## Todo\n\n- \[ \] b\n/);
      assert.match(board, /## In Progress\n\n- \[ \] d\n/);
      assert.match(board, /## Blocked\n\n- \[ \] c\n/);
      assert.match(board, /## Done\n\n- \[x\] a\n/);
      assert.match(board, /## Canceled\n\n- \[x\] e\n/);
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test('layer 1 i18n: zh lanes', () => {
    const vault = buildFixture(ISSUES);
    try {
      const board = tsBoard(vault, 'zh');
      assert.ok(board.includes('## 受阻'));
      assert.ok(!board.includes('## Blocked'));
      assert.ok(board.includes('## 待办'));
      assert.ok(board.includes('## 进行中'));
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test('layer 1 i18n: ja lanes', () => {
    const vault = buildFixture(ISSUES);
    try {
      const board = tsBoard(vault, 'ja');
      assert.ok(board.includes('## ブロック'));
      assert.ok(!board.includes('## Blocked'));
      assert.ok(board.includes('## 未着手'));
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test('layer 1 blocked flip: b done -> c leaves Blocked for Todo', () => {
    const flipped = ISSUES.map((it) => (it.slug === 'b' ? { ...it, state: 'done' } : it));
    const vault = buildFixture(flipped);
    try {
      const board = tsBoard(vault, 'en');
      // c is no longer blocked -> Todo; Blocked lane empty.
      assert.match(board, /## Todo\n\n- \[ \] c\n/);
      assert.match(board, /## Blocked\n\n\n/); // empty Blocked lane (heading, blank, blank)
      // Done now holds b then a (sorted by priority_rank then note_id: b prio1, a prio2).
      assert.match(board, /## Done\n\n- \[x\] b\n- \[x\] a\n/);
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });

  // Regression for the detectLang hiragana lower-bound bug: a vault whose note
  // text is dominated by low-codepoint hiragana (no katakana, no Han) must
  // auto-detect 'ja' -- exactly like Python's detect_lang ('぀'..'ヿ', lower
  // bound U+3040). The old TS bound 0x3080 excluded U+3040..U+307F (あ/か/の/...)
  // and silently rendered English lanes on a Japanese vault.
  const HIRAGANA_ISSUES: Issue[] = [
    { slug: 'a', state: 'todo', priority: 1 },
    { slug: 'b', state: 'done', priority: 2 },
  ];
  function hiraganaNote(it: Issue): string {
    // Bodies are PURE low-block hiragana (no katakana >=0x3080, no Han): the
    // exact case the old 0x3080 bound misdetected as 'en'.
    const bodyByLeaf: Record<string, string> = { a: 'あかさたなはま', b: 'たすくのしごと' };
    const lines = [
      '---',
      'type: issue',
      `entity: project/t/issue/${it.slug}`,
      `state: ${it.state}`,
      'review: reviewed',
      'kind: knowledge-task',
      `id: t/${it.slug}`,
      `description: ${bodyByLeaf[it.slug]}`,
      'status: active',
      `priority: ${it.priority}`,
      'last-verified: 2026-06-25',
      '---',
    ];
    return lines.join('\n') + `\n\n${bodyByLeaf[it.slug]}\n`;
  }
  function buildHiraganaFixture(): string {
    const vault = mkdtempSync(join(tmpdir(), 'workos-parity-ja-'));
    const issuesDir = join(vault, '01-Projects', 't', 'issues');
    mkdirSync(issuesDir, { recursive: true });
    const projectNote = [
      '---', 'type: project', 'entity: project/t', 'kind: knowledge-task',
      'id: t/project', 'description: あ', 'status: active', 'last-verified: 2026-06-25', '---', '', 'あ', '',
    ].join('\n');
    writeFileSync(join(vault, '01-Projects', 't', '_project.md'), projectNote, 'utf-8');
    for (const it of HIRAGANA_ISSUES) writeFileSync(join(issuesDir, `${it.slug}.md`), hiraganaNote(it), 'utf-8');
    return vault;
  }

  test('layer 1 auto-detect: pure-hiragana vault detects ja (not en)', () => {
    // unit-level proof the lower bound is 0x3040: あ (0x3042) must be kana.
    assert.equal(detectLang('あかさたなはま'), 'ja');
    assert.equal(detectLang('の'), 'ja'); // U+306E, in the excluded-by-bug sub-block
    const vault = buildHiraganaFixture();
    try {
      const notes = scanWorkNotes(vault);
      assert.equal(detectVaultLang(notes), 'ja');
      const auto = renderKanbanBoard(notes.filter((n) => isAuthoritative(n.raw)), 't', detectVaultLang(notes));
      // ja lanes, NOT en -- the board-parity break the bug caused.
      assert.ok(auto.includes('## 未着手'), 'expected ja Todo lane');
      assert.ok(auto.includes('## 完了'), 'expected ja Done lane');
      assert.ok(!auto.includes('## Todo'), 'must not fall through to en lanes');
      assert.ok(!auto.includes('## Backlog'));
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test('layer 2 byte-equal: pure-hiragana vault auto-detect vs python (no --lang)', { skip: !pythonAvailable() }, () => {
    const vault = buildHiraganaFixture();
    try {
      const notes = scanWorkNotes(vault);
      const ts = renderKanbanBoard(notes.filter((n) => isAuthoritative(n.raw)), 't', detectVaultLang(notes));
      // Python with NO --lang -> detect_vault_lang path. Clear VAULT_MIND_LANG so
      // both sides go through pure auto-detect.
      const env: NodeJS.ProcessEnv = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
      delete env.VAULT_MIND_LANG;
      const r = spawnSync('python', [join(COMPILER, 'kb_meta.py'), 'work', 'board', vault, '--project', 't'], { encoding: 'utf-8', env });
      assert.equal(r.status, 0, `python work board failed: ${r.stderr}`);
      const py = (JSON.parse(r.stdout) as { board: string; lang: string });
      assert.equal(py.lang, 'ja', 'python must also auto-detect ja');
      assert.equal(ts, py.board, 'auto-detected hiragana board must be byte-equal to python');
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test('layer 2 byte-equal vs python work board (en/zh/ja)', { skip: !pythonAvailable() }, () => {
    const vault = buildFixture(ISSUES);
    try {
      for (const lang of ['en', 'zh', 'ja']) {
        const ts = tsBoard(vault, lang);
        const py = pythonBoard(vault, lang);
        assert.equal(ts, py, `board mismatch for lang=${lang}`);
      }
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test('layer 2 byte-equal after blocked flip (b done)', { skip: !pythonAvailable() }, () => {
    const flipped = ISSUES.map((it) => (it.slug === 'b' ? { ...it, state: 'done' } : it));
    const vault = buildFixture(flipped);
    try {
      assert.equal(tsBoard(vault, 'en'), pythonBoard(vault, 'en'));
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });
});
