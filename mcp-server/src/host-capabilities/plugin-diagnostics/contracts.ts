import { createHash } from "node:crypto";

export const PLUGIN_DIAGNOSTIC_SCHEMA_VERSION = "1.0.0" as const;

export type PluginDiagnosticSchemaVersion =
  typeof PLUGIN_DIAGNOSTIC_SCHEMA_VERSION;

export type PluginDiagnosticHealth =
  | "available"
  | "degraded"
  | "unavailable"
  | "disabled";

export type PluginDiagnosticStatusCode =
  | "absent"
  | "disabled"
  | "incompatible"
  | "capability-missing"
  | "runtime-failed"
  | "privacy-blocked";

export type PluginFindingSeverity = "info" | "warning" | "error";

export interface PluginDiagnosticEvidenceReference {
  kind:
    | "vault-path"
    | "project-entity"
    | "connector-diagnostic"
    | "source-url";
  ref: string;
  digest?: `sha256:${string}`;
}

export interface PluginDiagnosticRemediation {
  code: string;
  summary: string;
  operation?: string;
}

export interface PluginDiagnosticProvenance {
  connectorId: string;
  connectorVersion: string;
  descriptorId: string;
  descriptorVersion: string;
  operation: string;
  traceId: string;
  workRunId?: string;
  assignmentPlanId?: string;
  capabilityGrantId?: string;
}

export interface PluginDiagnosticFinding {
  schemaVersion: PluginDiagnosticSchemaVersion;
  findingId: string;
  providerId: string;
  providerVersion: string;
  pluginId: string;
  pluginVersion?: string;
  ruleId: string;
  subject: {
    kind: "vault-path" | "project-entity" | "plugin-capability";
    ref: string;
  };
  severity: PluginFindingSeverity;
  summary: string;
  evidenceRefs: PluginDiagnosticEvidenceReference[];
  health: PluginDiagnosticHealth;
  requiredPermissions: string[];
  observedAt: string;
  provenance: PluginDiagnosticProvenance;
  retry: {
    retryable: boolean;
    retryAfter?: string;
  };
  remediations: PluginDiagnosticRemediation[];
}

export interface PluginAdapterDiagnostic {
  schemaVersion: PluginDiagnosticSchemaVersion;
  code: PluginDiagnosticStatusCode;
  providerId: string;
  pluginId: string;
  health: Exclude<PluginDiagnosticHealth, "available">;
  summary: string;
  observedAt: string;
  traceId: string;
  retryable: boolean;
  remediations: PluginDiagnosticRemediation[];
}

export interface PluginDiagnosticReport {
  schemaVersion: PluginDiagnosticSchemaVersion;
  projectId: string;
  provider: {
    id: string;
    version: string;
    pluginId: string;
    pluginVersion?: string;
  };
  scan: {
    traceId: string;
    operation: string;
    observedAt: string;
    health: PluginDiagnosticHealth;
  };
  findings: PluginDiagnosticFinding[];
  diagnostics: PluginAdapterDiagnostic[];
}

export interface ProblemIntakeDiagnosticCandidate {
  schemaVersion: 1;
  projectId: string;
  provider: {
    id: string;
    version: string;
    pluginId: string;
    pluginVersion?: string;
  };
  ruleId: string;
  subject: PluginDiagnosticFinding["subject"];
  severity: PluginFindingSeverity;
  summary: string;
  evidenceRefs: PluginDiagnosticEvidenceReference[];
  observedAt: string;
  provenance: PluginDiagnosticProvenance;
  sourceFingerprint: `sha256:${string}`;
}

export class PluginDiagnosticContractError extends Error {
  readonly code = "invalid_plugin_diagnostic_contract";

  constructor(message: string) {
    super(message);
    this.name = "PluginDiagnosticContractError";
  }
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,159}$/;
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;
const TRACE_PATTERN = /^trace\/[a-z0-9][a-z0-9._-]{0,127}$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const PROJECT_PATTERN =
  /^project\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const WORK_RUN_PATTERN = /^work-run\/[a-z0-9][a-z0-9._-]{0,127}$/;
const SENSITIVE_KEY_PATTERN =
  /(?:authorization|cookie|token|secret|password|passphrase|api[-_]?key|private[-_]?key|client[-_]?secret|headers?|personal[-_]?data)/i;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
const POSIX_HOME_PATH_PATTERN = /^\/(?:Users|home|root)\//;

function fail(path: string, message: string): never {
  throw new PluginDiagnosticContractError(`${path}: ${message}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "must be an object");
  }
  return value as Record<string, unknown>;
}

function closed(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) fail(`${path}.${key}`, "is not supported");
  }
}

function string(
  value: unknown,
  path: string,
  maxLength = 512,
): string {
  if (typeof value !== "string" || !value.trim()) {
    fail(path, "must be a non-empty string");
  }
  const result = value.trim();
  if (result.length > maxLength) fail(path, `must be at most ${maxLength} chars`);
  if (
    /\bBearer\s+\S+/i.test(result) ||
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(result) ||
    POSIX_HOME_PATH_PATTERN.test(result)
  ) {
    fail(path, "must not contain credentials or machine-local paths");
  }
  return result;
}

function identifier(value: unknown, path: string): string {
  const parsed = string(value, path, 160);
  if (!ID_PATTERN.test(parsed)) fail(path, "must be a stable lowercase identifier");
  return parsed;
}

function version(value: unknown, path: string): string {
  const parsed = string(value, path, 64);
  if (!VERSION_PATTERN.test(parsed)) fail(path, "must be a stable version");
  return parsed;
}

function timestamp(value: unknown, path: string): string {
  const parsed = string(value, path, 64);
  if (!Number.isFinite(Date.parse(parsed))) fail(path, "must be an ISO timestamp");
  return parsed;
}

function safeValue(value: unknown, path: string): void {
  if (typeof value === "string") {
    string(value, path, 2_000);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) fail(path, "must be bounded to 100 entries");
    value.forEach((item, index) => safeValue(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        fail(`${path}.${key}`, "sensitive or undeclared personal data is forbidden");
      }
      safeValue(item, `${path}.${key}`);
    }
  }
}

function stringList(
  value: unknown,
  path: string,
  maxEntries = 32,
): string[] {
  if (!Array.isArray(value)) fail(path, "must be an array");
  if (value.length > maxEntries) fail(path, `must have at most ${maxEntries} entries`);
  const result = value.map((item, index) =>
    identifier(item, `${path}[${index}]`),
  );
  if (new Set(result).size !== result.length) fail(path, "must not contain duplicates");
  return result;
}

function validateEvidenceReference(
  value: unknown,
  path: string,
): PluginDiagnosticEvidenceReference {
  const item = record(value, path);
  closed(item, ["kind", "ref", "digest"], path);
  const kind = string(item.kind, `${path}.kind`, 32);
  if (
    !new Set([
      "vault-path",
      "project-entity",
      "connector-diagnostic",
      "source-url",
    ]).has(kind)
  ) {
    fail(`${path}.kind`, "has an unsupported value");
  }
  const ref = string(item.ref, `${path}.ref`, 512);
  if (kind === "source-url") {
    let parsed: URL;
    try {
      parsed = new URL(ref);
    } catch {
      fail(`${path}.ref`, "must be a valid URL");
    }
    if (parsed.protocol !== "https:") fail(`${path}.ref`, "must use https");
    if (parsed.username || parsed.password) fail(`${path}.ref`, "must not contain credentials");
  } else if (ref.startsWith("/") || ref.includes("..")) {
    fail(`${path}.ref`, "must be a bounded logical or vault-relative reference");
  }
  if (item.digest !== undefined) {
    const digest = string(item.digest, `${path}.digest`, 72);
    if (!SHA256_PATTERN.test(digest)) fail(`${path}.digest`, "must be sha256");
  }
  return {
    kind: kind as PluginDiagnosticEvidenceReference["kind"],
    ref,
    ...(item.digest === undefined
      ? {}
      : { digest: item.digest as `sha256:${string}` }),
  };
}

function validateRemediation(
  value: unknown,
  path: string,
): PluginDiagnosticRemediation {
  const item = record(value, path);
  closed(item, ["code", "summary", "operation"], path);
  return {
    code: identifier(item.code, `${path}.code`),
    summary: string(item.summary, `${path}.summary`, 300),
    ...(item.operation === undefined
      ? {}
      : { operation: identifier(item.operation, `${path}.operation`) }),
  };
}

function validateProvenance(
  value: unknown,
  path: string,
): PluginDiagnosticProvenance {
  const item = record(value, path);
  closed(
    item,
    [
      "connectorId",
      "connectorVersion",
      "descriptorId",
      "descriptorVersion",
      "operation",
      "traceId",
      "workRunId",
      "assignmentPlanId",
      "capabilityGrantId",
    ],
    path,
  );
  const traceId = string(item.traceId, `${path}.traceId`, 134);
  if (!TRACE_PATTERN.test(traceId)) fail(`${path}.traceId`, "must use trace/<id>");
  const workRunId =
    item.workRunId === undefined
      ? undefined
      : identifier(item.workRunId, `${path}.workRunId`);
  if (workRunId && !WORK_RUN_PATTERN.test(workRunId)) {
    fail(`${path}.workRunId`, "must be a canonical Work Run ID");
  }
  return {
    connectorId: identifier(item.connectorId, `${path}.connectorId`),
    connectorVersion: version(item.connectorVersion, `${path}.connectorVersion`),
    descriptorId: identifier(item.descriptorId, `${path}.descriptorId`),
    descriptorVersion: version(
      item.descriptorVersion,
      `${path}.descriptorVersion`,
    ),
    operation: identifier(item.operation, `${path}.operation`),
    traceId,
    ...(workRunId ? { workRunId } : {}),
    ...(item.assignmentPlanId === undefined
      ? {}
      : {
          assignmentPlanId: identifier(
            item.assignmentPlanId,
            `${path}.assignmentPlanId`,
          ),
        }),
    ...(item.capabilityGrantId === undefined
      ? {}
      : {
          capabilityGrantId: identifier(
            item.capabilityGrantId,
            `${path}.capabilityGrantId`,
          ),
        }),
  };
}

export function validatePluginDiagnosticFinding(
  value: unknown,
): PluginDiagnosticFinding {
  safeValue(value, "finding");
  const item = record(value, "finding");
  closed(
    item,
    [
      "schemaVersion",
      "findingId",
      "providerId",
      "providerVersion",
      "pluginId",
      "pluginVersion",
      "ruleId",
      "subject",
      "severity",
      "summary",
      "evidenceRefs",
      "health",
      "requiredPermissions",
      "observedAt",
      "provenance",
      "retry",
      "remediations",
    ],
    "finding",
  );
  if (item.schemaVersion !== PLUGIN_DIAGNOSTIC_SCHEMA_VERSION) {
    fail("finding.schemaVersion", `must equal ${PLUGIN_DIAGNOSTIC_SCHEMA_VERSION}`);
  }
  const subject = record(item.subject, "finding.subject");
  closed(subject, ["kind", "ref"], "finding.subject");
  const subjectKind = string(subject.kind, "finding.subject.kind", 32);
  if (
    !new Set(["vault-path", "project-entity", "plugin-capability"]).has(
      subjectKind,
    )
  ) {
    fail("finding.subject.kind", "has an unsupported value");
  }
  const subjectRef = string(subject.ref, "finding.subject.ref", 512);
  if (subjectRef.startsWith("/") || subjectRef.includes("..")) {
    fail("finding.subject.ref", "must be a bounded logical reference");
  }
  const severity = string(item.severity, "finding.severity", 16);
  if (!new Set(["info", "warning", "error"]).has(severity)) {
    fail("finding.severity", "has an unsupported value");
  }
  const health = string(item.health, "finding.health", 16);
  if (
    !new Set(["available", "degraded", "unavailable", "disabled"]).has(health)
  ) {
    fail("finding.health", "has an unsupported value");
  }
  if (!Array.isArray(item.evidenceRefs) || item.evidenceRefs.length > 32) {
    fail("finding.evidenceRefs", "must be an array with at most 32 entries");
  }
  const retry = record(item.retry, "finding.retry");
  closed(retry, ["retryable", "retryAfter"], "finding.retry");
  if (typeof retry.retryable !== "boolean") {
    fail("finding.retry.retryable", "must be boolean");
  }
  if (!Array.isArray(item.remediations) || item.remediations.length > 16) {
    fail("finding.remediations", "must be an array with at most 16 entries");
  }
  return {
    schemaVersion: PLUGIN_DIAGNOSTIC_SCHEMA_VERSION,
    findingId: identifier(item.findingId, "finding.findingId"),
    providerId: identifier(item.providerId, "finding.providerId"),
    providerVersion: version(item.providerVersion, "finding.providerVersion"),
    pluginId: identifier(item.pluginId, "finding.pluginId"),
    ...(item.pluginVersion === undefined
      ? {}
      : { pluginVersion: version(item.pluginVersion, "finding.pluginVersion") }),
    ruleId: identifier(item.ruleId, "finding.ruleId"),
    subject: {
      kind: subjectKind as PluginDiagnosticFinding["subject"]["kind"],
      ref: subjectRef,
    },
    severity: severity as PluginFindingSeverity,
    summary: string(item.summary, "finding.summary", 500),
    evidenceRefs: item.evidenceRefs.map((entry, index) =>
      validateEvidenceReference(entry, `finding.evidenceRefs[${index}]`),
    ),
    health: health as PluginDiagnosticHealth,
    requiredPermissions: stringList(
      item.requiredPermissions,
      "finding.requiredPermissions",
    ),
    observedAt: timestamp(item.observedAt, "finding.observedAt"),
    provenance: validateProvenance(item.provenance, "finding.provenance"),
    retry: {
      retryable: retry.retryable,
      ...(retry.retryAfter === undefined
        ? {}
        : {
            retryAfter: timestamp(
              retry.retryAfter,
              "finding.retry.retryAfter",
            ),
          }),
    },
    remediations: item.remediations.map((entry, index) =>
      validateRemediation(entry, `finding.remediations[${index}]`),
    ),
  };
}

export function validatePluginAdapterDiagnostic(
  value: unknown,
): PluginAdapterDiagnostic {
  safeValue(value, "diagnostic");
  const item = record(value, "diagnostic");
  closed(
    item,
    [
      "schemaVersion",
      "code",
      "providerId",
      "pluginId",
      "health",
      "summary",
      "observedAt",
      "traceId",
      "retryable",
      "remediations",
    ],
    "diagnostic",
  );
  if (item.schemaVersion !== PLUGIN_DIAGNOSTIC_SCHEMA_VERSION) {
    fail("diagnostic.schemaVersion", `must equal ${PLUGIN_DIAGNOSTIC_SCHEMA_VERSION}`);
  }
  const code = string(item.code, "diagnostic.code", 32);
  if (
    !new Set([
      "absent",
      "disabled",
      "incompatible",
      "capability-missing",
      "runtime-failed",
      "privacy-blocked",
    ]).has(code)
  ) {
    fail("diagnostic.code", "has an unsupported value");
  }
  const health = string(item.health, "diagnostic.health", 16);
  if (!new Set(["degraded", "unavailable", "disabled"]).has(health)) {
    fail("diagnostic.health", "must be degraded, unavailable, or disabled");
  }
  const traceId = string(item.traceId, "diagnostic.traceId", 134);
  if (!TRACE_PATTERN.test(traceId)) fail("diagnostic.traceId", "must use trace/<id>");
  if (typeof item.retryable !== "boolean") {
    fail("diagnostic.retryable", "must be boolean");
  }
  if (!Array.isArray(item.remediations) || item.remediations.length > 16) {
    fail("diagnostic.remediations", "must be a bounded array");
  }
  return {
    schemaVersion: PLUGIN_DIAGNOSTIC_SCHEMA_VERSION,
    code: code as PluginDiagnosticStatusCode,
    providerId: identifier(item.providerId, "diagnostic.providerId"),
    pluginId: identifier(item.pluginId, "diagnostic.pluginId"),
    health: health as PluginAdapterDiagnostic["health"],
    summary: string(item.summary, "diagnostic.summary", 500),
    observedAt: timestamp(item.observedAt, "diagnostic.observedAt"),
    traceId,
    retryable: item.retryable,
    remediations: item.remediations.map((entry, index) =>
      validateRemediation(entry, `diagnostic.remediations[${index}]`),
    ),
  };
}

export function validatePluginDiagnosticReport(
  value: unknown,
): PluginDiagnosticReport {
  safeValue(value, "report");
  const item = record(value, "report");
  closed(
    item,
    ["schemaVersion", "projectId", "provider", "scan", "findings", "diagnostics"],
    "report",
  );
  if (item.schemaVersion !== PLUGIN_DIAGNOSTIC_SCHEMA_VERSION) {
    fail("report.schemaVersion", `must equal ${PLUGIN_DIAGNOSTIC_SCHEMA_VERSION}`);
  }
  const projectId = identifier(item.projectId, "report.projectId");
  if (!PROJECT_PATTERN.test(projectId)) {
    fail("report.projectId", "must be a canonical Project ID");
  }
  const provider = record(item.provider, "report.provider");
  closed(provider, ["id", "version", "pluginId", "pluginVersion"], "report.provider");
  const scan = record(item.scan, "report.scan");
  closed(scan, ["traceId", "operation", "observedAt", "health"], "report.scan");
  const traceId = string(scan.traceId, "report.scan.traceId", 134);
  if (!TRACE_PATTERN.test(traceId)) fail("report.scan.traceId", "must use trace/<id>");
  const health = string(scan.health, "report.scan.health", 16);
  if (
    !new Set(["available", "degraded", "unavailable", "disabled"]).has(health)
  ) {
    fail("report.scan.health", "has an unsupported value");
  }
  if (!Array.isArray(item.findings) || item.findings.length > 250) {
    fail("report.findings", "must be an array with at most 250 entries");
  }
  if (!Array.isArray(item.diagnostics) || item.diagnostics.length > 32) {
    fail("report.diagnostics", "must be an array with at most 32 entries");
  }
  const findings = item.findings.map(validatePluginDiagnosticFinding);
  const diagnostics = item.diagnostics.map(validatePluginAdapterDiagnostic);
  const providerIdentity = {
    id: identifier(provider.id, "report.provider.id"),
    version: version(provider.version, "report.provider.version"),
    pluginId: identifier(provider.pluginId, "report.provider.pluginId"),
    ...(provider.pluginVersion === undefined
      ? {}
      : {
          pluginVersion: version(
            provider.pluginVersion,
            "report.provider.pluginVersion",
          ),
      }),
  };
  const operation = identifier(scan.operation, "report.scan.operation");
  for (const finding of findings) {
    if (
      finding.providerId !== providerIdentity.id ||
      finding.providerVersion !== providerIdentity.version ||
      finding.pluginId !== providerIdentity.pluginId ||
      finding.pluginVersion !== providerIdentity.pluginVersion ||
      finding.provenance.traceId !== traceId ||
      finding.provenance.operation !== operation
    ) {
      fail(
        "report.findings",
        "provider, trace, and operation identity must match the report",
      );
    }
  }
  for (const diagnostic of diagnostics) {
    if (
      diagnostic.providerId !== providerIdentity.id ||
      diagnostic.pluginId !== providerIdentity.pluginId ||
      diagnostic.traceId !== traceId
    ) {
      fail("report.diagnostics", "provider and trace identity must match the report");
    }
  }
  return {
    schemaVersion: PLUGIN_DIAGNOSTIC_SCHEMA_VERSION,
    projectId,
    provider: providerIdentity,
    scan: {
      traceId,
      operation,
      observedAt: timestamp(scan.observedAt, "report.scan.observedAt"),
      health: health as PluginDiagnosticHealth,
    },
    findings: findings.sort((left, right) =>
      left.findingId.localeCompare(right.findingId),
    ),
    diagnostics: diagnostics.sort((left, right) =>
      left.code.localeCompare(right.code),
    ),
  };
}

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

export function toProblemIntakeDiagnosticCandidates(
  value: unknown,
): ProblemIntakeDiagnosticCandidate[] {
  const report = validatePluginDiagnosticReport(value);
  return report.findings.map((finding) => ({
    schemaVersion: 1,
    projectId: report.projectId,
    provider: structuredClone(report.provider),
    ruleId: finding.ruleId,
    subject: structuredClone(finding.subject),
    severity: finding.severity,
    summary: finding.summary,
    evidenceRefs: structuredClone(finding.evidenceRefs),
    observedAt: finding.observedAt,
    provenance: structuredClone(finding.provenance),
    sourceFingerprint: sha256({
      provider: report.provider,
      ruleId: finding.ruleId,
      subject: finding.subject,
      evidenceRefs: finding.evidenceRefs,
    }),
  }));
}
