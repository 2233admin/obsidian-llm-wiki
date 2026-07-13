export type SettingScope = "user-device" | "vault" | "workspace-project" | "session";
export type SettingValue = string | boolean | number;
export type HealthState = "available" | "degraded" | "unavailable" | "disabled";

export interface SettingDefinition {
  key: string;
  category: "runtime" | "vault" | "query" | "diagnostics" | "providers" | string;
  name: string;
  description: string;
  valueType: "string" | "boolean" | "number" | "secret-reference";
  allowedScopes: SettingScope[];
  applyMode: "hot" | "next-operation" | "restart-required";
  required?: boolean;
  advanced?: boolean;
  placeholder?: string;
}

export interface EffectiveSetting {
  key: string;
  value: SettingValue;
  winningScope: SettingScope | "product-default";
  overriddenScopes?: SettingScope[];
  candidates?: Array<{ scope: SettingScope | "product-default"; value: SettingValue; redacted?: boolean }>;
  redacted?: boolean;
}

export interface SettingValidationIssue {
  key: string;
  severity: "error" | "warning";
  message: string;
}

export interface SettingsSnapshot {
  snapshotRevision?: string;
  sourceRevisions: Partial<Record<SettingScope, number>>;
  effective: Record<string, EffectiveSetting>;
  validation: SettingValidationIssue[];
}

export interface HealthCheck {
  capability: string;
  state: HealthState;
  summary: string;
  remediation?: string;
}

export interface SettingsMutationConflict {
  status: "conflict";
  scope: SettingScope;
  expectedRevision: number;
  actualRevision: number;
  message: string;
}

export interface SettingsOperationTransport {
  invoke<T>(operation: string, args: Record<string, unknown>): Promise<T>;
}

export class SettingsConflictError extends Error {
  constructor(readonly conflict: SettingsMutationConflict) {
    super(conflict.message);
    this.name = "SettingsConflictError";
  }
}

function isConflict(value: unknown): value is SettingsMutationConflict {
  return typeof value === "object" && value !== null && (value as { status?: unknown }).status === "conflict";
}

/** Thin host adapter over the shared Settings Platform Operation Interface. */
export class SettingsOperationClient {
  constructor(private readonly transport: SettingsOperationTransport) {}

  definitions(): Promise<SettingDefinition[]> {
    return this.transport.invoke("settings.definitions.list", {});
  }

  snapshot(): Promise<SettingsSnapshot> {
    return this.transport.invoke("settings.snapshot.resolve", {});
  }

  validate(): Promise<SettingValidationIssue[]> {
    return this.transport.invoke("settings.validate", {});
  }

  doctor(): Promise<HealthCheck[]> {
    return this.transport.invoke("settings.doctor", {});
  }

  async setAssignment(
    scope: SettingScope,
    key: string,
    value: SettingValue,
    expectedRevision: number,
  ): Promise<SettingsSnapshot> {
    const result = await this.transport.invoke<SettingsSnapshot | SettingsMutationConflict>(
      "settings.assignment.set",
      { scope, key, value, expectedRevision },
    );
    if (isConflict(result)) throw new SettingsConflictError(result);
    return result;
  }

  async unsetAssignment(scope: SettingScope, key: string, expectedRevision: number): Promise<SettingsSnapshot> {
    const result = await this.transport.invoke<SettingsSnapshot | SettingsMutationConflict>(
      "settings.assignment.unset",
      { scope, key, expectedRevision },
    );
    if (isConflict(result)) throw new SettingsConflictError(result);
    return result;
  }
}

export interface SettingsControlPlaneProjection {
  definitions: SettingDefinition[];
  snapshot: SettingsSnapshot;
  health: HealthCheck[];
  refreshedAt: string;
}

export interface SettingPresentationRow {
  definition: SettingDefinition;
  effective: EffectiveSetting;
  assignedValue?: SettingValue;
  validation: SettingValidationIssue[];
  applyMode: SettingDefinition["applyMode"];
}

export function projectSettingForScope(
  definition: SettingDefinition,
  snapshot: SettingsSnapshot,
  scope: SettingScope,
): SettingPresentationRow | null {
  const effective = snapshot.effective[definition.key];
  if (!effective) return null;
  const candidate = effective.candidates?.find(item => item.scope === scope);
  return {
    definition,
    effective,
    assignedValue: candidate?.value ?? (effective.winningScope === scope ? effective.value : undefined),
    validation: snapshot.validation.filter(issue => issue.key === definition.key),
    applyMode: definition.applyMode,
  };
}

export async function refreshSettingsProjection(
  client: SettingsOperationClient,
  now = new Date(),
): Promise<SettingsControlPlaneProjection> {
  const [definitions, snapshot, health] = await Promise.all([
    client.definitions(),
    client.snapshot(),
    client.doctor(),
  ]);
  return { definitions, snapshot, health, refreshedAt: now.toISOString() };
}

export class UnavailableSettingsTransport implements SettingsOperationTransport {
  constructor(private readonly reason: string) {}

  async invoke<T>(_operation: string, _args: Record<string, unknown>): Promise<T> {
    throw new Error(this.reason);
  }
}
