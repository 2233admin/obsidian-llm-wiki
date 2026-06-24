// Task 4 acceptance for capture-hook.mjs. Zero-dep, run with:
//   node --test scripts/hooks/capture-hook.test.mjs
//
// Spawns the real hook as a subprocess (as Claude Code would), feeding a
// synthetic Stop payload on stdin and a synthetic transcript on disk. Asserts
// the §0 invariants the brief names as the acceptance bar:
//   A files exactly ONE unreviewed note to its own writer dir, stamped right
//   B re-run is idempotent (append-only, no duplicate)
//   C dry-run default writes nothing, shows the plan
//   D no vault-capture block -> silent no-op
//   F hostile entity/title cannot escape the writer dir

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('./capture-hook.mjs', import.meta.url));
const AGENT = 'test-claude';
const TODAY = '2026-06-25';

function tmp(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  return d;
}

// Write a transcript whose last assistant message contains `assistantText`.
function writeTranscript(dir, { userText = 'iii pivot 状态?', assistantText }) {
  const path = join(dir, 'transcript.jsonl');
  const lines = [
    { message: { role: 'user', content: userText } },
    { message: { role: 'assistant', model: 'claude-opus-4-8', content: [{ type: 'text', text: assistantText }] } },
  ].map((o) => JSON.stringify(o));
  writeFileSync(path, lines.join('\n') + '\n', 'utf8');
  return path;
}

function runHook({ vault, transcriptPath, statePath, apply, sid = 'sess-1', cwd }) {
  const payload = {
    session_id: sid,
    transcript_path: transcriptPath,
    cwd: cwd || vault,
    hook_event_name: 'Stop',
  };
  const env = {
    ...process.env,
    VAULT_PATH: vault,
    VAULT_CAPTURE_AGENT: AGENT,
    VAULT_CAPTURE_TODAY: TODAY,
    VAULT_CAPTURE_STATE: statePath,
    VAULT_CAPTURE_DEBUG: '1',
  };
  if (apply) env.VAULT_CAPTURE_APPLY = '1'; else delete env.VAULT_CAPTURE_APPLY;
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', env });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function aiOutputDir(vault) { return join(vault, '00-Inbox', 'AI-Output'); }

// All .md notes under 00-Inbox/AI-Output/**, returned as {rel, abs, text}.
function listNotes(vault) {
  const root = aiOutputDir(vault);
  const out = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) out.push({ abs: p, rel: p.slice(root.length + 1), text: readFileSync(p, 'utf8') });
    }
  };
  walk(root);
  return out;
}

const CAPTURE_BLOCK = [
  '已经把 iii pivot 收尾了。',
  '',
  '```vault-capture',
  'entity: k-atana/iii',
  'type: decision',
  'source: commit:NEW5678',
  'supersedes: research/wiki/entities/iii.md',
  'title: iii pivot done',
  '---',
  'iii pivot 已完成并合入主干。这是当前事实。',
  '```',
  '',
  '还有别的吗?',
].join('\n');

function freshVault() {
  const vault = tmp('cap-vault-');
  mkdirSync(aiOutputDir(vault), { recursive: true });
  const tdir = tmp('cap-tx-');
  const statePath = join(tmp('cap-state-'), 'seen.log');
  return { vault, tdir, statePath };
}

test('A: session end files exactly ONE unreviewed note to its own writer dir, stamped', () => {
  const { vault, tdir, statePath } = freshVault();
  const transcriptPath = writeTranscript(tdir, { assistantText: CAPTURE_BLOCK });
  try {
    const r = runHook({ vault, transcriptPath, statePath, apply: true });
    assert.equal(r.status, 0, 'hook must exit 0');

    const notes = listNotes(vault);
    assert.equal(notes.length, 1, `expected exactly 1 note, got ${notes.length}: ${notes.map(n => n.rel)}`);
    const n = notes[0];

    // writer dir = <machine>-<agent>; agent is forced to test-claude, so the
    // dir ends with -test-claude (machine prefix varies by host).
    assert.match(n.rel.replace(/\\/g, '/'), new RegExp(`(^|/)[^/]*-${AGENT}/${TODAY}-iii-pivot-done\\.md$`),
      `note path mismatch: ${n.rel}`);

    // currency frontmatter, exact landed schema
    assert.match(n.text, /^---\n/, 'has frontmatter');
    assert.match(n.text, /\nstatus: draft\n/, 'status: draft (== unreviewed; landed schema)');
    assert.match(n.text, /\nentity: k-atana\/iii\n/, 'entity stamped');
    assert.match(n.text, /\ntype: decision\n/, 'type stamped');
    assert.match(n.text, /\nsource: commit:NEW5678\n/, 'source stamped');
    assert.match(n.text, new RegExp(`\\nlast-verified: ${TODAY}\\n`), 'last-verified kebab-case + today');
    assert.match(n.text, /\nsupersedes: research\/wiki\/entities\/iii\.md\n/, 'supersedes stamped');
    assert.match(n.text, /iii pivot 已完成并合入主干/, 'body captured');
    assert.doesNotMatch(n.text, /status: unreviewed/, 'must NOT use the unrecognized "unreviewed" word');
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(tdir, { recursive: true, force: true });
    rmSync(dirname(statePath), { recursive: true, force: true });
  }
});

test('B: re-running the same Stop is idempotent (append-only, no duplicate)', () => {
  const { vault, tdir, statePath } = freshVault();
  const transcriptPath = writeTranscript(tdir, { assistantText: CAPTURE_BLOCK });
  try {
    runHook({ vault, transcriptPath, statePath, apply: true, sid: 'sess-dup' });
    const r2 = runHook({ vault, transcriptPath, statePath, apply: true, sid: 'sess-dup' });
    assert.match(r2.stderr, /skip \(already captured\)/, 're-run must report skip');
    const notes = listNotes(vault);
    assert.equal(notes.length, 1, `expected still 1 note after re-run, got ${notes.length}`);
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(tdir, { recursive: true, force: true });
    rmSync(dirname(statePath), { recursive: true, force: true });
  }
});

test('C: dry-run default writes nothing and shows the plan', () => {
  const { vault, tdir, statePath } = freshVault();
  const transcriptPath = writeTranscript(tdir, { assistantText: CAPTURE_BLOCK });
  try {
    const r = runHook({ vault, transcriptPath, statePath, apply: false });
    assert.equal(r.status, 0);
    assert.match(r.stderr, /DRY-RUN would write:/, 'plan is shown');
    assert.match(r.stderr, /entity=k-atana\/iii/, 'plan names the entity');
    const notes = listNotes(vault);
    assert.equal(notes.length, 0, 'dry-run must not write any file');
    assert.ok(!existsSync(statePath), 'dry-run must not mark the seen-log');
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(tdir, { recursive: true, force: true });
    rmSync(dirname(statePath), { recursive: true, force: true });
  }
});

test('D: no vault-capture block -> silent no-op', () => {
  const { vault, tdir, statePath } = freshVault();
  const transcriptPath = writeTranscript(tdir, { assistantText: '这是一段普通回答,没有 capture 块。' });
  try {
    const r = runHook({ vault, transcriptPath, statePath, apply: true });
    assert.equal(r.status, 0);
    assert.equal(listNotes(vault).length, 0, 'no block -> no note');
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(tdir, { recursive: true, force: true });
    rmSync(dirname(statePath), { recursive: true, force: true });
  }
});

test('G: two identical blocks in one message file exactly ONE note (in-message dedup)', () => {
  const { vault, tdir, statePath } = freshVault();
  const oneBlock = [
    '```vault-capture',
    'entity: k-atana/iii',
    'type: decision',
    'source: commit:NEW5678',
    '---',
    'iii pivot 已完成。',
    '```',
  ].join('\n');
  // same block twice (different surrounding prose) in the final message
  const transcriptPath = writeTranscript(tdir, { assistantText: `第一次:\n${oneBlock}\n\n再说一次:\n${oneBlock}` });
  try {
    runHook({ vault, transcriptPath, statePath, apply: true });
    assert.equal(listNotes(vault).length, 1, 'two identical blocks must collapse to one note');
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(tdir, { recursive: true, force: true });
    rmSync(dirname(statePath), { recursive: true, force: true });
  }
});

test('H: bracketed entity is normalized to a scalar (not a YAML list)', () => {
  const { vault, tdir, statePath } = freshVault();
  const block = [
    '```vault-capture',
    'entity: [k-atana/iii]',
    'type: note',
    'source: commit:abc',
    '---',
    '括号 entity 测试。',
    '```',
  ].join('\n');
  const transcriptPath = writeTranscript(tdir, { assistantText: block });
  try {
    runHook({ vault, transcriptPath, statePath, apply: true });
    const notes = listNotes(vault);
    assert.equal(notes.length, 1);
    assert.match(notes[0].text, /\nentity: k-atana\/iii\n/, 'brackets stripped -> scalar entity');
    assert.doesNotMatch(notes[0].text, /entity: \[/, 'must not emit a list-shaped entity');
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(tdir, { recursive: true, force: true });
    rmSync(dirname(statePath), { recursive: true, force: true });
  }
});

test('I: a tilde-fenced block captures a body that contains a ``` code fence in full', () => {
  const { vault, tdir, statePath } = freshVault();
  const block = [
    '~~~vault-capture',
    'entity: k-atana/iii',
    'type: note',
    'source: commit:abc',
    '---',
    '实现如下:',
    '```js',
    'const x = 1;',
    '```',
    '收尾说明。',
    '~~~',
  ].join('\n');
  const transcriptPath = writeTranscript(tdir, { assistantText: block });
  try {
    runHook({ vault, transcriptPath, statePath, apply: true });
    const notes = listNotes(vault);
    assert.equal(notes.length, 1);
    assert.match(notes[0].text, /const x = 1;/, 'nested code fence body captured');
    assert.match(notes[0].text, /收尾说明。/, 'prose after the nested fence captured (not truncated)');
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(tdir, { recursive: true, force: true });
    rmSync(dirname(statePath), { recursive: true, force: true });
  }
});

test('J: a block without entity is still filed once, with no entity field + a visible note', () => {
  const { vault, tdir, statePath } = freshVault();
  const block = [
    '```vault-capture',
    'type: note',
    'source: commit:abc',
    '---',
    '一条没有 entity 的普通记录。',
    '```',
  ].join('\n');
  const transcriptPath = writeTranscript(tdir, { assistantText: block });
  try {
    const r = runHook({ vault, transcriptPath, statePath, apply: true });
    const notes = listNotes(vault);
    assert.equal(notes.length, 1, 'entity-less block is still a valid capture');
    assert.doesNotMatch(notes[0].text, /\nentity:/, 'no entity field emitted');
    assert.match(r.stderr, /no entity -> filed as plain AI-Output, NOT indexed/, 'visible orphan-note signal');
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(tdir, { recursive: true, force: true });
    rmSync(dirname(statePath), { recursive: true, force: true });
  }
});

test('K: idempotency key ignores the auto-derived commit:<HEAD> default (stable across HEADs)', () => {
  // Block omits `source`, so the hook falls back to commit:<HEAD of cwd>. Two
  // re-fires of the same Stop with different cwds (=> different default source)
  // must still collapse to ONE note: the hash must depend only on the block.
  const { vault, tdir, statePath } = freshVault();
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url)); // a git repo (vault-mind)
  const noSourceBlock = [
    '```vault-capture',
    'entity: k-atana/iii',
    'type: decision',
    '---',
    'iii 收尾,未显式写 source。',
    '```',
  ].join('\n');
  const transcriptPath = writeTranscript(tdir, { assistantText: noSourceBlock });
  try {
    runHook({ vault, transcriptPath, statePath, apply: true, sid: 'sess-k', cwd: repoRoot }); // default=commit:HEAD
    runHook({ vault, transcriptPath, statePath, apply: true, sid: 'sess-k', cwd: vault });    // default='' (not a git repo)
    assert.equal(listNotes(vault).length, 1, 'auto-source default must not change the idempotency identity');
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(tdir, { recursive: true, force: true });
    rmSync(dirname(statePath), { recursive: true, force: true });
  }
});

test('F: hostile entity/title cannot escape the writer dir', () => {
  const { vault, tdir, statePath } = freshVault();
  const evil = [
    '```vault-capture',
    'entity: ../../../etc/evil',
    'type: note',
    'source: commit:abc',
    'title: ../../escape attempt',
    '---',
    '试图越狱。',
    '```',
  ].join('\n');
  const transcriptPath = writeTranscript(tdir, { assistantText: evil });
  try {
    runHook({ vault, transcriptPath, statePath, apply: true });
    const notes = listNotes(vault);
    assert.equal(notes.length, 1, 'still files exactly one note');
    const abs = notes[0].abs.replace(/\\/g, '/');
    const root = aiOutputDir(vault).replace(/\\/g, '/');
    assert.ok(abs.startsWith(root + '/'), `note escaped writer root: ${abs}`);
    assert.doesNotMatch(abs, /\.\./, 'no traversal in final path');
    // nothing was created at the vault parent
    assert.ok(!existsSync(join(dirname(vault), 'etc')), 'no escape to vault parent');
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(tdir, { recursive: true, force: true });
    rmSync(dirname(statePath), { recursive: true, force: true });
  }
});
