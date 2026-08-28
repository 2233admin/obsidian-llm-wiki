import {
  fingerprintRecoveryValue,
  hasUnsafeRecoveryMaterial,
  safeRecoveryText,
  type RecoveryFingerprint,
} from './contract-support.js';
import type {
  RecoveryFlowDiagnosticV2,
  RecoveryOwner,
  RecoveryOwnerLock,
} from './recovery-flow.js';

export type ProjectSearchOwner =
  | 'work-os'
  | 'project-memory'
  | 'source-evidence'
  | 'session-record'
  | 'workflow';

export interface ProjectOwnerSearchItem {
  itemId: string;
  itemType: string;
  label: string;
  projectId?: string;
  searchableText?: string;
  text?: string;
  freshness?: string;
  confidence?: string;
  provenance?: string;
  citationTargets?: string[];
  observedAt?: string | null;
}

export interface ProjectOwnerSnapshot {
  owner: ProjectSearchOwner;
  revision: string | number | null;
  fingerprint: RecoveryFingerprint | null;
  state: 'current' | 'stale' | 'unavailable';
  items: ProjectOwnerSearchItem[];
  diagnostics: RecoveryFlowDiagnosticV2[];
}

export interface ProjectSearchSource {
  snapshot(projectId: string): Promise<ProjectOwnerSnapshot[]>;
}

export type ProjectOwnerSnapshotInput = Partial<Omit<ProjectOwnerSnapshot, 'owner' | 'items'>> & { owner?: ProjectSearchOwner; items?: ProjectOwnerSearchItem[] };

export type ProjectOwnerReader =
  | ((projectId: string) => ProjectOwnerSnapshotInput | ProjectOwnerSearchItem[] | Promise<ProjectOwnerSnapshotInput | ProjectOwnerSearchItem[]>);

export interface ProjectSearchSourceReaders {
  'work-os'?: ProjectOwnerReader;
  'project-memory'?: ProjectOwnerReader;
  'source-evidence'?: ProjectOwnerReader;
  'session-record'?: ProjectOwnerReader;
  workflow?: ProjectOwnerReader;
}

const PROJECT_ID = /^project\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/u;
const FINGERPRINT = /^sha256:[a-f0-9]{64}$/u;
const OWNER_ORDER: readonly ProjectSearchOwner[] = ['work-os', 'project-memory', 'source-evidence', 'session-record', 'workflow'];
const RECOVERY_OWNER_ORDER: readonly RecoveryOwner[] = ['project', 'work-os', 'workflow', 'project-memory', 'session-record', 'source-evidence', 'agent-domain', 'settings'];

function revision(value: unknown): string | number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && value.trim() && !hasUnsafeRecoveryMaterial(value)) return value.trim();
  return null;
}

function text(value: unknown, label: string, max = 512): string {
  try { return safeRecoveryText(value, label, { minBytes: 1, maxBytes: max }); }
  catch { return ''; }
}

function refs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item, 'citation', 512)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function diagnostic(owner: ProjectSearchOwner, code: string, message: string, remediation: string, severity: RecoveryFlowDiagnosticV2['severity'] = 'warning'): RecoveryFlowDiagnosticV2 {
  return { owner, code, severity, message, remediation, citationTargets: [] } as RecoveryFlowDiagnosticV2;
}

function belongsToProject(projectId: string, item: ProjectOwnerSearchItem): boolean {
  if (item.projectId !== undefined && item.projectId !== projectId) return false;
  // A source reader is already project-scoped, but an explicit foreign Project
  // identity must never reach normalization or affect the owner fingerprint.
  if (item.itemId.startsWith('project/')) return item.itemId.startsWith(`${projectId}/`);
  return true;
}

function normalizeItem(projectId: string, owner: ProjectSearchOwner, raw: ProjectOwnerSearchItem): ProjectOwnerSearchItem | null {
  if (!raw || typeof raw !== 'object' || !belongsToProject(projectId, raw)) return null;
  const itemId = text(raw.itemId, `${owner}.itemId`, 256);
  const itemType = text(raw.itemType, `${owner}.itemType`, 64);
  const label = text(raw.label, `${owner}.label`, 512);
  const searchableText = text(raw.searchableText ?? raw.text ?? raw.label, `${owner}.searchableText`, 16 * 1024);
  const citationTargets = refs(raw.citationTargets).slice(0, 4);
  if (!itemId || !itemType || !label || !searchableText || citationTargets.length === 0) return null;
  const observedAt = raw.observedAt === null || raw.observedAt === undefined ? null : text(raw.observedAt, `${owner}.observedAt`, 64) || null;
  return {
    itemId,
    itemType,
    label,
    projectId,
    searchableText,
    freshness: text(raw.freshness, `${owner}.freshness`, 64) || 'current',
    confidence: text(raw.confidence, `${owner}.confidence`, 64) || 'owner',
    provenance: text(raw.provenance, `${owner}.provenance`, 512) || owner,
    citationTargets,
    observedAt,
  };
}

function normalizeSnapshot(projectId: string, owner: ProjectSearchOwner, value: ProjectOwnerSnapshotInput | ProjectOwnerSearchItem[] | undefined): ProjectOwnerSnapshot {
  const supplied: Partial<ProjectOwnerSnapshotInput> & { items?: ProjectOwnerSearchItem[] } = Array.isArray(value) ? { items: value } : value ?? {};
  const state = supplied?.state === 'stale' || supplied?.state === 'unavailable' ? supplied.state : 'current';
  const items = (supplied?.items ?? [])
    .filter((item): item is ProjectOwnerSearchItem => Boolean(item))
    .map((item) => normalizeItem(projectId, owner, item))
    .filter((item): item is ProjectOwnerSearchItem => item !== null)
    .sort((a, b) => a.itemId.localeCompare(b.itemId));
  const diagnostics: RecoveryFlowDiagnosticV2[] = (supplied?.diagnostics ?? []).slice(0, 32).map((item): RecoveryFlowDiagnosticV2 => ({
    owner,
    code: text(item.code, `${owner}.diagnostic.code`, 128) || 'owner_diagnostic',
    severity: item.severity === 'error' ? 'error' : item.severity === 'info' ? 'info' : 'warning',
    message: text(item.message, `${owner}.diagnostic.message`, 1024) || 'Owner reported a bounded diagnostic.',
    remediation: text(item.remediation, `${owner}.diagnostic.remediation`, 1024) || 'Inspect the owner and retry search.',
    citationTargets: refs(item.citationTargets).slice(0, 8),
  }));
  if (state === 'unavailable' && diagnostics.length === 0) diagnostics.push(diagnostic(owner, 'owner_unavailable', 'The Project search owner is unavailable.', 'Repair the owner and retry search.', 'error'));
  if (state === 'stale' && diagnostics.length === 0) diagnostics.push(diagnostic(owner, 'owner_stale', 'The Project search owner is stale.', 'Refresh the owner before relying on search results.'));
  const sourceItems = supplied?.items ?? [];
  const droppedItems = sourceItems.length !== items.length;
  return {
    owner,
    revision: revision(supplied?.revision),
    fingerprint: !droppedItems && supplied?.fingerprint && FINGERPRINT.test(supplied.fingerprint) ? supplied.fingerprint : fingerprintRecoveryValue(items),
    state,
    items: state === 'unavailable' ? [] : items,
    diagnostics,
  };
}

export function createProjectSearchSource(readers: ProjectSearchSourceReaders): ProjectSearchSource {
  return {
    async snapshot(projectId) {
      if (!PROJECT_ID.test(projectId)) throw new Error('Project search projectId must be canonical');
      const snapshots: ProjectOwnerSnapshot[] = [];
      for (const owner of OWNER_ORDER) {
        const reader = readers[owner];
        let value: ProjectOwnerSnapshotInput | ProjectOwnerSearchItem[] | undefined;
        try {
          value = reader
            ? await reader(projectId)
            : { state: 'unavailable', items: [], diagnostics: [diagnostic(owner, 'owner_unavailable', 'The Project search owner is not configured.', 'Configure the owner and retry search.', 'error')] };
        }
        catch {
          value = { state: 'unavailable', items: [], diagnostics: [diagnostic(owner, 'owner_unavailable', 'The Project search owner could not be read.', 'Repair the owner and retry search.', 'error')] };
        }
        snapshots.push(normalizeSnapshot(projectId, owner, value));
      }
      return snapshots;
    },
  };
}

export const makeProjectSearchSource = createProjectSearchSource;

export function ownerSnapshotLocks(owners: ProjectOwnerSnapshot[], fallback: RecoveryOwnerLock[] = []): RecoveryOwnerLock[] {
  const byOwner = new Map(owners.map((owner) => [owner.owner, owner]));
  const fallbackByOwner = new Map(fallback.map((lock) => [lock.owner, lock]));
  return RECOVERY_OWNER_ORDER.map((owner) => {
    const snapshot = byOwner.get(owner as ProjectSearchOwner);
    if (snapshot) return { owner, revision: snapshot.revision, fingerprint: snapshot.fingerprint, state: snapshot.state };
    const prior = fallbackByOwner.get(owner);
    return prior ?? { owner, revision: null, fingerprint: null, state: 'current' };
  });
}
