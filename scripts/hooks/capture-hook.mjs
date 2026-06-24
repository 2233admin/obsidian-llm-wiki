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
// _scan_entity_notes), and the Task 6 e2e needs the captured note to carry
// `entity` + `supersedes`. The agent alone knows those, so it declares them in
// the block; the hook auto-fills the mechanical fields it can derive.
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
const ALLOWED_KEYS = new Set(['entity', 'type', 'source', 'supersedes', 'title', 'status']);
const VALID_TYPES = new Set(['fact', 'decision', 'note']);
const DEFAULT_TYPE = 'note';

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

// --- frontmatter assembly ---------------------------------------------------

function buildNote({ block, writerId, agent, parentQuery, nowIso, today, source }) {
  const entity = unbracket(safeValue(block.meta.entity));
  const supersedes = unbracket(safeValue(block.meta.supersedes));
  let type = safeValue(block.meta.type).toLowerCase();
  if (!VALID_TYPES.has(type)) type = DEFAULT_TYPE;
  const parentEsc = parentQuery.replace(/"/g, '”');

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
  if (entity) yaml.push(`entity: ${entity}`);
  yaml.push(`type: ${type}`);
  if (source) yaml.push(`source: ${source}`);
  yaml.push(`last-verified: ${today}`);
  if (supersedes) yaml.push(`supersedes: ${supersedes}`);

  const body = block.body || '(no body)';
  const content = `---\n${yaml.join('\n')}\n---\n\n${body}\n`;
  return { content, entity, type, source: source || '', supersedes };
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

  for (const block of blocks) {
    const note = buildNote({
      block, writerId, agent, parentQuery, nowIso, today,
      source: safeValue(block.meta.source) || defaultSource,
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
      log(`  entity=${note.entity || '(none)'} type=${note.type} source=${note.source || '(none)'} status=draft last-verified=${today}`);
      if (note.supersedes) log(`  supersedes=${note.supersedes}`);
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
