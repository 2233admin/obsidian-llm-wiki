import {
  HOST_CAPABILITY_SCHEMA_VERSION,
  type AssignmentPlan,
  type CapabilityOperationGrant,
  type ExpertDescriptor,
  type ExpertOperationDescriptor,
  type HostCapabilityConnector,
  type Sha256Digest,
  descriptorKey,
  validateAssignmentPlan,
  validateCapabilityOperationGrant,
} from "./contracts.js";
import { redactDiagnosticValue } from "./redaction.js";
import {
  ExpertDescriptorRegistry,
  HostCapabilityConnectorRegistry,
  HostCapabilityRegistryError,
} from "./registry.js";

export type HostCapabilityDiagnosticStage =
  | "authorization"
  | "search"
  | "describe"
  | "connection"
  | "invoke"
  | "timeout";

export interface HostCapabilityDiagnostic {
  schemaVersion: typeof HOST_CAPABILITY_SCHEMA_VERSION;
  code:
    | "scope_mismatch"
    | "grant_expired"
    | "descriptor_not_granted"
    | "connector_not_granted"
    | "operation_not_granted"
    | "side_effect_not_granted"
    | "assignment_not_approved"
    | "assignment_mismatch"
    | "descriptor_not_found"
    | "connector_not_found"
    | "descriptor_unavailable"
    | "connector_unavailable"
    | "descriptor_drift"
    | "connector_drift"
    | "operation_not_supported"
    | "connection_failed"
    | "connection_timeout"
    | "invoke_failed"
    | "invoke_timeout"
    | "identity_conflict";
  stage: HostCapabilityDiagnosticStage;
  message: string;
  retryable: boolean;
  descriptorId?: string;
  descriptorVersion?: string;
  connectorId?: string;
  connectorVersion?: string;
  operation?: string;
  details?: unknown;
}

export class HostCapabilityProxyError extends Error {
  readonly diagnostic: HostCapabilityDiagnostic;

  constructor(diagnostic: HostCapabilityDiagnostic) {
    super(diagnostic.message);
    this.name = "HostCapabilityProxyError";
    this.diagnostic = {
      ...diagnostic,
      details: redactDiagnosticValue(diagnostic.details),
    };
  }
}

export interface ProxyScope {
  projectId: string;
  workItemId?: string;
  workRunId: string;
  agentId?: string;
  descriptorKeys: string[];
  grant: CapabilityOperationGrant;
}

export interface SearchHostCapabilitiesRequest {
  scope: ProxyScope;
  query?: string;
  capability?: string;
  operation?: string;
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
  descriptorFingerprint: Sha256Digest;
}

export interface DescribeHostCapabilityRequest {
  scope: ProxyScope;
  descriptorId: string;
  descriptorVersion: string;
}

export interface HostCapabilityDescription {
  descriptor: ExpertDescriptor;
  connector: HostCapabilityConnector;
  visibleOperations: ExpertOperationDescriptor[];
  descriptorFingerprint: Sha256Digest;
  connectorFingerprint: Sha256Digest;
}

export interface InvokeHostCapabilityRequest {
  scope: ProxyScope;
  assignmentPlan: AssignmentPlan;
  descriptorId: string;
  descriptorVersion: string;
  operation: string;
  describedDescriptorFingerprint: Sha256Digest;
  input: unknown;
  timeoutMs?: number;
}

export interface InvokeHostCapabilityResult {
  descriptorId: string;
  descriptorVersion: string;
  connectorId: string;
  connectorVersion: string;
  operation: string;
  result: unknown;
}

export interface GovernedMcpProxyOptions {
  connectionTimeoutMs?: number;
  invocationTimeoutMs?: number;
  now?: () => number;
}

function diagnostic(
  value: Omit<HostCapabilityDiagnostic, "schemaVersion">,
): HostCapabilityDiagnostic {
  return {
    schemaVersion: HOST_CAPABILITY_SCHEMA_VERSION,
    ...value,
  };
}

function fail(value: Omit<HostCapabilityDiagnostic, "schemaVersion">): never {
  throw new HostCapabilityProxyError(diagnostic(value));
}

function assertScope(scope: ProxyScope, now: number): void {
  try {
    validateCapabilityOperationGrant(scope.grant);
  } catch (error) {
    fail({
      code: "scope_mismatch",
      stage: "authorization",
      message: "Capability grant contract is invalid",
      retryable: false,
      details: error,
    });
  }
  if (!/^project\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(scope.projectId)) {
    fail({
      code: "scope_mismatch",
      stage: "authorization",
      message: "Host capability access requires a canonical project/<slug> ID",
      retryable: false,
    });
  }
  if (!/^work-run\/[a-z0-9][a-z0-9._-]*$/.test(scope.workRunId)) {
    fail({
      code: "scope_mismatch",
      stage: "authorization",
      message: "Host capability access requires a canonical Work Run ID",
      retryable: false,
    });
  }
  if (
    scope.grant.projectId !== scope.projectId ||
    scope.grant.workRunId !== scope.workRunId
  ) {
    fail({
      code: "scope_mismatch",
      stage: "authorization",
      message: "Capability grant does not match the canonical Project Context and Work Run",
      retryable: false,
    });
  }
  if (Date.parse(scope.grant.expiresAt) <= now) {
    fail({
      code: "grant_expired",
      stage: "authorization",
      message: "Capability grant has expired",
      retryable: false,
      details: { expiresAt: scope.grant.expiresAt },
    });
  }
}

function isDescriptorVisible(
  descriptor: ExpertDescriptor,
  scope: ProxyScope,
): boolean {
  return (
    scope.descriptorKeys.includes(
      descriptorKey(descriptor.descriptorId, descriptor.descriptorVersion),
    ) &&
    scope.grant.descriptorIds.includes(descriptor.descriptorId) &&
    scope.grant.connectorIds.includes(descriptor.connectorRef.connectorId)
  );
}

function visibleOperations(
  descriptor: ExpertDescriptor,
  grant: CapabilityOperationGrant,
): ExpertOperationDescriptor[] {
  return descriptor.operations.filter(
    (operation) =>
      grant.operations.includes(operation.operation) &&
      grant.sideEffectClasses.includes(operation.sideEffectClass),
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutDiagnostic: Omit<HostCapabilityDiagnostic, "schemaVersion">,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new HostCapabilityProxyError(diagnostic(timeoutDiagnostic))),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function identityConflict(
  result: unknown,
  expectedIdentity: {
    projectId: string;
    workItemId?: string;
    workRunId: string;
    agentId?: string;
  },
): { field: string; received: unknown; expected: string } | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) return undefined;
  const record = result as Record<string, unknown>;
  for (const field of ["projectId", "workItemId", "workRunId", "agentId"] as const) {
    const expected = expectedIdentity[field];
    if (record[field] !== undefined && record[field] !== expected) {
      return { field, received: record[field], expected: expected ?? "absent" };
    }
  }
  return undefined;
}

export class GovernedMcpProxy {
  readonly #connectionTimeoutMs: number;
  readonly #invocationTimeoutMs: number;
  readonly #now: () => number;

  constructor(
    readonly descriptors: ExpertDescriptorRegistry,
    readonly connectors: HostCapabilityConnectorRegistry,
    options: GovernedMcpProxyOptions = {},
  ) {
    this.#connectionTimeoutMs = options.connectionTimeoutMs ?? 5_000;
    this.#invocationTimeoutMs = options.invocationTimeoutMs ?? 30_000;
    this.#now = options.now ?? Date.now;
  }

  search(request: SearchHostCapabilitiesRequest): HostCapabilitySearchResult[] {
    assertScope(request.scope, this.#now());
    const query = request.query?.trim().toLocaleLowerCase();
    return this.descriptors
      .list()
      .filter((entry) => entry.assignable)
      .filter((entry) => isDescriptorVisible(entry.descriptor, request.scope))
      .filter((entry) => {
        const connector = this.connectors.get(
          entry.descriptor.connectorRef.connectorId,
          entry.descriptor.connectorRef.connectorVersion,
        );
        return connector?.assignable === true;
      })
      .filter((entry) => {
        const operations = visibleOperations(entry.descriptor, request.scope.grant);
        if (operations.length === 0) return false;
        if (
          request.capability &&
          !entry.descriptor.capabilities.includes(request.capability)
        ) {
          return false;
        }
        if (
          request.operation &&
          !operations.some(
            (operation) => operation.operation === request.operation,
          )
        ) {
          return false;
        }
        if (!query) return true;
        return [
          entry.descriptor.descriptorId,
          entry.descriptor.displayName,
          ...entry.descriptor.capabilities,
          ...operations.map((operation) => operation.operation),
          ...operations.map((operation) => operation.description),
        ].some((value) => value.toLocaleLowerCase().includes(query));
      })
      .map((entry) => ({
        descriptorId: entry.descriptor.descriptorId,
        descriptorVersion: entry.descriptor.descriptorVersion,
        displayName: entry.descriptor.displayName,
        capabilities: [...entry.descriptor.capabilities],
        operations: visibleOperations(entry.descriptor, request.scope.grant).map(
          (operation) => operation.operation,
        ),
        connectorId: entry.descriptor.connectorRef.connectorId,
        connectorVersion: entry.descriptor.connectorRef.connectorVersion,
        health: entry.health?.state ?? "unknown",
        descriptorFingerprint: entry.fingerprint,
      }));
  }

  describe(request: DescribeHostCapabilityRequest): HostCapabilityDescription {
    assertScope(request.scope, this.#now());
    const entry = this.descriptors.get(
      request.descriptorId,
      request.descriptorVersion,
    );
    if (!entry) {
      fail({
        code: "descriptor_not_found",
        stage: "describe",
        message: "Host capability descriptor is not registered",
        retryable: false,
        descriptorId: request.descriptorId,
        descriptorVersion: request.descriptorVersion,
      });
    }
    if (!isDescriptorVisible(entry.descriptor, request.scope)) {
      fail({
        code: "descriptor_not_granted",
        stage: "authorization",
        message: "Host capability descriptor is not visible to this grant",
        retryable: false,
        descriptorId: request.descriptorId,
        descriptorVersion: request.descriptorVersion,
      });
    }
    if (!entry.assignable) {
      fail({
        code: "descriptor_unavailable",
        stage: "describe",
        message: "Host capability descriptor is not approved or its source has drifted",
        retryable: false,
        descriptorId: request.descriptorId,
        descriptorVersion: request.descriptorVersion,
        details: { reasonCodes: entry.reasonCodes },
      });
    }
    const connector = this.connectors.get(
      entry.descriptor.connectorRef.connectorId,
      entry.descriptor.connectorRef.connectorVersion,
    );
    if (!connector) {
      fail({
        code: "connector_not_found",
        stage: "describe",
        message: "Connector referenced by the descriptor is not registered",
        retryable: false,
        descriptorId: request.descriptorId,
        connectorId: entry.descriptor.connectorRef.connectorId,
        connectorVersion: entry.descriptor.connectorRef.connectorVersion,
      });
    }
    if (!connector.assignable) {
      fail({
        code: "connector_unavailable",
        stage: "describe",
        message: "Connector is not approved for host capability use",
        retryable: false,
        connectorId: connector.connector.connectorId,
        connectorVersion: connector.connector.connectorVersion,
        details: { reasonCodes: connector.reasonCodes },
      });
    }
    const grantedOperations = visibleOperations(
      entry.descriptor,
      request.scope.grant,
    );
    return {
      descriptor: {
        ...entry.descriptor,
        operations: grantedOperations,
      },
      connector: {
        ...connector.connector,
        supportedOperations: connector.connector.supportedOperations.filter(
          (operation) =>
            grantedOperations.some(
              (grantedOperation) => grantedOperation.operation === operation,
            ),
        ),
      },
      visibleOperations: grantedOperations,
      descriptorFingerprint: entry.fingerprint,
      connectorFingerprint: connector.fingerprint,
    };
  }

  async invoke(
    request: InvokeHostCapabilityRequest,
  ): Promise<InvokeHostCapabilityResult> {
    assertScope(request.scope, this.#now());
    try {
      validateAssignmentPlan(request.assignmentPlan);
    } catch (error) {
      fail({
        code: "assignment_not_approved",
        stage: "authorization",
        message: "AssignmentPlan contract is invalid",
        retryable: false,
        details: error,
      });
    }
    const description = this.describe({
      scope: request.scope,
      descriptorId: request.descriptorId,
      descriptorVersion: request.descriptorVersion,
    });
    const descriptor = description.descriptor;
    const connector = description.connector;
    if (!request.scope.grant.descriptorIds.includes(request.descriptorId)) {
      fail({
        code: "descriptor_not_granted",
        stage: "authorization",
        message: "Descriptor is not present in the capability grant",
        retryable: false,
        descriptorId: request.descriptorId,
      });
    }
    if (!request.scope.grant.connectorIds.includes(connector.connectorId)) {
      fail({
        code: "connector_not_granted",
        stage: "authorization",
        message: "Connector is not present in the capability grant",
        retryable: false,
        connectorId: connector.connectorId,
      });
    }
    if (!request.scope.grant.operations.includes(request.operation)) {
      fail({
        code: "operation_not_granted",
        stage: "authorization",
        message: "Operation is not present in the capability grant",
        retryable: false,
        operation: request.operation,
      });
    }
    const operation = descriptor.operations.find(
      (candidate) => candidate.operation === request.operation,
    );
    if (!operation || !connector.supportedOperations.includes(request.operation)) {
      fail({
        code: "operation_not_supported",
        stage: "authorization",
        message: "Operation is not declared by both descriptor and connector",
        retryable: false,
        descriptorId: request.descriptorId,
        connectorId: connector.connectorId,
        operation: request.operation,
      });
    }
    if (!request.scope.grant.sideEffectClasses.includes(operation.sideEffectClass)) {
      fail({
        code: "side_effect_not_granted",
        stage: "authorization",
        message: "Operation side-effect class is not present in the capability grant",
        retryable: false,
        operation: request.operation,
        details: { sideEffectClass: operation.sideEffectClass },
      });
    }
    if (
      request.assignmentPlan.status !== "matched" ||
      request.assignmentPlan.approval.status !== "approved" ||
      !request.assignmentPlan.selected
    ) {
      fail({
        code: "assignment_not_approved",
        stage: "authorization",
        message: "Invoke requires an approved matched AssignmentPlan",
        retryable: false,
        operation: request.operation,
      });
    }
    const selected = request.assignmentPlan.selected;
    if (
      request.assignmentPlan.projectId !== request.scope.projectId ||
      request.assignmentPlan.workRunId !== request.scope.workRunId ||
      request.assignmentPlan.grantId !== request.scope.grant.grantId ||
      selected.descriptorId !== request.descriptorId ||
      selected.descriptorVersion !== request.descriptorVersion ||
      selected.connectorId !== connector.connectorId ||
      selected.connectorVersion !== connector.connectorVersion
    ) {
      fail({
        code: "assignment_mismatch",
        stage: "authorization",
        message: "AssignmentPlan selection does not match the requested capability",
        retryable: false,
        descriptorId: request.descriptorId,
        connectorId: connector.connectorId,
        operation: request.operation,
      });
    }
    if (
      request.describedDescriptorFingerprint !== description.descriptorFingerprint ||
      selected.descriptorFingerprint !== description.descriptorFingerprint
    ) {
      fail({
        code: "descriptor_drift",
        stage: "authorization",
        message: "Descriptor changed after describe or assignment; re-plan before invoking",
        retryable: false,
        descriptorId: request.descriptorId,
        descriptorVersion: request.descriptorVersion,
      });
    }
    if (selected.connectorFingerprint !== description.connectorFingerprint) {
      fail({
        code: "connector_drift",
        stage: "authorization",
        message: "Connector changed after assignment; re-plan before invoking",
        retryable: false,
        connectorId: connector.connectorId,
        connectorVersion: connector.connectorVersion,
      });
    }

    let runtime;
    try {
      runtime = await this.connectors.connect(
        connector.connectorId,
        connector.connectorVersion,
        this.#connectionTimeoutMs,
      );
    } catch (error) {
      if (
        error instanceof HostCapabilityRegistryError &&
        error.code === "connector_timeout"
      ) {
        fail({
          code: "connection_timeout",
          stage: "timeout",
          message: "Connector connection timed out",
          retryable: true,
          connectorId: connector.connectorId,
          connectorVersion: connector.connectorVersion,
          details: error,
        });
      }
      fail({
        code: "connection_failed",
        stage: "connection",
        message: "Connector connection failed",
        retryable: true,
        connectorId: connector.connectorId,
        connectorVersion: connector.connectorVersion,
        details: error,
      });
    }

    let result: unknown;
    try {
      result = await withTimeout(
        runtime.invoke({
          projectId: request.scope.projectId,
          workItemId: request.scope.workItemId,
          workRunId: request.scope.workRunId,
          agentId: request.scope.agentId,
          descriptorId: request.descriptorId,
          descriptorVersion: request.descriptorVersion,
          operation: request.operation,
          input: request.input,
        }),
        request.timeoutMs ?? this.#invocationTimeoutMs,
        {
          code: "invoke_timeout",
          stage: "timeout",
          message: "Host capability operation timed out",
          retryable: true,
          descriptorId: request.descriptorId,
          connectorId: connector.connectorId,
          operation: request.operation,
        },
      );
    } catch (error) {
      if (error instanceof HostCapabilityProxyError) throw error;
      fail({
        code: "invoke_failed",
        stage: "invoke",
        message: "Host capability operation failed",
        retryable: true,
        descriptorId: request.descriptorId,
        connectorId: connector.connectorId,
        operation: request.operation,
        details: error,
      });
    }

    const conflict = identityConflict(
      result,
      {
        projectId: request.scope.projectId,
        workItemId: request.scope.workItemId,
        workRunId: request.scope.workRunId,
        agentId: request.scope.agentId,
      },
    );
    if (conflict) {
      fail({
        code: "identity_conflict",
        stage: "invoke",
        message: "Connector response attempted to replace canonical identity",
        retryable: false,
        descriptorId: request.descriptorId,
        connectorId: connector.connectorId,
        operation: request.operation,
        details: conflict,
      });
    }

    return {
      descriptorId: request.descriptorId,
      descriptorVersion: request.descriptorVersion,
      connectorId: connector.connectorId,
      connectorVersion: connector.connectorVersion,
      operation: request.operation,
      result,
    };
  }
}
