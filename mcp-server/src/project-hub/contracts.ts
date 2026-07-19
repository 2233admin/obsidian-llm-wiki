import type {
  PluginDiagnosticHealth,
  PluginDiagnosticStatusCode,
} from "../host-capabilities/plugin-diagnostics/contracts.js";

export const PROJECT_HUB_PROJECTION_SCHEMA_VERSION = 1 as const;

export type ObservationLifecycle =
  | "untriaged"
  | "acknowledged"
  | "dismissed"
  | "resolved"
  | "reopened";

export interface VisualDocumentProjectionInput {
  documentId: string;
  path: string;
  revision: number;
  sourceObservedAt: string;
  sourceHash?: `sha256:${string}`;
  currentSourceHash?: `sha256:${string}`;
  projectionStatus: "current" | "stale" | "failed" | "unavailable";
  linkedWorkItems: Array<{
    entity: string;
    state: string;
    reviewedAt?: string;
  }>;
}

export interface ObservationProjectionInput {
  observationId: string;
  lifecycle: ObservationLifecycle;
  providerId: string;
  severity: "info" | "warning" | "error";
  occurrenceCount: number;
  firstObservedAt: string;
  lastObservedAt: string;
  linkedIssue?: {
    entity: string;
    state: string;
  };
  contributions: Array<{
    kind: "issue" | "pull-request";
    provider: string;
    remoteRef: string;
    state: string;
  }>;
  workRuns: Array<{
    workRunId: string;
    state: string;
  }>;
  verifications: Array<{
    verificationId: string;
    status: "passed" | "failed" | "unknown";
    observedAt: string;
    evidenceRefs: string[];
  }>;
}

export interface ProviderHealthProjectionInput {
  providerId: string;
  health: PluginDiagnosticHealth;
  observedAt?: string;
  expiresAt?: string;
  diagnosticCode?: PluginDiagnosticStatusCode;
}

export interface ProjectHubProjectionInput {
  schemaVersion: typeof PROJECT_HUB_PROJECTION_SCHEMA_VERSION;
  projectId: string;
  generatedAt: string;
  visualDocuments: VisualDocumentProjectionInput[];
  observations: ObservationProjectionInput[];
  providerHealth: ProviderHealthProjectionInput[];
}

export class ProjectHubProjectionContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectHubProjectionContractError";
  }
}

const PROJECT_PATTERN =
  /^project\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const WORK_RUN_PATTERN = /^work-run\/[a-z0-9][a-z0-9._-]{0,127}$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,199}$/;
const MACHINE_PATH =
  /^(?:[A-Za-z]:[\\/]|\/(?:Users|home|root)\/)/;
const SENSITIVE_KEY =
  /(?:authorization|cookie|token|secret|password|api[-_]?key|headers?|personal[-_]?data)/i;

function fail(path: string, message: string): never {
  throw new ProjectHubProjectionContractError(`${path}: ${message}`);
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
  for (const key of Object.keys(value)) {
    if (SENSITIVE_KEY.test(key)) fail(`${path}.${key}`, "sensitive fields are forbidden");
    if (!allowed.includes(key)) fail(`${path}.${key}`, "is not supported");
  }
}

function text(value: unknown, path: string, max = 512): string {
  if (typeof value !== "string" || !value.trim()) {
    fail(path, "must be a non-empty string");
  }
  const result = value.trim();
  if (result.length > max) fail(path, `must be at most ${max} chars`);
  if (
    MACHINE_PATH.test(result) ||
    /\bBearer\s+\S+/i.test(result) ||
    /^https?:\/\/[^/\s@:]+:[^/\s@]+@/i.test(result)
  ) {
    fail(path, "must not contain machine-local paths or credentials");
  }
  return result;
}

function id(value: unknown, path: string): string {
  const result = text(value, path, 200);
  if (!ID_PATTERN.test(result)) fail(path, "must be a stable lowercase identifier");
  return result;
}

function timestamp(value: unknown, path: string): string {
  const result = text(value, path, 64);
  if (!Number.isFinite(Date.parse(result))) fail(path, "must be an ISO timestamp");
  return result;
}

function sha(value: unknown, path: string): `sha256:${string}` {
  const result = text(value, path, 72);
  if (!SHA256_PATTERN.test(result)) fail(path, "must be a sha256 digest");
  return result as `sha256:${string}`;
}

function array(value: unknown, path: string, max = 500): unknown[] {
  if (!Array.isArray(value) || value.length > max) {
    fail(path, `must be an array with at most ${max} entries`);
  }
  return value;
}

function visualDocument(
  value: unknown,
  path: string,
): VisualDocumentProjectionInput {
  const item = record(value, path);
  closed(
    item,
    [
      "documentId",
      "path",
      "revision",
      "sourceObservedAt",
      "sourceHash",
      "currentSourceHash",
      "projectionStatus",
      "linkedWorkItems",
    ],
    path,
  );
  const documentPath = text(item.path, `${path}.path`, 512);
  if (
    documentPath.startsWith("/") ||
    documentPath.includes("..") ||
    !documentPath.endsWith(".md")
  ) {
    fail(`${path}.path`, "must be a vault-relative Markdown path");
  }
  if (!Number.isInteger(item.revision) || (item.revision as number) < 1) {
    fail(`${path}.revision`, "must be a positive integer");
  }
  const projectionStatus = text(
    item.projectionStatus,
    `${path}.projectionStatus`,
    16,
  );
  if (!new Set(["current", "stale", "failed", "unavailable"]).has(projectionStatus)) {
    fail(`${path}.projectionStatus`, "has an unsupported value");
  }
  const linkedWorkItems = array(
    item.linkedWorkItems,
    `${path}.linkedWorkItems`,
    100,
  ).map((raw, index) => {
    const work = record(raw, `${path}.linkedWorkItems[${index}]`);
    closed(
      work,
      ["entity", "state", "reviewedAt"],
      `${path}.linkedWorkItems[${index}]`,
    );
    return {
      entity: id(work.entity, `${path}.linkedWorkItems[${index}].entity`),
      state: id(work.state, `${path}.linkedWorkItems[${index}].state`),
      ...(work.reviewedAt === undefined
        ? {}
        : {
            reviewedAt: timestamp(
              work.reviewedAt,
              `${path}.linkedWorkItems[${index}].reviewedAt`,
            ),
          }),
    };
  });
  return {
    documentId: id(item.documentId, `${path}.documentId`),
    path: documentPath,
    revision: item.revision as number,
    sourceObservedAt: timestamp(
      item.sourceObservedAt,
      `${path}.sourceObservedAt`,
    ),
    ...(item.sourceHash === undefined
      ? {}
      : { sourceHash: sha(item.sourceHash, `${path}.sourceHash`) }),
    ...(item.currentSourceHash === undefined
      ? {}
      : {
          currentSourceHash: sha(
            item.currentSourceHash,
            `${path}.currentSourceHash`,
          ),
        }),
    projectionStatus: projectionStatus as VisualDocumentProjectionInput["projectionStatus"],
    linkedWorkItems: linkedWorkItems.sort((left, right) =>
      left.entity.localeCompare(right.entity),
    ),
  };
}

function observation(
  value: unknown,
  path: string,
): ObservationProjectionInput {
  const item = record(value, path);
  closed(
    item,
    [
      "observationId",
      "lifecycle",
      "providerId",
      "severity",
      "occurrenceCount",
      "firstObservedAt",
      "lastObservedAt",
      "linkedIssue",
      "contributions",
      "workRuns",
      "verifications",
    ],
    path,
  );
  const lifecycle = text(item.lifecycle, `${path}.lifecycle`, 16);
  if (
    !new Set([
      "untriaged",
      "acknowledged",
      "dismissed",
      "resolved",
      "reopened",
    ]).has(lifecycle)
  ) {
    fail(`${path}.lifecycle`, "has an unsupported value");
  }
  const severity = text(item.severity, `${path}.severity`, 16);
  if (!new Set(["info", "warning", "error"]).has(severity)) {
    fail(`${path}.severity`, "has an unsupported value");
  }
  if (
    !Number.isInteger(item.occurrenceCount) ||
    (item.occurrenceCount as number) < 1
  ) {
    fail(`${path}.occurrenceCount`, "must be a positive integer");
  }
  let linkedIssue: ObservationProjectionInput["linkedIssue"];
  if (item.linkedIssue !== undefined) {
    const issue = record(item.linkedIssue, `${path}.linkedIssue`);
    closed(issue, ["entity", "state"], `${path}.linkedIssue`);
    linkedIssue = {
      entity: id(issue.entity, `${path}.linkedIssue.entity`),
      state: id(issue.state, `${path}.linkedIssue.state`),
    };
  }
  const contributions = array(
    item.contributions,
    `${path}.contributions`,
    32,
  ).map((raw, index) => {
    const contribution = record(raw, `${path}.contributions[${index}]`);
    closed(
      contribution,
      ["kind", "provider", "remoteRef", "state"],
      `${path}.contributions[${index}]`,
    );
    const kind = text(
      contribution.kind,
      `${path}.contributions[${index}].kind`,
      16,
    );
    if (!new Set(["issue", "pull-request"]).has(kind)) {
      fail(`${path}.contributions[${index}].kind`, "has an unsupported value");
    }
    return {
      kind: kind as "issue" | "pull-request",
      provider: id(
        contribution.provider,
        `${path}.contributions[${index}].provider`,
      ),
      remoteRef: text(
        contribution.remoteRef,
        `${path}.contributions[${index}].remoteRef`,
        512,
      ),
      state: id(
        contribution.state,
        `${path}.contributions[${index}].state`,
      ),
    };
  });
  const workRuns = array(item.workRuns, `${path}.workRuns`, 100).map(
    (raw, index) => {
      const run = record(raw, `${path}.workRuns[${index}]`);
      closed(run, ["workRunId", "state"], `${path}.workRuns[${index}]`);
      const workRunId = id(
        run.workRunId,
        `${path}.workRuns[${index}].workRunId`,
      );
      if (!WORK_RUN_PATTERN.test(workRunId)) {
        fail(`${path}.workRuns[${index}].workRunId`, "must be canonical");
      }
      return {
        workRunId,
        state: id(run.state, `${path}.workRuns[${index}].state`),
      };
    },
  );
  const verifications = array(
    item.verifications,
    `${path}.verifications`,
    100,
  ).map((raw, index) => {
    const verification = record(raw, `${path}.verifications[${index}]`);
    closed(
      verification,
      ["verificationId", "status", "observedAt", "evidenceRefs"],
      `${path}.verifications[${index}]`,
    );
    const status = text(
      verification.status,
      `${path}.verifications[${index}].status`,
      16,
    );
    if (!new Set(["passed", "failed", "unknown"]).has(status)) {
      fail(`${path}.verifications[${index}].status`, "has an unsupported value");
    }
    return {
      verificationId: id(
        verification.verificationId,
        `${path}.verifications[${index}].verificationId`,
      ),
      status: status as "passed" | "failed" | "unknown",
      observedAt: timestamp(
        verification.observedAt,
        `${path}.verifications[${index}].observedAt`,
      ),
      evidenceRefs: array(
        verification.evidenceRefs,
        `${path}.verifications[${index}].evidenceRefs`,
        32,
      )
        .map((reference, referenceIndex) => {
          const value = text(
            reference,
            `${path}.verifications[${index}].evidenceRefs[${referenceIndex}]`,
            512,
          );
          if (value.startsWith("/") || value.includes("..")) {
            fail(
              `${path}.verifications[${index}].evidenceRefs[${referenceIndex}]`,
              "must be a bounded logical reference",
            );
          }
          return value;
        })
        .sort(),
    };
  });
  return {
    observationId: id(item.observationId, `${path}.observationId`),
    lifecycle: lifecycle as ObservationLifecycle,
    providerId: id(item.providerId, `${path}.providerId`),
    severity: severity as ObservationProjectionInput["severity"],
    occurrenceCount: item.occurrenceCount as number,
    firstObservedAt: timestamp(
      item.firstObservedAt,
      `${path}.firstObservedAt`,
    ),
    lastObservedAt: timestamp(item.lastObservedAt, `${path}.lastObservedAt`),
    ...(linkedIssue ? { linkedIssue } : {}),
    contributions: contributions.sort((left, right) =>
      `${left.kind}:${left.provider}:${left.remoteRef}`.localeCompare(
        `${right.kind}:${right.provider}:${right.remoteRef}`,
      ),
    ),
    workRuns: workRuns.sort((left, right) =>
      left.workRunId.localeCompare(right.workRunId),
    ),
    verifications: verifications.sort((left, right) =>
      left.verificationId.localeCompare(right.verificationId),
    ),
  };
}

function providerHealth(
  value: unknown,
  path: string,
): ProviderHealthProjectionInput {
  const item = record(value, path);
  closed(
    item,
    ["providerId", "health", "observedAt", "expiresAt", "diagnosticCode"],
    path,
  );
  const health = text(item.health, `${path}.health`, 16);
  if (
    !new Set(["available", "degraded", "unavailable", "disabled"]).has(health)
  ) {
    fail(`${path}.health`, "has an unsupported value");
  }
  const diagnosticCode =
    item.diagnosticCode === undefined
      ? undefined
      : text(item.diagnosticCode, `${path}.diagnosticCode`, 32);
  if (
    diagnosticCode &&
    !new Set([
      "absent",
      "disabled",
      "incompatible",
      "capability-missing",
      "runtime-failed",
      "privacy-blocked",
    ]).has(diagnosticCode)
  ) {
    fail(`${path}.diagnosticCode`, "has an unsupported value");
  }
  const observedAt =
    item.observedAt === undefined
      ? undefined
      : timestamp(item.observedAt, `${path}.observedAt`);
  const expiresAt =
    item.expiresAt === undefined
      ? undefined
      : timestamp(item.expiresAt, `${path}.expiresAt`);
  if (
    observedAt &&
    expiresAt &&
    Date.parse(expiresAt) <= Date.parse(observedAt)
  ) {
    fail(`${path}.expiresAt`, "must be later than observedAt");
  }
  return {
    providerId: id(item.providerId, `${path}.providerId`),
    health: health as PluginDiagnosticHealth,
    ...(observedAt ? { observedAt } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(diagnosticCode
      ? { diagnosticCode: diagnosticCode as PluginDiagnosticStatusCode }
      : {}),
  };
}

export function validateProjectHubProjectionInput(
  value: unknown,
): ProjectHubProjectionInput {
  const item = record(value, "input");
  closed(
    item,
    [
      "schemaVersion",
      "projectId",
      "generatedAt",
      "visualDocuments",
      "observations",
      "providerHealth",
    ],
    "input",
  );
  if (item.schemaVersion !== PROJECT_HUB_PROJECTION_SCHEMA_VERSION) {
    fail("input.schemaVersion", "must equal 1");
  }
  const projectId = id(item.projectId, "input.projectId");
  if (!PROJECT_PATTERN.test(projectId)) {
    fail("input.projectId", "must be a canonical Project ID");
  }
  const visualDocuments = array(
    item.visualDocuments,
    "input.visualDocuments",
  ).map((entry, index) =>
    visualDocument(entry, `input.visualDocuments[${index}]`),
  );
  const observations = array(item.observations, "input.observations").map(
    (entry, index) => observation(entry, `input.observations[${index}]`),
  );
  const providers = array(item.providerHealth, "input.providerHealth", 100).map(
    (entry, index) => providerHealth(entry, `input.providerHealth[${index}]`),
  );
  const duplicate = <T>(values: T[], key: (value: T) => string): boolean =>
    new Set(values.map(key)).size !== values.length;
  if (duplicate(visualDocuments, (entry) => entry.documentId)) {
    fail("input.visualDocuments", "documentId must be unique");
  }
  if (duplicate(observations, (entry) => entry.observationId)) {
    fail("input.observations", "observationId must be unique");
  }
  if (duplicate(providers, (entry) => entry.providerId)) {
    fail("input.providerHealth", "providerId must be unique");
  }
  return {
    schemaVersion: PROJECT_HUB_PROJECTION_SCHEMA_VERSION,
    projectId,
    generatedAt: timestamp(item.generatedAt, "input.generatedAt"),
    visualDocuments: visualDocuments.sort((left, right) =>
      left.documentId.localeCompare(right.documentId),
    ),
    observations: observations.sort((left, right) =>
      left.observationId.localeCompare(right.observationId),
    ),
    providerHealth: providers.sort((left, right) =>
      left.providerId.localeCompare(right.providerId),
    ),
  };
}
