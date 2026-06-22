import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { Operation, OperationContext } from '../core/types.js';
import { makeErr } from '../core/types.js';

const STATE_TYPE_TO_STATUS = {
  backlog: 'Backlog',
  unstarted: 'Todo',
  started: 'In Progress',
  completed: 'Done',
  canceled: 'Canceled',
} as const;

const VALID_STATE_TYPES = Object.keys(STATE_TYPE_TO_STATUS) as Array<keyof typeof STATE_TYPE_TO_STATUS>;
const VALID_STATUSES = Object.values(STATE_TYPE_TO_STATUS);
const VALID_PRIORITIES = ['Urgent', 'High', 'Medium', 'Low', 'No priority'] as const;
const VALID_RHIZOME_KINDS = ['spec', 'reference', 'runbook', 'decision', 'research', 'note', 'index'] as const;
const VALID_RELATIONS = ['blocks', 'blocked_by', 'relates', 'duplicates', 'parent', 'child', 'depends_on'] as const;

type StateType = keyof typeof STATE_TYPE_TO_STATUS;
type Status = (typeof VALID_STATUSES)[number];
type Priority = (typeof VALID_PRIORITIES)[number];
type Relation = (typeof VALID_RELATIONS)[number];

interface IssueFrontmatter {
  id: string;
  title: string;
  status: Status;
  state_type: StateType;
  priority: Priority;
  project: string;
  assignee: string;
  parent: string;
  blocked_by: string[];
  tags: string[];
  milestone: string;
  batch: string;
  created_at: string;
  updated_at: string;
}

interface IssueRecord extends IssueFrontmatter {
  path: string;
  summary: string;
  links: Array<{ relation: string; target: string }>;
}

function safeSegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..' || trimmed.includes('/') || trimmed.includes('\\') || /^[A-Za-z]:/.test(trimmed) || trimmed.startsWith('//')) {
    throw makeErr(-32602, `${label} must be single safe path segment`);
  }
  return trimmed;
}

function safeDocketId(value: string): string {
  const trimmed = value.trim();
  if (!/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(trimmed)) throw makeErr(-32602, 'id must look like ISSUE-1');
  return trimmed.toUpperCase();
}

function actorFromContext(ctx: OperationContext): string {
  return safeSegment(ctx.config.collaboration?.actor || process.env.VAULT_MIND_ACTOR || 'agent', 'actor');
}

function idPrefix(): string {
  const raw = process.env.DOCKET_ID_PREFIX || 'ISSUE';
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return cleaned || 'ISSUE';
}

function projectRoot(project: string): string {
  return `10-Projects/${safeSegment(project, 'project')}`;
}

function docketRoot(project: string): string {
  return `${projectRoot(project)}/docket`;
}

function issuesRoot(project: string): string {
  return `${docketRoot(project)}/issues`;
}

function commentsRoot(project: string): string {
  return `${docketRoot(project)}/comments`;
}

function docketProjectsRoot(project: string): string {
  return `${docketRoot(project)}/projects`;
}

function issuePath(project: string, id: string): string {
  return `${issuesRoot(project)}/${safeDocketId(id)}.md`;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function yamlFlowList(values: string[]): string {
  if (values.length === 0) return '[]';
  return `[${values.map(yamlString).join(', ')}]`;
}

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
}

function normalizeState(value: unknown, fallback: StateType = 'unstarted'): { status: Status; state_type: StateType } {
  if (typeof value !== 'string' || !value.trim()) return { state_type: fallback, status: STATE_TYPE_TO_STATUS[fallback] };
  const raw = value.trim();
  if ((VALID_STATE_TYPES as string[]).includes(raw)) {
    const state_type = raw as StateType;
    return { state_type, status: STATE_TYPE_TO_STATUS[state_type] };
  }
  const status = VALID_STATUSES.find((candidate) => candidate.toLowerCase() === raw.toLowerCase());
  if (status) {
    const state_type = (Object.entries(STATE_TYPE_TO_STATUS).find(([, display]) => display === status)?.[0] ?? fallback) as StateType;
    return { state_type, status };
  }
  throw makeErr(-32602, 'unknown status; use backlog/unstarted/started/completed/canceled or Backlog/Todo/In Progress/Done/Canceled');
}

function normalizePriority(value: unknown, fallback: Priority = 'No priority'): Priority {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const priority = VALID_PRIORITIES.find((candidate) => candidate.toLowerCase() === value.trim().toLowerCase());
  if (!priority) throw makeErr(-32602, 'unknown priority; use Urgent/High/Medium/Low/No priority');
  return priority;
}

function enumValue<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T[number]) : fallback;
}

function readText(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf-8') : null;
}

function writeVaultText(vaultPath: string, relPath: string, content: string): void {
  const fullPath = join(vaultPath, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf-8');
}

function nextIssueId(vaultPath: string, project: string): string {
  const dir = join(vaultPath, issuesRoot(project));
  let max = 0;
  const prefix = idPrefix();
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const match = entry.name.match(new RegExp(`^${prefix}-(\\d+)`));
      if (match) max = Math.max(max, Number(match[1]));
    }
  }
  return `${prefix}-${max + 1}`;
}

function projectIndex(project: string, actor: string, now: string): string {
  return [
    '---',
    'llmwiki-project: true',
    `project: ${yamlString(project)}`,
    `owner: ${yamlString(actor)}`,
    `created_at: ${yamlString(now)}`,
    `updated_at: ${yamlString(now)}`,
    '---',
    '',
    `# ${project}`,
    '',
    '## Goal',
    '',
    'TBD',
    '',
    '## Local PM',
    '',
    '- [[docket/board|Board]]',
    '- [[docket/rhizome|Rhizome]]',
    '- `docket/issues/*.md` uses docket-compatible Markdown frontmatter.',
    '- `docket/projects/*.md` mirrors docket project containers.',
    '',
  ].join('\n');
}

function docketProjectMarkdown(project: string, actor: string, now: string): string {
  return [
    '---',
    `key: ${project}`,
    `title: ${yamlString(project)}`,
    `prefix: ${project.toUpperCase().slice(0, 8)}`,
    'status: active',
    `owner: ${yamlString(actor)}`,
    `created_at: ${yamlString(now)}`,
    `updated_at: ${yamlString(now)}`,
    '---',
    '',
    `# ${project}`,
    '',
  ].join('\n');
}

function boardMarkdown(project: string, now: string): string {
  return [
    '---',
    'kanban-plugin: board',
    `project: ${yamlString(project)}`,
    `updated_at: ${yamlString(now)}`,
    '---',
    '',
    '# Board',
    '',
    '## Backlog',
    '',
    '## Todo',
    '',
    '## In Progress',
    '',
    '## Done',
    '',
    '***',
    '',
    '## Canceled',
    '',
    '%% kanban:settings',
    '```json',
    '{"kanban-plugin":"board"}',
    '```',
    '%%',
    '',
  ].join('\n');
}

function rhizomeMarkdown(project: string, now: string): string {
  return [
    '---',
    `description: ${yamlString(`Local project rhizome for ${project}`)}`,
    `keywords: ${yamlFlowList([project, 'docket', 'rhizome'])}`,
    'kind: index',
    'links: []',
    'code: []',
    `updated_at: ${yamlString(now)}`,
    '---',
    '',
    '# Rhizome',
    '',
    'Local issue, note, and asset relationships for this project.',
    '',
    '## Links',
    '',
  ].join('\n');
}

function issueMarkdown(issue: IssueFrontmatter, summary: string, body: string, links: Array<{ relation: string; target: string }>): string {
  const fields = [
    '---',
    `id: ${issue.id}`,
    `title: ${yamlString(issue.title)}`,
    `status: ${issue.status}`,
    `state_type: ${issue.state_type}`,
    `priority: ${issue.priority}`,
    `project: ${yamlString(issue.project)}`,
    `assignee: ${yamlString(issue.assignee)}`,
    `parent: ${issue.parent || '~'}`,
    `blocked_by: ${yamlFlowList(issue.blocked_by)}`,
    `tags: ${yamlFlowList(issue.tags)}`,
  ];
  if (issue.milestone) fields.push(`milestone: ${yamlString(issue.milestone)}`);
  if (issue.batch) fields.push(`batch: ${issue.batch}`);
  fields.push(`created_at: ${yamlString(issue.created_at)}`);
  fields.push(`updated_at: ${yamlString(issue.updated_at)}`);
  fields.push('---');
  return [
    ...fields,
    '',
    `# ${issue.id} ${issue.title}`,
    '',
    '## Summary',
    '',
    summary || 'TBD',
    '',
    '## Details',
    '',
    body || '',
    '',
    '## Links',
    '',
    ...(links.length ? links.map((link) => `- ${link.relation}: ${link.target}`) : ['- none']),
    '',
  ].join('\n');
}

function commentBlock(actor: string, session: string, body: string, now: string): string {
  const sessionPart = session ? ` · session ${session}` : '';
  return `## ${now} · ${actor}${sessionPart}\n\n${body.trim()}\n\n---\n\n`;
}

function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, unknown> = {};
  for (const rawLine of match[1].split('\n')) {
    const kv = rawLine.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, rawValue] = kv;
    const value = rawValue.trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim();
      result[key] = inner ? inner.split(',').map((item) => item.trim().replace(/^"|"$/g, '')) : [];
    } else if (value === 'true') {
      result[key] = true;
    } else if (value === 'false') {
      result[key] = false;
    } else {
      result[key] = value.replace(/^"|"$/g, '');
    }
  }
  return result;
}

function section(content: string, heading: string): string {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) return '';
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}

function parseLinks(content: string): Array<{ relation: string; target: string }> {
  const linkSection = section(content, 'Links');
  return linkSection
    .split('\n')
    .map((line) => line.trim().match(/^-\s+([^:]+):\s+(.+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .filter((match) => match[1] !== 'none')
    .map((match) => ({ relation: match[1].trim(), target: match[2].trim() }));
}

function parseIssue(relPath: string, content: string): IssueRecord {
  const fm = parseFrontmatter(content);
  const state = normalizeState(String(fm.state_type || fm.status || 'unstarted'));
  return {
    path: relPath,
    id: String(fm.id ?? relPath.split('/').pop()?.replace(/\.md$/, '') ?? ''),
    title: String(fm.title ?? ''),
    status: state.status,
    state_type: state.state_type,
    priority: normalizePriority(fm.priority),
    project: String(fm.project ?? ''),
    assignee: String(fm.assignee ?? ''),
    parent: String(fm.parent ?? '~'),
    blocked_by: Array.isArray(fm.blocked_by) ? fm.blocked_by.map(String) : [],
    tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
    milestone: String(fm.milestone ?? ''),
    batch: String(fm.batch ?? ''),
    created_at: String(fm.created_at ?? ''),
    updated_at: String(fm.updated_at ?? ''),
    summary: section(content, 'Summary'),
    links: parseLinks(content),
  };
}

function findIssue(vaultPath: string, project: string, id: string): { relPath: string; content: string } {
  const fullPath = join(vaultPath, issuePath(project, id));
  if (!existsSync(fullPath)) throw makeErr(-32001, `Issue not found: ${id}`);
  return { relPath: relative(vaultPath, fullPath).replace(/\\/g, '/'), content: readFileSync(fullPath, 'utf-8') };
}

function issueToBoardCard(issue: IssueRecord): string {
  return `- [${issue.state_type === 'completed' ? 'x' : ' '}] ${issue.id} ${issue.title}`;
}

function listIssues(vaultPath: string, project: string, filters: Record<string, unknown>): IssueRecord[] {
  const dir = join(vaultPath, issuesRoot(project));
  if (!existsSync(dir)) return [];
  const requestedState = typeof filters.status === 'string' ? normalizeState(filters.status).state_type : undefined;
  const assignee = typeof filters.assignee === 'string' ? filters.assignee : undefined;
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => {
      const relPath = `${issuesRoot(project)}/${entry.name}`;
      return parseIssue(relPath, readFileSync(join(dir, entry.name), 'utf-8'));
    })
    .filter((issue) => !requestedState || issue.state_type === requestedState)
    .filter((issue) => !assignee || issue.assignee === assignee)
    .sort((a, b) => Number(a.id.split('-')[1] ?? 0) - Number(b.id.split('-')[1] ?? 0));
}

function regenerateBoard(vaultPath: string, project: string): void {
  const now = new Date().toISOString();
  const issues = listIssues(vaultPath, project, {});
  const lanes: Record<StateType, IssueRecord[]> = { backlog: [], unstarted: [], started: [], completed: [], canceled: [] };
  for (const issue of issues) lanes[issue.state_type].push(issue);
  const content = [
    '---',
    'kanban-plugin: board',
    `project: ${yamlString(project)}`,
    `updated_at: ${yamlString(now)}`,
    '---',
    '',
    '# Board',
    '',
    '## Backlog',
    '',
    ...lanes.backlog.map(issueToBoardCard),
    '',
    '## Todo',
    '',
    ...lanes.unstarted.map(issueToBoardCard),
    '',
    '## In Progress',
    '',
    ...lanes.started.map(issueToBoardCard),
    '',
    '## Done',
    '',
    ...lanes.completed.map(issueToBoardCard),
    '',
    '***',
    '',
    '## Canceled',
    '',
    ...lanes.canceled.map(issueToBoardCard),
    '',
    '%% kanban:settings',
    '```json',
    '{"kanban-plugin":"board"}',
    '```',
    '%%',
    '',
  ].join('\n');
  writeVaultText(vaultPath, `${docketRoot(project)}/board.md`, content);
}

function appendRhizome(vaultPath: string, project: string, line: string): void {
  const rhizomePath = `${docketRoot(project)}/rhizome.md`;
  const rhizome = readText(join(vaultPath, rhizomePath)) ?? rhizomeMarkdown(project, new Date().toISOString());
  const next = rhizome.includes(line) ? rhizome : `${rhizome.trimEnd()}\n${line}\n`;
  writeVaultText(vaultPath, rhizomePath, next);
}

export function makeProjectOps(vaultPath: string): Operation[] {
  return [
    {
      name: 'project.init',
      namespace: 'project' as Operation['namespace'],
      description: 'Seed a local docket/rhizome/seed-inspired project workspace under 10-Projects/<project>.',
      mutating: true,
      params: { project: { type: 'string', required: true, description: 'Project key, single safe path segment' } },
      handler: async (ctx, params) => {
        const project = safeSegment(params.project as string, 'project');
        const actor = actorFromContext(ctx);
        const now = new Date().toISOString();
        const writes = [
          { path: `${projectRoot(project)}/project.md`, content: projectIndex(project, actor, now) },
          { path: `${docketRoot(project)}/board.md`, content: boardMarkdown(project, now) },
          { path: `${docketRoot(project)}/rhizome.md`, content: rhizomeMarkdown(project, now) },
          { path: `${docketProjectsRoot(project)}/${project}.md`, content: docketProjectMarkdown(project, actor, now) },
          { path: `${docketRoot(project)}/docs/INDEX.md`, content: '# Project docs\n\nRhizome domain index for project documentation.\n' },
          { path: `${docketRoot(project)}/docs/architecture.md`, content: '# Architecture\n\nLocal development map for this project.\n' },
        ];
        for (const write of writes) if (!existsSync(join(vaultPath, write.path))) writeVaultText(vaultPath, write.path, write.content);
        mkdirSync(join(vaultPath, issuesRoot(project)), { recursive: true });
        mkdirSync(join(vaultPath, commentsRoot(project)), { recursive: true });
        return { ok: true, project, root: projectRoot(project), files: writes.map((write) => write.path) };
      },
    },
    {
      name: 'project.issue.create',
      namespace: 'project' as Operation['namespace'],
      description: 'Create a docket-compatible Markdown issue. Default status is Todo/unstarted.',
      mutating: true,
      params: {
        project: { type: 'string', required: true, description: 'Project key' },
        title: { type: 'string', required: true, description: 'Issue title' },
        summary: { type: 'string', required: false, description: 'Short issue summary' },
        body: { type: 'string', required: false, description: 'Detailed issue body' },
        status: { type: 'string', required: false, description: 'Docket status or state_type' },
        priority: { type: 'string', required: false, enum: [...VALID_PRIORITIES], default: 'No priority', description: 'Docket priority' },
        assignee: { type: 'string', required: false, description: 'Actor or human owner' },
        tags: { type: 'array', required: false, description: 'Issue tags' },
        blocked_by: { type: 'array', required: false, description: 'Blocking issue ids' },
        parent: { type: 'string', required: false, description: 'Parent issue id or ~' },
        milestone: { type: 'string', required: false, description: 'Milestone label' },
        batch: { type: 'number', required: false, description: 'Rolling batch ordinal' },
      },
      handler: async (ctx, params) => {
        const project = safeSegment(params.project as string, 'project');
        const title = String(params.title ?? '').trim();
        if (!title) throw makeErr(-32602, 'title required');
        const now = new Date().toISOString();
        const id = nextIssueId(vaultPath, project);
        const state = normalizeState(params.status);
        const issue: IssueFrontmatter = {
          id,
          title,
          status: state.status,
          state_type: state.state_type,
          priority: normalizePriority(params.priority),
          project,
          assignee: typeof params.assignee === 'string' && params.assignee.trim() ? params.assignee.trim() : actorFromContext(ctx),
          parent: typeof params.parent === 'string' && params.parent.trim() ? params.parent.trim() : '~',
          blocked_by: normalizeList(params.blocked_by).map(safeDocketId),
          tags: normalizeList(params.tags),
          milestone: typeof params.milestone === 'string' ? params.milestone.trim() : '',
          batch: typeof params.batch === 'number' ? String(Math.trunc(params.batch)) : '',
          created_at: now,
          updated_at: now,
        };
        const path = issuePath(project, id);
        writeVaultText(vaultPath, path, issueMarkdown(issue, String(params.summary ?? ''), String(params.body ?? ''), []));
        regenerateBoard(vaultPath, project);
        return { ok: true, id, path, issue };
      },
    },
    {
      name: 'project.issue.list',
      namespace: 'project' as Operation['namespace'],
      description: 'List local project issues, optionally filtered by docket status/state_type or assignee.',
      mutating: false,
      params: {
        project: { type: 'string', required: true, description: 'Project key' },
        status: { type: 'string', required: false, description: 'Optional status or state_type filter' },
        assignee: { type: 'string', required: false, description: 'Optional assignee filter' },
      },
      handler: async (_ctx, params) => {
        const project = safeSegment(params.project as string, 'project');
        const issues = listIssues(vaultPath, project, params);
        return { count: issues.length, issues };
      },
    },
    {
      name: 'project.issue.get',
      namespace: 'project' as Operation['namespace'],
      description: 'Read a local project issue by id.',
      mutating: false,
      params: {
        project: { type: 'string', required: true, description: 'Project key' },
        id: { type: 'string', required: true, description: 'Issue id, e.g. ISSUE-1' },
      },
      handler: async (_ctx, params) => {
        const project = safeSegment(params.project as string, 'project');
        const found = findIssue(vaultPath, project, params.id as string);
        return { issue: parseIssue(found.relPath, found.content), content: found.content };
      },
    },
    {
      name: 'project.issue.update',
      namespace: 'project' as Operation['namespace'],
      description: 'Update status/state_type, priority, assignee, dependency fields, summary, or body for a local project issue.',
      mutating: true,
      params: {
        project: { type: 'string', required: true, description: 'Project key' },
        id: { type: 'string', required: true, description: 'Issue id' },
        status: { type: 'string', required: false, description: 'New status or state_type' },
        priority: { type: 'string', required: false, enum: [...VALID_PRIORITIES], description: 'New priority' },
        assignee: { type: 'string', required: false, description: 'New assignee' },
        tags: { type: 'array', required: false, description: 'Replacement tags' },
        blocked_by: { type: 'array', required: false, description: 'Replacement blocking issue ids' },
        parent: { type: 'string', required: false, description: 'Replacement parent issue id or ~' },
        summary: { type: 'string', required: false, description: 'Replacement summary' },
        body: { type: 'string', required: false, description: 'Replacement details body' },
      },
      handler: async (_ctx, params) => {
        const project = safeSegment(params.project as string, 'project');
        const found = findIssue(vaultPath, project, params.id as string);
        const current = parseIssue(found.relPath, found.content);
        const state = params.status === undefined ? current : normalizeState(params.status, current.state_type);
        const now = new Date().toISOString();
        const issue: IssueFrontmatter = {
          ...current,
          status: state.status,
          state_type: state.state_type,
          priority: params.priority === undefined ? current.priority : normalizePriority(params.priority, current.priority),
          assignee: typeof params.assignee === 'string' ? params.assignee.trim() : current.assignee,
          tags: Array.isArray(params.tags) ? normalizeList(params.tags) : current.tags,
          blocked_by: Array.isArray(params.blocked_by) ? normalizeList(params.blocked_by).map(safeDocketId) : current.blocked_by,
          parent: typeof params.parent === 'string' ? params.parent.trim() || '~' : current.parent,
          updated_at: now,
        };
        const summary = typeof params.summary === 'string' ? params.summary : current.summary;
        const body = typeof params.body === 'string' ? params.body : section(found.content, 'Details');
        writeVaultText(vaultPath, found.relPath, issueMarkdown(issue, summary, body, current.links));
        regenerateBoard(vaultPath, project);
        return { ok: true, path: found.relPath, issue };
      },
    },
    {
      name: 'project.issue.link',
      namespace: 'project' as Operation['namespace'],
      description: 'Add a rhizome relationship. blocks/blocked_by also update docket blocked_by dependencies.',
      mutating: true,
      params: {
        project: { type: 'string', required: true, description: 'Project key' },
        id: { type: 'string', required: true, description: 'Source issue id' },
        relation: { type: 'string', required: true, enum: [...VALID_RELATIONS], description: 'Relationship type' },
        target: { type: 'string', required: true, description: 'Target issue id or note slug/path' },
      },
      handler: async (_ctx, params) => {
        const project = safeSegment(params.project as string, 'project');
        const relation = enumValue(params.relation, VALID_RELATIONS, 'relates') as Relation;
        const target = String(params.target ?? '').trim();
        if (!target) throw makeErr(-32602, 'target required');
        const found = findIssue(vaultPath, project, params.id as string);
        const issue = parseIssue(found.relPath, found.content);
        const links = [...issue.links, { relation, target }];
        writeVaultText(vaultPath, found.relPath, issueMarkdown(issue, issue.summary, section(found.content, 'Details'), links));
        if (relation === 'blocked_by') {
          const nextBlockedBy = Array.from(new Set([...issue.blocked_by, safeDocketId(target)]));
          writeVaultText(vaultPath, found.relPath, issueMarkdown({ ...issue, blocked_by: nextBlockedBy }, issue.summary, section(found.content, 'Details'), links));
        }
        if (relation === 'blocks') {
          const targetFound = findIssue(vaultPath, project, target);
          const targetIssue = parseIssue(targetFound.relPath, targetFound.content);
          const nextBlockedBy = Array.from(new Set([...targetIssue.blocked_by, issue.id]));
          writeVaultText(vaultPath, targetFound.relPath, issueMarkdown({ ...targetIssue, blocked_by: nextBlockedBy }, targetIssue.summary, section(targetFound.content, 'Details'), targetIssue.links));
        }
        appendRhizome(vaultPath, project, `- ${issue.id} ${relation} ${target}`);
        regenerateBoard(vaultPath, project);
        return { ok: true, path: found.relPath, relation, target, rhizomePath: `${docketRoot(project)}/rhizome.md` };
      },
    },
    {
      name: 'project.comment.add',
      namespace: 'project' as Operation['namespace'],
      description: 'Append a docket-style comment block under docket/comments/<issue-id>.md.',
      mutating: true,
      params: {
        project: { type: 'string', required: true, description: 'Project key' },
        id: { type: 'string', required: true, description: 'Issue id' },
        body: { type: 'string', required: true, description: 'Comment Markdown body' },
        actor: { type: 'string', required: false, description: 'Comment actor; defaults to collaboration actor' },
        session: { type: 'string', required: false, description: 'Optional session/thread id' },
      },
      handler: async (ctx, params) => {
        const project = safeSegment(params.project as string, 'project');
        const id = safeDocketId(params.id as string);
        findIssue(vaultPath, project, id);
        const body = String(params.body ?? '').trim();
        if (!body) throw makeErr(-32602, 'body required');
        const actor = typeof params.actor === 'string' && params.actor.trim() ? safeSegment(params.actor, 'actor') : actorFromContext(ctx);
        const session = typeof params.session === 'string' ? params.session.trim() : process.env.CODEX_THREAD_ID || '';
        const path = `${commentsRoot(project)}/${id}.md`;
        const existing = readText(join(vaultPath, path)) ?? `# Comments for ${id}\n\n`;
        const now = new Date().toISOString();
        writeVaultText(vaultPath, path, existing.trimEnd() + '\n\n' + commentBlock(actor, session, body, now));
        return { ok: true, path, actor, session };
      },
    },
    {
      name: 'project.board.get',
      namespace: 'project' as Operation['namespace'],
      description: 'Return the generated Markdown Kanban board for a local project.',
      mutating: false,
      params: { project: { type: 'string', required: true, description: 'Project key' } },
      handler: async (_ctx, params) => {
        const project = safeSegment(params.project as string, 'project');
        const path = `${docketRoot(project)}/board.md`;
        const content = readText(join(vaultPath, path)) ?? '';
        return { exists: Boolean(content), path, content };
      },
    },
  ];
}
