import {
  fingerprintRecoveryValue,
  safeRecoveryText,
  utf8JsonBytes,
  type RecoveryFingerprint,
} from './contract-support.js';
import {
  composeRecoveryOpenStage,
  type RecoveryOpenOwners,
} from './recovery-open.js';
import {
  fingerprintRecoveryFlowIntrinsicStage,
  RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
  RECOVERY_FLOW_SCHEMA_VERSION,
  validateRecoveryFlowResponseV2,
  type RecoveryFlowDiagnosticV2,
  type RecoveryFlowResponseV2,
  type RecoveryOpenResponseV2,
  type RecoveryOwnerLock,
  type RecoveryOwner,
  type RecoverySearchRequestV2,
  type RecoverySearchResultV2,
  type RecoverySearchedPayloadV2,
  type RecoveryStaleProofV2,
} from './recovery-flow.js';
import {
  createProjectSearchSource,
  ownerSnapshotLocks,
  type ProjectOwnerSearchItem,
  type ProjectOwnerSnapshot,
  type ProjectSearchSource,
} from './search-source.js';
import type { RecoveryAgentSelectionSource } from './agent-selection.js';
import { applyCandidateStageToSearch, composeRecoveryCandidates } from './action-candidates.js';
const responseFields = (intrinsic: Record<string, unknown>) => { const { payloadFingerprint: _payloadFingerprint, ...fields } = intrinsic; return fields; };

export interface RecoverySearchedBasisV2 {
  schemaVersion: typeof RECOVERY_FLOW_SCHEMA_VERSION;
  stage: 'searched';
  projectId: string;
  previousFlowFingerprint: RecoveryFingerprint;
  rootOpenFlowFingerprint: RecoveryFingerprint;
  actionInputFingerprint: RecoveryFingerprint;
  recoveryFingerprint: RecoveryFingerprint;
  ownerLocks: RecoveryOwnerLock[];
  payload: RecoverySearchedPayloadV2;
  diagnostics: RecoveryFlowDiagnosticV2[];
  omitted: { items: number; citations: number; diagnostics: number; bytes: number };
  flowFingerprint: RecoveryFingerprint;
}

export interface RecoverySearchDependencies {
  openOwners: RecoveryOpenOwners;
  searchSource?: ProjectSearchSource;
  now?: () => number;
  currentOpen?: RecoveryOpenResponseV2;
  agentSelection?: RecoveryAgentSelectionSource;
}

export interface RecoverySearchInput {
  request: RecoverySearchRequestV2;
  dependencies: RecoverySearchDependencies;
}

const PROJECT_ID = /^project\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/u;
const OWNER_PRIORITY: Record<string, number> = { 'work-os': 0, 'project-memory': 1, 'source-evidence': 2, 'session-record': 3, workflow: 4 };
const MATCH_PRIORITY: Record<string, number> = { exact: 0, phrase: 1, terms: 2, partial: 3 };

function query(value: unknown): string {
  return safeRecoveryText(value, 'query', { minBytes: 1, maxBytes: 2048 });
}

function limit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 25) throw new Error('limit must be an integer from 1 through 25');
  return value;
}

function diagnostic(owner: RecoveryFlowDiagnosticV2['owner'], code: string, message: string, remediation: string, severity: RecoveryFlowDiagnosticV2['severity'] = 'warning'): RecoveryFlowDiagnosticV2 {
  return { owner, code, severity, message, remediation, citationTargets: [] };
}

function match(item: ProjectOwnerSearchItem, normalizedQuery: string): { matchClass: string; score: number } | null {
  const haystack = (item.searchableText ?? item.text ?? item.label).normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
  const needle = normalizedQuery.toLowerCase();
  const tokens = needle.split(' ').filter(Boolean);
  if (haystack === needle) return { matchClass: 'exact', score: 1000 };
  if (haystack.includes(needle)) return { matchClass: 'phrase', score: 800 + Math.min(99, needle.length) };
  const matches = tokens.filter((token) => haystack.includes(token));
  if (matches.length === tokens.length && matches.length > 0) return { matchClass: 'terms', score: 600 + matches.length };
  if (matches.length > 0) return { matchClass: 'partial', score: 300 + Math.floor((matches.length * 100) / tokens.length) };
  return null;
}

function safeResult(owner: ProjectOwnerSnapshot, item: ProjectOwnerSearchItem, normalizedQuery: string, projectId: string): RecoverySearchResultV2 | null {
  const found = match(item, normalizedQuery);
  if (!found) return null;
  const citationTargets = (item.citationTargets ?? []).slice(0, 4);
  if (citationTargets.length === 0) return null;
  const result = {
    itemId: item.itemId,
    itemType: item.itemType,
    label: item.label,
    projectId: normalizedProject(item.projectId ?? projectId),
    owner: owner.owner,
    matchClass: found.matchClass,
    score: found.score,
    freshness: owner.state === 'stale' ? 'stale' : item.freshness ?? 'current',
    confidence: item.confidence ?? 'owner',
    provenance: item.provenance ?? owner.owner,
    citationTargets,
  } satisfies RecoverySearchResultV2;
  return utf8JsonBytes(result) <= 4096 ? result : null;
}

function normalizedProject(value: string): string {
  if (!PROJECT_ID.test(value)) throw new Error('owner item has a non-canonical Project ID');
  return value;
}

function resultOrder(left: RecoverySearchResultV2, right: RecoverySearchResultV2): number {
  return (MATCH_PRIORITY[left.matchClass] ?? 99) - (MATCH_PRIORITY[right.matchClass] ?? 99)
    || (OWNER_PRIORITY[left.owner] ?? 99) - (OWNER_PRIORITY[right.owner] ?? 99)
    || (left.freshness === 'current' ? 0 : 1) - (right.freshness === 'current' ? 0 : 1)
    || right.score - left.score
    || left.itemId.localeCompare(right.itemId);
}

function searchInputFingerprint(projectId: string, normalizedQuery: string, normalizedLimit: number): RecoveryFingerprint {
  return fingerprintRecoveryValue({ projectId, query: normalizedQuery, limit: normalizedLimit });
}

function currentOpenLocks(currentOpen: RecoveryOpenResponseV2): RecoveryOwnerLock[] {
  return currentOpen.ownerLocks.map((lock) => ({ ...lock }));
}

export function composeRecoverySearchBasis(input: {
  request: RecoverySearchRequestV2;
  currentOpen: RecoveryOpenResponseV2;
  owners: ProjectOwnerSnapshot[];
}): RecoverySearchedBasisV2 {
  const projectId = normalizedProject(input.request.projectId);
  if (input.currentOpen.stage !== 'open' || input.currentOpen.projectId !== projectId) throw new Error('search requires the current open stage for the request Project');
  if (input.request.openFlowFingerprint !== input.currentOpen.flowFingerprint) throw new Error('search openFlowFingerprint is stale');
  const normalizedQuery = query(input.request.query);
  const normalizedLimit = limit(input.request.limit);
  const snapshots = input.owners.filter((owner) => ['work-os', 'project-memory', 'source-evidence', 'session-record', 'workflow'].includes(owner.owner));
  const results: RecoverySearchResultV2[] = [];
  let omittedItems = 0;
  let omittedCitations = 0;
  for (const owner of snapshots) {
    if (owner.state === 'unavailable') continue;
    for (const item of owner.items) {
      if (item.projectId !== undefined && item.projectId !== projectId) { omittedItems += 1; continue; }
      if ((item.citationTargets ?? []).length === 0) { omittedItems += 1; omittedCitations += 1; continue; }
      const result = safeResult(owner, item, normalizedQuery, projectId);
      if (result) results.push(result);
      else if (match(item, normalizedQuery)) omittedItems += 1;
    }
  }
  results.sort(resultOrder);
  if (results.length > normalizedLimit) omittedItems += results.length - normalizedLimit;
  const boundedResults = results.slice(0, normalizedLimit);
  const ownerLocks = ownerSnapshotLocks(snapshots, currentOpenLocks(input.currentOpen));
  const diagnostics = [
    ...input.currentOpen.diagnostics,
    ...snapshots.flatMap((owner) => owner.diagnostics),
  ].slice(0, 32);
  const omittedDiagnostics = Math.max(0, input.currentOpen.diagnostics.length + snapshots.reduce((sum, owner) => sum + owner.diagnostics.length, 0) - diagnostics.length);
  const actionInputFingerprint = fingerprintRecoveryValue({ action: 'search', projectId, openFlowFingerprint: input.currentOpen.flowFingerprint, query: normalizedQuery, limit: normalizedLimit });
  const payload: RecoverySearchedPayloadV2 = {
    kind: 'searched',
    query: normalizedQuery,
    limit: normalizedLimit,
    searchInputFingerprint: searchInputFingerprint(projectId, normalizedQuery, normalizedLimit),
    searchFingerprint: fingerprintRecoveryValue({ projectId, query: normalizedQuery, limit: normalizedLimit, results: boundedResults, ownerLocks }),
    results: boundedResults,
  };
  const omitted = { items: omittedItems, citations: omittedCitations, diagnostics: omittedDiagnostics, bytes: 0 };
  while (utf8JsonBytes({ payload, diagnostics, omitted }) > 128 * 1024 && payload.results.length > 0) {
    const before = utf8JsonBytes({ payload, diagnostics, omitted });
    payload.results.pop();
    omitted.items += 1;
    omitted.bytes += Math.max(1, before - utf8JsonBytes({ payload, diagnostics, omitted }));
  }
  payload.searchFingerprint = fingerprintRecoveryValue({ projectId, query: normalizedQuery, limit: normalizedLimit, results: payload.results, ownerLocks });
  const intrinsic = {
    schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION,
    stage: 'searched' as const,
    projectId,
    previousFlowFingerprint: input.currentOpen.flowFingerprint,
    actionInputFingerprint,
    recoveryFingerprint: input.currentOpen.recoveryFingerprint,
    ownerLocks,
    payloadFingerprint: fingerprintRecoveryValue(payload),
    nextRequestIntents: [],
    diagnostics,
    omitted,
  };
  return {
    schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION,
    stage: 'searched',
    projectId,
    previousFlowFingerprint: input.currentOpen.flowFingerprint,
    rootOpenFlowFingerprint: input.currentOpen.flowFingerprint,
    actionInputFingerprint,
    recoveryFingerprint: input.currentOpen.recoveryFingerprint,
    ownerLocks,
    payload,
    diagnostics,
    omitted,
    flowFingerprint: fingerprintRecoveryFlowIntrinsicStage(intrinsic),
  };
}

function staleResponse(request: RecoverySearchRequestV2, currentOpen: RecoveryFlowResponseV2, priorOpen?: RecoveryOpenResponseV2): RecoveryFlowResponseV2 {
  const priorFlowFingerprint = request.openFlowFingerprint;
  const changedOwners: RecoveryOwner[] = currentOpen.ownerLocks
    .filter((lock) => !priorOpen || priorOpen.ownerLocks.find((old) => old.owner === lock.owner)?.fingerprint !== lock.fingerprint || priorOpen.ownerLocks.find((old) => old.owner === lock.owner)?.revision !== lock.revision || priorOpen.ownerLocks.find((old) => old.owner === lock.owner)?.state !== lock.state)
    .map((lock) => lock.owner);
  const proofWithoutFingerprint = {
    schemaVersion: 'project-hub-recovery-stale-proof/v2' as const,
    projectId: request.projectId,
    rootOpenFlowFingerprint: currentOpen.flowFingerprint,
    priorFlowFingerprint,
    priorActionInputFingerprint: fingerprintRecoveryValue({ action: 'search', projectId: request.projectId, openFlowFingerprint: priorFlowFingerprint }),
    recoveryFingerprint: currentOpen.recoveryFingerprint,
    changedOwners: changedOwners.length > 0 ? changedOwners : ['project'],
    citationTargets: currentOpen.stage === 'open' ? currentOpen.payload.citations.slice(0, 32) : [],
  };
  const proof: RecoveryStaleProofV2 = { ...proofWithoutFingerprint, changedOwners: proofWithoutFingerprint.changedOwners as RecoveryOwner[], fingerprint: fingerprintRecoveryValue(proofWithoutFingerprint) };
  const diagnostics = [...currentOpen.diagnostics, diagnostic('project', 'search_open_stale', 'The open Project changed before search completed.', 'Open the Project again before searching.')].slice(0, 32);
  const omitted = { items: 0, citations: 0, diagnostics: Math.max(0, currentOpen.diagnostics.length + 1 - diagnostics.length), bytes: 0 };
  const actionInputFingerprint = proof.priorActionInputFingerprint;
  const intents = [{ action: 'restart' as const, staleProof: proof }];
  const intrinsic = {
    schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION,
    stage: 'stale' as const,
    projectId: request.projectId,
    previousFlowFingerprint: priorFlowFingerprint,
    actionInputFingerprint,
    recoveryFingerprint: currentOpen.recoveryFingerprint,
    ownerLocks: currentOpen.ownerLocks,
    payloadFingerprint: fingerprintRecoveryValue(proof),
    nextRequestIntents: intents,
    diagnostics,
    omitted,
  };
  const flowFingerprint = fingerprintRecoveryFlowIntrinsicStage(intrinsic);
  const response = {
    schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION,
    stage: 'stale' as const,
    projectId: request.projectId,
    previousFlowFingerprint: priorFlowFingerprint,
    actionInputFingerprint,
    recoveryFingerprint: currentOpen.recoveryFingerprint,
    ownerLocks: currentOpen.ownerLocks,
    payload: proof,
    nextRequestIntents: intents,
    diagnostics,
    omitted,
    rootOpenFlowFingerprint: currentOpen.flowFingerprint,
    nextRequests: [{ schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION, projectId: request.projectId, action: 'restart' as const, staleProof: proof }],
    generatedAt: currentOpen.generatedAt,
    flowFingerprint: fingerprintRecoveryFlowIntrinsicStage(intrinsic),
  } as RecoveryFlowResponseV2;
  return validateRecoveryFlowResponseV2(response);
}

export async function searchRecovery(input: RecoverySearchInput): Promise<RecoveryFlowResponseV2> {
  const { request, dependencies } = input;
  const projectId = normalizedProject(request.projectId);
  const normalizedRequest: RecoverySearchRequestV2 = {
    schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
    projectId,
    action: 'search',
    openFlowFingerprint: request.openFlowFingerprint,
    query: query(request.query),
    limit: limit(request.limit),
  };
  const generatedAt = new Date(dependencies.now ? dependencies.now() : Date.now()).toISOString();
  const currentOpen = await composeRecoveryOpenStage(projectId, dependencies.openOwners, generatedAt);
  if (currentOpen.stage !== 'open' || currentOpen.flowFingerprint !== normalizedRequest.openFlowFingerprint) return staleResponse(normalizedRequest, currentOpen, dependencies.currentOpen);
  if (dependencies.currentOpen && dependencies.currentOpen.flowFingerprint !== currentOpen.flowFingerprint) return staleResponse(normalizedRequest, currentOpen, dependencies.currentOpen);
  const source = dependencies.searchSource ?? createProjectSearchSource({});
  const owners = await source.snapshot(projectId);
  const basis = composeRecoverySearchBasis({ request: normalizedRequest, currentOpen, owners });
  const bindings = dependencies.agentSelection
    ? await dependencies.agentSelection.listCompatible(projectId, currentOpen.payload.capabilities ?? [])
    : [];
  const searchResult = basis.payload.results[0] ?? {
    itemId: `${projectId}/issue/${currentOpen.payload.workItemId?.split('/').at(-1) ?? 'current'}`,
    itemType: 'work-item', label: currentOpen.payload.workItemId ?? projectId, projectId,
    owner: 'work-os' as const, matchClass: 'none', score: 0, freshness: 'current', confidence: 'owner', provenance: 'work-os', citationTargets: currentOpen.payload.citations.slice(0, 1),
  };
  const candidateStage = composeRecoveryCandidates({ open: currentOpen, search: searchResult, compatibleBindings: bindings });
  if (candidateStage.reason) {
    const payload = { kind: 'unavailable' as const, reason: candidateStage.reason, remediation: candidateStage.remediation ?? 'Repair recovery owners and retry.' };
    const intrinsic = {
      schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION, stage: 'unavailable' as const, projectId,
      previousFlowFingerprint: currentOpen.flowFingerprint,
      actionInputFingerprint: basis.actionInputFingerprint,
      recoveryFingerprint: currentOpen.recoveryFingerprint,
      ownerLocks: basis.ownerLocks,
      payloadFingerprint: fingerprintRecoveryValue(payload), nextRequestIntents: [], diagnostics: basis.diagnostics, omitted: basis.omitted,
    };
    return validateRecoveryFlowResponseV2({ ...responseFields(intrinsic), payload, rootOpenFlowFingerprint: currentOpen.rootOpenFlowFingerprint, nextRequests: [], generatedAt, flowFingerprint: fingerprintRecoveryFlowIntrinsicStage(intrinsic) } as RecoveryFlowResponseV2);
  }
  if (bindings.length > 1) {
    const payload = { kind: 'needs-agent-selection' as const, candidates: candidateStage.candidates.map((candidate) => candidate.candidateId), bindings: candidateStage.bindings };
    const intrinsic = {
      schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION, stage: 'needs-agent-selection' as const, projectId,
      previousFlowFingerprint: currentOpen.flowFingerprint, actionInputFingerprint: basis.actionInputFingerprint,
      recoveryFingerprint: currentOpen.recoveryFingerprint, ownerLocks: basis.ownerLocks,
      payloadFingerprint: fingerprintRecoveryValue(payload), nextRequestIntents: [], diagnostics: basis.diagnostics, omitted: basis.omitted,
    };
    return validateRecoveryFlowResponseV2({ ...responseFields(intrinsic), payload, rootOpenFlowFingerprint: currentOpen.flowFingerprint, nextRequests: [], generatedAt, flowFingerprint: fingerprintRecoveryFlowIntrinsicStage(intrinsic) } as RecoveryFlowResponseV2);
  }
  const searchedPayload = applyCandidateStageToSearch(basis.payload, candidateStage);
  const selected = candidateStage.bindings[0]!;
  const intents = [{ action: 'plan' as const, mode: 'from-search' as const, query: searchedPayload.query, limit: searchedPayload.limit, candidateId: candidateStage.recommendedCandidateId!, agentSelection: { bindingId: selected.bindingId, bindingRevision: selected.bindingRevision }, priorPlan: null }];
  const intrinsic = {
    schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION, stage: 'searched' as const, projectId,
    previousFlowFingerprint: currentOpen.flowFingerprint, actionInputFingerprint: basis.actionInputFingerprint,
    recoveryFingerprint: currentOpen.recoveryFingerprint, ownerLocks: basis.ownerLocks,
    payloadFingerprint: fingerprintRecoveryValue(searchedPayload), nextRequestIntents: intents, diagnostics: basis.diagnostics, omitted: basis.omitted,
  };
  const flowFingerprint = fingerprintRecoveryFlowIntrinsicStage(intrinsic);
  const response = {
    ...responseFields(intrinsic),
    payload: searchedPayload,
    rootOpenFlowFingerprint: currentOpen.flowFingerprint,
    nextRequests: [{ schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION, projectId, action: 'plan' as const, mode: 'from-search' as const, openFlowFingerprint: currentOpen.flowFingerprint, searchedBasisFlowFingerprint: flowFingerprint, plannedFlowFingerprint: null, query: searchedPayload.query, limit: searchedPayload.limit, candidateId: candidateStage.recommendedCandidateId!, agentSelection: { bindingId: selected.bindingId, bindingRevision: selected.bindingRevision }, priorPlan: null }], generatedAt,
    flowFingerprint,
  } as RecoveryFlowResponseV2;
  return validateRecoveryFlowResponseV2(response);
}

export const composeRecoverySearch = searchRecovery;
