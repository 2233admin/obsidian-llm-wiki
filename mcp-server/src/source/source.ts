import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join, relative, isAbsolute as pathIsAbsolute } from 'node:path';
import type { Operation, OperationContext } from '../core/types.js';
import { badRequest, conflict, notFound, unsupported } from '../core/types.js';
import { preflight } from '../ingest/ingest.js';

type SourceInputType = 'url' | 'vaultPath' | 'filePath' | 'directoryPath' | 'repoPath' | 'text';

interface SourceRecord {
  id: string;
  inputType: SourceInputType;
  input: string;
  canonical: string;
  platform: string;
  sourceKind: string;
  title: string;
  project?: string;
  actor: string;
  notePath: string;
  tags: string[];
  notes?: string;
  preflight?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface SourceRegistry {
  version: 1;
  updated_at: string;
  sources: Record<string, SourceRecord>;
}

const REGISTRY_REL_PATH = '_llmwiki/source-registry.json';
const LOCK_TTL_MS = 60_000;
const RESERVED_INPUT_TYPES = new Set<SourceInputType>(['filePath', 'directoryPath', 'repoPath', 'text']);
const PROTECTED_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules']);

export function makeSourceOps(vaultPath: string): Operation[] {
  return [
    {
      name: 'source.register',
      namespace: 'source',
      description:
        'Register a long-lived source in the lightweight Source Registry. URL inputs run ingest preflight only; no download or transcription is executed.',
      mutating: true,
      params: {
        input: { type: 'string', required: true, description: 'URL or vault-relative path to register' },
        inputType: {
          type: 'string',
          required: false,
          default: 'url',
          enum: ['url', 'vaultPath', 'filePath', 'directoryPath', 'repoPath', 'text'],
          description: 'Source input type. Phase 1 supports url and vaultPath only.',
        },
        title: { type: 'string', required: false, description: 'Human-readable source title' },
        project: { type: 'string', required: false, description: 'Optional project slug for project-scoped Source Notes' },
        platform: { type: 'string', required: false, description: 'Optional platform override such as douyin, bilibili, x, youtube' },
        sourceKind: { type: 'string', required: false, description: 'Optional source kind override such as profile, video, post, channel' },
        preferredProvider: {
          type: 'string',
          required: false,
          enum: ['opencli', 'media'],
          description: 'Optional preflight provider preference. Preflight remains read-only.',
        },
        tags: { type: 'array', required: false, description: 'Optional tags for the Source Note and registry record' },
        notes: { type: 'string', required: false, description: 'Optional operator notes stored in the Source Note' },
      },
      handler: async (ctx, params) => registerSource(ctx, vaultPath, params),
    },
    {
      name: 'source.list',
      namespace: 'source',
      description: 'List Source Registry records, optionally filtered by project, platform, or inputType.',
      mutating: false,
      params: {
        project: { type: 'string', required: false, description: 'Filter by project slug' },
        platform: { type: 'string', required: false, description: 'Filter by platform' },
        inputType: {
          type: 'string',
          required: false,
          enum: ['url', 'vaultPath'],
          description: 'Filter by supported input type',
        },
      },
      handler: async (_ctx, params) => listSources(vaultPath, params),
    },
    {
      name: 'source.get',
      namespace: 'source',
      description: 'Get one Source Registry record by id, canonical URL/path, or original input.',
      mutating: false,
      params: {
        id: { type: 'string', required: false, description: 'Source id returned by source.register' },
        input: { type: 'string', required: false, description: 'Original URL or vault-relative path' },
        inputType: {
          type: 'string',
          required: false,
          default: 'url',
          enum: ['url', 'vaultPath'],
          description: 'Input type used when resolving input to a source id',
        },
      },
      handler: async (_ctx, params) => getSource(vaultPath, params),
    },
  ];
}

function registerSource(
  ctx: OperationContext,
  vaultPath: string,
  params: Record<string, unknown>,
): SourceRecord & { ok: true; path: string; registryPath: string } {
  const input = requireString(params.input, 'input');
  const inputType = parseInputType(params.inputType);
  if (RESERVED_INPUT_TYPES.has(inputType)) {
    throw unsupported(`source.register does not support inputType=${inputType} in Phase 1`);
  }

  const project = optionalSafeSegment(params.project, 'project');
  const actor = actorFromContext(ctx);
  const titleOverride = optionalString(params.title);
  const tags = stringArray(params.tags);
  const notes = optionalString(params.notes);
  const now = new Date().toISOString();

  const prepared =
    inputType === 'url'
      ? prepareUrlSource(input, params)
      : prepareVaultPathSource(vaultPath, input, params);

  const title = titleOverride ?? prepared.title;
  const id = sourceId(prepared.canonical);
  const registryPath = registryFullPath(vaultPath);
  let saved: SourceRecord | undefined;

  withFileLock(registryPath, () => {
    const registry = readRegistry(registryPath);
    const existing = registry.sources[id];
    const notePath =
      existing?.notePath ??
      sourceNotePath(project, prepared.platform, `${slugify(title)}-${id.slice(4)}`);
    const record: SourceRecord = {
      id,
      inputType,
      input,
      canonical: prepared.canonical,
      platform: prepared.platform,
      sourceKind: prepared.sourceKind,
      title,
      project,
      actor,
      notePath,
      tags,
      notes,
      preflight: prepared.preflight,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };

    writeTextLocked(
      join(vaultPath, notePath.replace(/\//g, '\\')),
      sourceNoteMarkdown(record),
    );
    registry.sources[id] = record;
    registry.updated_at = now;
    writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n', 'utf-8');
    saved = record;
  });

  if (!saved) throw conflict('source.register failed to persist registry record');
  return { ...saved, ok: true, path: saved.notePath, registryPath: REGISTRY_REL_PATH };
}

function listSources(vaultPath: string, params: Record<string, unknown>): { sources: SourceRecord[] } {
  const registry = readRegistry(registryFullPath(vaultPath));
  const project = optionalString(params.project);
  const platform = optionalString(params.platform);
  const inputType = optionalString(params.inputType);
  const sources = Object.values(registry.sources)
    .filter((source) => (project ? source.project === project : true))
    .filter((source) => (platform ? source.platform === platform : true))
    .filter((source) => (inputType ? source.inputType === inputType : true))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return { sources };
}

function getSource(vaultPath: string, params: Record<string, unknown>): SourceRecord {
  const registry = readRegistry(registryFullPath(vaultPath));
  const id = optionalString(params.id) ?? sourceIdForInput(vaultPath, params);
  if (!id) throw badRequest('source.get requires id or input');
  const source = registry.sources[id];
  if (!source) throw notFound(`Source not found: ${id}`);
  return source;
}

function sourceIdForInput(vaultPath: string, params: Record<string, unknown>): string | undefined {
  const input = optionalString(params.input);
  if (!input) return undefined;
  const inputType = parseInputType(params.inputType);
  if (inputType === 'url') return sourceId(canonicalUrl(input));
  if (inputType === 'vaultPath') return sourceId(`vault:${normalizeVaultRelPath(vaultPath, input)}`);
  throw unsupported(`source.get does not support inputType=${inputType} in Phase 1`);
}

function prepareUrlSource(input: string, params: Record<string, unknown>): {
  canonical: string;
  platform: string;
  sourceKind: string;
  title: string;
  preflight: Record<string, unknown>;
} {
  const canonical = canonicalUrl(input);
  const preferredProvider = optionalString(params.preferredProvider);
  const plan = preflight({ url: canonical, preferredProvider }) as Record<string, unknown>;
  const platform = safeSegment(
    optionalString(params.platform) ?? stringValue(plan.platform) ?? detectPlatform(canonical),
    'platform',
  );
  const sourceKind =
    optionalString(params.sourceKind) ?? stringValue(plan.sourceKind) ?? stringValue(plan.source_kind) ?? 'url';
  return {
    canonical,
    platform,
    sourceKind,
    title: titleFromUrl(canonical),
    preflight: plan,
  };
}

function prepareVaultPathSource(
  vaultPath: string,
  input: string,
  params: Record<string, unknown>,
): {
  canonical: string;
  platform: string;
  sourceKind: string;
  title: string;
  preflight?: Record<string, unknown>;
} {
  const normalized = normalizeVaultRelPath(vaultPath, input);
  if (!existsSync(join(vaultPath, normalized.replace(/\//g, '\\')))) {
    throw notFound(`Vault path not found: ${normalized}`);
  }
  return {
    canonical: `vault:${normalized}`,
    platform: safeSegment(optionalString(params.platform) ?? 'vault', 'platform'),
    sourceKind: optionalString(params.sourceKind) ?? 'vaultPath',
    title: basename(normalized, extname(normalized)),
  };
}

function parseInputType(value: unknown): SourceInputType {
  const inputType = (typeof value === 'string' && value.trim() ? value.trim() : 'url') as SourceInputType;
  if (!['url', 'vaultPath', 'filePath', 'directoryPath', 'repoPath', 'text'].includes(inputType)) {
    throw badRequest(`Unsupported inputType: ${inputType}`);
  }
  return inputType;
}

function canonicalUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw badRequest('input must be a valid URL for inputType=url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw unsupported(`Unsupported URL protocol: ${url.protocol}`);
  }
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString();
}

function normalizeVaultRelPath(vaultPath: string, input: string): string {
  const raw = input.trim();
  if (!raw) throw badRequest('vaultPath input required');
  if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('\\\\') || raw.startsWith('//') || pathIsAbsolute(raw)) {
    throw badRequest('vaultPath must be vault-relative');
  }
  const normalized = raw.replace(/\\/g, '/').replace(/\/+/g, '/');
  if (normalized.split('/').some((part) => part === '..' || part === '.')) {
    throw badRequest('vaultPath traversal blocked');
  }
  const top = normalized.split('/')[0];
  if (PROTECTED_DIRS.has(top)) throw badRequest(`protected path: ${top}`);
  const full = join(vaultPath, normalized.replace(/\//g, '\\'));
  const rel = relative(vaultPath, full);
  if (rel.startsWith('..') || pathIsAbsolute(rel)) throw badRequest('vaultPath escapes vault');
  return normalized;
}

function readRegistry(fullPath: string): SourceRegistry {
  if (!existsSync(fullPath)) {
    return { version: 1, updated_at: new Date(0).toISOString(), sources: {} };
  }
  const parsed = JSON.parse(readFileSync(fullPath, 'utf-8')) as Partial<SourceRegistry>;
  return {
    version: 1,
    updated_at: typeof parsed.updated_at === 'string' ? parsed.updated_at : new Date(0).toISOString(),
    sources: parsed.sources && typeof parsed.sources === 'object' ? parsed.sources : {},
  };
}

function registryFullPath(vaultPath: string): string {
  return join(vaultPath, REGISTRY_REL_PATH.replace(/\//g, '\\'));
}

function sourceNotePath(project: string | undefined, platform: string, slug: string): string {
  return project
    ? `10-Projects/${project}/sources/${platform}/${slug}.md`
    : `00-Inbox/Sources/${platform}/${slug}.md`;
}

function sourceNoteMarkdown(source: SourceRecord): string {
  return [
    '---',
    'llmwiki-source: true',
    `source-id: ${yamlString(source.id)}`,
    `input-type: ${yamlString(source.inputType)}`,
    `platform: ${yamlString(source.platform)}`,
    `source-kind: ${yamlString(source.sourceKind)}`,
    `actor: ${yamlString(source.actor)}`,
    source.project ? `project: ${yamlString(source.project)}` : 'project: null',
    `canonical: ${yamlString(source.canonical)}`,
    `registered-at: ${yamlString(source.created_at)}`,
    `updated-at: ${yamlString(source.updated_at)}`,
    source.tags.length ? `tags: [${source.tags.map(yamlString).join(', ')}]` : 'tags: []',
    '---',
    '',
    `# ${source.title}`,
    '',
    '## Source',
    '',
    `- Input: ${source.input}`,
    `- Canonical: ${source.canonical}`,
    `- Platform: ${source.platform}`,
    `- Source kind: ${source.sourceKind}`,
    '',
    '## Preflight',
    '',
    source.preflight ? fencedJson(source.preflight) : '- Not applicable for this input type.',
    '',
    '## Notes',
    '',
    source.notes?.trim() ? source.notes.trim() : '- No notes yet.',
    '',
    '## Captures',
    '',
    '- Pending. Phase 1 registers the source only.',
    '',
    '## Derivatives',
    '',
    '- Pending. Transcript/OCR/comment digests are later ingest artifacts.',
    '',
    '## References',
    '',
    `- ${source.canonical}`,
    '',
  ].join('\n');
}

function withFileLock<T>(fullPath: string, fn: () => T): T {
  mkdirSync(dirname(fullPath), { recursive: true });
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
    if (ageMs < LOCK_TTL_MS) throw conflict(`Lock conflict on ${basename(fullPath)}`);
    rmSync(lockPath, { force: true });
    acquire();
  }

  try {
    return fn();
  } finally {
    rmSync(lockPath, { force: true });
  }
}

function writeTextLocked(fullPath: string, content: string): void {
  withFileLock(fullPath, () => {
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, 'utf-8');
  });
}

function sourceId(canonical: string): string {
  return `src_${createHash('sha256').update(canonical).digest('hex').slice(0, 12)}`;
}

function actorFromContext(ctx: OperationContext): string {
  return safeSegment(ctx.config.collaboration?.actor || process.env.VAULT_MIND_ACTOR || 'agent', 'actor');
}

function optionalSafeSegment(value: unknown, label: string): string | undefined {
  const text = optionalString(value);
  return text ? safeSegment(text, label) : undefined;
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
    throw badRequest(`${label} must be a single safe path segment`);
  }
  return trimmed;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw badRequest(`${label} required`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
}

function detectPlatform(canonical: string): string {
  const host = new URL(canonical).hostname.replace(/^www\./, '');
  if (host.includes('douyin.com')) return 'douyin';
  if (host.includes('bilibili.com') || host === 'b23.tv') return 'bilibili';
  if (host.includes('xiaohongshu.com') || host === 'xhslink.com') return 'xiaohongshu';
  if (host.includes('tiktok.com')) return 'tiktok';
  if (host.includes('youtube.com') || host === 'youtu.be') return 'youtube';
  if (host === 'x.com' || host.includes('twitter.com')) return 'x';
  if (host.includes('weibo.com')) return 'weibo';
  if (host.includes('zhihu.com')) return 'zhihu';
  if (host === 'mp.weixin.qq.com') return 'wechat';
  return 'web';
}

function titleFromUrl(canonical: string): string {
  const url = new URL(canonical);
  const last = url.pathname.split('/').filter(Boolean).at(-1);
  return last ? `${url.hostname} ${last}` : url.hostname;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || 'source';
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function fencedJson(value: unknown): string {
  return ['```json', JSON.stringify(value, null, 2), '```'].join('\n');
}
