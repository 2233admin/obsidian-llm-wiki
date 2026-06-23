import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import type { Operation, OperationContext } from '../core/types.js';
import { makeErr } from '../core/types.js';

const DEFAULT_ACTOR = 'agent';
const LOCK_TTL_MS = 60_000;

interface DecisionSource {
  client?: string;
  threadId?: string;
  url?: string;
}

interface DecisionListItem {
  path: string;
  title: string;
  preview: string;
  status: string;
  captured_at: string;
  tags: string[];
}

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
    if (ageMs < LOCK_TTL_MS) throw makeErr(-32010, `Lock conflict on ${basename(fullPath)}`);
    rmSync(lockPath, { force: true });
    acquire();
  }
  try {
    return fn();
  } finally {
    try {
      rmSync(lockPath, { force: true });
    } catch {
      // best effort
    }
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
    throw makeErr(-32602, `${label} must be single safe path segment`);
  }
  return trimmed;
}

function actorFromContext(ctx: OperationContext): string {
  const actor = ctx.config.collaboration?.actor ?? process.env.VAULT_MIND_ACTOR ?? DEFAULT_ACTOR;
  return safeSegment(actor, 'actor');
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'decision';
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function yamlList(value: readonly string[]): string {
  if (value.length === 0) return '[]';
  return `[${value.map(yamlString).join(', ')}]`;
}

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') return JSON.stringify(item);
      return '';
    })
    .filter(Boolean);
}

function textSection(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object') return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
  return '_Not captured._';
}

function listSection(value: unknown): string {
  const items = normalizeList(value);
  if (items.length === 0) return '- _None captured._';
  return items.map((item) => `- ${item.replace(/\n/g, '\n  ')}`).join('\n');
}

function sourceObject(value: unknown): DecisionSource {
  if (!value || typeof value !== 'object') return {};
  const source = value as Record<string, unknown>;
  return {
    client: typeof source.client === 'string' ? source.client : undefined,
    threadId: typeof source.threadId === 'string' ? source.threadId : undefined,
    url: typeof source.url === 'string' ? source.url : undefined,
  };
}

function decisionBasePath(project: string | undefined, actor: string): string {
  if (project) return `10-Projects/${safeSegment(project, 'project')}/agents/${actor}/memory/decisions`;
  return `00-Inbox/Agent-Memory/${actor}/decisions`;
}

function filenameTimestamp(now: string): string {
  return now.replace(/[:.]/g, '-');
}

function decisionPath(project: string | undefined, actor: string, title: string, now: string): string {
  return `${decisionBasePath(project, actor)}/${filenameTimestamp(now)}-${slugify(title)}.md`;
}

function normalizeVaultRelPath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
  if (
    !normalized ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.startsWith('//') ||
    normalized.split('/').some((part) => part === '..' || part === '.')
  ) {
    throw makeErr(-32602, 'path traversal blocked');
  }
  return normalized;
}

function ensureInsideVault(vaultPath: string, relPath: string): string {
  const root = resolve(vaultPath);
  const fullPath = resolve(vaultPath, relPath);
  const rootPrefix = root.endsWith(sep) ? root : root + sep;
  if (fullPath !== root && !fullPath.startsWith(rootPrefix)) throw makeErr(-32602, 'path traversal blocked');
  return fullPath;
}

function ensureDecisionPath(relPath: string): void {
  if (!relPath.endsWith('.md') || !relPath.includes('/decisions/')) {
    throw makeErr(-32602, 'path must point to a conversation decision markdown file');
  }
}

function decisionMarkdown(ctx: OperationContext, params: Record<string, unknown>, now: string): { path: string; content: string } {
  const actor = actorFromContext(ctx);
  const project = typeof params.project === 'string' && params.project.trim() ? safeSegment(params.project, 'project') : undefined;
  const title = String(params.title ?? '').trim();
  if (!title) throw makeErr(-32602, 'title required');
  const source = sourceObject(params.source);
  const sourceClient = source.client ?? 'unknown';
  const threadId = source.threadId ?? process.env.CODEX_THREAD_ID ?? '';
  const tags = normalizeList(params.tags);
  const path = decisionPath(project, actor, title, now);
  const content = [
    '---',
    'llmwiki-memory: decision',
    'conversation-decision: true',
    `actor: ${yamlString(actor)}`,
    project ? `project: ${yamlString(project)}` : 'project: null',
    `title: ${yamlString(title)}`,
    'status: captured',
    `captured-at: ${yamlString(now)}`,
    `source-client: ${yamlString(sourceClient)}`,
    `thread-id: ${yamlString(threadId)}`,
    `tags: ${yamlList(tags)}`,
    source.url ? `source-url: ${yamlString(source.url)}` : 'source-url: null',
    '---',
    '',
    `# ${title}`,
    '',
    '## Summary',
    '',
    textSection(params.summary),
    '',
    '## Decision',
    '',
    textSection(params.decision),
    '',
    '## Why',
    '',
    textSection(params.why),
    '',
    '## Rejected Options',
    '',
    listSection(params.rejectedOptions),
    '',
    '## Constraints Snapshot',
    '',
    listSection(params.constraints),
    '',
    '## Assumptions',
    '',
    listSection(params.assumptions),
    '',
    '## Risks',
    '',
    listSection(params.risks),
    '',
    '## Actions',
    '',
    listSection(params.actions),
    '',
    '## References',
    '',
    listSection(params.references),
    '',
    '## Conversation Excerpts',
    '',
    listSection(params.excerpts),
    '',
  ].join('\n');
  return { path, content };
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const raw = line.slice(colon + 1).trim();
    out[key] = raw.replace(/^"|"$/g, '');
  }
  return out;
}

function parseTags(raw: string | undefined): string[] {
  if (!raw || raw === '[]') return [];
  return raw
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((tag) => tag.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

function preview(content: string): string {
  return content
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function listDecisionDir(vaultPath: string, relDir: string, tag?: string): DecisionListItem[] {
  const fullDir = join(vaultPath, relDir);
  if (!existsSync(fullDir)) return [];
  return readdirSync(fullDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => {
      const fullPath = join(fullDir, entry.name);
      const content = readFileSync(fullPath, 'utf-8');
      const fm = parseFrontmatter(content);
      const tags = parseTags(fm.tags);
      return {
        path: `${relDir}/${entry.name}`,
        title: fm.title || entry.name.replace(/\.md$/, ''),
        preview: preview(content),
        status: fm.status || 'captured',
        captured_at: fm['captured-at'] || statSync(fullPath).mtime.toISOString(),
        tags,
      };
    })
    .filter((item) => !tag || item.tags.includes(tag))
    .sort((a, b) => b.captured_at.localeCompare(a.captured_at));
}

export function makeConversationOps(vaultPath: string): Operation[] {
  return [
    {
      name: 'conversation.decision.capture',
      namespace: 'conversation',
      description:
        'Capture an AI conversation decision as append-only Markdown memory with summary, decision, why, rejected options, constraints, risks, actions, references, and excerpts.',
      mutating: true,
      params: {
        project: { type: 'string', required: false, description: 'Optional project key; stores under 10-Projects/<project>/agents/<actor>/memory/decisions' },
        title: { type: 'string', required: true, description: 'Decision title' },
        summary: { type: 'string', required: false, description: 'Short decision context summary' },
        decision: { type: 'string', required: false, description: 'Final decision or current captured conclusion' },
        why: { type: 'string', required: false, description: 'Reasoning behind the decision' },
        rejectedOptions: { type: 'array', required: false, description: 'Alternatives considered and rejected' },
        constraints: { type: 'array', required: false, description: 'Constraint snapshot at decision time' },
        assumptions: { type: 'array', required: false, description: 'Assumptions that may invalidate decision later' },
        risks: { type: 'array', required: false, description: 'Risks and caveats' },
        actions: { type: 'array', required: false, description: 'Follow-up actions' },
        references: { type: 'array', required: false, description: 'Files, notes, links, issues, or sources referenced' },
        excerpts: { type: 'array', required: false, description: 'Selected conversation excerpts, not full transcript' },
        tags: { type: 'array', required: false, description: 'Tags for retrieval and filtering' },
        source: { type: 'object', required: false, description: 'Optional source metadata object, e.g. {client, threadId, url}' },
        dryRun: { type: 'boolean', required: false, default: false, description: 'Preview without writing (default: false)' },
      },
      handler: async (ctx, params) => {
        const now = new Date().toISOString();
        const { path, content } = decisionMarkdown(ctx, params, now);
        const dryRun = (params.dryRun as boolean | undefined) ?? false;
        if (!dryRun) {
          const fullPath = ensureInsideVault(vaultPath, path);
          mkdirSync(dirname(fullPath), { recursive: true });
          withFileLock(fullPath, () => writeFileSync(fullPath, content, { encoding: 'utf-8', flag: 'wx' }));
        }
        return {
          ok: true,
          dryRun,
          path,
          bytes: Buffer.byteLength(content, 'utf-8'),
          preview: content.slice(0, 2000),
        };
      },
    },
    {
      name: 'conversation.decision.list',
      namespace: 'conversation',
      description: 'List captured conversation decision Markdown notes newest first.',
      mutating: false,
      params: {
        project: { type: 'string', required: false, description: 'Optional project key; reads project-scoped decision memory' },
        limit: { type: 'number', required: false, default: 20, description: 'Maximum decisions return (default: 20)' },
        tag: { type: 'string', required: false, description: 'Optional tag filter' },
      },
      handler: async (ctx, params) => {
        const actor = actorFromContext(ctx);
        const project = typeof params.project === 'string' && params.project.trim() ? safeSegment(params.project, 'project') : undefined;
        const limit = Math.max(1, Math.min((params.limit as number | undefined) ?? 20, 100));
        const tag = typeof params.tag === 'string' && params.tag.trim() ? params.tag.trim() : undefined;
        const decisions = listDecisionDir(vaultPath, decisionBasePath(project, actor), tag).slice(0, limit);
        return { count: decisions.length, decisions };
      },
    },
    {
      name: 'conversation.decision.get',
      namespace: 'conversation',
      description: 'Read a captured conversation decision by exact vault-relative path.',
      mutating: false,
      params: {
        path: { type: 'string', required: true, description: 'Vault-relative decision markdown path' },
      },
      handler: async (_ctx, params) => {
        const relPath = normalizeVaultRelPath(String(params.path ?? ''));
        ensureDecisionPath(relPath);
        const fullPath = ensureInsideVault(vaultPath, relPath);
        if (!existsSync(fullPath)) throw makeErr(-32001, `Decision not found: ${relPath}`);
        const content = readFileSync(fullPath, 'utf-8');
        if (!/^conversation-decision:\s*true/m.test(content)) {
          throw makeErr(-32602, 'path is not a conversation decision note');
        }
        return { path: relPath, content };
      },
    },
  ];
}
