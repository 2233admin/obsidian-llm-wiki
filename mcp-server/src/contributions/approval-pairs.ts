import type {
  ConfirmationRequest,
  ConfirmationTokenPort,
  ContributionAction,
  Sha256Digest,
} from './contracts.js';
import { assertSha256, sha256 } from './fingerprint.js';

export interface UiWorkRunApprovalGrant {
  schemaVersion: 1;
  approved: true;
  workRunId: string;
  projectId: `project/${string}`;
  observationId: string;
  actor: string;
  planFingerprint: Sha256Digest;
  action: ContributionAction;
  approvalTokenDigest: Sha256Digest;
  transitionTokenDigest: Sha256Digest;
  expiresAt: string;
}

export interface UiWorkRunApprovalPairPort {
  findByApprovalTokenDigest(
    approvalTokenDigest: Sha256Digest,
  ): Promise<Readonly<UiWorkRunApprovalGrant> | undefined>
    | Readonly<UiWorkRunApprovalGrant>
    | undefined;
}

function validBounded(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function validGrant(value: unknown): value is UiWorkRunApprovalGrant {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const allowed = new Set([
    'schemaVersion',
    'approved',
    'workRunId',
    'projectId',
    'observationId',
    'actor',
    'planFingerprint',
    'action',
    'approvalTokenDigest',
    'transitionTokenDigest',
    'expiresAt',
  ]);
  if (Object.keys(item).some((key) => !allowed.has(key))) return false;
  try {
    assertSha256(item.planFingerprint, 'grant.planFingerprint');
    assertSha256(item.approvalTokenDigest, 'grant.approvalTokenDigest');
    assertSha256(item.transitionTokenDigest, 'grant.transitionTokenDigest');
  } catch {
    return false;
  }
  return item.schemaVersion === 1
    && item.approved === true
    && validBounded(item.workRunId, 256)
    && validBounded(item.projectId, 88)
    && /^project\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(item.projectId)
    && validBounded(item.observationId, 256)
    && validBounded(item.actor, 256)
    && [
      'create_issue',
      'push_branch',
      'create_draft_pull_request',
      'mark_ready_for_review',
    ].includes(item.action as string)
    && validBounded(item.expiresAt, 64)
    && Number.isFinite(Date.parse(item.expiresAt));
}

const denyAllApprovalPairs: UiWorkRunApprovalPairPort = {
  findByApprovalTokenDigest() {
    return undefined;
  },
};

/**
 * Adapts an OBC/UI work-run approval source to the forge confirmation seam.
 * Raw tokens are never looked up or persisted: only their SHA-256 digests are
 * compared, and every immutable plan/action/actor binding must match.
 */
export function createUiWorkRunApprovalConfirmationAdapter(
  pairs: UiWorkRunApprovalPairPort = denyAllApprovalPairs,
  now: () => string = () => new Date().toISOString(),
): ConfirmationTokenPort {
  return {
    async verify(request: ConfirmationRequest) {
      const approvalTokenDigest = sha256(request.confirmationToken);
      const grant = await pairs.findByApprovalTokenDigest(approvalTokenDigest);
      if (!validGrant(grant)) {
        return { approved: false, reason: 'No valid UI work-run approval pair exists' };
      }
      if (
        Date.parse(grant.expiresAt) <= Date.parse(now())
        || grant.approvalTokenDigest !== approvalTokenDigest
        || grant.transitionTokenDigest !== sha256(request.transitionToken)
        || grant.planFingerprint !== request.planFingerprint
        || grant.projectId !== request.projectId
        || grant.observationId !== request.observationId
        || grant.actor !== request.actor
        || grant.action !== request.action
      ) {
        return {
          approved: false,
          reason: 'UI work-run approval pair does not match this exact contribution transition',
        };
      }
      return { approved: true, workRunId: grant.workRunId };
    },
  };
}
