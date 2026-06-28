import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AdapterRegistry } from '../adapters/registry.js';
import type { Operation, OperationContext } from '../core/types.js';
import { makeErr } from '../core/types.js';
import { answerQuery, type QueryAnswerResult } from '../unified-query.js';
import { ensureBackfill } from '../adapters/vaultbrain/lazy-index.js';

const DEFAULT_ACTOR = 'agent';

interface MemoryDoc {
  path: string;
  exists: boolean;
  content: string;
}

interface RecallScope {
  project: string | null;
  glob?: string;
}

interface TraceSummary {
  selectedAdapters: string[];
  sources: Record<string, unknown>;
  totalResults: number;
  evidenceCount: number;
  limitations: string[];
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

function normalizeProject(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? safeSegment(value, 'project') : undefined;
}

function memoryBasePath(project: string | undefined, actor: string): string {
  if (project) return `10-Projects/${project}/agents/${actor}/memory`;
  return `00-Inbox/Agent-Memory/${actor}`;
}

function readText(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf-8') : null;
}

function defaultPassport(actor: string, project: string | undefined): string {
  return [
    '---',
    'llmwiki-memory: passport',
    `actor: ${JSON.stringify(actor)}`,
    project ? `project: ${JSON.stringify(project)}` : 'project: null',
    '---',
    '',
    '# Passport',
    '',
    '## Goal',
    '',
    '_Not captured._',
    '',
    '## Constraints',
    '',
    '- _None captured._',
    '',
    '## Decisions',
    '',
    '- _None captured._',
    '',
    '## Open Questions',
    '',
    '- _None captured._',
    '',
    '## Pointers',
    '',
    '- _None captured._',
    '',
  ].join('\n');
}

function defaultHandoff(actor: string, project: string | undefined): string {
  return [
    '---',
    'llmwiki-memory: handoff',
    `actor: ${JSON.stringify(actor)}`,
    project ? `project: ${JSON.stringify(project)}` : 'project: null',
    '---',
    '',
    '# Handoff',
    '',
    '## Current State',
    '',
    '_Not captured._',
    '',
    '## Next Steps',
    '',
    '- _None captured._',
    '',
    '## Risks',
    '',
    '- _None captured._',
    '',
    '## Files',
    '',
    '- _None captured._',
    '',
  ].join('\n');
}

function readMemoryDoc(vaultPath: string, relPath: string, fallback: string): MemoryDoc {
  const fullPath = join(vaultPath, relPath);
  const content = readText(fullPath);
  return { path: relPath, exists: content !== null, content: content ?? fallback };
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    out[key] = value.replace(/^"|"$/g, '');
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

function preview(content: string, max = 220): string {
  return content
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function listMarkdownFiles(vaultPath: string, relDir: string): Array<{ path: string; content: string; mtime: string }> {
  const fullDir = join(vaultPath, relDir);
  if (!existsSync(fullDir)) return [];
  return readdirSync(fullDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => {
      const fullPath = join(fullDir, entry.name);
      return {
        path: `${relDir}/${entry.name}`,
        content: readFileSync(fullPath, 'utf-8'),
        mtime: statSync(fullPath).mtime.toISOString(),
      };
    });
}

function listSessions(vaultPath: string, basePath: string, limit: number): Array<{ path: string; title: string; preview: string; updated_at: string }> {
  return listMarkdownFiles(vaultPath, `${basePath}/sessions`)
    .map((file) => ({
      path: file.path,
      title: file.content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? file.path.split('/').pop()?.replace(/\.md$/, '') ?? 'Session',
      preview: preview(file.content),
      updated_at: file.mtime,
    }))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, limit);
}

function listDecisions(vaultPath: string, basePath: string, limit: number): Array<{ path: string; title: string; preview: string; status: string; captured_at: string; tags: string[] }> {
  return listMarkdownFiles(vaultPath, `${basePath}/decisions`)
    .map((file) => {
      const fm = parseFrontmatter(file.content);
      return {
        path: file.path,
        title: fm.title || file.path.split('/').pop()?.replace(/\.md$/, '') || 'Decision',
        preview: preview(file.content),
        status: fm.status || 'captured',
        captured_at: fm['captured-at'] || file.mtime,
        tags: parseTags(fm.tags),
      };
    })
    .sort((a, b) => b.captured_at.localeCompare(a.captured_at))
    .slice(0, limit);
}

function scopeFor(project: string | undefined): RecallScope {
  return project ? { project, glob: `10-Projects/${project}/**` } : { project: null };
}

function mergeWeights(defaultWeights: Record<string, number> | undefined, params: Record<string, unknown>): Record<string, number> | undefined {
  const weights = {
    ...(defaultWeights ?? {}),
    ...(params.weights as Record<string, number> | undefined),
  };
  return Object.keys(weights).length > 0 ? weights : undefined;
}

async function answerForScope(
  registry: AdapterRegistry,
  defaultWeights: Record<string, number> | undefined,
  query: string,
  project: string | undefined,
  params: Record<string, unknown>,
  fallbackMaxResults: number,
): Promise<QueryAnswerResult> {
  if (!query.trim()) throw makeErr(-32602, 'query required');
  const scope = scopeFor(project);
  // Lazy backfill (13B): empty vaultbrain store -> trigger a one-time index so
  // context.recall works zero-setup; large vaults index in the background.
  const backfill = await ensureBackfill();
  const answer = await answerQuery(registry, query, {
    maxResults: (params.maxResults as number | undefined) ?? fallbackMaxResults,
    adapters: params.adapters as string[] | undefined,
    weights: mergeWeights(defaultWeights, params),
    glob: scope.glob,
  });
  if (backfill.status === 'indexing_background') {
    answer.gaps.unshift({ type: 'retrieval_limitation', message: `semantic index building in background (${backfill.fileCount} notes); recall sharpens once it finishes` });
  }
  return answer;
}

function summarizeTrace(answer: QueryAnswerResult): TraceSummary {
  return {
    selectedAdapters: answer.trace.plan.selectedAdapters,
    sources: answer.trace.sources,
    totalResults: answer.trace.totalResults,
    evidenceCount: answer.trace.evidence.length,
    limitations: answer.trace.limitations,
  };
}

function trimText(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function boundedWakeup<T extends { truncated: boolean; layers: Record<string, unknown> }>(result: T, maxChars: number): T {
  const clone = JSON.parse(JSON.stringify(result)) as T;
  if (JSON.stringify(clone).length <= maxChars) return clone;
  clone.truncated = true;
  const layers = clone.layers as {
    l0Identity?: MemoryDoc;
    l1EssentialStory?: {
      handoff?: MemoryDoc;
      decisions?: Array<{ preview: string }>;
      sessions?: Array<{ preview: string }>;
    };
    l2RoomRecall?: { answer?: string; claims?: unknown[]; traceSummary?: unknown };
  };
  if (layers.l2RoomRecall) {
    layers.l2RoomRecall.answer = trimText(layers.l2RoomRecall.answer ?? '', 600);
    layers.l2RoomRecall.claims = [];
    layers.l2RoomRecall.traceSummary = undefined;
  }
  if (JSON.stringify(clone).length <= maxChars) return clone;
  if (layers.l2RoomRecall) delete layers.l2RoomRecall;
  if (layers.l1EssentialStory?.sessions) {
    layers.l1EssentialStory.sessions = layers.l1EssentialStory.sessions.slice(0, 2).map((session) => ({
      ...session,
      preview: trimText(session.preview, 120),
    }));
  }
  if (layers.l1EssentialStory?.decisions) {
    layers.l1EssentialStory.decisions = layers.l1EssentialStory.decisions.slice(0, 2).map((decision) => ({
      ...decision,
      preview: trimText(decision.preview, 120),
    }));
  }
  if (layers.l1EssentialStory?.handoff) layers.l1EssentialStory.handoff.content = trimText(layers.l1EssentialStory.handoff.content, 900);
  if (layers.l0Identity) layers.l0Identity.content = trimText(layers.l0Identity.content, 900);
  if (JSON.stringify(clone).length <= maxChars) return clone;
  if (layers.l1EssentialStory?.handoff) layers.l1EssentialStory.handoff.content = trimText(layers.l1EssentialStory.handoff.content, 320);
  if (layers.l0Identity) layers.l0Identity.content = trimText(layers.l0Identity.content, 320);
  return clone;
}

function suggestedQueries(project: string | undefined, topic: string | undefined): string[] {
  const out = ['context.wakeup', 'context.deep_search'];
  if (topic) out.unshift(`context.recall:${topic}`);
  if (project) out.push(`project:${project}:open-actions`);
  return out;
}

export function makeContextOps(
  vaultPath: string,
  registry: AdapterRegistry,
  defaultWeights?: Record<string, number>,
): Operation[] {
  return [
    {
      name: 'context.wakeup',
      namespace: 'context',
      description:
        'Read-only MemPalace-style startup context: L0 passport, L1 handoff/sessions/decisions, optional L2 topic recall. Does not write files.',
      mutating: false,
      params: {
        project: { type: 'string', required: false, description: 'Optional project key; reads project-scoped actor memory' },
        topic: { type: 'string', required: false, description: 'Optional topic/room for recall' },
        maxChars: { type: 'number', required: false, default: 6000, description: 'Approximate maximum JSON character budget (default: 6000)' },
        maxDecisions: { type: 'number', required: false, default: 5, description: 'Maximum recent conversation decisions include (default: 5)' },
        maxSessions: { type: 'number', required: false, default: 5, description: 'Maximum recent session memories include (default: 5)' },
        includeRecall: { type: 'boolean', required: false, description: 'Run topic recall when topic provided (default: true when topic provided)' },
      },
      handler: async (ctx, params) => {
        const actor = actorFromContext(ctx);
        const project = normalizeProject(params.project);
        const topic = typeof params.topic === 'string' && params.topic.trim() ? params.topic.trim() : undefined;
        const maxChars = Math.max(1000, Math.floor((params.maxChars as number | undefined) ?? 6000));
        const maxDecisions = Math.max(0, Math.min(Math.floor((params.maxDecisions as number | undefined) ?? 5), 20));
        const maxSessions = Math.max(0, Math.min(Math.floor((params.maxSessions as number | undefined) ?? 5), 20));
        const includeRecall = (params.includeRecall as boolean | undefined) ?? Boolean(topic);
        const basePath = memoryBasePath(project, actor);
        const l0Identity = readMemoryDoc(vaultPath, `${basePath}/passport.md`, defaultPassport(actor, project));
        const handoff = readMemoryDoc(vaultPath, `${basePath}/handoff.md`, defaultHandoff(actor, project));
        const decisions = listDecisions(vaultPath, basePath, maxDecisions);
        const sessions = listSessions(vaultPath, basePath, maxSessions);
        const l2RoomRecall =
          includeRecall && topic
            ? await answerForScope(registry, defaultWeights, topic, project, { maxResults: 5 }, 5).then((answer) => ({
                query: topic,
                answer: answer.answer,
                claims: answer.claims,
                citations: answer.citations,
                gaps: answer.gaps,
                traceSummary: summarizeTrace(answer),
              }))
            : undefined;
        const result = {
          actor,
          project: project ?? null,
          topic: topic ?? null,
          generatedAt: new Date().toISOString(),
          layers: {
            l0Identity,
            l1EssentialStory: {
              handoff,
              decisions,
              sessions,
            },
            ...(l2RoomRecall ? { l2RoomRecall } : {}),
          },
          citations: l2RoomRecall?.citations ?? [],
          suggestedQueries: suggestedQueries(project, topic),
          truncated: false,
        };
        return boundedWakeup(result, maxChars);
      },
    },
    {
      name: 'context.recall',
      namespace: 'context',
      description: 'Topic-scoped citation-backed recall using query.answer. Project argument restricts search to 10-Projects/<project>/**.',
      mutating: false,
      params: {
        query: { type: 'string', required: true, description: 'Topic or question to recall' },
        project: { type: 'string', required: false, description: 'Optional project key to scope recall' },
        maxResults: { type: 'number', required: false, default: 8, description: 'Maximum evidence items (default: 8)' },
        adapters: { type: 'array', required: false, description: 'Limit specific adapters by name' },
        weights: { type: 'object', required: false, description: 'Per-adapter score weight multipliers' },
      },
      handler: async (_ctx, params) => {
        const query = String(params.query ?? '');
        const project = normalizeProject(params.project);
        const scope = scopeFor(project);
        const answer = await answerForScope(registry, defaultWeights, query, project, params, 8);
        return {
          query,
          scope,
          answer: answer.answer,
          claims: answer.claims,
          citations: answer.citations,
          gaps: answer.gaps,
          traceSummary: summarizeTrace(answer),
        };
      },
    },
    {
      name: 'context.deep_search',
      namespace: 'context',
      description: 'Heavier citation-backed context search returning full query.answer trace for complex cross-vault or project-scoped questions.',
      mutating: false,
      params: {
        query: { type: 'string', required: true, description: 'Question to answer with deeper trace' },
        project: { type: 'string', required: false, description: 'Optional project key to scope search' },
        maxResults: { type: 'number', required: false, default: 20, description: 'Maximum evidence items (default: 20)' },
        adapters: { type: 'array', required: false, description: 'Limit specific adapters by name' },
        weights: { type: 'object', required: false, description: 'Per-adapter score weight multipliers' },
      },
      handler: async (_ctx, params) => {
        const query = String(params.query ?? '');
        const project = normalizeProject(params.project);
        const scope = scopeFor(project);
        const answer = await answerForScope(registry, defaultWeights, query, project, params, 20);
        return {
          query,
          scope,
          answer: answer.answer,
          claims: answer.claims,
          citations: answer.citations,
          gaps: answer.gaps,
          contradictions: answer.contradictions,
          confidence: answer.confidence,
          trace: answer.trace,
        };
      },
    },
  ];
}
