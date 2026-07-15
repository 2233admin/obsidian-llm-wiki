import { createHash } from "node:crypto";
import type {
  AgentProfile,
  AgentProfileCreate,
  AgentProfileId,
  AgentProfilePatch,
  ArtifactId,
  CandidateDiff,
  ConnectorSummary,
  MemoryProposal,
  MemoryProposalId,
  MemoryProposalLifecycle,
  MemoryRevision,
  MemoryWarning,
  ProjectAgentBinding,
  ProjectAgentBindingCreate,
  ProjectAgentBindingId,
  ProjectAgentBindingPatch,
  ProjectId,
  ProvenanceRef,
  RoomProjection,
  StoreMutationResult,
  Thread,
  ThreadId,
  WorkRunId,
} from "../../packages/agent-domain/src/types";
import type {
  CapabilityGrant,
  ChildWorkRun,
  ArtifactProjection as AgentArtifactProjection,
  ContextConsultRequest,
  ContextConsultResult,
  ContextConsultWorkerOutput,
  DelegationPlan as AgentDelegationPlan,
} from "../../packages/agent-domain/src/collaboration-types";
import type { SecretReference, SettingsOperationTransport } from "./settings-client";

export type {
  AgentProfile,
  AgentProfileCreate,
  AgentProfileId,
  AgentProfilePatch,
  CandidateDiff,
  ConnectorSummary,
  MemoryProposal,
  MemoryProposalId,
  MemoryProposalLifecycle,
  MemoryRevision,
  MemoryWarning,
  ProjectAgentBinding,
  ProjectAgentBindingCreate,
  ProjectAgentBindingId,
  ProjectAgentBindingPatch,
  ProjectId,
  ProvenanceRef,
  RoomProjection,
  Thread,
  ThreadId,
  WorkRunId,
};

/**
 * Stable Obsidian-facing names for the shared backend operation interface.
 * This file intentionally contains no stores, reducers, or approval state.
 */
export const CONTROL_PLANE_OPERATIONS = {
  profileCreate: "agent.profile.create",
  profileRead: "agent.profile.read",
  profileList: "agent.profile.list",
  profileUpdate: "agent.profile.update",
  bindingCreate: "agent.binding.create",
  bindingRead: "agent.binding.read",
  bindingList: "agent.binding.list",
  bindingUpdate: "agent.binding.update",
  threadCreate: "agent.thread.create",
  threadRead: "agent.thread.read",
  threadList: "agent.thread.list",
  threadAppend: "agent.thread.append",
  threadTransition: "agent.thread.transition",
  roomGet: "agent.room.get",
  contextCompile: "agent.context.compile",
  migrationPlan: "agent.migration.plan",
  dreamTimeCheckpointPropose: "dreamtime.checkpoint.propose",
  dreamTimeLearnPropose: "dreamtime.learn.propose",
  dreamTimeReviewPropose: "dreamtime.review.propose",
  dreamTimeProposalRead: "dreamtime.proposal.read",
  dreamTimeApprove: "dreamtime.approve",
  dreamTimeReject: "dreamtime.reject",
  dreamTimeRevisionCurrent: "dreamtime.revision.current",
  dreamTimeRevisionRead: "dreamtime.revision.read",
  dreamTimeRevisionHistory: "dreamtime.revision.history",
  dreamTimeDoctor: "dreamtime.doctor",
  dreamTimePromotionHandoff: "dreamtime.promotion.handoff",
  consultExecute: "consult.execute",
  delegationPlan: "delegation.plan",
  delegationApprove: "delegation.approve",
  delegationRead: "delegation.read",
  delegationTransition: "delegation.transition",
  delegationArtifactProject: "delegation.artifact.project",
  projectHubGet: "project.hub.get",
  hostDescriptorRegister: "host.descriptor.register",
  hostDescriptorList: "host.descriptor.list",
  hostDescriptorRead: "host.descriptor.read",
  hostConnectorRegister: "host.connector.register",
  hostConnectorList: "host.connector.list",
  hostConnectorRead: "host.connector.read",
  hostAssignmentPlan: "host.assignment.plan",
  hostAssignmentApprove: "host.assignment.approve",
  hostAssignmentRead: "host.assignment.read",
  hostProxySearch: "host.proxy.search",
  hostProxyDescribe: "host.proxy.describe",
  hostProxyInvoke: "host.proxy.invoke",
  hostDoctor: "host.doctor",
  hostProject: "host.project",
  usageProject: "usage.project",
} as const;

export type AgentControlPlaneTransport = SettingsOperationTransport;

export interface AgentProfileListResult {
  profiles: AgentProfile[];
}

export interface ProjectAgentBindingListResult {
  bindings: ProjectAgentBinding[];
}

export interface ThreadListResult {
  threads: Thread[];
}

export interface DreamTimeProposalProjection extends Omit<MemoryProposal, "lifecycle"> {
  lifecycle: MemoryProposalLifecycle;
}

export interface DreamTimeProposalReadResult {
  proposal: DreamTimeProposalProjection;
}

export interface DreamTimeRevisionHistoryResult {
  revisions: MemoryRevision[];
  events?: Array<{
    eventId: string;
    action: "approved" | "rejected" | "stale" | "expired";
    proposalId: MemoryProposalId;
    revisionId: string | null;
    actor: string;
    occurredAt: string;
  }>;
}

export interface DreamTimeDoctorResult {
  projectId: ProjectId;
  profileId?: AgentProfileId;
  state: "healthy" | "degraded" | "unavailable" | "empty";
  proposalSummaries?: Array<{
    proposalId: MemoryProposalId;
    operation: MemoryProposal["operation"];
    lifecycle: MemoryProposalLifecycle;
    fingerprint: string;
    createdAt: string;
    expiresAt: string;
    warningCount: number;
  }>;
  diagnostics: ControlPlaneDiagnostic[];
}

export interface ControlPlaneDiagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  message?: string;
  remediationKey?: string;
}

export interface ArtifactProjection {
  artifactId: ArtifactId;
  producerProfileId: AgentProfileId;
  sourceWorkRunId: WorkRunId;
  contextFingerprint: string;
  inputReferences: string[];
  contentHash: string;
  outputClassification: string;
  reviewState: string;
  provenance: ProvenanceRef[];
}

export interface ConsultProjection {
  consultId: string;
  requestingWorkRunId: WorkRunId;
  requestingProfileId: AgentProfileId;
  targetProfileId: AgentProfileId;
  targetRevisionId: string;
  targetFingerprint: string;
  stale: boolean;
  warnings: MemoryWarning[];
  artifact: ArtifactProjection;
  idempotent: boolean;
}

export interface ConsultExecutionRequest {
  project: ProjectId;
  request: Omit<ContextConsultRequest, "schemaVersion" | "invocationTokenHash" | "fingerprint">
    & Partial<Pick<ContextConsultRequest, "schemaVersion" | "invocationTokenHash" | "fingerprint">>;
  invocationToken: string;
  workerOutput: ContextConsultWorkerOutput;
  inputArtifactIds?: ArtifactId[];
  actor: string;
}

interface ConsultExecutionBackendResult {
  idempotent: boolean;
  result: ContextConsultResult;
}

export interface DelegationPlanProjection {
  planId: string;
  revision: number;
  projectId: ProjectId;
  parentWorkRunId: WorkRunId;
  objective: string;
  candidateProfileId: AgentProfileId;
  capabilityScope: string[];
  budget: {
    amount?: number;
    currency?: string;
    policyVersion?: string;
    decision?: "allowed" | "warning" | "denied";
  };
  device?: {
    deviceId?: string;
    resourceClass?: string;
    health?: string;
  };
  sideEffectClasses: string[];
  expiresAt: string;
  expectedOutput: string;
  fingerprint: string;
  approval: {
    status: "pending" | "approved" | "rejected" | "stale";
    reviewedBy?: string;
    reviewedAt?: string;
  };
  child?: {
    workRunId: WorkRunId;
    status: string;
  };
  artifacts: ArtifactProjection[];
  diagnostics: ControlPlaneDiagnostic[];
}

export interface ProjectHubSection<T = Record<string, unknown>> {
  owner: string;
  freshness: string | null;
  health: "healthy" | "degraded" | "unavailable" | "empty";
  drift: string[];
  data: T;
}

export interface ProjectHubProjection {
  projectId: ProjectId;
  generatedAt: string;
  readOnly: true;
  diagnostics: ControlPlaneDiagnostic[];
  sections: Record<string, ProjectHubSection>;
}

export interface HostCapabilityProjectionRows {
  experts: Array<{
    id: string;
    displayName: string;
    health?: string;
    capabilities: string[];
    connectorRef?: string;
  }>;
  connectors: Array<{
    id: string;
    displayName: string;
    health?: string;
    kind?: string;
    transport?: string;
    secretReferenceConfigured: boolean;
  }>;
  assignments: Array<Record<string, unknown>>;
}

export function projectHostCapabilityRows(data: Record<string, unknown>): HostCapabilityProjectionRows {
  return {
    experts: recordValues(data.descriptors).map(descriptor => ({
      id: stringValue(descriptor.descriptorId) ?? "unknown-expert",
      displayName: stringValue(descriptor.displayName) ?? stringValue(descriptor.descriptorId) ?? "Unnamed expert",
      health: stringValue(descriptor.health),
      capabilities: stringValues(descriptor.capabilities),
      connectorRef: stringValue(descriptor.connectorRef),
    })),
    connectors: recordValues(data.connectors).map(connector => ({
      id: stringValue(connector.connectorId) ?? "unknown-connector",
      displayName: stringValue(connector.displayName) ?? stringValue(connector.connectorId) ?? "Unnamed connector",
      health: stringValue(connector.health),
      kind: stringValue(connector.kind),
      transport: stringValue(connector.transport),
      secretReferenceConfigured: connector.secretReferenceConfigured === true,
    })),
    assignments: recordValues(data.assignments),
  };
}

export interface UsageProjectionResult {
  projectId: ProjectId;
  projection: {
    revision?: string | number;
    sourceEventCount?: number;
    unknownCounts?: Record<string, number>;
    totals?: Record<string, unknown>;
    groups?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
}

export interface HostProjectResult {
  projectId: ProjectId;
  bindingId?: string;
  grantId?: string;
  connectors?: Array<Record<string, unknown>>;
  descriptors?: Array<Record<string, unknown>>;
  assignments?: Array<Record<string, unknown>>;
  diagnostics?: ControlPlaneDiagnostic[];
  [key: string]: unknown;
}

export interface HostAuthorizationReferences {
  bindingId: string;
  grantId: string;
}

export interface HostAuthorizationSnapshot extends HostAuthorizationReferences {
  project: ProjectId;
}

/** Accept Host authority only when the fresh backend projection echoes the exact requested scope. */
export function validatedHostAuthorizationSnapshot(
  project: ProjectId,
  authorization: HostAuthorizationReferences | undefined,
  projection: HostProjectResult | null,
): HostAuthorizationSnapshot | null {
  if (
    !authorization
    || !projection
    || projection.projectId !== project
    || projection.bindingId !== authorization.bindingId
    || projection.grantId !== authorization.grantId
  ) return null;
  return { project, ...authorization };
}

export interface HostCapabilitySearchResult {
  descriptorId: string;
  descriptorVersion: string;
  displayName: string;
  capabilities: string[];
  operations: string[];
  connectorId: string;
  connectorVersion: string;
  health: string;
  descriptorFingerprint: string;
}

export interface HostCapabilitySearchResponse {
  projectId: ProjectId;
  count: number;
  results: HostCapabilitySearchResult[];
}

export interface HostCapabilityDescriptionResponse {
  projectId: ProjectId;
  description: Record<string, unknown> & {
    descriptorFingerprint?: string;
    visibleOperations?: Array<Record<string, unknown>>;
  };
}

export interface HostAssignmentPlanResponse {
  projectId: ProjectId;
  plan: Record<string, unknown> & {
    planId?: string;
    approval?: { status?: string };
  };
  planFingerprint: string;
}

export interface HostDoctorResult {
  ok: boolean;
  schemaVersion: number;
  counts: {
    descriptors: number;
    connectors: number;
    assignments: number;
  };
  findings: Array<Record<string, unknown>>;
}

export interface AgentControlPlaneProjection {
  projectId: ProjectId;
  profileId?: AgentProfileId;
  threadId?: ThreadId;
  profiles: AgentProfile[];
  bindings: ProjectAgentBinding[];
  threads: Thread[];
  room: RoomProjection | null;
  proposal: DreamTimeProposalProjection | null;
  dreamTimeDoctor: DreamTimeDoctorResult | null;
  revisionHistory: DreamTimeRevisionHistoryResult | null;
  delegation: DelegationPlanProjection | null;
  projectHub: ProjectHubProjection | null;
  usage: UsageProjectionResult | null;
  hostDoctor: HostDoctorResult | null;
  host: HostProjectResult | null;
  diagnostics: ControlPlaneDiagnostic[];
  refreshedAt: string;
}

export interface ProjectControlPlaneQuery {
  project: ProjectId;
  profileId?: AgentProfileId;
  threadId?: ThreadId;
  proposalId?: MemoryProposalId;
  delegationId?: string;
  hostAuthorization?: HostAuthorizationReferences;
}

export interface DreamTimeDecisionRequest {
  project: ProjectId;
  profileId: AgentProfileId;
  proposalId: MemoryProposalId;
  presentedFingerprint: string;
  expectedRevision: number;
  actor: string;
  reason?: string;
}

export interface DreamTimeDecisionResult {
  status: "approved" | "rejected" | "stale" | "expired";
  idempotent: boolean;
  revision: MemoryRevision | null;
}

export interface PromotionHandoffRequest {
  project: ProjectId;
  profileId: AgentProfileId;
  proposalId: MemoryProposalId;
  proposalFingerprint: string;
  candidateDiff: CandidateDiff[];
  provenance: ProvenanceRef[];
  actor: string;
}

export interface PromotionHandoffResult {
  candidateId: string;
  reviewPath?: string;
  status: "created" | "existing" | "rejected";
}

export interface DelegationApprovalRequest {
  project: ProjectId;
  planId: string;
  presentedFingerprint: string;
  expectedRevision: number;
  approvedExternalClasses: Array<"external-write" | "external-delete" | "external-execute">;
  actor: string;
}

export interface ControlPlaneIdempotencyInput {
  operation: "dreamtime.approve" | "dreamtime.reject" | "delegation.approve";
  project: ProjectId;
  subject: string;
  fingerprint: string;
  expectedRevision: number;
  actor: string;
  action: "approve" | "reject";
  approvedExternalClasses?: ReadonlyArray<"external-write" | "external-delete" | "external-execute">;
}

export interface DelegationApprovalResult {
  idempotent: boolean;
  child: ChildWorkRun;
  grant: CapabilityGrant;
}

interface DelegationReadResult {
  plan: AgentDelegationPlan;
  child: ChildWorkRun | null;
}

export interface SecretReferenceSelection {
  settingKey: string;
  reference: SecretReference;
}

export class ControlPlaneContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ControlPlaneContractError";
  }
}

/**
 * Thin, stateless client over backend-owned records. Every read is fresh and
 * every mutation returns backend state; the plugin never mirrors approval.
 */
export class AgentControlPlaneClient {
  constructor(private readonly transport: AgentControlPlaneTransport) {}

  async listProfiles(): Promise<AgentProfile[]> {
    return (await this.invoke<AgentProfileListResult>(CONTROL_PLANE_OPERATIONS.profileList, {})).profiles;
  }

  readProfile(profileId: AgentProfileId): Promise<AgentProfile> {
    return this.invoke(CONTROL_PLANE_OPERATIONS.profileRead, { profileId });
  }

  createProfile(input: AgentProfileCreate): Promise<StoreMutationResult<AgentProfile>> {
    return this.mutate(CONTROL_PLANE_OPERATIONS.profileCreate, { input });
  }

  updateProfile(profileId: AgentProfileId, expectedRevision: number, patch: AgentProfilePatch, actor: string): Promise<StoreMutationResult<AgentProfile>> {
    return this.mutate(CONTROL_PLANE_OPERATIONS.profileUpdate, { profileId, expectedRevision, patch, actor });
  }

  async listBindings(project: ProjectId): Promise<ProjectAgentBinding[]> {
    return (await this.invoke<ProjectAgentBindingListResult>(CONTROL_PLANE_OPERATIONS.bindingList, { project })).bindings;
  }

  readBinding(bindingId: ProjectAgentBindingId): Promise<ProjectAgentBinding> {
    return this.invoke(CONTROL_PLANE_OPERATIONS.bindingRead, { bindingId });
  }

  createBinding(input: ProjectAgentBindingCreate): Promise<StoreMutationResult<ProjectAgentBinding>> {
    return this.mutate(CONTROL_PLANE_OPERATIONS.bindingCreate, { input });
  }

  updateBinding(bindingId: ProjectAgentBindingId, expectedRevision: number, patch: ProjectAgentBindingPatch, actor: string): Promise<StoreMutationResult<ProjectAgentBinding>> {
    return this.mutate(CONTROL_PLANE_OPERATIONS.bindingUpdate, { bindingId, expectedRevision, patch, actor });
  }

  async listThreads(project: ProjectId, profileId?: AgentProfileId): Promise<Thread[]> {
    return (await this.invoke<ThreadListResult>(CONTROL_PLANE_OPERATIONS.threadList, { project, ...(profileId ? { profileId } : {}) })).threads;
  }

  room(project: ProjectId, profileId: AgentProfileId, threadId?: ThreadId): Promise<RoomProjection> {
    return this.invoke(CONTROL_PLANE_OPERATIONS.roomGet, { project, profileId, ...(threadId ? { threadId } : {}) });
  }

  readProposal(project: ProjectId, profileId: AgentProfileId, proposalId: MemoryProposalId): Promise<DreamTimeProposalProjection> {
    return this.invoke<DreamTimeProposalReadResult>(CONTROL_PLANE_OPERATIONS.dreamTimeProposalRead, {
      project,
      profileId,
      proposalId,
    }).then(result => result.proposal);
  }

  revisionHistory(project: ProjectId, profileId: AgentProfileId): Promise<DreamTimeRevisionHistoryResult> {
    return this.invoke(CONTROL_PLANE_OPERATIONS.dreamTimeRevisionHistory, { project, profileId });
  }

  dreamTimeDoctor(project: ProjectId, profileId?: AgentProfileId): Promise<DreamTimeDoctorResult> {
    return this.invoke(CONTROL_PLANE_OPERATIONS.dreamTimeDoctor, { project, ...(profileId ? { profileId } : {}) });
  }

  approveDreamTime(request: DreamTimeDecisionRequest): Promise<DreamTimeDecisionResult> {
    return this.mutate(CONTROL_PLANE_OPERATIONS.dreamTimeApprove, {
      ...request,
      transitionToken: controlPlaneIdempotencyToken({
        operation: CONTROL_PLANE_OPERATIONS.dreamTimeApprove,
        project: request.project,
        subject: request.proposalId,
        fingerprint: request.presentedFingerprint,
        expectedRevision: request.expectedRevision,
        actor: request.actor,
        action: "approve",
        approvedExternalClasses: [],
      }),
    });
  }

  rejectDreamTime(request: DreamTimeDecisionRequest): Promise<DreamTimeDecisionResult> {
    return this.mutate(CONTROL_PLANE_OPERATIONS.dreamTimeReject, {
      ...request,
      transitionToken: controlPlaneIdempotencyToken({
        operation: CONTROL_PLANE_OPERATIONS.dreamTimeReject,
        project: request.project,
        subject: request.proposalId,
        fingerprint: request.presentedFingerprint,
        expectedRevision: request.expectedRevision,
        actor: request.actor,
        action: "reject",
        approvedExternalClasses: [],
      }),
    });
  }

  handoffPromotion(request: PromotionHandoffRequest): Promise<PromotionHandoffResult> {
    return this.mutate(CONTROL_PLANE_OPERATIONS.dreamTimePromotionHandoff, request);
  }

  async executeConsult(request: ConsultExecutionRequest): Promise<ConsultProjection> {
    const execution = await this.mutate<ConsultExecutionBackendResult>(CONTROL_PLANE_OPERATIONS.consultExecute, request);
    return {
      consultId: execution.result.resultId,
      requestingWorkRunId: execution.result.requestingWorkRunId,
      requestingProfileId: request.request.requestingAgent.profileId,
      targetProfileId: execution.result.targetAgent.profileId,
      targetRevisionId: execution.result.consultedRevision.revisionId,
      targetFingerprint: execution.result.consultedRevision.fingerprint,
      stale: execution.result.staleForCurrentContextOperations,
      warnings: execution.result.warnings,
      artifact: artifactProjection(execution.result.artifact),
      idempotent: execution.idempotent,
    };
  }

  async planDelegation(request: Record<string, unknown>): Promise<DelegationPlanProjection> {
    const plan = await this.mutate<AgentDelegationPlan>(CONTROL_PLANE_OPERATIONS.delegationPlan, request);
    return delegationProjection({ plan, child: null });
  }

  async readDelegation(project: ProjectId, planId: string): Promise<DelegationPlanProjection> {
    return delegationProjection(await this.invoke<DelegationReadResult>(CONTROL_PLANE_OPERATIONS.delegationRead, { project, planId }));
  }

  approveDelegation(request: DelegationApprovalRequest): Promise<DelegationApprovalResult> {
    const approvedExternalClasses = [...new Set(request.approvedExternalClasses)].sort();
    return this.mutate(CONTROL_PLANE_OPERATIONS.delegationApprove, {
      ...request,
      approvedExternalClasses,
      transitionToken: controlPlaneIdempotencyToken({
        operation: CONTROL_PLANE_OPERATIONS.delegationApprove,
        project: request.project,
        subject: request.planId,
        fingerprint: request.presentedFingerprint,
        expectedRevision: request.expectedRevision,
        actor: request.actor,
        action: "approve",
        approvedExternalClasses,
      }),
    });
  }

  projectHub(project: ProjectId): Promise<ProjectHubProjection> {
    return this.invoke(CONTROL_PLANE_OPERATIONS.projectHubGet, { ref: project });
  }

  usageProject(project: ProjectId): Promise<UsageProjectionResult> {
    return this.invoke(CONTROL_PLANE_OPERATIONS.usageProject, {
      project,
      groupBy: ["agent", "provider", "model", "device", "operation"],
    });
  }

  registerHostDescriptor(registration: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.mutate(CONTROL_PLANE_OPERATIONS.hostDescriptorRegister, { registration });
  }

  async listHostDescriptors(): Promise<Array<Record<string, unknown>>> {
    const result = await this.invoke<{ registrations: Array<Record<string, unknown>> }>(CONTROL_PLANE_OPERATIONS.hostDescriptorList, {});
    return result.registrations;
  }

  readHostDescriptor(descriptorId: string, descriptorVersion: string): Promise<Record<string, unknown>> {
    return this.invoke(CONTROL_PLANE_OPERATIONS.hostDescriptorRead, { descriptorId, descriptorVersion });
  }

  registerHostConnector(registration: Record<string, unknown>, project?: ProjectId): Promise<Record<string, unknown>> {
    const configuration = registration.configuration;
    if (
      configuration !== undefined
      && (!configuration || typeof configuration !== "object" || Array.isArray(configuration)
        || Object.keys(configuration as Record<string, unknown>).length > 0)
    ) {
      throw new ControlPlaneContractError(
        "Host Connector runtime configuration is owned by LLM Wiki Settings; the plugin may submit only an empty configuration object",
      );
    }
    return this.mutate(CONTROL_PLANE_OPERATIONS.hostConnectorRegister, {
      registration,
      ...(project ? { project } : {}),
    });
  }

  async listHostConnectors(project?: ProjectId): Promise<Array<Record<string, unknown>>> {
    const result = await this.invoke<{ registrations: Array<Record<string, unknown>> }>(
      CONTROL_PLANE_OPERATIONS.hostConnectorList,
      project ? { project } : {},
    );
    return result.registrations;
  }

  readHostConnector(connectorId: string, connectorVersion: string, project?: ProjectId): Promise<Record<string, unknown>> {
    return this.invoke(CONTROL_PLANE_OPERATIONS.hostConnectorRead, {
      connectorId,
      connectorVersion,
      ...(project ? { project } : {}),
    });
  }

  planHostAssignment(request: Record<string, unknown>): Promise<HostAssignmentPlanResponse> {
    return this.mutate(CONTROL_PLANE_OPERATIONS.hostAssignmentPlan, request);
  }

  approveHostAssignment(request: Record<string, unknown>): Promise<HostAssignmentPlanResponse> {
    return this.mutate(CONTROL_PLANE_OPERATIONS.hostAssignmentApprove, request);
  }

  readHostAssignment(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.invoke(CONTROL_PLANE_OPERATIONS.hostAssignmentRead, request);
  }

  searchHostCapabilities(request: Record<string, unknown>): Promise<HostCapabilitySearchResponse> {
    return this.invoke(CONTROL_PLANE_OPERATIONS.hostProxySearch, request);
  }

  describeHostCapability(request: Record<string, unknown>): Promise<HostCapabilityDescriptionResponse> {
    return this.invoke(CONTROL_PLANE_OPERATIONS.hostProxyDescribe, request);
  }

  invokeHostCapability(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.mutate(CONTROL_PLANE_OPERATIONS.hostProxyInvoke, request);
  }

  hostDoctor(project?: ProjectId): Promise<HostDoctorResult> {
    return this.invoke(CONTROL_PLANE_OPERATIONS.hostDoctor, project ? { project } : {});
  }

  hostProject(project: ProjectId, authorization: NonNullable<ProjectControlPlaneQuery["hostAuthorization"]>): Promise<HostProjectResult> {
    return this.invoke(CONTROL_PLANE_OPERATIONS.hostProject, { project, ...authorization });
  }

  private invoke<T>(operation: string, args: Record<string, unknown>): Promise<T> {
    return this.transport.invoke<T>(operation, args);
  }

  private mutate<T>(operation: string, args: object): Promise<T> {
    assertSafeControlPlaneMutation(args);
    return this.invoke(operation, args as Record<string, unknown>);
  }
}

export async function refreshAgentControlPlaneProjection(
  client: AgentControlPlaneClient,
  query: ProjectControlPlaneQuery,
  now = new Date(),
): Promise<AgentControlPlaneProjection> {
  const requests: Array<Promise<unknown>> = [
    client.listProfiles(),
    client.listBindings(query.project),
    client.listThreads(query.project, query.profileId),
    query.profileId ? client.room(query.project, query.profileId, query.threadId) : Promise.resolve(null),
    query.profileId ? client.dreamTimeDoctor(query.project, query.profileId) : Promise.resolve(null),
    query.profileId ? client.revisionHistory(query.project, query.profileId) : Promise.resolve(null),
    query.profileId && query.proposalId
      ? client.readProposal(query.project, query.profileId, query.proposalId)
      : Promise.resolve(null),
    query.delegationId ? client.readDelegation(query.project, query.delegationId) : Promise.resolve(null),
    client.projectHub(query.project),
    client.usageProject(query.project),
    client.hostDoctor(query.project),
    query.hostAuthorization
      ? client.hostProject(query.project, query.hostAuthorization)
      : Promise.resolve(null),
  ];
  const results = await Promise.allSettled(requests);
  const diagnostics: ControlPlaneDiagnostic[] = [];
  const value = <T>(index: number, fallback: T, code: string): T => {
    const result = results[index];
    if (result?.status === "fulfilled") return result.value as T;
    diagnostics.push({
      code,
      severity: "warning",
      message: safePresentationText((result?.reason as Error)?.message ?? result?.reason ?? "backend operation unavailable"),
      remediationKey: "retry-backend-operation",
    });
    return fallback;
  };
  return {
    projectId: query.project,
    profileId: query.profileId,
    threadId: query.threadId,
    profiles: value(0, [], "agent-profile-list-unavailable"),
    bindings: value(1, [], "agent-binding-list-unavailable"),
    threads: value(2, [], "agent-thread-list-unavailable"),
    room: value(3, null, "agent-room-unavailable"),
    dreamTimeDoctor: value(4, null, "dreamtime-doctor-unavailable"),
    revisionHistory: value(5, null, "dreamtime-history-unavailable"),
    proposal: value(6, null, "dreamtime-proposal-unavailable"),
    delegation: value(7, null, "delegation-plan-unavailable"),
    projectHub: value(8, null, "project-hub-unavailable"),
    usage: value(9, null, "usage-projection-unavailable"),
    hostDoctor: value(10, null, "host-doctor-unavailable"),
    host: value(11, null, "host-projection-unavailable"),
    diagnostics,
    refreshedAt: now.toISOString(),
  };
}

export function assertSecretReferenceSelection(value: SecretReferenceSelection): void {
  if (!value.settingKey.trim()) throw new ControlPlaneContractError("Secret Reference setting key is required");
  const provider = value.reference.provider;
  if (!new Set(["environment", "os-keychain", "external-vault"]).has(provider)) {
    throw new ControlPlaneContractError("Secret Reference provider is unsupported");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(value.reference.locator)) {
    throw new ControlPlaneContractError("Secret Reference locator must be a logical locator, not a secret value");
  }
  if (/^(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|xox[baprs]-|AKIA[A-Z0-9]{12,})/.test(value.reference.locator)) {
    throw new ControlPlaneContractError("Secret Reference locator resembles a plaintext credential");
  }
  assertSafeControlPlaneMutation(value);
}

/**
 * Deterministic, non-secret idempotency key for a single semantic transition.
 * It is recomputed for every click/retry and is never retained as plugin state.
 */
export function controlPlaneIdempotencyToken(input: ControlPlaneIdempotencyInput): string {
  if (!input.operation || !input.project || !input.subject || !input.fingerprint || !input.actor || !input.action) {
    throw new ControlPlaneContractError("Idempotency token semantics are incomplete");
  }
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new ControlPlaneContractError("Idempotency token expectedRevision must be a non-negative integer");
  }
  const approvedExternalClasses = [...new Set(input.approvedExternalClasses ?? [])].sort();
  const material = JSON.stringify({
    schema: "llmwiki.control-plane-idempotency",
    version: 1,
    operation: input.operation,
    project: input.project,
    subject: input.subject,
    fingerprint: input.fingerprint,
    expectedRevision: input.expectedRevision,
    actor: input.actor,
    action: input.action,
    approvedExternalClasses,
  });
  return `llmwiki-v1-${createHash("sha256").update(material).digest("hex")}`;
}

const UNSAFE_CONTROL_PLANE_KEY = /(?:prompt(?:body|text)?|responseBody|processHandle)/i;
const SAFE_TOKEN_FIELDS = new Set(["transitiontoken"]);
const CREDENTIAL_TOKEN_FIELD = /^(?:token|access|refresh|session|bearer|id|oauth|oauth2|oauthaccess|oauth2access|oauthrefresh|oauth2refresh|oauthbearer|oauth2bearer|oauthid|oauth2id)token$/;
const WINDOWS_PATH = /^[A-Za-z]:[\\/]/;
const POSIX_ABSOLUTE_PATH = /^\/(?!\/)/;
const UNC_PATH = /^\\\\[^\\]/;

function normalizedFieldName(key: string): string {
  return key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

/** Shared mutation/presentation classifier for fields that can carry usable credentials. */
function isSensitiveCredentialField(key: string): boolean {
  const normalized = normalizedFieldName(key);
  if (SAFE_TOKEN_FIELDS.has(normalized)) return false;
  if (CREDENTIAL_TOKEN_FIELD.test(normalized)) return true;
  if (
    normalized.includes("authorization")
    || normalized.includes("cookie")
    || normalized.includes("password")
    || normalized.includes("passphrase")
    || normalized.endsWith("apikey")
    || normalized.endsWith("privatekey")
    || normalized.endsWith("clientsecret")
    || normalized === "leasetoken"
    || normalized === "granttoken"
  ) return true;
  return normalized.startsWith("secret")
    && !normalized.startsWith("secretreference")
    && !normalized.startsWith("secretref")
    && !normalized.startsWith("secretrequired");
}

function isUnsafeControlPlaneField(key: string): boolean {
  return UNSAFE_CONTROL_PLANE_KEY.test(key) || isSensitiveCredentialField(key);
}

export function assertSafeControlPlaneMutation(value: unknown, path = "request"): void {
  if (typeof value === "string") {
    if (/\bBearer\s+\S+/i.test(value)) throw new ControlPlaneContractError(`${path} must not contain bearer credentials`);
    if (WINDOWS_PATH.test(value) || POSIX_ABSOLUTE_PATH.test(value) || UNC_PATH.test(value)) {
      throw new ControlPlaneContractError(`${path} must not contain a machine-local absolute path`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeControlPlaneMutation(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (key !== "authorizationDecision" && isUnsafeControlPlaneField(key)) {
      throw new ControlPlaneContractError(`${path}.${key} is forbidden; use a backend Secret Reference or opaque approval operation`);
    }
    assertSafeControlPlaneMutation(item, `${path}.${key}`);
  }
}

function delegationProjection(result: DelegationReadResult): DelegationPlanProjection {
  const { plan, child } = result;
  const scope = plan.requestedCapabilityScope;
  return {
    planId: plan.planId,
    revision: child?.revision ?? 1,
    projectId: plan.projectId,
    parentWorkRunId: plan.parentWorkRunId,
    objective: plan.objective,
    candidateProfileId: plan.assignment.profileId,
    capabilityScope: [
      ...scope.connectors.map(value => `connector:${value}`),
      ...scope.operations.map(value => `operation:${value}`),
      ...scope.resources.map(value => `resource:${value}`),
    ],
    budget: {
      amount: plan.budget.maxCostMinorUnits,
      currency: plan.budget.currency,
      policyVersion: plan.budget.policyVersion,
      decision: child ? "allowed" : undefined,
    },
    device: {
      deviceId: plan.assignment.deviceSnapshot.deviceId,
      resourceClass: undefined,
      health: undefined,
    },
    sideEffectClasses: [...scope.sideEffectClasses],
    expiresAt: plan.expiresAt,
    expectedOutput: `${plan.expectedOutput.outputClass} · ${plan.expectedOutput.mediaType} · ${plan.expectedOutput.requiredArtifactCount} artifact(s)`,
    fingerprint: plan.fingerprint,
    approval: { status: child ? "approved" : "pending" },
    child: child ? { workRunId: child.workRunId, status: child.lifecycle } : undefined,
    artifacts: child?.artifacts.map(artifactProjection) ?? [],
    diagnostics: [],
  };
}

function artifactProjection(artifact: AgentArtifactProjection): ArtifactProjection {
  return {
    artifactId: artifact.artifactId,
    producerProfileId: artifact.producer.profileId,
    sourceWorkRunId: artifact.sourceWorkRunId,
    contextFingerprint: artifact.contextFingerprint,
    inputReferences: artifact.inputArtifactIds,
    contentHash: artifact.contentHash,
    outputClassification: artifact.outputClass,
    reviewState: artifact.promotionReview.state,
    provenance: artifact.provenance,
  };
}

function recordValues(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function stringValues(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const EMBEDDED_CREDENTIAL = /(?:\bBearer\s+\S+|\bsk-(?:proj-)?[A-Za-z0-9_-]{8,}|\bgh[pousr]_[A-Za-z0-9]{8,}|\bxox[baprs]-\S+|\bAKIA[A-Z0-9]{12,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/i;
const EMBEDDED_WINDOWS_PATH = /(?:^|[\s('"`])(?:[A-Za-z]:[\\/]|\\\\[^\\\s]+\\)[^\s'"`)]+/;
const EMBEDDED_POSIX_PATH = /(?:^|[\s('"`])\/(?:Users|home|root|var|etc|opt|private|tmp)(?:\/[^\s'"`)]+)+/;
const EMBEDDED_SECRET_FIELD = /\b(?:authorization|cookie|password|passphrase|api[-_]?key|private[-_]?key|client[-_]?secret|secret(?:Value|Text)?|lease[-_]?token|grant[-_]?token|token|(?:access|refresh|session|bearer|id)[-_]?token|oauth2?[-_]?(?:(?:access|refresh|bearer|id)[-_]?)?token)\s*[:=]/i;
const EMBEDDED_CREDENTIAL_URL = /(?:^|\s)https?:\/\/[^\s/@:]+:[^\s/@]+@/i;
const SAFE_SUMMARY_MAX_DEPTH = 5;
const SAFE_SUMMARY_MAX_ARRAY_ITEMS = 50;
const SAFE_SUMMARY_MAX_OBJECT_KEYS = 50;
const SAFE_SUMMARY_MAX_STRING_CHARS = 2_000;
const SAFE_SUMMARY_MAX_CHARS = 50_000;

function unsafePresentationValue(value: string): boolean {
  return EMBEDDED_CREDENTIAL.test(value)
    || EMBEDDED_WINDOWS_PATH.test(value)
    || EMBEDDED_POSIX_PATH.test(value)
    || EMBEDDED_SECRET_FIELD.test(value)
    || EMBEDDED_CREDENTIAL_URL.test(value);
}

/** Redact untrusted backend text before it reaches Obsidian diagnostics or Notices. */
export function safePresentationText(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "Backend operation unavailable";
  if (unsafePresentationValue(text)) return "[redacted unsafe value]";
  return text.slice(0, 1_000);
}

/** Produce a bounded, redacted summary for open-ended backend projections. */
export function safeSummary(value: unknown): string {
  const sanitize = (item: unknown, depth: number): unknown => {
    if (depth > SAFE_SUMMARY_MAX_DEPTH) return "[truncated: nested projection omitted]";
    if (Array.isArray(item)) {
      const projected = item.slice(0, SAFE_SUMMARY_MAX_ARRAY_ITEMS).map(entry => sanitize(entry, depth + 1));
      if (item.length > SAFE_SUMMARY_MAX_ARRAY_ITEMS) {
        projected.push(`[truncated: ${item.length - SAFE_SUMMARY_MAX_ARRAY_ITEMS} array items omitted]`);
      }
      return projected;
    }
    if (typeof item === "string") {
      if (unsafePresentationValue(item)) return "[redacted unsafe value]";
      if (item.length <= SAFE_SUMMARY_MAX_STRING_CHARS) return item;
      const marker = `… [truncated: ${item.length - SAFE_SUMMARY_MAX_STRING_CHARS} characters omitted]`;
      return `${item.slice(0, Math.max(0, SAFE_SUMMARY_MAX_STRING_CHARS - marker.length))}${marker}`;
    }
    if (!item || typeof item !== "object") return item;
    const projected: Record<string, unknown> = {};
    let included = 0;
    let truncated = false;
    for (const key in item as Record<string, unknown>) {
      if (!Object.prototype.hasOwnProperty.call(item, key) || isUnsafeControlPlaneField(key)) continue;
      if (included >= SAFE_SUMMARY_MAX_OBJECT_KEYS) {
        truncated = true;
        break;
      }
      projected[key] = sanitize((item as Record<string, unknown>)[key], depth + 1);
      included += 1;
    }
    if (truncated) {
      projected["[truncated]"] = "additional object fields omitted";
    }
    return projected;
  };
  const summary = JSON.stringify(sanitize(value, 0), null, 2) ?? "null";
  if (summary.length <= SAFE_SUMMARY_MAX_CHARS) return summary;
  const marker = `\n[truncated: summary exceeded ${SAFE_SUMMARY_MAX_CHARS} characters]`;
  return `${summary.slice(0, SAFE_SUMMARY_MAX_CHARS - marker.length)}${marker}`;
}
