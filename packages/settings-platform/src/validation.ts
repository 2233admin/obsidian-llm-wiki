import { deepClone } from "./canonical.js";
import { definitionMap } from "./registry.js";
import type {
  MutableSettingsScope,
  RuntimeContext,
  SecretReference,
  SettingAssignment,
  SettingDefinition,
  SettingsDocument,
  SettingsRegistry,
  ValidationIssue,
  ValidationResult,
} from "./types.js";

const SECRET_PROVIDERS = new Set(["os-keychain", "environment", "external-vault"]);
const PROJECT_ID_RE = /^project\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const ENVIRONMENT_LOCATOR_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const OPAQUE_SECRET_LOCATOR_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,63})+$/;
const SECRET_MATERIAL_RE = /^(?:bearer\s+|sk[-_][A-Za-z0-9_-]{8,}|api[_-]?key\s*[:=])/i;

function issue(
  code: string,
  message: string,
  options: Partial<ValidationIssue> = {},
): ValidationIssue {
  return { code, severity: "error", message, ...options };
}

export function validateSettingsDocuments(
  registry: SettingsRegistry,
  documents: SettingsDocument[],
  context?: RuntimeContext,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const definitions = definitionMap(registry);
  const identities = new Set<string>();

  if (context?.workspaceProjectId && !isCanonicalProjectId(context.workspaceProjectId)) {
    issues.push(issue(
      "invalid-workspace-project-id",
      "workspaceProjectId must use the canonical project/<lowercase-kebab-slug> form.",
      { targetId: context.workspaceProjectId },
    ));
  }

  for (const candidate of documents as unknown[]) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      issues.push(issue("invalid-settings-document", "Settings document must be a JSON object."));
      continue;
    }
    const document = candidate as SettingsDocument;
    const identity = `${document.scope}:${document.targetId}`;
    if (identities.has(identity)) {
      issues.push(issue("duplicate-scope-document", `Duplicate settings document for ${identity}.`, {
        scope: document.scope,
        targetId: document.targetId,
      }));
      continue;
    }
    identities.add(identity);
    issues.push(...validateDocumentShape(document));
    if (context && isMutableSettingsScope(document.scope) && !scopeMatchesContext(document.scope, document.targetId, context)) {
      issues.push({
        code: "scope-out-of-context",
        severity: "warning",
        message: `${identity} is outside the supplied runtime context and will not participate in resolution.`,
        scope: document.scope,
        targetId: document.targetId,
      });
    }
    if (!Array.isArray(document.assignments) || !isMutableSettingsScope(document.scope)) continue;
    const keys = new Set<string>();
    for (const rawAssignment of document.assignments as unknown[]) {
      if (!rawAssignment || typeof rawAssignment !== "object" || Array.isArray(rawAssignment)) {
        issues.push(issue("invalid-assignment", "Setting assignment must be a JSON object.", {
          scope: document.scope,
          targetId: document.targetId,
        }));
        continue;
      }
      const assignment = rawAssignment as SettingAssignment;
      if (typeof assignment.key !== "string" || !assignment.key) {
        issues.push(issue("invalid-assignment", "Setting assignment key is required.", {
          scope: document.scope,
          targetId: document.targetId,
        }));
        continue;
      }
      if (keys.has(assignment.key)) {
        issues.push(issue("duplicate-assignment", `Duplicate assignment for ${assignment.key}.`, {
          key: assignment.key,
          scope: document.scope,
          targetId: document.targetId,
        }));
        continue;
      }
      keys.add(assignment.key);
      const definition = definitions.get(assignment.key);
      if (!definition) {
        issues.push({
          code: "unknown-setting",
          severity: "warning",
          message: `Unknown setting ${assignment.key} is preserved but ignored.`,
          key: assignment.key,
          scope: document.scope,
          targetId: document.targetId,
          remediation: "Remove the orphaned assignment or install a registry version that defines it.",
        });
        continue;
      }
      issues.push(...validateAssignment(definition, document.scope, document.targetId, assignment));
    }
  }

  return { valid: issues.every(item => item.severity !== "error"), issues };
}

export function validateAssignment(
  definition: SettingDefinition,
  scope: MutableSettingsScope,
  targetId: string,
  assignment: SettingAssignment,
): ValidationIssue[] {
  const options = { key: definition.key, scope, targetId };
  const issues: ValidationIssue[] = [];
  if (!definition.allowedScopes.includes(scope)) {
    issues.push(issue("scope-not-allowed", `${definition.key} cannot be assigned at ${scope} scope.`, options));
  }
  if (!assignment.provenance
    || typeof assignment.provenance.actor !== "string"
    || !assignment.provenance.actor.trim()
    || typeof assignment.provenance.source !== "string"
    || !assignment.provenance.source.trim()) {
    issues.push(issue("missing-provenance", `${definition.key} assignment provenance is required.`, options));
  }
  if (assignment.expiresAt !== undefined && scope !== "session") {
    issues.push(issue("expiry-not-allowed", `${definition.key} expiry is only valid at session scope.`, options));
  } else if (assignment.expiresAt !== undefined && !isRfc3339Timestamp(assignment.expiresAt)) {
    issues.push(issue("invalid-expiry", `${definition.key} expiry must be an ISO timestamp.`, options));
  }
  if (definition.valueType === "secret-reference") {
    if (assignment.value !== undefined || !isSecretReference(assignment.secretRef)) {
      issues.push(issue(
        "invalid-secret-reference",
        `${definition.key} must contain a Secret Reference; plaintext secret material is never accepted.`,
        { ...options, remediation: "Store the secret in an approved provider and assign only its opaque reference." },
      ));
    }
    return issues;
  }
  if (assignment.secretRef !== undefined || assignment.value === undefined) {
    issues.push(issue("invalid-value", `${definition.key} must contain a typed value.`, options));
    return issues;
  }
  issues.push(...validateValue(definition, assignment.value, options));
  return issues;
}

export function validateEffectiveValue(
  definition: SettingDefinition,
  value: unknown,
): ValidationResult {
  if (definition.valueType === "secret-reference") {
    const secretRef = (value as { secretRef?: unknown } | undefined)?.secretRef;
    const issues = isSecretReference(secretRef)
      ? []
      : [issue("invalid-secret-reference", `${definition.key} has no valid Secret Reference.`, { key: definition.key })];
    return { valid: issues.length === 0, issues };
  }
  const issues = validateValue(definition, value, { key: definition.key });
  return { valid: issues.length === 0, issues };
}

export function redactedValidation(result: ValidationResult): ValidationResult {
  return deepClone(result);
}

function validateDocumentShape(document: SettingsDocument): ValidationIssue[] {
  const scope = isMutableSettingsScope(document.scope) ? document.scope : undefined;
  const targetId = typeof document.targetId === "string" ? document.targetId : undefined;
  const options = { scope, targetId };
  const issues: ValidationIssue[] = [];
  if (document.schemaVersion !== 1) {
    issues.push(issue("unsupported-schema-version", `Unsupported settings schema version ${document.schemaVersion}.`, options));
  }
  if (!Number.isInteger(document.revision) || document.revision < 0) {
    issues.push(issue("invalid-revision", "Settings revision must be a non-negative integer.", options));
  }
  if (!isMutableSettingsScope(document.scope)) {
    issues.push(issue("invalid-scope", "Settings scope must be user-device, vault, workspace-project, or session.", options));
  }
  if (!document.targetId || typeof document.targetId !== "string") {
    issues.push(issue("invalid-target", "Settings targetId is required.", options));
  } else if (document.scope === "workspace-project" && !isCanonicalProjectId(document.targetId)) {
    issues.push(issue(
      "invalid-workspace-project-id",
      "workspace-project targetId must use the canonical project/<lowercase-kebab-slug> form.",
      options,
    ));
  }
  if (!Array.isArray(document.assignments)) {
    issues.push(issue("invalid-assignments", "Settings assignments must be an array.", options));
  }
  if (!isRfc3339Timestamp(document.updatedAt)) {
    issues.push(issue("invalid-updated-at", "Settings updatedAt must be an ISO timestamp.", options));
  }
  if (typeof document.updatedBy !== "string" || !document.updatedBy) {
    issues.push(issue("invalid-updated-by", "Settings updatedBy is required.", options));
  }
  return issues;
}

function isMutableSettingsScope(value: unknown): value is MutableSettingsScope {
  return value === "user-device" || value === "vault" || value === "workspace-project" || value === "session";
}

function isRfc3339Timestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw, , offsetHourRaw, offsetMinuteRaw] = match;
  const [year, month, day, hour, minute, second] = [yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw].map(Number);
  if (hour > 23 || minute > 59 || second > 59
    || (offsetHourRaw !== undefined && Number(offsetHourRaw) > 23)
    || (offsetMinuteRaw !== undefined && Number(offsetMinuteRaw) > 59)) return false;
  const calendar = new Date(Date.UTC(year!, month! - 1, day!, hour!, minute!, second!));
  return calendar.getUTCFullYear() === year
    && calendar.getUTCMonth() === month! - 1
    && calendar.getUTCDate() === day
    && !Number.isNaN(Date.parse(value));
}

function validateValue(
  definition: SettingDefinition,
  value: unknown,
  options: Partial<ValidationIssue>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const type = definition.valueType;
  const validType =
    (type === "boolean" && typeof value === "boolean")
    || (type === "integer" && Number.isInteger(value))
    || (type === "number" && typeof value === "number" && Number.isFinite(value))
    || (["string", "enum", "path", "duration"].includes(type) && typeof value === "string")
    || (type === "list" && Array.isArray(value))
    || (type === "object" && value !== null && typeof value === "object" && !Array.isArray(value));
  if (!validType) {
    return [issue("type-mismatch", `${definition.key} must be a ${type}.`, options)];
  }
  const validator = definition.validator;
  if (validator.required && typeof value === "string" && !value.trim()) {
    issues.push(issue("required-value-missing", `${definition.key} is required.`, options));
  }
  if (validator.enum && (!validator.enum.includes(value as string))) {
    issues.push(issue("enum-mismatch", `${definition.key} must use an allowed value.`, options));
  }
  if (typeof value === "string") {
    const length = [...value].length;
    if (validator.minLength !== undefined && length < validator.minLength) {
      issues.push(issue("string-too-short", `${definition.key} is shorter than allowed.`, options));
    }
    if (validator.maxLength !== undefined && length > validator.maxLength) {
      issues.push(issue("string-too-long", `${definition.key} is longer than allowed.`, options));
    }
    if (validator.pattern && !new RegExp(validator.pattern).test(value)) {
      issues.push(issue("pattern-mismatch", `${definition.key} does not match its declared format.`, options));
    }
  }
  if (typeof value === "number") {
    if (validator.min !== undefined && value < validator.min) {
      issues.push(issue("number-too-small", `${definition.key} is below its minimum.`, options));
    }
    if (validator.max !== undefined && value > validator.max) {
      issues.push(issue("number-too-large", `${definition.key} exceeds its maximum.`, options));
    }
  }
  return issues;
}

export function isSecretReference(value: unknown): value is SecretReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const ref = value as Partial<SecretReference>;
  return typeof ref.provider === "string"
    && SECRET_PROVIDERS.has(ref.provider)
    && typeof ref.locator === "string"
    && validSecretLocator(ref.provider, ref.locator)
    && (ref.version === undefined || (typeof ref.version === "string" && ref.version.length > 0));
}

export function isCanonicalProjectId(value: unknown): value is string {
  return typeof value === "string" && PROJECT_ID_RE.test(value);
}

function validSecretLocator(provider: string, locator: string): boolean {
  const normalized = locator.trim();
  if (!normalized || normalized !== locator || /[\r\n\0]/.test(normalized) || SECRET_MATERIAL_RE.test(normalized)) return false;
  if (provider === "environment") return ENVIRONMENT_LOCATOR_RE.test(normalized);
  if (provider === "os-keychain" || provider === "external-vault") return OPAQUE_SECRET_LOCATOR_RE.test(normalized);
  return false;
}

export function scopeMatchesContext(
  scope: MutableSettingsScope,
  targetId: string,
  context: RuntimeContext,
): boolean {
  return targetId === targetForScope(scope, context);
}

export function targetForScope(scope: MutableSettingsScope, context: RuntimeContext): string | undefined {
  const contextKey: Record<MutableSettingsScope, keyof RuntimeContext> = {
    "user-device": "userDeviceId",
    vault: "vaultId",
    "workspace-project": "workspaceProjectId",
    session: "sessionId",
  };
  return context[contextKey[scope]];
}
