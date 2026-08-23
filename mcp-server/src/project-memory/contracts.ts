import { createHash } from 'node:crypto';

export const PROJECT_CONTEXT_SCHEMA_VERSION = 'project-context/v1' as const;
export const SESSION_RECORD_SCHEMA_VERSION = 'session-record/v1' as const;
export const RESEARCH_RECORD_SCHEMA_VERSION = 'research-record/v1' as const;

export type ContextSection =
  | 'goal'
  | 'currentState'
  | 'completed'
  | 'openWork'
  | 'relations';

export type ConflictState = 'current' | 'superseded' | 'stale' | 'unresolved';
export type Freshness = 'current' | 'stale' | 'unknown';
export type Authority = 'source' | 'derived' | 'unknown';
export type ReviewStatus = 'draft' | 'reviewed' | 'promoted';
export type EvidenceStatus = 'available' | 'stale' | 'deleted_or_unavailable';

export interface EvidenceRef {
  readonly ref: string;
  readonly kind?: string;
  readonly label?: string;
  readonly status?: EvidenceStatus;
  readonly observedAt?: string;
}

export type ClaimValue = string | Readonly<Record<string, unknown>>;

export interface ProjectClaimInput {
  readonly claimId: string;
  readonly section: ContextSection;
  /** Claims with the same section and key are compared for conflicts. */
  readonly key: string;
  readonly value: ClaimValue;
  readonly sourceId?: string;
  readonly authority?: Authority;
  readonly evidenceRefs?: readonly (string | EvidenceRef)[];
  readonly observedAt?: string;
  readonly reviewStatus?: ReviewStatus;
  readonly state?: ConflictState;
  /** An explicit, reviewable supersession edge. It is the only way to resolve a competing claim. */
  readonly supersedes?: readonly string[];
}

export interface SessionRecord {
  readonly schemaVersion?: typeof SESSION_RECORD_SCHEMA_VERSION;
  readonly sessionId: string;
  readonly projectId: string;
  readonly source: 'host' | 'import' | 'vaultPath';
  readonly sourceRef?: string;
  readonly capturedAt?: string;
  readonly host?: 'codex' | 'claude' | 'chatgpt' | 'other' | 'unknown' | string;
  readonly workspace?: string;
  readonly branch?: string;
  readonly status: 'captured' | 'indexed' | 'unavailable';
  readonly contentHash?: string;
  readonly revision?: number | string;
  readonly sourceRefs?: readonly (string | EvidenceRef)[];
  readonly claims?: readonly ProjectClaimInput[];
}

export interface ResearchRecord {
  readonly schemaVersion?: typeof RESEARCH_RECORD_SCHEMA_VERSION;
  readonly recordId: string;
  readonly projectId: string;
  readonly sessionRefs: readonly string[];
  readonly question?: string;
  readonly plan?: readonly string[];
  readonly sources?: readonly (string | EvidenceRef)[];
  readonly observations?: readonly string[];
  readonly decisions?: readonly string[];
  readonly uncertainties?: readonly string[];
  readonly nextHandoff?: string;
  readonly reviewStatus: ReviewStatus;
  readonly contentHash?: string;
  readonly revision?: number | string;
  readonly claims?: readonly ProjectClaimInput[];
}

export interface ProjectMemorySource {
  readonly listSessions: (projectId: string) => readonly SessionRecord[] | Promise<readonly SessionRecord[]>;
  readonly listResearchRecords: (projectId: string) => readonly ResearchRecord[] | Promise<readonly ResearchRecord[]>;
  readonly listClaims?: (projectId: string) => readonly ProjectClaimInput[] | Promise<readonly ProjectClaimInput[]>;
}

export interface ProjectContextProjectionInput {
  readonly projectId: string;
  readonly sessions?: readonly SessionRecord[];
  readonly researchRecords?: readonly ResearchRecord[];
  readonly claims?: readonly ProjectClaimInput[];
  /** Used for display and freshness comparison. It is intentionally excluded from the fingerprint. */
  readonly generatedAt?: string;
  /** Defaults to 30 days. Set to Infinity to disable age-based staleness. */
  readonly staleAfterMs?: number;
}

export interface ProjectContextClaim {
  readonly claimId: string;
  readonly section: ContextSection;
  readonly key: string;
  readonly value: ClaimValue;
  readonly sourceId: string;
  readonly authority: Authority;
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly observedAt: string | null;
  readonly reviewStatus: ReviewStatus;
  readonly freshness: Freshness;
  readonly state: ConflictState;
}

export interface ProjectContextConflict {
  readonly conflictId: string;
  readonly section: ContextSection;
  readonly key: string;
  /** `current` means an explicit supersession edge resolved the competing claims. */
  readonly state: ConflictState;
  readonly authority: Authority;
  readonly freshness: Freshness;
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly claims: readonly ProjectContextClaim[];
}

export interface ProjectContextSession {
  readonly sessionId: string;
  readonly source: SessionRecord['source'];
  readonly sourceRef: string | null;
  readonly host: string;
  readonly capturedAt: string | null;
  readonly status: SessionRecord['status'];
  readonly revision: number | string | null;
  readonly contentHash: string | null;
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly freshness: Freshness;
  readonly authority: 'source';
  readonly researchRecordIds: readonly string[];
}

export interface ProjectContextFreshness {
  readonly state: Freshness;
  readonly bySection: Readonly<Record<ContextSection | 'conflicts' | 'sessions', Freshness>>;
  readonly latestObservedAt: string | null;
}

export interface ProjectContextAuthority {
  readonly state: Authority;
  readonly bySection: Readonly<Record<ContextSection | 'conflicts' | 'sessions', Authority>>;
}

export interface ProjectContextProjection {
  readonly schemaVersion: typeof PROJECT_CONTEXT_SCHEMA_VERSION;
  readonly projectId: string;
  readonly generatedAt: string;
  /** A digest of the source revision set; generatedAt is not part of it. */
  readonly revision: string;
  readonly fingerprint: string;
  readonly readOnly: true;
  readonly sections: {
    readonly goal: readonly ProjectContextClaim[];
    readonly currentState: readonly ProjectContextClaim[];
    readonly completed: readonly ProjectContextClaim[];
    readonly openWork: readonly ProjectContextClaim[];
    readonly relations: readonly ProjectContextClaim[];
    readonly conflicts: readonly ProjectContextConflict[];
    readonly sessions: readonly ProjectContextSession[];
  };
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly freshness: ProjectContextFreshness;
  readonly authority: ProjectContextAuthority;
}

export class ProjectContextProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectContextProjectionError';
  }
}

export function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}
