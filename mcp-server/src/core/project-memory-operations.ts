import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { Operation, OperationContext } from './types.js';
import { badRequest } from './types.js';
import { memoryPolicyBasePath } from './write-policy.js';
import { resolveProjectContext } from '../project/project-context.js';
import {
  createSessionRecordStore,
  importSessionFixture,
  type RawSessionEvidence,
  type SessionFixtureImportOptions,
  type SessionRecord as ImportedSessionRecord,
  type SessionRecordStore,
} from '../session-memory/session-record.js';
import {
  canonicalProjectContextJson,
  projectContextFromSource,
  renderProjectContextText,
  sha256,
  type EvidenceRef,
  type ProjectMemorySource,
  type ResearchRecord,
  type SessionRecord,
} from '../project-memory/index.js';
import type { VaultStore } from '../vault/store.js';
import type { WorkRunOutputV1 } from '../workflow/output-governance.js';

const SESSION_RECORD_SCHEMA = 'session-record/v1';
const RESEARCH_RECORD_SCHEMA = 'research-record/v1';
const SESSION_RECORDS_DIR = 'sessions/records';
const SESSION_EVIDENCE_DIR = 'sessions/evidence';
const RESEARCH_RECORDS_DIR = 'research/records';

interface ProjectMemoryOpsOptions {
  store?: VaultStore;
}

interface PersistedResearchRecord extends ResearchRecord {
  readonly revision: number;
  readonly contentHash: string;
}

/** Persist only the cited, reviewable Work Run draft projection; output bytes stay out of durable memory. */
export function persistWorkRunOutputDraft(
  vaultPath: string,
  store: VaultStore | undefined,
  output: WorkRunOutputV1,
  actor: string,
): string {
  const safeActor = safeSegment(actor, 'actor');
  const project = safeSegment(output.projectId.slice('project/'.length), 'project');
  const relativePath = `10-Projects/${project}/agents/${safeActor}/memory-drafts/${output.fingerprint.replace(/^sha256:/u, 'sha256-')}.json`;
  const proposalId = isRecord(output.payload) && typeof output.payload.proposalId === 'string' ? output.payload.proposalId : undefined;
  writeJson(vaultPath, store, relativePath, {
    schemaVersion: 'project-memory-draft/v1',
    projectId: output.projectId,
    workItemId: output.workItemId,
    workRunId: output.workRunId,
    citations: output.citations,
    provenance: output.provenance,
    payloadFingerprint: output.fingerprint,
    ...(proposalId ? { proposalId } : {}),
    reviewStatus: 'draft',
  });
  return relativePath;
}

/**
 * Durable local adapter for the A+B records. The projection remains derived;
 * only source records and redacted evidence are persisted here.
 */
export function makeProjectMemoryOps(vaultPath: string, options: ProjectMemoryOpsOptions = {}): Operation[] {
  const sessionStore = createDurableSessionStore(vaultPath, options.store);
  return [
    {
      name: 'memory.session.record.import',
      namespace: 'memory',
      description: 'Import one vault-relative JSON session fixture into session-record/v1 and persist redacted evidence locally.',
      mutating: true,
      writePolicy: {
        realWrite: 'always',
        targets: (ctx, params) => [sessionPolicyPath(ctx, params, 'memory.session.record.import')],
        audit: 'required',
      },
      params: {
        project: { type: 'string', required: true, description: 'Canonical project/<slug>, alias, or registered project name' },
        filePath: { type: 'string', required: true, description: 'Vault-relative JSON session fixture; never passed to source.register' },
        host: { type: 'string', required: false, description: 'Session host, e.g. codex or claude' },
        capturedAt: { type: 'string', required: false, description: 'Fallback ISO timestamp for unavailable fixtures' },
        workspace: { type: 'string', required: false, description: 'Optional workspace binding reference' },
        branch: { type: 'string', required: false, description: 'Optional branch name' },
      },
      handler: async (_ctx, params) => {
        const imported = importSessionFixture({
          vaultPath,
          filePath: params.filePath as string,
          project: params.project as string,
          ...(typeof params.host === 'string' ? { host: params.host as SessionFixtureImportOptions['host'] } : {}),
          ...(typeof params.capturedAt === 'string' ? { capturedAt: params.capturedAt } : {}),
          ...(typeof params.workspace === 'string' ? { workspace: params.workspace } : {}),
          ...(typeof params.branch === 'string' ? { branch: params.branch } : {}),
          store: sessionStore,
        });
        const paths = persistSessionEvidence(vaultPath, options.store, imported.record, imported.evidence);
        return {
          schemaVersion: imported.record.schemaVersion,
          projectId: imported.record.projectId,
          record: imported.record,
          evidence: imported.evidence,
          recordPath: paths.recordPath,
          evidencePath: paths.evidencePath,
          sourcePath: imported.sourcePath,
          idempotent: imported.idempotent,
        };
      },
    },
    {
      name: 'memory.research.record.save',
      namespace: 'memory',
      description: 'Persist a reviewable research/experiment record under the project agent-draft boundary.',
      mutating: true,
      writePolicy: {
        realWrite: 'always',
        targets: (ctx, params) => [`${memoryPolicyBasePath(ctx.config, params, 'memory.research.record.save')}/${RESEARCH_RECORDS_DIR}/**`],
        audit: 'required',
      },
      params: {
        project: { type: 'string', required: true, description: 'Canonical project/<slug>, alias, or registered project name' },
        recordId: { type: 'string', required: true, description: 'Stable safe record identifier' },
        sessionRefs: { type: 'array', required: false, description: 'Session IDs supporting this record' },
        question: { type: 'string', required: false, description: 'Research question or experiment goal' },
        plan: { type: 'array', required: false, description: 'Research or experiment steps' },
        sources: { type: 'array', required: false, description: 'Source URLs or local evidence references' },
        observations: { type: 'array', required: false, description: 'Observed results' },
        decisions: { type: 'array', required: false, description: 'Reviewable decisions' },
        uncertainties: { type: 'array', required: false, description: 'Unresolved questions or conflicts' },
        nextHandoff: { type: 'string', required: false, description: 'Next-agent handoff' },
        reviewStatus: { type: 'string', required: false, enum: ['draft', 'reviewed', 'promoted'], default: 'draft' },
      },
      handler: async (ctx, params) => saveResearchRecord(vaultPath, options.store, ctx, params),
    },
    {
      name: 'project.context.compile',
      namespace: 'project',
      description: 'Compile a cited, read-only project-context/v1 from durable Session and research records.',
      mutating: false,
      params: {
        project: { type: 'string', required: true, description: 'Canonical project/<slug>, alias, or registered project name' },
        format: { type: 'string', required: false, enum: ['json', 'markdown'], default: 'json' },
        staleAfterMs: { type: 'number', required: false, description: 'Age threshold for stale evidence; default is 30 days' },
      },
      handler: async (_ctx, params) => {
        const project = resolveProjectContext(vaultPath, params.project as string, 'project.context.compile');
        const source = createDurableProjectMemorySource(vaultPath);
        const context = await projectContextFromSource(source, project.projectId, {
          ...(typeof params.staleAfterMs === 'number' ? { staleAfterMs: params.staleAfterMs } : {}),
        });
        const format = params.format === 'markdown' ? 'markdown' : 'json';
        return {
          schemaVersion: context.schemaVersion,
          projectId: context.projectId,
          format,
          context,
          rendered: format === 'markdown' ? renderProjectContextText(context) : canonicalProjectContextJson(context),
        };
      },
    },
  ];
}

function sessionPolicyPath(ctx: OperationContext, params: Record<string, unknown>, operation: string): string {
  const project = resolveProjectContext(ctx.config.vault_path, params.project as string, operation, { recordCompatibility: false });
  return `10-Projects/${project.slug}/sessions/**`;
}

function createDurableSessionStore(vaultPath: string, store?: VaultStore): SessionRecordStore {
  return {
    get(sessionId) {
      if (!isSafeSegment(sessionId)) return undefined;
      for (const projectDir of listProjectDirectories(vaultPath)) {
        const path = `10-Projects/${projectDir}/${SESSION_RECORDS_DIR}/${sessionId}.json`;
        const record = readJson<ImportedSessionRecord>(vaultPath, path);
        if (record?.sessionId === sessionId && record.schemaVersion === 'session-record/v1') return record;
      }
      return undefined;
    },
    upsert(candidate) {
      const slug = candidate.projectId.slice('project/'.length);
      const relativePath = `10-Projects/${slug}/${SESSION_RECORDS_DIR}/${candidate.sessionId}.json`;
      const previous = readJson<ImportedSessionRecord>(vaultPath, relativePath);
      if (previous && sameSessionRevision(previous, candidate)) {
        return { record: { ...previous, sourceRefs: [...previous.sourceRefs] }, idempotent: true };
      }
      const record = {
        ...candidate,
        revision: previous ? previous.revision + 1 : 1,
        sourceRefs: [...candidate.sourceRefs],
      };
      writeJson(vaultPath, store, relativePath, record);
      writeJson(
        vaultPath,
        store,
        `10-Projects/${slug}/${SESSION_RECORDS_DIR}/history/${record.sessionId}/revision-${record.revision}.json`,
        record,
      );
      return { record, idempotent: false };
    },
  };
}

function persistSessionEvidence(
  vaultPath: string,
  store: VaultStore | undefined,
  record: ImportedSessionRecord,
  evidence: RawSessionEvidence,
): { recordPath: string; evidencePath: string } {
  const slug = record.projectId.slice('project/'.length);
  const recordPath = `10-Projects/${slug}/${SESSION_RECORDS_DIR}/${record.sessionId}.json`;
  const evidencePath = `10-Projects/${slug}/${SESSION_EVIDENCE_DIR}/${record.sessionId}.json`;
  // The Session Record store owns the record write; this second write is the
  // raw-evidence boundary and is always the redacted adapter output.
  writeJson(vaultPath, store, evidencePath, evidence);
  writeJson(
    vaultPath,
    store,
    `10-Projects/${slug}/${SESSION_EVIDENCE_DIR}/${record.sessionId}/revision-${record.revision}.json`,
    evidence,
  );
  return { recordPath, evidencePath };
}

function saveResearchRecord(
  vaultPath: string,
  store: VaultStore | undefined,
  ctx: OperationContext,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const project = resolveProjectContext(vaultPath, params.project as string, 'memory.research.record.save');
  const actor = safeSegment(ctx.config.collaboration?.actor ?? process.env.VAULT_MIND_ACTOR ?? 'agent', 'actor');
  const recordId = safeSegment(params.recordId as string, 'recordId');
  const base = {
    schemaVersion: RESEARCH_RECORD_SCHEMA,
    recordId,
    projectId: project.projectId,
    sessionRefs: stringArray(params.sessionRefs),
    ...(optionalString(params.question) ? { question: optionalString(params.question) } : {}),
    ...(params.plan !== undefined ? { plan: stringArray(params.plan) } : {}),
    ...(params.sources !== undefined ? { sources: evidenceArray(params.sources) } : {}),
    ...(params.observations !== undefined ? { observations: stringArray(params.observations) } : {}),
    ...(params.decisions !== undefined ? { decisions: stringArray(params.decisions) } : {}),
    ...(params.uncertainties !== undefined ? { uncertainties: stringArray(params.uncertainties) } : {}),
    ...(optionalString(params.nextHandoff) ? { nextHandoff: optionalString(params.nextHandoff) } : {}),
    reviewStatus: params.reviewStatus === 'reviewed' || params.reviewStatus === 'promoted' ? params.reviewStatus : 'draft',
  } satisfies ResearchRecord;
  const relativePath = `10-Projects/${project.slug}/agents/${actor}/${RESEARCH_RECORDS_DIR}/${recordId}.json`;
  const previous = readJson<PersistedResearchRecord>(vaultPath, relativePath);
  const contentHash = sha256(canonicalJson(base));
  const idempotent = previous?.contentHash === contentHash && previous.projectId === project.projectId;
  const record: PersistedResearchRecord = {
    ...base,
    contentHash,
    revision: idempotent ? previous.revision : (previous?.revision ?? 0) + 1,
  };
  writeJson(vaultPath, store, relativePath, record);
  return { record, path: relativePath, idempotent };
}

export function createDurableProjectMemorySource(vaultPath: string): ProjectMemorySource {
  return {
    listSessions: (projectId) => latestSessionRecords(
      listJsonRecords<SessionRecord>(vaultPath, `10-Projects/${projectId.slice('project/'.length)}/${SESSION_RECORDS_DIR}`)
        .filter((record) => record.schemaVersion === SESSION_RECORD_SCHEMA && record.projectId === projectId),
    ),
    listResearchRecords: (projectId) => listJsonRecords<ResearchRecord>(vaultPath, `10-Projects/${projectId.slice('project/'.length)}/agents`)
      .filter((record) => record.schemaVersion === RESEARCH_RECORD_SCHEMA && record.projectId === projectId),
  };
}
export function durableProjectMemoryDiagnostics(vaultPath: string, projectId: string): string[] {
  const slug = projectId.slice('project/'.length);
  const roots = [
    `10-Projects/${slug}/${SESSION_RECORDS_DIR}`,
    `10-Projects/${slug}/agents`,
  ];
  const diagnostics: string[] = [];
  for (const relativeRoot of roots) {
    const root = resolve(vaultPath, ...relativeRoot.split('/'));
    if (!existsSync(root)) continue;
    try {
      if (!statSync(root).isDirectory()) {
        diagnostics.push(`invalid_memory_root:${relativeRoot}`);
        continue;
      }
    } catch {
      diagnostics.push(`unavailable_memory_root:${relativeRoot}`);
      continue;
    }
    const visit = (directory: string): void => {
      let entries;
      try {
        entries = readdirSync(directory, { withFileTypes: true });
      } catch {
        diagnostics.push(`unavailable_memory_root:${relative(vaultPath, directory).replaceAll('\\', '/')}`);
        return;
      }
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) {
          visit(full);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const path = relative(vaultPath, full).replaceAll('\\', '/');
        try {
          const value = JSON.parse(readFileSync(full, 'utf8')) as unknown;
          if (!isRecord(value)) diagnostics.push(`invalid_memory_record:${path}`);
        } catch {
          diagnostics.push(`malformed_memory_record:${path}`);
        }
      }
    };
    visit(root);
  }
  return diagnostics.sort();
}

function latestSessionRecords(records: SessionRecord[]): SessionRecord[] {
  const latest = new Map<string, SessionRecord>();
  for (const record of records) {
    const previous = latest.get(record.sessionId);
    if (!previous || Number(record.revision ?? 0) >= Number(previous.revision ?? 0)) latest.set(record.sessionId, record);
  }
  return [...latest.values()].sort((left, right) => left.sessionId.localeCompare(right.sessionId));
}

function listProjectDirectories(vaultPath: string): string[] {
  const root = join(vaultPath, '10-Projects');
  if (!existsSync(root) || !statSync(root).isDirectory()) return [];
  return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && isSafeSegment(entry.name)).map((entry) => entry.name);
}

function listJsonRecords<T>(vaultPath: string, relativeRoot: string): T[] {
  const root = resolve(vaultPath, ...relativeRoot.split('/'));
  if (!existsSync(root)) return [];
  const output: T[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const value = JSON.parse(readFileSync(full, 'utf8')) as unknown;
          if (isRecord(value)) output.push(value as T);
        } catch {
          // A malformed draft must not make all other project context vanish.
        }
      }
    }
  };
  visit(root);
  return output;
}

function readJson<T>(vaultPath: string, relativePath: string): T | undefined {
  const fullPath = resolve(vaultPath, ...relativePath.split('/'));
  if (!existsSync(fullPath)) return undefined;
  try {
    return JSON.parse(readFileSync(fullPath, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function writeJson(vaultPath: string, store: VaultStore | undefined, relativePath: string, value: unknown): void {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  if (store) {
    store.writeText(relativePath, content);
    return;
  }
  const fullPath = resolve(vaultPath, ...relativePath.split('/'));
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');
}

function sameSessionRevision(left: ImportedSessionRecord, right: ImportedSessionRecord): boolean {
  return left.projectId === right.projectId
    && left.source === right.source
    && left.sourceRef === right.sourceRef
    && left.host === right.host
    && left.status === right.status
    && left.contentHash === right.contentHash
    && left.workspace === right.workspace
    && left.branch === right.branch
    && left.sourceAvailability === right.sourceAvailability
    && left.sourceRefs.length === right.sourceRefs.length
    && left.sourceRefs.every((value, index) => value === right.sourceRefs[index]);
}

function stringArray(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw badRequest('Expected an array of strings');
  return value.map((item) => {
    if (typeof item !== 'string' || !item.trim()) throw badRequest('Expected an array of non-empty strings');
    return item.trim();
  });
}

function evidenceArray(value: unknown): Array<string | EvidenceRef> {
  if (!Array.isArray(value)) throw badRequest('sources must be an array');
  return value.map((item) => {
    if (typeof item === 'string' && item.trim()) return item.trim();
    if (isRecord(item) && typeof item.ref === 'string' && item.ref.trim()) return item as unknown as EvidenceRef;
    throw badRequest('sources must contain non-empty strings or evidence references');
  });
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw badRequest('Expected a string');
  return value.trim() || undefined;
}

function safeSegment(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isSafeSegment(value.trim())) throw badRequest(`${label} must be a safe path segment`);
  return value.trim();
}

function isSafeSegment(value: string): boolean {
  return Boolean(value) && value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\') && !/^[A-Za-z]:/.test(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
