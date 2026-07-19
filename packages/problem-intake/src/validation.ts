import { canonicalDigest, deepClone } from "./canonical.js";
import { ProblemIntakeError } from "./errors.js";
import { assertPersistenceSafe } from "./security.js";
import type {
  ContributionPlanId,
  ExternalContributionContent,
  ExternalContributionExecutionProjection,
  ExternalContributionPlan,
  ExternalRepositoryTarget,
  IssueChangePayload,
  IssueChangePlan,
  ProblemDisposition,
  ProblemEvidenceReference,
  ProblemLifecycleState,
  ProblemLifecycleTransition,
  ProblemObservation,
  ProblemObservationId,
  ProblemOccurrence,
  ProblemProvider,
  ProblemReport,
  ProblemSeverity,
  ProblemSubject,
  ProblemVerification,
  ProjectId,
  PullRequestPatchEvidence,
  PullRequestTestEvidence,
  Sha256Digest,
} from "./types.js";

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const PROJECT_ID = /^project\/[a-z0-9][a-z0-9-]{0,127}$/;
const OBSERVATION_ID = /^problem\/[a-f0-9]{64}$/;
const CONTRIBUTION_ID = /^contribution\/[a-f0-9]{64}$/;
const ISSUE_ENTITY = /^project\/[a-z0-9][a-z0-9-]{0,127}\/issue\/[a-z0-9][a-z0-9-]{0,127}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const SIMPLE_ID = /^[a-z0-9][a-z0-9._:/-]{0,255}$/;
const GIT_REVISION = /^[a-fA-F0-9]{7,64}$/;
const REPOSITORY = /^[a-z0-9][a-z0-9._-]{0,99}\/[a-z0-9][a-z0-9._-]{0,99}$/i;

function fail(message: string): never {
  throw new ProblemIntakeError("INVALID_CONTRACT", message);
}

export function objectRecord(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function assertFields(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  context: string,
): void {
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  const missing = required.filter((key) => !(key in value));
  if (unknown.length > 0) fail(`${context} has unknown fields: ${unknown.join(", ")}`);
  if (missing.length > 0) fail(`${context} is missing fields: ${missing.join(", ")}`);
}

export function parseBoundedText(
  value: unknown,
  context: string,
  options: { max: number; allowNewlines?: boolean; persistenceSafe?: boolean } = { max: 512 },
): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > options.max
    || (!options.allowNewlines && /[\r\n]/.test(value))
  ) {
    return fail(
      `${context} must be a non-empty ${options.allowNewlines ? "" : "single-line "}string of at most ${options.max} characters`,
    );
  }
  if (options.persistenceSafe !== false) assertPersistenceSafe(value, context);
  return value;
}

export function parseNullableText(
  value: unknown,
  context: string,
  max = 2000,
): string | null {
  if (value === null) return null;
  return parseBoundedText(value, context, { max, allowNewlines: true });
}

export function parseProjectId(value: unknown, context = "projectId"): ProjectId {
  if (typeof value !== "string" || !PROJECT_ID.test(value)) {
    throw new ProblemIntakeError(
      "INVALID_PROJECT_ID",
      `${context} must be a canonical project/<lowercase-kebab-slug> Project ID`,
    );
  }
  return value as ProjectId;
}

export function parseSha256(value: unknown, context: string): Sha256Digest {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new ProblemIntakeError("INVALID_FINGERPRINT", `${context} must be a lowercase sha256 digest`);
  }
  return value as Sha256Digest;
}

export function parseObservationId(value: unknown, context = "observationId"): ProblemObservationId {
  if (typeof value !== "string" || !OBSERVATION_ID.test(value)) {
    return fail(`${context} must be a canonical problem identifier`);
  }
  return value as ProblemObservationId;
}

export function parseContributionId(value: unknown, context = "contributionId"): ContributionPlanId {
  if (typeof value !== "string" || !CONTRIBUTION_ID.test(value)) {
    return fail(`${context} must be a canonical contribution identifier`);
  }
  return value as ContributionPlanId;
}

export function parseInstant(value: unknown, context: string): string {
  const instant = parseBoundedText(value, context, { max: 32, persistenceSafe: false });
  if (!ISO_INSTANT.test(instant) || Number.isNaN(Date.parse(instant))) {
    return fail(`${context} must be an ISO-8601 UTC instant`);
  }
  return instant;
}

export function parsePositiveInteger(value: unknown, context: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    return fail(`${context} must be a positive safe integer`);
  }
  return value as number;
}

function parseEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  context: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    return fail(`${context} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

function parseStringArray(
  value: unknown,
  context: string,
  options: { maxItems: number; maxLength: number; unique?: boolean; persistenceSafe?: boolean },
): string[] {
  if (!Array.isArray(value) || value.length > options.maxItems) {
    return fail(`${context} must be an array with at most ${options.maxItems} entries`);
  }
  const result = value.map((item, index) =>
    parseBoundedText(item, `${context}[${index}]`, {
      max: options.maxLength,
      persistenceSafe: options.persistenceSafe,
    }));
  if (options.unique !== false && new Set(result).size !== result.length) {
    return fail(`${context} must not contain duplicates`);
  }
  return result;
}

export function parseProvider(value: unknown, context = "provider"): ProblemProvider {
  const candidate = objectRecord(value, context);
  assertFields(candidate, ["id", "kind", "version"], [], context);
  const id = parseBoundedText(candidate.id, `${context}.id`, { max: 256 });
  if (!SIMPLE_ID.test(id)) fail(`${context}.id must be a stable machine identifier`);
  return {
    id,
    kind: parseEnum(
      candidate.kind,
      ["obc", "host_capability", "obsidian_plugin", "agent", "manual"],
      `${context}.kind`,
    ),
    version: parseBoundedText(candidate.version, `${context}.version`, { max: 128 }),
  };
}

export function parseSubject(value: unknown, context = "subject"): ProblemSubject {
  const candidate = objectRecord(value, context);
  assertFields(candidate, ["kind", "canonicalRef"], [], context);
  const kind = parseEnum(
    candidate.kind,
    ["vault_path", "capability", "plugin", "repository", "other"],
    `${context}.kind`,
  );
  const canonicalRef = parseBoundedText(candidate.canonicalRef, `${context}.canonicalRef`, { max: 2048 });
  if (kind === "vault_path") {
    if (
      canonicalRef.startsWith("/")
      || canonicalRef.startsWith("\\")
      || /^[A-Za-z]:/.test(canonicalRef)
      || canonicalRef.includes("\\")
      || canonicalRef.split("/").some((part) => part === "" || part === "." || part === "..")
    ) {
      fail(`${context}.canonicalRef must be a normalized vault-relative path`);
    }
  }
  return { kind, canonicalRef };
}

export function parseEvidenceReference(
  value: unknown,
  context = "evidenceRef",
): ProblemEvidenceReference {
  const candidate = objectRecord(value, context);
  assertFields(candidate, ["kind", "ref"], ["digest", "summary"], context);
  const evidence: ProblemEvidenceReference = {
    kind: parseEnum(
      candidate.kind,
      ["vault_path", "citation", "provider_finding", "operation_receipt", "test_result"],
      `${context}.kind`,
    ),
    ref: parseBoundedText(candidate.ref, `${context}.ref`, { max: 2048 }),
  };
  if (candidate.digest !== undefined) evidence.digest = parseSha256(candidate.digest, `${context}.digest`);
  if (candidate.summary !== undefined) {
    evidence.summary = parseBoundedText(candidate.summary, `${context}.summary`, {
      max: 500,
      allowNewlines: true,
    });
  }
  if (evidence.kind === "vault_path") parseSubject({ kind: "vault_path", canonicalRef: evidence.ref }, context);
  return evidence;
}

export function parseEvidenceReferences(
  value: unknown,
  context = "evidenceRefs",
): ProblemEvidenceReference[] {
  if (!Array.isArray(value) || value.length > 32) {
    return fail(`${context} must be an array with at most 32 bounded references`);
  }
  const parsed = value.map((item, index) => parseEvidenceReference(item, `${context}[${index}]`));
  const identities = parsed.map(evidenceIdentity);
  if (new Set(identities).size !== identities.length) fail(`${context} must not contain duplicate evidence`);
  return parsed.sort((left, right) => evidenceIdentity(left).localeCompare(evidenceIdentity(right)));
}

export function evidenceIdentity(evidence: ProblemEvidenceReference): string {
  return `${evidence.kind}\0${evidence.ref}\0${evidence.digest ?? ""}`;
}

export function parseProblemReport(value: unknown): ProblemReport {
  const candidate = objectRecord(value, "ProblemReport");
  assertFields(
    candidate,
    [
      "schemaVersion",
      "projectId",
      "provider",
      "ruleId",
      "subject",
      "severity",
      "summary",
      "evidenceRefs",
      "observedAt",
    ],
    ["suggestedAction"],
    "ProblemReport",
  );
  if (candidate.schemaVersion !== 1) fail("ProblemReport.schemaVersion must be 1");
  const report: ProblemReport = {
    schemaVersion: 1,
    projectId: parseProjectId(candidate.projectId, "ProblemReport.projectId"),
    provider: parseProvider(candidate.provider, "ProblemReport.provider"),
    ruleId: parseBoundedText(candidate.ruleId, "ProblemReport.ruleId", { max: 256 }),
    subject: parseSubject(candidate.subject, "ProblemReport.subject"),
    severity: parseEnum(
      candidate.severity,
      ["info", "warning", "error", "critical"],
      "ProblemReport.severity",
    ) as ProblemSeverity,
    summary: parseBoundedText(candidate.summary, "ProblemReport.summary", {
      max: 1000,
      allowNewlines: true,
    }),
    evidenceRefs: parseEvidenceReferences(candidate.evidenceRefs, "ProblemReport.evidenceRefs"),
    observedAt: parseInstant(candidate.observedAt, "ProblemReport.observedAt"),
  };
  if (candidate.suggestedAction !== undefined) {
    report.suggestedAction = parseBoundedText(
      candidate.suggestedAction,
      "ProblemReport.suggestedAction",
      { max: 1000, allowNewlines: true },
    );
  }
  return deepClone(report);
}

export function problemSourceFingerprint(report: ProblemReport): Sha256Digest {
  return canonicalDigest({
    provider: { id: report.provider.id, kind: report.provider.kind },
    subject: report.subject,
  });
}

export function problemObservationFingerprint(report: ProblemReport): Sha256Digest {
  return canonicalDigest({
    providerId: report.provider.id,
    ruleId: report.ruleId,
    subject: report.subject,
    evidenceIdentity: report.evidenceRefs.map(evidenceIdentity),
  });
}

export function problemObservationId(projectId: ProjectId, fingerprint: Sha256Digest): ProblemObservationId {
  return `problem/${canonicalDigest({ projectId, fingerprint }).slice("sha256:".length)}`;
}

function parseLifecycleTransition(value: unknown, context: string): ProblemLifecycleTransition {
  const candidate = objectRecord(value, context);
  assertFields(
    candidate,
    ["revision", "from", "to", "actor", "reason", "at", "transitionToken"],
    [],
    context,
  );
  return {
    revision: parsePositiveInteger(candidate.revision, `${context}.revision`),
    from: parseEnum(
      candidate.from,
      ["untriaged", "acknowledged", "dismissed", "resolved"],
      `${context}.from`,
    ),
    to: parseEnum(
      candidate.to,
      ["untriaged", "acknowledged", "dismissed", "resolved"],
      `${context}.to`,
    ),
    actor: parseBoundedText(candidate.actor, `${context}.actor`, { max: 256 }),
    reason: parseBoundedText(candidate.reason, `${context}.reason`, {
      max: 1000,
      allowNewlines: true,
    }),
    at: parseInstant(candidate.at, `${context}.at`),
    transitionToken: parseBoundedText(candidate.transitionToken, `${context}.transitionToken`, { max: 256 }),
  };
}

function parseVerification(value: unknown, context: string): ProblemVerification {
  const candidate = objectRecord(value, context);
  assertFields(
    candidate,
    ["revision", "status", "verifiedAt", "actor", "providerVersion", "evidenceRefs"],
    [],
    context,
  );
  return {
    revision: parsePositiveInteger(candidate.revision, `${context}.revision`),
    status: parseEnum(
      candidate.status,
      ["reproduced", "not_reproduced", "provider_failed"],
      `${context}.status`,
    ),
    verifiedAt: parseInstant(candidate.verifiedAt, `${context}.verifiedAt`),
    actor: parseBoundedText(candidate.actor, `${context}.actor`, { max: 256 }),
    providerVersion: parseBoundedText(candidate.providerVersion, `${context}.providerVersion`, { max: 128 }),
    evidenceRefs: parseEvidenceReferences(candidate.evidenceRefs, `${context}.evidenceRefs`),
  };
}

function parseOccurrence(value: unknown, context: string): ProblemOccurrence {
  const candidate = objectRecord(value, context);
  assertFields(
    candidate,
    ["count", "firstObservedAt", "lastObservedAt", "providerVersions"],
    [],
    context,
  );
  return {
    count: parsePositiveInteger(candidate.count, `${context}.count`),
    firstObservedAt: parseInstant(candidate.firstObservedAt, `${context}.firstObservedAt`),
    lastObservedAt: parseInstant(candidate.lastObservedAt, `${context}.lastObservedAt`),
    providerVersions: parseStringArray(candidate.providerVersions, `${context}.providerVersions`, {
      maxItems: 32,
      maxLength: 128,
    }).sort(),
  };
}

export function parseProblemObservation(value: unknown): ProblemObservation {
  const candidate = objectRecord(value, "ProblemObservation");
  assertFields(
    candidate,
    [
      "schemaVersion",
      "id",
      "projectId",
      "provider",
      "ruleId",
      "subject",
      "severity",
      "summary",
      "evidenceRefs",
      "observedAt",
      "sourceFingerprint",
      "observationFingerprint",
      "revision",
      "lifecycle",
      "lifecycleHistory",
      "occurrence",
      "verificationHistory",
      "suggestedAction",
      "linkedIssue",
      "linkedContributions",
    ],
    [],
    "ProblemObservation",
  );
  if (candidate.schemaVersion !== 1) fail("ProblemObservation.schemaVersion must be 1");
  if (!Array.isArray(candidate.lifecycleHistory) || candidate.lifecycleHistory.length > 100) {
    fail("ProblemObservation.lifecycleHistory must contain at most 100 entries");
  }
  if (!Array.isArray(candidate.verificationHistory) || candidate.verificationHistory.length > 100) {
    fail("ProblemObservation.verificationHistory must contain at most 100 entries");
  }
  const observation: ProblemObservation = {
    schemaVersion: 1,
    id: parseObservationId(candidate.id, "ProblemObservation.id"),
    projectId: parseProjectId(candidate.projectId, "ProblemObservation.projectId"),
    provider: parseProvider(candidate.provider, "ProblemObservation.provider"),
    ruleId: parseBoundedText(candidate.ruleId, "ProblemObservation.ruleId", { max: 256 }),
    subject: parseSubject(candidate.subject, "ProblemObservation.subject"),
    severity: parseEnum(
      candidate.severity,
      ["info", "warning", "error", "critical"],
      "ProblemObservation.severity",
    ),
    summary: parseBoundedText(candidate.summary, "ProblemObservation.summary", {
      max: 1000,
      allowNewlines: true,
    }),
    evidenceRefs: parseEvidenceReferences(candidate.evidenceRefs, "ProblemObservation.evidenceRefs"),
    observedAt: parseInstant(candidate.observedAt, "ProblemObservation.observedAt"),
    sourceFingerprint: parseSha256(candidate.sourceFingerprint, "ProblemObservation.sourceFingerprint"),
    observationFingerprint: parseSha256(
      candidate.observationFingerprint,
      "ProblemObservation.observationFingerprint",
    ),
    revision: parsePositiveInteger(candidate.revision, "ProblemObservation.revision"),
    lifecycle: parseEnum(
      candidate.lifecycle,
      ["untriaged", "acknowledged", "dismissed", "resolved"],
      "ProblemObservation.lifecycle",
    ),
    lifecycleHistory: candidate.lifecycleHistory.map((item, index) =>
      parseLifecycleTransition(item, `ProblemObservation.lifecycleHistory[${index}]`)),
    occurrence: parseOccurrence(candidate.occurrence, "ProblemObservation.occurrence"),
    verificationHistory: candidate.verificationHistory.map((item, index) =>
      parseVerification(item, `ProblemObservation.verificationHistory[${index}]`)),
    suggestedAction: parseNullableText(candidate.suggestedAction, "ProblemObservation.suggestedAction", 1000),
    linkedIssue: candidate.linkedIssue === null
      ? null
      : parseIssueEntity(candidate.linkedIssue, "ProblemObservation.linkedIssue"),
    linkedContributions: parseStringArray(
      candidate.linkedContributions,
      "ProblemObservation.linkedContributions",
      { maxItems: 32, maxLength: 80 },
    ).map((item, index) => parseContributionId(item, `ProblemObservation.linkedContributions[${index}]`)),
  };
  const report: ProblemReport = {
    schemaVersion: 1,
    projectId: observation.projectId,
    provider: observation.provider,
    ruleId: observation.ruleId,
    subject: observation.subject,
    severity: observation.severity,
    summary: observation.summary,
    evidenceRefs: observation.evidenceRefs,
    observedAt: observation.observedAt,
    ...(observation.suggestedAction === null ? {} : { suggestedAction: observation.suggestedAction }),
  };
  const expectedSource = problemSourceFingerprint(report);
  const expectedObservation = problemObservationFingerprint(report);
  if (
    observation.sourceFingerprint !== expectedSource
    || observation.observationFingerprint !== expectedObservation
    || observation.id !== problemObservationId(observation.projectId, expectedObservation)
  ) {
    throw new ProblemIntakeError(
      "INVALID_FINGERPRINT",
      "ProblemObservation identity or fingerprints do not match its normalized evidence",
    );
  }
  validateObservationHistory(observation);
  return deepClone(observation);
}

function validateObservationHistory(observation: ProblemObservation): void {
  let state: ProblemLifecycleState = "untriaged";
  let priorRevision = 0;
  const tokens = new Set<string>();
  for (const transition of observation.lifecycleHistory) {
    if (
      transition.from !== state
      || transition.revision <= priorRevision
      || tokens.has(transition.transitionToken)
    ) {
      fail("ProblemObservation lifecycle history is inconsistent");
    }
    state = transition.to;
    priorRevision = transition.revision;
    tokens.add(transition.transitionToken);
  }
  if (state !== observation.lifecycle) fail("ProblemObservation lifecycle does not match its history");
  for (const verification of observation.verificationHistory) {
    if (verification.revision > observation.revision) {
      fail("ProblemObservation verification revision cannot exceed current revision");
    }
  }
  if (
    observation.occurrence.firstObservedAt > observation.occurrence.lastObservedAt
    || observation.observedAt !== observation.occurrence.lastObservedAt
  ) {
    fail("ProblemObservation occurrence timestamps are inconsistent");
  }
}

export function parseIssueEntity(value: unknown, context = "issueEntity"): string {
  const entity = parseBoundedText(value, context, { max: 300 });
  if (!ISSUE_ENTITY.test(entity)) fail(`${context} must be a canonical Project issue entity`);
  return entity;
}

function parseIssuePayload(value: unknown, context: string): IssueChangePayload {
  const candidate = objectRecord(value, context);
  assertFields(candidate, ["title", "description", "body", "priority"], [], context);
  const priority = candidate.priority;
  if (!Number.isInteger(priority) || ![0, 1, 2, 3, 4].includes(priority as number)) {
    fail(`${context}.priority must be an integer from 0 through 4`);
  }
  return {
    title: parseBoundedText(candidate.title, `${context}.title`, { max: 200 }),
    description: parseBoundedText(candidate.description, `${context}.description`, { max: 200 }),
    body: parseBoundedText(candidate.body, `${context}.body`, { max: 8000, allowNewlines: true }),
    priority: priority as 0 | 1 | 2 | 3 | 4,
  };
}

export function parseProblemDisposition(value: unknown): ProblemDisposition {
  const candidate = objectRecord(value, "ProblemDisposition");
  assertFields(
    candidate,
    ["schemaVersion", "observationId", "observationRevision", "choice", "actor", "selectedAt", "reason"],
    [],
    "ProblemDisposition",
  );
  if (candidate.schemaVersion !== 1) fail("ProblemDisposition.schemaVersion must be 1");
  return {
    schemaVersion: 1,
    observationId: parseObservationId(candidate.observationId, "ProblemDisposition.observationId"),
    observationRevision: parsePositiveInteger(
      candidate.observationRevision,
      "ProblemDisposition.observationRevision",
    ),
    choice: parseEnum(
      candidate.choice,
      ["local_only", "submit_issue", "prepare_pull_request"],
      "ProblemDisposition.choice",
    ),
    actor: parseBoundedText(candidate.actor, "ProblemDisposition.actor", { max: 256 }),
    selectedAt: parseInstant(candidate.selectedAt, "ProblemDisposition.selectedAt"),
    reason: parseNullableText(candidate.reason, "ProblemDisposition.reason", 1000),
  };
}

export function parseIssueChangePlan(value: unknown): IssueChangePlan {
  const candidate = objectRecord(value, "IssueChangePlan");
  assertFields(
    candidate,
    [
      "schemaVersion",
      "projectId",
      "observationId",
      "observationRevision",
      "existingIssueEntity",
      "action",
      "operation",
      "payload",
      "evidenceRefs",
      "warnings",
      "actor",
      "fingerprint",
    ],
    [],
    "IssueChangePlan",
  );
  if (candidate.schemaVersion !== 1) fail("IssueChangePlan.schemaVersion must be 1");
  const action = parseEnum(candidate.action, ["create", "update", "comment"], "IssueChangePlan.action");
  const operation = parseEnum(
    candidate.operation,
    ["project.issue.create", "project.issue.update", "project.comment.add"],
    "IssueChangePlan.operation",
  );
  const expectedOperation = action === "create"
    ? "project.issue.create"
    : action === "update"
      ? "project.issue.update"
      : "project.comment.add";
  if (operation !== expectedOperation) fail("IssueChangePlan action and operation disagree");
  const plan: IssueChangePlan = {
    schemaVersion: 1,
    projectId: parseProjectId(candidate.projectId, "IssueChangePlan.projectId"),
    observationId: parseObservationId(candidate.observationId, "IssueChangePlan.observationId"),
    observationRevision: parsePositiveInteger(
      candidate.observationRevision,
      "IssueChangePlan.observationRevision",
    ),
    existingIssueEntity: candidate.existingIssueEntity === null
      ? null
      : parseIssueEntity(candidate.existingIssueEntity, "IssueChangePlan.existingIssueEntity"),
    action,
    operation,
    payload: parseIssuePayload(candidate.payload, "IssueChangePlan.payload"),
    evidenceRefs: parseEvidenceReferences(candidate.evidenceRefs, "IssueChangePlan.evidenceRefs"),
    warnings: parseStringArray(candidate.warnings, "IssueChangePlan.warnings", {
      maxItems: 32,
      maxLength: 1000,
    }),
    actor: parseBoundedText(candidate.actor, "IssueChangePlan.actor", { max: 256 }),
    fingerprint: parseSha256(candidate.fingerprint, "IssueChangePlan.fingerprint"),
  };
  if ((action === "create") !== (plan.existingIssueEntity === null)) {
    fail("IssueChangePlan create must have no existing issue; update/comment must identify one");
  }
  const { fingerprint: _fingerprint, ...payload } = plan;
  if (canonicalDigest(payload) !== plan.fingerprint) {
    throw new ProblemIntakeError("PLAN_TAMPERED", "IssueChangePlan fingerprint does not match");
  }
  return deepClone(plan);
}

function parseRepositoryTarget(value: unknown, context: string): ExternalRepositoryTarget {
  const candidate = objectRecord(value, context);
  assertFields(candidate, ["provider", "repository", "baseRevision"], [], context);
  const repository = parseBoundedText(candidate.repository, `${context}.repository`, { max: 201 });
  if (!REPOSITORY.test(repository)) fail(`${context}.repository must be an exact owner/repository slug`);
  const baseRevision = parseBoundedText(candidate.baseRevision, `${context}.baseRevision`, {
    max: 64,
    persistenceSafe: false,
  });
  if (!GIT_REVISION.test(baseRevision)) fail(`${context}.baseRevision must be a stable git revision`);
  return {
    provider: parseEnum(candidate.provider, ["github", "gitea", "gitlab"], `${context}.provider`),
    repository,
    baseRevision: baseRevision.toLowerCase(),
  };
}

function parseContributionContent(value: unknown, context: string): ExternalContributionContent {
  const candidate = objectRecord(value, context);
  assertFields(candidate, ["title", "body", "labels", "evidenceRefs"], [], context);
  return {
    title: parseBoundedText(candidate.title, `${context}.title`, { max: 256 }),
    body: parseBoundedText(candidate.body, `${context}.body`, { max: 16000, allowNewlines: true }),
    labels: parseStringArray(candidate.labels, `${context}.labels`, { maxItems: 20, maxLength: 100 }),
    evidenceRefs: parseEvidenceReferences(candidate.evidenceRefs, `${context}.evidenceRefs`),
  };
}

function parseTestEvidence(value: unknown, context: string): PullRequestTestEvidence {
  const candidate = objectRecord(value, context);
  assertFields(candidate, ["command", "status", "summary"], [], context);
  if (candidate.status !== "passed") {
    throw new ProblemIntakeError("UNVERIFIED_PATCH", `${context}.status must be passed`);
  }
  return {
    command: parseBoundedText(candidate.command, `${context}.command`, { max: 1000 }),
    status: "passed",
    summary: parseBoundedText(candidate.summary, `${context}.summary`, {
      max: 2000,
      allowNewlines: true,
    }),
  };
}

function parseRepoRelativePath(value: unknown, context: string): string {
  const path = parseBoundedText(value, context, { max: 4096 });
  if (
    path.startsWith("/")
    || path.startsWith("\\")
    || /^[A-Za-z]:/.test(path)
    || path.includes("\\")
    || path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    fail(`${context} must be a normalized repository-relative path`);
  }
  return path;
}

function parsePatchEvidence(value: unknown, context: string): PullRequestPatchEvidence {
  const candidate = objectRecord(value, context);
  assertFields(
    candidate,
    [
      "baseRevision",
      "headRevision",
      "branchTarget",
      "diffSummary",
      "changedPaths",
      "tests",
      "draft",
    ],
    [],
    context,
  );
  const baseRevision = parseBoundedText(candidate.baseRevision, `${context}.baseRevision`, {
    max: 64,
    persistenceSafe: false,
  });
  const headRevision = parseBoundedText(candidate.headRevision, `${context}.headRevision`, {
    max: 64,
    persistenceSafe: false,
  });
  if (!GIT_REVISION.test(baseRevision) || !GIT_REVISION.test(headRevision)) {
    fail(`${context} revisions must be stable git revisions`);
  }
  if (!Array.isArray(candidate.changedPaths) || candidate.changedPaths.length === 0 || candidate.changedPaths.length > 100) {
    throw new ProblemIntakeError(
      "UNVERIFIED_PATCH",
      `${context}.changedPaths must contain 1 through 100 bounded paths`,
    );
  }
  if (!Array.isArray(candidate.tests) || candidate.tests.length === 0 || candidate.tests.length > 50) {
    throw new ProblemIntakeError(
      "UNVERIFIED_PATCH",
      `${context}.tests must contain passing regression evidence`,
    );
  }
  if (candidate.draft !== true) {
    throw new ProblemIntakeError("UNVERIFIED_PATCH", `${context}.draft must remain true`);
  }
  return {
    baseRevision: baseRevision.toLowerCase(),
    headRevision: headRevision.toLowerCase(),
    branchTarget: parseBoundedText(candidate.branchTarget, `${context}.branchTarget`, { max: 300 }),
    diffSummary: parseBoundedText(candidate.diffSummary, `${context}.diffSummary`, {
      max: 4000,
      allowNewlines: true,
    }),
    changedPaths: candidate.changedPaths.map((item, index) =>
      parseRepoRelativePath(item, `${context}.changedPaths[${index}]`)),
    tests: candidate.tests.map((item, index) => parseTestEvidence(item, `${context}.tests[${index}]`)),
    draft: true,
  };
}

function parseExecutionProjection(
  value: unknown,
  context: string,
): ExternalContributionExecutionProjection {
  const candidate = objectRecord(value, context);
  assertFields(
    candidate,
    [
      "schemaVersion",
      "kind",
      "repositoryMappingFingerprint",
      "preflightFingerprint",
      "reviewedLocalWorkFingerprint",
      "pullRequestArtifactFingerprint",
      "projectionFingerprint",
    ],
    [],
    context,
  );
  if (candidate.schemaVersion !== 1 || candidate.kind !== "forge_execution_v1") {
    fail(`${context} must use forge_execution_v1 schema version 1`);
  }
  const projection: ExternalContributionExecutionProjection = {
    schemaVersion: 1,
    kind: "forge_execution_v1",
    repositoryMappingFingerprint: parseSha256(
      candidate.repositoryMappingFingerprint,
      `${context}.repositoryMappingFingerprint`,
    ),
    preflightFingerprint: parseSha256(candidate.preflightFingerprint, `${context}.preflightFingerprint`),
    reviewedLocalWorkFingerprint: parseSha256(
      candidate.reviewedLocalWorkFingerprint,
      `${context}.reviewedLocalWorkFingerprint`,
    ),
    pullRequestArtifactFingerprint: candidate.pullRequestArtifactFingerprint === null
      ? null
      : parseSha256(
        candidate.pullRequestArtifactFingerprint,
        `${context}.pullRequestArtifactFingerprint`,
      ),
    projectionFingerprint: parseSha256(
      candidate.projectionFingerprint,
      `${context}.projectionFingerprint`,
    ),
  };
  const { projectionFingerprint: _fingerprint, ...payload } = projection;
  if (canonicalDigest(payload) !== projection.projectionFingerprint) {
    throw new ProblemIntakeError(
      "PLAN_TAMPERED",
      "Forge execution projection fingerprint does not match its locked facts",
    );
  }
  return projection;
}

export function parseExternalContributionPlan(value: unknown): ExternalContributionPlan {
  const candidate = objectRecord(value, "ExternalContributionPlan");
  assertFields(
    candidate,
    [
      "schemaVersion",
      "id",
      "disposition",
      "projectId",
      "observationId",
      "observationRevision",
      "linkedIssueEntity",
      "target",
      "content",
      "patch",
      "executionProjection",
      "settingsSnapshotFingerprint",
      "remoteHeadFingerprint",
      "redactions",
      "warnings",
      "actor",
      "fingerprint",
    ],
    [],
    "ExternalContributionPlan",
  );
  if (candidate.schemaVersion !== 1) fail("ExternalContributionPlan.schemaVersion must be 1");
  const plan: ExternalContributionPlan = {
    schemaVersion: 1,
    id: parseContributionId(candidate.id, "ExternalContributionPlan.id"),
    disposition: parseProblemDisposition(candidate.disposition),
    projectId: parseProjectId(candidate.projectId, "ExternalContributionPlan.projectId"),
    observationId: parseObservationId(candidate.observationId, "ExternalContributionPlan.observationId"),
    observationRevision: parsePositiveInteger(
      candidate.observationRevision,
      "ExternalContributionPlan.observationRevision",
    ),
    linkedIssueEntity: candidate.linkedIssueEntity === null
      ? null
      : parseIssueEntity(candidate.linkedIssueEntity, "ExternalContributionPlan.linkedIssueEntity"),
    target: candidate.target === null ? null : parseRepositoryTarget(candidate.target, "ExternalContributionPlan.target"),
    content: candidate.content === null
      ? null
      : parseContributionContent(candidate.content, "ExternalContributionPlan.content"),
    patch: candidate.patch === null ? null : parsePatchEvidence(candidate.patch, "ExternalContributionPlan.patch"),
    executionProjection: candidate.executionProjection === null
      ? null
      : parseExecutionProjection(
        candidate.executionProjection,
        "ExternalContributionPlan.executionProjection",
      ),
    settingsSnapshotFingerprint: candidate.settingsSnapshotFingerprint === null
      ? null
      : parseSha256(
        candidate.settingsSnapshotFingerprint,
        "ExternalContributionPlan.settingsSnapshotFingerprint",
      ),
    remoteHeadFingerprint: candidate.remoteHeadFingerprint === null
      ? null
      : parseSha256(candidate.remoteHeadFingerprint, "ExternalContributionPlan.remoteHeadFingerprint"),
    redactions: parseStringArray(candidate.redactions, "ExternalContributionPlan.redactions", {
      maxItems: 32,
      maxLength: 200,
      persistenceSafe: false,
    }),
    warnings: parseStringArray(candidate.warnings, "ExternalContributionPlan.warnings", {
      maxItems: 32,
      maxLength: 1000,
    }),
    actor: parseBoundedText(candidate.actor, "ExternalContributionPlan.actor", { max: 256 }),
    fingerprint: parseSha256(candidate.fingerprint, "ExternalContributionPlan.fingerprint"),
  };
  assertContributionSemantics(plan);
  const { fingerprint: _fingerprint, id: _id, ...payload } = plan;
  const expectedFingerprint = canonicalDigest(payload);
  const expectedId = `contribution/${expectedFingerprint.slice("sha256:".length)}`;
  if (plan.fingerprint !== expectedFingerprint || plan.id !== expectedId) {
    throw new ProblemIntakeError("PLAN_TAMPERED", "ExternalContributionPlan identity or fingerprint does not match");
  }
  return deepClone(plan);
}

function assertContributionSemantics(plan: ExternalContributionPlan): void {
  if (
    plan.disposition.observationId !== plan.observationId
    || plan.disposition.observationRevision !== plan.observationRevision
    || plan.disposition.actor !== plan.actor
  ) {
    throw new ProblemIntakeError("PLAN_TAMPERED", "Contribution disposition does not match its observation or actor");
  }
  if (plan.disposition.choice === "local_only") {
    if (
      plan.target !== null
      || plan.content !== null
      || plan.patch !== null
      || plan.executionProjection !== null
      || plan.settingsSnapshotFingerprint !== null
      || plan.remoteHeadFingerprint !== null
    ) {
      throw new ProblemIntakeError("CONSENT_REQUIRED", "A local-only plan cannot contain remote intent");
    }
    return;
  }
  if (
    plan.target === null
    || plan.content === null
    || plan.executionProjection === null
    || plan.settingsSnapshotFingerprint === null
    || plan.remoteHeadFingerprint === null
  ) {
    throw new ProblemIntakeError("INVALID_CONTRACT", "A remote contribution requires exact target and preflight facts");
  }
  if (plan.disposition.choice === "submit_issue" && plan.patch !== null) {
    fail("An upstream Issue plan cannot contain pull-request patch evidence");
  }
  if (plan.disposition.choice === "prepare_pull_request") {
    if (plan.patch === null) {
      throw new ProblemIntakeError("UNVERIFIED_PATCH", "A pull-request plan requires verified patch evidence");
    }
    if (plan.patch.baseRevision !== plan.target.baseRevision) {
      throw new ProblemIntakeError("UNVERIFIED_PATCH", "Patch and repository base revisions disagree");
    }
    if (plan.executionProjection.pullRequestArtifactFingerprint === null) {
      throw new ProblemIntakeError(
        "UNVERIFIED_PATCH",
        "Pull-request execution projection must lock the isolated patch artifact",
      );
    }
  } else if (plan.executionProjection.pullRequestArtifactFingerprint !== null) {
    fail("An upstream Issue execution projection cannot lock a pull-request artifact");
  }
}
