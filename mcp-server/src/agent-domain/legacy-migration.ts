import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { badRequest, type Operation } from '../core/types.js';
import { resolveProjectContext } from '../project/project-context.js';

const MIGRATION_SCHEMA_VERSION = 1 as const;

interface LegacySource {
  kind: 'passport' | 'handoff' | 'session' | 'key-value-memory';
  path: string;
  contentHash: string;
  bytes: number;
  modifiedAt: string;
}

interface CandidateSection {
  sourcePaths: string[];
  contentHash: string;
  bytes: number;
  omitted: boolean;
}

export interface LegacyAgentMigrationPlan {
  schemaVersion: typeof MIGRATION_SCHEMA_VERSION;
  mode: 'dry-run';
  generatedAt: string;
  project: {
    projectId: string;
    slug: string;
    contextFingerprint: string;
  };
  actor: string;
  sources: LegacySource[];
  proposals: {
    profile: {
      profileId: string;
      displayName: string;
      role: string;
      sourcePaths: string[];
    };
    binding: {
      bindingId: string;
      projectId: string;
      profileId: string;
      projectContextFingerprint: string;
      enabled: false;
      requiresReview: true;
    };
    thread: {
      threadId: string;
      projectId: string;
      bindingId: string;
      referencePaths: string[];
      lifecycle: 'open';
    };
    initialMemoryRevision: {
      state: 'proposal-only';
      approvalRequired: true;
      candidateSections: {
        recentContext: CandidateSection;
        openItems: CandidateSection;
        stableMemory: CandidateSection;
      };
    };
  };
  diagnostics: Array<{
    code: string;
    severity: 'info' | 'warning' | 'error';
    path?: string;
  }>;
  rollback: {
    sourceBytesPreserved: true;
    writesApplied: false;
    sourceGuards: Array<{ path: string; contentHash: string }>;
    proposedWrites: string[];
    restoreActions: [];
  };
}

const UNSAFE_SHARED_TEXT = [
  /(?:api|access|auth|lease|handoff|refresh)[-_ ]?(?:key|token|secret)\s*[:=]\s*\S+/i,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\b[A-Za-z]:[\\/][^\s]+/,
  /(?:^|\s)\/(?:Users|home|var|tmp|etc)\/[^\s]+/,
];

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeSegment(value: unknown, label: string): string {
  if (typeof value !== 'string') throw badRequest(`${label} is required`);
  const trimmed = value.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..' || /[\\/]/.test(trimmed) || /^[A-Za-z]:/.test(trimmed)) {
    throw badRequest(`${label} must be a single safe path segment`);
  }
  return trimmed;
}

function stableSlug(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72);
  return slug || 'agent';
}

function readSource(vaultPath: string, path: string, kind: LegacySource['kind']): { source: LegacySource; content: string } | null {
  const fullPath = join(vaultPath, ...path.split('/'));
  if (!existsSync(fullPath) || !statSync(fullPath).isFile()) return null;
  const content = readFileSync(fullPath, 'utf8');
  return {
    source: {
      kind,
      path,
      contentHash: sha256(content),
      bytes: Buffer.byteLength(content, 'utf8'),
      modifiedAt: statSync(fullPath).mtime.toISOString(),
    },
    content,
  };
}

function listSessions(vaultPath: string, root: string): Array<{ source: LegacySource; content: string }> {
  const fullRoot = join(vaultPath, ...root.split('/'));
  if (!existsSync(fullRoot)) return [];
  return readdirSync(fullRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => readSource(vaultPath, `${root}/${entry.name}`, 'session'))
    .filter((entry): entry is { source: LegacySource; content: string } => entry !== null);
}

function section(
  entries: Array<{ source: LegacySource; content: string }>,
  diagnostics: LegacyAgentMigrationPlan['diagnostics'],
): CandidateSection {
  const unsafe = entries.filter((entry) => UNSAFE_SHARED_TEXT.some((pattern) => pattern.test(entry.content)));
  for (const entry of unsafe) diagnostics.push({ code: 'unsafe_legacy_content_omitted', severity: 'error', path: entry.source.path });
  const safe = entries.filter((entry) => !unsafe.includes(entry));
  const material = safe.map((entry) => `${entry.source.path}\n${entry.content}`).join('\n\n');
  return {
    sourcePaths: safe.map((entry) => entry.source.path),
    contentHash: sha256(material),
    bytes: Buffer.byteLength(material, 'utf8'),
    omitted: entries.length > 0 && safe.length === 0,
  };
}

function contextFingerprint(project: ReturnType<typeof resolveProjectContext>): string {
  return sha256(JSON.stringify({
    projectId: project.projectId,
    slug: project.slug,
    lifecycle: project.lifecycle,
    roots: project.roots,
  }));
}

export function planLegacyAgentMigration(options: {
  vaultPath: string;
  projectRef: string;
  actor: string;
  now?: string;
}): LegacyAgentMigrationPlan {
  const actor = safeSegment(options.actor, 'actor');
  const project = resolveProjectContext(options.vaultPath, options.projectRef, 'agent.migration.plan');
  const roots = [
    `10-Projects/${project.slug}/agents/${actor}/memory`,
    `00-Inbox/Agent-Memory/${actor}`,
  ];
  const entries: Array<{ source: LegacySource; content: string }> = [];
  for (const root of roots) {
    const passport = readSource(options.vaultPath, `${root}/passport.md`, 'passport');
    const handoff = readSource(options.vaultPath, `${root}/handoff.md`, 'handoff');
    if (passport) entries.push(passport);
    if (handoff) entries.push(handoff);
    entries.push(...listSessions(options.vaultPath, `${root}/sessions`));
  }
  const keyValue = readSource(options.vaultPath, '_ai_memory.json', 'key-value-memory');
  if (keyValue) entries.push(keyValue);

  const unique = [...new Map(entries.map((entry) => [entry.source.path, entry])).values()]
    .sort((left, right) => left.source.path.localeCompare(right.source.path));
  const diagnostics: LegacyAgentMigrationPlan['diagnostics'] = [];
  if (unique.length === 0) diagnostics.push({ code: 'no_legacy_agent_memory_found', severity: 'info' });

  const passports = unique.filter((entry) => entry.source.kind === 'passport' || entry.source.kind === 'key-value-memory');
  const handoffs = unique.filter((entry) => entry.source.kind === 'handoff');
  const sessions = unique.filter((entry) => entry.source.kind === 'session');
  const slug = stableSlug(actor);
  const profileId = `agent/legacy-${slug}`;
  const bindingId = `binding/${project.slug}/legacy-${slug}`;
  const sourceFingerprint = sha256(unique.map((entry) => `${entry.source.path}:${entry.source.contentHash}`).join('\n'));
  const threadId = `thread/legacy-${slug}-${sourceFingerprint.slice(0, 12)}`;
  const fingerprint = contextFingerprint(project);

  return {
    schemaVersion: MIGRATION_SCHEMA_VERSION,
    mode: 'dry-run',
    generatedAt: options.now ?? new Date().toISOString(),
    project: { projectId: project.projectId, slug: project.slug, contextFingerprint: fingerprint },
    actor,
    sources: unique.map((entry) => entry.source),
    proposals: {
      profile: {
        profileId,
        displayName: actor,
        role: 'legacy-agent',
        sourcePaths: passports.map((entry) => entry.source.path),
      },
      binding: {
        bindingId,
        projectId: project.projectId,
        profileId,
        projectContextFingerprint: fingerprint,
        enabled: false,
        requiresReview: true,
      },
      thread: {
        threadId,
        projectId: project.projectId,
        bindingId,
        referencePaths: unique.map((entry) => entry.source.path),
        lifecycle: 'open',
      },
      initialMemoryRevision: {
        state: 'proposal-only',
        approvalRequired: true,
        candidateSections: {
          recentContext: section([...handoffs, ...sessions], diagnostics),
          openItems: section(handoffs, diagnostics),
          stableMemory: section(passports, diagnostics),
        },
      },
    },
    diagnostics,
    rollback: {
      sourceBytesPreserved: true,
      writesApplied: false,
      sourceGuards: unique.map((entry) => ({ path: entry.source.path, contentHash: entry.source.contentHash })),
      proposedWrites: [
        `_llmwiki/agent-domain/v1/profiles/${profileId.slice('agent/'.length)}`,
        `_llmwiki/agent-domain/v1/bindings/${project.slug}/${slug}`,
        `_llmwiki/agent-domain/v1/threads/${threadId.slice('thread/'.length)}`,
        `_llmwiki/agent-domain/v1/dreamtime/proposals`,
      ],
      restoreActions: [],
    },
  };
}

export function makeLegacyAgentMigrationOps(): Operation[] {
  return [{
    name: 'agent.migration.plan',
    namespace: 'agent',
    description: 'Create a deterministic, byte-preserving dry-run plan from legacy passport, handoff, session, and key/value memory into governed Agent domain proposals.',
    mutating: false,
    params: {
      project: { type: 'string', required: true, description: 'Canonical Project ID, slug, or registered alias' },
      actor: { type: 'string', required: true, description: 'Legacy Agent actor directory to inventory' },
    },
    handler: async (ctx, params) => planLegacyAgentMigration({
      vaultPath: ctx.config.vault_path,
      projectRef: String(params.project ?? ''),
      actor: String(params.actor ?? ''),
    }),
  }];
}

export function relativeToVault(vaultPath: string, path: string): string {
  return relative(vaultPath, path).replaceAll('\\', '/');
}

export function legacySourceName(path: string): string {
  return basename(path);
}
