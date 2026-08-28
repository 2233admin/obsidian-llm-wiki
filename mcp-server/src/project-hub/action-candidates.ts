import { fingerprintRecoveryValue } from './contract-support.js';
import {
  type RecoveryCandidateStageV2,
  type RecoveryCandidateV2,
  type RecoveryCompatibleBindingV2,
  type RecoveryFlowResponseV2,
  type RecoverySearchResultV2,
  type RecoverySearchedPayloadV2,
} from './recovery-flow.js';
import { fingerprintCompatibleBindings, normalizeCompatibleBindings } from './agent-selection.js';

const unavailable = (reason: string, remediation: string, bindings: RecoveryCompatibleBindingV2[] = []): RecoveryCandidateStageV2 => ({
  candidates: [],
  recommendedCandidateId: null,
  candidateSetFingerprint: fingerprintRecoveryValue({ candidates: [], bindings, reason }),
  bindings,
  reason,
  remediation,
});

function candidateFromOpen(open: RecoveryFlowResponseV2): RecoveryCandidateV2[] {
  if (open.stage !== 'open') return [];
  const payload = open.payload;
  if (!payload.workItemId || payload.contextSource === 'none') return [];
  if (payload.workRunId) {
    return [{ candidateId: `resume:${payload.workRunId}`, kind: 'resume', workItemId: payload.workItemId, workRunId: payload.workRunId, contextSource: 'work-run', recommended: true }];
  }
  const current = payload.workGroups?.inProgress.find((item) => item.entity === payload.workItemId)
    ?? payload.workGroups?.notStarted.find((item) => item.entity === payload.workItemId);
  if (!current || current.blockedBy.length > 0 || payload.contextSource !== 'session-record') return [];
  return [{ candidateId: `create:${payload.workItemId}`, kind: 'create', workItemId: payload.workItemId, workRunId: null, contextSource: 'session-record', recommended: true }];
}

export function composeRecoveryCandidates(input: {
  open: RecoveryFlowResponseV2;
  search: RecoverySearchResultV2;
  compatibleBindings: Array<{
    role: string;
    bindingId: string;
    bindingRevision: number;
    profileId: string;
    profileRevision: number;
  }>;
}): RecoveryCandidateStageV2 {
  const candidates = candidateFromOpen(input.open).slice(0, 3);
  const capabilities = input.open.stage === 'open'
    ? (input.open.payload.capabilities ?? []).map(({ capability, state }) => ({ capability, state }))
    : [];
  const projectId = input.open.projectId;
  const bindings = normalizeCompatibleBindings(projectId, capabilities, input.compatibleBindings);
  if (candidates.length === 0) return unavailable('no_safe_candidate', 'Repair the current unblocked Work Item and safe Session/Work Run context before retrying recovery.', bindings);
  if (bindings.length === 0) return unavailable('no_compatible_binding', 'Create or enable one current Project Agent Binding with a current Profile and required capabilities.', bindings);
  if (bindings.length > 16) return unavailable('binding_selection_too_large', 'Reduce compatible Project Agent Bindings to at most sixteen before retrying recovery.', bindings);
  const candidateSetFingerprint = fingerprintRecoveryValue({
    candidates,
    search: { itemId: input.search.itemId, citationTargets: input.search.citationTargets },
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
