import {
  PROJECT_CONTEXT_SCHEMA_VERSION,
  ProjectContextProjectionError,
  type Authority,
  type ClaimValue,
  type ConflictState,
  type ContextSection,
  type EvidenceRef,
  type EvidenceStatus,
  type Freshness,
  type ProjectClaimInput,
  type ProjectContextAuthority,
  type ProjectContextClaim,
  type ProjectContextConflict,
  type ProjectContextFreshness,
  type ProjectContextProjection,
  type ProjectContextProjectionInput,
  type ProjectContextSession,
  type ProjectMemorySource,
  type ResearchRecord,
  type ReviewStatus,
  type SessionRecord,
} from './contracts.js';
import { sha256 } from './contracts.js';

const CONTEXT_SECTIONS: readonly ContextSection[] = [
  'goal',
  'currentState',
  'completed',
  'openWork',
  'relations',
];
const ALL_SECTIONS = [...CONTEXT_SECTIONS, 'conflicts', 'sessions'] as const;
const DEFAULT_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

interface NormalizedClaim extends ProjectClaimInput {
  readonly sourceId: string;
  readonly authority: Authority;
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly reviewStatus: ReviewStatus;
}

interface ClassifiedClaim extends ProjectContextClaim {
  readonly supersedes: readonly string[];
}

interface Classification {
  readonly claims: readonly ClassifiedClaim[];
  readonly conflicts: readonly ProjectContextConflict[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function compareCanonical(left: unknown, right: unknown): number {
  return canonicalJson(left).localeCompare(canonicalJson(right));
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ProjectContextProjectionError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function optionalTimestamp(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  const timestamp = nonEmpty(value, label);
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new ProjectContextProjectionError(`${label} must be an ISO timestamp`);
  }
  return timestamp;
}

function normalizeEvidenceRef(value: string | EvidenceRef): EvidenceRef {
  if (typeof value === 'string') return { ref: nonEmpty(value, 'evidence ref') };
  if (!isRecord(value)) throw new ProjectContextProjectionError('Evidence refs must be strings or objects');
  const ref = nonEmpty(value.ref, 'evidence ref.ref');
  const status = value.status as EvidenceStatus | undefined;
  if (status !== undefined && !['available', 'stale', 'deleted_or_unavailable'].includes(status)) {
    throw new ProjectContextProjectionError(`Unsupported evidence status: ${String(status)}`);
  }
  return {
    ref,
    ...(typeof value.kind === 'string' && value.kind.trim() ? { kind: value.kind.trim() } : {}),
    ...(typeof value.label === 'string' && value.label.trim() ? { label: value.label.trim() } : {}),
    ...(status ? { status } : {}),
    ...(value.observedAt !== undefined ? { observedAt: optionalTimestamp(value.observedAt, 'evidence ref.observedAt') } : {}),
  };
}

function normalizeEvidenceRefs(values: readonly (string | EvidenceRef)[] | undefined): readonly EvidenceRef[] {
  const byRef = new Map<string, EvidenceRef>();
  for (const value of values ?? []) {
    const evidence = normalizeEvidenceRef(value);
    const existing = byRef.get(evidence.ref);
    if (!existing) {
      byRef.set(evidence.ref, evidence);
      continue;
    }
    const statusRank: Record<EvidenceStatus, number> = {
      available: 0,
      stale: 1,
      deleted_or_unavailable: 2,
    };
    const existingRank = statusRank[existing.status ?? 'available'];
    const candidateRank = statusRank[evidence.status ?? 'available'];
    const merged: EvidenceRef = {
      ref: evidence.ref,
      ...(evidence.kind ?? existing.kind ? { kind: evidence.kind ?? existing.kind } : {}),
      ...(evidence.label ?? existing.label ? { label: evidence.label ?? existing.label } : {}),
      ...((candidateRank >= existingRank && evidence.status) || existing.status
        ? { status: candidateRank >= existingRank ? evidence.status ?? existing.status : existing.status }
        : {}),
      ...(evidence.observedAt ?? existing.observedAt ? { observedAt: evidence.observedAt ?? existing.observedAt } : {}),
    };
    byRef.set(evidence.ref, merged);
  }
  return [...byRef.values()].sort((left, right) => left.ref.localeCompare(right.ref) || compareCanonical(left, right));
}

function normalizeValue(value: ClaimValue, label: string): ClaimValue {
  if (typeof value === 'string') return nonEmpty(value, `${label}.value`);
  if (!isRecord(value)) throw new ProjectContextProjectionError(`${label}.value must be a string or object`);
  return canonicalize(value) as Readonly<Record<string, unknown>>;
}

function stableKey(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N}:/._-]+/gu, '-');
}

function makeGeneratedClaim(
  claimId: string,
  section: ContextSection,
  key: string,
  value: string,
  sourceId: string,
  evidenceRefs: readonly EvidenceRef[],
  authority: Authority,
  reviewStatus: ReviewStatus,
  observedAt?: string,
  state?: ConflictState,
): ProjectClaimInput {
  return {
    claimId,
    section,
    key,
    value,
    sourceId,
    evidenceRefs,
    authority,
    reviewStatus,
    ...(observedAt ? { observedAt } : {}),
    ...(state ? { state } : {}),
  };
}

function claimsFromSession(session: SessionRecord): readonly ProjectClaimInput[] {
  if (session.claims?.length) return session.claims;
  return [];
}

function claimsFromResearch(record: ResearchRecord): readonly ProjectClaimInput[] {
  if (record.claims?.length) return record.claims;
  const evidenceRefs = normalizeEvidenceRefs(record.sources);
  const claims: ProjectClaimInput[] = [];
  if (record.question?.trim()) {
    claims.push(makeGeneratedClaim(
      `${record.recordId}/question`,
      'goal',
      'project-goal',
      record.question,
      record.recordId,
      evidenceRefs,
      'derived',
      record.reviewStatus,
    ));
  }
  for (const [index, observation] of (record.observations ?? []).entries()) {
    if (!observation.trim()) continue;
    claims.push(makeGeneratedClaim(
      `${record.recordId}/observation/${index + 1}`,
      'currentState',
      `observation/${stableKey(observation)}`,
      observation,
      record.recordId,
      evidenceRefs,
      'derived',
      record.reviewStatus,
    ));
  }
  for (const [index, decision] of (record.decisions ?? []).entries()) {
    if (!decision.trim()) continue;
    claims.push(makeGeneratedClaim(
      `${record.recordId}/decision/${index + 1}`,
      'currentState',
      `decision/${stableKey(decision)}`,
      decision,
      record.recordId,
      evidenceRefs,
      'derived',
      record.reviewStatus,
      undefined,
    ));
  }
  for (const [index, uncertainty] of (record.uncertainties ?? []).entries()) {
    if (!uncertainty.trim()) continue;
    claims.push(makeGeneratedClaim(
      `${record.recordId}/uncertainty/${index + 1}`,
      'currentState',
      `uncertainty/${stableKey(uncertainty)}`,
      uncertainty,
      record.recordId,
      evidenceRefs,
      'derived',
      record.reviewStatus,
      undefined,
      'unresolved',
    ));
  }
  if (record.nextHandoff?.trim()) {
    claims.push(makeGeneratedClaim(
      `${record.recordId}/next-handoff`,
      'openWork',
      'next-handoff',
      record.nextHandoff,
      record.recordId,
      evidenceRefs,
      'derived',
      record.reviewStatus,
      undefined,
    ));
  }
  return claims;
}

function normalizeClaim(input: ProjectClaimInput, fallbackSourceId: string, fallbackAuthority: Authority): NormalizedClaim {
  const claimId = nonEmpty(input.claimId, 'claimId');
  const section = input.section;
  if (!CONTEXT_SECTIONS.includes(section)) throw new ProjectContextProjectionError(`Unsupported claim section: ${String(section)}`);
  const key = nonEmpty(input.key, `${claimId}.key`);
  const sourceId = nonEmpty(input.sourceId ?? fallbackSourceId, `${claimId}.sourceId`);
  const authority = input.authority ?? fallbackAuthority;
  if (!['source', 'derived', 'unknown'].includes(authority)) throw new ProjectContextProjectionError(`${claimId}.authority is invalid`);
  const reviewStatus = input.reviewStatus ?? (authority === 'source' ? 'reviewed' : 'draft');
  if (!['draft', 'reviewed', 'promoted'].includes(reviewStatus)) throw new ProjectContextProjectionError(`${claimId}.reviewStatus is invalid`);
  if (input.state !== undefined && !['current', 'superseded', 'stale', 'unresolved'].includes(input.state)) {
    throw new ProjectContextProjectionError(`${claimId}.state is invalid`);
  }
  const observedAt = optionalTimestamp(input.observedAt, `${claimId}.observedAt`);
  return {
    ...input,
    claimId,
    section,
    key,
    value: normalizeValue(input.value, claimId),
    sourceId,
    authority,
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs),
    reviewStatus,
    ...(observedAt ? { observedAt } : {}),
    supersedes: [...new Set((input.supersedes ?? []).map((value) => nonEmpty(value, `${claimId}.supersedes`)))].sort(),
  };
}

function claimValueKey(value: ClaimValue): string {
  return canonicalJson(value);
}

function aggregateAuthority(values: readonly Authority[]): Authority {
  if (values.length === 0 || values.includes('unknown')) return 'unknown';
  if (values.includes('derived')) return 'derived';
  return 'source';
}

function freshnessForEvidence(
  evidenceRefs: readonly EvidenceRef[],
  observedAt: string | undefined,
  generatedAt: string,
  staleAfterMs: number,
): Freshness {
  if (evidenceRefs.some((evidence) => evidence.status === 'stale' || evidence.status === 'deleted_or_unavailable')) return 'stale';
  const evidenceWithDates = evidenceRefs.filter((evidence) => evidence.observedAt);
  const newestEvidence = evidenceWithDates
    .map((evidence) => Date.parse(evidence.observedAt!))
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0];
  const observed = observedAt ? Date.parse(observedAt) : undefined;
  const newest = newestEvidence ?? observed;
  if (newest === undefined) return evidenceRefs.length ? 'current' : 'unknown';
  if (staleAfterMs !== Infinity && Date.parse(generatedAt) - newest > staleAfterMs) return 'stale';
  return 'current';
}

function classifyClaims(
  claims: readonly NormalizedClaim[],
  generatedAt: string,
  staleAfterMs: number,
): Classification {
  const groups = new Map<string, NormalizedClaim[]>();
  for (const claim of claims) {
    const groupKey = `${claim.section}\0${claim.key}`;
    const group = groups.get(groupKey) ?? [];
    group.push(claim);
    groups.set(groupKey, group);
  }

  const classified: ClassifiedClaim[] = [];
  const conflicts: ProjectContextConflict[] = [];
  for (const group of [...groups.values()].sort((left, right) => {
    const a = `${left[0]!.section}\0${left[0]!.key}`;
    const b = `${right[0]!.section}\0${right[0]!.key}`;
    return a.localeCompare(b);
  })) {
    const supersededIds = new Set<string>();
    for (const claim of group) {
      for (const target of claim.supersedes ?? []) supersededIds.add(target);
      if (claim.state === 'superseded') supersededIds.add(claim.claimId);
    }
    const active = group.filter((claim) => !supersededIds.has(claim.claimId));
    const activeValueKeys = new Set(active.map((claim) => claimValueKey(claim.value)));
    const unresolved = activeValueKeys.size > 1;
    const groupClaims = group.map((claim): ClassifiedClaim => {
      const freshness = freshnessForEvidence(claim.evidenceRefs, claim.observedAt, generatedAt, staleAfterMs);
      const state: ConflictState = supersededIds.has(claim.claimId)
        ? 'superseded'
        : unresolved || claim.state === 'unresolved'
          ? 'unresolved'
          : claim.state === 'stale' || freshness === 'stale'
            ? 'stale'
            : 'current';
      return {
        claimId: claim.claimId,
        section: claim.section,
        key: claim.key,
        value: claim.value,
        sourceId: claim.sourceId,
        authority: claim.authority,
        evidenceRefs: claim.evidenceRefs,
        observedAt: claim.observedAt ?? null,
        reviewStatus: claim.reviewStatus,
        freshness,
        state,
        supersedes: claim.supersedes ?? [],
      };
    }).sort((left, right) => left.claimId.localeCompare(right.claimId));
    classified.push(...groupClaims);

    const hasConflictRecord = groupClaims.length > 1 && (
      unresolved || groupClaims.some((claim) => claim.state !== 'current')
    ) || groupClaims.some((claim) => claim.state === 'stale' || claim.state === 'unresolved');
    if (hasConflictRecord) {
      const state: ConflictState = unresolved
        ? 'unresolved'
        : groupClaims.some((claim) => claim.state === 'current')
          ? 'current'
          : groupClaims.some((claim) => claim.state === 'stale')
            ? 'stale'
            : 'superseded';
      conflicts.push({
        conflictId: `conflict/${group[0]!.section}/${groupClaims[0]!.key}`,
        section: group[0]!.section,
        key: group[0]!.key,
        state,
        authority: aggregateAuthority(groupClaims.map((claim) => claim.authority)),
        freshness: groupClaims.some((claim) => claim.freshness === 'stale') ? 'stale' : groupClaims.some((claim) => claim.freshness === 'unknown') ? 'unknown' : 'current',
        evidenceRefs: normalizeEvidenceRefs(groupClaims.flatMap((claim) => claim.evidenceRefs)),
        claims: groupClaims,
      });
    }
  }
  return { claims: classified, conflicts: conflicts.sort((left, right) => left.conflictId.localeCompare(right.conflictId)) };
}

function sessionFreshness(session: SessionRecord, evidenceRefs: readonly EvidenceRef[], generatedAt: string, staleAfterMs: number): Freshness {
  if (session.status === 'unavailable') return 'stale';
  return freshnessForEvidence(evidenceRefs, session.capturedAt, generatedAt, staleAfterMs);
}

function toSessionProjection(
  session: SessionRecord,
  researchRecords: readonly ResearchRecord[],
  generatedAt: string,
  staleAfterMs: number,
): ProjectContextSession {
  const evidenceRefs = normalizeEvidenceRefs([
    ...(session.sourceRefs ?? []),
    ...(session.sourceRef ? [session.sourceRef] : []),
  ]);
  return {
    sessionId: nonEmpty(session.sessionId, 'sessionId'),
    source: session.source,
    sourceRef: session.sourceRef ?? null,
    host: session.host ?? 'unknown',
    capturedAt: session.capturedAt ?? null,
    status: session.status,
    revision: session.revision ?? null,
    contentHash: session.contentHash ?? null,
    evidenceRefs,
    freshness: sessionFreshness(session, evidenceRefs, generatedAt, staleAfterMs),
    authority: 'source',
    researchRecordIds: researchRecords
      .filter((record) => record.sessionRefs.includes(session.sessionId))
      .map((record) => record.recordId)
      .sort(),
  };
}

function sectionClaims(classification: Classification, section: ContextSection): readonly ProjectContextClaim[] {
  return classification.claims
    .filter((claim) => claim.section === section)
    .map(({ supersedes: _supersedes, ...claim }) => claim)
    .sort((left, right) => left.claimId.localeCompare(right.claimId));
}

function summarizeFreshness(values: readonly Freshness[]): Freshness {
  if (values.includes('stale')) return 'stale';
  if (values.includes('unknown')) return 'unknown';
  return values.length ? 'current' : 'unknown';
}

function summarizeAuthority(values: readonly Authority[]): Authority {
  return aggregateAuthority(values);
}

function buildFreshness(
  claims: readonly ProjectContextClaim[],
  conflicts: readonly ProjectContextConflict[],
  sessions: readonly ProjectContextSession[],
): ProjectContextFreshness {
  const bySection = {
    goal: summarizeFreshness(claims.filter((claim) => claimSection(claim) === 'goal').map((claim) => claim.freshness)),
    currentState: summarizeFreshness(claims.filter((claim) => claimSection(claim) === 'currentState').map((claim) => claim.freshness)),
    completed: summarizeFreshness(claims.filter((claim) => claimSection(claim) === 'completed').map((claim) => claim.freshness)),
    openWork: summarizeFreshness(claims.filter((claim) => claimSection(claim) === 'openWork').map((claim) => claim.freshness)),
    relations: summarizeFreshness(claims.filter((claim) => claimSection(claim) === 'relations').map((claim) => claim.freshness)),
    conflicts: summarizeFreshness(conflicts.map((conflict) => conflict.freshness)),
    sessions: summarizeFreshness(sessions.map((session) => session.freshness)),
  } as const;
  return {
    state: summarizeFreshness(Object.values(bySection)),
    bySection,
    latestObservedAt: latestTimestamp([
      ...claims.map((claim) => claim.observedAt),
      ...sessions.map((session) => session.capturedAt),
    ]),
  };
}

function claimSection(claim: ProjectContextClaim): ContextSection {
  return claim.section;
}

function latestTimestamp(values: readonly (string | null | undefined)[]): string | null {
  const valid = values.filter((value): value is string => value !== null && value !== undefined && value !== '' && Number.isFinite(Date.parse(value)));
  return valid.sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
}

function buildAuthority(
  claims: readonly ProjectContextClaim[],
  conflicts: readonly ProjectContextConflict[],
  sessions: readonly ProjectContextSession[],
): ProjectContextAuthority {
  const sectionAuthority = (section: ContextSection): Authority => summarizeAuthority(
    claims.filter((claim) => claimSection(claim) === section).map((claim) => claim.authority),
  );
  const bySection = {
    goal: sectionAuthority('goal'),
    currentState: sectionAuthority('currentState'),
    completed: sectionAuthority('completed'),
    openWork: sectionAuthority('openWork'),
    relations: sectionAuthority('relations'),
    conflicts: summarizeAuthority(conflicts.map((conflict) => conflict.authority)),
    sessions: sessions.length ? 'source' : 'unknown',
  } as const;
  return { state: summarizeAuthority(Object.values(bySection)), bySection };
}

function sourceMaterial(
  projectId: string,
  sessions: readonly SessionRecord[],
  researchRecords: readonly ResearchRecord[],
  claims: readonly ProjectClaimInput[],
): unknown {
  return canonicalize({
    projectId,
    sessions: [...sessions].sort((left, right) => left.sessionId.localeCompare(right.sessionId)),
    researchRecords: [...researchRecords].sort((left, right) => left.recordId.localeCompare(right.recordId)),
    claims: [...claims].sort((left, right) => left.claimId.localeCompare(right.claimId)),
  });
}

function validateProjectInput(input: ProjectContextProjectionInput): {
  projectId: string;
  generatedAt: string;
  staleAfterMs: number;
  sessions: readonly SessionRecord[];
  researchRecords: readonly ResearchRecord[];
  claims: readonly ProjectClaimInput[];
} {
  const projectId = nonEmpty(input.projectId, 'projectId');
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  optionalTimestamp(generatedAt, 'generatedAt');
  const staleAfterMs = input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  if (staleAfterMs !== Infinity && (!Number.isFinite(staleAfterMs) || staleAfterMs < 0)) {
    throw new ProjectContextProjectionError('staleAfterMs must be non-negative or Infinity');
  }
  const sessions = input.sessions ?? [];
  const researchRecords = input.researchRecords ?? [];
  const claims = input.claims ?? [];
  for (const session of sessions) {
    nonEmpty(session.sessionId, 'sessionId');
    if (session.projectId !== projectId) throw new ProjectContextProjectionError(`Session ${session.sessionId} belongs to another project`);
    optionalTimestamp(session.capturedAt, `${session.sessionId}.capturedAt`);
  }
  for (const record of researchRecords) {
    nonEmpty(record.recordId, 'recordId');
    if (record.projectId !== projectId) throw new ProjectContextProjectionError(`Research record ${record.recordId} belongs to another project`);
  }
  return { projectId, generatedAt, staleAfterMs, sessions, researchRecords, claims };
}

export function projectContextFromRecords(input: ProjectContextProjectionInput): ProjectContextProjection {
  const validated = validateProjectInput(input);
  const generatedClaims: ProjectClaimInput[] = [
    ...validated.claims,
    ...validated.sessions.flatMap(claimsFromSession),
    ...validated.researchRecords.flatMap(claimsFromResearch),
  ];
  const normalizedClaims = generatedClaims.map((claim) => normalizeClaim(
    claim,
    claim.sourceId ?? 'unknown',
    claim.authority ?? 'unknown',
  ));
  const duplicateIds = new Set<string>();
  for (const claim of normalizedClaims) {
    if (duplicateIds.has(claim.claimId)) throw new ProjectContextProjectionError(`Duplicate claimId: ${claim.claimId}`);
    duplicateIds.add(claim.claimId);
  }
  const classification = classifyClaims(normalizedClaims, validated.generatedAt, validated.staleAfterMs);
  const sessions = validated.sessions
    .map((session) => toSessionProjection(session, validated.researchRecords, validated.generatedAt, validated.staleAfterMs))
    .sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  const claims = classification.claims.map(({ supersedes: _supersedes, ...claim }) => claim);
  const sections = {
    goal: sectionClaims(classification, 'goal'),
    currentState: sectionClaims(classification, 'currentState'),
    completed: sectionClaims(classification, 'completed'),
    openWork: sectionClaims(classification, 'openWork'),
    relations: sectionClaims(classification, 'relations'),
    conflicts: classification.conflicts,
    sessions,
  } as const;
  const evidenceRefs = normalizeEvidenceRefs([
    ...claims.flatMap((claim) => claim.evidenceRefs),
    ...classification.conflicts.flatMap((conflict) => conflict.evidenceRefs),
    ...sessions.flatMap((session) => session.evidenceRefs),
  ]);
  const freshness = buildFreshness(claims, classification.conflicts, sessions);
  const authority = buildAuthority(claims, classification.conflicts, sessions);
  const revision = sha256(canonicalJson(sourceMaterial(validated.projectId, validated.sessions, validated.researchRecords, generatedClaims)));
  const fingerprint = sha256(canonicalJson({
    schemaVersion: PROJECT_CONTEXT_SCHEMA_VERSION,
    projectId: validated.projectId,
    revision,
    sections,
    evidenceRefs,
    freshness,
    authority,
    readOnly: true,
  }));
  return {
    schemaVersion: PROJECT_CONTEXT_SCHEMA_VERSION,
    projectId: validated.projectId,
    generatedAt: validated.generatedAt,
    revision,
    fingerprint,
    readOnly: true,
    sections,
    evidenceRefs,
    freshness,
    authority,
  };
}

export async function projectContextFromSource(
  source: ProjectMemorySource,
  projectId: string,
  options: Omit<ProjectContextProjectionInput, 'projectId' | 'sessions' | 'researchRecords' | 'claims'> = {},
): Promise<ProjectContextProjection> {
  const [sessions, researchRecords, claims] = await Promise.all([
    source.listSessions(projectId),
    source.listResearchRecords(projectId),
    source.listClaims ? source.listClaims(projectId) : [],
  ]);
  return projectContextFromRecords({
    ...options,
    projectId,
    sessions,
    researchRecords,
    claims,
  });
}

function evidenceText(evidenceRefs: readonly EvidenceRef[]): string {
  return evidenceRefs.length ? evidenceRefs.map((evidence) => `\`${evidence.ref}\``).join(', ') : '`no evidence reference`';
}

function valueText(value: ClaimValue): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function renderProjectContextText(context: ProjectContextProjection): string {
  const lines = [
    `# Project Context: ${context.projectId}`,
    '',
    `Schema: ${context.schemaVersion}; fingerprint: ${context.fingerprint}; revision: ${context.revision}`,
    `Generated: ${context.generatedAt}; freshness: ${context.freshness.state}; authority: ${context.authority.state}`,
    '',
  ];
  const labels: Readonly<Record<ContextSection, string>> = {
    goal: 'Goal',
    currentState: 'Current state',
    completed: 'Completed',
    openWork: 'Open work',
    relations: 'Relations',
  };
  for (const section of CONTEXT_SECTIONS) {
    lines.push(`## ${labels[section]}`);
    const items = context.sections[section];
    if (!items.length) lines.push('- None recorded.');
    for (const item of items) {
      lines.push(`- [${item.state}; ${item.freshness}; ${item.authority}] ${item.value instanceof Object && typeof item.value !== 'string' ? valueText(item.value) : valueText(item.value)}`);
      lines.push(`  - Claim: ${item.claimId}; evidence: ${evidenceText(item.evidenceRefs)}`);
    }
    lines.push('');
  }
  lines.push('## Conflicts');
  if (!context.sections.conflicts.length) lines.push('- None recorded.');
  for (const conflict of context.sections.conflicts) {
    lines.push(`- [${conflict.state}; ${conflict.freshness}; ${conflict.authority}] ${conflict.section}/${conflict.key}`);
    for (const claim of conflict.claims) {
      lines.push(`  - [${claim.state}] ${claim.claimId}: ${valueText(claim.value)}; evidence: ${evidenceText(claim.evidenceRefs)}`);
    }
  }
  lines.push('', '## Sessions');
  if (!context.sections.sessions.length) lines.push('- None recorded.');
  for (const session of context.sections.sessions) {
    lines.push(`- [${session.status}; ${session.freshness}] ${session.sessionId} (${session.host}); evidence: ${evidenceText(session.evidenceRefs)}`);
  }
  return `${lines.join('\n')}\n`;
}

export function canonicalProjectContextJson(context: ProjectContextProjection): string {
  return `${JSON.stringify(canonicalize(context), null, 2)}\n`;
}
