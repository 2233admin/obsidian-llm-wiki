import { fingerprintRecoveryValue } from './contract-support.js';
import {
  type RecoveryCandidateStageV2,
  type RecoveryCandidateV2,
  type RecoveryCompatibleBindingV2,
  type RecoveryFlowResponseV2,
  type RecoverySearchResultV2,
  type RecoverySearchedPayloadV2,
} from './recovery-flow.js';
import { fingerprintCompatibleBindings } from './agent-selection.js';

const unavailable = (reason: string, remediation: string, bindings: RecoveryCompatibleBindingV2[] = []): RecoveryCandidateStageV2 => ({
  candidates: [],
  recommendedCandidateId: null,
  candidateSetFingerprint: fingerprintRecoveryValue({ candidates: [], bindings, reason }),
  bindings,
  reason,
  remediation,
});

function candidateFromOpen(open: RecoveryFlowResponseV2, searched: RecoverySearchResultV2 | RecoverySearchResultV2[]): RecoveryCandidateV2[] {
  if (open.stage !== 'open') return [];
  const payload = open.payload;
  if (!payload.workItemId || payload.contextSource === 'none') return [];
  if (payload.workRunId) {
    const results = Array.isArray(searched) ? searched : [searched];
    const candidates: RecoveryCandidateV2[] = [{ candidateId: `resume:${payload.workRunId}`, kind: 'resume', workItemId: payload.workItemId, workRunId: payload.workRunId, contextSource: 'work-run', recommended: true }];
    for (const result of results) {
      if (result.projectId !== open.projectId || result.owner !== 'workflow' || result.itemType !== 'work-run' || result.freshness !== 'current' || !/^work-run\/[a-z0-9][a-z0-9-]*$/u.test(result.itemId)) continue;
      if (candidates.some((candidate) => candidate.workRunId === result.itemId)) continue;
      candidates.push({ candidateId: `resume:${result.itemId}`, kind: 'resume', workItemId: payload.workItemId, workRunId: result.itemId, contextSource: 'work-run', recommended: false });
      if (candidates.length === 3) break;
    }
    return candidates;
  }
  const current = payload.workGroups?.inProgress.find((item) => item.entity === payload.workItemId)
    ?? payload.workGroups?.notStarted.find((item) => item.entity === payload.workItemId);
  if (!current || current.blockedBy.length > 0 || payload.contextSource !== 'session-record') return [];
  return [{ candidateId: `create:${payload.workItemId}`, kind: 'create', workItemId: payload.workItemId, workRunId: null, contextSource: 'session-record', recommended: true }];
}

export function composeRecoveryCandidates(input: {
  open: RecoveryFlowResponseV2;
  search: RecoverySearchResultV2 | RecoverySearchResultV2[];
  compatibleBindings: Array<{
    role: string;
    bindingId: string;
    bindingRevision: number;
    profileId: string;
    profileRevision: number;
  }>;
}): RecoveryCandidateStageV2 {
  const candidates = candidateFromOpen(input.open, input.search).slice(0, 3);
  const capabilities = input.open.stage === 'open'
    ? (input.open.payload.capabilities ?? []).map(({ capability, state }) => ({ capability, state }))
    : [];
  const projectId = input.open.projectId;
  // The Agent Domain source already returns the validated closed binding tuple;
  // re-normalizing it here would discard valid tuples that intentionally omit
  // owner-only fields such as Project ID and raw capability claims.
  const bindings = [...input.compatibleBindings].sort((left, right) => left.bindingId.localeCompare(right.bindingId) || left.bindingRevision - right.bindingRevision);
  if (candidates.length === 0) return unavailable('no_safe_candidate', 'Repair the current unblocked Work Item and safe Session/Work Run context before retrying recovery.', bindings);
  if (!capabilities.some(({ capability, state }) => capability === 'workflow.recovery.plan' && state === 'available')) return unavailable('capability_unavailable', 'Restore the workflow.recovery.plan capability before retrying recovery.', bindings);
  if (bindings.length === 0) return unavailable('no_compatible_binding', 'Create or enable one current Project Agent Binding with a current Profile and required capabilities.', bindings);
  if (bindings.length > 16) return unavailable('binding_selection_too_large', 'Reduce compatible Project Agent Bindings to at most sixteen before retrying recovery.', bindings);
  const candidateSetFingerprint = fingerprintRecoveryValue({
    candidates,
    search: (Array.isArray(input.search) ? input.search : [input.search]).map((item) => ({ itemId: item.itemId, citationTargets: item.citationTargets })),
    bindings: fingerprintCompatibleBindings(bindings),
  });
  return {
    candidates,
    recommendedCandidateId: candidates[0]?.candidateId ?? null,
    candidateSetFingerprint,
    bindings,
  };
}

export function applyCandidateStageToSearch(
  searched: RecoverySearchedPayloadV2,
  stage: RecoveryCandidateStageV2,
): RecoverySearchedPayloadV2 {
  return {
    ...searched,
    ...(stage.candidates.length > 0 ? { candidates: stage.candidates, recommendedCandidateId: stage.recommendedCandidateId, candidateSetFingerprint: stage.candidateSetFingerprint } : {}),
    ...(stage.bindings.length > 0 ? { bindings: stage.bindings } : {}),
  };
}

export function candidateUnavailableReason(stage: RecoveryCandidateStageV2): string | null {
  return stage.reason ?? null;
}
