export const AGENT_DOMAIN_SCHEMA_VERSION = 1 as const;
export const CONTEXT_ENVELOPE_SCHEMA_VERSION = 1 as const;
export const DREAMTIME_SCHEMA_VERSION = 1 as const;

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type AgentProfileId = `agent/${string}`;
export type ProjectId = `project/${string}`;
export type ProjectAgentBindingId = `binding/${string}/${string}`;
export type ThreadId = `thread/${string}`;
export type WorkRunId = `work-run/${string}`;
export type ArtifactId = `artifact/${string}`;
export type CapabilityGrantRef = `grant/${string}`;
export type MemoryProposalId = `memory-proposal/${string}`;
export type MemoryRevisionId = `memory-revision/${string}`;
export type MemoryEventId = `memory-event/${string}`;

export interface PreviousRevision {
  revision: number;
  digest: string;
}

export interface VersionedRecord {
  schemaVersion: typeof AGENT_DOMAIN_SCHEMA_VERSION;
  revision: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  previousRevision?: PreviousRevision;
}

export interface ModelPolicy {
  mode: "inherit" | "local" | "cloud";
  provider?: string;
  model?: string;
  capabilityClass?: string;
}

export interface AgentProfile extends VersionedRecord {
  profileId: AgentProfileId;
  displayName: string;
  role: string;
  responsibilities: string[];
  capabilityClaims: string[];
  constitution: {
    principles: string[];
    instructions: string[];
  };
  defaultModelPolicy: ModelPolicy;
}

export interface AgentProfileCreate {
  profileId: AgentProfileId;
  displayName: string;
  role: string;
  responsibilities?: string[];
  capabilityClaims?: string[];
  constitution: AgentProfile["constitution"];
  defaultModelPolicy?: ModelPolicy;
  actor: string;
}

export interface AgentProfilePatch {
  displayName?: string;
  role?: string;
  responsibilities?: string[];
  capabilityClaims?: string[];
  constitution?: AgentProfile["constitution"];
  defaultModelPolicy?: ModelPolicy;
}

export type MemoryScopeName = "recentContext" | "openItems" | "stableMemory";

export interface ProjectAgentBinding extends VersionedRecord {
  bindingId: ProjectAgentBindingId;
  projectId: ProjectId;
  projectContextFingerprint: string;
  profileId: AgentProfileId;
  profileRevision: number;
  role: string;
  enabled: boolean;
  memoryScopes: MemoryScopeName[];
  connectorGrantRefs: CapabilityGrantRef[];
}

export interface ProjectAgentBindingCreate {
  projectId: ProjectId;
  projectContextFingerprint: string;
  profileId: AgentProfileId;
  profileRevision: number;
  role: string;
  enabled?: boolean;
  memoryScopes?: MemoryScopeName[];
  connectorGrantRefs?: CapabilityGrantRef[];
  actor: string;
}

export interface ProjectAgentBindingPatch {
  projectContextFingerprint?: string;
  profileRevision?: number;
  role?: string;
  enabled?: boolean;
  memoryScopes?: MemoryScopeName[];
  connectorGrantRefs?: CapabilityGrantRef[];
}

export type ThreadLifecycle = "open" | "closed" | "archived";
export type ThreadReferenceKind = "message" | "artifact" | "workRun";

export interface ThreadReference {
  ordinal: number;
  kind: ThreadReferenceKind;
  referenceId: string;
  recordedAt: string;
  contentHash?: string;
  citations: string[];
}

export interface Thread extends VersionedRecord {
  threadId: ThreadId;
  durability: "durable";
  lifecycle: ThreadLifecycle;
  projectId: ProjectId;
  bindingId: ProjectAgentBindingId;
  bindingRevision: number;
  profileId: AgentProfileId;
  profileRevision: number;
  title: string;
  references: ThreadReference[];
}

export interface EphemeralThread {
  schemaVersion: typeof AGENT_DOMAIN_SCHEMA_VERSION;
  threadId: ThreadId;
  durability: "ephemeral";
  lifecycle: ThreadLifecycle;
  profileId: AgentProfileId;
  profileRevision: number;
  title: string;
  references: ThreadReference[];
}

export interface ThreadCreate {
  threadId?: ThreadId;
  projectId: ProjectId;
  bindingId: ProjectAgentBindingId;
  bindingRevision: number;
  profileId: AgentProfileId;
  profileRevision: number;
  title: string;
  actor: string;
}

export interface ThreadReferenceCreate {
  kind: ThreadReferenceKind;
  referenceId: string;
  recordedAt?: string;
  contentHash?: string;
  citations?: string[];
}

export interface RoomIdentity {
  schemaVersion: typeof AGENT_DOMAIN_SCHEMA_VERSION;
  projectId: ProjectId;
  profileId: AgentProfileId;
  profileRevision: number;
  bindingId: ProjectAgentBindingId;
  bindingRevision: number;
  threadId: ThreadId;
  threadRevision: number;
}

export interface ConnectorSummary {
  connectorId: string;
  status: "available" | "degraded" | "unavailable" | "disabled";
  grantRef?: CapabilityGrantRef;
  remediationKey?: string;
}

export interface RoomProjection {
  schemaVersion: typeof AGENT_DOMAIN_SCHEMA_VERSION;
  identity: RoomIdentity;
  readOnly: true;
  lifecycle: ThreadLifecycle;
  relatedWorkRunIds: WorkRunId[];
  approvedMemory: null | {
    revisionId: MemoryRevisionId;
    revision: number;
    fingerprint: string;
  };
  connectorSummaries: ConnectorSummary[];
  diagnostics: Array<{
    code: string;
    severity: "info" | "warning" | "error";
    remediationKey?: string;
  }>;
}

export interface ProvenanceRef {
  kind: "governance" | "profile" | "binding" | "memoryRevision" | "project" | "workItem" | "workRun" | "thread" | "settings" | "deviceCapability" | "grant" | "artifact" | "source";
  id: string;
  revision?: number | string;
  fingerprint?: string;
}

export interface ModelLock {
  provider: string;
  model: string;
  contextWindow: number;
  tokenizer: string;
  policyFingerprint: string;
}

export interface ContextChunkInput {
  chunkId: string;
  content: JsonValue;
  provenance: ProvenanceRef[];
  mandatory?: boolean;
  priority?: number;
}

export interface ContextChunk extends ContextChunkInput {
  mandatory: boolean;
  priority: number;
  tokenCount: number;
  contentHash: string;
}

export type ContextLayerName = "platformKernel" | "agentConstitution" | "governedWorkingMemory" | "runtimeEnvelope";

export interface ContextOmission {
  layer: ContextLayerName;
  chunkId: string;
  reason: "token-budget";
  tokenCount: number;
  mandatory: false;
}

export interface ContextLayer {
  name: ContextLayerName;
  provenance: ProvenanceRef[];
  chunks: ContextChunk[];
  tokenCount: number;
  contentHash: string;
}

export interface RuntimeEnvelopeInput {
  projectContext: ContextChunkInput;
  workItem?: ContextChunkInput;
  workRun?: ContextChunkInput;
  threadWindow: ContextChunkInput[];
  settingsSnapshot: ContextChunkInput;
  deviceCapabilities: ContextChunkInput[];
  capabilityGrants: ContextChunkInput[];
  artifacts?: ContextChunkInput[];
}

export interface ContextEnvelopeCompileInput {
  envelopeId: string;
  compiledAt: string;
  modelLock: ModelLock;
  tokenBudget: number;
  platformKernel: ContextChunkInput[];
  profile: AgentProfile;
  binding: ProjectAgentBinding;
  memoryRevision: MemoryRevision;
  memoryRevisionLock: {
    revisionId: MemoryRevisionId;
    revision: number;
    fingerprint: string;
  };
  runtime: RuntimeEnvelopeInput;
}

export interface ContextEnvelope {
  schemaVersion: typeof CONTEXT_ENVELOPE_SCHEMA_VERSION;
  envelopeId: string;
  compiledAt: string;
  modelLock: ModelLock;
  tokenEstimator: "utf8-bytes-div4/v1";
  tokenBudget: number;
  tokenCount: number;
  layers: [ContextLayer, ContextLayer, ContextLayer, ContextLayer];
  omissions: ContextOmission[];
  fingerprint: string;
}

export interface MemoryWarning {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  sourceRef?: string;
}

export interface ProtectedDirective {
  directiveId: string;
  kind: "must-keep" | "protected" | "retain-until";
  section: MemoryScopeName;
  contentHash?: string;
  retainUntil?: string;
  reason: string;
}

export interface MemoryConflict {
  conflictId: string;
  section: MemoryScopeName;
  reason: string;
  sourceRefs: string[];
  resolved: false;
}

export interface MemorySection {
  content: string;
  citations: string[];
  contentHash: string;
}

export type MemorySections = Record<MemoryScopeName, MemorySection>;

export type DreamTimeOperation = "checkpoint" | "learn" | "review";
export type MemoryProposalLifecycle = "proposed" | "approved" | "rejected" | "stale" | "expired";

export interface CandidateDiff {
  operation: "replace" | "remove";
  section: MemoryScopeName;
  beforeHash: string | null;
  after: MemorySection | null;
}

export interface MemorySourceIdentities {
  threadId?: ThreadId;
  workRunId?: WorkRunId;
  revisionIds: MemoryRevisionId[];
  artifactIds: ArtifactId[];
  cutoffAt: string;
}

export interface ExpectedMemoryRevision {
  revisionId: MemoryRevisionId | null;
  revision: number;
  fingerprint: string | null;
}

export interface MemoryProposal {
  schemaVersion: typeof DREAMTIME_SCHEMA_VERSION;
  proposalId: MemoryProposalId;
  lifecycle: "proposed";
  operation: DreamTimeOperation;
  projectId: ProjectId;
  profileId: AgentProfileId;
  sourceIdentities: MemorySourceIdentities;
  expectedRevision: ExpectedMemoryRevision;
  sourceFingerprint: string;
  candidateDiff: CandidateDiff[];
  protectedDirectives: ProtectedDirective[];
  unresolvedConflicts: MemoryConflict[];
  provenance: ProvenanceRef[];
  warnings: MemoryWarning[];
  modelLock: ModelLock;
  approvalPolicy: {
    mode: "manual";
    autoApprovalHook: {
      enabled: false;
      warningFreeOnly: true;
      workingMemoryOnly: true;
    };
  };
  createdAt: string;
  createdBy: string;
  expiresAt: string;
  fingerprint: string;
}

export interface MemoryProposalCandidate extends Omit<MemoryProposal, "schemaVersion" | "proposalId" | "lifecycle" | "approvalPolicy" | "createdAt" | "createdBy" | "fingerprint"> {
  proposalId?: MemoryProposalId;
}

export interface MemoryRevision {
  schemaVersion: typeof DREAMTIME_SCHEMA_VERSION;
  revisionId: MemoryRevisionId;
  revision: number;
  previousRevisionId: MemoryRevisionId | null;
  previousFingerprint: string | null;
  projectId: ProjectId;
  profileId: AgentProfileId;
  lifecycle: "approved";
  sections: MemorySections;
  protectedDirectives: ProtectedDirective[];
  unresolvedConflicts: MemoryConflict[];
  exactDiff: CandidateDiff[];
  provenance: ProvenanceRef[];
  approval: {
    proposalId: MemoryProposalId;
    transitionTokenHash: string;
    actor: string;
    policyVersion: string;
    policyResult: "allowed";
  };
  createdAt: string;
  fingerprint: string;
}

export interface MemoryEvent {
  schemaVersion: typeof DREAMTIME_SCHEMA_VERSION;
  eventId: MemoryEventId;
  ordinal: number;
  transitionAction: "approve" | "reject";
  action: "approved" | "rejected" | "stale" | "expired";
  proposalId: MemoryProposalId;
  revisionId: MemoryRevisionId | null;
  transitionTokenHash: string;
  actor: string;
  occurredAt: string;
  exactDiff: CandidateDiff[];
  provenance: ProvenanceRef[];
  policyResult: {
    allowed: boolean;
    policyVersion: string;
    reason: string;
  };
}

export interface ApprovalDecision {
  schemaVersion: typeof DREAMTIME_SCHEMA_VERSION;
  decisionId: string;
  proposalId: MemoryProposalId;
  transitionAction: "approve" | "reject";
  state: Exclude<MemoryProposalLifecycle, "proposed">;
  revisionId: MemoryRevisionId | null;
  transitionTokenHash: string;
  actor: string;
  decidedAt: string;
  proposalFingerprint: string;
  policyVersion: string;
  reason: string;
}

export interface ActorAuthorization {
  allowed: boolean;
  policyVersion: string;
  reason: string;
}

export interface DreamTimeWorkerInput {
  operation: DreamTimeOperation;
  projectId: ProjectId;
  profileId: AgentProfileId;
  sourceIdentities: MemorySourceIdentities;
  expectedRevision: ExpectedMemoryRevision;
  sourceFingerprint: string;
  currentSections: MemorySections;
  protectedDirectives: ProtectedDirective[];
  unresolvedConflicts: MemoryConflict[];
  modelLock: ModelLock;
  expiresAt: string;
}

export interface DreamTimeWorker {
  generate(input: Readonly<DreamTimeWorkerInput>): Promise<MemoryProposalCandidate>;
}

export interface StoreConflict<T> {
  status: "conflict";
  expectedRevision: number;
  actualRevision: number;
  current: T | null;
}

export interface StoreCommitted<T> {
  status: "committed";
  record: T;
}

export type StoreMutationResult<T> = StoreConflict<T> | StoreCommitted<T>;

export interface DreamTimeDecisionResult {
  status: "approved" | "rejected" | "stale" | "expired";
  idempotent: boolean;
  decision: ApprovalDecision;
  revision: MemoryRevision | null;
  event: MemoryEvent;
}
