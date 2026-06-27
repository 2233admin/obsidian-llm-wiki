#!/usr/bin/env node
// capture-hook (Task 4 / V1-BUILD.md) -- Claude Code Stop hook, Node, zero-dep.
//
// North star: stop memory drift across multiple users / multiple agents. The
// capture half: when a session ends, persist the agent's *durable* claim as an
// `unreviewed`, currency-stamped note so the compile passes (Task 2) and the
// inject hook (Task 5) can serve compiled current-truth instead of one expired
// snapshot.
//
// What it does: on Stop, scan the agent's final message for an explicit
//   ```vault-capture``` block and file ONE note into
//   <VAULT>/00-Inbox/AI-Output/<machine>-<agent>/YYYY-MM-DD-<slug>.md.
// No block -> no write (the hook never fabricates an entity from free text).
//
// Why a block, not the whole answer: a Stop hook only sees the transcript. The
// currency passes index ONLY notes that carry an `entity` (compiler/kb_meta.py
// _scan_entity_notes). The agent alone knows the entity (and the WORK-axis
// proposal: `state`/`assignee`), so it declares them in the block; the hook
// auto-fills the mechanical fields it can derive -- and, for an UPDATE, the
// `base-head` optimistic lock (Task 8G/8P): it resolves the current
// authoritative head for the entity and stamps that note-id so promote can
// reject a stale update (HEAD_MISMATCH). Drafts never carry `supersedes` --
// that is materialized only when promote writes the reviewed snapshot.
//
// §0 hard invariants honored:
//   #3 inbox append-only, per-writer dir -> writes ONLY new files into its own
//      <machine>-<agent>/ dir; never edits existing files or anyone else's.
//   #5 dry-run default                   -> writes nothing unless VAULT_CAPTURE_APPLY=1.
//   #7 fixture-only / non-destructive    -> no-op unless VAULT_PATH is set; only
//      ever writes under the writer dir; every path is sanitized; the whole body
//      is wrapped so a hook bug can never block the user's session (always exit 0).
//   "only Claude Code host"              -> wired as a CC Stop hook (registration
//      is the host scope); opt out with VAULT_CAPTURE_DISABLE=1.
//
// Schema note (build-on-existing, landed in Task 1): review state reuses the
// existing AI-Output `status` field -- `draft` == unreviewed (NOT a new
// `unreviewed` word; kb_meta's currency sort only ranks draft/reviewed). The
// `last-verified` field is kebab-case to match compiler/currency.py.
//
// Wiring (the hook does NOT touch your live settings -- add this yourself):
//   .claude/settings.json:
//     { "hooks": { "Stop": [ { "hooks": [ {
//         "type": "command",
//         "command": "node /abs/path/to/scripts/hooks/capture-hook.mjs"
//     } ] } ] } }
//   export VAULT_PATH=/path/to/your/vault     # required; no-op without it
//   export VAULT_CAPTURE_APPLY=1              # opt in to actual writes (default: dry-run)
//
// Env knobs (all optional):
//   VAULT_PATH            vault root (required to do anything)
//   VAULT_CAPTURE_APPLY   "1"/"true" -> write; anything else -> dry-run (default)
//   VAULT_CAPTURE_DISABLE "1"/"true" -> hard off
//   VAULT_CAPTURE_AGENT   override agent id in <machine>-<agent> + frontmatter
//   VAULT_CAPTURE_TODAY   override last-verified date (YYYY-MM-DD; tests/determinism)
//   VAULT_CAPTURE_TOPIC   topic dir to prefer when resolving base-head from the
//                         compiled <topic>/wiki/_currency.json (else all topics scanned)
//   VAULT_CAPTURE_STATE   seen-log path (default ~/.vault-mind/capture-hook.seen.log)
//   VAULT_CAPTURE_DEBUG   "1" -> emit a stderr line even on no-op

import {
  readFileSync, existsSync, mkdirSync, writeFileSync, appendFileSync, readdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { hostname, homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const TRUE_RE = /^(1|true|yes|on)$/i;
// Outer fence may be ``` or ~~~ (3+). The closing fence backreferences the
// opener (\1), so a ~~~-fenced block can contain ``` code blocks in its body
// without truncating. Body is capture group 2.
const BLOCK_RE = /(`{3,}|~{3,})vault-capture[^\S\r\n]*\r?\n([\s\S]*?)\r?\n\1/g;
const META_KEY_RE = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/;
// Task 8G: honor the WORK-axis proposal fields `state` + `assignee` from the
// block (a capture is a proposal: the agent declares what state the work is in
// and who owns it). `supersedes` is intentionally NOT honored from the block --
// drafts never enter the supersession chain (8P: only `base-head`, an optimistic
// lock, is stamped on a draft; `supersedes` is materialized at promote time).
const ALLOWED_KEYS = new Set(['entity', 'type', 'source', 'title', 'status', 'state', 'assignee', 'blocked-by']);
const VALID_TYPES = new Set(['fact', 'decision', 'note', 'issue', 'initiative']);
const DEFAULT_TYPE = 'note';
const CURRENCY_REPORT_REL = 'wiki/_currency.json';

function envTrue(name) { return TRUE_RE.test(String(process.env[name] || '').trim()); }
function log(msg) { try { process.stderr.write(`[capture-hook] ${msg}\n`); } catch { /* ignore */ } }

// --- path / value safety ----------------------------------------------------

// A path segment safe to use as a directory or filename: no separators, no
// traversal, no control chars. Used for the writer dir and the slug so a
// hostile `entity`/`title` can never escape <VAULT>/00-Inbox/AI-Output/.
function safeSegment(s, fallback) {
  const cleaned = String(s == null ? '' : s)
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[\/\\]+/g, '-')         // path separators -> dash
    .replace(/\.\.+/g, '-')           // collapse .. traversal
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')    // no leading/trailing dot or dash
    .toLowerCase()
    .slice(0, 80);
  return cleaned || fallback;
}

// A frontmatter scalar value: single line, no fm-breaking chars left dangling.
function safeValue(s) {
  return String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim();
}

// entity / supersedes are single-valued. A stray [..] wrapper would be misread
// as a YAML list by the compiler's frontmatter parser (-> None -> the note is
// silently de-indexed by the currency passes), so strip it back to a scalar.
function unbracket(s) {
  return String(s == null ? '' : s).replace(/^\[\s*/, '').replace(/\s*\]$/, '').trim();
}

// blocked-by (Task 8C relation) is multi-valued -- the edges that make a
// conversation digest an entity graph (Task 10B). Accept `a`, `[a, b]`, or
// `a, b` and re-emit a clean inline YAML flow list the compiler parses as a real
// list (compiler/_md_parse.py: `[..]` -> split + strip quotes). Empty -> []. */
function listValue(s) {
  const raw = String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim();
  const inner = raw.replace(/^\[\s*/, '').replace(/\s*\]$/, '');
  return inner.split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

function slugify(s, fallback) {
  const words = String(s == null ? '' : s)
    .replace(/[`*_#>\[\]()]/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join('-');
  return safeSegment(words, fallback);
}

// --- transcript parsing -----------------------------------------------------

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

function loadTranscript(path) {
  try {
    return readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && typeof b === 'object' && b.type === 'text')
      .map((b) => b.text || '')
      .join('\n');
  }
  return '';
}

// Last assistant message that has real text -> its text + model id.
function lastAssistantText(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const msg = entries[i] && entries[i].message;
    if (!msg || msg.role !== 'assistant') continue;
    const text = textOf(msg.content).trim();
    if (text) return { text, model: typeof msg.model === 'string' ? msg.model : '' };
  }
  return { text: '', model: '' };
}

// First line of the last user turn -> parent-query (mirrors writeAIOutput).
function lastUserQuery(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const msg = entries[i] && entries[i].message;
    if (!msg || msg.role !== 'user') continue;
    const raw = textOf(msg.content).trim();
    // skip tool_result turns masquerading as user messages
    if (!raw || raw.startsWith('<') || /tool_use_id/.test(JSON.stringify(msg.content))) continue;
    return raw.split(/\r?\n/)[0].slice(0, 200);
  }
  return '';
}

// --- capture-block parsing --------------------------------------------------

// Parse one block body: leading `key: value` lines (allowed keys only), an
// optional `---` separator, then the markdown body.
function parseBlock(inner) {
  const lines = inner.split(/\r?\n/);
  const meta = {};
  let bodyStart = lines.length;
  for (let j = 0; j < lines.length; j++) {
    const t = lines[j].trim();
    if (t === '---') { bodyStart = j + 1; break; }
    if (t === '') continue;                     // blank line among meta -> keep scanning
    const m = META_KEY_RE.exec(lines[j]);
    if (m && ALLOWED_KEYS.has(m[1].toLowerCase())) {
      meta[m[1].toLowerCase()] = m[2].trim();
      continue;
    }
    bodyStart = j;                              // first non-key line -> body begins here
    break;
  }
  const body = lines.slice(bodyStart).join('\n').trim();
  return { meta, body };
}

function extractBlocks(text) {
  const out = [];
  BLOCK_RE.lastIndex = 0;
  let m;
  while ((m = BLOCK_RE.exec(text)) !== null) out.push(parseBlock(m[2]));
  return out;
}

// --- seen-log (idempotency) -------------------------------------------------

function seenLogPath() {
  return process.env.VAULT_CAPTURE_STATE
    || join(homedir(), '.vault-mind', 'capture-hook.seen.log');
}

function loadSeen(path) {
  try { return new Set(readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean)); }
  catch { return new Set(); }
}

function markSeen(path, key) {
  try { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, key + '\n', 'utf8'); }
  catch { /* best-effort */ }
}

// --- git HEAD (default source) ----------------------------------------------

function gitHead(cwd) {
  try {
    return execFileSync('git', ['-C', cwd, 'rev-parse', '--short', 'HEAD'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || '';
  } catch { return ''; }
}

// --- base-head resolution (Task 8G / 8P optimistic lock) --------------------
//
// A capture that names an `entity` is an UPDATE proposal against whatever note
// is the *current authoritative head* for that entity. We stamp that head's
// note-id as `base-head` so promote (Python, 8P) can verify nobody else moved
// the head meanwhile (HEAD_MISMATCH -> Conflicts). note-id == repo-relative
// POSIX path of the note (the same convention promote/supersedes use).
//
// Zero-dep, read-only. We do NOT mutate any authoritative state here.

// Repo-relative POSIX path of an absolute file under the vault root.
function relPosix(vaultRoot, abs) {
  let rel = abs.startsWith(vaultRoot) ? abs.slice(vaultRoot.length) : abs;
  return rel.replace(/^[\/\\]+/, '').replace(/\\/g, '/');
}

// Parse ONLY the leading `---\n...\n---` YAML block of a note into a flat map of
// lowercase scalar keys. Good enough for the few fields we read (entity, status,
// last-verified); list/nested values are kept as their raw string. No deps.
function readFrontmatter(abs) {
  let text;
  try { text = readFileSync(abs, 'utf8'); } catch { return null; }
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const km = META_KEY_RE.exec(line);
    if (km) fm[km[1].toLowerCase()] = km[2].trim();
  }
  return fm;
}

// Read one currency report and return the head note-id for `entity`, or ''. The
// on-disk artifact keys every scanned note under
// `byNote[note_id] = { entity, currentTruth, marker, ... }`; the current-truth
// note for an entity is the one with currentTruth === true. We also accept a
// literal top-level `current_truth: { <entity>: <note_id> }` map (the in-memory
// cmd_currency shape) so either producer resolves identically.
function headFromReportFile(reportAbs, entity) {
  if (!existsSync(reportAbs)) return '';
  let data;
  try { data = JSON.parse(readFileSync(reportAbs, 'utf8')); }
  catch { return ''; }                       // corrupt report -> caller falls through to scan
  if (data && data.current_truth && typeof data.current_truth[entity] === 'string') {
    return data.current_truth[entity];
  }
  const byNote = data && data.byNote;
  if (byNote && typeof byNote === 'object') {
    for (const [noteId, info] of Object.entries(byNote)) {
      if (info && info.currentTruth === true && info.entity === entity) return noteId;
    }
  }
  return '';
}

// Stage 1: compiled currency report(s). Prefer the explicit topic when given;
// otherwise (a vault can hold several topics) scan each top-level topic dir for a
// `wiki/_currency.json` and take the first that resolves the entity.
function headFromCurrencyReport(vault, topic, entity) {
  if (topic) {
    const hit = headFromReportFile(join(vault, topic, CURRENCY_REPORT_REL), entity);
    if (hit) return hit;
  }
  let ents;
  try { ents = readdirSync(vault, { withFileTypes: true }); } catch { return ''; }
  for (const e of ents) {
    if (!e.isDirectory() || e.name === '.git') continue;
    const hit = headFromReportFile(join(vault, e.name, CURRENCY_REPORT_REL), entity);
    if (hit) return hit;
  }
  return '';
}

// Stage 2: scan the vault for notes whose `entity` matches and that are
// AUTHORITATIVE -- status:reviewed, OR a legacy note with no draft/reviewed
// status (8P: is_authoritative_work_note). Pick the newest head EXACTLY as
// Python work_protocol._recency_key does, so the stamped base-head equals the
// head promote() will independently resolve (else a valid 'done' is wrongly
// routed to Conflicts/HEAD_MISMATCH). Comparator: (last-verified, status-rank,
// note-id) -- status-rank (reviewed:2 > legacy/none:0) dominates the note-id
// tiebreak, so a reviewed head beats a legacy head at equal last-verified
// regardless of path. Skips derived (wiki/) and inbox (00-Inbox/) trees --
// captures there are candidates, not heads.
const STATUS_RANK = { reviewed: 2, draft: 1 }; // mirrors work_protocol._recency_key
function headFromVaultScan(vault, entity) {
  let best = null; // { noteId, lv, rank }
  const walk = (absDir) => {
    let ents;
    try { ents = readdirSync(absDir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const abs = join(absDir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'wiki' || e.name === '00-Inbox' || e.name === '.git') continue;
        walk(abs);
        continue;
      }
      if (!e.name.endsWith('.md')) continue;
      const fm = readFrontmatter(abs);
      if (!fm || fm.entity == null) continue;
      if (unbracket(fm.entity) !== entity) continue;
      const status = (fm.status || '').toLowerCase();
      const authoritative = status === 'reviewed' || status === '';
      if (!authoritative) continue;            // draft/unreviewed candidate -> not a head
      const noteId = relPosix(vault, abs);
      const lv = fm['last-verified'] || '';
      const rank = STATUS_RANK[status] || 0;   // reviewed:2, legacy/none:0
      if (best === null
          || lv > best.lv
          || (lv === best.lv && rank > best.rank)
          || (lv === best.lv && rank === best.rank && noteId > best.noteId)) {
        best = { noteId, lv, rank };
      }
    }
  };
  walk(vault);
  return best ? best.noteId : '';
}

// Resolve the current authoritative head note-id for `entity`, in spec order:
// (1) currency report, (2) authoritative-note scan, (3) '' (brand-new entity ->
// promote materializes a fresh head; no optimistic lock to stamp).
function resolveBaseHead(vault, topic, entity) {
  if (!entity) return '';
  return headFromCurrencyReport(vault, topic, entity) || headFromVaultScan(vault, entity);
}

// --- frontmatter assembly ---------------------------------------------------

function buildNote({ block, writerId, agent, parentQuery, nowIso, today, source, baseHead, sessionId }) {
  const entity = unbracket(safeValue(block.meta.entity));
  let type = safeValue(block.meta.type).toLowerCase();
  if (!VALID_TYPES.has(type)) type = DEFAULT_TYPE;
  // Task 8G WORK-axis proposal fields. `state` is the agent's claim about where
  // the work stands (validated/normalized by 8P promote, not here -- the hook is
  // a faithful scribe of the proposal). `assignee` is the work owner the agent
  // declares; when omitted, promote/resolve_assignee inherits it from the
  // previous head or maps writer identity -- it is NOT taken from generated-by.
  const state = safeValue(block.meta.state);
  const assignee = unbracket(safeValue(block.meta.assignee));
  const blockedBy = listValue(block.meta['blocked-by']);
  const parentEsc = parentQuery.replace(/"/g, '”');

  // status: draft is the REVIEW axis and stays draft ALWAYS -- a capture is a
  // proposal, never self-reviewed. The WORK axis (state) is independent.
  const yaml = [
    `generated-by: ${writerId}`,
    `generated-at: ${nowIso}`,
    `agent: ${agent}`,
    `parent-query: "${parentEsc}"`,
    'source-nodes: []',
    'status: draft',
    'scope: project',
    'quarantine-state: new',
  ];
  // Task 10B: stamp the conversation-digest provenance so a group of captures
  // emitted from ONE session is identifiable (groupable in triage). A dedicated
  // key -- NOT the federation `origin` (a nested map), which this must not shadow.
  if (sessionId) yaml.push(`digest-session: ${safeValue(sessionId)}`);
  if (entity) yaml.push(`entity: ${entity}`);
  yaml.push(`type: ${type}`);
  if (state) yaml.push(`state: ${state}`);
  if (assignee) yaml.push(`assignee: ${assignee}`);
  // Task 10B/8C: the digest's edges. A list so the compiler reads it as a real
  // blocked-by relation (-> effective_state blocked, -> a canvas edge in 10A).
  if (blockedBy.length) yaml.push(`blocked-by: [${blockedBy.join(', ')}]`);
  if (source) yaml.push(`source: ${source}`);
  yaml.push(`last-verified: ${today}`);
  // 8P optimistic lock: stamp the resolved authoritative head as `base-head`.
  // Drafts NEVER carry `supersedes` (that is materialized at promote time) --
  // only `base-head`. A brand-new entity resolves to '' -> no base-head, and
  // promote materializes a fresh head.
  if (entity && baseHead) yaml.push(`base-head: ${baseHead}`);

  const body = block.body || '(no body)';
  const content = `---\n${yaml.join('\n')}\n---\n\n${body}\n`;
  return { content, entity, type, source: source || '', state, assignee, blockedBy, baseHead: baseHead || '' };
}

// --- main -------------------------------------------------------------------

function run() {
  if (envTrue('VAULT_CAPTURE_DISABLE')) { if (envTrue('VAULT_CAPTURE_DEBUG')) log('disabled'); return; }

  let payload;
  try { payload = JSON.parse(readStdin() || '{}'); } catch { return; }
  if (!payload || typeof payload !== 'object') return;

  const vault = process.env.VAULT_PATH;
  if (!vault || !existsSync(vault)) { if (envTrue('VAULT_CAPTURE_DEBUG')) log('no VAULT_PATH'); return; }

  const transcriptPath = payload.transcript_path || '';
  if (!transcriptPath || !existsSync(transcriptPath)) {
    if (envTrue('VAULT_CAPTURE_DEBUG')) log('no transcript'); return;
  }

  const entries = loadTranscript(transcriptPath);
  const { text, model } = lastAssistantText(entries);
  const blocks = extractBlocks(text);
  if (blocks.length === 0) { if (envTrue('VAULT_CAPTURE_DEBUG')) log('no vault-capture block'); return; }

  const sid = String(payload.session_id || 'unknown');
  const cwd = payload.cwd || process.cwd();
  const apply = envTrue('VAULT_CAPTURE_APPLY');

  const agent = safeSegment(process.env.VAULT_CAPTURE_AGENT || model || 'claude', 'claude');
  const machine = safeSegment(hostname(), 'host');
  const writerId = `${machine}-${agent}`;
  const writerDirRel = `00-Inbox/AI-Output/${writerId}`;
  const writerDirAbs = join(vault, writerDirRel);

  const nowIso = new Date().toISOString();
  const today = safeValue(process.env.VAULT_CAPTURE_TODAY) || nowIso.slice(0, 10);
  const datePrefix = today;
  const parentQuery = lastUserQuery(entries);
  const defaultSource = gitHead(cwd) ? `commit:${gitHead(cwd)}` : '';

  const statePath = seenLogPath();
  const seen = loadSeen(statePath);

  let wrote = 0, skipped = 0, planned = 0;

  // Invariant (a): base-head resolution must NEVER read outside the vault. topic
  // is joined onto the vault root to find <topic>/wiki/_currency.json, so it must
  // be a single in-vault path segment -- safeSegment collapses `..` and `/` to
  // dashes (an unsanitized `../x` would read an out-of-vault report). '' -> the
  // auto-scan fallback over every in-vault top-level dir (already in-vault).
  const topic = safeSegment(process.env.VAULT_CAPTURE_TOPIC || '', '');

  for (const block of blocks) {
    // 8G/8P: resolve the current authoritative head for the entity and stamp it
    // as the optimistic-lock `base-head`. Read-only; never mutates a head.
    const entityForHead = unbracket(safeValue(block.meta.entity));
    const baseHead = resolveBaseHead(vault, topic, entityForHead);
    const note = buildNote({
      block, writerId, agent, parentQuery, nowIso, today,
      source: safeValue(block.meta.source) || defaultSource,
      baseHead, sessionId: sid,
    });

    // Idempotency key: session + the AGENT-AUTHORED semantic payload. The
    // resolved git-HEAD default and timestamps are deliberately excluded so a
    // re-run of the same Stop hashes identically even if HEAD moved meanwhile.
    const idSource = safeValue(block.meta.source);
    const blockHash = createHash('sha256')
      .update(`${note.entity}\n${idSource}\n${block.body}`)
      .digest('hex').slice(0, 16);
    const key = `${sid}:${blockHash}`;
    if (seen.has(key)) { skipped++; log(`skip (already captured): ${blockHash}`); continue; }
    seen.add(key); // also dedupes a duplicate block later in THIS same message

    const slug = slugify(block.meta.title || block.body, `note-${blockHash.slice(0, 6)}`);
    const baseName = `${datePrefix}-${slug}`;

    if (!note.entity) {
      log('note: no entity -> filed as plain AI-Output, NOT indexed by the currency passes');
    }

    if (!apply) {
      // Plan only: probe the next free name for display. No write -> race-free.
      let chosen = `${baseName}.md`;
      for (let i = 2; i <= 99 && existsSync(join(writerDirAbs, chosen)); i++) chosen = `${baseName}-${i}.md`;
      planned++;
      log(`DRY-RUN would write: ${writerDirRel}/${chosen}`);
      log(`  entity=${note.entity || '(none)'} type=${note.type} state=${note.state || '(none)'} assignee=${note.assignee || '(none)'} source=${note.source || '(none)'} status=draft last-verified=${today}`);
      if (note.baseHead) log(`  base-head=${note.baseHead}`);
      continue;
    }

    // Append-only, race-safe: exclusive create (O_EXCL via 'wx'). Never
    // overwrite; on a real concurrent collision advance to -N instead.
    try { mkdirSync(writerDirAbs, { recursive: true }); } catch { /* created lazily below */ }
    let written = null;
    for (let i = 1; i <= 99; i++) {
      const chosen = i === 1 ? `${baseName}.md` : `${baseName}-${i}.md`;
      const abs = join(writerDirAbs, chosen);
      try {
        writeFileSync(abs, note.content, { encoding: 'utf8', flag: 'wx' });
        written = `${writerDirRel}/${chosen}`;
        break;
      } catch (e) {
        if (e && e.code === 'EEXIST') continue; // taken (existing file or a racing writer)
        log(`write failed for ${writerDirRel}/${chosen}: ${e && e.message}`);
        break;
      }
    }
    if (written) {
      markSeen(statePath, key);
      wrote++;
      log(`wrote: ${written}`);
    } else {
      log(`no free filename for ${baseName}, skipping`);
    }
  }

  if (!apply && planned > 0) log('DRY-RUN (set VAULT_CAPTURE_APPLY=1 to write)');
  if (envTrue('VAULT_CAPTURE_DEBUG')) log(`done wrote=${wrote} planned=${planned} skipped=${skipped}`);
}

try { run(); } catch (e) {
  // A capture-hook bug must never block the session. Swallow + log, exit 0.
  try { process.stderr.write(`[capture-hook] error: ${e && e.message}\n`); } catch { /* ignore */ }
}
process.exit(0);
