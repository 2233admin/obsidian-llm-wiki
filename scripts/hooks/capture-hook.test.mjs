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

function runHook({ vault, transcriptPath, statePath, apply, sid = 'sess-1', cwd, topic }) {
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
  if (topic) env.VAULT_CAPTURE_TOPIC = topic; else delete env.VAULT_CAPTURE_TOPIC;
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
  'state: done',
  'assignee: agent/opus',
  'source: commit:NEW5678',
  'title: iii pivot done',
  '---',
  'iii pivot 已完成并合入主干。这是当前事实。',
  '```',
  '',
  '还有别的吗?',
].join('\n');

// Plant an authoritative head note for `entity` so base-head resolution (scan
// path) has something to lock against. Mirrors the fixture head shape: a
// reviewed work note carrying `entity` + `last-verified`. Returns its note-id
// (repo-relative POSIX path), which is what base-head must equal.
function plantHead(vault, relDir, name, { entity, lastVerified, status = 'reviewed', extra = '' }) {
  const dir = join(vault, relDir);
  mkdirSync(dir, { recursive: true });
  const statusLine = status ? `status: ${status}\n` : '';
  const fm = `---\ntype: issue\nentity: ${entity}\nstate: in-progress\nassignee: agent/opus\n${statusLine}generated-by: human\nlast-verified: ${lastVerified}\n${extra}---\n\nauthoritative head for ${entity}\n`;
  writeFileSync(join(dir, name), fm, 'utf8');
  return `${relDir}/${name}`.replace(/\\/g, '/');
}

// Write a compiled currency report at <vault>/<topic>/wiki/_currency.json in the
// on-disk byNote shape the compiler emits.
function writeCurrencyReport(vault, topic, byNote) {
  const dir = join(vault, topic, 'wiki');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '_currency.json'),
    JSON.stringify({ topic, compiled: TODAY, byNote }, null, 2), 'utf8');
}

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
    // 8G WORK-axis proposal fields honored from the block
    assert.match(n.text, /\nstate: done\n/, 'block state honored (WORK axis)');
    assert.match(n.text, /\nassignee: agent\/opus\n/, 'block assignee honored');
    assert.match(n.text, /\nsource: commit:NEW5678\n/, 'source stamped');
    assert.match(n.text, new RegExp(`\\nlast-verified: ${TODAY}\\n`), 'last-verified kebab-case + today');
    // 8P: drafts never carry supersedes; this fresh vault has no head -> no base-head
    assert.doesNotMatch(n.text, /\nsupersedes:/, 'draft must NOT carry supersedes');
    assert.doesNotMatch(n.text, /\nbase-head:/, 'brand-new entity -> no base-head');
    assert.match(n.text, /iii pivot 已完成并合入主干/, 'body captured');
    assert.doesNotMatch(n.text, /status: unreviewed/, 'must NOT use the unrecognized "unreviewed" word');
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(tdir, { recursive: true, force: true });
    rmSync(dirname(statePath), { recursive: true, force: true });
  }
});

// Task 10B: one conversation structured into a GROUP of vault-capture blocks --
// a decision plus two issues, the second blocked-by the first.
const DIGEST_BLOCKS = [
  '把这次对话结构化成实体图:',
  '',
  '```vault-capture',
  'entity: proj/db/decision/use-postgres',
  'type: decision',
  'state: done',
  '---',
  '定了用 Postgres 作为主库。',
  '```',
  '',
  '```vault-capture',
  'entity: proj/db/issue/schema',
  'type: issue',
  'state: todo',
  '---',
  '设计 schema。',
  '```',
  '',
  '```vault-capture',
  'entity: proj/db/issue/migrate',
  'type: issue',
  'state: todo',
  'blocked-by: proj/db/issue/schema',
  '---',
  '迁移数据,被 schema 阻塞。',
  '```',
].join('\n');

test('U: a conversation digest files a GROUP of drafts with blocked-by edges + shared session', () => {
  const { vault, tdir, statePath } = freshVault();
  const transcriptPath = writeTranscript(tdir, { assistantText: DIGEST_BLOCKS });
  try {
    const r = runHook({ vault, transcriptPath, statePath, apply: true, sid: 'sess-digest' });
    assert.equal(r.status, 0, 'hook must exit 0');

    const notes = listNotes(vault);
    assert.equal(notes.length, 3, `expected 3 digest notes, got ${notes.length}: ${notes.map(n => n.rel)}`);

    // every capture in the group is an unreviewed draft tagged with the session,
    // so the digest is identifiable as one conversation (groupable in triage).
    for (const n of notes) {
      assert.match(n.text, /\nstatus: draft\n/, 'each digest note is a draft');
      assert.match(n.text, /\ndigest-session: sess-digest\n/, 'each carries session provenance');
    }

    // the blocked-by edge survives as a real YAML list naming the blocker entity
    // (-> the compiler reads a relation, -> a 10A canvas edge after promote).
    const migrate = notes.find((n) => /\nentity: proj\/db\/issue\/migrate\n/.test(n.text));
    assert.ok(migrate, 'migrate issue note exists');
    assert.match(migrate.text, /\nblocked-by: \[proj\/db\/issue\/schema\]\n/, 'blocked-by emitted as a list');

    // the shape the brief names: a decision + two issues.
    assert.ok(notes.some((n) => /\ntype: decision\n/.test(n.text)), 'decision captured');
    assert.equal(notes.filter((n) => /\ntype: issue\n/.test(n.text)).length, 2, 'two issues captured');
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

// ---------------------------------------------------------------------------
// Task 8G: agent self-update loop. An agent finishes work and emits a
// vault-capture block with entity + state:done. The hook must produce a draft
// candidate that (a) carries the WORK-axis state from the block, (b) keeps the
// REVIEW axis at status:draft, (c) stamps base-head = the resolved authoritative
// head note-id (the 8P optimistic lock), and (d) NEVER carries supersedes.
// ---------------------------------------------------------------------------

const DONE_BLOCK = (extra = []) => [
  '我已经把 db-migration 做完了。',
  '',
  '```vault-capture',
  'entity: project/iii-pivot/issue/db-migration',
  'type: issue',
  'state: done',
  ...extra,
  '---',
  'db-migration 已完成,迁移脚本合入主干。',
  '```',
].join('\n');

test('L: state:done capture -> draft candidate carrying state:done + status:draft, base-head resolved, NO supersedes', () => {
  const { vault, tdir, statePath } = freshVault();
  // authoritative head H1 (reviewed) for the entity -> base-head must lock to it.
  const headId = plantHead(vault, 'Projects/iii-pivot/issues', 'db-migration.md', {
    entity: 'project/iii-pivot/issue/db-migration', lastVerified: '2026-06-20',
  });
  const transcriptPath = writeTranscript(tdir, { assistantText: DONE_BLOCK() });
  try {
    const r = runHook({ vault, transcriptPath, statePath, apply: true });
    assert.equal(r.status, 0, 'hook exits 0');
    const notes = listNotes(vault);
    assert.equal(notes.length, 1, `expected exactly 1 candidate, got ${notes.length}`);
    const t = notes[0].text;
    assert.match(t, /\nstatus: draft\n/, 'REVIEW axis stays draft (a capture is a proposal)');
    assert.match(t, /\nstate: done\n/, 'WORK axis state:done taken from the block');
    assert.match(t, /\nentity: project\/iii-pivot\/issue\/db-migration\n/, 'entity stamped');
    assert.match(t, new RegExp(`\\nbase-head: ${headId.replace(/[/.]/g, (m) => '\\' + m)}\\n`),
      `base-head must lock to the authoritative head note-id (${headId})`);
    assert.doesNotMatch(t, /\nsupersedes:/, 'a draft candidate must NEVER carry supersedes');
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(tdir, { recursive: true, force: true });
    rmSync(dirname(statePath), { recursive: true, force: true });
  }
});

test('M: base-head resolves from <topic>/wiki/_currency.json when present (preferred over scan)', () => {
  const { vault, tdir, statePath } = freshVault();
  const entity = 'project/iii-pivot/issue/db-migration';
  // The compiled report names a DIFFERENT note-id than any on disk; the hook must
  // trust the report (stage 1) over a filesystem scan (stage 2).
  const reportHeadId = 'Projects/iii-pivot/issues/db-migration.reviewed.2.md';
  writeCurrencyReport(vault, 'research', {
    [reportHeadId]: { marker: 'OK', reasons: [], entity, currentTruth: true },
    'Projects/iii-pivot/issues/db-migration.md':
      { marker: 'SUPERSEDED', reasons: [], entity, currentTruth: false },
  });
  // also plant an older authoritative note that scan WOULD pick -> proves report wins
  plantHead(vault, 'Projects/iii-pivot/issues', 'db-migration.md',
    { entity, lastVerified: '2026-06-20' });
  const transcriptPath = writeTranscript(tdir, { assistantText: DONE_BLOCK() });
  try {
    runHook({ vault, transcriptPath, statePath, apply: true, topic: 'research' });
    const notes = listNotes(vault);
    assert.equal(notes.length, 1);
    assert.match(notes[0].text, new RegExp(`\\nbase-head: ${reportHeadId.replace(/[/.]/g, (m) => '\\' + m)}\\n`),
      'base-head must come from current-truth in _currency.json');
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(tdir, { recursive: true, force: true });
    rmSync(dirname(statePath), { recursive: true, force: true });
  }
});

test('N: base-head resolves by scanning authoritative notes when no currency report (newest last-verified; drafts ignored)', () => {
  const { vault, tdir, statePath } = freshVault();
  const entity = 'project/iii-pivot/issue/db-migration';
  // older reviewed head
  plantHead(vault, 'Projects/iii-pivot/issues', 'db-migration.v1.md',
    { entity, lastVerified: '2026-06-18' });
  // newer reviewed head -> this is the current authoritative head
  const newest = plantHead(vault, 'Projects/iii-pivot/issues', 'db-migration.v2.md',
    { entity, lastVerified: '2026-06-22' });
  // a NEWER draft candidate for the same entity must be IGNORED (not authoritative)
  plantHead(vault, 'Projects/iii-pivot/issues', 'db-migration.draft.md',
    { entity, lastVerified: '2026-06-24', status: 'draft' });
  const transcriptPath = writeTranscript(tdir, { assistantText: DONE_BLOCK() });
  try {
    runHook({ vault, transcriptPath, statePath, apply: true });
    const notes = listNotes(vault);
    assert.equal(notes.length, 1);
    assert.match(notes[0].text, new RegExp(`\\nbase-head: ${newest.replace(/[/.]/g, (m) => '\\' + m)}\\n`),
      'base-head must be the newest AUTHORITATIVE head (draft candidate ignored)');
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(tdir, { recursive: true, force: true });
    rmSync(dirname(statePath), { recursive: true, force: true });
  }
});

test('O: a legacy note with NO status counts as authoritative for base-head', () => {
  const { vault, tdir, statePath } = freshVault();
  const entity = 'project/iii-pivot/issue/db-migration';
  // legacy head: entity + last-verified, but NO status field at all
  const legacy = plantHead(vault, 'Projects/iii-pivot/issues', 'db-migration.legacy.md',
    { entity, lastVerified: '2026-06-19', status: '' });
  const transcriptPath = writeTranscript(tdir, { assistantText: DONE_BLOCK() });
  try {
    runHook({ vault, transcriptPath, statePath, apply: true });
    const notes = listNotes(vault);
    assert.equal(notes.length, 1);
    assert.match(notes[0].text, new RegExp(`\\nbase-head: ${legacy.replace(/[/.]/g, (m) => '\\' + m)}\\n`),
      'legacy status-less note is authoritative -> usable as base-head');
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(tdir, { recursive: true, force: true });
    rmSync(dirname(statePath), { recursive: true, force: true });
  }
});

test('P: brand-new entity (no head anywhere) -> NO base-head (promote materializes fresh)', () => {
  const { vault, tdir, statePath } = freshVault();
  // vault has no authoritative note and no currency report for this entity.
  const block = [
    '```vault-capture',
    'entity: project/brand-new/issue/first',
    'type: issue',
    'state: todo',
    '---',
    '一个全新的 entity,之前没有任何权威 head。',
    '```',
  ].join('\n');
  const transcriptPath = writeTranscript(tdir, { assistantText: block });
  try {
    runHook({ vault, transcriptPath, statePath, apply: true });
    const notes = listNotes(vault);
    assert.equal(notes.length, 1);
    assert.doesNotMatch(notes[0].text, /\nbase-head:/, 'brand-new entity must NOT stamp base-head');
    assert.match(notes[0].text, /\nstate: todo\n/, 'state still honored for a new entity');
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(tdir, { recursive: true, force: true });
    rmSync(dirname(statePath), { recursive: true, force: true });
  }
});

test('Q: assignee is honored when present and omitted when absent (not derived from generated-by)', () => {
  const a = freshVault();
  const withAssignee = writeTranscript(a.tdir, { assistantText: DONE_BLOCK(['assignee: agent/codex']) });
  const b = freshVault();
  const noAssignee = writeTranscript(b.tdir, { assistantText: DONE_BLOCK() });
  try {
    runHook({ vault: a.vault, transcriptPath: withAssignee, statePath: a.statePath, apply: true, sid: 'sess-q1' });
    const n1 = listNotes(a.vault);
    assert.equal(n1.length, 1);
    assert.match(n1[0].text, /\nassignee: agent\/codex\n/, 'explicit assignee honored');

    runHook({ vault: b.vault, transcriptPath: noAssignee, statePath: b.statePath, apply: true, sid: 'sess-q2' });
    const n2 = listNotes(b.vault);
    assert.equal(n2.length, 1);
    assert.doesNotMatch(n2[0].text, /\nassignee:/, 'no block assignee -> no assignee field emitted');
    // generated-by is provenance, not assignee
    assert.match(n2[0].text, new RegExp(`\\ngenerated-by: [^\\n]*-${AGENT}\\n`), 'generated-by is provenance');
  } finally {
    rmSync(a.vault, { recursive: true, force: true });
    rmSync(a.tdir, { recursive: true, force: true });
    rmSync(dirname(a.statePath), { recursive: true, force: true });
    rmSync(b.vault, { recursive: true, force: true });
    rmSync(b.tdir, { recursive: true, force: true });
    rmSync(dirname(b.statePath), { recursive: true, force: true });
  }
});

test('S: at equal last-verified, base-head scan picks the REVIEWED head over a legacy head whose note-id sorts later (mirrors Python _recency_key)', () => {
  // Finding 1: the hook scan tie-break must match work_protocol._recency_key
  // (last-verified, status-rank, note-id) -- status-rank dominates note-id, so a
  // reviewed head beats a legacy head at equal last-verified even when the legacy
  // note-id sorts LATER. Otherwise the hook stamps a base-head Python won't
  // resolve to, and a valid done is wrongly routed to HEAD_MISMATCH/Conflicts.
  const { vault, tdir, statePath } = freshVault();
  const entity = 'project/iii-pivot/issue/db-migration';
  // reviewed head -- note-id sorts FIRST ("aaa...").
  const reviewedId = plantHead(vault, 'Projects/iii-pivot/issues', 'aaa-reviewed.md',
    { entity, lastVerified: '2026-06-20', status: 'reviewed' });
  // legacy head (NO status) -- note-id sorts LATER ("zzz...") at the SAME lv.
  plantHead(vault, 'Projects/iii-pivot/issues', 'zzz-legacy.md',
    { entity, lastVerified: '2026-06-20', status: '' });
  const transcriptPath = writeTranscript(tdir, { assistantText: DONE_BLOCK() });
  try {
    runHook({ vault, transcriptPath, statePath, apply: true });
    const notes = listNotes(vault);
    assert.equal(notes.length, 1);
    assert.match(notes[0].text, new RegExp(`\\nbase-head: ${reviewedId.replace(/[/.]/g, (m) => '\\' + m)}\\n`),
      'reviewed head must win the tie over the later-sorting legacy head');
    assert.doesNotMatch(notes[0].text, /\nbase-head: [^\n]*zzz-legacy\.md\n/,
      'must NOT stamp the legacy head (the Python/hook divergence bug)');
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(tdir, { recursive: true, force: true });
    rmSync(dirname(statePath), { recursive: true, force: true });
  }
});

test('T: a VAULT_CAPTURE_TOPIC containing `..` cannot read a _currency.json outside the vault (invariant a)', () => {
  // Finding 4: topic is the lone path input; it must be sanitized to a single
  // in-vault segment. Plant a malicious report OUTSIDE the vault that, if read,
  // would stamp an out-of-vault base-head. With topic='../outside' sanitized, the
  // hook must NOT read it -> falls back to the in-vault scan (no head -> none).
  const { vault, tdir, statePath } = freshVault();
  const entity = 'project/iii-pivot/issue/db-migration';
  // <vault>/../outside/wiki/_currency.json with an out-of-vault current-truth.
  const outsideDir = join(dirname(vault), 'outside', 'wiki');
  mkdirSync(outsideDir, { recursive: true });
  writeFileSync(join(outsideDir, '_currency.json'),
    JSON.stringify({ current_truth: { [entity]: 'PWNED-OUTSIDE-VAULT/evil.md' } }), 'utf8');
  const transcriptPath = writeTranscript(tdir, { assistantText: DONE_BLOCK() });
  try {
    runHook({ vault, transcriptPath, statePath, apply: true, topic: '../outside' });
    const notes = listNotes(vault);
    assert.equal(notes.length, 1);
    assert.doesNotMatch(notes[0].text, /PWNED-OUTSIDE-VAULT/,
      'a `..` topic must not read an out-of-vault report');
    assert.doesNotMatch(notes[0].text, /\nbase-head:/,
      'no in-vault head exists -> no base-head stamped (the outside report is unreachable)');
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(tdir, { recursive: true, force: true });
    rmSync(dirname(statePath), { recursive: true, force: true });
    rmSync(join(dirname(vault), 'outside'), { recursive: true, force: true });
  }
});

test('R: a block-supplied supersedes is IGNORED (drafts only carry base-head)', () => {
  const { vault, tdir, statePath } = freshVault();
  const entity = 'project/iii-pivot/issue/db-migration';
  const headId = plantHead(vault, 'Projects/iii-pivot/issues', 'db-migration.md',
    { entity, lastVerified: '2026-06-20' });
  // agent tries to also declare supersedes -- the hook must drop it.
  const transcriptPath = writeTranscript(tdir, {
    assistantText: DONE_BLOCK(['supersedes: Projects/iii-pivot/issues/db-migration.md']),
  });
  try {
    runHook({ vault, transcriptPath, statePath, apply: true });
    const notes = listNotes(vault);
    assert.equal(notes.length, 1);
    // assert on the FRONTMATTER block only -- a non-allowed `supersedes:` line is
    // not a YAML field; it just terminates meta parsing and lands in the body.
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(notes[0].text)[1];
    assert.doesNotMatch(fm, /^supersedes:/m, 'supersedes must NOT be a frontmatter field on a draft');
    assert.match(fm, new RegExp(`^base-head: ${headId.replace(/[/.]/g, (m) => '\\' + m)}$`, 'm'),
      'base-head is still stamped from the resolved head');
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(tdir, { recursive: true, force: true });
    rmSync(dirname(statePath), { recursive: true, force: true });
  }
});
