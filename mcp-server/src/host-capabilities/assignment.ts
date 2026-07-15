import {
  HOST_CAPABILITY_SCHEMA_VERSION,
  type AssignmentCandidateEvaluation,
  type AssignmentPlan,
  type AssignmentRequirement,
  type CapabilityOperationGrant,
  type CapabilityHealth,
  type DeviceCapabilityAdvertisement,
  type ProjectCapabilityPolicy,
  compareVersions,
  fingerprintContract,
  validateCapabilityOperationGrant,
} from "./contracts.js";
import type {
  ConnectorRegistryEntry,
  DescriptorRegistryEntry,
} from "./registry.js";

export const ASSIGNMENT_TIE_BREAK_ORDER = [
  "health: available before degraded",
  "device: exact requested device before affinity before unspecified",
  "model: explicit advertised model before unspecified",
  "cost: free before known amount before unknown",
  "stable identity: descriptorId ascending, descriptorVersion descending, connectorId ascending, deviceId ascending",
] as const;

export interface AssignmentCandidate {
  descriptor: DescriptorRegistryEntry;
  connector: ConnectorRegistryEntry;
  connectorHealth?: CapabilityHealth;
  device?: DeviceCapabilityAdvertisement;
}

export interface PlanAssignmentInput {
  plannedAt: string;
  requirement: AssignmentRequirement;
  policy: ProjectCapabilityPolicy;
  grant: CapabilityOperationGrant;
  candidates: AssignmentCandidate[];
}

interface EvaluatedCandidate {
  candidate: AssignmentCandidate;
  evaluation: AssignmentCandidateEvaluation;
}

const REASON_ORDER = [
  "descriptor_not_approved",
  "descriptor_source_drift",
  "connector_not_approved",
  "connector_source_drift",
  "connector_health_expired",
  "connector_health_disabled",
  "connector_health_unavailable",
  "connector_health_degraded_by_policy",
  "connector_reference_mismatch",
  "grant_scope_mismatch",
  "grant_expired",
  "descriptor_not_granted",
  "connector_not_granted",
  "descriptor_denied_by_policy",
  "descriptor_not_allowed_by_policy",
  "connector_not_allowed_by_policy",
  "health_missing",
  "health_expired",
  "health_disabled",
  "health_unavailable",
  "health_degraded_by_policy",
  "capability_missing",
  "operation_missing",
  "connector_operation_missing",
  "operation_not_granted",
  "side_effect_not_granted",
  "side_effect_not_allowed_by_policy",
  "model_missing",
  "model_not_allowed_by_policy",
  "device_missing",
  "device_expired",
  "device_unavailable",
  "device_id_mismatch",
  "device_not_allowed_by_policy",
  "device_capability_missing",
  "device_model_missing",
  "resource_class_missing",
  "cost_currency_mismatch",
  "cost_exceeds_limit",
  "unknown_cost_not_allowed",
] as const;

function uniqueInReasonOrder(reasons: string[]): string[] {
  const unique = new Set(reasons);
  return [
    ...REASON_ORDER.filter((reason) => unique.delete(reason)),
    ...[...unique].sort(),
  ];
}

function includesAll(actual: readonly string[], required: readonly string[]): boolean {
  const values = new Set(actual);
  return required.every((entry) => values.has(entry));
}

function isExpired(timestamp: string | undefined, plannedAt: number): boolean {
  return timestamp !== undefined && Date.parse(timestamp) <= plannedAt;
}

function validateInput(input: PlanAssignmentInput): number {
  validateCapabilityOperationGrant(input.grant);
  const plannedAt = Date.parse(input.plannedAt);
  if (!Number.isFinite(plannedAt)) {
    throw new TypeError("plannedAt must be an ISO-8601 timestamp");
  }
  if (
    input.requirement.projectId !== input.grant.projectId ||
    input.requirement.workRunId !== input.grant.workRunId
  ) {
    throw new TypeError(
      "Assignment requirement and capability grant must share Project Context and Work Run identity",
    );
  }
  if (input.requirement.projectId !== `project/${input.requirement.projectId.slice(8)}`) {
    throw new TypeError("Assignment requirement requires a canonical project/<slug> ID");
  }
  return plannedAt;
}

function evaluate(
  input: PlanAssignmentInput,
  candidate: AssignmentCandidate,
  plannedAt: number,
): EvaluatedCandidate {
  const descriptor = candidate.descriptor.descriptor;
  const connector = candidate.connector.connector;
  const device = candidate.device;
  const reasons: string[] = [];

  if (!candidate.descriptor.assignable) {
    if (
      candidate.descriptor.reasonCodes.includes("source_revision_drift") ||
      candidate.descriptor.reasonCodes.includes("source_content_drift")
    ) {
      reasons.push("descriptor_source_drift");
    } else {
      reasons.push("descriptor_not_approved");
    }
  }
  if (!candidate.connector.assignable) {
    if (
      candidate.connector.reasonCodes.includes("source_revision_drift") ||
      candidate.connector.reasonCodes.includes("source_content_drift")
    ) {
      reasons.push("connector_source_drift");
    } else {
      reasons.push("connector_not_approved");
    }
  }
  if (candidate.connectorHealth) {
    if (isExpired(candidate.connectorHealth.expiresAt, plannedAt)) {
      reasons.push("connector_health_expired");
    }
    if (candidate.connectorHealth.state === "disabled") {
      reasons.push("connector_health_disabled");
    }
    if (candidate.connectorHealth.state === "unavailable") {
      reasons.push("connector_health_unavailable");
    }
    if (
      candidate.connectorHealth.state === "degraded" &&
      !input.policy.allowDegradedHealth
    ) {
      reasons.push("connector_health_degraded_by_policy");
    }
  }
  if (
    descriptor.connectorRef.connectorId !== connector.connectorId ||
    descriptor.connectorRef.connectorVersion !== connector.connectorVersion
  ) {
    reasons.push("connector_reference_mismatch");
  }

  if (
    input.grant.projectId !== input.requirement.projectId ||
    input.grant.workRunId !== input.requirement.workRunId
  ) {
    reasons.push("grant_scope_mismatch");
  }
  if (isExpired(input.grant.expiresAt, plannedAt)) reasons.push("grant_expired");
  if (!input.grant.descriptorIds.includes(descriptor.descriptorId)) {
    reasons.push("descriptor_not_granted");
  }
  if (!input.grant.connectorIds.includes(connector.connectorId)) {
    reasons.push("connector_not_granted");
  }

  if (input.policy.deniedDescriptorIds?.includes(descriptor.descriptorId)) {
    reasons.push("descriptor_denied_by_policy");
  }
  if (
    input.policy.allowedDescriptorIds &&
    !input.policy.allowedDescriptorIds.includes(descriptor.descriptorId)
  ) {
    reasons.push("descriptor_not_allowed_by_policy");
  }
  if (
    input.policy.allowedConnectorIds &&
    !input.policy.allowedConnectorIds.includes(connector.connectorId)
  ) {
    reasons.push("connector_not_allowed_by_policy");
  }

  const health = candidate.descriptor.health;
  if (!health) {
    reasons.push("health_missing");
  } else {
    if (isExpired(health.expiresAt, plannedAt)) reasons.push("health_expired");
    if (health.state === "disabled") reasons.push("health_disabled");
    if (health.state === "unavailable") reasons.push("health_unavailable");
    if (health.state === "degraded" && !input.policy.allowDegradedHealth) {
      reasons.push("health_degraded_by_policy");
    }
  }

  if (!includesAll(descriptor.capabilities, input.requirement.capabilities)) {
    reasons.push("capability_missing");
  }
  if (
    !includesAll(
      descriptor.operations.map((operation) => operation.operation),
      input.requirement.operations,
    )
  ) {
    reasons.push("operation_missing");
  }
  if (
    !includesAll(connector.supportedOperations, input.requirement.operations)
  ) {
    reasons.push("connector_operation_missing");
  }
  if (!includesAll(input.grant.operations, input.requirement.operations)) {
    reasons.push("operation_not_granted");
  }

  const requiredOperations = descriptor.operations.filter((operation) =>
    input.requirement.operations.includes(operation.operation),
  );
  if (
    requiredOperations.some(
      (operation) =>
        !input.grant.sideEffectClasses.includes(operation.sideEffectClass),
    )
  ) {
    reasons.push("side_effect_not_granted");
  }
  if (
    requiredOperations.some(
      (operation) =>
        !input.policy.allowedSideEffectClasses.includes(operation.sideEffectClass),
    )
  ) {
    reasons.push("side_effect_not_allowed_by_policy");
  }

  if (
    input.requirement.model &&
    !descriptor.models?.includes(input.requirement.model)
  ) {
    reasons.push("model_missing");
  }
  if (
    input.requirement.model &&
    input.policy.allowedModels &&
    !input.policy.allowedModels.includes(input.requirement.model)
  ) {
    reasons.push("model_not_allowed_by_policy");
  }

  const needsDevice = Boolean(
    input.requirement.deviceId ||
      input.requirement.resourceClass ||
      descriptor.deviceAffinities?.length ||
      descriptor.resourceClasses?.length,
  );
  if (needsDevice && !device) {
    reasons.push("device_missing");
  }
  if (device) {
    if (isExpired(device.expiresAt, plannedAt)) reasons.push("device_expired");
    if (device.health === "disabled" || device.health === "unavailable") {
      reasons.push("device_unavailable");
    }
    if (
      input.requirement.deviceId &&
      device.deviceId !== input.requirement.deviceId
    ) {
      reasons.push("device_id_mismatch");
    }
    if (
      input.policy.allowedDeviceIds &&
      !input.policy.allowedDeviceIds.includes(device.deviceId)
    ) {
      reasons.push("device_not_allowed_by_policy");
    }
    if (!includesAll(device.capabilities, input.requirement.capabilities)) {
      reasons.push("device_capability_missing");
    }
    if (
      input.requirement.model &&
      !device.models.includes(input.requirement.model)
    ) {
      reasons.push("device_model_missing");
    }
    if (
      input.requirement.resourceClass &&
      !device.resourceClasses.includes(input.requirement.resourceClass)
    ) {
      reasons.push("resource_class_missing");
    }
  }

  const cost = descriptor.cost ?? { kind: "unknown" as const };
  if (input.requirement.maxCost) {
    if (cost.kind === "fixed" || cost.kind === "estimated") {
      if (cost.currency !== input.requirement.maxCost.currency) {
        reasons.push("cost_currency_mismatch");
      } else if ((cost.amount ?? Number.POSITIVE_INFINITY) > input.requirement.maxCost.amount) {
        reasons.push("cost_exceeds_limit");
      }
    } else if (cost.kind === "unknown" && !input.policy.allowUnknownCost) {
      reasons.push("unknown_cost_not_allowed");
    }
  } else if (cost.kind === "unknown" && !input.policy.allowUnknownCost) {
    reasons.push("unknown_cost_not_allowed");
  }

  const healthRank =
    health?.state === "available" &&
    (!candidate.connectorHealth || candidate.connectorHealth.state === "available")
      ? 0
      : 1;
  const deviceRank = input.requirement.deviceId
    ? device?.deviceId === input.requirement.deviceId
      ? 0
      : 2
    : device && descriptor.deviceAffinities?.includes(device.deviceId)
      ? 0
      : device
        ? 1
        : 2;
  const modelRank = input.requirement.model
    ? descriptor.models?.includes(input.requirement.model)
      ? 0
      : 1
    : descriptor.models?.length
      ? 0
      : 1;
  const costKindRank =
    cost.kind === "free"
      ? 0
      : cost.kind === "fixed" || cost.kind === "estimated"
        ? 1
        : 2;
  const costAmount =
    cost.kind === "free"
      ? 0
      : cost.kind === "fixed" || cost.kind === "estimated"
        ? (cost.amount ?? Number.MAX_SAFE_INTEGER)
        : Number.MAX_SAFE_INTEGER;

  return {
    candidate,
    evaluation: {
      descriptorId: descriptor.descriptorId,
      descriptorVersion: descriptor.descriptorVersion,
      connectorId: connector.connectorId,
      connectorVersion: connector.connectorVersion,
      deviceId: device?.deviceId,
      eligible: reasons.length === 0,
      reasonCodes: uniqueInReasonOrder(reasons),
      rank: [healthRank, deviceRank, modelRank, costKindRank, costAmount],
    },
  };
}

function compareEvaluated(left: EvaluatedCandidate, right: EvaluatedCandidate): number {
  if (left.evaluation.eligible !== right.evaluation.eligible) {
    return left.evaluation.eligible ? -1 : 1;
  }
  const leftRank = left.evaluation.rank!;
  const rightRank = right.evaluation.rank!;
  for (let index = 0; index < leftRank.length; index += 1) {
    if (leftRank[index] !== rightRank[index]) {
      return leftRank[index]! - rightRank[index]!;
    }
  }
  const idCompared = left.evaluation.descriptorId.localeCompare(
    right.evaluation.descriptorId,
  );
  if (idCompared !== 0) return idCompared;
  const versionCompared = -compareVersions(
    left.evaluation.descriptorVersion,
    right.evaluation.descriptorVersion,
  );
  if (versionCompared !== 0) return versionCompared;
  const connectorCompared = left.evaluation.connectorId.localeCompare(
    right.evaluation.connectorId,
  );
  if (connectorCompared !== 0) return connectorCompared;
  return (left.evaluation.deviceId ?? "").localeCompare(
    right.evaluation.deviceId ?? "",
  );
}

export function planAssignment(input: PlanAssignmentInput): AssignmentPlan {
  const plannedAt = validateInput(input);
  const evaluated = input.candidates
    .map((candidate) => evaluate(input, candidate, plannedAt))
    .sort(compareEvaluated);
  const selected = evaluated.find((candidate) => candidate.evaluation.eligible);
  const evaluations = evaluated.map(({ evaluation }) => evaluation);
  const basePlan = {
    schemaVersion: HOST_CAPABILITY_SCHEMA_VERSION,
    plannedAt: input.plannedAt,
    projectId: input.requirement.projectId,
    workRunId: input.requirement.workRunId,
    requirementId: input.requirement.requirementId,
    policyId: input.policy.policyId,
    policyVersion: input.policy.policyVersion,
    grantId: input.grant.grantId,
    status: selected ? ("matched" as const) : ("no-match" as const),
    approval: {
      status: "pending" as const,
    },
    selected: selected
      ? {
          descriptorId: selected.evaluation.descriptorId,
          descriptorVersion: selected.evaluation.descriptorVersion,
          descriptorFingerprint: selected.candidate.descriptor.fingerprint,
          connectorId: selected.evaluation.connectorId,
          connectorVersion: selected.evaluation.connectorVersion,
          connectorFingerprint: selected.candidate.connector.fingerprint,
          deviceId: selected.evaluation.deviceId,
        }
      : undefined,
    evaluations,
    diagnostics: {
      code: selected
        ? ("assignment_matched" as const)
        : ("assignment_no_match" as const),
      message: selected
        ? `Selected ${selected.evaluation.descriptorId}@${selected.evaluation.descriptorVersion}`
        : "No registered host capability satisfies the requirement, policy, health, device, cost, and grant constraints",
      reasonCodes: selected
        ? []
        : uniqueInReasonOrder(
            evaluations.flatMap((evaluation) => evaluation.reasonCodes),
          ),
      tieBreakOrder: [...ASSIGNMENT_TIE_BREAK_ORDER],
    },
  };
  const digest = fingerprintContract(basePlan).slice("sha256:".length, "sha256:".length + 24);
  return {
    ...basePlan,
    planId: `assignment-plan/${digest}`,
  };
}
