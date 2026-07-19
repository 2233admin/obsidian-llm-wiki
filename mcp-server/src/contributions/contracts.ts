export type Sha256Digest = `sha256:${string}`;
export type CanonicalProjectId = `project/${string}`;

export const CONTRIBUTION_PLAN_SCHEMA_VERSION = 1 as const;
export const CONTRIBUTION_RECEIPT_SCHEMA_VERSION = 1 as const;

export type ContributionDisposition =
  | 'local_only'
  | 'submit_issue'
  | 'prepare_pull_request';

export type ContributionAction =
  | 'create_issue'
  | 'push_branch'
  | 'create_draft_pull_request'
  | 'mark_ready_for_review';

export interface RepositoryMappingProvenance {
  source: 'project_binding' | 'git_remote' | 'user_selected';
  evidenceDigest: Sha256Digest;
  selectedBy?: string;
}

export interface RepositoryCandidate {
  id: string;
  provider: string;
  role: 'origin' | 'upstream' | 'configured';
  owner: string;
  name: string;
  canonicalUrl: string;
  apiEndpoint: string;
  provenance: RepositoryMappingProvenance;
}

export interface ResolvedRepository extends RepositoryCandidate {
  mappingFingerprint: Sha256Digest;
}

export interface RepositoryPermissions {
  issuesWrite: boolean;
  pushBranch: boolean;
  createPullRequest: boolean;
  markReadyForReview: boolean;
}

export interface RepositoryPreflightFacts {
  provider: string;
  repositoryId: string;
  canonicalUrl: string;
  defaultBranch: string;
  baseRef: string;
  baseSha: string;
  revision: string;
  health: 'available' | 'degraded' | 'unavailable';
  permissions: RepositoryPermissions;
  capturedAt: string;
  warnings: string[];
}

export interface PushTargetPreflightFacts {
  provider: string;
  repositoryId: string;
  owner: string;
  repository: string;
  canonicalUrl: string;
  revision: string;
  canPush: boolean;
  capturedAt: string;
}

export interface ContributionEvidence {
  ref: string;
  summary: string;
  digest: Sha256Digest;
}

export interface ContributionRedaction {
  field: string;
  reason: 'secret' | 'machine_path' | 'private_data' | 'bounded';
  replacement: string;
}

export interface ReviewedLocalWork {
  entity: string | null;
  reviewedHeadDigest: Sha256Digest;
}

export interface ExternalContributionContent {
  title: string;
  body: string;
  bodyAuthorship: 'human';
  evidence: ContributionEvidence[];
  labels: string[];
}

export interface PullRequestChangedFile {
  path: string;
  generated: boolean;
}

export interface RegressionTestEvidence {
  command: string;
  status: 'passed' | 'failed';
  exitCode: number;
  outputDigest: Sha256Digest;
  summary: string;
}

export interface PullRequestPlanDetails {
  artifactId: string;
  artifactDigest: Sha256Digest;
  isolation: 'isolated';
  baseRef: string;
  baseSha: string;
  headRef: string;
  headSha: string;
  pushTarget: {
    owner: string;
    repository: string;
    ref: string;
    mode: 'branch' | 'fork';
  };
  pushTargetFactsFingerprint: Sha256Digest;
  changedFiles: PullRequestChangedFile[];
  diffSummary: string;
  diffDigest: Sha256Digest;
  diffBytes: number;
  tests: RegressionTestEvidence[];
  generatedFilePolicy: 'exclude' | 'include_reviewed';
  draft: true;
}

/**
 * Execution-only projection of the canonical Problem Intake
 * ExternalContributionPlan. This type never owns user disposition or canonical
 * contribution identity.
 */
export interface ForgeExecutionPlanProjection {
  schemaVersion: 1;
  planId: string;
  canonicalPlanFingerprint: Sha256Digest;
  disposition: ContributionDisposition;
  projectId: CanonicalProjectId;
  observationId: string;
  actor: string;
  createdAt: string;
  repository?: ResolvedRepository;
  remoteFacts?: RepositoryPreflightFacts;
  remoteFactsFingerprint?: Sha256Digest;
  localWork?: ReviewedLocalWork;
  content?: ExternalContributionContent;
  pullRequest?: PullRequestPlanDetails;
  redactions: ContributionRedaction[];
  warnings: string[];
  projectionFingerprint: Sha256Digest;
}

export interface RepositoryPreflightRequest {
  repository: ResolvedRepository;
  baseRef?: string;
}

export interface RemoteMutationResult {
  remoteId: string;
  revision: string;
  url: string;
}

export interface ContributionTransport {
  readonly provider: string;
  preflight(request: RepositoryPreflightRequest): Promise<RepositoryPreflightFacts>;
  preflightPushTarget?(request: {
    repository: ResolvedRepository;
    target: PullRequestPlanDetails['pushTarget'];
  }): Promise<PushTargetPreflightFacts>;
  createIssue(request: {
    repository: ResolvedRepository;
    title: string;
    body: string;
    labels: string[];
    idempotencyKey: Sha256Digest;
  }): Promise<RemoteMutationResult>;
  pushBranch(request: {
    repository: ResolvedRepository;
    artifactId: string;
    artifactDigest: Sha256Digest;
    baseSha: string;
    expectedHeadSha: string;
    headRef: string;
    target: PullRequestPlanDetails['pushTarget'];
    idempotencyKey: Sha256Digest;
  }): Promise<RemoteMutationResult>;
  createDraftPullRequest(request: {
    repository: ResolvedRepository;
    baseRef: string;
    headRef: string;
    title: string;
    body: string;
    idempotencyKey: Sha256Digest;
    draft: true;
  }): Promise<RemoteMutationResult>;
  markReadyForReview?(request: {
    repository: ResolvedRepository;
    pullRequestId: string;
    expectedRevision: string;
    idempotencyKey: Sha256Digest;
  }): Promise<RemoteMutationResult>;
}

export interface ContributionTransportRegistry {
  get(provider: string): ContributionTransport | undefined;
}

export interface PreparedIsolatedPatch {
  artifactId: string;
  artifactDigest: Sha256Digest;
  isolation: 'isolated';
  baseRef: string;
  baseSha: string;
  headRef: string;
  headSha: string;
  changedFiles: PullRequestChangedFile[];
  diffSummary: string;
  diffDigest: Sha256Digest;
  diffBytes: number;
}

export interface IsolatedWorktreePort {
  prepare(request: {
    repository: ResolvedRepository;
    baseRef: string;
    baseSha: string;
    headRef: string;
    changeSummary: string;
    allowedPaths: string[];
    maxDiffBytes: number;
  }): Promise<PreparedIsolatedPatch>;
}

export interface RegressionVerifierPort {
  verify(request: {
    artifactId: string;
    artifactDigest: Sha256Digest;
    commands: string[];
  }): Promise<RegressionTestEvidence[]>;
}

export interface ConfirmationRequest {
  planFingerprint: Sha256Digest;
  action: ContributionAction;
  transitionToken: string;
  confirmationToken: string;
  actor: string;
  projectId: CanonicalProjectId;
  observationId: string;
  externalSideEffect: true;
}

export interface ConfirmationTokenPort {
  verify(request: ConfirmationRequest): Promise<{
    approved: boolean;
    workRunId?: string;
    reason?: string;
  }>;
}

export interface PendingContributionReceipt {
  schemaVersion: 1;
  status: 'pending';
  action: ContributionAction;
  planFingerprint: Sha256Digest;
  projectId: CanonicalProjectId;
  observationId: string;
  actor: string;
  transitionTokenDigest: Sha256Digest;
  confirmationTokenDigest: Sha256Digest;
  remoteFactsFingerprint: Sha256Digest;
  workRunId?: string;
  createdAt: string;
}

export interface SuccessContributionReceipt
  extends Omit<PendingContributionReceipt, 'status'> {
  status: 'success';
  completedAt: string;
  remote: RemoteMutationResult;
}

export interface OutcomeUnknownContributionReceipt
  extends Omit<PendingContributionReceipt, 'status'> {
  status: 'outcome_unknown';
  failedAt: string;
  reason: string;
}

export interface CancelledContributionReceipt
  extends Omit<PendingContributionReceipt, 'status'> {
  status: 'cancelled';
  cancelledAt: string;
  reason: string;
}

export type ContributionReceipt =
  | PendingContributionReceipt
  | SuccessContributionReceipt
  | OutcomeUnknownContributionReceipt
  | CancelledContributionReceipt;

export interface ReceiptClaim {
  claimed: boolean;
  receipt: ContributionReceipt;
}

export interface ContributionReceiptStore {
  claim(receipt: PendingContributionReceipt): Promise<ReceiptClaim>;
  replace(receipt: ContributionReceipt): Promise<void>;
  find(planFingerprint: Sha256Digest, action: ContributionAction): Promise<ContributionReceipt | undefined>;
}

export interface SubmitIssuePlanInput {
  disposition: 'submit_issue';
  projectId: CanonicalProjectId;
  observationId: string;
  actor: string;
  now: string;
  canonicalPlanId: string;
  canonicalPlanFingerprint: Sha256Digest;
  repositoryCandidates: RepositoryCandidate[];
  selectedRepositoryId?: string;
  localWork: ReviewedLocalWork;
  title: string;
  body: string;
  bodyAuthorship: 'human';
  evidence: ContributionEvidence[];
  labels?: string[];
  warnings?: string[];
}

export interface LocalOnlyPlanInput {
  disposition: 'local_only';
  projectId: CanonicalProjectId;
  observationId: string;
  actor: string;
  now: string;
  canonicalPlanId: string;
  canonicalPlanFingerprint: Sha256Digest;
  localWork?: ReviewedLocalWork;
  warnings?: string[];
}

export interface PreparePullRequestPlanInput {
  disposition: 'prepare_pull_request';
  projectId: CanonicalProjectId;
  observationId: string;
  actor: string;
  now: string;
  canonicalPlanId: string;
  canonicalPlanFingerprint: Sha256Digest;
  repositoryCandidates: RepositoryCandidate[];
  selectedRepositoryId?: string;
  localWork: ReviewedLocalWork;
  title: string;
  body: string;
  bodyAuthorship: 'human';
  evidence: ContributionEvidence[];
  labels?: string[];
  warnings?: string[];
  baseRef?: string;
  headRef: string;
  changeSummary: string;
  allowedPaths: string[];
  testCommands: string[];
  pushTarget: PullRequestPlanDetails['pushTarget'];
  generatedFilePolicy: PullRequestPlanDetails['generatedFilePolicy'];
  maxDiffBytes?: number;
}

export type ContributionPlanInput =
  | LocalOnlyPlanInput
  | SubmitIssuePlanInput
  | PreparePullRequestPlanInput;

export interface ContributionApplyRequest {
  plan: ForgeExecutionPlanProjection;
  action?: ContributionAction;
  transitionToken?: string;
  confirmationToken?: string;
  actor: string;
  cancelled?: boolean;
  pullRequestId?: string;
  expectedPullRequestRevision?: string;
}

export type ContributionApplyResult =
  | {
    status: 'local_only' | 'cancelled';
    planFingerprint: Sha256Digest;
    action?: ContributionAction;
    replayed: false;
  }
  | {
    status: 'applied';
    planFingerprint: Sha256Digest;
    action: ContributionAction;
    replayed: boolean;
    remote: RemoteMutationResult;
    receipt: SuccessContributionReceipt;
  };
