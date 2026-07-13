import type {
  CapabilityHealth,
  EffectiveSetting,
  MutableSettingsScope,
  SecretReference,
  SettingDefinition,
  SettingValue,
  SettingsDocument,
  SettingsMutationResult,
  SettingsSnapshot,
  ValidationIssue,
  ValidationResult,
} from "../../packages/settings-platform/src/types";

export type SettingScope = MutableSettingsScope;
export type {
  CapabilityHealth as HealthCheck,
  EffectiveSetting,
  SecretReference,
  SettingDefinition,
  SettingValue,
  SettingsDocument,
  SettingsSnapshot,
  ValidationIssue as SettingValidationIssue,
  ValidationResult,
};

export interface SettingsSnapshotResult {
  snapshot: SettingsSnapshot;
  validation: ValidationResult;
  recoveryDiagnostics: ValidationIssue[];
}

export interface SettingsDoctorResult {
  snapshotId?: string;
  validation: ValidationResult;
  capabilities: CapabilityHealth[];
  checkedAt: string;
}

export interface SettingsDefinitionsResult {
  definitions: SettingDefinition[];
}

export interface SettingsScopeResult {
  document: SettingsDocument;
  recoveredFromBackup: boolean;
  diagnostics: ValidationIssue[];
}

export interface SettingsOperationTransport {
  invoke<T>(operation: string, args: Record<string, unknown>): Promise<T>;
}

export class SettingsConflictError extends Error {
  constructor(readonly conflict: Extract<SettingsMutationResult, { status: "conflict" }>["conflict"]) {
    super(`Settings revision conflict: expected ${conflict.expectedRevision}, found ${conflict.actualRevision}`);
    this.name = "SettingsConflictError";
  }
}

export class SettingsValidationError extends Error {
  constructor(readonly validation: ValidationResult) {
    super(validation.issues.map(issue => issue.message).join("; ") || "Settings validation failed");
    this.name = "SettingsValidationError";
  }
}

/** Thin host adapter over the shared Settings Platform Operation Interface. */
export class SettingsOperationClient {
  constructor(private readonly transport: SettingsOperationTransport) {}

  async definitions(): Promise<SettingDefinition[]> {
    return (await this.transport.invoke<SettingsDefinitionsResult>("settings.definitions.list", {})).definitions;
  }

  snapshot(): Promise<SettingsSnapshotResult> {
    return this.transport.invoke("settings.snapshot.resolve", {});
  }

  validate(): Promise<ValidationResult> {
    return this.transport.invoke("settings.validate", {});
  }

  doctor(): Promise<SettingsDoctorResult> {
    return this.transport.invoke("settings.doctor", {});
  }

  scope(scope: SettingScope): Promise<SettingsScopeResult> {
    return this.transport.invoke("settings.scopes.get", { scope });
  }

  async setAssignment(
    scope: SettingScope,
    key: string,
    value: SettingValue | SecretReference,
    expectedRevision: number,
    options: { reason?: string; expiresAt?: string } = {},
  ): Promise<SettingsSnapshotResult> {
    const result = await this.transport.invoke<SettingsMutationResult>("settings.assignment.set", {
      scope,
      key,
      value,
      expectedRevision,
      updatedBy: "obsidian-control-plane",
      ...options,
    });
    this.assertCommitted(result);
    return this.snapshot();
  }

  async unsetAssignment(scope: SettingScope, key: string, expectedRevision: number): Promise<SettingsSnapshotResult> {
    const result = await this.transport.invoke<SettingsMutationResult>("settings.assignment.unset", {
      scope,
      key,
      expectedRevision,
      updatedBy: "obsidian-control-plane",
    });
    this.assertCommitted(result);
    return this.snapshot();
  }

  private assertCommitted(result: SettingsMutationResult): asserts result is Extract<SettingsMutationResult, { status: "committed" }> {
    if (result.status === "conflict") throw new SettingsConflictError(result.conflict);
    if (result.status === "validation-error") throw new SettingsValidationError(result.validation);
  }
}

export interface SettingsControlPlaneProjection {
  definitions: SettingDefinition[];
  snapshot: SettingsSnapshot;
  validation: ValidationResult;
  recoveryDiagnostics: ValidationIssue[];
  health: CapabilityHealth[];
  doctorError?: string;
  refreshedAt: string;
}

export interface SettingPresentationRow {
  definition: SettingDefinition;
  effective: EffectiveSetting;
  assignedValue?: EffectiveSetting["value"];
  validation: ValidationIssue[];
  applyMode: SettingDefinition["applyMode"];
}

export function effectiveSetting(snapshot: SettingsSnapshot, key: string): EffectiveSetting | undefined {
  return snapshot.effective.find(item => item.key === key);
}

export function sourceRevision(snapshot: SettingsSnapshot, scope: SettingScope): number {
  const revision = snapshot.sourceRevisions[scope]?.revision;
  return typeof revision === "number" ? revision : 0;
}

export function projectSettingForScope(
  definition: SettingDefinition,
  snapshot: SettingsSnapshot,
  scope: SettingScope,
): SettingPresentationRow | null {
  const effective = effectiveSetting(snapshot, definition.key);
  if (!effective) return null;
  const candidate = effective.winningScope === scope
    ? effective
    : effective.overriddenCandidates.find(item => item.scope === scope);
  return {
    definition,
    effective,
    assignedValue: candidate?.value === null ? undefined : candidate?.value,
    validation: effective.validation.issues,
    applyMode: definition.applyMode,
  };
}

/**
 * Definitions and the snapshot form the usable control plane. Doctor is an
 * independent probe: its failure is surfaced as degraded health without
 * hiding otherwise editable settings.
 */
export async function refreshSettingsProjection(
  client: SettingsOperationClient,
  now = new Date(),
): Promise<SettingsControlPlaneProjection> {
  const [definitionsResult, snapshotResult, doctorResult] = await Promise.allSettled([
    client.definitions(),
    client.snapshot(),
    client.doctor(),
  ]);
  if (definitionsResult.status === "rejected") throw definitionsResult.reason;
  if (snapshotResult.status === "rejected") throw snapshotResult.reason;
  const doctorError = doctorResult.status === "rejected"
    ? String((doctorResult.reason as Error)?.message ?? doctorResult.reason)
    : undefined;
  const health: CapabilityHealth[] = doctorResult.status === "fulfilled"
    ? doctorResult.value.capabilities
    : [{
        capabilityId: "settings.doctor",
        state: "degraded",
        summary: `Settings are available, but Doctor could not complete: ${doctorError}`,
        evidence: [{
          code: "doctor-unavailable",
          summary: doctorError ?? "Doctor unavailable",
          status: "warn",
          observedAt: now.toISOString(),
        }],
        remediations: [{ code: "retry-doctor", summary: "Retry the health check." }],
        checkedAt: now.toISOString(),
        snapshotId: snapshotResult.value.snapshot.snapshotId,
      }];
  return {
    definitions: definitionsResult.value,
    snapshot: snapshotResult.value.snapshot,
    validation: snapshotResult.value.validation,
    recoveryDiagnostics: snapshotResult.value.recoveryDiagnostics,
    health,
    doctorError,
    refreshedAt: now.toISOString(),
  };
}

export function isSecretReference(value: unknown): value is SecretReference {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && "provider" in value
    && "locator" in value
    && typeof (value as SecretReference).provider === "string"
    && typeof (value as SecretReference).locator === "string",
  );
}

export function redactedSecretLabel(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "not configured";
  if ("secretRef" in value && isSecretReference((value as { secretRef?: unknown }).secretRef)) {
    const redacted = value as { secretRef: SecretReference; status?: string };
    return `${redacted.secretRef.provider}:•••• (${redacted.status ?? "unknown"})`;
  }
  if (isSecretReference(value)) return `${value.provider}:••••`;
  return "configured (redacted)";
}

export class UnavailableSettingsTransport implements SettingsOperationTransport {
  constructor(private readonly reason: string) {}

  async invoke<T>(_operation: string, _args: Record<string, unknown>): Promise<T> {
    throw new Error(this.reason);
  }
}
