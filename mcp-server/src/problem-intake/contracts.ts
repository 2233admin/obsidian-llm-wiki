import type {
  ExternalContributionPlan,
  ExternalContributionExecutionProjection,
  IssueChangePlan,
  ProblemObservation,
  ProblemObservationId,
  ProblemReport,
  ProblemIntakeService,
  ProjectId,
  PullRequestPatchEvidence,
  Sha256Digest,
} from '../../../packages/problem-intake/dist/src/index.js';

export type MaybePromise<T> = T | Promise<T>;

/** The MCP layer consumes the package's canonical service contract directly. */
export type CanonicalProblemIntakePort = ProblemIntakeService;

export interface ProjectOperationPort {
  call(
    operation: IssueChangePlan['operation'],
    params: Record<string, unknown>,
    context?: unknown,
  ): Promise<Record<string, unknown>>;
}

export interface LocalIssueApplyReceipt {
  schemaVersion: 1;
  projectId: ProjectId;
  status: 'pending' | 'applied' | 'outcome_unknown';
  planFingerprint: Sha256Digest;
  transitionTokenDigest: Sha256Digest;
  actor: string;
  result: Record<string, unknown> | null;
  updatedAt: string;
}

export interface LocalIssueReceiptPort {
  get(
    projectId: ProjectId,
    transitionTokenDigest: Sha256Digest,
  ): MaybePromise<LocalIssueApplyReceipt | undefined>;
  put(receipt: LocalIssueApplyReceipt): MaybePromise<void>;
}

export interface ContributionPreflight {
  available: boolean;
  unavailableReason?: string;
  target: {
    provider: 'github' | 'gitea' | 'gitlab';
    repository: string;
    baseRevision: string;
  };
  settingsSnapshotFingerprint: Sha256Digest;
  remoteHeadFingerprint: Sha256Digest;
  executionProjection: Omit<
    ExternalContributionExecutionProjection,
    'projectionFingerprint'
  >;
  warnings?: string[];
  patch?: PullRequestPatchEvidence;
}

export interface GovernedContributionPort {
  inspect(input: {
    choice: 'submit_issue' | 'prepare_pull_request';
    projectId: ProjectId;
    /** Selection key only; implementations must reject arbitrary paths/URLs. */
    repository: string;
    observation: Readonly<ProblemObservation>;
  }): Promise<ContributionPreflight>;
  apply(
    plan: Readonly<ExternalContributionPlan>,
    approval: {
      actor: string;
      workRunId: string;
      approvalToken: string;
      transitionToken: string;
      action?: "create_issue" | "push_branch" | "create_draft_pull_request" | "mark_ready_for_review";
      pullRequestId?: string;
      expectedPullRequestRevision?: string;
    },
  ): Promise<{
    provider: string;
    remoteIdentity: string;
    remoteRevision: string;
    url?: string;
    replayed: boolean;
    receipt?: Record<string, unknown>;
  }>;
}

export interface ProblemClock {
  now(): string;
}

export interface ProblemIntakeDependencies {
  domain: CanonicalProblemIntakePort;
  issueReceipts: LocalIssueReceiptPort;
  projectOperations: ProjectOperationPort;
  contribution?: GovernedContributionPort;
  clock?: ProblemClock;
}

export interface ProblemObservationListResult {
  projectId: ProjectId;
  observations: readonly Readonly<ProblemObservation>[];
}

export interface ContributionPlanUnavailable {
  available: false;
  choice: 'prepare_pull_request';
  observationId: ProblemObservationId;
  reason: string;
  fallback: 'submit_issue';
  warnings: string[];
}

export interface ContributionPlanAvailable {
  available: true;
  plan: Readonly<ExternalContributionPlan>;
}

export type ContributionPlanResult =
  | ContributionPlanUnavailable
  | ContributionPlanAvailable;

export class ProblemIntakeExecutionError extends Error {
  readonly code:
    | 'INVALID_INPUT'
    | 'NOT_FOUND'
    | 'CONFLICT'
    | 'UNAVAILABLE'
    | 'APPROVAL_REQUIRED'
    | 'OUTCOME_UNKNOWN';
  readonly data?: unknown;

  constructor(
    code: ProblemIntakeExecutionError['code'],
    message: string,
    data?: unknown,
  ) {
    super(message);
    this.name = 'ProblemIntakeExecutionError';
    this.code = code;
    this.data = data;
  }
}

export type {
  ExternalContributionPlan,
  IssueChangePlan,
  ProblemObservation,
  ProblemReport,
  ProjectId,
  Sha256Digest,
};
