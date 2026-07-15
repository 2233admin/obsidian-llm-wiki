import type {
  AgentProfileId,
  ArtifactId,
  JsonValue,
  MemoryRevision,
  MemoryRevisionId,
  MemoryScopeName,
  ProjectAgentBindingId,
  ProjectId,
  ProvenanceRef,
  ThreadId,
  WorkRunId,
} from "./types.js";

export const AGENT_COLLABORATION_SCHEMA_VERSION = 1 as const;

export type ContextConsultRequestId = `context-consult/${string}`;
export type ContextConsultResultId = `context-consult-result/${string}`;
export type DelegationPlanId = `delegation-plan/${string}`;
export type AssignmentPlanId = `assignment-plan/${string}`;
export type DeviceSnapshotId = `device-snapshot/${string}`;
export type ArtifactProjectionId = `artifact-projection/${string}`;

export type SideEffectClass =
  | "read-only"
  | "local-write"
  | "external-write"
  | "external-delete"
  | "external-execute";

export type RunOutputClass =
  | "run-output"
  | "durable-knowledge-candidate"
  | "decision-candidate"
  | "architecture-candidate"
  | "runbook-candidate"
  | "external-operation-result"
  | "diagnostic";

export interface AllowedPolicyDecision {
  allowed: true;
  policyVersion: string;
  reason: string;
  decidedAt: string;
  actor: string;
}

export interface MemoryRevisionLock {
  revisionId: MemoryRevisionId;
  revision: number;
  fingerprint: string;
}

export interface CapabilityScope {
  connectors: string[];
  operations: string[];
  resources: string[];
  sideEffectClasses: SideEffectClass[];
}

/** Durable, explanatory grant metadata. It intentionally contains no usable token. */
export interface CapabilityGrant {
  schemaVersion: typeof AGENT_COLLABORATION_SCHEMA_VERSION;
  grantId: `grant/${string}`;
  projectId: ProjectId;
  profileId: AgentProfileId;
  profileRevision: number;
  workRunId: WorkRunId;
  delegationPlanId?: DelegationPlanId;
  scope: CapabilityScope;
  issuedAt: string;
  expiresAt: string;
  issuedBy: string;
  policyDecision: AllowedPolicyDecision;
  externalSideEffectApproval: {
    mode: "none" | "per-run";
    approvedClasses: SideEffectClass[];
    approvedWorkRunId?: WorkRunId;
    approvalFingerprint?: string;
  };
  fingerprint: string;
}

export interface CapabilityUseRequest {
  projectId: ProjectId;
  profileId: AgentProfileId;
  profileRevision: number;
  workRunId: WorkRunId;
  connector: string;
  operation: string;
  resource: string;
  sideEffectClass: SideEffectClass;
  attemptedAt: string;
}

export interface CapabilityUseDecision {
  allowed: boolean;
  policyVersion: string;
  reason: string;
  grantId: CapabilityGrant["grantId"];
  requestFingerprint: string;
  decidedAt: string;
}

export interface PromotionReview {
  required: boolean;
  state: "not-required" | "candidate-required" | "candidate-created" | "approved" | "rejected";
  policyVersion: string;
  candidateId?: string;
}

export interface OperationWriteReview {
  required: boolean;
  state: "not-required" | "approval-required" | "approved" | "denied";
  policyVersion: string;
  approvalScope: "none" | "per-run";
  approvedWorkRunId?: WorkRunId;
  grantId?: CapabilityGrant["grantId"];
  decisionFingerprint?: string;
}

export interface OperationTarget {
  connector: string;
  operation: string;
  resource: string;
}

export interface ArtifactProjection {
  schemaVersion: typeof AGENT_COLLABORATION_SCHEMA_VERSION;
  projectionId: ArtifactProjectionId;
  artifactId: ArtifactId;
  projectId: ProjectId;
  producer: {
    kind: "context-consult" | "child-work-run" | "connector" | "dreamtime";
    profileId: AgentProfileId;
    profileRevision: number;
  };
  sourceWorkRunId: WorkRunId;
  parentWorkRunId?: WorkRunId;
  contextFingerprint: string;
  inputArtifactIds: ArtifactId[];
  contentHash: string;
  mediaType: string;
  outputClass: RunOutputClass;
  sideEffectClass: SideEffectClass;
  operationTarget?: OperationTarget;
  promotionReview: PromotionReview;
  operationWriteReview: OperationWriteReview;
  provenance: ProvenanceRef[];
  warnings: Array<{
    code: string;
    severity: "info" | "warning" | "error";
    message: string;
  }>;
  createdAt: string;
  fingerprint: string;
}

export interface ContextConsultRequest {
  schemaVersion: typeof AGENT_COLLABORATION_SCHEMA_VERSION;
  requestId: ContextConsultRequestId;
  projectId: ProjectId;
  requestingAgent: {
    profileId: AgentProfileId;
    profileRevision: number;
    workRunId: WorkRunId;
  };
  targetAgent: {
    profileId: AgentProfileId;
    profileRevision: number;
  };
  attachTo: { kind: "workRun"; id: WorkRunId } | { kind: "thread"; id: ThreadId };
  objective: string;
  requestedSections: MemoryScopeName[];
  asOf: MemoryRevisionLock;
  contextFingerprint: string;
  capabilityGrantId: CapabilityGrant["grantId"];
  authorizationDecision: AllowedPolicyDecision;
  provenance: ProvenanceRef[];
  createdAt: string;
  expiresAt: string;
  invocationTokenHash: string;
  fingerprint: string;
}

export interface ContextConsultResult {
  schemaVersion: typeof AGENT_COLLABORATION_SCHEMA_VERSION;
  resultId: ContextConsultResultId;
  requestId: ContextConsultRequestId;
  projectId: ProjectId;
  requestingWorkRunId: WorkRunId;
  targetAgent: ContextConsultRequest["targetAgent"];
  consultedRevision: MemoryRevisionLock;
  observedCurrentRevision: MemoryRevisionLock;
  freshness: "current" | "stale";
  staleForCurrentContextOperations: boolean;
  provenance: ProvenanceRef[];
  warnings: ArtifactProjection["warnings"];
  artifact: ArtifactProjection;
  completedAt: string;
  invocationTokenHash: string;
  fingerprint: string;
}

export interface ContextConsultMemoryReader {
  readApprovedRevision(lock: Readonly<MemoryRevisionLock>): Promise<MemoryRevision>;
  readCurrentApprovedRevision(): Promise<MemoryRevision>;
}

export interface ContextConsultWorkerInput {
  requestId: ContextConsultRequestId;
  projectId: ProjectId;
  objective: string;
  targetAgent: ContextConsultRequest["targetAgent"];
  asOf: MemoryRevisionLock;
  contextFingerprint: string;
  sections: Partial<MemoryRevision["sections"]>;
  inputArtifactIds: ArtifactId[];
}

export interface ContextConsultWorkerOutput {
  content: JsonValue;
  mediaType: string;
  outputClass: Exclude<RunOutputClass, "external-operation-result" | "diagnostic">;
  provenance: ProvenanceRef[];
  warnings?: ArtifactProjection["warnings"];
}

export interface ContextConsultWorker {
  generate(input: Readonly<ContextConsultWorkerInput>): Promise<ContextConsultWorkerOutput>;
}

export interface AssignmentInputContract {
  assignmentPlanId: AssignmentPlanId;
  assignmentPlanVersion: number;
  assignmentPlanFingerprint: string;
  deviceSnapshot: {
    snapshotId: DeviceSnapshotId;
    deviceId: string;
    revision: number;
    fingerprint: string;
    capturedAt: string;
    expiresAt: string;
  };
  profileId: AgentProfileId;
  profileRevision: number;
  bindingId: ProjectAgentBindingId;
  bindingRevision: number;
  contextEnvelopeFingerprint: string;
}

export interface DelegationBudget {
  policyVersion: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxDurationMs: number;
  maxCostMinorUnits?: number;
  currency?: string;
}

export interface ExpectedOutputContract {
  outputClass: RunOutputClass;
  mediaType: string;
  requiredArtifactCount: number;
  acceptanceCriteria: string[];
}

export interface DelegationPlan {
  schemaVersion: typeof AGENT_COLLABORATION_SCHEMA_VERSION;
  planId: DelegationPlanId;
  projectId: ProjectId;
  parentWorkRunId: WorkRunId;
  objective: string;
  assignment: AssignmentInputContract;
  inputArtifactIds: ArtifactId[];
  requestedCapabilityScope: CapabilityScope;
  budget: DelegationBudget;
  expiresAt: string;
  expectedOutput: ExpectedOutputContract;
  sideEffectPolicy: {
    externalEffectsRequirePerRunApproval: true;
    requestedExternalClasses: SideEffectClass[];
  };
  provenance: ProvenanceRef[];
  createdAt: string;
  createdBy: string;
  fingerprint: string;
}

export type ChildWorkRunLifecycle = "ready" | "running" | "completed" | "failed" | "cancelled";

export interface ChildWorkRun {
  schemaVersion: typeof AGENT_COLLABORATION_SCHEMA_VERSION;
  workRunId: WorkRunId;
  revision: number;
  previousRevision?: { revision: number; fingerprint: string };
  projectId: ProjectId;
  parentWorkRunId: WorkRunId;
  delegationPlanId: DelegationPlanId;
  delegationPlanFingerprint: string;
  lifecycle: ChildWorkRunLifecycle;
  assignment: AssignmentInputContract;
  expectedOutput: ExpectedOutputContract;
  inputArtifactIds: ArtifactId[];
  grantSummary: CapabilityGrant;
  artifacts: ArtifactProjection[];
  terminalDiagnosticArtifactId?: ArtifactId;
  parentStateEffect: "none";
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  fingerprint: string;
}

export interface DelegationApprovalRequest {
  planId: DelegationPlanId;
  presentedFingerprint: string;
  transitionToken: string;
  actor: string;
  approvedExternalClasses: SideEffectClass[];
  authorize(input: Readonly<DelegationPlan>): AllowedPolicyDecision | Promise<AllowedPolicyDecision>;
}

export interface DelegationApprovalResult {
  idempotent: boolean;
  child: ChildWorkRun;
  grant: CapabilityGrant;
}

export interface ChildTransitionRequest {
  expectedRevision: number;
  lifecycle: ChildWorkRunLifecycle;
  transitionToken: string;
  actor: string;
  diagnosticArtifact?: ArtifactProjection;
}

export interface ChildTransitionResult {
  idempotent: boolean;
  child: ChildWorkRun;
}

export interface ArtifactProjectionRequest {
  expectedRevision: number;
  transitionToken: string;
  actor: string;
  artifact: ArtifactProjection;
}
