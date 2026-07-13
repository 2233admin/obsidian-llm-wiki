import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Operation, OperationContext } from '../core/types.js';
import { makeErr } from '../core/types.js';
import { memoryPolicyBasePath, resultPath, staticTargets, touchMarkdown } from '../core/write-policy.js';
import { resolveProjectContext } from '../project/project-context.js';

interface MemoryEntry {
  key: string;
  value: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

type MemoryData = Record<string, MemoryEntry>;

const LOCK_TTL_MS = 60_000;
const DEFAULT_ACTOR = 'agent';

function withFileLock<T>(fullPath: string, fn: () => T): T {
  const lockPath = `${fullPath}.lock`;
  const acquire = () =>
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, timestamp: Date.now() }), {
      encoding: 'utf-8',
      flag: 'wx',
    });

  try {
    acquire();
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    const ageMs = existsSync(lockPath) ? Date.now() - statSync(lockPath).mtimeMs : LOCK_TTL_MS + 1;
    if (ageMs < LOCK_TTL_MS) {
      throw makeErr(-32010, `Lock conflict on ${basename(fullPath)}`);
    }
    rmSync(lockPath, { force: true });
    acquire();
  }

  try {
    return fn();
  } finally {
    try { rmSync(lockPath, { force: true }); } catch { /* best effort */ }
  }
}

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
    throw makeErr(-32602, `${label} must be a single safe path segment`);
  }
  return trimmed;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'session';
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function listSection(values: unknown): string {
  if (!Array.isArray(values) || values.length === 0) return '- TBD';
  return values.map((value) => `- ${String(value).trim() || 'TBD'}`).join('\n');
}

function textSection(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : 'TBD';
}

function actorFromContext(ctx: OperationContext): string {
  const actor = ctx.config.collaboration?.actor ?? process.env.VAULT_MIND_ACTOR ?? DEFAULT_ACTOR;
  return safeSegment(actor, 'actor');
}

function memoryBasePath(project: string | undefined, actor: string): string {
  if (project && project.trim()) {
    return `10-Projects/${safeSegment(project, 'project')}/agents/${actor}/memory`;
  }
  return `00-Inbox/Agent-Memory/${actor}`;
}

function resolvedProject(vaultPath: string, value: unknown, operation: string): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return resolveProjectContext(vaultPath, value, operation).slug;
}

function readText(fullPath: string): string | null {
  if (!existsSync(fullPath)) return null;
  return readFileSync(fullPath, 'utf-8');
}

function writeText(fullPath: string, content: string): void {
  mkdirSync(dirname(fullPath), { recursive: true });
  withFileLock(fullPath, () => writeFileSync(fullPath, content, 'utf-8'));
}

function memoryDocFrontmatter(kind: string, actor: string, project: string | undefined, now: string): string {
  return [
    '---',
    `llmwiki-memory: ${kind}`,
    `actor: ${yamlString(actor)}`,
    project ? `project: ${yamlString(project)}` : 'project: null',
    `updated-at: ${yamlString(now)}`,
    '---',
    '',
  ].join('\n');
}

function passportMarkdown(opts: {
  actor: string;
  project?: string;
  now: string;
  goal?: unknown;
  constraints?: unknown;
  decisions?: unknown;
  openQuestions?: unknown;
  pointers?: unknown;
}): string {
  return [
    memoryDocFrontmatter('passport', opts.actor, opts.project, opts.now),
    '# Passport',
    '',
    '## Goal',
    '',
    textSection(opts.goal),
    '',
    '## Constraints',
    '',
    listSection(opts.constraints),
    '',
    '## Decisions',
    '',
    listSection(opts.decisions),
    '',
    '## Open Questions',
    '',
    listSection(opts.openQuestions),
    '',
    '## Pointers',
    '',
    listSection(opts.pointers),
    '',
  ].join('\n');
}

function handoffMarkdown(opts: {
  actor: string;
  project?: string;
  now: string;
  currentState?: unknown;
  nextSteps?: unknown;
  risks?: unknown;
  files?: unknown;
}): string {
  return [
    memoryDocFrontmatter('handoff', opts.actor, opts.project, opts.now),
    '# Handoff',
    '',
    '## Current State',
    '',
    textSection(opts.currentState),
    '',
    '## Next Steps',
    '',
    listSection(opts.nextSteps),
    '',
    '## Risks',
    '',
    listSection(opts.risks),
    '',
    '## Files',
    '',
    listSection(opts.files),
    '',
  ].join('\n');
}

function sessionMarkdown(opts: {
  actor: string;
  project?: string;
  now: string;
  title?: unknown;
  summary: unknown;
  decisions?: unknown;
  actions?: unknown;
  references?: unknown;
}): string {
  const title = typeof opts.title === 'string' && opts.title.trim() ? opts.title.trim() : 'Session';
  return [
    memoryDocFrontmatter('session', opts.actor, opts.project, opts.now),
    `# ${title}`,
    '',
    '## Summary',
    '',
    textSection(opts.summary),
    '',
    '## Decisions',
    '',
    listSection(opts.decisions),
    '',
    '## Actions',
    '',
    listSection(opts.actions),
    '',
    '## References',
    '',
    listSection(opts.references),
    '',
  ].join('\n');
}

class PersistentMemory {
  private readonly filePath: string;

  constructor(vaultPath: string) {
    this.filePath = join(vaultPath, '_ai_memory.json');
  }

  private read(): MemoryData {
    if (!existsSync(this.filePath)) return {};
    try { return JSON.parse(readFileSync(this.filePath, 'utf-8')) as MemoryData; }
    catch { return {}; }
  }

  private write(data: MemoryData): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    withFileLock(this.filePath, () => {
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    });
  }

  set(key: string, value: string, tags: string[] = []): MemoryEntry {
    const data = this.read();
    const now  = new Date().toISOString();
    const entry: MemoryEntry = {
      key,
      value,
      tags,
      created_at: data[key]?.created_at ?? now,
      updated_at: now,
    };
    data[key] = entry;
    this.write(data);
    return entry;
  }

  get(key?: string, tag?: string): MemoryEntry[] {
    const entries = Object.values(this.read());
    if (key) return entries.filter(e => e.key === key);
    if (tag) return entries.filter(e => e.tags.includes(tag));
    return entries;
  }

  forget(key: string): boolean {
    const data = this.read();
    if (!(key in data)) return false;
    delete data[key];
    this.write(data);
    return true;
  }
}

class MarkdownMemory {
  constructor(private readonly vaultPath: string) {}

  passport(ctx: OperationContext, project?: string): { exists: boolean; path: string; content: string } {
    const actor = actorFromContext(ctx);
    project = resolvedProject(this.vaultPath, project, 'memory.passport.get');
    const relPath = `${memoryBasePath(project, actor)}/passport.md`;
    const fullPath = join(this.vaultPath, relPath);
    const now = new Date().toISOString();
    const content = readText(fullPath) ?? passportMarkdown({ actor, project, now });
    return { exists: existsSync(fullPath), path: relPath, content };
  }

  writePassport(ctx: OperationContext, params: Record<string, unknown>): { ok: true; path: string; bytes: number } {
    const actor = actorFromContext(ctx);
    const project = resolvedProject(this.vaultPath, params.project, 'memory.passport.upsert');
    const relPath = `${memoryBasePath(project, actor)}/passport.md`;
    const now = new Date().toISOString();
    const content = passportMarkdown({
      actor,
      project,
      now,
      goal: params.goal,
      constraints: params.constraints,
      decisions: params.decisions,
      openQuestions: params.openQuestions,
      pointers: params.pointers,
    });
    writeText(join(this.vaultPath, relPath), content);
    return { ok: true, path: relPath, bytes: Buffer.byteLength(content, 'utf-8') };
  }

  handoff(ctx: OperationContext, project?: string): { exists: boolean; path: string; content: string } {
    const actor = actorFromContext(ctx);
    project = resolvedProject(this.vaultPath, project, 'memory.handoff.latest');
    const relPath = `${memoryBasePath(project, actor)}/handoff.md`;
    const fullPath = join(this.vaultPath, relPath);
    const now = new Date().toISOString();
    const content = readText(fullPath) ?? handoffMarkdown({ actor, project, now });
    return { exists: existsSync(fullPath), path: relPath, content };
  }

  writeHandoff(ctx: OperationContext, params: Record<string, unknown>): { ok: true; path: string; bytes: number } {
    const actor = actorFromContext(ctx);
    const project = resolvedProject(this.vaultPath, params.project, 'memory.handoff.write');
    const relPath = `${memoryBasePath(project, actor)}/handoff.md`;
    const now = new Date().toISOString();
    const content = handoffMarkdown({
      actor,
      project,
      now,
      currentState: params.currentState,
      nextSteps: params.nextSteps,
      risks: params.risks,
      files: params.files,
    });
    writeText(join(this.vaultPath, relPath), content);
    return { ok: true, path: relPath, bytes: Buffer.byteLength(content, 'utf-8') };
  }

  saveSession(ctx: OperationContext, params: Record<string, unknown>): { ok: true; path: string; bytes: number } {
    const actor = actorFromContext(ctx);
    const project = resolvedProject(this.vaultPath, params.project, 'memory.session.save');
    const now = new Date().toISOString();
    const title = typeof params.title === 'string' && params.title.trim()
      ? params.title.trim()
      : String(params.summary ?? '').slice(0, 60);
    const stamp = now.replace(/[:.]/g, '-');
    const relPath = `${memoryBasePath(project, actor)}/sessions/${stamp}-${slugify(title)}.md`;
    const content = sessionMarkdown({
      actor,
      project,
      now,
      title: params.title,
      summary: params.summary,
      decisions: params.decisions,
      actions: params.actions,
      references: params.references,
    });
    writeText(join(this.vaultPath, relPath), content);
    return { ok: true, path: relPath, bytes: Buffer.byteLength(content, 'utf-8') };
  }

  listSessions(ctx: OperationContext, project?: string, limit = 20): {
    count: number;
    sessions: Array<{ path: string; title: string; preview: string; updated_at: string }>;
  } {
    const actor = actorFromContext(ctx);
    project = resolvedProject(this.vaultPath, project, 'memory.session.list');
    const relDir = `${memoryBasePath(project, actor)}/sessions`;
    const fullDir = join(this.vaultPath, relDir);
    if (!existsSync(fullDir)) return { count: 0, sessions: [] };

    const sessions = readdirSync(fullDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => {
        const fullPath = join(fullDir, entry.name);
        const content = readFileSync(fullPath, 'utf-8');
        const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? entry.name.replace(/\.md$/, '');
        const preview = content.replace(/^---[\s\S]*?---\s*/m, '').replace(/\s+/g, ' ').trim().slice(0, 180);
        return {
          path: `${relDir}/${entry.name}`,
          title: heading,
          preview,
          updated_at: statSync(fullPath).mtime.toISOString(),
        };
      })
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, Math.max(1, Math.min(limit, 100)));

    return { count: sessions.length, sessions };
  }
}

export function makeMemoryOps(vaultPath: string): Operation[] {
  const mem = new PersistentMemory(vaultPath);
  const markdown = new MarkdownMemory(vaultPath);
  return [
    {
  name: 'memory.set',
      namespace: 'memory' as Operation['namespace'],
      description:
        'Persist a named memory across MCP sessions. Use for inferences, user preferences, ' +
        'project state, or any context that should survive server restarts. ' +
        'Storage: <vault>/_ai_memory.json (excluded from holon compilation).',
  mutating: true,
  writePolicy: {
    realWrite: 'always',
    targets: staticTargets('_ai_memory.json'),
    audit: 'required',
  },
  params: {
        key:   { type: 'string', required: true,  description: 'Unique memory key, e.g. "project/status" or "user_goal"' },
        value: { type: 'string', required: true,  description: 'Memory content (Markdown supported)' },
        tags:  { type: 'array',  required: false, description: 'Optional tags for grouping, e.g. ["project", "decision"]' },
      },
      handler: async (_ctx, params) => {
        const key   = params.key   as string;
        const value = params.value as string;
        const tags  = (params.tags  as string[] | undefined) ?? [];
        if (!key.trim()) return { error: 'key must not be empty' };
        return mem.set(key, value, tags);
      },
    },

    {
      name: 'memory.get',
      namespace: 'memory' as Operation['namespace'],
      description: 'Retrieve persisted memories by exact key or tag. Returns all memories if neither is specified.',
      mutating: false,
      params: {
        key: { type: 'string', required: false, description: 'Exact key to retrieve' },
        tag: { type: 'string', required: false, description: 'Tag to filter by' },
      },
      handler: async (_ctx, params) => {
        const key = params.key as string | undefined;
        const tag = params.tag as string | undefined;
        const entries = mem.get(key, tag);
        return { count: entries.length, memories: entries };
      },
    },

    {
      name: 'memory.list',
      namespace: 'memory' as Operation['namespace'],
      description: 'List all persisted memories (key, tags, preview, timestamp). Use memory.get to retrieve full values.',
      mutating: false,
      params: {},
      handler: async (_ctx, _params) => {
        const entries = mem.get();
        return {
          count: entries.length,
          memories: entries.map(e => ({
            key:        e.key,
            tags:       e.tags,
            preview:    e.value.slice(0, 120),
            updated_at: e.updated_at,
          })),
        };
      },
    },

    {
  name: 'memory.forget',
      namespace: 'memory' as Operation['namespace'],
      description: 'Delete a persisted memory by key.',
    mutating: true,
    writePolicy: {
      realWrite: 'always',
      targets: staticTargets('_ai_memory.json'),
      audit: 'required',
    },
    params: {
        key: { type: 'string', required: true, description: 'Key to delete' },
      },
      handler: async (_ctx, params) => {
        const key     = params.key as string;
        const deleted = mem.forget(key);
        return { ok: deleted, key, message: deleted ? 'Deleted' : `Key not found: ${key}` };
      },
    },

    {
      name: 'memory.passport.get',
      namespace: 'memory' as Operation['namespace'],
      description: 'Read the Markdown memory passport for the current actor. Returns the default passport template when no file exists.',
      mutating: false,
      params: {
        project: { type: 'string', required: false, description: 'Optional project key; stores under 10-Projects/<project>/agents/<actor>/memory' },
      },
      handler: async (ctx, params) => markdown.passport(ctx, params.project as string | undefined),
    },

    {
  name: 'memory.passport.upsert',
      namespace: 'memory' as Operation['namespace'],
      description: 'Create or replace the Markdown memory passport with Goal, Constraints, Decisions, Open Questions, and Pointers sections.',
    mutating: true,
    writePolicy: {
      realWrite: 'always',
      targets: (ctx, params) => [`${memoryPolicyBasePath(ctx.config, params, 'memory.passport.upsert')}/passport.md`],
      audit: 'required',
      effects: (_ctx, _params, result) => [touchMarkdown(resultPath(result), 'modify')],
    },
    params: {
        project:       { type: 'string', required: false, description: 'Optional project key; stores under 10-Projects/<project>/agents/<actor>/memory' },
        goal:          { type: 'string', required: false, description: 'Project or agent goal' },
        constraints:   { type: 'array',  required: false, description: 'Constraints that future sessions should preserve' },
        decisions:     { type: 'array',  required: false, description: 'Durable decisions to carry forward' },
        openQuestions: { type: 'array',  required: false, description: 'Open questions for the next session' },
        pointers:      { type: 'array',  required: false, description: 'Files, notes, or links worth revisiting' },
      },
      handler: async (ctx, params) => markdown.writePassport(ctx, params),
    },

    {
      name: 'memory.handoff.latest',
      namespace: 'memory' as Operation['namespace'],
      description: 'Read the current Markdown handoff for the current actor. Returns the default handoff template when no file exists.',
      mutating: false,
      params: {
        project: { type: 'string', required: false, description: 'Optional project key; stores under 10-Projects/<project>/agents/<actor>/memory' },
      },
      handler: async (ctx, params) => markdown.handoff(ctx, params.project as string | undefined),
    },

    {
  name: 'memory.handoff.write',
      namespace: 'memory' as Operation['namespace'],
      description: 'Create or replace the Markdown handoff with Current State, Next Steps, Risks, and Files sections.',
    mutating: true,
    writePolicy: {
      realWrite: 'always',
      targets: (ctx, params) => [`${memoryPolicyBasePath(ctx.config, params, 'memory.handoff.write')}/handoff.md`],
      audit: 'required',
      effects: (_ctx, _params, result) => [touchMarkdown(resultPath(result), 'modify')],
    },
    params: {
        project:      { type: 'string', required: false, description: 'Optional project key; stores under 10-Projects/<project>/agents/<actor>/memory' },
        currentState: { type: 'string', required: false, description: 'Where the work stands now' },
        nextSteps:    { type: 'array',  required: false, description: 'Concrete next actions' },
        risks:        { type: 'array',  required: false, description: 'Known risks or blockers' },
        files:        { type: 'array',  required: false, description: 'Relevant vault paths or workspace files' },
      },
      handler: async (ctx, params) => markdown.writeHandoff(ctx, params),
    },

    {
  name: 'memory.session.save',
      namespace: 'memory' as Operation['namespace'],
      description: 'Save a timestamped Markdown session note with Summary, Decisions, Actions, and References sections.',
    mutating: true,
    writePolicy: {
      realWrite: 'always',
      targets: (ctx, params) => [`${memoryPolicyBasePath(ctx.config, params, 'memory.session.save')}/sessions/**`],
      audit: 'required',
      effects: (_ctx, _params, result) => [touchMarkdown(resultPath(result), 'create')],
    },
    params: {
        project:    { type: 'string', required: false, description: 'Optional project key; stores under 10-Projects/<project>/agents/<actor>/memory' },
        title:      { type: 'string', required: false, description: 'Optional session title used in the heading and filename slug' },
        summary:    { type: 'string', required: true,  description: 'Session summary' },
        decisions:  { type: 'array',  required: false, description: 'Decisions made during the session' },
        actions:    { type: 'array',  required: false, description: 'Follow-up actions' },
        references: { type: 'array',  required: false, description: 'Files, notes, links, or identifiers referenced by the session' },
      },
      handler: async (ctx, params) => markdown.saveSession(ctx, params),
    },

    {
      name: 'memory.session.list',
      namespace: 'memory' as Operation['namespace'],
      description: 'List timestamped Markdown session notes for the current actor, newest first.',
      mutating: false,
      params: {
        project: { type: 'string', required: false, description: 'Optional project key; reads from 10-Projects/<project>/agents/<actor>/memory' },
        limit:   { type: 'number', required: false, description: 'Maximum sessions to return (default: 20)', default: 20 },
      },
      handler: async (ctx, params) => markdown.listSessions(
        ctx,
        params.project as string | undefined,
        (params.limit as number | undefined) ?? 20,
      ),
    },
  ];
}
