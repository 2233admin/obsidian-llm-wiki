import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  isProjectId,
  resolveProjectContext,
  type ProjectContext,
  type ProjectId,
  type ProjectRef,
} from '../project/project-context.js';

export const SESSION_RECORD_SCHEMA = 'session-record/v1' as const;
export const SESSION_EVIDENCE_SCHEMA = 'session-evidence/v1' as const;

export type SessionHost = 'codex' | 'claude' | 'chatgpt' | 'other' | 'unknown';
export type SessionStatus = 'captured' | 'indexed' | 'unavailable';
export type SessionSource = 'host' | 'import' | 'vaultPath';
export type SessionSourceAvailability = 'available' | 'deleted_or_unavailable';

/** The canonical local record. Raw conversation data intentionally lives in evidence. */
export interface SessionRecord {
  schemaVersion: typeof SESSION_RECORD_SCHEMA;
  sessionId: string;
  projectId: ProjectId;
  source: SessionSource;
  sourceRef: string;
  capturedAt: string;
  host: SessionHost;
  workspace?: string;
  branch?: string;
  status: SessionStatus;
  contentHash: string | null;
  revision: number;
  sourceRefs: string[];
  sourceAvailability: SessionSourceAvailability;
}

/** A provider fixture is deliberately open-ended; unknown fields remain evidence only. */
export interface SessionFixture {
  [key: string]: unknown;
  schemaVersion?: unknown;
  sessionId?: unknown;
  session_id?: unknown;
  projectId?: unknown;
  project_id?: unknown;
  sourceRef?: unknown;
  source_ref?: unknown;
  capturedAt?: unknown;
  captured_at?: unknown;
  timestamp?: unknown;
  host?: unknown;
  workspace?: unknown;
  branch?: unknown;
  sourceRefs?: unknown;
  source_refs?: unknown;
  messages?: unknown;
  events?: unknown;
  turns?: unknown;
  transcript?: unknown;
  raw?: unknown;
  content?: unknown;
}

export interface RawSessionEvidence {
  schemaVersion: typeof SESSION_EVIDENCE_SCHEMA;
  sourceRef: string;
  format: 'json';
  status: 'captured' | 'unavailable';
  accessContext: 'private' | 'deleted_or_unavailable';
  content: unknown | null;
  contentHash: string | null;
  redacted: boolean;
  redactions: number;
}

export interface SessionRecordStore {
  get(sessionId: string): SessionRecord | undefined;
  upsert(record: SessionRecord): { record: SessionRecord; idempotent: boolean };
}

export interface SessionFixtureImportOptions {
  /** Absolute local vault root used for Project resolution and the file adapter. */
  vaultPath: string;
  /** Vault-relative JSON fixture path. This is an adapter input, not source.register input. */
  filePath: string;
  project: string | ProjectRef;
  store?: SessionRecordStore;
  capturedAt?: string;
  host?: SessionHost;
  workspace?: string;
  branch?: string;
}

export interface ImportedSessionRecord {
  record: SessionRecord;
  evidence: RawSessionEvidence;
  project: ProjectContext;
  sourcePath: string;
  idempotent: boolean;
}

export type SessionRecordErrorCode =
  | 'invalid_path'
  | 'source_unavailable'
  | 'malformed_fixture'
  | 'project_mismatch';

export class SessionRecordError extends Error {
  readonly code: SessionRecordErrorCode;
  readonly filePath?: string;

  constructor(code: SessionRecordErrorCode, message: string, filePath?: string) {
    super(message);
    this.name = 'SessionRecordError';
    this.code = code;
    this.filePath = filePath;
  }
}

/**
 * Create the small stateful seam the parent can replace with a durable store.
 * Equal content is replay-safe; changed content advances the local revision.
 */
export function createSessionRecordStore(): SessionRecordStore {
  const records = new Map<string, SessionRecord>();
  return {
    get(sessionId) {
      const record = records.get(sessionId);
      return record ? cloneRecord(record) : undefined;
    },
    upsert(candidate) {
      const previous = records.get(candidate.sessionId);
      if (previous && isSameRevision(previous, candidate)) {
        return { record: cloneRecord(previous), idempotent: true };
      }
      const next = {
        ...candidate,
        revision: previous ? previous.revision + 1 : 1,
        sourceRefs: [...candidate.sourceRefs],
      };
      records.set(next.sessionId, next);
      return { record: cloneRecord(next), idempotent: false };
    },
  };
}

/**
 * Import one local JSON Session fixture into the canonical record boundary.
 * This is intentionally read-only and never registers a Source.
 */
export function importSessionFixture(options: SessionFixtureImportOptions): ImportedSessionRecord {
  const project = resolveProjectContext(options.vaultPath, options.project, 'session.memory.import');
  const sourcePath = normalizeFixturePath(options.vaultPath, options.filePath);
  const sourceRef = `vaultPath:${sourcePath}`;

  if (!existsSync(sourcePathFull(options.vaultPath, sourcePath))) {
    return unavailableResult(options, project, sourcePath, sourceRef);
  }

  const fullPath = sourcePathFull(options.vaultPath, sourcePath);
  let bytes: Buffer;
  try {
    if (!statSync(fullPath).isFile()) {
      throw new SessionRecordError('source_unavailable', 'Session fixture source is not a file.', sourcePath);
    }
    bytes = readFileSync(fullPath);
  } catch (error: unknown) {
    if (error instanceof SessionRecordError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES') {
      return unavailableResult(options, project, sourcePath, sourceRef);
    }
    throw new SessionRecordError('source_unavailable', 'Session fixture source could not be read.', sourcePath);
  }

  const fixture = parseFixture(bytes, sourcePath);
  assertFixtureProject(fixture, project.projectId, sourcePath);
  const contentHash = hashBytes(bytes);
  const capturedAt = timestampOf(fixture, options, fullPath, sourcePath);
  const host = hostOf(fixture, options.host);
  const normalizedSourceRef = redactedString(
    stringField(fixture.sourceRef, fixture.source_ref) ?? sourceRef,
  ).value;
  const sourceRefs = sourceReferences(fixture, normalizedSourceRef);
  const sessionIdentity = stringField(fixture.sessionId, fixture.session_id)
    ?? normalizedSourceRef;
  const sessionId = stableSessionId(project.projectId, host, sessionIdentity);
  const record: SessionRecord = {
    schemaVersion: SESSION_RECORD_SCHEMA,
    sessionId,
    projectId: project.projectId,
    source: 'import',
    sourceRef: normalizedSourceRef,
    capturedAt,
    host,
    ...(textField(fixture.workspace) ?? options.workspace
      ? { workspace: redactedString(textField(fixture.workspace) ?? options.workspace as string).value }
      : {}),
    ...(textField(fixture.branch) ?? options.branch
      ? { branch: redactedString(textField(fixture.branch) ?? options.branch as string).value }
      : {}),
    status: 'captured',
    contentHash,
    revision: 1,
    sourceRefs,
    sourceAvailability: 'available',
  };
  const evidenceRedaction = redactSecrets(fixture);
  const evidence: RawSessionEvidence = {
    schemaVersion: SESSION_EVIDENCE_SCHEMA,
    sourceRef: normalizedSourceRef,
    format: 'json',
    status: 'captured',
    accessContext: 'private',
    content: evidenceRedaction.value,
    contentHash,
    redacted: evidenceRedaction.count > 0,
    redactions: evidenceRedaction.count,
  };
  const stored = options.store?.upsert(record);
  return {
    record: stored?.record ?? record,
    evidence,
    project,
    sourcePath,
    idempotent: stored?.idempotent ?? false,
  };
}

function unavailableResult(
  options: SessionFixtureImportOptions,
  project: ProjectContext,
  sourcePath: string,
  sourceRef: string,
): ImportedSessionRecord {
  const host = options.host ?? 'unknown';
  const sessionId = stableSessionId(project.projectId, host, sourceRef);
  const capturedAt = options.capturedAt
    ? normalizeTimestamp(options.capturedAt, 'capturedAt', sourcePath)
    : new Date().toISOString();
  const record: SessionRecord = {
    schemaVersion: SESSION_RECORD_SCHEMA,
    sessionId,
    projectId: project.projectId,
    source: 'import',
    sourceRef,
    capturedAt,
    host,
    ...(options.workspace ? { workspace: redactedString(options.workspace).value } : {}),
    ...(options.branch ? { branch: redactedString(options.branch).value } : {}),
    status: 'unavailable',
    contentHash: null,
    revision: 1,
    sourceRefs: [sourceRef],
    sourceAvailability: 'deleted_or_unavailable',
  };
  const evidence: RawSessionEvidence = {
    schemaVersion: SESSION_EVIDENCE_SCHEMA,
    sourceRef,
    format: 'json',
    status: 'unavailable',
    accessContext: 'deleted_or_unavailable',
    content: null,
    contentHash: null,
    redacted: false,
    redactions: 0,
  };
  const stored = options.store?.upsert(record);
  return {
    record: stored?.record ?? record,
    evidence,
    project,
    sourcePath,
    idempotent: stored?.idempotent ?? false,
  };
}

function normalizeFixturePath(vaultPath: string, filePath: string): string {
  if (typeof vaultPath !== 'string' || !vaultPath.trim()) {
    throw new SessionRecordError('invalid_path', 'vaultPath is required.');
  }
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new SessionRecordError('invalid_path', 'filePath is required.');
  }
  const raw = filePath.trim();
  if (raw.includes('\0') || isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('\\\\')) {
    throw new SessionRecordError('invalid_path', 'filePath must be vault-relative.');
  }
  const parts = raw.replaceAll('\\', '/').split('/').filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === '.' || part === '..')) {
    throw new SessionRecordError('invalid_path', 'filePath traversal blocked.');
  }
  const normalized = parts.join('/');
  const root = resolve(vaultPath);
  const candidate = resolve(root, ...parts);
  const logicalRelative = relative(root, candidate);
  if (logicalRelative === '..' || logicalRelative.startsWith(`..${'/'}`) || isAbsolute(logicalRelative)) {
    throw new SessionRecordError('invalid_path', 'filePath escapes vault.');
  }
  const rootReal = realpathSync(root);
  const existingTarget = existsSync(candidate) ? candidate : existingAncestor(candidate);
  const candidateReal = realpathSync(existingTarget);
  if (pathEscapes(rootReal, candidateReal)) {
    throw new SessionRecordError('invalid_path', 'filePath symlink escapes vault.');
  }
  return normalized;
}

function pathEscapes(root: string, target: string): boolean {
  const normalized = relative(root, target).replaceAll('\\', '/');
  return normalized === '..' || normalized.startsWith('../') || isAbsolute(normalized);
}

function existingAncestor(startPath: string): string {
  let current = startPath;
  while (!existsSync(current)) {
    const parent = resolve(current, '..');
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function sourcePathFull(vaultPath: string, sourcePath: string): string {
  return resolve(vaultPath, ...sourcePath.split('/'));
}

function parseFixture(bytes: Buffer, sourcePath: string): SessionFixture {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new SessionRecordError('malformed_fixture', 'Session fixture JSON is malformed.', sourcePath);
  }
  if (!isRecord(parsed) || !hasSessionPayload(parsed)) {
    throw new SessionRecordError('malformed_fixture', 'Session fixture must contain a supported raw session payload.', sourcePath);
  }
  return parsed as SessionFixture;
}

function hasSessionPayload(value: Record<string, unknown>): boolean {
  return [
    'messages',
    'events',
    'turns',
    'transcript',
    'raw',
    'content',
    'conversation',
    'entries',
    'prompt',
    'response',
  ].some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function assertFixtureProject(fixture: SessionFixture, projectId: ProjectId, sourcePath: string): void {
  const fixtureProject = stringField(fixture.projectId, fixture.project_id);
  if (fixtureProject === undefined) return;
  if (!isProjectId(fixtureProject) || fixtureProject !== projectId) {
    throw new SessionRecordError('project_mismatch', 'Fixture Project ID does not match resolved Project ID.', sourcePath);
  }
}

function timestampOf(
  fixture: SessionFixture,
  options: SessionFixtureImportOptions,
  fullPath: string,
  sourcePath: string,
): string {
  const value = stringField(fixture.capturedAt, fixture.captured_at, fixture.timestamp) ?? options.capturedAt;
  if (value !== undefined) return normalizeTimestamp(value, 'capturedAt', sourcePath);
  return statSync(fullPath).mtime.toISOString();
}

function normalizeTimestamp(value: string, label: string, sourcePath: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new SessionRecordError('malformed_fixture', `${label} must be a valid timestamp.`, sourcePath);
  }
  return date.toISOString();
}

function hostOf(fixture: SessionFixture, fallback?: SessionHost): SessionHost {
  const value = stringField(fixture.host) ?? fallback ?? 'unknown';
  const normalized = value.toLowerCase();
  if (normalized === 'codex' || normalized === 'claude' || normalized === 'chatgpt') return normalized;
  if (normalized === 'other') return 'other';
  if (normalized === 'unknown') return 'unknown';
  return 'other';
}

function sourceReferences(fixture: SessionFixture, sourceRef: string): string[] {
  const raw = fixture.sourceRefs ?? fixture.source_refs;
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const normalized = values
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => redactedString(value.trim()).value);
  return [...new Set([sourceRef, ...normalized])];
}

function stableSessionId(projectId: ProjectId, host: SessionHost, identity: string): string {
  return `session_${hashText(`${projectId}\0${host}\0${identity}`).slice('sha256:'.length, 'sha256:'.length + 24)}`;
}

function hashBytes(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function hashText(value: string): string {
  return hashBytes(Buffer.from(value, 'utf8'));
}

function isSameRevision(left: SessionRecord, right: SessionRecord): boolean {
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

function cloneRecord(record: SessionRecord): SessionRecord {
  return { ...record, sourceRefs: [...record.sourceRefs] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function textField(value: unknown): string | undefined {
  return stringField(value);
}

function redactedString(value: string): { value: string; count: number } {
  let count = 0;
  let result = value
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, () => {
      count += 1;
      return '[REDACTED_PRIVATE_KEY]';
    })
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, (match) => {
      count += 1;
      return `${match.split(/\s+/, 1)[0]} [REDACTED]`;
    })
    .replace(/\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|passwd|secret|token|cookie)\s*[:=]\s*["']?[^\s,;"']+/gi, (match) => {
      count += 1;
      const separator = match.match(/\s*[:=]\s*/)?.[0] ?? '=';
      return `${match.slice(0, match.indexOf(separator))}${separator}[REDACTED]`;
    })
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, () => {
      count += 1;
      return '[REDACTED_API_KEY]';
    });
  return { value: result, count };
}

function secretKey(key: string): boolean {
  const normalized = key.toLowerCase().replaceAll('-', '').replaceAll('_', '');
  return normalized === 'authorization'
    || normalized === 'apikey'
    || normalized === 'accesstoken'
    || normalized === 'refreshtoken'
    || normalized === 'clientsecret'
    || normalized === 'privatekey'
    || normalized === 'credential'
    || normalized === 'credentials'
    || normalized === 'password'
    || normalized === 'passwd'
    || normalized === 'cookie'
    || normalized === 'secret'
    || normalized === 'token';
}

function redactSecrets(value: unknown, key?: string): { value: unknown; count: number } {
  if (key && secretKey(key)) return { value: '[REDACTED]', count: 1 };
  if (typeof value === 'string') return redactedString(value);
  if (Array.isArray(value)) {
    let count = 0;
    const result = value.map((item) => {
      const redacted = redactSecrets(item);
      count += redacted.count;
      return redacted.value;
    });
    return { value: result, count };
  }
  if (isRecord(value)) {
    let count = 0;
    const result: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      const redacted = redactSecrets(entryValue, entryKey);
      count += redacted.count;
      result[entryKey] = redacted.value;
    }
    return { value: result, count };
  }
  return { value, count: 0 };
}
