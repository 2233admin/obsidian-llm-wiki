import { createHash } from "node:crypto";

export const HOST_CAPABILITY_SCHEMA_VERSION = "1.0.0" as const;

export type HostCapabilitySchemaVersion = typeof HOST_CAPABILITY_SCHEMA_VERSION;
export type Sha256Digest = `sha256:${string}`;

export type CapabilityHealthState =
  | "available"
  | "degraded"
  | "unavailable"
  | "disabled";

export type SideEffectClass =
  | "none"
  | "local-read"
  | "local-write"
  | "external-read"
  | "external-write";

export interface CapabilityImportProvenance {
  schemaVersion: HostCapabilitySchemaVersion;
  source: {
    url: string;
    revision: {
      kind: "commit" | "version";
      value: string;
    };
    contentHash: Sha256Digest;
  };
  licenseReview: {
    status: "approved" | "rejected" | "needs-review";
    expression: string;
    reviewedBy: string;
    reviewedAt: string;
    notes?: string;
  };
  importer: {
    name: string;
    version: string;
  };
  approval: {
    status: "approved" | "rejected" | "pending" | "stale";
    reviewedBy?: string;
    reviewedAt?: string;
  };
}

export interface CapabilityHealth {
  schemaVersion: HostCapabilitySchemaVersion;
  state: CapabilityHealthState;
  observedAt: string;
  expiresAt?: string;
  reasonCodes: string[];
  remediationKeys: string[];
  diagnostics?: Record<string, unknown>;
}

export interface ExpertOperationDescriptor {
  operation: string;
  description: string;
  sideEffectClass: SideEffectClass;
  grantKey: string;
  inputSchema?: Record<string, unknown>;
}

export interface ExpertDescriptor {
  schemaVersion: HostCapabilitySchemaVersion;
  descriptorId: string;
  descriptorVersion: string;
  displayName: string;
  capabilities: string[];
  operations: ExpertOperationDescriptor[];
  models?: string[];
  deviceAffinities?: string[];
  resourceClasses?: string[];
  cost?: {
    kind: "free" | "fixed" | "estimated" | "unknown";
    amount?: number;
    currency?: string;
  };
  connectorRef: {
    connectorId: string;
    connectorVersion: string;
  };
  importProvenance: CapabilityImportProvenance;
}

export interface HostCapabilityConnector {
  schemaVersion: HostCapabilitySchemaVersion;
  connectorId: string;
  connectorVersion: string;
  displayName: string;
  kind:
    | "mcp"
    | "local-cli"
    | "cloud-agent"
    | "remote-workflow"
    | "local-model"
    | "cloud-model";
  transport: "mock" | "stdio" | "http" | "in-process";
  supportedOperations: string[];
  importProvenance: CapabilityImportProvenance;
}

export interface CapabilityOperationGrant {
  schemaVersion: HostCapabilitySchemaVersion;
  grantId: string;
  projectId: string;
  workRunId: string;
  descriptorIds: string[];
  connectorIds: string[];
  operations: string[];
  sideEffectClasses: SideEffectClass[];
  expiresAt: string;
}

export interface DeviceCapabilityAdvertisement {
  schemaVersion: HostCapabilitySchemaVersion;
  deviceId: string;
  health: CapabilityHealthState;
  capabilities: string[];
  models: string[];
  resourceClasses: string[];
  observedAt: string;
  expiresAt: string;
}

export interface AssignmentRequirement {
  schemaVersion: HostCapabilitySchemaVersion;
  requirementId: string;
  projectId: string;
  workRunId: string;
  capabilities: string[];
  operations: string[];
  model?: string;
  deviceId?: string;
  resourceClass?: string;
  maxCost?: {
    amount: number;
    currency: string;
  };
}

export interface ProjectCapabilityPolicy {
  schemaVersion: HostCapabilitySchemaVersion;
  policyId: string;
  policyVersion: string;
  allowedDescriptorIds?: string[];
  deniedDescriptorIds?: string[];
  allowedConnectorIds?: string[];
  allowedModels?: string[];
  allowedDeviceIds?: string[];
  allowedSideEffectClasses: SideEffectClass[];
  allowDegradedHealth: boolean;
  allowUnknownCost: boolean;
}

export interface AssignmentCandidateEvaluation {
  descriptorId: string;
  descriptorVersion: string;
  connectorId: string;
  connectorVersion: string;
  deviceId?: string;
  eligible: boolean;
  reasonCodes: string[];
  rank?: readonly [number, number, number, number, number];
}

export interface AssignmentPlanSelection {
  descriptorId: string;
  descriptorVersion: string;
  descriptorFingerprint: Sha256Digest;
  connectorId: string;
  connectorVersion: string;
  connectorFingerprint: Sha256Digest;
  deviceId?: string;
}

export interface AssignmentPlan {
  schemaVersion: HostCapabilitySchemaVersion;
  planId: string;
  plannedAt: string;
  projectId: string;
  workRunId: string;
  requirementId: string;
  policyId: string;
  policyVersion: string;
  grantId: string;
  projectBinding?: {
    bindingId: string;
    bindingRevision: number;
    projectContextFingerprint: Sha256Digest;
  };
  status: "matched" | "no-match";
  approval: {
    status: "pending" | "approved" | "rejected";
    reviewedBy?: string;
    reviewedAt?: string;
  };
  selected?: AssignmentPlanSelection;
  evaluations: AssignmentCandidateEvaluation[];
  diagnostics: {
    code: "assignment_matched" | "assignment_no_match";
    message: string;
    reasonCodes: string[];
    tieBreakOrder: string[];
  };
}

export class HostCapabilityContractError extends Error {
  readonly code = "invalid_host_capability_contract";

  constructor(message: string) {
    super(message);
    this.name = "HostCapabilityContractError";
  }
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._/-]*$/;
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SENSITIVE_KEY_PATTERN =
  /(?:authorization|cookie|token|secret|password|passphrase|api[-_]?key|private[-_]?key|client[-_]?secret|headers?)/i;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
const POSIX_HOME_PATH_PATTERN = /^\/(?:Users|home|root)\//;

function fail(path: string, message: string): never {
  throw new HostCapabilityContractError(`${path}: ${message}`);
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(path, "must be a non-empty string");
  }
}

function assertIdentifier(value: unknown, path: string): asserts value is string {
  assertString(value, path);
  if (!ID_PATTERN.test(value)) {
    fail(path, "must be a stable lowercase identifier");
  }
}

function assertVersion(value: unknown, path: string): asserts value is string {
  assertString(value, path);
  if (!VERSION_PATTERN.test(value)) {
    fail(path, "must be a stable version string");
  }
}

function parseTimestamp(value: unknown, path: string): number {
  assertString(value, path);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    fail(path, "must be an ISO-8601 timestamp");
  }
  return parsed;
}

function assertSchemaVersion(value: unknown, path: string): void {
  if (value !== HOST_CAPABILITY_SCHEMA_VERSION) {
    fail(path, `must equal ${HOST_CAPABILITY_SCHEMA_VERSION}`);
  }
}

function assertStringList(value: unknown, path: string): asserts value is string[] {
  if (!Array.isArray(value)) {
    fail(path, "must be an array");
  }
  const seen = new Set<string>();
  value.forEach((item, index) => {
    assertIdentifier(item, `${path}[${index}]`);
    if (seen.has(item)) {
      fail(`${path}[${index}]`, "must not contain duplicates");
    }
    seen.add(item);
  });
}

function assertNoSensitiveMaterial(value: unknown, path: string): void {
  if (typeof value === "string") {
    if (/\bBearer\s+[A-Za-z0-9._~+/=-]+/i.test(value)) {
      fail(path, "must not contain bearer credentials");
    }
    if (
      WINDOWS_ABSOLUTE_PATH_PATTERN.test(value) ||
      POSIX_HOME_PATH_PATTERN.test(value)
    ) {
      fail(path, "must not contain machine-local absolute paths");
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoSensitiveMaterial(entry, `${path}[${index}]`),
    );
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        fail(`${path}.${key}`, "sensitive keys are forbidden");
      }
      assertNoSensitiveMaterial(entry, `${path}.${key}`);
    }
  }
}

export function validateCapabilityImportProvenance(
  provenance: CapabilityImportProvenance,
): void {
  if (!provenance || typeof provenance !== "object") {
    fail("importProvenance", "must be an object");
  }
  assertSchemaVersion(provenance.schemaVersion, "importProvenance.schemaVersion");
  try {
    const sourceUrl = new URL(provenance.source.url);
    if (sourceUrl.protocol !== "https:" && sourceUrl.protocol !== "http:") {
      fail("importProvenance.source.url", "must use http or https");
    }
  } catch (error) {
    if (error instanceof HostCapabilityContractError) throw error;
    fail("importProvenance.source.url", "must be a valid canonical URL");
  }
  if (!(["commit", "version"] as const).includes(provenance.source.revision.kind)) {
    fail("importProvenance.source.revision.kind", "must be commit or version");
  }
  assertString(
    provenance.source.revision.value,
    "importProvenance.source.revision.value",
  );
  if (!SHA256_PATTERN.test(provenance.source.contentHash)) {
    fail("importProvenance.source.contentHash", "must be a sha256 digest");
  }
  if (
    !(["approved", "rejected", "needs-review"] as const).includes(
      provenance.licenseReview.status,
    )
  ) {
    fail(
      "importProvenance.licenseReview.status",
      "must be approved, rejected, or needs-review",
    );
  }
  assertString(
    provenance.licenseReview.expression,
    "importProvenance.licenseReview.expression",
  );
  assertString(
    provenance.licenseReview.reviewedBy,
    "importProvenance.licenseReview.reviewedBy",
  );
  parseTimestamp(
    provenance.licenseReview.reviewedAt,
    "importProvenance.licenseReview.reviewedAt",
  );
  assertIdentifier(provenance.importer.name, "importProvenance.importer.name");
  assertVersion(provenance.importer.version, "importProvenance.importer.version");
  if (
    !(["approved", "rejected", "pending", "stale"] as const).includes(
      provenance.approval.status,
    )
  ) {
    fail("importProvenance.approval.status", "has an unsupported value");
  }
  if (provenance.approval.status === "approved") {
    assertString(
      provenance.approval.reviewedBy,
      "importProvenance.approval.reviewedBy",
    );
    parseTimestamp(
      provenance.approval.reviewedAt,
      "importProvenance.approval.reviewedAt",
    );
  }
  assertNoSensitiveMaterial(provenance, "importProvenance");
}

export function validateCapabilityHealth(health: CapabilityHealth): void {
  if (!health || typeof health !== "object") {
    fail("health", "must be an object");
  }
  assertSchemaVersion(health.schemaVersion, "health.schemaVersion");
  if (
    !(["available", "degraded", "unavailable", "disabled"] as const).includes(
      health.state,
    )
  ) {
    fail("health.state", "has an unsupported value");
  }
  const observedAt = parseTimestamp(health.observedAt, "health.observedAt");
  if (health.expiresAt) {
    const expiresAt = parseTimestamp(health.expiresAt, "health.expiresAt");
    if (expiresAt <= observedAt) {
      fail("health.expiresAt", "must be later than observedAt");
    }
  }
  assertStringList(health.reasonCodes, "health.reasonCodes");
  assertStringList(health.remediationKeys, "health.remediationKeys");
  assertNoSensitiveMaterial(health.diagnostics, "health.diagnostics");
}

export function validateExpertDescriptor(descriptor: ExpertDescriptor): void {
  if (!descriptor || typeof descriptor !== "object") {
    fail("descriptor", "must be an object");
  }
  assertSchemaVersion(descriptor.schemaVersion, "descriptor.schemaVersion");
  assertIdentifier(descriptor.descriptorId, "descriptor.descriptorId");
  assertVersion(descriptor.descriptorVersion, "descriptor.descriptorVersion");
  assertString(descriptor.displayName, "descriptor.displayName");
  assertStringList(descriptor.capabilities, "descriptor.capabilities");
  if (!Array.isArray(descriptor.operations) || descriptor.operations.length === 0) {
    fail("descriptor.operations", "must contain at least one operation");
  }
  const operationIds = new Set<string>();
  descriptor.operations.forEach((operation, index) => {
    const path = `descriptor.operations[${index}]`;
    assertIdentifier(operation.operation, `${path}.operation`);
    assertString(operation.description, `${path}.description`);
    assertIdentifier(operation.grantKey, `${path}.grantKey`);
    if (
      !(
        [
          "none",
          "local-read",
          "local-write",
          "external-read",
          "external-write",
        ] as const
      ).includes(operation.sideEffectClass)
    ) {
      fail(`${path}.sideEffectClass`, "has an unsupported value");
    }
    if (operationIds.has(operation.operation)) {
      fail(`${path}.operation`, "must be unique");
    }
    operationIds.add(operation.operation);
    assertNoSensitiveMaterial(operation.inputSchema, `${path}.inputSchema`);
  });
  if (descriptor.models) assertStringList(descriptor.models, "descriptor.models");
  if (descriptor.deviceAffinities) {
    assertStringList(descriptor.deviceAffinities, "descriptor.deviceAffinities");
  }
  if (descriptor.resourceClasses) {
    assertStringList(descriptor.resourceClasses, "descriptor.resourceClasses");
  }
  if (descriptor.cost) {
    if (
      !(["free", "fixed", "estimated", "unknown"] as const).includes(
        descriptor.cost.kind,
      )
    ) {
      fail("descriptor.cost.kind", "has an unsupported value");
    }
    if (descriptor.cost.kind === "fixed" || descriptor.cost.kind === "estimated") {
      if (
        typeof descriptor.cost.amount !== "number" ||
        !Number.isFinite(descriptor.cost.amount) ||
        descriptor.cost.amount < 0
      ) {
        fail("descriptor.cost.amount", "must be a non-negative finite number");
      }
      assertString(descriptor.cost.currency, "descriptor.cost.currency");
    }
  }
  assertIdentifier(
    descriptor.connectorRef.connectorId,
    "descriptor.connectorRef.connectorId",
  );
  assertVersion(
    descriptor.connectorRef.connectorVersion,
    "descriptor.connectorRef.connectorVersion",
  );
  validateCapabilityImportProvenance(descriptor.importProvenance);
}

export function validateHostCapabilityConnector(
  connector: HostCapabilityConnector,
): void {
  if (!connector || typeof connector !== "object") {
    fail("connector", "must be an object");
  }
  assertSchemaVersion(connector.schemaVersion, "connector.schemaVersion");
  assertIdentifier(connector.connectorId, "connector.connectorId");
  assertVersion(connector.connectorVersion, "connector.connectorVersion");
  assertString(connector.displayName, "connector.displayName");
  if (
    !(
      [
        "mcp",
        "local-cli",
        "cloud-agent",
        "remote-workflow",
        "local-model",
        "cloud-model",
      ] as const
    ).includes(connector.kind)
  ) {
    fail("connector.kind", "has an unsupported value");
  }
  if (
    !(["mock", "stdio", "http", "in-process"] as const).includes(
      connector.transport,
    )
  ) {
    fail("connector.transport", "has an unsupported value");
  }
  assertStringList(
    connector.supportedOperations,
    "connector.supportedOperations",
  );
  validateCapabilityImportProvenance(connector.importProvenance);
}

export function validateCapabilityOperationGrant(
  grant: CapabilityOperationGrant,
): void {
  if (!grant || typeof grant !== "object") {
    fail("capabilityGrant", "must be an object");
  }
  assertSchemaVersion(grant.schemaVersion, "capabilityGrant.schemaVersion");
  assertIdentifier(grant.grantId, "capabilityGrant.grantId");
  if (!/^project\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(grant.projectId)) {
    fail("capabilityGrant.projectId", "must be a canonical project/<slug> ID");
  }
  assertIdentifier(grant.workRunId, "capabilityGrant.workRunId");
  if (!/^work-run\/[a-z0-9][a-z0-9._-]*$/.test(grant.workRunId)) {
    fail("capabilityGrant.workRunId", "must be a canonical Work Run ID");
  }
  assertStringList(grant.descriptorIds, "capabilityGrant.descriptorIds");
  assertStringList(grant.connectorIds, "capabilityGrant.connectorIds");
  assertStringList(grant.operations, "capabilityGrant.operations");
  if (!Array.isArray(grant.sideEffectClasses)) {
    fail("capabilityGrant.sideEffectClasses", "must be an array");
  }
  const sideEffects = new Set<SideEffectClass>();
  grant.sideEffectClasses.forEach((sideEffect, index) => {
    if (
      !(
        [
          "none",
          "local-read",
          "local-write",
          "external-read",
          "external-write",
        ] as const
      ).includes(sideEffect)
    ) {
      fail(
        `capabilityGrant.sideEffectClasses[${index}]`,
        "has an unsupported value",
      );
    }
    if (sideEffects.has(sideEffect)) {
      fail(
        `capabilityGrant.sideEffectClasses[${index}]`,
        "must not contain duplicates",
      );
    }
    sideEffects.add(sideEffect);
  });
  parseTimestamp(grant.expiresAt, "capabilityGrant.expiresAt");
  assertNoSensitiveMaterial(grant, "capabilityGrant");
}

export function validateAssignmentPlan(plan: AssignmentPlan): void {
  if (!plan || typeof plan !== "object") {
    fail("assignmentPlan", "must be an object");
  }
  assertSchemaVersion(plan.schemaVersion, "assignmentPlan.schemaVersion");
  assertIdentifier(plan.planId, "assignmentPlan.planId");
  parseTimestamp(plan.plannedAt, "assignmentPlan.plannedAt");
  if (!/^project\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(plan.projectId)) {
    fail("assignmentPlan.projectId", "must be a canonical project/<slug> ID");
  }
  assertIdentifier(plan.workRunId, "assignmentPlan.workRunId");
  if (!/^work-run\/[a-z0-9][a-z0-9._-]*$/.test(plan.workRunId)) {
    fail("assignmentPlan.workRunId", "must be a canonical Work Run ID");
  }
  assertIdentifier(plan.requirementId, "assignmentPlan.requirementId");
  assertIdentifier(plan.policyId, "assignmentPlan.policyId");
  assertVersion(plan.policyVersion, "assignmentPlan.policyVersion");
  assertIdentifier(plan.grantId, "assignmentPlan.grantId");
  if (plan.projectBinding) {
    assertIdentifier(
      plan.projectBinding.bindingId,
      "assignmentPlan.projectBinding.bindingId",
    );
    if (
      !Number.isInteger(plan.projectBinding.bindingRevision) ||
      plan.projectBinding.bindingRevision < 1
    ) {
      fail(
        "assignmentPlan.projectBinding.bindingRevision",
        "must be a positive integer",
      );
    }
    if (!SHA256_PATTERN.test(plan.projectBinding.projectContextFingerprint)) {
      fail(
        "assignmentPlan.projectBinding.projectContextFingerprint",
        "must be a sha256 digest",
      );
    }
  }
  if (plan.status === "matched" && !plan.selected) {
    fail("assignmentPlan.selected", "is required for a matched plan");
  }
  if (plan.status === "no-match" && plan.selected) {
    fail("assignmentPlan.selected", "must be absent for a no-match plan");
  }
  if (!(["pending", "approved", "rejected"] as const).includes(plan.approval.status)) {
    fail("assignmentPlan.approval.status", "has an unsupported value");
  }
  if (plan.approval.status === "approved") {
    assertString(plan.approval.reviewedBy, "assignmentPlan.approval.reviewedBy");
    parseTimestamp(plan.approval.reviewedAt, "assignmentPlan.approval.reviewedAt");
  }
  if (plan.selected) {
    assertIdentifier(
      plan.selected.descriptorId,
      "assignmentPlan.selected.descriptorId",
    );
    assertVersion(
      plan.selected.descriptorVersion,
      "assignmentPlan.selected.descriptorVersion",
    );
    if (!SHA256_PATTERN.test(plan.selected.descriptorFingerprint)) {
      fail(
        "assignmentPlan.selected.descriptorFingerprint",
        "must be a sha256 digest",
      );
    }
    assertIdentifier(
      plan.selected.connectorId,
      "assignmentPlan.selected.connectorId",
    );
    assertVersion(
      plan.selected.connectorVersion,
      "assignmentPlan.selected.connectorVersion",
    );
    if (!SHA256_PATTERN.test(plan.selected.connectorFingerprint)) {
      fail(
        "assignmentPlan.selected.connectorFingerprint",
        "must be a sha256 digest",
      );
    }
  }
  assertNoSensitiveMaterial(plan, "assignmentPlan");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function fingerprintContract(value: unknown): Sha256Digest {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function normalizeExpertDescriptor(
  descriptor: ExpertDescriptor,
): ExpertDescriptor {
  validateExpertDescriptor(descriptor);
  return {
    ...descriptor,
    capabilities: [...descriptor.capabilities].sort(),
    operations: [...descriptor.operations]
      .map((operation) => ({ ...operation }))
      .sort((left, right) => left.operation.localeCompare(right.operation)),
    models: descriptor.models ? [...descriptor.models].sort() : undefined,
    deviceAffinities: descriptor.deviceAffinities
      ? [...descriptor.deviceAffinities].sort()
      : undefined,
    resourceClasses: descriptor.resourceClasses
      ? [...descriptor.resourceClasses].sort()
      : undefined,
  };
}

export function normalizeHostCapabilityConnector(
  connector: HostCapabilityConnector,
): HostCapabilityConnector {
  validateHostCapabilityConnector(connector);
  return {
    ...connector,
    supportedOperations: [...connector.supportedOperations].sort(),
  };
}

export function descriptorKey(
  descriptorId: string,
  descriptorVersion: string,
): string {
  return `${descriptorId}@${descriptorVersion}`;
}

export function connectorKey(
  connectorId: string,
  connectorVersion: string,
): string {
  return `${connectorId}@${connectorVersion}`;
}

export function isApprovedProvenance(
  provenance: CapabilityImportProvenance,
): boolean {
  return (
    provenance.licenseReview.status === "approved" &&
    provenance.approval.status === "approved"
  );
}

export function compareVersions(left: string, right: string): number {
  const leftParts = left.split(/[.+_-]/);
  const rightParts = right.split(/[.+_-]/);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? "";
    const rightPart = rightParts[index] ?? "";
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : undefined;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : undefined;
    if (leftNumber !== undefined && rightNumber !== undefined) {
      if (leftNumber !== rightNumber) return leftNumber - rightNumber;
      continue;
    }
    const compared = leftPart.localeCompare(rightPart);
    if (compared !== 0) return compared;
  }
  return 0;
}
