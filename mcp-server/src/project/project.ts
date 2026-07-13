// project_* MCP tools -- a THIN ADAPTER over the work-OS notes (the single source
// of truth). Issue notes live under <vault>/01-Projects/<proj>/issues/<slug>.md as
// rhizome-compliant work-OS frontmatter; the Kanban board is rendered on demand by
// the TS port in workos.ts (byte-equal to the Python `work board`). The old docket
// store (10-Projects/<proj>/docket/**) is gone -- no ISSUE-N ids, no board.md seed.
//
// TS-only, no python subprocess.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Operation, OperationContext } from '../core/types.js';
import { makeErr } from '../core/types.js';
import { projectPolicyBasePath, resultPath, touchMarkdown } from '../core/write-policy.js';
import {
  makeProjectContextOps,
  parseProjectId,
  projectSlug,
  resolveProjectContext,
} from './project-context.js';
import {
  scanWorkNotes,
  isAuthoritative,
  workState,
  workPriority,
  blockedByRefs,
  renderKanbanBoard,
  detectVaultLang,
  parseFm,
  splitBody,
  DEFAULT_STATE,
  STATE_TODO,
  type Frontmatter,
  type FmValue,
  type WorkNote,
} from './workos.js';

// --- safe path segments ----------------------------------------------------

function safeSegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed === '.' ||
    trimmed === '..' ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    /^[A-Za-z]:/.test(trimmed) ||
    trimmed.startsWith('//')
  ) {
    throw makeErr(-32602, `${label} must be single safe path segment`);
  }
  return trimmed;
}

// slug = lowercase-kebab of an id leaf. Mirrors the rhizome id contract second
// segment (^[a-z0-9][a-z0-9-]*$). Collapses runs of non-[a-z0-9] to '-'.
function slugify(value: string): string {
  const s = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s;
}

// Project key used for BOTH the folder segment and the rhizome id/entity FIRST
// segment. safeSegment only rejects path separators -- it does NOT lowercase or
// restrict to [a-z0-9-], so a key like 'My_Proj' or 'Alpha' would yield an
// id (`My_Proj/hello-world`) that fails rhizome/contract _ID_RE
// (^[a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9-]*$). Slugify it to a valid first segment
// so issue_create always writes a contract-valid id. Idempotent for keys that
// are already lowercase-kebab (the existing-test case), so layout is unchanged.
function projectKey(value: unknown): string {
  if (typeof value === 'string' && value.trim().startsWith('project/')) {
    return projectSlug(parseProjectId(value.trim()));
  }
  const seg = safeSegment(String(value ?? ''), 'project');
  const slug = slugify(seg);
  if (!slug) throw makeErr(-32602, 'project must contain at least one [a-z0-9] character');
  return slug;
}

function existingProjectKey(vaultPath: string, value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw makeErr(-32602, 'project reference required');
  return resolveProjectContext(vaultPath, value.trim(), 'project.operations').slug;
}

function actorFromContext(ctx: OperationContext): string {
  return safeSegment(ctx.config.collaboration?.actor || process.env.VAULT_MIND_ACTOR || 'agent', 'actor');
}

// --- paths (work-OS layout) ------------------------------------------------

function projectRoot(project: string): string {
  return `01-Projects/${safeSegment(project, 'project')}`;
}

function issuesRoot(project: string): string {
  return `${projectRoot(project)}/issues`;
}

function projectNotePath(project: string): string {
  return `${projectRoot(project)}/_project.md`;
}

function issuePath(project: string, slug: string): string {
  return `${issuesRoot(project)}/${slug}.md`;
}

function viewsRoot(project: string): string {
  return `${projectRoot(project)}/views`;
}

// --- fs helpers ------------------------------------------------------------

function readText(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf-8') : null;
}

export function writeVaultBytes(vaultPath: string, relPath: string, content: string): void {
  const fullPath = join(vaultPath, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  // Write LF bytes (not text mode) so Windows CRLF translation never diverges
  // the artifact from the Python renderer's bytes.
  writeFileSync(fullPath, Buffer.from(content, 'utf-8'));
}

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

// --- state / priority normalization (-> work-OS axes) ----------------------

// Words that legitimately canonicalize to the DEFAULT_STATE (backlog), so we can
// tell a real backlog token from an unknown word that workState merely bucketed
// to the default. Mirrors currency: canonical 'backlog' + legacy 'planned'.
const BACKLOG_WORDS = new Set(['backlog', 'planned']);

// Map an incoming state token (canonical or legacy word) to a canonical state.
// 'blocked' is NEVER persisted; it canonicalizes to in-progress like the Python
// brain (a real blocker is expressed via blocked-by and derived onto the board).
function normalizeStateParam(value: unknown, fallback = STATE_TODO): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const token = value.trim();
  // workState reads the `state` field; reuse it by wrapping the token.
  const st = workState({ state: token });
  // workState silently buckets unknown words to backlog; reject those so a caller
  // typo surfaces instead of landing an issue in the wrong lane.
  if (st === DEFAULT_STATE && !BACKLOG_WORDS.has(token.toLowerCase())) {
    throw makeErr(-32602, 'unknown state; use backlog/todo/in-progress/done/canceled');
  }
  return st;
}

const PRIORITY_WORDS: Record<string, number> = {
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
  none: 0,
  'no priority': 0,
};

// Accept either an int 0..4 or a back-compat word (urgent/high/medium/low/none);
// PERSIST the int so priority_rank/board order match Python.
function normalizePriorityParam(value: unknown, fallback = 0): number {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number' && Number.isInteger(value)) {
    if (value < 0 || value > 4) throw makeErr(-32602, 'priority must be an int 0..4');
    return value;
  }
  if (typeof value === 'string') {
    const t = value.trim().toLowerCase();
    if (/^\d+$/.test(t)) {
      const n = Number.parseInt(t, 10);
      if (n < 0 || n > 4) throw makeErr(-32602, 'priority must be an int 0..4');
      return n;
    }
    if (t in PRIORITY_WORDS) return PRIORITY_WORDS[t];
    throw makeErr(-32602, 'unknown priority; use 0..4 or urgent/high/medium/low/none');
  }
  throw makeErr(-32602, 'unknown priority; use 0..4 or urgent/high/medium/low/none');
}

function normalizeEntityList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const t = item.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

// --- frontmatter serialization (deterministic work-OS key order) -----------

function fmList(values: string[]): string {
  return `[${values.join(', ')}]`;
}

export interface IssueFields {
  slug: string;
  project: string;
  state: string; // canonical
  review: string; // reviewed | draft
  priority: number; // 0..4
  description: string; // <=200 one-line
  blockedBy: string[]; // entity refs
  assignee: string;
  lastVerified: string;
  status: string; // rhizome lifecycle (default 'active'); preserved on round-trip
  // Pass-through work-OS frontmatter NOT explicitly managed above (estimate, due,
  // tags, initiative, cycle, squad, origin, ...). These are real work-OS fields
  // (work_protocol.SNAPSHOT_FIELDS) that Python promote()/_materialize_fields
  // preserves; the thin adapter must NOT destroy them on a read-modify-write.
  extra: Frontmatter;
}

// Keys renderIssueNote serializes explicitly. Any OTHER frontmatter key on an
// externally-authored work-OS note is carried verbatim via IssueFields.extra so a
// round-trip through update/link never mutilates the note (parity with Python's
// SNAPSHOT_FIELDS inheritance).
const MANAGED_FM_KEYS = new Set([
  'type',
  'entity',
  'state',
  'review',
  'kind',
  'id',
  'description',
  'status',
  'priority',
  'blocked-by',
  'assignee',
  'last-verified',
]);

// Serialize one pass-through frontmatter field. Mirrors work_protocol._fmt_field:
// dict -> nested single-level map (`key:` then `  child: v`); list -> `[a, b]`;
// scalar -> verbatim. Keeps preserved fields byte-compatible with the Python brain.
function fmtExtraField(key: string, value: FmValue): string {
  if (Array.isArray(value)) return `${key}: [${value.join(', ')}]`;
  if (value && typeof value === 'object') {
    const lines = [`${key}:`];
    for (const [ck, cv] of Object.entries(value)) {
      if (cv === null || cv === undefined) continue;
      lines.push(`  ${ck}: ${cv}`);
    }
    return lines.join('\n');
  }
  return `${key}: ${value}`;
}

// Capture every non-managed frontmatter key, preserving insertion order.
function extraFields(raw: Frontmatter): Frontmatter {
  const out: Frontmatter = {};
  for (const [k, v] of Object.entries(raw)) {
    if (MANAGED_FM_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

export function renderIssueNote(f: IssueFields, body: string): string {
  const entity = `project/${f.project}/issue/${f.slug}`;
  const lines = [
    '---',
    'type: issue',
    `entity: ${entity}`,
    `state: ${f.state}`,
    `review: ${f.review}`,
    'kind: knowledge-task',
    `id: ${f.project}/${f.slug}`,
    `description: ${f.description}`,
    `status: ${f.status || 'active'}`,
    `priority: ${f.priority}`,
    `blocked-by: ${fmList(f.blockedBy)}`,
  ];
  if (f.assignee) lines.push(`assignee: ${f.assignee}`);
  lines.push(`last-verified: ${f.lastVerified}`);
  // Preserve pass-through work-OS fields (estimate/due/tags/cycle/initiative/
  // squad/origin/...) so update/link is non-lossy. Emitted after the managed
  // block, in their original order, with Python-_fmt_field-compatible bytes.
  for (const [k, v] of Object.entries(f.extra)) {
    lines.push(fmtExtraField(k, v));
  }
  lines.push('---');
  // Body: first non-blank line is the card label (the description by default).
  const trimmedBody = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/^\n+/, '');
  let text = lines.join('\n') + '\n\n';
  text += trimmedBody ? trimmedBody : f.description;
  if (!text.endsWith('\n')) text += '\n';
  return text;
}

export function projectNote(project: string, description: string): string {
  return [
    '---',
    'type: project',
    `entity: project/${project}`,
    'kind: knowledge-task',
    `id: ${project}/project`,
    `description: ${description}`,
    'status: active',
    `last-verified: ${isoDate()}`,
    '---',
    '',
    `# ${project}`,
    '',
    'Work-OS project anchor. Issues live under `issues/<slug>.md`; the Kanban',
    'board is a derived view (rendered on demand, never a source).',
    '',
  ].join('\n');
}

function registryProjectNote(project: string, description: string, aliases: string[] = []): string {
  return [
    '---',
    'type: project',
    `entity: project/${project}`,
    'status: active',
    `aliases: [${aliases.map((alias) => JSON.stringify(alias)).join(', ')}]`,
    `last-verified: ${isoDate()}`,
    '---',
    '',
    `# ${project}`,
    '',
    description,
    '',
  ].join('\n');
}

function oneLine(value: string, max = 200): string {
  const s = value.replace(/\r?\n/g, ' ').trim();
  return s.length > max ? s.slice(0, max) : s;
}

// --- issue lookup ----------------------------------------------------------

function issueEntity(project: string, slug: string): string {
  return `project/${project}/issue/${slug}`;
}

function slugFromEntity(entity: string | null): string {
  if (!entity) return '';
  const parts = entity.split('/');
  return parts[parts.length - 1];
}

function findIssueNote(vaultPath: string, project: string, slug: string): WorkNote | null {
  const full = join(vaultPath, issuePath(project, slug));
  if (!existsSync(full)) return null;
  const text = readFileSync(full, 'utf-8');
  const raw = parseFm(text);
  return {
    note_id: issuePath(project, slug).replace(/\\/g, '/'),
    path: full,
    raw,
    body: splitBody(text),
    entity: typeof raw.entity === 'string' ? raw.entity : null,
  };
}

function fieldsFromNote(note: WorkNote, project: string, slug: string): IssueFields {
  const raw = note.raw;
  const reviewRaw = typeof raw.review === 'string' ? raw.review.trim().toLowerCase() : '';
  // READ priority via the tolerant workPriority (mirror currency.work_priority):
  // an off-range/unparseable priority on a hand-edited or Python-authored note is
  // null (ranks last), NOT a -32602 throw. Persist null as 0 ("none"), which has
  // the same rank-last semantics as Python's None on the next write.
  return {
    slug,
    project,
    state: workState(raw),
    review: reviewRaw === 'draft' ? 'draft' : 'reviewed',
    priority: workPriority(raw) ?? 0,
    description: typeof raw.description === 'string' ? raw.description : '',
    blockedBy: blockedByRefs(raw),
    assignee: typeof raw.assignee === 'string' ? raw.assignee : '',
    lastVerified: typeof raw['last-verified'] === 'string' ? (raw['last-verified'] as string) : isoDate(),
    // Preserve the rhizome lifecycle status (default active) and every other
    // unmanaged work-OS field, so update/link round-trips are non-lossy.
    status: typeof raw.status === 'string' && raw.status.trim() ? raw.status.trim() : 'active',
    extra: extraFields(raw),
  };
}

// Public shape of a work-OS issue returned to callers.
function issueView(note: WorkNote, project: string): Record<string, unknown> {
  const slug = slugFromEntity(note.entity);
  const raw = note.raw;
  const reviewRaw = typeof raw.review === 'string' ? raw.review.trim().toLowerCase() : statusReview(raw);
  return {
    entity: note.entity,
    id: typeof raw.id === 'string' ? raw.id : `${project}/${slug}`,
    slug,
    state: workState(raw),
    review: reviewRaw,
    // Tolerant read (mirror currency.work_priority): out-of-range/unparseable ->
    // null (ranked last), never a throw. A single bad note no longer breaks
    // list/get for the whole project.
    priority: workPriority(raw),
    assignee: typeof raw.assignee === 'string' ? raw.assignee : '',
    blocked_by: blockedByRefs(raw),
    path: note.note_id,
    label: cardLabelOf(note),
  };
}

function statusReview(raw: Frontmatter): string {
  if (typeof raw.review === 'string' && raw.review.trim()) return raw.review.trim().toLowerCase();
  if (typeof raw.status === 'string' && raw.status.trim()) return raw.status.trim().toLowerCase();
  return '';
}

function cardLabelOf(note: WorkNote): string {
  for (const line of (note.body || '').split('\n')) {
    if (line.trim()) return line.trim();
  }
  return slugFromEntity(note.entity) || note.note_id;
}

// --- canvas / base derived views (work-OS fields) --------------------------

const BASE_FIELDS = ['entity', 'state', 'review', 'priority', 'assignee', 'blocked-by', 'last-verified', 'id', 'description'] as const;

// Column color by canonical state (for grouping in the Canvas view).
const STATE_COLORS: Record<string, string> = {
  backlog: '6',
  todo: '4',
  'in-progress': '3',
  blocked: '0',
  done: '5',
  canceled: '1',
};
const CANVAS_STATE_ORDER = ['backlog', 'todo', 'in-progress', 'done', 'canceled'];
const STATE_GROUP_LABEL: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  'in-progress': 'In Progress',
  done: 'Done',
  canceled: 'Canceled',
};

interface CanvasNode {
  id: string;
  type: 'text' | 'file' | 'group';
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  file?: string;
  label?: string;
  color?: string;
}
interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide?: string;
  toNode: string;
  toSide?: string;
  label?: string;
  color?: string;
}

function canvasId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'node';
}

function projectIssues(vaultPath: string, project: string): WorkNote[] {
  const prefix = `project/${project}/issue/`;
  return scanWorkNotes(vaultPath).filter((n) => n.entity && n.entity.startsWith(prefix));
}

function buildProjectCanvas(project: string, issues: WorkNote[]): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const nodes: CanvasNode[] = [
    {
      id: 'project',
      type: 'text',
      x: -420,
      y: -180,
      width: 340,
      height: 150,
      color: '2',
      text: [`# ${project}`, '', 'LLM Wiki project map', '', `${issues.length} issues`].join('\n'),
    },
  ];
  const edges: CanvasEdge[] = [];
  const byEntity = new Map(issues.map((i) => [i.entity as string, i]));
  const nodeId = (i: WorkNote): string => `issue-${canvasId(slugFromEntity(i.entity))}`;
  const emitted = new Set<string>();

  for (const [columnIndex, state] of CANVAS_STATE_ORDER.entries()) {
    const lane = issues.filter((i) => workState(i.raw) === state);
    const x = columnIndex * 430;
    const height = Math.max(260, 110 + lane.length * 170);
    nodes.push({
      id: `group-${state}`,
      type: 'group',
      x,
      y: 0,
      width: 380,
      height,
      label: STATE_GROUP_LABEL[state],
      color: STATE_COLORS[state],
    });
    for (const [rowIndex, issue] of lane.entries()) {
      nodes.push({
        id: nodeId(issue),
        type: 'file',
        x: x + 30,
        y: 70 + rowIndex * 165,
        width: 320,
        height: 120,
        file: issue.note_id,
        color: STATE_COLORS[state],
      });
    }
  }

  const addEdge = (from: WorkNote, to: WorkNote, label: string, color: string): void => {
    const id = `edge-${canvasId(nodeId(from))}-${canvasId(nodeId(to))}-${canvasId(label)}`;
    if (emitted.has(id)) return;
    emitted.add(id);
    edges.push({ id, fromNode: nodeId(from), fromSide: 'right', toNode: nodeId(to), toSide: 'left', label, color });
  };

  for (const issue of issues) {
    for (const blockerEntity of blockedByRefs(issue.raw)) {
      const blocker = byEntity.get(blockerEntity);
      if (blocker) addEdge(blocker, issue, 'blocks', '1');
    }
  }
  return { nodes, edges };
}

function buildProjectBase(project: string): { sourceFolder: string; fields: string[]; content: string } {
  const sourceFolder = issuesRoot(project);
  const fields = [...BASE_FIELDS];
  const content = [
    `# LLM Wiki Obsidian Bases dashboard for ${project}`,
    'filters:',
    '  and:',
    `    - 'file.inFolder("${sourceFolder}")'`,
    '    - \'file.ext == "md"\'',
    'properties:',
    '  entity:',
    '    displayName: Entity',
    '  state:',
    '    displayName: State',
    '  review:',
    '    displayName: Review',
    '  priority:',
    '    displayName: Priority',
    '  assignee:',
    '    displayName: Assignee',
    '  blocked-by:',
    '    displayName: Blocked by',
    '  last-verified:',
    '    displayName: Verified',
    '  id:',
    '    displayName: ID',
    '  description:',
    '    displayName: Description',
    'views:',
    '  - type: table',
    '    name: Issues',
    '    order:',
    '      - file.name',
    ...fields.map((field) => `      - ${field}`),
    '    groupBy:',
    '      property: state',
    '      direction: ASC',
    '',
  ].join('\n');
  return { sourceFolder, fields, content };
}

function projectCanvasPath(project: string): string {
  return `${viewsRoot(project)}/project-map.canvas`;
}
function projectBasePath(project: string): string {
  return `${viewsRoot(project)}/issues.base`;
}

function ensureCanWriteVisual(vaultPath: string, path: string, overwrite: boolean): void {
  if (!overwrite && existsSync(join(vaultPath, path))) throw makeErr(-32002, `Already exists: ${path}`);
}

function boolParam(value: unknown, defaultValue: boolean): boolean {
  return typeof value === 'boolean' ? value : defaultValue;
}

// --- board language resolution ---------------------------------------------

function resolveLang(param: unknown, notes: WorkNote[]): string {
  if (typeof param === 'string' && param.trim()) return param.trim();
  const env = process.env.VAULT_MIND_LANG;
  if (env && env.trim()) return env.trim();
  return detectVaultLang(notes);
}

// --- unique slug -----------------------------------------------------------

function uniqueSlug(vaultPath: string, project: string, base: string): string {
  let slug = base;
  let n = 2;
  while (existsSync(join(vaultPath, issuePath(project, slug)))) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}

// ===========================================================================

export function makeProjectOps(vaultPath: string): Operation[] {
  return [
    ...makeProjectContextOps(vaultPath),
    {
  name: 'project.canvas.export',
      namespace: 'project' as Operation['namespace'],
      description: 'Export an Obsidian Canvas project map under 01-Projects/<project>/views/project-map.canvas (derived view).',
    mutating: true,
    writePolicy: {
      realWrite: 'dryRunFalse',
      targets: (_ctx, params) => [`${projectPolicyBasePath(params)}/views/**`],
      audit: 'required',
      effects: (_ctx, _params, result) => [touchMarkdown(resultPath(result), 'modify')],
    },
    params: {
        project: { type: 'string', required: true, description: 'Project key' },
        dryRun: { type: 'boolean', required: false, default: true, description: 'Preview Canvas JSON without writing (default: true)' },
        overwrite: { type: 'boolean', required: false, default: true, description: 'Overwrite existing Canvas file (default: true)' },
      },
      handler: async (_ctx, params) => {
        const project = existingProjectKey(vaultPath, params.project);
        const dryRun = boolParam(params.dryRun, true);
        const overwrite = boolParam(params.overwrite, true);
        const path = projectCanvasPath(project);
        const issues = projectIssues(vaultPath, project);
        const canvas = buildProjectCanvas(project, issues);
        const content = JSON.stringify(canvas, null, 2) + '\n';
        if (!dryRun) {
          ensureCanWriteVisual(vaultPath, path, overwrite);
          writeVaultBytes(vaultPath, path, content);
        }
        return { path, nodes: canvas.nodes, edges: canvas.edges, dryRun };
      },
    },
    {
  name: 'project.base.export',
      namespace: 'project' as Operation['namespace'],
      description: 'Export an Obsidian Bases issues dashboard under 01-Projects/<project>/views/issues.base (derived view).',
    mutating: true,
    writePolicy: {
      realWrite: 'dryRunFalse',
      targets: (_ctx, params) => [`${projectPolicyBasePath(params)}/views/**`],
      audit: 'required',
      effects: (_ctx, _params, result) => [touchMarkdown(resultPath(result), 'modify')],
    },
    params: {
        project: { type: 'string', required: true, description: 'Project key' },
        dryRun: { type: 'boolean', required: false, default: true, description: 'Preview Bases YAML without writing (default: true)' },
        overwrite: { type: 'boolean', required: false, default: true, description: 'Overwrite existing Bases file (default: true)' },
      },
      handler: async (_ctx, params) => {
        const project = existingProjectKey(vaultPath, params.project);
        const dryRun = boolParam(params.dryRun, true);
        const overwrite = boolParam(params.overwrite, true);
        const path = projectBasePath(project);
        const base = buildProjectBase(project);
        if (!dryRun) {
          ensureCanWriteVisual(vaultPath, path, overwrite);
          writeVaultBytes(vaultPath, path, base.content);
        }
        return { path, sourceFolder: base.sourceFolder, fields: base.fields, dryRun };
      },
    },
    {
  name: 'project.init',
      namespace: 'project' as Operation['namespace'],
      description: 'Create a work-OS project anchor note at 01-Projects/<project>/_project.md (single source of truth; no docket store).',
    mutating: true,
    writePolicy: {
      realWrite: 'always',
      targets: (_ctx, params) => [
        `Projects/${projectPolicyBasePath(params).slice('01-Projects/'.length)}.md`,
        `${projectPolicyBasePath(params)}/_project.md`,
        `${projectPolicyBasePath(params)}/issues/**`,
      ],
      audit: 'required',
      effects: (_ctx, _params, result) => [touchMarkdown(resultPath(result), 'modify')],
    },
    params: {
        project: { type: 'string', required: true, description: 'Project key, single safe path segment' },
        description: { type: 'string', required: false, description: 'One-line project description (<=200 chars)' },
      },
      handler: async (_ctx, params) => {
        const project = projectKey(params.project);
        const rawProjectRef = typeof params.project === 'string' ? params.project.trim() : project;
        const aliases = rawProjectRef !== project && !rawProjectRef.startsWith('project/') ? [rawProjectRef] : [];
        const description = oneLine(typeof params.description === 'string' && params.description.trim() ? params.description : `Work-OS project ${project}`);
        const registryPath = `Projects/${project}.md`;
        const registryFullPath = join(vaultPath, registryPath);
        const notePath = projectNotePath(project);
        const noteFullPath = join(vaultPath, notePath);
        const registryExists = existsSync(registryFullPath);
        const anchorExists = existsSync(noteFullPath);

        // Validate every pre-existing identity surface before writing either one.
        // A conflicting anchor must never leave a newly-created registry record
        // behind after project.init rejects the adoption.
        if (registryExists) {
          const existingRegistry = parseFm(readFileSync(registryFullPath, 'utf-8'));
          if (existingRegistry.entity !== `project/${project}`) {
            throw makeErr(-32010, `Existing shared Project record is incompatible: ${registryPath}; run project.migration.plan`);
          }
        }
        if (anchorExists) {
          const existingAnchor = parseFm(readFileSync(noteFullPath, 'utf-8'));
          if (existingAnchor.entity !== `project/${project}`) {
            throw makeErr(-32010, `Existing Work-OS anchor disagrees with project/${project}; run project.context.doctor`);
          }
        }

        if (!registryExists) {
          writeVaultBytes(vaultPath, registryPath, registryProjectNote(project, description, aliases));
        }
        if (!anchorExists) {
          writeVaultBytes(vaultPath, notePath, projectNote(project, description));
        }
        mkdirSync(join(vaultPath, issuesRoot(project)), { recursive: true });
        return {
          ok: true,
          project,
          projectId: `project/${project}`,
          registryRecord: registryPath,
          root: projectRoot(project),
          projectNote: notePath,
        };
      },
    },
    {
  name: 'project.issue.create',
      namespace: 'project' as Operation['namespace'],
      description: 'Create a work-OS issue note under 01-Projects/<project>/issues/<slug>.md. Default state is todo; review reviewed (authoritative).',
    mutating: true,
    writePolicy: {
      realWrite: 'always',
      targets: (_ctx, params) => [`${projectPolicyBasePath(params)}/issues/**`],
      audit: 'required',
      effects: (_ctx, _params, result) => [touchMarkdown(resultPath(result), 'create')],
    },
    params: {
        project: { type: 'string', required: true, description: 'Project key' },
        title: { type: 'string', required: true, description: 'Issue title (-> slug + default card label)' },
        slug: { type: 'string', required: false, description: 'Explicit slug (lowercase-kebab); default derived from title' },
        summary: { type: 'string', required: false, description: 'One-line description (<=200 chars); default from title' },
        body: { type: 'string', required: false, description: 'Detailed issue body (first non-blank line is the card label)' },
        state: { type: 'string', required: false, description: 'Work state: backlog|todo|in-progress|done|canceled (default todo)' },
        review: { type: 'string', required: false, enum: ['reviewed', 'draft'], description: 'Review axis (default reviewed = authoritative)' },
        priority: { type: 'string', required: false, description: 'Priority as a string: int "0".."4" (1=urgent..4=low, 0=none) or word urgent/high/medium/low/none. Stored as the int.' },
        assignee: { type: 'string', required: false, description: 'Actor or human owner' },
        blocked_by: { type: 'array', required: false, description: 'Blocking entity refs (project/<proj>/issue/<slug>)' },
      },
      handler: async (ctx, params) => {
        const project = existingProjectKey(vaultPath, params.project);
        const title = String(params.title ?? '').trim();
        if (!title) throw makeErr(-32602, 'title required');
        const baseSlug = slugify(typeof params.slug === 'string' && params.slug.trim() ? params.slug : title);
        if (!baseSlug) throw makeErr(-32602, 'could not derive a valid slug from title/slug');
        const slug = uniqueSlug(vaultPath, project, baseSlug);
        const description = oneLine(typeof params.summary === 'string' && params.summary.trim() ? params.summary : title);
        const review = params.review === 'draft' ? 'draft' : 'reviewed';
        const fields: IssueFields = {
          slug,
          project,
          state: normalizeStateParam(params.state, STATE_TODO),
          review,
          priority: normalizePriorityParam(params.priority, 0),
          description,
          blockedBy: normalizeEntityList(params.blocked_by),
          assignee:
            typeof params.assignee === 'string' && params.assignee.trim() ? params.assignee.trim() : actorFromContext(ctx),
          lastVerified: isoDate(),
          status: 'active',
          extra: {},
        };
        // The body's first non-blank line is the Kanban card label -> default it to
        // the human title (NOT the metadata description), with the title as the
        // headline and any explicit body appended.
        const body =
          typeof params.body === 'string' && params.body.trim() ? `${title}\n\n${params.body.trim()}` : title;
        const path = issuePath(project, slug);
        writeVaultBytes(vaultPath, path, renderIssueNote(fields, body));
        return { ok: true, entity: issueEntity(project, slug), id: `${project}/${slug}`, slug, path };
      },
    },
    {
  name: 'project.issue.list',
      namespace: 'project' as Operation['namespace'],
      description: 'List authoritative work-OS issues for a project (drafts excluded), optionally filtered by state or assignee.',
      mutating: false,
      params: {
        project: { type: 'string', required: true, description: 'Project key' },
        state: { type: 'string', required: false, description: 'Optional work-state filter (backlog|todo|in-progress|done|canceled)' },
        assignee: { type: 'string', required: false, description: 'Optional assignee filter' },
      },
      handler: async (_ctx, params) => {
        const project = existingProjectKey(vaultPath, params.project);
        const prefix = `project/${project}/issue/`;
        const stateFilter = typeof params.state === 'string' && params.state.trim() ? normalizeStateParam(params.state, DEFAULT_STATE) : undefined;
        const assignee = typeof params.assignee === 'string' && params.assignee.trim() ? params.assignee.trim() : undefined;
        const issues = scanWorkNotes(vaultPath)
          .filter((n) => n.entity && n.entity.startsWith(prefix))
          .filter((n) => isAuthoritative(n.raw))
          .filter((n) => !stateFilter || workState(n.raw) === stateFilter)
          .filter((n) => !assignee || (typeof n.raw.assignee === 'string' && n.raw.assignee === assignee))
          .map((n) => issueView(n, project));
        return { count: issues.length, issues };
      },
    },
    {
  name: 'project.issue.get',
      namespace: 'project' as Operation['namespace'],
      description: 'Read a work-OS issue by slug.',
      mutating: false,
      params: {
        project: { type: 'string', required: true, description: 'Project key' },
        slug: { type: 'string', required: true, description: 'Issue slug' },
      },
      handler: async (_ctx, params) => {
        const project = existingProjectKey(vaultPath, params.project);
        const slug = slugify(String(params.slug ?? ''));
        const note = findIssueNote(vaultPath, project, slug);
        if (!note) throw makeErr(-32001, `Issue not found: ${slug}`);
        return { issue: issueView(note, project), content: readFileSync(note.path, 'utf-8') };
      },
    },
    {
  name: 'project.issue.update',
      namespace: 'project' as Operation['namespace'],
      description: 'Update a work-OS issue (state/priority/review/assignee/blocked_by/description/body); bumps last-verified.',
    mutating: true,
    writePolicy: {
      realWrite: 'always',
      targets: (_ctx, params) => [`${projectPolicyBasePath(params)}/issues/**`],
      audit: 'required',
      effects: (_ctx, _params, result) => [touchMarkdown(resultPath(result), 'modify')],
    },
    params: {
        project: { type: 'string', required: true, description: 'Project key' },
        slug: { type: 'string', required: true, description: 'Issue slug' },
        state: { type: 'string', required: false, description: 'New work state (backlog|todo|in-progress|done|canceled)' },
        review: { type: 'string', required: false, enum: ['reviewed', 'draft'], description: 'New review axis value' },
        priority: { type: 'string', required: false, description: 'New priority as a string: int "0".."4" or word urgent/high/medium/low/none. Stored as the int.' },
        assignee: { type: 'string', required: false, description: 'New assignee' },
        blocked_by: { type: 'array', required: false, description: 'Replacement blocking entity refs' },
        summary: { type: 'string', required: false, description: 'Replacement one-line description' },
        body: { type: 'string', required: false, description: 'Replacement body' },
      },
      handler: async (_ctx, params) => {
        const project = existingProjectKey(vaultPath, params.project);
        const slug = slugify(String(params.slug ?? ''));
        const note = findIssueNote(vaultPath, project, slug);
        if (!note) throw makeErr(-32001, `Issue not found: ${slug}`);
        const current = fieldsFromNote(note, project, slug);
        const fields: IssueFields = {
          ...current,
          state: params.state === undefined ? current.state : normalizeStateParam(params.state, current.state),
          review: params.review === undefined ? current.review : params.review === 'draft' ? 'draft' : 'reviewed',
          priority: params.priority === undefined ? current.priority : normalizePriorityParam(params.priority, current.priority),
          assignee: typeof params.assignee === 'string' ? params.assignee.trim() : current.assignee,
          blockedBy: Array.isArray(params.blocked_by) ? normalizeEntityList(params.blocked_by) : current.blockedBy,
          description: typeof params.summary === 'string' && params.summary.trim() ? oneLine(params.summary) : current.description,
          lastVerified: isoDate(),
        };
        // Body: explicit body param, else preserve existing body, else description.
        let body: string;
        if (typeof params.body === 'string' && params.body.trim()) body = params.body;
        else if (note.body.trim()) body = note.body.trim();
        else body = fields.description;
        writeVaultBytes(vaultPath, note.note_id, renderIssueNote(fields, body));
        return { ok: true, path: note.note_id, issue: issueView(findIssueNote(vaultPath, project, slug)!, project) };
      },
    },
    {
  name: 'project.issue.link',
      namespace: 'project' as Operation['namespace'],
      description: 'Edit blocked-by dependencies between work-OS issues. blocks/blocked_by rewrite blocked-by (entity refs); relates is derive-only (soft notice).',
    mutating: true,
    writePolicy: {
      realWrite: 'always',
      shouldWrite: (_ctx, params) => params.relation !== 'relates',
      targets: (_ctx, params) => [`${projectPolicyBasePath(params)}/issues/**`],
      audit: 'required',
      effects: (_ctx, _params, result) => [touchMarkdown(resultPath(result), 'modify')],
    },
    params: {
        project: { type: 'string', required: true, description: 'Project key' },
        slug: { type: 'string', required: true, description: 'Source issue slug' },
        relation: { type: 'string', required: true, enum: ['blocks', 'blocked_by', 'relates'], description: 'Relationship type' },
        target: { type: 'string', required: true, description: 'Target issue slug (resolved to its entity)' },
      },
      handler: async (_ctx, params) => {
        const project = existingProjectKey(vaultPath, params.project);
        const slug = slugify(String(params.slug ?? ''));
        const relation = String(params.relation ?? '').trim();
        const targetSlug = slugify(String(params.target ?? ''));
        if (!targetSlug) throw makeErr(-32602, 'target required');

        if (relation === 'relates') {
          // work-OS derives `related` from the blocked-by closure; nothing persisted.
          return {
            ok: true,
            relation,
            note: 'related edges are derived from blocked-by in the work-OS; nothing persisted (use blocks/blocked_by to record a dependency).',
          };
        }

        const source = findIssueNote(vaultPath, project, slug);
        if (!source) throw makeErr(-32001, `Issue not found: ${slug}`);
        const targetNote = findIssueNote(vaultPath, project, targetSlug);
        if (!targetNote) throw makeErr(-32001, `Issue not found: ${targetSlug}`);
        const targetEntity = issueEntity(project, targetSlug);
        const sourceEntity = issueEntity(project, slug);

        if (relation === 'blocked_by') {
          // source blocked-by += target entity
          const f = fieldsFromNote(source, project, slug);
          f.blockedBy = Array.from(new Set([...f.blockedBy, targetEntity]));
          f.lastVerified = isoDate();
          writeVaultBytes(vaultPath, source.note_id, renderIssueNote(f, source.body.trim() || f.description));
          return { ok: true, path: source.note_id, relation, target: targetEntity };
        }
        // relation === 'blocks' -> target blocked-by += source entity
        const f = fieldsFromNote(targetNote, project, targetSlug);
        f.blockedBy = Array.from(new Set([...f.blockedBy, sourceEntity]));
        f.lastVerified = isoDate();
        writeVaultBytes(vaultPath, targetNote.note_id, renderIssueNote(f, targetNote.body.trim() || f.description));
        return { ok: true, path: targetNote.note_id, relation, target: sourceEntity };
      },
    },
    {
  name: 'project.comment.add',
      namespace: 'project' as Operation['namespace'],
      description: 'Append a comment to a sibling 01-Projects/<project>/issues/<slug>.comments.md (does not affect the board/authoritative index).',
    mutating: true,
    writePolicy: {
      realWrite: 'always',
      targets: (_ctx, params) => [`${projectPolicyBasePath(params)}/issues/**`],
      audit: 'required',
      effects: (_ctx, _params, result) => [touchMarkdown(resultPath(result), 'modify')],
    },
    params: {
        project: { type: 'string', required: true, description: 'Project key' },
        slug: { type: 'string', required: true, description: 'Issue slug' },
        body: { type: 'string', required: true, description: 'Comment Markdown body' },
        actor: { type: 'string', required: false, description: 'Comment actor; defaults to collaboration actor' },
        session: { type: 'string', required: false, description: 'Optional session/thread id' },
      },
      handler: async (ctx, params) => {
        const project = existingProjectKey(vaultPath, params.project);
        const slug = slugify(String(params.slug ?? ''));
        const note = findIssueNote(vaultPath, project, slug);
        if (!note) throw makeErr(-32001, `Issue not found: ${slug}`);
        const body = String(params.body ?? '').trim();
        if (!body) throw makeErr(-32602, 'body required');
        const actor = typeof params.actor === 'string' && params.actor.trim() ? safeSegment(params.actor, 'actor') : actorFromContext(ctx);
        const session = typeof params.session === 'string' ? params.session.trim() : process.env.CODEX_THREAD_ID || '';
        const path = `${issuesRoot(project)}/${slug}.comments.md`;
        const existing = readText(join(vaultPath, path)) ?? `# Comments for ${slug}\n\n`;
        const now = new Date().toISOString();
        const sessionPart = session ? ` · session ${session}` : '';
        const block = `## ${now} · ${actor}${sessionPart}\n\n${body}\n\n---\n\n`;
        writeVaultBytes(vaultPath, path, existing.replace(/\s+$/, '') + '\n\n' + block);
        return { ok: true, path, actor, session };
      },
    },
    {
  name: 'project.board.get',
      namespace: 'project' as Operation['namespace'],
      description: 'Render the work-OS Kanban board (Obsidian kanban-plugin format) from the authoritative issue notes. Parity with `python kb_meta.py work board`.',
    mutating: true,
    writePolicy: {
      realWrite: 'always',
      shouldWrite: (_ctx, params) => params.write === true,
      targets: (_ctx, params) => [`${projectPolicyBasePath(params)}/**/board.md`],
      audit: 'required',
      effects: (_ctx, _params, result) => [touchMarkdown(resultPath(result), 'modify')],
    },
    params: {
        project: { type: 'string', required: true, description: 'Project key' },
        lang: { type: 'string', required: false, description: 'Lane-label language (en/zh/ja); default $VAULT_MIND_LANG then auto-detect' },
        write: { type: 'boolean', required: false, default: false, description: 'Also write board.md next to the project anchor (derived view)' },
      },
      handler: async (_ctx, params) => {
        const project = existingProjectKey(vaultPath, params.project);
        const write = boolParam(params.write, false);
        const notes = scanWorkNotes(vaultPath);
        const authoritative = notes.filter((n) => isAuthoritative(n.raw));
        const lang = resolveLang(params.lang, notes);
        const content = renderKanbanBoard(authoritative, project, lang);
        const result: Record<string, unknown> = { content, lang, project };
        if (write) {
          // Write board.md next to the project anchor (or the first issue's dir).
          const anchor =
            notes.find((n) => n.entity === `project/${project}`) ??
            authoritative.find((n) => (n.entity || '').startsWith(`project/${project}/`));
          if (anchor) {
            const anchorDir = dirname(anchor.note_id);
            const boardRel = anchorDir ? `${anchorDir}/board.md` : 'board.md';
            writeVaultBytes(vaultPath, boardRel, content);
            result.written = boardRel;
          }
        }
        return result;
      },
    },
  ];
}
