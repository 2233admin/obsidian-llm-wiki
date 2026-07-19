export type Sha256Digest = `sha256:${string}`;
export type ProjectId = `project/${string}`;
export type ProblemObservationId = `problem/${string}`;
export type ContributionPlanId = `contribution/${string}`;

export type ProblemProviderKind =
  | "obc"
  | "host_capability"
  | "obsidian_plugin"
  | "agent"
  | "manual";

export type ProblemSeverity = "info" | "warning" | "error" | "critical";
export type ProblemLifecycleState = "untriaged" | "acknowledged" | "dismissed" | "resolved";
export type ProblemVerificationStatus = "reproduced" | "not_reproduced" | "provider_failed";
export type ProblemDispositionChoice = "local_only" | "submit_issue" | "prepare_pull_request";

export interface ProblemProvider {
  id: string;
  kind: ProblemProviderKind;
  version: string;
}

export interface ProblemSubject {
  kind: "vault_path" | "capability" | "plugin" | "repository" | "other";
  canonicalRef: string;
}

export interface ProblemEvidenceReference {
  kind: "vault_path" | "citation" | "provider_finding" | "operation_receipt" | "test_result";
  ref: string;
  digest?: Sha256Digest;
  summary?: string;
}

export interface ProblemReport {
  schemaVersion: 1;
  projectId: ProjectId;
  provider: ProblemProvider;
  ruleId: string;
  subject: ProblemSubject;
  severity: ProblemSeverity;
  summary: string;
  evidenceRefs: ProblemEvidenceReference[];
  observedAt: string;
  suggestedAction?: string;
}

export interface ProblemOccurrence {
  count: number;
  firstObservedAt: string;
  lastObservedAt: string;
  providerVersions: string[];
}

export interface ProblemLifecycleTransition {
  revision: number;
  from: ProblemLifecycleState;
  to: ProblemLifecycleState;
  actor: string;
  reason: string;
  at: string;
  transitionToken: string;
}

export interface ProblemVerification {
  revision: number;
  status: ProblemVerificationStatus;
  verifiedAt: string;
  actor: string;
  providerVersion: string;
  evidenceRefs: ProblemEvidenceReference[];
}

export interface ProblemObservation {
  schemaVersion: 1;
  id: ProblemObservationId;
  projectId: ProjectId;
  provider: ProblemProvider;
  ruleId: string;
  subject: ProblemSubject;
  severity: ProblemSeverity;
  summary: string;
  evidenceRefs: ProblemEvidenceReference[];
  observedAt: string;
  sourceFingerprint: Sha256Digest;
  observationFingerprint: Sha256Digest;
  revision: number;
  lifecycle: ProblemLifecycleState;
  lifecycleHistory: ProblemLifecycleTransition[];
  occurrence: ProblemOccurrence;
  verificationHistory: ProblemVerification[];
  suggestedAction: string | null;
  linkedIssue: string | null;
  linkedContributions: ContributionPlanId[];
}

export interface ProblemDisposition {
  schemaVersion: 1;
  observationId: ProblemObservationId;
  observationRevision: number;
  choice: ProblemDispositionChoice;
  actor: string;
  selectedAt: string;
  reason: string | null;
}

export type IssuePlanAction = "create" | "update" | "comment";
export type ProjectIssueOperation =
  | "project.issue.create"
  | "project.issue.update"
  | "project.comment.add";

export interface IssueChangePayload {
  title: string;
  description: string;
  body: string;
  priority: 0 | 1 | 2 | 3 | 4;
}

export interface IssueChangePlan {
  schemaVersion: 1;
  projectId: ProjectId;
  observationId: ProblemObservationId;
  observationRevision: number;
  existingIssueEntity: string | null;
  action: IssuePlanAction;
  operation: ProjectIssueOperation;
  payload: IssueChangePayload;
  evidenceRefs: ProblemEvidenceReference[];
  warnings: string[];
  actor: string;
  fingerprint: Sha256Digest;
}

export interface ExternalRepositoryTarget {
  provider: "github" | "gitea" | "gitlab";
  repository: string;
  baseRevision: string;
}

export interface ExternalContributionContent {
  title: string;
  body: string;
  labels: string[];
  evidenceRefs: ProblemEvidenceReference[];
}

export interface PullRequestTestEvidence {
  command: string;
  status: "passed";
  summary: string;
}

export interface PullRequestPatchEvidence {
  baseRevision: string;
  headRevision: string;
  branchTarget: string;
  diffSummary: string;
  changedPaths: string[];
  tests: PullRequestTestEvidence[];
  draft: true;
}

/**
 * Immutable identity seam for the richer forge execution projection.
 *
 * Problem Intake owns the user disposition and canonical plan fingerprint.
 * A forge adapter owns resolved repository, preflight, isolated artifact,
 * permission, and receipt transport details. Their complete versioned
 * projection is locked into this plan through these digests.
 */
export interface ExternalContributionExecutionProjection {
  schemaVersion: 1;
  kind: "forge_execution_v1";
  repositoryMappingFingerprint: Sha256Digest;
  preflightFingerprint: Sha256Digest;
  reviewedLocalWorkFingerprint: Sha256Digest;
  pullRequestArtifactFingerprint: Sha256Digest | null;
  projectionFingerprint: Sha256Digest;
}

export interface ExternalContributionPlan {
  schemaVersion: 1;
  id: ContributionPlanId;
  disposition: ProblemDisposition;
  projectId: ProjectId;
  observationId: ProblemObservationId;
  observationRevision: number;
  linkedIssueEntity: string | null;
  target: ExternalRepositoryTarget | null;
  content: ExternalContributionContent | null;
  patch: PullRequestPatchEvidence | null;
  executionProjection: ExternalContributionExecutionProjection | null;
  settingsSnapshotFingerprint: Sha256Digest | null;
  remoteHeadFingerprint: Sha256Digest | null;
  redactions: string[];
  warnings: string[];
  actor: string;
  fingerprint: Sha256Digest;
}

export interface IngestProblemResult {
  observation: ProblemObservation;
  deduplicated: boolean;
}

export interface ObservationTransitionRequest {
  observationId: ProblemObservationId;
  expectedRevision: number;
  to: ProblemLifecycleState;
  actor: string;
  reason: string;
  at: string;
  transitionToken: string;
}

export interface ObservationTransitionResult {
  observation: ProblemObservation;
  replayed: boolean;
}

export interface VerifyObservationRequest {
  observationId: ProblemObservationId;
  expectedRevision: number;
  status: ProblemVerificationStatus;
  verifiedAt: string;
  actor: string;
  providerVersion: string;
  evidenceRefs: ProblemEvidenceReference[];
}
