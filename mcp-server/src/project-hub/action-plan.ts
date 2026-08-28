import {
  canonicalRecoveryJson,
  fingerprintRecoveryValue,
  safeRecoveryText,
  type RecoveryFingerprint,
} from './contract-support.js';
import {
  fingerprintRecoveryFlowIntrinsicStage,
  RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
  RECOVERY_FLOW_SCHEMA_VERSION,
  RECOVERY_STALE_PROOF_SCHEMA_VERSION,
  validateRecoveryFlowResponseV2,
  validateRecoveryPlanV2,
  type RecoveryFlowDiagnosticV2,
  type RecoveryFlowResponseV2,
  type RecoveryOwner,
  type RecoveryOwnerLock,
  type RecoveryPlanFromSearchRequestV2,
  type RecoveryPlanOverrideRequestV2,
  type RecoveryRefreshPlanRequestV2,
  type RecoveryPlanV2,
  type RecoveryPlannedResponseV2,
  type RecoverySearchRequestV2,
  type RecoverySearchedPayloadV2,
} from './recovery-flow.js';
import { composeRecoveryOpenStage, type RecoveryOpenOwners } from './recovery-open.js';
import { composeRecoverySearchBasis } from './search.js';
import { createProjectSearchSource, type ProjectSearchSource } from './search-source.js';
import { composeRecoveryCandidates } from './action-candidates.js';
import type { RecoveryAgentSelectionSource } from './agent-selection.js';

export interface RecoveryPlanDependencies {
  openOwners: RecoveryOpenOwners;
  searchSource?: ProjectSearchSource;
  agentSelection?: RecoveryAgentSelectionSource;
  now?: () => number;
  currentPlanned?: RecoveryPlannedResponseV2;
}

const ownerOrder: readonly RecoveryOwner[] = ['project', 'work-os', 'workflow', 'project-memory', 'session-record', 'source-evidence', 'agent-domain', 'settings'];
const diag = (owner: RecoveryOwner, code: string, message: string, remediation: string, severity: RecoveryFlowDiagnosticV2['severity'] = 'error'): RecoveryFlowDiagnosticV2 => ({ owner, code, severity, message, remediation, citationTargets: [] });
const responseFields = (intrinsic: Record<string, unknown>) => { const { payloadFingerprint: _payloadFingerprint, ...fields } = intrinsic; return fields; };

function stale(
  projectId: string,
  priorFlowFingerprint: RecoveryFingerprint,
  current: RecoveryFlowResponseV2,
  changedOwners: RecoveryOwner[],
  generatedAt: string,
): RecoveryFlowResponseV2 {
  const proofBase = {
    schemaVersion: RECOVERY_STALE_PROOF_SCHEMA_VERSION,
    projectId,
    rootOpenFlowFingerprint: current.rootOpenFlowFingerprint,
    priorFlowFingerprint,
    priorActionInputFingerprint: fingerprintRecoveryValue({ action: 'plan', projectId, priorFlowFingerprint }),
    recoveryFingerprint: current.recoveryFingerprint,
    changedOwners: (changedOwners.length ? changedOwners : ['project']) as RecoveryOwner[],
    citationTargets: current.stage === 'open' ? current.payload.citations.slice(0, 32) : [],
  };
  const proof = { ...proofBase, fingerprint: fingerprintRecoveryValue(proofBase) };
  const intents = [{ action: 'restart' as const, staleProof: proof }];
  const intrinsic = {
    schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION, stage: 'stale' as const, projectId,
    previousFlowFingerprint: priorFlowFingerprint, actionInputFingerprint: proof.priorActionInputFingerprint,
    recoveryFingerprint: current.recoveryFingerprint, ownerLocks: current.ownerLocks,
    payloadFingerprint: fingerprintRecoveryValue(proof), nextRequestIntents: intents,
    diagnostics: [diag('project', 'recovery_plan_stale', 'A prerequisite changed before planning completed.', 'Restart recovery from the current Project owners.')],
    omitted: { items: 0, citations: 0, diagnostics: 0, bytes: 0 },
  };
  const flowFingerprint = fingerprintRecoveryFlowIntrinsicStage(intrinsic);
  return validateRecoveryFlowResponseV2({ ...responseFields(intrinsic), payload: proof, rootOpenFlowFingerprint: current.rootOpenFlowFingerprint, nextRequests: [{ schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION, projectId, action: 'restart', staleProof: proof }], generatedAt, flowFingerprint } as RecoveryFlowResponseV2);
}

function changedOwners(before: RecoveryOwnerLock[], after: RecoveryOwnerLock[]): RecoveryOwner[] {
  return ownerOrder.filter((owner) => {
    const left = before.find((lock) => lock.owner === owner);
    const right = after.find((lock) => lock.owner === owner);
    return canonicalRecoveryJson(left ?? null) !== canonicalRecoveryJson(right ?? null);
  });
}

async function recompute(request: RecoverySearchRequestV2, dependencies: RecoveryPlanDependencies, generatedAt: string) {
  const open = await composeRecoveryOpenStage(request.projectId, dependencies.openOwners, generatedAt);
  if (open.stage !== 'open') return { open, searched: null, basis: null, candidates: null };
  const source = dependencies.searchSource ?? createProjectSearchSource({});
  const owners = await source.snapshot(request.projectId);
  const basis = composeRecoverySearchBasis({ request, currentOpen: open, owners });
  const bindings = dependencies.agentSelection ? await dependencies.agentSelection.listCompatible(request.projectId, open.payload.capabilities ?? []) : [];
  const search = basis.payload.results[0] ?? {
    itemId: `${request.projectId}/issue/${open.payload.workItemId?.split('/').at(-1) ?? 'current'}`,
    itemType: 'work-item', label: open.payload.workItemId ?? request.projectId, projectId: request.projectId,
    owner: 'work-os' as const, matchClass: 'none', score: 0, freshness: 'current', confidence: 'owner', provenance: 'work-os', citationTargets: open.payload.citations.slice(0, 1),
  };
  const candidates = composeRecoveryCandidates({ open, search: basis.payload.results.length ? basis.payload.results : search, compatibleBindings: bindings });
  return { open, searched: basis, basis, candidates };
}

function searchedFingerprint(basis: ReturnType<typeof composeRecoverySearchBasis>, candidateStage: NonNullable<Awaited<ReturnType<typeof recompute>>['candidates']>): RecoveryFingerprint {
  const payload: RecoverySearchedPayloadV2 = {
    ...basis.payload,
    ...(candidateStage.candidates.length ? { candidates: candidateStage.candidates, recommendedCandidateId: candidateStage.recommendedCandidateId, candidateSetFingerprint: candidateStage.candidateSetFingerprint } : {}),
    ...(candidateStage.bindings.length ? { bindings: candidateStage.bindings } : {}),
  };
  if (candidateStage.bindings.length > 1) {
    const payload = { kind: 'needs-agent-selection' as const, candidates: candidateStage.candidates.map((candidate) => candidate.candidateId), bindings: candidateStage.bindings };
    return fingerprintRecoveryFlowIntrinsicStage({ schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION, stage: 'needs-agent-selection', projectId: basis.projectId, previousFlowFingerprint: basis.previousFlowFingerprint, actionInputFingerprint: basis.actionInputFingerprint, recoveryFingerprint: basis.recoveryFingerprint, ownerLocks: basis.ownerLocks, payloadFingerprint: fingerprintRecoveryValue(payload), nextRequestIntents: [], diagnostics: basis.diagnostics, omitted: basis.omitted });
  }
  const intents = candidateStage.bindings.length === 1 && candidateStage.candidates.length === 1
    ? [{ action: 'plan' as const, mode: 'from-search' as const, query: payload.query, limit: payload.limit, candidateId: candidateStage.candidates[0]!.candidateId, agentSelection: { bindingId: candidateStage.bindings[0]!.bindingId, bindingRevision: candidateStage.bindings[0]!.bindingRevision }, priorPlan: null }]
    : [];
  return fingerprintRecoveryFlowIntrinsicStage({ schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION, stage: 'searched', projectId: basis.projectId, previousFlowFingerprint: basis.previousFlowFingerprint, actionInputFingerprint: basis.actionInputFingerprint, recoveryFingerprint: basis.recoveryFingerprint, ownerLocks: basis.ownerLocks, payloadFingerprint: fingerprintRecoveryValue(payload), nextRequestIntents: intents, diagnostics: basis.diagnostics, omitted: basis.omitted });
}

function planFromCandidate(request: RecoveryPlanFromSearchRequestV2 | RecoveryPlanOverrideRequestV2 | RecoveryRefreshPlanRequestV2, current: Awaited<ReturnType<typeof recompute>>, candidateId: string, selection: { bindingId: string; bindingRevision: number }, now: number): RecoveryPlanV2 | null {
  if (!current.open || current.open.stage !== 'open' || !current.basis || !current.candidates || current.candidates.reason) return null;
  const candidate = current.candidates.candidates.find((item) => item.candidateId === candidateId);
  const binding = current.candidates.bindings.find((item) => item.bindingId === selection.bindingId && item.bindingRevision === selection.bindingRevision);
  if (!candidate || !binding) return null;
  const payload = current.basis.payload;
  const createdAt = new Date(now).toISOString();
  const planWithoutFingerprint = {
    schemaVersion: 'project-hub-recovery-plan/v2' as const,
    projectId: request.projectId,
    rootOpenFlowFingerprint: current.open.flowFingerprint,
    searchedBasisFlowFingerprint: request.searchedBasisFlowFingerprint,
    recoveryFingerprint: current.open.recoveryFingerprint,
    searchInputFingerprint: payload.searchInputFingerprint,
    searchFingerprint: payload.searchFingerprint,
    candidateSetFingerprint: current.candidates.candidateSetFingerprint,
    candidateId: candidate.candidateId,
    kind: candidate.kind,
    workItemId: candidate.workItemId,
    workRunId: candidate.workRunId,
    agentSelection: binding,
    ownerLocks: current.basis.ownerLocks,
    capabilityFacts: current.open.payload.capabilities ?? [],
    citationTargets: [...new Set([...current.open.payload.citations, ...payload.results.flatMap((result) => result.citationTargets)])].slice(0, 32),
    owningOperation: 'workflow.recovery.apply' as const,
    createdAt,
    expiresAt: new Date(now + 300000).toISOString(),
    leaseDurationMs: candidate.kind === 'resume' ? 0 as const : 900000 as const,
  };
  if (planWithoutFingerprint.citationTargets.length === 0) return null;
  return validateRecoveryPlanV2({ ...planWithoutFingerprint, fingerprint: fingerprintRecoveryValue(planWithoutFingerprint) });
}

function planMatchesCurrent(plan: RecoveryPlanV2, current: Awaited<ReturnType<typeof recompute>>): boolean {
  if (!current.open || current.open.stage !== 'open' || !current.basis || !current.candidates || current.candidates.reason) return false;
  const candidate = current.candidates.candidates.find((item) => item.candidateId === plan.candidateId);
  const binding = current.candidates.bindings.find((item) => item.bindingId === plan.agentSelection.bindingId && item.bindingRevision === plan.agentSelection.bindingRevision);
  const citations = [...new Set([...current.open.payload.citations, ...current.basis.payload.results.flatMap((result) => result.citationTargets)])].slice(0, 32);
  return plan.projectId === current.open.projectId
    && plan.rootOpenFlowFingerprint === current.open.flowFingerprint
    && plan.recoveryFingerprint === current.open.recoveryFingerprint
    && plan.searchedBasisFlowFingerprint === searchedFingerprint(current.basis, current.candidates)
    && plan.searchInputFingerprint === current.basis.payload.searchInputFingerprint
    && plan.searchFingerprint === current.basis.payload.searchFingerprint
    && plan.candidateSetFingerprint === current.candidates.candidateSetFingerprint
    && canonicalRecoveryJson(plan.ownerLocks) === canonicalRecoveryJson(current.basis.ownerLocks)
    && canonicalRecoveryJson(plan.capabilityFacts) === canonicalRecoveryJson(current.open.payload.capabilities ?? [])
    && canonicalRecoveryJson(plan.citationTargets) === canonicalRecoveryJson(citations)
    && candidate !== undefined
    && plan.kind === candidate.kind
    && plan.workItemId === candidate.workItemId
    && plan.workRunId === candidate.workRunId
    && binding !== undefined
    && canonicalRecoveryJson(plan.agentSelection) === canonicalRecoveryJson(binding);
}

function plannedResponse(plan: RecoveryPlanV2, current: Awaited<ReturnType<typeof recompute>>, generatedAt: string): RecoveryPlannedResponseV2 {
  const candidates = current.candidates?.candidates.map((candidate) => candidate.candidateId) ?? [plan.candidateId];
  const refresh = { action: 'refresh-plan' as const, query: current.basis!.payload.query, limit: current.basis!.payload.limit, priorPlan: plan };
  const overrides = (current.candidates?.candidates ?? [])
    .filter((candidate) => candidate.candidateId !== plan.candidateId)
    .map((candidate) => ({ action: 'plan' as const, mode: 'override' as const, query: refresh.query, limit: refresh.limit, candidateId: candidate.candidateId, agentSelection: current.candidates!.bindings[0] ? { bindingId: current.candidates!.bindings[0].bindingId, bindingRevision: current.candidates!.bindings[0].bindingRevision } : { bindingId: plan.agentSelection.bindingId, bindingRevision: plan.agentSelection.bindingRevision }, priorPlan: plan }));
  const intents = [...overrides, refresh];
  const intrinsic = {
    schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION, stage: 'planned' as const, projectId: plan.projectId,
    previousFlowFingerprint: plan.searchedBasisFlowFingerprint, actionInputFingerprint: fingerprintRecoveryValue({ action: 'plan', projectId: plan.projectId, candidateId: plan.candidateId }), recoveryFingerprint: plan.recoveryFingerprint,
    ownerLocks: plan.ownerLocks, payloadFingerprint: fingerprintRecoveryValue({ kind: 'planned', plan, candidates }),
    nextRequestIntents: intents, diagnostics: [], omitted: { items: 0, citations: 0, diagnostics: 0, bytes: 0 },
  };
  const flowFingerprint = fingerprintRecoveryFlowIntrinsicStage(intrinsic);
  const response = {
    ...responseFields(intrinsic),
    payload: { kind: 'planned' as const, plan, candidates },
    rootOpenFlowFingerprint: plan.rootOpenFlowFingerprint,
    nextRequests: [
      ...overrides.map((intent) => ({ schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION, projectId: plan.projectId, action: 'plan' as const, mode: 'override' as const, openFlowFingerprint: plan.rootOpenFlowFingerprint, searchedBasisFlowFingerprint: plan.searchedBasisFlowFingerprint, plannedFlowFingerprint: flowFingerprint, query: intent.query, limit: intent.limit, candidateId: intent.candidateId, agentSelection: intent.agentSelection, priorPlan: plan })),
      { schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION, projectId: plan.projectId, action: 'refresh-plan' as const, openFlowFingerprint: plan.rootOpenFlowFingerprint, searchedBasisFlowFingerprint: plan.searchedBasisFlowFingerprint, plannedFlowFingerprint: flowFingerprint, query: refresh.query, limit: refresh.limit, priorPlan: plan },
    ],
    generatedAt, flowFingerprint,
  } as RecoveryPlannedResponseV2;
  return validateRecoveryFlowResponseV2(response) as RecoveryPlannedResponseV2;
}

export async function composeRecoveryPlannedStage(
  request: RecoveryPlanFromSearchRequestV2 | RecoveryPlanOverrideRequestV2 | RecoveryRefreshPlanRequestV2,
  dependencies: RecoveryPlanDependencies,
): Promise<RecoveryPlannedResponseV2 | RecoveryFlowResponseV2> {
  const now = dependencies.now?.() ?? Date.now();
  const generatedAt = new Date(now).toISOString();
  const searchRequest: RecoverySearchRequestV2 = { schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION, projectId: request.projectId, action: 'search', openFlowFingerprint: request.openFlowFingerprint, query: request.query, limit: request.limit };
  const current = await recompute(searchRequest, dependencies, generatedAt);
  if (!current.open || current.open.stage !== 'open') return current.open;
  if (current.open.flowFingerprint !== request.openFlowFingerprint || !current.basis || !current.candidates) return stale(request.projectId, request.plannedFlowFingerprint ?? request.searchedBasisFlowFingerprint, current.open, changedOwners(dependencies.currentPlanned?.ownerLocks ?? [], current.open.ownerLocks), generatedAt);
  const basisFlow = searchedFingerprint(current.basis, current.candidates);
  if (request.searchedBasisFlowFingerprint !== basisFlow) return stale(request.projectId, request.plannedFlowFingerprint ?? request.searchedBasisFlowFingerprint, current.open, ['work-os', 'workflow', 'project-memory', 'session-record', 'source-evidence'], generatedAt);
  if (request.action === 'plan' && request.mode === 'from-search' && (request.plannedFlowFingerprint !== null || request.priorPlan !== null)) throw new Error('from-search requires null plannedFlowFingerprint and priorPlan');
  if (request.action === 'plan' && request.mode === 'override' || request.action === 'refresh-plan') {
    const priorPlan = request.priorPlan;
    if (!planMatchesCurrent(priorPlan, current)) {
      const changed = changedOwners(priorPlan.ownerLocks, current.basis.ownerLocks);
      return stale(request.projectId, request.plannedFlowFingerprint, current.open, changed.length ? changed : [...ownerOrder], generatedAt);
    }
  }
  if (request.action === 'plan' && request.mode === 'override') {
    const reconstructed = plannedResponse(request.priorPlan, current, request.priorPlan.createdAt);
    if (reconstructed.flowFingerprint !== request.plannedFlowFingerprint || dependencies.currentPlanned && dependencies.currentPlanned.flowFingerprint !== request.plannedFlowFingerprint) return stale(request.projectId, request.plannedFlowFingerprint, current.open, ['workflow'], generatedAt);
    if (Date.parse(request.priorPlan.expiresAt) <= now) return unavailableResponse(request.projectId, request.openFlowFingerprint, current.open, 'plan_expired', 'Refresh the expired Plan explicitly before replacing its candidate.', generatedAt);
  }
  if (request.action === 'refresh-plan') {
    const reconstructed = plannedResponse(request.priorPlan, current, request.priorPlan.createdAt);
    if (reconstructed.flowFingerprint !== request.plannedFlowFingerprint || dependencies.currentPlanned && dependencies.currentPlanned.flowFingerprint !== request.plannedFlowFingerprint) return stale(request.projectId, request.plannedFlowFingerprint, current.open, ['workflow'], generatedAt);
  }
  const selectedCandidate = request.action === 'refresh-plan' ? request.priorPlan.candidateId : request.candidateId;
  const selection = request.action === 'refresh-plan' ? { bindingId: request.priorPlan.agentSelection.bindingId, bindingRevision: request.priorPlan.agentSelection.bindingRevision } : request.agentSelection;
  const plan = planFromCandidate(request, current, selectedCandidate, selection, now);
  if (!plan) return unavailableResponse(request.projectId, request.openFlowFingerprint, current.open, 'binding_or_candidate_unavailable', 'Choose a current compatible candidate and exact Binding/Profile revision.', generatedAt);
  return plannedResponse(plan, current, generatedAt);
}

function unavailableResponse(projectId: string, previousFlowFingerprint: RecoveryFingerprint, open: Extract<RecoveryFlowResponseV2, { stage: 'open' }>, reason: string, remediation: string, generatedAt: string): RecoveryFlowResponseV2 {
  const payload = { kind: 'unavailable' as const, reason: safeRecoveryText(reason, 'reason', { minBytes: 1, maxBytes: 128 }), remediation: safeRecoveryText(remediation, 'remediation', { minBytes: 1, maxBytes: 1024 }) };
  const intrinsic = { schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION, stage: 'unavailable' as const, projectId, previousFlowFingerprint, actionInputFingerprint: fingerprintRecoveryValue({ action: 'plan', projectId, previousFlowFingerprint }), recoveryFingerprint: open.recoveryFingerprint, ownerLocks: open.ownerLocks, payloadFingerprint: fingerprintRecoveryValue(payload), nextRequestIntents: [], diagnostics: [diag('agent-domain', reason, remediation, remediation)], omitted: { items: 0, citations: 0, diagnostics: 0, bytes: 0 } };
  return validateRecoveryFlowResponseV2({ ...responseFields(intrinsic), payload, rootOpenFlowFingerprint: open.rootOpenFlowFingerprint, nextRequests: [], generatedAt, flowFingerprint: fingerprintRecoveryFlowIntrinsicStage(intrinsic) } as RecoveryFlowResponseV2);
}
