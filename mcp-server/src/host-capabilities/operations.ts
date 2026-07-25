import { join } from "node:path";

import {
  AgentDomainService,
  DelegationStore,
  canonicalJson,
  type CapabilityGrant as AgentCapabilityGrant,
  type ChildWorkRun,
  type ProjectAgentBinding,
  type ProjectAgentBindingId,
  type ProjectId,
} from "../../../packages/agent-domain/dist/src/index.js";
import {
  type HostCapabilityInvocationProfile,
  type SettingsService,
} from "../../../packages/settings-platform/dist/src/index.js";
import type { Operation, OperationContext } from "../core/types.js";
import {
  badRequest,
  conflict,
  internal,
  isOperationError,
  notFound,
} from "../core/types.js";
import {
  normalizedProjectContext,
  resolveProjectContext,
} from "../project/project-context.js";
import { planAssignment } from "./assignment.js";
import {
  HOST_CAPABILITY_SCHEMA_VERSION,
  type AssignmentPlan,
  type CapabilityOperationGrant,
  type Sha256Digest,
  HostCapabilityContractError,
  connectorKey,
  descriptorKey,
  fingerprintContract,
} from "./contracts.js";
import {
  HostCapabilityOperationContractError,
  type HostCapabilityConnectorRegistration,
  type ProjectCapabilityBinding,
  validateAssignmentRequirement,
  validateCapabilityGrant,
  validateConnectorRegistration,
  validateDescriptorRegistration,
  validateDeviceAdvertisements,
  validateProjectCapabilityBinding,
  validateProjectCapabilityPolicy,
} from "./operation-contracts.js";
import {
  GovernedMcpProxy,
  HostCapabilityProxyError,
  type ProxyScope,
} from "./proxy.js";
import {
  ExpertDescriptorRegistry,
  HostCapabilityConnectorRegistry,
  HostCapabilityRegistryError,
  type HostCapabilityConnectorRuntime,
} from "./registry.js";
import {
  HOST_CAPABILITY_RELATIVE_ROOT,
  HostCapabilityStore,
  HostCapabilityStoreError,
  hostCapabilityStorageKey,
} from "./store.js";
import { legacyHostCapabilityCandidates } from "./settings-resolution.js";
import { createSettingsService } from "../settings/settings.js";
import {
  PluginDiagnosticContractError,
  submitPluginDiagnosticReportToProblemIntake,
  validatePluginDiagnosticReport,
  type PluginDiagnosticObservationReceipt,
  type ProblemIntakeDiagnosticCandidate,
} from "./plugin-diagnostics/index.js";

const HOST_NAMESPACE = "host" as Operation["namespace"];
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const APPROVER_ROLES = new Set(["human", "approver", "admin"]);
const DESCRIPTOR_RESOURCE_PREFIX = "descriptor/";

export type HostCapabilityTransportFactory = (
  registration: HostCapabilityConnectorRegistration,
) => Promise<HostCapabilityConnectorRuntime>;

export interface HostCapabilityOperationsOptions {
  transportFactory?: HostCapabilityTransportFactory;
  now?: () => number;
  settingsService?: SettingsService;
  environment?: NodeJS.ProcessEnv;
  observePluginDiagnostic?: (
    candidate: ProblemIntakeDiagnosticCandidate,
  ) => Promise<PluginDiagnosticObservationReceipt>;
}

interface AuthorizedProject {
  projectId: string;
  binding: ProjectCapabilityBinding;
  grant: CapabilityOperationGrant;
  scope: ProxyScope;
}

interface RuntimeSnapshot {
  descriptors: ExpertDescriptorRegistry;
  connectors: HostCapabilityConnectorRegistry;
  connectorRegistrations: Map<string, HostCapabilityConnectorRegistration>;
  proxy: GovernedMcpProxy;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw badRequest(`${field} is required`);
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, field);
}

function optionalCanonicalProject(
  vaultPath: string,
  value: unknown,
  operation: string,
): string | undefined {
  if (value === undefined) return undefined;
  const project = requiredString(value, "project");
  const context = resolveProjectContext(vaultPath, project, operation);
  if (project !== context.projectId) {
    throw conflict("Host Capability Settings context requires the canonical Project ID", {
      projectId: context.projectId,
    });
  }
  return context.projectId;
}

function proxyInvokeWriteTargets(
  vaultPath: string,
  params: Record<string, unknown>,
): string[] {
  const targets = ["external/host-capability/**"];
  if (
    typeof params.operation !== "string" ||
    !params.operation.endsWith(".diagnostics.read")
  ) {
    return targets;
  }
  const projectId = optionalCanonicalProject(
    vaultPath,
    params.project,
    "host.proxy.invoke",
  );
  if (!projectId) throw badRequest("project is required");
  return [
    ...targets,
    `01-Projects/${projectId.slice("project/".length)}/problem-intake/**`,
  ];
}

function closedParams(
  params: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const names = new Set(allowed);
  for (const key of Object.keys(params)) {
    if (!names.has(key)) throw badRequest(`Unsupported Host Capability parameter: ${key}`);
  }
}

function operationFailure(error: unknown): never {
  if (isOperationError(error)) throw error;
  if (error instanceof HostCapabilityStoreError) {
    if (error.code === "not_found") throw notFound(error.message, { logicalId: error.logicalId });
    if (error.code === "conflict") throw conflict(error.message, { logicalId: error.logicalId });
    throw internal("Host Capability store validation failed closed", {
      logicalId: error.logicalId,
    });
  }
  if (error instanceof HostCapabilityRegistryError) {
    if (error.code === "descriptor_not_found" || error.code === "connector_not_found") {
      throw notFound(error.message);
    }
    if (error.code === "registry_conflict") throw conflict(error.message);
    throw internal("Host Capability connector failed closed");
  }
  if (error instanceof HostCapabilityProxyError) {
    throw conflict(error.message, { diagnostic: error.diagnostic });
  }
  if (
    error instanceof HostCapabilityOperationContractError ||
    error instanceof HostCapabilityContractError ||
    error instanceof PluginDiagnosticContractError ||
    error instanceof TypeError
  ) {
    throw badRequest(error.message);
  }
  throw internal("Host Capability operation failed closed");
}

function boundary<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    operationFailure(error);
  }
}

async function asyncBoundary<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    operationFailure(error);
  }
}

function descriptorTarget(params: Record<string, unknown>): string {
  const registration = validateDescriptorRegistration(params.registration);
  return hostCapabilityStorageKey(
    "descriptors",
    descriptorKey(
      registration.descriptor.descriptorId,
      registration.descriptor.descriptorVersion,
    ),
  );
}

function connectorTarget(params: Record<string, unknown>): string {
  const registration = validateConnectorRegistration(params.registration);
  return hostCapabilityStorageKey(
    "connectors",
    connectorKey(
      registration.connector.connectorId,
      registration.connector.connectorVersion,
    ),
  );
}

function assignmentTarget(params: Record<string, unknown>): string {
  return hostCapabilityStorageKey(
    "assignments",
    requiredString(params.planId, "planId"),
  );
}

function authenticatedApprover(ctx: OperationContext, subject = "Capability registration"): string {
  const actor = ctx.config.collaboration?.actor?.trim();
  const role = ctx.config.collaboration?.role ?? "";
  if (!actor || !APPROVER_ROLES.has(role)) {
    throw conflict(
      `${subject} requires an authenticated human, approver, or admin actor`,
    );
  }
  return actor;
}

function serverApprovedConnectorRegistration(
  value: unknown,
  actor: string,
  approvedAt: string,
): HostCapabilityConnectorRegistration {
  const registration = validateConnectorRegistration(value);
  const provenance = registration.connector.importProvenance;
  if (
    provenance.licenseReview.status !== "approved" ||
    provenance.approval.status !== "approved"
  ) {
    throw conflict(
      "Host Capability Connector registration requires approved license and import review status",
    );
  }
  return validateConnectorRegistration({
    ...registration,
    connector: {
      ...registration.connector,
      importProvenance: {
        ...provenance,
        licenseReview: {
          ...provenance.licenseReview,
          reviewedBy: actor,
          reviewedAt: approvedAt,
        },
        approval: {
          ...provenance.approval,
          reviewedBy: actor,
          reviewedAt: approvedAt,
        },
      },
    },
  });
}

function serverApprovedDescriptorRegistration(
  value: unknown,
  actor: string,
  approvedAt: string,
) {
  const registration = validateDescriptorRegistration(value);
  const provenance = registration.descriptor.importProvenance;
  if (
    provenance.licenseReview.status !== "approved" ||
    provenance.approval.status !== "approved"
  ) {
    throw conflict(
      "Expert Descriptor registration requires approved license and import review status",
    );
  }
  return validateDescriptorRegistration({
    ...registration,
    descriptor: {
      ...registration.descriptor,
      importProvenance: {
        ...provenance,
        licenseReview: {
          ...provenance.licenseReview,
          reviewedBy: actor,
          reviewedAt: approvedAt,
        },
        approval: {
          status: "approved",
          reviewedBy: actor,
          reviewedAt: approvedAt,
        },
      },
    },
  });
}

function grantedDescriptorKeys(grant: AgentCapabilityGrant): string[] {
  return [...new Set(
    grant.scope.resources
      .filter(resource => resource.startsWith(DESCRIPTOR_RESOURCE_PREFIX))
      .map(resource => resource.slice(DESCRIPTOR_RESOURCE_PREFIX.length))
      .filter(Boolean),
  )].sort();
}

class HostCapabilityOperationService {
  readonly store: HostCapabilityStore;
  readonly #transportFactory: HostCapabilityTransportFactory;
  readonly #now: () => number;
  readonly #settingsService: SettingsService;
  readonly #agentDomain: AgentDomainService;
  readonly #agentStateRoot: string;
  readonly #environment: NodeJS.ProcessEnv;

  constructor(
    readonly vaultPath: string,
    options: HostCapabilityOperationsOptions,
  ) {
    this.store = new HostCapabilityStore(vaultPath);
    this.#now = options.now ?? Date.now;
    this.#environment = options.environment ?? process.env;
    this.#settingsService = options.settingsService ?? createSettingsService({
      vaultPath,
      environment: this.#environment,
    });
    this.#agentStateRoot = join(vaultPath, "_llmwiki", "agent-domain", "v1");
    this.#agentDomain = new AgentDomainService({ stateRoot: this.#agentStateRoot });
    this.#transportFactory =
      options.transportFactory ??
      (async () => {
        throw new Error("No Host Capability transport factory is configured");
      });
  }

  now(): number {
    return this.#now();
  }

  async authorize(
    params: Record<string, unknown>,
    operation: string,
  ): Promise<AuthorizedProject> {
    const projectRef = requiredString(params.project, "project");
    const context = resolveProjectContext(this.vaultPath, projectRef, operation);
    if (projectRef !== context.projectId) {
      throw conflict(
        "Host Capability operations require the canonical Project ID, not an alias or workspace path",
        { projectId: context.projectId },
      );
    }
    const bindingId = requiredString(params.bindingId, "bindingId") as ProjectAgentBindingId;
    const grantId = requiredString(params.grantId, "grantId") as AgentCapabilityGrant["grantId"];
    const binding = await this.#agentDomain.bindings.read(bindingId);
    if (!binding) throw notFound(`Server-side Project Agent Binding ${bindingId} does not exist`);
    const grantRecord = await this.delegationStore(context.projectId).readGrant(grantId);
    if (!grantRecord) throw notFound(`Server-issued Capability Grant ${grantId} does not exist`);
    const child = await this.delegationStore(context.projectId).readChild(grantRecord.workRunId);
    if (!child || !new Set(["ready", "running"]).has(child.lifecycle)) {
      throw conflict("Capability Grant Work Run is not an active server-issued Child Work Run");
    }
    const contextFingerprint = fingerprintContract(
      normalizedProjectContext(context),
    );
    if (binding.projectId !== context.projectId) {
      throw conflict("Project Agent Binding belongs to another Project", {
        expectedProjectId: context.projectId,
        bindingProjectId: binding.projectId,
      });
    }
    if (binding.projectContextFingerprint !== contextFingerprint) {
      throw conflict("Project Agent Binding context fingerprint is stale");
    }
    if (!binding.enabled) throw conflict("Project Agent Binding is disabled");
    if (!binding.connectorGrantRefs.includes(grantRecord.grantId)) {
      throw conflict("Project Agent Binding does not reference this Capability Grant");
    }
    if (grantRecord.projectId !== context.projectId) {
      throw conflict("Capability Grant belongs to another Project");
    }
    if (Date.parse(grantRecord.expiresAt) <= this.now()) {
      throw conflict("Capability Grant has expired");
    }
    await this.assertActiveAgentAssignment(binding, grantRecord, child);
    const descriptorKeys = grantedDescriptorKeys(child.grantSummary);
    const descriptorKeySet = new Set(descriptorKeys);
    const grant = validateCapabilityGrant({
      schemaVersion: HOST_CAPABILITY_SCHEMA_VERSION,
      grantId: grantRecord.grantId,
      projectId: grantRecord.projectId,
      workRunId: grantRecord.workRunId,
      descriptorIds: [...new Set(this.store.listDescriptors()
        .filter(item => descriptorKeySet.has(descriptorKey(
          item.descriptor.descriptorId,
          item.descriptor.descriptorVersion,
        )))
        .map(item => item.descriptor.descriptorId))],
      connectorIds: connectorIds(grantRecord),
      operations: grantRecord.scope.operations,
      sideEffectClasses: hostSideEffectClasses(grantRecord),
      expiresAt: grantRecord.expiresAt,
    });
    const projectedBinding = validateProjectCapabilityBinding({
      schemaVersion: 1,
      bindingId: binding.bindingId,
      projectId: binding.projectId,
      projectContextFingerprint: binding.projectContextFingerprint,
      profileId: binding.profileId,
      revision: binding.revision,
      enabled: binding.enabled,
      connectorGrantRefs: binding.connectorGrantRefs,
    });
    return {
      projectId: context.projectId,
      binding: projectedBinding,
      grant,
      scope: {
        projectId: context.projectId,
        workRunId: grant.workRunId,
        agentId: binding.profileId,
        descriptorKeys,
        grant,
      },
    };
  }

  private delegationStore(projectId: string): DelegationStore {
    return new DelegationStore({
      collaborationRoot: join(this.#agentStateRoot, "collaboration"),
      projectId: projectId as ProjectId,
    });
  }

  private async assertActiveAgentAssignment(
    binding: ProjectAgentBinding,
    grant: AgentCapabilityGrant,
    child: ChildWorkRun,
  ): Promise<void> {
    const exactBinding = await this.#agentDomain.bindings.readRevision(binding.bindingId, child.assignment.bindingRevision);
    const exactProfile = await this.#agentDomain.profiles.readRevision(grant.profileId, grant.profileRevision);
    const currentProfile = await this.#agentDomain.profiles.read(grant.profileId);
    if (!exactBinding || exactBinding.revision !== binding.revision
      || !exactProfile || !currentProfile || currentProfile.revision !== grant.profileRevision
      || child.projectId !== grant.projectId || child.workRunId !== grant.workRunId
      || child.assignment.bindingId !== binding.bindingId
      || child.assignment.bindingRevision !== binding.revision
      || child.assignment.profileId !== binding.profileId
      || child.assignment.profileId !== grant.profileId
      || child.assignment.profileRevision !== binding.profileRevision
      || child.assignment.profileRevision !== grant.profileRevision
      || canonicalJson(child.grantSummary) !== canonicalJson(grant)) {
      throw conflict("Capability Grant is not locked to the active server-side Binding, Profile, and Child Work Run");
    }
  }

  async settingsProfile(projectId?: string): Promise<HostCapabilityInvocationProfile> {
    const context = {
      ...this.#settingsService.defaultContext,
      ...(projectId ? { workspaceProjectId: projectId } : {}),
    };
    const profile = await this.#settingsService.hostCapabilityInvocationProfile(
      context,
      legacyHostCapabilityCandidates(this.vaultPath, projectId, this.#environment),
    );
    if (!profile.valid) {
      throw conflict("Host Capability Settings are invalid", {
        issueCodes: profile.issues.map(item => item.code),
      });
    }
    return profile;
  }

  async governedRegistration(
    value: unknown,
    projectId?: string,
  ): Promise<HostCapabilityConnectorRegistration> {
    assertClientConnectorConfigurationEmpty(value);
    const registration = validateConnectorRegistration(value);
    const profile = await this.settingsProfile(projectId);
    if (registration.connector.connectorId !== profile.connectorId) {
      throw conflict(
        `Connector ID must match the authoritative Settings connector ${profile.connectorId}`,
      );
    }
    return applySettingsProfile(registration, profile);
  }

  async listConnectors(projectId?: string): Promise<HostCapabilityConnectorRegistration[]> {
    const profile = await this.settingsProfile(projectId);
    return this.store.listConnectors().map(item => applySettingsProfile(item, profile));
  }

  async readConnector(
    connectorId: string,
    connectorVersion: string,
    projectId?: string,
  ): Promise<HostCapabilityConnectorRegistration> {
    const profile = await this.settingsProfile(projectId);
    return applySettingsProfile(this.store.readConnector(connectorId, connectorVersion), profile);
  }

  async runtime(projectId?: string): Promise<RuntimeSnapshot> {
    const descriptors = new ExpertDescriptorRegistry();
    const connectors = new HostCapabilityConnectorRegistry();
    const connectorRegistrations = new Map<
      string,
      HostCapabilityConnectorRegistration
    >();
    for (const registration of this.store.listDescriptors()) {
      const descriptor = registration.descriptor;
      descriptors.register(descriptor);
      descriptors.setHealth(
        descriptor.descriptorId,
        descriptor.descriptorVersion,
        registration.health,
      );
      if (registration.sourceObservation) {
        descriptors.observeSource(
          descriptor.descriptorId,
          descriptor.descriptorVersion,
          registration.sourceObservation,
        );
      }
    }
    for (const registration of await this.listConnectors(projectId)) {
      const connector = registration.connector;
      const key = connectorKey(
        connector.connectorId,
        connector.connectorVersion,
      );
      connectorRegistrations.set(key, registration);
      connectors.register(connector, async () => {
        if (registration.health.state === "disabled") {
          throw new Error("Host Capability connector is disabled by Settings");
        }
        if (registration.health.state === "unavailable") {
          throw new Error("Host Capability connector is unavailable under current Settings");
        }
        if (
          registration.configuration.secretRequired &&
          !registration.configuration.secretReference
        ) {
          throw new Error(
            "Required Secret Reference locator is not configured for connector",
          );
        }
        return this.#transportFactory(structuredClone(registration));
      });
      if (registration.sourceObservation) {
        connectors.observeSource(
          connector.connectorId,
          connector.connectorVersion,
          registration.sourceObservation,
        );
      }
    }
    return {
      descriptors,
      connectors,
      connectorRegistrations,
      proxy: new GovernedMcpProxy(descriptors, connectors, {
        now: this.#now,
      }),
    };
  }

  async plan(params: Record<string, unknown>) {
    const authorized = await this.authorize(params, "host.assignment.plan");
    const requirement = validateAssignmentRequirement(params.requirement);
    const policy = validateProjectCapabilityPolicy(params.policy);
    const devices = validateDeviceAdvertisements(params.devices);
    if (
      requirement.projectId !== authorized.projectId ||
      requirement.workRunId !== authorized.grant.workRunId
    ) {
      throw conflict(
        "Assignment requirement conflicts with the authorized Project or Work Run",
      );
    }
    const snapshot = await this.runtime(authorized.projectId);
    const candidates = snapshot.descriptors.list().flatMap((descriptorEntry) => {
      if (!authorized.scope.descriptorKeys.includes(descriptorKey(
        descriptorEntry.descriptor.descriptorId,
        descriptorEntry.descriptor.descriptorVersion,
      ))) return [];
      const reference = descriptorEntry.descriptor.connectorRef;
      const connectorEntry = snapshot.connectors.get(
        reference.connectorId,
        reference.connectorVersion,
      );
      const connectorRegistration = snapshot.connectorRegistrations.get(
        connectorKey(reference.connectorId, reference.connectorVersion),
      );
      if (!connectorEntry || !connectorRegistration) return [];
      const needsDevice = Boolean(
        requirement.deviceId ||
          requirement.resourceClass ||
          descriptorEntry.descriptor.deviceAffinities?.length ||
          descriptorEntry.descriptor.resourceClasses?.length,
      );
      const candidateDevices = needsDevice
        ? devices.length > 0
          ? devices
          : [undefined]
        : [undefined];
      return candidateDevices.map((device) => ({
        descriptor: descriptorEntry,
        connector: connectorEntry,
        connectorHealth: connectorRegistration.health,
        device,
      }));
    });
    const plannedAt = optionalString(params.plannedAt, "plannedAt") ??
      new Date(this.now()).toISOString();
    const planned = planAssignment({
      plannedAt,
      requirement,
      policy,
      grant: authorized.grant,
      candidates,
    });
    const bindingLocked = {
      ...planned,
      projectBinding: {
        bindingId: authorized.binding.bindingId,
        bindingRevision: authorized.binding.revision,
        projectContextFingerprint:
          authorized.binding.projectContextFingerprint,
      },
    };
    const plan: AssignmentPlan = {
      ...bindingLocked,
      planId: `assignment-plan/${fingerprintContract({
        ...bindingLocked,
        planId: undefined,
      }).slice("sha256:".length, "sha256:".length + 24)}`,
    };
    const write = this.store.saveAssignmentPlan(plan);
    return {
      projectId: authorized.projectId,
      plan: write.value,
      planFingerprint: write.fingerprint,
      storageKey: write.storageKey,
      replayed: write.replayed,
    };
  }

  async approve(params: Record<string, unknown>) {
    const authorized = await this.authorize(params, "host.assignment.approve");
    const planId = requiredString(params.planId, "planId");
    const plan = this.store.readAssignmentPlan(planId);
    this.assertPlanScope(plan, authorized);
    const expectedFingerprint = requiredString(
      params.expectedFingerprint,
      "expectedFingerprint",
    );
    if (!DIGEST_PATTERN.test(expectedFingerprint)) {
      throw badRequest("expectedFingerprint must be a sha256 digest");
    }
    const approvedBy = requiredString(params.approvedBy, "approvedBy");
    const write = this.store.approveAssignmentPlan({
      planId,
      expectedFingerprint: expectedFingerprint as Sha256Digest,
      approvedBy,
      approvedAt: new Date(this.now()).toISOString(),
    });
    return {
      projectId: authorized.projectId,
      plan: write.value,
      planFingerprint: write.fingerprint,
      storageKey: write.storageKey,
      replayed: write.replayed,
    };
  }

  async readPlan(params: Record<string, unknown>) {
    const authorized = await this.authorize(params, "host.assignment.read");
    const plan = this.store.readAssignmentPlan(
      requiredString(params.planId, "planId"),
    );
    this.assertPlanScope(plan, authorized);
    return {
      projectId: authorized.projectId,
      plan,
      planFingerprint: fingerprintContract(plan),
    };
  }

  async project(params: Record<string, unknown>) {
    const authorized = await this.authorize(params, "host.project");
    const snapshot = await this.runtime(authorized.projectId);
    const descriptors = snapshot.descriptors
      .list()
      .filter((entry) => authorized.scope.descriptorKeys.includes(descriptorKey(
        entry.descriptor.descriptorId,
        entry.descriptor.descriptorVersion,
      )))
      .filter((entry) =>
        authorized.grant.descriptorIds.includes(entry.descriptor.descriptorId),
      )
      .filter((entry) =>
        authorized.grant.connectorIds.includes(
          entry.descriptor.connectorRef.connectorId,
        ),
      )
      .map((entry) => {
        const connectorEntry = snapshot.connectors.get(
          entry.descriptor.connectorRef.connectorId,
          entry.descriptor.connectorRef.connectorVersion,
        );
        const connectorRegistration = snapshot.connectorRegistrations.get(
          connectorKey(
            entry.descriptor.connectorRef.connectorId,
            entry.descriptor.connectorRef.connectorVersion,
          ),
        );
        return {
          descriptorId: entry.descriptor.descriptorId,
          descriptorVersion: entry.descriptor.descriptorVersion,
          descriptorFingerprint: entry.fingerprint,
          capabilities: entry.descriptor.capabilities,
          operations: entry.descriptor.operations
            .filter(
              (operation) =>
                authorized.grant.operations.includes(operation.operation) &&
                authorized.grant.sideEffectClasses.includes(
                  operation.sideEffectClass,
                ),
            )
            .map((operation) => operation.operation),
          connectorId: entry.descriptor.connectorRef.connectorId,
          connectorVersion: entry.descriptor.connectorRef.connectorVersion,
          descriptorHealth: entry.health?.state ?? "unknown",
          connectorHealth: connectorRegistration?.health.state ?? "unknown",
          deviceAffinities: entry.descriptor.deviceAffinities ?? [],
          assignable:
            entry.assignable &&
            connectorEntry?.assignable === true &&
            !new Set(["disabled", "unavailable"]).has(
              connectorRegistration?.health.state ?? "unavailable",
            ),
          reasonCodes: [
            ...entry.reasonCodes,
            ...(connectorEntry?.reasonCodes ?? ["connector_missing"]),
          ],
        };
      });
    const assignments = this.store
      .listAssignmentPlans()
      .filter(
        (plan) =>
          plan.projectId === authorized.projectId &&
          plan.grantId === authorized.grant.grantId &&
          plan.projectBinding?.bindingId === authorized.binding.bindingId &&
          plan.projectBinding.bindingRevision === authorized.binding.revision,
      )
      .map((plan) => ({
        planId: plan.planId,
        status: plan.status,
        approvalStatus: plan.approval.status,
        selected: plan.selected,
        plannedAt: plan.plannedAt,
      }));
    return {
      projectId: authorized.projectId,
      bindingId: authorized.binding.bindingId,
      grantId: authorized.grant.grantId,
      descriptors,
      assignments,
    };
  }

  async doctor(projectId?: string) {
    const now = this.now();
    const snapshot = await this.runtime(projectId);
    const findings: Array<{
      code: string;
      severity: "info" | "warning" | "error";
      message: string;
      descriptorId?: string;
      connectorId?: string;
      planId?: string;
      remediation?: string;
    }> = [];
    for (const entry of snapshot.descriptors.list()) {
      if (!entry.assignable) {
        findings.push({
          code: "descriptor_not_assignable",
          severity: "error",
          message: "Descriptor approval or source observation is not current.",
          descriptorId: entry.descriptor.descriptorId,
          remediation: "Review provenance and approve the current source hash.",
        });
      }
      if (!entry.health || entry.health.state === "unavailable" || entry.health.state === "disabled") {
        findings.push({
          code: "descriptor_unavailable",
          severity: "error",
          message: "Descriptor health is unavailable or disabled.",
          descriptorId: entry.descriptor.descriptorId,
        });
      } else if (entry.health.expiresAt && Date.parse(entry.health.expiresAt) <= now) {
        findings.push({
          code: "descriptor_health_expired",
          severity: "warning",
          message: "Descriptor health observation has expired.",
          descriptorId: entry.descriptor.descriptorId,
        });
      }
      const connector = snapshot.connectors.get(
        entry.descriptor.connectorRef.connectorId,
        entry.descriptor.connectorRef.connectorVersion,
      );
      if (!connector) {
        findings.push({
          code: "connector_missing",
          severity: "error",
          message: "Descriptor references an unregistered connector.",
          descriptorId: entry.descriptor.descriptorId,
          connectorId: entry.descriptor.connectorRef.connectorId,
        });
      }
    }
    for (const registration of snapshot.connectorRegistrations.values()) {
      const connector = registration.connector;
      const connectorEntry = snapshot.connectors.get(
        connector.connectorId,
        connector.connectorVersion,
      );
      if (!connectorEntry?.assignable) {
        findings.push({
          code: "connector_not_assignable",
          severity: "error",
          message: "Connector approval or source observation is not current.",
          connectorId: connector.connectorId,
          remediation: "Review provenance and approve the current source hash.",
        });
      }
      if (
        registration.configuration.secretRequired &&
        !registration.configuration.secretReference
      ) {
        findings.push({
          code: "secret_reference_missing",
          severity: "error",
          message: "Connector requires a Secret Reference locator but none is configured.",
          connectorId: connector.connectorId,
          remediation: "Bind a Secret Reference locator in connector configuration.",
        });
      }
      if (
        registration.health.state === "unavailable" ||
        registration.health.state === "disabled"
      ) {
        findings.push({
          code: "connector_unavailable",
          severity: "error",
          message: "Connector health is unavailable or disabled.",
          connectorId: connector.connectorId,
        });
      } else if (
        registration.health.expiresAt &&
        Date.parse(registration.health.expiresAt) <= now
      ) {
        findings.push({
          code: "connector_health_expired",
          severity: "warning",
          message: "Connector health observation has expired.",
          connectorId: connector.connectorId,
        });
      }
    }
    for (const plan of this.store.listAssignmentPlans()) {
      if (plan.approval.status !== "approved" || !plan.selected) continue;
      if (!plan.projectBinding) {
        findings.push({
          code: "approved_plan_binding_missing",
          severity: "error",
          message: "Approved AssignmentPlan has no locked Project Binding.",
          planId: plan.planId,
          remediation: "Create and approve a binding-locked AssignmentPlan.",
        });
      }
      const descriptor = snapshot.descriptors.get(
        plan.selected.descriptorId,
        plan.selected.descriptorVersion,
      );
      const connector = snapshot.connectors.get(
        plan.selected.connectorId,
        plan.selected.connectorVersion,
      );
      if (
        descriptor?.fingerprint !== plan.selected.descriptorFingerprint ||
        connector?.fingerprint !== plan.selected.connectorFingerprint
      ) {
        findings.push({
          code: "approved_plan_drift",
          severity: "error",
          message: "Approved AssignmentPlan no longer matches current descriptor or connector bytes.",
          planId: plan.planId,
          remediation: "Create and approve a new AssignmentPlan.",
        });
      }
    }
    return {
      ok: findings.every((finding) => finding.severity !== "error"),
      schemaVersion: HOST_CAPABILITY_SCHEMA_VERSION,
      counts: {
        descriptors: snapshot.descriptors.list().length,
        connectors: snapshot.connectors.list().length,
        assignments: this.store.listAssignmentPlans().length,
      },
      findings,
    };
  }

  assertPlanScope(plan: AssignmentPlan, authorized: AuthorizedProject): void {
    if (
      plan.projectId !== authorized.projectId ||
      plan.workRunId !== authorized.grant.workRunId ||
      plan.grantId !== authorized.grant.grantId ||
      plan.projectBinding?.bindingId !== authorized.binding.bindingId ||
      plan.projectBinding.bindingRevision !== authorized.binding.revision ||
      plan.projectBinding.projectContextFingerprint !==
        authorized.binding.projectContextFingerprint
    ) {
      throw conflict(
        "AssignmentPlan conflicts with the authorized Project, Work Run, or Capability Grant",
      );
    }
  }
}

function connectorIds(grant: AgentCapabilityGrant): string[] {
  return [...new Set(grant.scope.connectors.map(item =>
    item.startsWith("connector/") ? item : `connector/${item}`,
  ))];
}

function hostSideEffectClasses(grant: AgentCapabilityGrant): string[] {
  const values = grant.scope.sideEffectClasses.flatMap(item => {
    if (item === "read-only") return ["none", "local-read", "external-read"];
    if (item === "local-write") return ["local-write"];
    if (item === "external-write") return ["external-write"];
    return [];
  });
  return [...new Set(values)];
}

function assertClientConnectorConfigurationEmpty(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const configuration = (value as Record<string, unknown>).configuration;
  if (configuration === undefined) return;
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) {
    throw badRequest("Connector configuration is owned by Settings and must be omitted");
  }
  if (Object.keys(configuration as Record<string, unknown>).length > 0) {
    throw badRequest(
      "Connector provider, endpoint, enabled state, parameters, and Secret Reference are owned by Settings",
    );
  }
}

function applySettingsProfile(
  registration: HostCapabilityConnectorRegistration,
  profile: HostCapabilityInvocationProfile,
): HostCapabilityConnectorRegistration {
  const selected = registration.connector.connectorId === profile.connectorId;
  const credentialAvailable = !profile.secretRequired || profile.credential?.status === "present";
  const state = !selected || !profile.enabled
    ? "disabled"
    : !credentialAvailable
      ? "unavailable"
      : registration.health.state;
  const reasonCodes = [
    ...registration.health.reasonCodes,
    ...(!selected ? ["settings_connector_not_selected"] : []),
    ...(selected && !profile.enabled ? ["settings_connector_disabled"] : []),
    ...(selected && profile.enabled && !credentialAvailable ? ["settings_secret_reference_unavailable"] : []),
  ];
  const remediationKeys = [
    ...registration.health.remediationKeys,
    ...(!selected ? ["select-host-connector-in-settings"] : []),
    ...(selected && !profile.enabled ? ["enable-host-capability-in-settings"] : []),
    ...(selected && profile.enabled && !credentialAvailable ? ["resolve-host-capability-secret-reference"] : []),
  ];
  return validateConnectorRegistration({
    ...registration,
    connector: {
      ...registration.connector,
      transport: settingsTransport(profile.transport),
    },
    health: {
      ...registration.health,
      state,
      reasonCodes: [...new Set(reasonCodes)],
      remediationKeys: [...new Set(remediationKeys)],
    },
    configuration: {
      parameters: selected ? settingsParameters(profile) : {
        provider: registration.connector.connectorId.slice("connector/".length),
        selectedConnectorId: profile.connectorId,
        settingsSnapshotId: profile.snapshotId,
      },
      secretRequired: selected && profile.secretRequired,
      ...(selected && profile.credential ? { secretReference: profile.credential.secretRef } : {}),
    },
  });
}

function settingsParameters(profile: HostCapabilityInvocationProfile): Record<string, unknown> {
  const provenance = {
    connectorIdentity: profile.provenance.provider,
    endpoint: profile.provenance.endpoint,
    credential: profile.provenance.credential,
    enabled: profile.provenance.enabled,
  };
  if (settingsTransport(profile.transport) !== "stdio") {
    return {
      provider: profile.provider,
      connectorId: profile.connectorId,
      endpoint: profile.endpoint,
      timeoutMs: profile.timeoutMs,
      settingsSnapshotId: profile.snapshotId,
      settingsProvenance: provenance,
    };
  }
  let url: URL;
  try {
    url = new URL(profile.endpoint);
  } catch {
    throw badRequest("Stdio Host Capability endpoint must use stdio://<command>?arg=<value>");
  }
  if (url.protocol !== "stdio:" || !url.hostname || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(url.hostname)) {
    throw badRequest("Stdio Host Capability endpoint must use stdio://<safe-command>?arg=<value>");
  }
  return {
    provider: profile.provider,
    connectorId: profile.connectorId,
    command: url.hostname,
    args: url.searchParams.getAll("arg"),
    timeoutMs: profile.timeoutMs,
    settingsSnapshotId: profile.snapshotId,
    settingsProvenance: provenance,
  };
}

function settingsTransport(
  transport: HostCapabilityInvocationProfile["transport"],
): "stdio" | "http" | "in-process" {
  if (transport === "stdio") return "stdio";
  if (transport === "http" || transport === "oauth") return "http";
  return "in-process";
}

const projectAuthorizationParams = {
  project: {
    type: "string" as const,
    required: true,
    description: "Canonical Project ID",
  },
  bindingId: {
    type: "string" as const,
    required: true,
    description: "Server-side current Project Agent Binding ID",
  },
  grantId: {
    type: "string" as const,
    required: true,
    description: "Server-issued active Child Work Run Capability Grant ID",
  },
};

export function makeHostCapabilityOps(
  vaultPath: string,
  options: HostCapabilityOperationsOptions = {},
): Operation[] {
  const service = new HostCapabilityOperationService(vaultPath, options);

  const descriptorRegister: Operation = {
    name: "host.descriptor.register",
    namespace: HOST_NAMESPACE,
    description: "Register an approved versioned Expert Descriptor with health and source observation.",
    mutating: true,
    writePolicy: {
      realWrite: "always",
      targets: (_ctx: OperationContext, params) => [
        boundary(() => descriptorTarget(params)),
      ],
      audit: "required",
    },
    params: {
      registration: {
        type: "object",
        required: true,
        description: "Versioned Expert Descriptor registration",
      },
    },
    handler: async (ctx, params) =>
      boundary(() => {
        closedParams(params, ["registration"]);
        const actor = authenticatedApprover(ctx, "Expert Descriptor registration");
        const registration = serverApprovedDescriptorRegistration(
          params.registration,
          actor,
          new Date(service.now()).toISOString(),
        );
        const write = service.store.registerDescriptor(registration);
        return {
          descriptorId: write.value.descriptor.descriptorId,
          descriptorVersion: write.value.descriptor.descriptorVersion,
          fingerprint: write.fingerprint,
          storageKey: write.storageKey,
          replayed: write.replayed,
        };
      }),
  };

  const descriptorList: Operation = {
    name: "host.descriptor.list",
    namespace: HOST_NAMESPACE,
    description: "List registered Expert Descriptors without connecting to external hosts.",
    mutating: false,
    params: {},
    handler: async (_ctx, params) =>
      boundary(() => {
        closedParams(params, []);
        const registrations = service.store.listDescriptors();
        return { count: registrations.length, registrations };
      }),
  };

  const descriptorRead: Operation = {
    name: "host.descriptor.read",
    namespace: HOST_NAMESPACE,
    description: "Read one exact Expert Descriptor version.",
    mutating: false,
    params: {
      descriptorId: { type: "string", required: true },
      descriptorVersion: { type: "string", required: true },
    },
    handler: async (_ctx, params) =>
      boundary(() => {
        closedParams(params, ["descriptorId", "descriptorVersion"]);
        return service.store.readDescriptor(
          requiredString(params.descriptorId, "descriptorId"),
          requiredString(params.descriptorVersion, "descriptorVersion"),
        );
      }),
  };

  const connectorRegister: Operation = {
    name: "host.connector.register",
    namespace: HOST_NAMESPACE,
    description: "Register a governed Host Capability Connector; credentials must remain Secret Reference locators.",
    mutating: true,
    writePolicy: {
      realWrite: "always",
      targets: (_ctx: OperationContext, params) => [
        boundary(() => connectorTarget(params)),
      ],
      audit: "required",
    },
    params: {
      project: { type: "string", required: false, description: "Canonical Project ID for workspace-project Settings" },
      registration: {
        type: "object",
        required: true,
        description: "Connector, health, public configuration, and optional Secret Reference locator",
      },
    },
    handler: async (ctx, params) =>
      asyncBoundary(async () => {
        closedParams(params, ["project", "registration"]);
        const projectId = optionalCanonicalProject(vaultPath, params.project, "host.connector.register");
        const actor = authenticatedApprover(ctx, "Host Capability Connector registration");
        const approved = serverApprovedConnectorRegistration(
          params.registration,
          actor,
          new Date(service.now()).toISOString(),
        );
        const registration = await service.governedRegistration(approved, projectId);
        const write = service.store.registerConnector(registration);
        return {
          connectorId: write.value.connector.connectorId,
          connectorVersion: write.value.connector.connectorVersion,
          fingerprint: write.fingerprint,
          storageKey: write.storageKey,
          replayed: write.replayed,
        };
      }),
  };

  const connectorList: Operation = {
    name: "host.connector.list",
    namespace: HOST_NAMESPACE,
    description: "List governed connector registrations without resolving credentials or connecting.",
    mutating: false,
    params: { project: { type: "string", required: false } },
    handler: async (_ctx, params) =>
      asyncBoundary(async () => {
        closedParams(params, ["project"]);
        const projectId = optionalCanonicalProject(vaultPath, params.project, "host.connector.list");
        const registrations = await service.listConnectors(projectId);
        return { count: registrations.length, registrations };
      }),
  };

  const connectorRead: Operation = {
    name: "host.connector.read",
    namespace: HOST_NAMESPACE,
    description: "Read one exact governed connector version with redaction-safe configuration.",
    mutating: false,
    params: {
      connectorId: { type: "string", required: true },
      connectorVersion: { type: "string", required: true },
      project: { type: "string", required: false },
    },
    handler: async (_ctx, params) =>
      asyncBoundary(async () => {
        closedParams(params, ["connectorId", "connectorVersion", "project"]);
        return service.readConnector(
          requiredString(params.connectorId, "connectorId"),
          requiredString(params.connectorVersion, "connectorVersion"),
          optionalCanonicalProject(vaultPath, params.project, "host.connector.read"),
        );
      }),
  };

  const assignmentPlan: Operation = {
    name: "host.assignment.plan",
    namespace: HOST_NAMESPACE,
    description: "Create and persist a deterministic pending AssignmentPlan under Project Binding and Capability Grant gates.",
    mutating: true,
    writePolicy: {
      realWrite: "always",
      targets: () => [`${HOST_CAPABILITY_RELATIVE_ROOT}/assignments`],
      audit: "required",
    },
    params: {
      ...projectAuthorizationParams,
      requirement: { type: "object", required: true },
      policy: { type: "object", required: true },
      devices: { type: "array", required: false },
      plannedAt: { type: "string", required: false },
    },
    handler: async (_ctx, params) =>
      asyncBoundary(async () => {
        closedParams(params, [
          "project",
          "bindingId",
          "grantId",
          "requirement",
          "policy",
          "devices",
          "plannedAt",
        ]);
        return service.plan(params);
      }),
  };

  const assignmentApprove: Operation = {
    name: "host.assignment.approve",
    namespace: HOST_NAMESPACE,
    description: "Approve one exact pending AssignmentPlan fingerprint under its locked Project Binding and Capability Grant.",
    mutating: true,
    writePolicy: {
      realWrite: "always",
      targets: (_ctx, params) => [boundary(() => assignmentTarget(params))],
      audit: "required",
    },
    params: {
      ...projectAuthorizationParams,
      planId: { type: "string", required: true },
      expectedFingerprint: { type: "string", required: true },
      approvedBy: { type: "string", required: true },
    },
    handler: async (ctx, params) =>
      asyncBoundary(async () => {
        closedParams(params, [
          "project",
          "bindingId",
          "grantId",
          "planId",
          "expectedFingerprint",
          "approvedBy",
        ]);
        const approvedBy = requiredString(params.approvedBy, "approvedBy");
        const authenticatedActor = ctx.config.collaboration?.actor;
        const authenticatedRole = ctx.config.collaboration?.role;
        if (
          !authenticatedActor ||
          authenticatedActor !== approvedBy ||
          !new Set(["human", "approver", "admin"]).has(
            authenticatedRole ?? "",
          )
        ) {
          throw conflict(
            "AssignmentPlan approval requires the authenticated human or approver actor",
          );
        }
        return service.approve(params);
      }),
  };

  const assignmentRead: Operation = {
    name: "host.assignment.read",
    namespace: HOST_NAMESPACE,
    description: "Read an AssignmentPlan only through its current Project Binding and Capability Grant.",
    mutating: false,
    params: {
      ...projectAuthorizationParams,
      planId: { type: "string", required: true },
    },
    handler: async (_ctx, params) =>
      asyncBoundary(async () => {
        closedParams(params, ["project", "bindingId", "grantId", "planId"]);
        return service.readPlan(params);
      }),
  };

  const proxySearch: Operation = {
    name: "host.proxy.search",
    namespace: HOST_NAMESPACE,
    description: "Search only Project-visible and granted Host Capability descriptors without opening transports.",
    mutating: false,
    params: {
      ...projectAuthorizationParams,
      query: { type: "string", required: false },
      capability: { type: "string", required: false },
      operation: { type: "string", required: false },
    },
    handler: async (_ctx, params) =>
      asyncBoundary(async () => {
        closedParams(params, [
          "project",
          "bindingId",
          "grantId",
          "query",
          "capability",
          "operation",
        ]);
        const authorized = await service.authorize(params, "host.proxy.search");
        const results = (await service.runtime(authorized.projectId)).proxy.search({
          scope: authorized.scope,
          query: optionalString(params.query, "query"),
          capability: optionalString(params.capability, "capability"),
          operation: optionalString(params.operation, "operation"),
        });
        return { projectId: authorized.projectId, count: results.length, results };
      }),
  };

  const proxyDescribe: Operation = {
    name: "host.proxy.describe",
    namespace: HOST_NAMESPACE,
    description: "Describe the current granted descriptor and connector bytes without connecting.",
    mutating: false,
    params: {
      ...projectAuthorizationParams,
      descriptorId: { type: "string", required: true },
      descriptorVersion: { type: "string", required: true },
    },
    handler: async (_ctx, params) =>
      asyncBoundary(async () => {
        closedParams(params, [
          "project",
          "bindingId",
          "grantId",
          "descriptorId",
          "descriptorVersion",
        ]);
        const authorized = await service.authorize(params, "host.proxy.describe");
        const description = (await service.runtime(authorized.projectId)).proxy.describe({
          scope: authorized.scope,
          descriptorId: requiredString(params.descriptorId, "descriptorId"),
          descriptorVersion: requiredString(
            params.descriptorVersion,
            "descriptorVersion",
          ),
        });
        return { projectId: authorized.projectId, description };
      }),
  };

  const proxyInvoke: Operation = {
    name: "host.proxy.invoke",
    namespace: HOST_NAMESPACE,
    description: "Invoke one described operation through the persisted approved AssignmentPlan, Project Binding, and Capability Grant.",
    mutating: true,
    writePolicy: {
      realWrite: "always",
      targets: (_ctx, params) => proxyInvokeWriteTargets(vaultPath, params),
      audit: "required",
    },
    params: {
      ...projectAuthorizationParams,
      planId: { type: "string", required: true },
      descriptorId: { type: "string", required: true },
      descriptorVersion: { type: "string", required: true },
      operation: { type: "string", required: true },
      describedDescriptorFingerprint: { type: "string", required: true },
      workItemId: { type: "string", required: false },
      input: { type: "unknown", required: false },
      timeoutMs: { type: "number", required: false },
    },
    handler: async (_ctx, params) =>
      asyncBoundary(async () => {
        closedParams(params, [
          "project",
          "bindingId",
          "grantId",
          "planId",
          "descriptorId",
          "descriptorVersion",
          "operation",
          "describedDescriptorFingerprint",
          "workItemId",
          "input",
          "timeoutMs",
        ]);
        const authorized = await service.authorize(params, "host.proxy.invoke");
        const plan = service.store.readAssignmentPlan(
          requiredString(params.planId, "planId"),
        );
        service.assertPlanScope(plan, authorized);
        if (plan.approval.status !== "approved") {
          throw conflict(
            "Proxy invoke requires the matching persisted approved AssignmentPlan",
          );
        }
        const describedFingerprint = requiredString(
          params.describedDescriptorFingerprint,
          "describedDescriptorFingerprint",
        );
        if (!DIGEST_PATTERN.test(describedFingerprint)) {
          throw badRequest("describedDescriptorFingerprint must be a sha256 digest");
        }
        const timeoutMs = params.timeoutMs;
        if (
          timeoutMs !== undefined &&
          (typeof timeoutMs !== "number" ||
            !Number.isInteger(timeoutMs) ||
            timeoutMs < 1)
        ) {
          throw badRequest("timeoutMs must be a positive integer");
        }
        const settingsProfile = await service.settingsProfile(authorized.projectId);
        const runtime = await service.runtime(authorized.projectId);
        const operation = requiredString(params.operation, "operation");
        const result = await runtime.proxy.invoke({
          scope: {
            ...authorized.scope,
            workItemId: optionalString(params.workItemId, "workItemId"),
          },
          assignmentPlan: plan,
          descriptorId: requiredString(params.descriptorId, "descriptorId"),
          descriptorVersion: requiredString(
            params.descriptorVersion,
            "descriptorVersion",
          ),
          operation,
          describedDescriptorFingerprint: describedFingerprint as Sha256Digest,
          input: params.input,
          timeoutMs: timeoutMs === undefined
            ? settingsProfile.timeoutMs
            : Math.min(timeoutMs as number, settingsProfile.timeoutMs),
        });
        if (!operation.endsWith(".diagnostics.read")) {
          return { projectId: authorized.projectId, result };
        }
        const report = validatePluginDiagnosticReport(result.result);
        if (report.projectId !== authorized.projectId) {
          throw conflict(
            "Plugin diagnostic report belongs to another Project Context",
          );
        }
        if (!options.observePluginDiagnostic) {
          throw internal(
            "Problem Intake observer is not configured for plugin diagnostics",
          );
        }
        const problemIntake =
          await submitPluginDiagnosticReportToProblemIntake(
            report,
            options.observePluginDiagnostic,
          );
        return { projectId: authorized.projectId, result, problemIntake };
      }),
  };

  const doctor: Operation = {
    name: "host.doctor",
    namespace: HOST_NAMESPACE,
    description: "Project read-only descriptor, connector, health, Secret Reference, and approved-plan diagnostics without external calls.",
    mutating: false,
    params: { project: { type: "string", required: false } },
    handler: async (_ctx, params) =>
      asyncBoundary(async () => {
        closedParams(params, ["project"]);
        return service.doctor(optionalCanonicalProject(vaultPath, params.project, "host.doctor"));
      }),
  };

  const project: Operation = {
    name: "host.project",
    namespace: HOST_NAMESPACE,
    description: "Project-scoped Host Capability, health, grant visibility, and AssignmentPlan projection without external calls.",
    mutating: false,
    params: projectAuthorizationParams,
    handler: async (_ctx, params) =>
      asyncBoundary(async () => {
        closedParams(params, ["project", "bindingId", "grantId"]);
        return service.project(params);
      }),
  };

  return [
    descriptorRegister,
    descriptorList,
    descriptorRead,
    connectorRegister,
    connectorList,
    connectorRead,
    assignmentPlan,
    assignmentApprove,
    assignmentRead,
    proxySearch,
    proxyDescribe,
    proxyInvoke,
    doctor,
    project,
  ];
}
