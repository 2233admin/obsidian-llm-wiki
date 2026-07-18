// work-OS mirror: a faithful TS port of the Python work-OS brain
// (currency.py + work_protocol.py + work_driver.py board logic + _md_parse.parse_frontmatter).
//
// Pure functions over the filesystem. The board is rendered HERE in TypeScript,
// byte-for-byte equal to the Python `kb_meta.py work board` renderer (proven by
// parity.test.ts). NO python subprocess is ever invoked by the server.
//
// Source of truth = the work-OS markdown notes under <vault>/01-Projects/<proj>/issues/.
// The board is a derived view; this module never mutates note files.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// --- canonical work states (currency.py) -----------------------------------

export const STATE_BACKLOG = 'backlog';
export const STATE_TODO = 'todo';
export const STATE_IN_PROGRESS = 'in-progress';
export const STATE_DONE = 'done';
export const STATE_CANCELED = 'canceled';
export const CANONICAL_STATES = new Set([
  STATE_BACKLOG,
  STATE_TODO,
  STATE_IN_PROGRESS,
  STATE_DONE,
  STATE_CANCELED,
]);
export const DEFAULT_STATE = STATE_BACKLOG;
export const STATE_BLOCKED = 'blocked';

// Legacy `status`/`state` words -> canonical state (currency._LEGACY_STATE_MAP).
const LEGACY_STATE_MAP: Record<string, string> = {
  open: STATE_TODO,
  'in progress': STATE_IN_PROGRESS,
  in_progress: STATE_IN_PROGRESS,
  completed: STATE_DONE,
  done: STATE_DONE,
  cancelled: STATE_CANCELED,
  canceled: STATE_CANCELED,
  archived: STATE_CANCELED,
  closed: STATE_DONE,
  active: STATE_IN_PROGRESS,
  paused: STATE_TODO,
  planned: STATE_BACKLOG,
};
const LEGACY_BLOCKED_WORD = 'blocked';

// --- priority (currency.py) ------------------------------------------------

// PRIORITY_RANK = {1:0, 2:1, 3:2, 4:3, 0:4, None:4}; lower rank sorts first.
const PRIORITY_RANK: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 3, 0: 4 };
const PRIORITY_RANK_NONE = 4;
export const VALID_PRIORITIES = new Set([0, 1, 2, 3, 4]);

// --- kanban columns (work_driver.py) ---------------------------------------

export const KANBAN_COLUMNS = ['Backlog', 'Todo', 'In Progress', 'Blocked', 'Done', 'Canceled'] as const;
type KanbanColumn = (typeof KANBAN_COLUMNS)[number];

const STATE_COLUMN: Record<string, KanbanColumn> = {
  [STATE_BACKLOG]: 'Backlog',
  [STATE_TODO]: 'Todo',
  [STATE_IN_PROGRESS]: 'In Progress',
  [STATE_DONE]: 'Done',
  [STATE_CANCELED]: 'Canceled',
};
const DONE_COLUMNS = new Set<string>(['Done', 'Canceled']);

// Localized lane labels (copied char-for-char from work_driver.COLUMN_LABELS).
export const COLUMN_LABELS: Record<string, Record<string, string>> = {
  en: { Backlog: 'Backlog', Todo: 'Todo', 'In Progress': 'In Progress', Blocked: 'Blocked', Done: 'Done', Canceled: 'Canceled' },
  zh: { Backlog: '储备', Todo: '待办', 'In Progress': '进行中', Blocked: '受阻', Done: '已完成', Canceled: '已取消' },
  ja: { Backlog: 'バックログ', Todo: '未着手', 'In Progress': '進行中', Blocked: 'ブロック', Done: '完了', Canceled: 'キャンセル' },
};

// --- blocker verdicts (work_protocol.py) -----------------------------------

const BLOCKER_BROKEN_REF = 'BROKEN_REF';
const BLOCKER_TRUTH_CONFLICT = 'TRUTH_CONFLICT';
const BLOCKER_RESOLVED = 'RESOLVED';
const BLOCKER_CANCELED_DEPENDENCY = 'CANCELED_DEPENDENCY';
const BLOCKER_UNRESOLVED = 'UNRESOLVED';
const BLOCKER_UNSATISFIED = new Set<string>([
  BLOCKER_UNRESOLVED,
  BLOCKER_BROKEN_REF,
  BLOCKER_TRUTH_CONFLICT,
  BLOCKER_CANCELED_DEPENDENCY,
]);

// --- review axis (work_protocol.py) ----------------------------------------

export const F_REVIEW = 'review';
export const F_STATUS = 'status';
export const STATUS_DRAFT = 'draft';
export const STATUS_REVIEWED = 'reviewed';

// === frontmatter types =====================================================

export type FmValue = string | string[] | Record<string, string> | boolean;
export type Frontmatter = Record<string, FmValue>;

export interface WorkNote {
  note_id: string; // POSIX path relative to vault
  path: string; // absolute fs path
  raw: Frontmatter;
  body: string;
  entity: string | null;
}

// === frontmatter parser (port of compiler/_md_parse.parse_frontmatter) ======

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
const KEY_RE = /^[A-Za-z_][\w-]*\s*:/;
const INDENTED_CHILD_RE = /^[ \t]+[A-Za-z_][\w-]*\s*:/;

function splitQuotedList(value: string): string[] {
  // Port of _md_parse.split_quoted_list: comma-split honoring quotes/escapes.
  const items: string[] = [];
  let current = '';
  let quote: string | null = null;
  let escaped = false;
  for (const ch of value) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\' && quote) {
      current += ch;
      escaped = true;
      continue;
    }
    if (ch === "'" || ch === '"') {
      if (quote === ch) quote = null;
      else if (quote === null) quote = ch;
      current += ch;
      continue;
    }
    if (ch === ',' && quote === null) {
      const item = current.trim();
      if (item) items.push(item);
      current = '';
      continue;
    }
    current += ch;
  }
  const last = current.trim();
  if (last) items.push(last);
  return items;
}

function stripBracketListComment(value: string): string {
  // Port of _md_parse.strip_bracket_list_comment.
  if (!value.startsWith('[')) return value;
  const close = value.indexOf(']');
  const hashPos = value.indexOf('#');
  if (close !== -1 && hashPos !== -1 && close < hashPos) {
    return value.slice(0, hashPos).replace(/\s+$/, '');
  }
  return value;
}

function stripQuotes(s: string): string {
  // Python's str.strip("'\"") removes any leading/trailing run of ' and " chars.
  return s.replace(/^['"]+/, '').replace(/['"]+$/, '');
}

export function parseFm(text: string): Frontmatter {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return {};
  const fm = m[0];
  const out: Frontmatter = {};
  let currentKey: string | null = null;
  // splitlines() semantics: split on \n; strip trailing \r per line.
  for (const rawLine of fm.split('\n')) {
    const raw = rawLine.replace(/\r$/, '');
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed === '---') continue;
    if (KEY_RE.test(raw)) {
      const idx = raw.indexOf(':');
      const k = raw.slice(0, idx).trim();
      let v = stripBracketListComment(raw.slice(idx + 1).trim());
      if (v.startsWith('[') && v.endsWith(']')) {
        out[k] = splitQuotedList(v.slice(1, -1))
          .filter((x) => x.trim())
          .map((x) => stripQuotes(x.trim()));
        currentKey = null;
      } else if (v) {
        out[k] = stripQuotes(v.trim());
        currentKey = null;
      } else {
        out[k] = [];
        currentKey = k;
      }
    } else if (currentKey && raw.replace(/^\s+/, '').startsWith('- ')) {
      const val = stripQuotes(raw.replace(/^\s+/, '').slice(2).trim());
      const lst = out[currentKey];
      if (Array.isArray(lst)) lst.push(val);
    } else if (currentKey && (raw[0] === ' ' || raw[0] === '\t') && INDENTED_CHILD_RE.test(raw)) {
      // Indented `child: value` under a bare `key:` -> nested single-level map.
      const trimmedRaw = raw.replace(/^\s+/, '');
      const cidx = trimmedRaw.indexOf(':');
      const ck = trimmedRaw.slice(0, cidx).trim();
      const cv = stripQuotes(stripBracketListComment(trimmedRaw.slice(cidx + 1).trim()).trim());
      let existing = out[currentKey];
      if (Array.isArray(existing) && existing.length === 0) {
        out[currentKey] = {};
        existing = out[currentKey];
      }
      if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
        (existing as Record<string, string>)[ck] = cv;
      }
    }
  }
  return out;
}

export function splitBody(text: string): string {
  // Strip the leading frontmatter fence; return the rest (mirror _split_frontmatter).
  const m = FRONTMATTER_RE.exec(text);
  return m ? text.slice(m[0].length) : text;
}

// === scalar / field helpers ================================================

function scalar(raw: Frontmatter, key: string): string | null {
  // Mirror currency._scalar: trimmed scalar string, lists -> null.
  const v = raw[key];
  if (typeof v === 'string') {
    const t = v.trim();
    return t || null;
  }
  if (Array.isArray(v)) return null;
  if (v === undefined || v === null) return null;
  return String(v);
}

function entityOf(raw: Frontmatter): string | null {
  return scalar(raw, 'entity');
}

// === state / priority predicates (currency.py) ==============================

function mapStateWord(word: string | null): string | null {
  if (!word) return null;
  const w = word.trim().toLowerCase();
  if (!w) return null;
  if (CANONICAL_STATES.has(w)) return w;
  if (w === LEGACY_BLOCKED_WORD) return STATE_IN_PROGRESS;
  return LEGACY_STATE_MAP[w] ?? null;
}

export function workState(raw: Frontmatter): string {
  // explicit `state` field wins, else legacy `status`, else DEFAULT_STATE.
  const mapped = mapStateWord(scalar(raw, 'state'));
  if (mapped !== null) return mapped;
  const legacy = mapStateWord(scalar(raw, F_STATUS));
  if (legacy !== null) return legacy;
  return DEFAULT_STATE;
}

export function workPriority(raw: Frontmatter): number | null {
  // Read `priority` as an int in 0..4, else null. Booleans rejected.
  // Mirrors currency.work_priority: out-of-range / non-int / absent -> null
  // (ranked last), NEVER raises. Use this on every READ path so a hand-edited or
  // Python-authored note with an off-range priority is tolerated, not rejected.
  const v = raw['priority'];
  if (typeof v === 'boolean') return null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) return null;
    if (!/^[+-]?\d+$/.test(t)) return null;
    const n = Number.parseInt(t, 10);
    return VALID_PRIORITIES.has(n) ? n : null;
  }
  if (typeof v === 'number' && Number.isInteger(v)) {
    return VALID_PRIORITIES.has(v) ? v : null;
  }
  return null;
}

export function priorityRank(raw: Frontmatter): number {
  const p = workPriority(raw);
  if (p === null) return PRIORITY_RANK_NONE;
  return PRIORITY_RANK[p] ?? PRIORITY_RANK_NONE;
}

// _sort_key(note) = [priority_rank, note_id]
function sortNotes(notes: WorkNote[]): WorkNote[] {
  return [...notes].sort((a, b) => {
    const ra = priorityRank(a.raw);
    const rb = priorityRank(b.raw);
    if (ra !== rb) return ra - rb;
    return a.note_id < b.note_id ? -1 : a.note_id > b.note_id ? 1 : 0;
  });
}

// === review axis (work_protocol.py) ========================================

function statusOf(raw: Frontmatter): string | null {
  // review-axis: `review` first, fall back to legacy `status`, lowercased.
  let v: FmValue | undefined = raw[F_REVIEW];
  if (typeof v !== 'string' || !v.trim()) v = raw[F_STATUS];
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    return t || null;
  }
  return null;
}

export function isAuthoritative(raw: Frontmatter): boolean {
  // reviewed -> true; draft -> false; neither (legacy) -> true.
  const s = statusOf(raw);
  if (s === STATUS_REVIEWED) return true;
  if (s === STATUS_DRAFT) return false;
  return true;
}

// === scan ==================================================================

const SKIP_DIRS = new Set(['node_modules', 'schema']);

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function walkMd(vaultPath: string, requireEntity: boolean): WorkNote[] {
  const notes: WorkNote[] = [];
  let rootStat;
  try {
    rootStat = statSync(vaultPath);
  } catch {
    return notes;
  }
  if (!rootStat.isDirectory()) return notes;

  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const dirs = entries
      .filter(
        (e) =>
          e.isDirectory() &&
          !SKIP_DIRS.has(e.name) &&
          !e.name.startsWith('.') &&
          !e.name.startsWith('_'),
      )
      .map((e) => e.name)
      .sort();
    const files = entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => e.name)
      .sort();
    for (const fn of files) {
      const f = join(dir, fn);
      let text: string;
      try {
        text = stripBom(readFileSync(f, 'utf-8'));
      } catch {
        continue;
      }
      const raw = parseFm(text);
      const entity = entityOf(raw);
      if (requireEntity && !entity) continue;
      const noteId = relPosix(vaultPath, f);
      notes.push({ note_id: noteId, path: f, raw, body: splitBody(text), entity });
    }
    for (const d of dirs) walk(join(dir, d));
  };
  walk(vaultPath);
  notes.sort((a, b) => (a.note_id < b.note_id ? -1 : a.note_id > b.note_id ? 1 : 0));
  return notes;
}

function relPosix(root: string, full: string): string {
  // POSIX path of full relative to root.
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const f = full.replace(/\\/g, '/');
  const rel = f.startsWith(r + '/') ? f.slice(r.length + 1) : f;
  return rel;
}

export function scanWorkNotes(vaultPath: string): WorkNote[] {
  return walkMd(vaultPath, true);
}

export function scanAllNotes(vaultPath: string): WorkNote[] {
  return walkMd(vaultPath, false);
}

// === head resolution (work_protocol.resolve_head) ==========================

interface HeadResolution {
  head: WorkNote | null;
  terminalHeads: WorkNote[];
  truthConflict: boolean;
  conflictNoteIds: string[];
}

function recencyKey(n: WorkNote): [string, number, string] {
  const lv = scalar(n.raw, 'last-verified') ?? '';
  const s = statusOf(n.raw);
  const rank = s === STATUS_REVIEWED ? 2 : s === STATUS_DRAFT ? 1 : 0;
  return [lv, rank, n.note_id];
}

function recencyCmp(a: WorkNote, b: WorkNote): number {
  const ka = recencyKey(a);
  const kb = recencyKey(b);
  if (ka[0] !== kb[0]) return ka[0] < kb[0] ? -1 : 1;
  if (ka[1] !== kb[1]) return ka[1] - kb[1];
  return ka[2] < kb[2] ? -1 : ka[2] > kb[2] ? 1 : 0;
}

function maxBy<T>(items: T[], cmp: (a: T, b: T) => number): T {
  // Python max() returns the FIRST maximal element; replicate that tie-break.
  let best = items[0];
  for (let i = 1; i < items.length; i += 1) {
    if (cmp(items[i], best) > 0) best = items[i];
  }
  return best;
}

function resolveNoteId(target: string, group: WorkNote[]): WorkNote | null {
  // Port of work_protocol._resolve_note_id.
  if (!target) return null;
  const t = target.trim().replace(/\\/g, '/');
  for (const n of group) if (n.note_id === t) return n;
  const lstripDotSlash = t.replace(/^[./]+/, '');
  for (const n of group) {
    if (n.note_id.endsWith('/' + t) || n.note_id === lstripDotSlash) return n;
  }
  const stem = baseName(t);
  const stemNoext = stem.endsWith('.md') ? stem.slice(0, -3) : stem;
  for (const n of group) {
    const pn = baseName(n.path.replace(/\\/g, '/'));
    const pstem = pn.endsWith('.md') ? pn.slice(0, -3) : pn;
    if (pn === stem || pstem === stemNoext) return n;
  }
  return null;
}

function baseName(p: string): string {
  const parts = p.split('/');
  return parts[parts.length - 1];
}

export function resolveHead(notes: WorkNote[], entity: string): HeadResolution {
  const group = notes.filter((n) => n.entity === entity && isAuthoritative(n.raw));
  if (group.length === 0) return { head: null, terminalHeads: [], truthConflict: false, conflictNoteIds: [] };

  const supersededIds = new Set<string>();
  for (const n of group) {
    const tgt = scalar(n.raw, 'supersedes');
    if (!tgt) continue;
    const victim = resolveNoteId(tgt, group);
    if (victim && victim.note_id !== n.note_id) supersededIds.add(victim.note_id);
  }

  let terminal = group.filter((n) => !supersededIds.has(n.note_id));
  if (terminal.length === 0) terminal = [...group];

  const reviewedTerminal = terminal.filter((n) => statusOf(n.raw) === STATUS_REVIEWED);
  const truthConflict = reviewedTerminal.length >= 2;

  const head = maxBy(terminal, recencyCmp);
  return {
    head,
    terminalHeads: [...terminal].sort((a, b) => (a.note_id < b.note_id ? -1 : a.note_id > b.note_id ? 1 : 0)),
    truthConflict,
    conflictNoteIds: reviewedTerminal.map((n) => n.note_id).sort(),
  };
}

// === blocker graph (work_protocol.py) ======================================

export function blockedByRefs(raw: Frontmatter): string[] {
  // Read persisted `blocked-by` as a deduped, order-preserving entity list.
  const v = raw['blocked-by'];
  if (v === undefined || v === null) return [];
  const items = Array.isArray(v) ? v : [v];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (it === null || it === undefined) continue;
    const s = String(it).trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function blockerStatus(targetEntity: string, notes: WorkNote[]): string {
  const res = resolveHead(notes, targetEntity);
  if (res.head === null) return BLOCKER_BROKEN_REF;
  if (res.truthConflict) return BLOCKER_TRUTH_CONFLICT;
  const state = workState(res.head.raw);
  if (state === STATE_DONE) return BLOCKER_RESOLVED;
  if (state === STATE_CANCELED) return BLOCKER_CANCELED_DEPENDENCY;
  return BLOCKER_UNRESOLVED;
}

export function hasUnresolvedBlocker(notes: WorkNote[], entity: string): boolean {
  const res = resolveHead(notes, entity);
  if (res.head === null) return false;
  for (const target of blockedByRefs(res.head.raw)) {
    if (BLOCKER_UNSATISFIED.has(blockerStatus(target, notes))) return true;
  }
  return false;
}

// === board (work_driver.py) ================================================

export function boardColumns(notes: WorkNote[], project?: string): Record<string, string[]> {
  const cols: Record<string, WorkNote[]> = {};
  for (const c of KANBAN_COLUMNS) cols[c] = [];
  const prefix = project ? `project/${project}/` : null;
  for (const n of notes) {
    const ent = n.entity;
    if (!ent) continue;
    if (scalar(n.raw, 'type') === 'project') continue; // container note is not a card
    if (prefix && !ent.startsWith(prefix)) continue;
    const state = workState(n.raw);
    let column: KanbanColumn = STATE_COLUMN[state] ?? 'Backlog';
    if ((state === STATE_TODO || state === STATE_IN_PROGRESS) && hasUnresolvedBlocker(notes, ent)) {
      column = 'Blocked';
    }
    cols[column].push(n);
  }
  const out: Record<string, string[]> = {};
  for (const c of KANBAN_COLUMNS) out[c] = sortNotes(cols[c]).map((n) => n.note_id);
  return out;
}

export function cardLabel(note: WorkNote): string {
  // first non-blank body line; else entity leaf; else note_id.
  for (const line of (note.body || '').split('\n')) {
    if (line.trim()) return line.trim();
  }
  if (note.entity) {
    const parts = note.entity.split('/');
    return parts[parts.length - 1];
  }
  return note.note_id;
}

export function renderKanbanBoard(notes: WorkNote[], project?: string, lang = 'en'): string {
  const cols = boardColumns(notes, project);
  const byId = new Map(notes.map((n) => [n.note_id, n]));
  const labels = COLUMN_LABELS[lang] ?? COLUMN_LABELS.en;
  const out: string[] = ['---', '', 'kanban-plugin: board', '', '---', ''];
  for (const column of KANBAN_COLUMNS) {
    out.push(`## ${labels[column] ?? column}`);
    out.push('');
    const mark = DONE_COLUMNS.has(column) ? 'x' : ' ';
    for (const nid of cols[column]) {
      const note = byId.get(nid);
      if (note) out.push(`- [${mark}] ${cardLabel(note)}`);
    }
    out.push('');
  }
  out.push('%% kanban:settings', '```', '{"kanban-plugin":"board","show-checkboxes":true}', '```', '%%', '');
  return out.join('\n');
}

// === language detection (work_driver.py) ===================================

export function detectLang(text: string): string {
  // Mirror work_driver.detect_lang: kana (U+3040..U+30FF, i.e. '぀'..'ヿ') -> ja
  // (checked first because Japanese also uses Han); else any CJK Han
  // (U+4E00..U+9FFF) -> zh; else en. The lower bound is 0x3040 (NOT 0x3080):
  // the hiragana sub-block U+3040..U+307F holds most everyday hiragana (あ=0x3042,
  // か=0x304b, the particles の/し, ...), so 0x3080 would misdetect a pure-hiragana
  // vault as 'en' and diverge from the Python renderer. Iterate by code point so
  // surrogate pairs are handled correctly.
  const s = text || '';
  for (const c of s) {
    const cp = c.codePointAt(0)!;
    if (cp >= 0x3040 && cp <= 0x30ff) return 'ja';
  }
  for (const c of s) {
    const cp = c.codePointAt(0)!;
    if (cp >= 0x4e00 && cp <= 0x9fff) return 'zh';
  }
  return 'en';
}

export function detectVaultLang(notes: WorkNote[], sample = 200): string {
  const buf: string[] = [];
  for (const n of notes.slice(0, sample)) {
    if (n.entity) buf.push(n.entity);
    if (n.body) buf.push(n.body);
  }
  return detectLang(buf.join('\n'));
}
