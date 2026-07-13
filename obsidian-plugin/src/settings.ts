import type {
  SecretReference,
  SettingAssignment,
  SettingValue,
  SettingsSnapshot,
} from "../../packages/settings-platform/src/types";
import {
  isSecretReference,
  sourceRevision,
  type SettingScope,
  type SettingsOperationClient,
} from "./settings-client";

export const PLUGIN_DATA_SCHEMA_VERSION = 2;

export interface PluginPresentation {
  selectedScope: SettingScope;
  showAdvanced: boolean;
}

export interface DeviceBindingReference {
  deviceId: string;
  workspaceProjectId?: string;
}

export interface LegacyMigrationAssignment {
  scope: SettingScope;
  key: string;
  value: SettingValue | SecretReference;
}

export interface LegacyMigrationPreimage {
  scope: SettingScope;
  key: string;
  assignment?: SettingAssignment;
}

export interface LegacyMigrationMarker {
  version: 1;
  state: "pending" | "applied" | "rolled-back";
  assignmentKeys: string[];
  initialRevisions?: Partial<Record<SettingScope, number>>;
  appliedRevisions?: Partial<Record<SettingScope, number>>;
  preimage?: LegacyMigrationPreimage[];
  appliedAt?: string;
  rolledBackAt?: string;
}

/** Obsidian-owned state only: presentation, device binding, and migration journal. */
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
  if (value === null || value === undefined) return false;
  if (["string", "boolean", "number"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isSettingValue);
  return isRecord(value) && Object.values(value).every(item => item === null || isSettingValue(item));
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
    selectedScope: EDITABLE_SCOPES.includes(selected as SettingScope) ? selected as SettingScope : "user-device",
    showAdvanced: source.showAdvanced === true,
  };
}

function readDeviceBinding(raw: Record<string, unknown>): DeviceBindingReference | undefined {
  if (!isRecord(raw.deviceBinding) || typeof raw.deviceBinding.deviceId !== "string") return undefined;
  const binding: DeviceBindingReference = { deviceId: raw.deviceBinding.deviceId };
  if (typeof raw.deviceBinding.workspaceProjectId === "string") {
    binding.workspaceProjectId = raw.deviceBinding.workspaceProjectId;
  }
  return binding;
}

function readRevisions(value: unknown): Partial<Record<SettingScope, number>> | undefined {
  if (!isRecord(value)) return undefined;
  const revisions: Partial<Record<SettingScope, number>> = {};
  for (const scope of LEGACY_SCOPES) {
    const revision = value[scope];
    if (typeof revision === "number" && Number.isInteger(revision) && revision >= 0) revisions[scope] = revision;
  }
  return Object.keys(revisions).length ? revisions : undefined;
}

function readPreimage(value: unknown): LegacyMigrationPreimage[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: LegacyMigrationPreimage[] = [];
  for (const item of value) {
    if (!isRecord(item) || !LEGACY_SCOPES.includes(item.scope as SettingScope) || typeof item.key !== "string") continue;
    const entry: LegacyMigrationPreimage = { scope: item.scope as SettingScope, key: item.key };
    if (isRecord(item.assignment) && item.assignment.key === item.key) {
      entry.assignment = item.assignment as unknown as SettingAssignment;
    }
    result.push(entry);
  }
  return result.length ? result : undefined;
}

function readMarker(raw: Record<string, unknown>): LegacyMigrationMarker | undefined {
  if (!isRecord(raw.legacyMigration) || raw.legacyMigration.version !== 1) return undefined;
  const state = raw.legacyMigration.state;
  if (state !== "pending" && state !== "applied" && state !== "rolled-back") return undefined;
  return {
    version: 1,
    state,
    assignmentKeys: Array.isArray(raw.legacyMigration.assignmentKeys)
      ? raw.legacyMigration.assignmentKeys.filter((item): item is string => typeof item === "string")
      : [],
    initialRevisions: readRevisions(raw.legacyMigration.initialRevisions),
    appliedRevisions: readRevisions(raw.legacyMigration.appliedRevisions),
    preimage: readPreimage(raw.legacyMigration.preimage),
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
  return { data, assignments, migrated: raw.schemaVersion !== PLUGIN_DATA_SCHEMA_VERSION || assignments.length > 0 };
}

export function selectEditingScope(data: LLMWikiPluginData, scope: SettingScope): LLMWikiPluginData {
  if (!EDITABLE_SCOPES.includes(scope)) throw new Error(`${scope} is not editable without a bound runtime context`);
  return { ...data, presentation: { ...data.presentation, selectedScope: scope } };
}

async function restorePreimage(
  client: SettingsOperationClient,
  preimage: LegacyMigrationPreimage[],
  snapshot: SettingsSnapshot,
): Promise<SettingsSnapshot> {
  let current = snapshot;
  for (const entry of [...preimage].reverse()) {
    const revision = sourceRevision(current, entry.scope);
    if (!entry.assignment) {
      current = (await client.unsetAssignment(entry.scope, entry.key, revision)).snapshot;
      continue;
    }
    const value = entry.assignment.secretRef ?? entry.assignment.value;
    if (value === undefined) throw new Error(`Migration preimage for ${entry.scope}:${entry.key} has no value`);
    current = (await client.setAssignment(entry.scope, entry.key, value, revision, {
      reason: "Restore exact legacy migration preimage",
      expiresAt: entry.assignment.expiresAt,
    })).snapshot;
  }
  return current;
}

/** Apply the legacy batch as one logical transaction with compensating restore. */
export async function applyPluginDataMigration(
  client: SettingsOperationClient,
  plan: PluginDataMigrationPlan,
  now = new Date(),
): Promise<{ data: LLMWikiPluginData; snapshot: SettingsSnapshot }> {
  const scopes = [...new Set(plan.assignments.map(item => item.scope))];
  const reads = await Promise.all(scopes.map(async scope => [scope, await client.scope(scope)] as const));
  const documents = new Map(reads);
  const initialRevisions: Partial<Record<SettingScope, number>> = {};
  for (const [scope, read] of reads) initialRevisions[scope] = read.document.revision;
  const preimage: LegacyMigrationPreimage[] = plan.assignments.map(assignment => ({
    scope: assignment.scope,
    key: assignment.key,
    assignment: documents.get(assignment.scope)?.document.assignments.find(item => item.key === assignment.key),
  }));

  let current = (await client.snapshot()).snapshot;
  const applied: LegacyMigrationPreimage[] = [];
  try {
    for (let index = 0; index < plan.assignments.length; index += 1) {
      const assignment = plan.assignments[index];
      current = (await client.setAssignment(
        assignment.scope,
        assignment.key,
        assignment.value,
        sourceRevision(current, assignment.scope),
        { reason: "Migrate legacy Obsidian plugin settings" },
      )).snapshot;
      applied.push(preimage[index]);
    }
  } catch (error) {
    try {
      await restorePreimage(client, applied, current);
    } catch (restoreError) {
      throw new Error(`Legacy migration failed (${(error as Error).message}) and compensation also failed: ${(restoreError as Error).message}`);
    }
    throw error;
  }

  const appliedRevisions: Partial<Record<SettingScope, number>> = {};
  for (const scope of scopes) appliedRevisions[scope] = sourceRevision(current, scope);
  return {
    snapshot: current,
    data: {
      ...plan.data,
      legacyMigration: plan.assignments.length ? {
        version: 1,
        state: "applied",
        assignmentKeys: plan.assignments.map(item => `${item.scope}:${item.key}`).sort(),
        initialRevisions,
        appliedRevisions,
        preimage,
        appliedAt: now.toISOString(),
      } : plan.data.legacyMigration,
    },
  };
}

export async function rollbackPluginDataMigration(
  client: SettingsOperationClient,
  data: LLMWikiPluginData,
  now = new Date(),
): Promise<{ data: LLMWikiPluginData; snapshot: SettingsSnapshot }> {
  const marker = data.legacyMigration;
  if (!marker || marker.state !== "applied" || !marker.preimage) {
    throw new Error("No applied legacy migration with a restorable preimage");
  }
  let snapshot = (await client.snapshot()).snapshot;
  for (const [scope, revision] of Object.entries(marker.appliedRevisions ?? {})) {
    const current = sourceRevision(snapshot, scope as SettingScope);
    if (current !== revision) throw new Error(`Cannot roll back legacy migration: ${scope} changed at revision ${current}`);
  }
  snapshot = await restorePreimage(client, marker.preimage, snapshot);
  return {
    snapshot,
    data: {
      ...data,
      legacyMigration: { ...marker, state: "rolled-back", rolledBackAt: now.toISOString() },
    },
  };
}

export function parseSettingInput(valueType: string, raw: string): SettingValue {
  const value = raw.trim();
  if (valueType === "integer") {
    if (!/^-?\d+$/.test(value)) throw new Error("Enter a whole number.");
    return Number.parseInt(value, 10);
  }
  if (valueType === "number" || valueType === "duration") {
    const parsed = Number(value);
    if (!value || !Number.isFinite(parsed)) throw new Error("Enter a valid number.");
    return parsed;
  }
  return raw;
}
