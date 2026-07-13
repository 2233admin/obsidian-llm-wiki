import type {
  SettingScope,
  SettingValue,
  SettingsOperationClient,
  SettingsSnapshot,
} from "./settings-client";

export const PLUGIN_DATA_SCHEMA_VERSION = 2;

export interface PluginPresentation {
  selectedScope: SettingScope;
  showAdvanced: boolean;
}

export interface DeviceBindingReference {
  deviceId: string;
  userDeviceStoreId?: string;
  workspaceProjectId?: string;
}

export interface LegacyMigrationAssignment {
  scope: SettingScope;
  key: string;
  value: SettingValue;
}

export interface LegacyMigrationMarker {
  version: 1;
  state: "pending" | "applied" | "rolled-back";
  assignmentKeys: string[];
  appliedRevisions?: Partial<Record<SettingScope, number>>;
  appliedAt?: string;
  rolledBackAt?: string;
}

/** Obsidian-owned state only. Settings assignments never belong in data.json. */
export interface LLMWikiPluginData {
  schemaVersion: typeof PLUGIN_DATA_SCHEMA_VERSION;
  presentation: PluginPresentation;
  deviceBinding?: DeviceBindingReference;
  legacyMigration?: LegacyMigrationMarker;
}

export interface PluginDataMigrationPlan {
  data: LLMWikiPluginData;
  assignments: LegacyMigrationAssignment[];
  migrated: boolean;
}

const EDITABLE_SCOPES: SettingScope[] = ["user-device", "vault"];
const LEGACY_SCOPES: SettingScope[] = ["user-device", "vault", "workspace-project", "session"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSettingValue(value: unknown): value is SettingValue {
  return typeof value === "string" || typeof value === "boolean" || typeof value === "number";
}

function defaultData(): LLMWikiPluginData {
  return {
    schemaVersion: PLUGIN_DATA_SCHEMA_VERSION,
    presentation: { selectedScope: "user-device", showAdvanced: false },
  };
}

function readPresentation(raw: Record<string, unknown>): PluginPresentation {
  const source = isRecord(raw.presentation) ? raw.presentation : {};
  const selected = source.selectedScope;
  return {
    selectedScope: EDITABLE_SCOPES.includes(selected as SettingScope)
      ? selected as SettingScope
      : "user-device",
    showAdvanced: source.showAdvanced === true,
  };
}

function readDeviceBinding(raw: Record<string, unknown>): DeviceBindingReference | undefined {
  if (!isRecord(raw.deviceBinding) || typeof raw.deviceBinding.deviceId !== "string") return undefined;
  const binding: DeviceBindingReference = { deviceId: raw.deviceBinding.deviceId };
  if (typeof raw.deviceBinding.userDeviceStoreId === "string") {
    binding.userDeviceStoreId = raw.deviceBinding.userDeviceStoreId;
  }
  if (typeof raw.deviceBinding.workspaceProjectId === "string") {
    binding.workspaceProjectId = raw.deviceBinding.workspaceProjectId;
  }
  return binding;
}

function readMarker(raw: Record<string, unknown>): LegacyMigrationMarker | undefined {
  if (!isRecord(raw.legacyMigration) || raw.legacyMigration.version !== 1) return undefined;
  const state = raw.legacyMigration.state;
  if (state !== "pending" && state !== "applied" && state !== "rolled-back") return undefined;
  const appliedRevisions: Partial<Record<SettingScope, number>> = {};
  if (isRecord(raw.legacyMigration.appliedRevisions)) {
    for (const scope of LEGACY_SCOPES) {
      const revision = raw.legacyMigration.appliedRevisions[scope];
      if (typeof revision === "number" && Number.isInteger(revision) && revision >= 0) {
        appliedRevisions[scope] = revision;
      }
    }
  }
  return {
    version: 1,
    state,
    assignmentKeys: Array.isArray(raw.legacyMigration.assignmentKeys)
      ? raw.legacyMigration.assignmentKeys.filter((item): item is string => typeof item === "string")
      : [],
    appliedRevisions: Object.keys(appliedRevisions).length ? appliedRevisions : undefined,
    appliedAt: typeof raw.legacyMigration.appliedAt === "string" ? raw.legacyMigration.appliedAt : undefined,
    rolledBackAt: typeof raw.legacyMigration.rolledBackAt === "string" ? raw.legacyMigration.rolledBackAt : undefined,
  };
}

function collectLegacyAssignments(raw: Record<string, unknown>): LegacyMigrationAssignment[] {
  const byIdentity = new Map<string, LegacyMigrationAssignment>();
  if (isRecord(raw.assignments)) {
    for (const scope of LEGACY_SCOPES) {
      const assignments = raw.assignments[scope];
      if (!isRecord(assignments)) continue;
      for (const [key, value] of Object.entries(assignments)) {
        if (!isSettingValue(value)) continue;
        byIdentity.set(`${scope}:${key}`, { scope, key, value });
      }
    }
  }

  const directBindings: Array<[string, string]> = [
    ["pythonPath", "runtime.python.path"],
    ["kbMetaPath", "runtime.kb_meta.path"],
  ];
  for (const [legacyKey, key] of directBindings) {
    const value = raw[legacyKey];
    if (typeof value === "string" && value.trim()) {
      byIdentity.set(`user-device:${key}`, { scope: "user-device", key, value: value.trim() });
    }
  }
  return [...byIdentity.values()];
}

/**
 * Converts plugin-private settings into a migration plan. Values stay in memory
 * until the Settings Platform accepts them; the returned plugin document never
 * persists operational assignments.
 */
export function planPluginDataMigration(raw: unknown): PluginDataMigrationPlan {
  const defaults = defaultData();
  if (!isRecord(raw)) return { data: defaults, assignments: [], migrated: false };

  if (typeof raw.schemaVersion === "number" && raw.schemaVersion > PLUGIN_DATA_SCHEMA_VERSION) {
    throw new Error(`Unsupported plugin data schema version: ${raw.schemaVersion}`);
  }

  const assignments = collectLegacyAssignments(raw);
  const existingMarker = readMarker(raw);
  const data: LLMWikiPluginData = {
    schemaVersion: PLUGIN_DATA_SCHEMA_VERSION,
    presentation: readPresentation(raw),
    deviceBinding: readDeviceBinding(raw),
    legacyMigration: existingMarker,
  };
  if (assignments.length) {
    data.legacyMigration = {
      version: 1,
      state: "pending",
      assignmentKeys: assignments.map(item => `${item.scope}:${item.key}`).sort(),
    };
  }
  return {
    data,
    assignments,
    migrated: raw.schemaVersion !== PLUGIN_DATA_SCHEMA_VERSION || assignments.length > 0,
  };
}

export function selectEditingScope(data: LLMWikiPluginData, scope: SettingScope): LLMWikiPluginData {
  if (!EDITABLE_SCOPES.includes(scope)) throw new Error(`${scope} is not editable without a bound runtime context`);
  return { ...data, presentation: { ...data.presentation, selectedScope: scope } };
}

export async function applyPluginDataMigration(
  client: SettingsOperationClient,
  plan: PluginDataMigrationPlan,
  now = new Date(),
): Promise<{ data: LLMWikiPluginData; snapshot: SettingsSnapshot }> {
  let snapshot = await client.snapshot();
  for (const assignment of plan.assignments) {
    snapshot = await client.setAssignment(
      assignment.scope,
      assignment.key,
      assignment.value,
      snapshot.sourceRevisions[assignment.scope] ?? 0,
    );
  }
  const appliedRevisions: Partial<Record<SettingScope, number>> = {};
  for (const assignment of plan.assignments) {
    appliedRevisions[assignment.scope] = snapshot.sourceRevisions[assignment.scope] ?? 0;
  }
  return {
    snapshot,
    data: {
      ...plan.data,
      legacyMigration: plan.assignments.length
        ? {
            version: 1,
            state: "applied",
            assignmentKeys: plan.assignments.map(item => `${item.scope}:${item.key}`).sort(),
            appliedRevisions,
            appliedAt: now.toISOString(),
          }
        : plan.data.legacyMigration,
    },
  };
}

export async function rollbackPluginDataMigration(
  client: SettingsOperationClient,
  data: LLMWikiPluginData,
  now = new Date(),
): Promise<{ data: LLMWikiPluginData; snapshot: SettingsSnapshot }> {
  const marker = data.legacyMigration;
  if (!marker || marker.state !== "applied") throw new Error("No applied legacy migration to roll back");
  let snapshot = await client.snapshot();
  for (const [scope, revision] of Object.entries(marker.appliedRevisions ?? {})) {
    const current = snapshot.sourceRevisions[scope as SettingScope] ?? 0;
    if (current !== revision) {
      throw new Error(`Cannot roll back legacy migration: ${scope} changed at revision ${current}`);
    }
  }
  for (const identity of marker.assignmentKeys) {
    const separator = identity.indexOf(":");
    const scope = identity.slice(0, separator) as SettingScope;
    const key = identity.slice(separator + 1);
    snapshot = await client.unsetAssignment(scope, key, snapshot.sourceRevisions[scope] ?? 0);
  }
  return {
    snapshot,
    data: {
      ...data,
      legacyMigration: { ...marker, state: "rolled-back", rolledBackAt: now.toISOString() },
    },
  };
}
