import {
  HOST_CAPABILITY_SCHEMA_VERSION,
  type AssignmentRequirement,
  type CapabilityHealth,
  type CapabilityOperationGrant,
  type DeviceCapabilityAdvertisement,
  type ExpertDescriptor,
  type HostCapabilityConnector,
  type ProjectCapabilityPolicy,
  type Sha256Digest,
  validateCapabilityHealth,
  validateCapabilityOperationGrant,
  validateExpertDescriptor,
  validateHostCapabilityConnector,
} from "./contracts.js";
import type { SourceObservation } from "./registry.js";

export const HOST_CAPABILITY_OPERATION_SCHEMA_VERSION = 1 as const;

export interface HostCapabilitySecretReference {
  provider: "os-keychain" | "environment" | "external-vault";
  locator: string;
  version?: string;
}

export interface HostCapabilityConnectorConfiguration {
  parameters?: Record<string, unknown>;
  secretRequired?: boolean;
  secretReference?: HostCapabilitySecretReference;
}

export interface ExpertDescriptorRegistration {
  schemaVersion: typeof HOST_CAPABILITY_OPERATION_SCHEMA_VERSION;
  descriptor: ExpertDescriptor;
  health: CapabilityHealth;
  sourceObservation?: SourceObservation;
}

export interface HostCapabilityConnectorRegistration {
  schemaVersion: typeof HOST_CAPABILITY_OPERATION_SCHEMA_VERSION;
  connector: HostCapabilityConnector;
  health: CapabilityHealth;
  configuration: HostCapabilityConnectorConfiguration;
  sourceObservation?: SourceObservation;
}

/** Structural projection of the canonical Agent-domain ProjectAgentBinding. */
export interface ProjectCapabilityBinding {
  schemaVersion: 1;
  bindingId: string;
  projectId: string;
  projectContextFingerprint: Sha256Digest;
  profileId: string;
  revision: number;
  enabled: boolean;
  connectorGrantRefs: string[];
}

export class HostCapabilityOperationContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostCapabilityOperationContractError";
  }
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._/-]*$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SENSITIVE_KEY_PATTERN =
  /(?:authorization|cookie|token|secret(?!Reference)|password|passphrase|api[-_]?key|private[-_]?key|client[-_]?secret|headers?|env)/i;
const WINDOWS_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
const POSIX_HOME_PATTERN = /^\/(?:Users|home|root)\//;

function fail(path: string, message: string): never {
  throw new HostCapabilityOperationContractError(`${path}: ${message}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "must be an object");
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    fail(path, "must be a non-empty string");
  }
  return value.trim();
}

function identifier(value: unknown, path: string): string {
  const parsed = string(value, path);
  if (!ID_PATTERN.test(parsed)) fail(path, "must be a stable lowercase identifier");
  return parsed;
}

function strings(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) fail(path, "must be an array");
  const result = value.map((item, index) => identifier(item, `${path}[${index}]`));
  if (new Set(result).size !== result.length) fail(path, "must not contain duplicates");
  return result;
}

function optionalStrings(value: unknown, path: string): string[] | undefined {
  return value === undefined ? undefined : strings(value, path);
}

function safePublicValue(value: unknown, path: string): void {
  if (typeof value === "string") {
    if (/\bBearer\s+\S+/i.test(value)) fail(path, "must not contain bearer credentials");
    if (/^https?:\/\/[^\s/@:]+:[^\s/@]+@/i.test(value)) {
      fail(path, "must not contain URL credentials");
    }
    if (WINDOWS_PATH_PATTERN.test(value) || POSIX_HOME_PATTERN.test(value)) {
      fail(path, "must not contain machine-local absolute paths");
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => safePublicValue(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        fail(`${path}.${key}`, "secret values are forbidden; use secretReference");
      }
      safePublicValue(item, `${path}.${key}`);
    }
  }
}

function sourceObservation(value: unknown, path: string): SourceObservation | undefined {
  if (value === undefined) return undefined;
  const item = record(value, path);
  const revision = record(item.revision, `${path}.revision`);
  const kind = string(revision.kind, `${path}.revision.kind`);
  if (kind !== "commit" && kind !== "version") {
    fail(`${path}.revision.kind`, "must be commit or version");
  }
  const contentHash = string(item.contentHash, `${path}.contentHash`);
  if (!SHA256_PATTERN.test(contentHash)) fail(`${path}.contentHash`, "must be a sha256 digest");
  const observedAt = string(item.observedAt, `${path}.observedAt`);
  if (!Number.isFinite(Date.parse(observedAt))) fail(`${path}.observedAt`, "must be a timestamp");
  return {
    revision: {
      kind,
      value: string(revision.value, `${path}.revision.value`),
    },
    contentHash: contentHash as Sha256Digest,
    observedAt,
  };
}

export function validateConnectorConfiguration(
  value: unknown,
): HostCapabilityConnectorConfiguration {
  const item = record(value ?? {}, "configuration");
  const allowed = new Set(["parameters", "secretRequired", "secretReference"]);
  for (const key of Object.keys(item)) {
    if (!allowed.has(key)) fail(`configuration.${key}`, "is not supported");
  }
  const parameters = item.parameters === undefined
    ? undefined
    : record(item.parameters, "configuration.parameters");
  safePublicValue(parameters, "configuration.parameters");
  if (item.secretRequired !== undefined && typeof item.secretRequired !== "boolean") {
    fail("configuration.secretRequired", "must be boolean");
  }
  let secretReference: HostCapabilitySecretReference | undefined;
  if (item.secretReference !== undefined) {
    const reference = record(item.secretReference, "configuration.secretReference");
    const provider = string(reference.provider, "configuration.secretReference.provider");
    if (!new Set(["os-keychain", "environment", "external-vault"]).has(provider)) {
      fail("configuration.secretReference.provider", "has an unsupported value");
    }
    const locator = string(reference.locator, "configuration.secretReference.locator");
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(locator)) {
      fail("configuration.secretReference.locator", "must be a logical locator");
    }
    secretReference = {
      provider: provider as HostCapabilitySecretReference["provider"],
      locator,
      ...(reference.version === undefined
        ? {}
        : { version: string(reference.version, "configuration.secretReference.version") }),
    };
  }
  return {
    ...(parameters ? { parameters: structuredClone(parameters) } : {}),
    ...(item.secretRequired === undefined
      ? {}
      : { secretRequired: item.secretRequired }),
    ...(secretReference ? { secretReference } : {}),
  };
}

export function validateDescriptorRegistration(
  value: unknown,
): ExpertDescriptorRegistration {
  const item = record(value, "registration");
  if (item.schemaVersion !== HOST_CAPABILITY_OPERATION_SCHEMA_VERSION) {
    fail("registration.schemaVersion", "must equal 1");
  }
  validateExpertDescriptor(item.descriptor as ExpertDescriptor);
  validateCapabilityHealth(item.health as CapabilityHealth);
  return {
    schemaVersion: HOST_CAPABILITY_OPERATION_SCHEMA_VERSION,
    descriptor: structuredClone(item.descriptor as ExpertDescriptor),
    health: structuredClone(item.health as CapabilityHealth),
    sourceObservation: sourceObservation(
      item.sourceObservation,
      "registration.sourceObservation",
    ),
  };
}

export function validateConnectorRegistration(
  value: unknown,
): HostCapabilityConnectorRegistration {
  const item = record(value, "registration");
  if (item.schemaVersion !== HOST_CAPABILITY_OPERATION_SCHEMA_VERSION) {
    fail("registration.schemaVersion", "must equal 1");
  }
  validateHostCapabilityConnector(item.connector as HostCapabilityConnector);
  validateCapabilityHealth(item.health as CapabilityHealth);
  return {
    schemaVersion: HOST_CAPABILITY_OPERATION_SCHEMA_VERSION,
    connector: structuredClone(item.connector as HostCapabilityConnector),
    health: structuredClone(item.health as CapabilityHealth),
    configuration: validateConnectorConfiguration(item.configuration),
    sourceObservation: sourceObservation(
      item.sourceObservation,
      "registration.sourceObservation",
    ),
  };
}

export function validateProjectCapabilityBinding(
  value: unknown,
): ProjectCapabilityBinding {
  const item = record(value, "binding");
  if (item.schemaVersion !== 1) fail("binding.schemaVersion", "must equal 1");
  const bindingId = identifier(item.bindingId, "binding.bindingId");
  if (!/^binding\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/.test(bindingId)) {
    fail("binding.bindingId", "must use binding/<project>/<agent>");
  }
  const projectId = identifier(item.projectId, "binding.projectId");
  if (!/^project\/[a-z0-9][a-z0-9-]*$/.test(projectId)) {
    fail("binding.projectId", "must be a canonical Project ID");
  }
  const bindingParts = bindingId.split("/");
  if (projectId !== `project/${bindingParts[1]}`) {
    fail("binding.bindingId", "project segment must match binding.projectId");
  }
  const projectContextFingerprint = string(
    item.projectContextFingerprint,
    "binding.projectContextFingerprint",
  );
  if (!SHA256_PATTERN.test(projectContextFingerprint)) {
    fail("binding.projectContextFingerprint", "must be a sha256 digest");
  }
  if (!Number.isInteger(item.revision) || (item.revision as number) < 1) {
    fail("binding.revision", "must be a positive integer");
  }
  if (typeof item.enabled !== "boolean") fail("binding.enabled", "must be boolean");
  const profileId = identifier(item.profileId, "binding.profileId");
  if (profileId && profileId !== `agent/${bindingParts[2]}`) {
    fail("binding.bindingId", "agent segment must match binding.profileId");
  }
  return {
    schemaVersion: 1,
    bindingId,
    projectId,
    projectContextFingerprint: projectContextFingerprint as Sha256Digest,
    profileId,
    revision: item.revision as number,
    enabled: item.enabled,
    connectorGrantRefs: strings(
      item.connectorGrantRefs,
      "binding.connectorGrantRefs",
    ),
  };
}

export function validateAssignmentRequirement(
  value: unknown,
): AssignmentRequirement {
  const item = record(value, "requirement");
  if (item.schemaVersion !== HOST_CAPABILITY_SCHEMA_VERSION) {
    fail("requirement.schemaVersion", `must equal ${HOST_CAPABILITY_SCHEMA_VERSION}`);
  }
  const maxCost = item.maxCost === undefined
    ? undefined
    : record(item.maxCost, "requirement.maxCost");
  if (maxCost) {
    if (typeof maxCost.amount !== "number" || !Number.isFinite(maxCost.amount) || maxCost.amount < 0) {
      fail("requirement.maxCost.amount", "must be a non-negative finite number");
    }
  }
  return {
    schemaVersion: HOST_CAPABILITY_SCHEMA_VERSION,
    requirementId: identifier(item.requirementId, "requirement.requirementId"),
    projectId: identifier(item.projectId, "requirement.projectId"),
    workRunId: identifier(item.workRunId, "requirement.workRunId"),
    capabilities: strings(item.capabilities, "requirement.capabilities"),
    operations: strings(item.operations, "requirement.operations"),
    model: item.model === undefined ? undefined : identifier(item.model, "requirement.model"),
    deviceId: item.deviceId === undefined
      ? undefined
      : identifier(item.deviceId, "requirement.deviceId"),
    resourceClass: item.resourceClass === undefined
      ? undefined
      : identifier(item.resourceClass, "requirement.resourceClass"),
    maxCost: maxCost
      ? {
          amount: maxCost.amount as number,
          currency: string(maxCost.currency, "requirement.maxCost.currency"),
        }
      : undefined,
  };
}

export function validateProjectCapabilityPolicy(
  value: unknown,
): ProjectCapabilityPolicy {
  const item = record(value, "policy");
  if (item.schemaVersion !== HOST_CAPABILITY_SCHEMA_VERSION) {
    fail("policy.schemaVersion", `must equal ${HOST_CAPABILITY_SCHEMA_VERSION}`);
  }
  if (typeof item.allowDegradedHealth !== "boolean") {
    fail("policy.allowDegradedHealth", "must be boolean");
  }
  if (typeof item.allowUnknownCost !== "boolean") {
    fail("policy.allowUnknownCost", "must be boolean");
  }
  const allowedSideEffectClasses = strings(
    item.allowedSideEffectClasses,
    "policy.allowedSideEffectClasses",
  ) as ProjectCapabilityPolicy["allowedSideEffectClasses"];
  const supportedSideEffects = new Set([
    "none",
    "local-read",
    "local-write",
    "external-read",
    "external-write",
  ]);
  if (allowedSideEffectClasses.some((value) => !supportedSideEffects.has(value))) {
    fail("policy.allowedSideEffectClasses", "contains an unsupported value");
  }
  return {
    schemaVersion: HOST_CAPABILITY_SCHEMA_VERSION,
    policyId: identifier(item.policyId, "policy.policyId"),
    policyVersion: string(item.policyVersion, "policy.policyVersion"),
    allowedDescriptorIds: optionalStrings(
      item.allowedDescriptorIds,
      "policy.allowedDescriptorIds",
    ),
    deniedDescriptorIds: optionalStrings(
      item.deniedDescriptorIds,
      "policy.deniedDescriptorIds",
    ),
    allowedConnectorIds: optionalStrings(
      item.allowedConnectorIds,
      "policy.allowedConnectorIds",
    ),
    allowedModels: optionalStrings(item.allowedModels, "policy.allowedModels"),
    allowedDeviceIds: optionalStrings(
      item.allowedDeviceIds,
      "policy.allowedDeviceIds",
    ),
    allowedSideEffectClasses,
    allowDegradedHealth: item.allowDegradedHealth,
    allowUnknownCost: item.allowUnknownCost,
  };
}

export function validateCapabilityGrant(value: unknown): CapabilityOperationGrant {
  validateCapabilityOperationGrant(value as CapabilityOperationGrant);
  return structuredClone(value as CapabilityOperationGrant);
}

export function validateDeviceAdvertisements(
  value: unknown,
): DeviceCapabilityAdvertisement[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail("devices", "must be an array");
  return value.map((candidate, index) => {
    const item = record(candidate, `devices[${index}]`);
    if (item.schemaVersion !== HOST_CAPABILITY_SCHEMA_VERSION) {
      fail(`devices[${index}].schemaVersion`, `must equal ${HOST_CAPABILITY_SCHEMA_VERSION}`);
    }
    const health = string(item.health, `devices[${index}].health`);
    if (!new Set(["available", "degraded", "unavailable", "disabled"]).has(health)) {
      fail(`devices[${index}].health`, "has an unsupported value");
    }
    const observedAt = string(item.observedAt, `devices[${index}].observedAt`);
    const expiresAt = string(item.expiresAt, `devices[${index}].expiresAt`);
    if (!Number.isFinite(Date.parse(observedAt)) || !Number.isFinite(Date.parse(expiresAt))) {
      fail(`devices[${index}]`, "timestamps must be valid");
    }
    return {
      schemaVersion: HOST_CAPABILITY_SCHEMA_VERSION,
      deviceId: identifier(item.deviceId, `devices[${index}].deviceId`),
      health: health as DeviceCapabilityAdvertisement["health"],
      capabilities: strings(item.capabilities, `devices[${index}].capabilities`),
      models: strings(item.models, `devices[${index}].models`),
      resourceClasses: strings(
        item.resourceClasses,
        `devices[${index}].resourceClasses`,
      ),
      observedAt,
      expiresAt,
    };
  });
}
