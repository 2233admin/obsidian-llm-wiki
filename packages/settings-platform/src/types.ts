export const SETTINGS_DOCUMENT_SCHEMA_VERSION = 1 as const;
export const SETTINGS_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export type SettingsScope = "product" | "user-device" | "vault" | "workspace-project" | "session";
export type MutableSettingsScope = Exclude<SettingsScope, "product">;
export type SecretProvider = "os-keychain" | "environment" | "external-vault";
export type SecretStatus = "present" | "missing" | "unreachable";
export type HealthState = "available" | "degraded" | "unavailable" | "disabled";
export type SettingValueType =
  | "boolean"
  | "integer"
  | "number"
  | "string"
  | "enum"
  | "path"
  | "duration"
  | "list"
  | "object"
  | "secret-reference";
export type SettingSensitivity = "public" | "local" | "secret-reference";
export type ApplyMode = "hot" | "next-operation" | "restart-required";
export type SettingVisibility = "normal" | "advanced" | "internal";
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type SettingValue = Exclude<JsonValue, null>;

export interface SecretReference {
  provider: SecretProvider;
  locator: string;
  version?: string;
}

export interface SettingValidator {
  id: string;
  required?: boolean;
  enum?: string[];
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

export interface SettingDefinition {
  key: string;
  owner: string;
  category: string;
  name: string;
  description: string;
  valueType: SettingValueType;
  defaultValue?: SettingValue;
  defaultSecretRef?: SecretReference;
  allowedScopes: MutableSettingsScope[];
  sensitivity: SettingSensitivity;
  validator: SettingValidator;
  requires: string[];
  applyMode: ApplyMode;
  visibility: SettingVisibility;
  placeholder?: string;
  deprecatedBy?: string;
}

export interface SettingsMigration {
  id: string;
  fromSchemaVersion: number;
  toSchemaVersion: number;
  description: string;
}

export interface SettingsRegistry {
  schemaVersion: number;
  registryVersion: string;
  registryDigest: string;
  definitions: SettingDefinition[];
  migrations: SettingsMigration[];
}

export interface AssignmentProvenance {
  actor: string;
  source: string;
  reason?: string;
}

export interface SettingAssignment {
  key: string;
  value?: SettingValue;
  secretRef?: SecretReference;
  provenance: AssignmentProvenance;
  expiresAt?: string;
}

export interface PreviousRevision {
  revision: number;
  digest: string;
  backupPath?: string;
}

export interface SettingsDocument {
  schemaVersion: typeof SETTINGS_DOCUMENT_SCHEMA_VERSION;
  scope: MutableSettingsScope;
  targetId: string;
  revision: number;
  assignments: SettingAssignment[];
  updatedAt: string;
  updatedBy: string;
  previousRevision?: PreviousRevision;
}

export interface RuntimeContext {
  userDeviceId: string;
  vaultId?: string;
  workspaceProjectId?: string;
  sessionId?: string;
}

export interface ValidationIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
  key?: string;
  scope?: SettingsScope;
  targetId?: string;
  remediation?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface RedactedSecretReference {
  secretRef: SecretReference;
  status: SecretStatus;
}

export type RedactedSettingValue = SettingValue | RedactedSecretReference | null;

export interface SettingCandidate {
  scope: SettingsScope;
  revision: number | string;
  value: RedactedSettingValue;
  provenance: AssignmentProvenance;
}

export interface EffectiveSetting {
  key: string;
  value: RedactedSettingValue;
  winningScope: SettingsScope;
  assignmentProvenance: AssignmentProvenance;
  validation: ValidationResult;
  applyMode: ApplyMode;
  overriddenCandidates: SettingCandidate[];
}

export interface SourceRevision {
  targetId: string;
  revision: number | string;
}

export interface SettingsSnapshot {
  snapshotId: string;
  registryVersion: string;
  context: RuntimeContext;
  effective: EffectiveSetting[];
  sourceRevisions: Partial<Record<SettingsScope, SourceRevision>>;
  createdAt: string;
}

export type ExplainCandidateState = "selected" | "overridden" | "unset" | "not-allowed" | "out-of-context";

export interface ExplainCandidate {
  scope: SettingsScope;
  state: ExplainCandidateState;
  revision?: number | string;
  value?: RedactedSettingValue;
  provenance?: AssignmentProvenance;
}

export interface SettingExplanation {
  key: string;
  winningScope: SettingsScope;
  value: RedactedSettingValue;
  candidates: ExplainCandidate[];
  validation: ValidationResult;
}

export interface ConformanceFixture {
  createdAt: string;
  context: RuntimeContext;
  documents: SettingsDocument[];
  secretStatus?: Record<string, SecretStatus>;
}

export interface RevisionConflict {
  scope: MutableSettingsScope;
  targetId: string;
  expectedRevision: number;
  actualRevision: number;
  changedKeys: string[];
}

export interface CommittedMutation {
  status: "committed";
  document: SettingsDocument;
  event: SettingsAssignmentsChangedEvent;
}

export interface ConflictMutation {
  status: "conflict";
  document: SettingsDocument;
  conflict: RevisionConflict;
}

export interface ValidationErrorMutation {
  status: "validation-error";
  document: SettingsDocument;
  validation: ValidationResult;
}

export type SettingsMutationResult = CommittedMutation | ConflictMutation | ValidationErrorMutation;

export interface SettingsAssignmentsChangedEvent {
  type: "SettingsAssignmentsChanged";
  scope: MutableSettingsScope;
  targetId: string;
  previousRevision: number;
  revision: number;
  keys: string[];
  actor: string;
  occurredAt: string;
}

export type SettingsEvent =
  | SettingsAssignmentsChangedEvent
  | {
      type: "SettingsRegistryChanged";
      registryVersion: string;
      registryDigest: string;
      occurredAt: string;
    }
  | {
      type: "SettingsSnapshotInvalidated";
      snapshotId: string;
      keys: string[];
      occurredAt: string;
    }
  | {
      type: "CapabilityHealthChanged";
      capabilityId: string;
      previousState: HealthState;
      state: HealthState;
      occurredAt: string;
    };

export interface HealthEvidence {
  code: string;
  summary: string;
  status: "pass" | "warn" | "fail";
  observedAt: string;
}

export interface Remediation {
  code: string;
  summary: string;
  operation?: string;
}

export interface CapabilityHealth {
  capabilityId: string;
  state: HealthState;
  summary: string;
  evidence: HealthEvidence[];
  remediations: Remediation[];
  checkedAt: string;
  snapshotId: string;
}
