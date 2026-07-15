import { canonicalDigest } from "./canonical.js";
import { DomainValidationError } from "./errors.js";
import { assertSafeSharedState } from "./security.js";
import type {
  AgentProfile,
  AgentProfileId,
  ApprovalDecision,
  CandidateDiff,
  ContextChunk,
  ContextEnvelope,
  ContextLayer,
  MemoryConflict,
  MemoryEvent,
  MemoryProposal,
  MemoryRevision,
  MemoryScopeName,
  MemorySection,
  MemoryWarning,
  ModelLock,
  ProvenanceRef,
  ProjectAgentBinding,
  ProjectAgentBindingId,
  ProjectId,
  ProtectedDirective,
  RoomIdentity,
  RoomProjection,
  Thread,
  ThreadId,
} from "./types.js";

const PROFILE_ID_RE = /^agent\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const PROJECT_ID_RE = /^project\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const BINDING_ID_RE = /^binding\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const THREAD_ID_RE = /^thread\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const WORK_RUN_ID_RE = /^work-run\/[a-z0-9][a-z0-9-]*$/;
const ARTIFACT_ID_RE = /^artifact\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const GRANT_REF_RE = /^grant\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PROPOSAL_ID_RE = /^memory-proposal\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const REVISION_ID_RE = /^memory-revision\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const EVENT_ID_RE = /^memory-event\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const MEMORY_SCOPES = new Set<MemoryScopeName>(["recentContext", "openItems", "stableMemory"]);

function fail(message: string, path?: string): never {
  throw new DomainValidationError(message, path);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Expected object", path);
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== "string" || value !== value.trim() || (!allowEmpty && !value)) fail("Expected non-empty trimmed string", path);
  return value;
}

function exactString(value: unknown, path: string): string {
  if (typeof value !== "string") fail("Expected string", path);
  return value;
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (!Number.isInteger(value) || (value as number) < minimum) fail(`Expected integer >= ${minimum}`, path);
  return value as number;
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail("Expected boolean", path);
  return value;
}

function iso(value: unknown, path: string): string {
  const parsed = string(value, path);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(parsed) || Number.isNaN(Date.parse(parsed))) {
    fail("Expected UTC ISO-8601 timestamp", path);
  }
  return parsed;
}

function digest(value: unknown, path: string): string {
  const parsed = string(value, path);
  if (!DIGEST_RE.test(parsed)) fail("Expected sha256 digest", path);
  return parsed;
}

function strings(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) fail("Expected array", path);
  const parsed = value.map((item, index) => string(item, `${path}[${index}]`));
  if (new Set(parsed).size !== parsed.length) fail("Duplicate values are not allowed", path);
  return parsed;
}

function allowedKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed);
  const extra = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (extra.length) fail(`Unknown fields are not allowed: ${extra.join(", ")}`, path);
}

function versioned(value: Record<string, unknown>, path: string): void {
  if (value.schemaVersion !== 1) fail("Unsupported schemaVersion", `${path}.schemaVersion`);
  integer(value.revision, `${path}.revision`, 1);
  iso(value.createdAt, `${path}.createdAt`);
  string(value.createdBy, `${path}.createdBy`);
  iso(value.updatedAt, `${path}.updatedAt`);
  string(value.updatedBy, `${path}.updatedBy`);
  if (value.previousRevision !== undefined) {
    const previous = record(value.previousRevision, `${path}.previousRevision`);
    allowedKeys(previous, ["revision", "digest"], `${path}.previousRevision`);
    integer(previous.revision, `${path}.previousRevision.revision`, 1);
    digest(previous.digest, `${path}.previousRevision.digest`);
    if ((previous.revision as number) >= (value.revision as number)) fail("previous revision must be older", `${path}.previousRevision.revision`);
  }
}

export function parseAgentProfileId(value: unknown, path = "profileId"): AgentProfileId {
  const parsed = string(value, path);
  if (!PROFILE_ID_RE.test(parsed)) fail("Agent Profile ID must use agent/<lowercase-kebab-slug>", path);
  return parsed as AgentProfileId;
}

export function parseProjectId(value: unknown, path = "projectId"): ProjectId {
  const parsed = string(value, path);
  if (!PROJECT_ID_RE.test(parsed)) fail("Project ID must use project/<lowercase-kebab-slug>", path);
  return parsed as ProjectId;
}

export function parseBindingId(value: unknown, path = "bindingId"): ProjectAgentBindingId {
  const parsed = string(value, path);
  if (!BINDING_ID_RE.test(parsed)) fail("Binding ID must use binding/<project-slug>/<agent-slug>", path);
  return parsed as ProjectAgentBindingId;
}

export function parseThreadId(value: unknown, path = "threadId"): ThreadId {
  const parsed = string(value, path);
  if (!THREAD_ID_RE.test(parsed)) fail("Thread ID must use thread/<stable-id>", path);
  return parsed as ThreadId;
}

export function bindingIdFor(projectId: ProjectId, profileId: AgentProfileId): ProjectAgentBindingId {
  parseProjectId(projectId);
  parseAgentProfileId(profileId);
  return `binding/${projectId.slice("project/".length)}/${profileId.slice("agent/".length)}`;
}

function validateModelLock(value: unknown, path: string): ModelLock {
  const item = record(value, path);
  allowedKeys(item, ["provider", "model", "contextWindow", "tokenizer", "policyFingerprint"], path);
  string(item.provider, `${path}.provider`);
  string(item.model, `${path}.model`);
  integer(item.contextWindow, `${path}.contextWindow`, 1);
  string(item.tokenizer, `${path}.tokenizer`);
  digest(item.policyFingerprint, `${path}.policyFingerprint`);
  return item as unknown as ModelLock;
}

function validateProvenance(value: unknown, path: string): ProvenanceRef {
  const item = record(value, path);
  allowedKeys(item, ["kind", "id", "revision", "fingerprint"], path);
  const kind = string(item.kind, `${path}.kind`);
  if (!new Set(["governance", "profile", "binding", "memoryRevision", "project", "workItem", "workRun", "thread", "settings", "deviceCapability", "grant", "artifact", "source"]).has(kind)) {
    fail("Invalid provenance kind", `${path}.kind`);
  }
  string(item.id, `${path}.id`);
  if (item.revision !== undefined) {
    if (typeof item.revision === "number") integer(item.revision, `${path}.revision`, 0);
    else string(item.revision, `${path}.revision`);
  }
  if (item.fingerprint !== undefined) digest(item.fingerprint, `${path}.fingerprint`);
  return item as unknown as ProvenanceRef;
}

function validateWarning(value: unknown, path: string): MemoryWarning {
  const item = record(value, path);
  allowedKeys(item, ["code", "severity", "message", "sourceRef"], path);
  string(item.code, `${path}.code`);
  if (!new Set(["info", "warning", "error"]).has(string(item.severity, `${path}.severity`))) fail("Invalid warning severity", `${path}.severity`);
  string(item.message, `${path}.message`);
  if (item.sourceRef !== undefined) string(item.sourceRef, `${path}.sourceRef`);
  return item as unknown as MemoryWarning;
}

export function validateAgentProfile(value: unknown): AgentProfile {
  const item = record(value, "AgentProfile");
  allowedKeys(item, [
    "schemaVersion", "profileId", "revision", "displayName", "role", "responsibilities", "capabilityClaims",
    "constitution", "defaultModelPolicy", "createdAt", "createdBy", "updatedAt", "updatedBy", "previousRevision",
  ], "AgentProfile");
  versioned(item, "AgentProfile");
  parseAgentProfileId(item.profileId, "AgentProfile.profileId");
  string(item.displayName, "AgentProfile.displayName");
  string(item.role, "AgentProfile.role");
  strings(item.responsibilities, "AgentProfile.responsibilities");
  strings(item.capabilityClaims, "AgentProfile.capabilityClaims");
  const constitution = record(item.constitution, "AgentProfile.constitution");
  allowedKeys(constitution, ["principles", "instructions"], "AgentProfile.constitution");
  strings(constitution.principles, "AgentProfile.constitution.principles");
  strings(constitution.instructions, "AgentProfile.constitution.instructions");
  const model = record(item.defaultModelPolicy, "AgentProfile.defaultModelPolicy");
  allowedKeys(model, ["mode", "provider", "model", "capabilityClass"], "AgentProfile.defaultModelPolicy");
  if (!new Set(["inherit", "local", "cloud"]).has(string(model.mode, "AgentProfile.defaultModelPolicy.mode"))) {
    fail("Invalid model policy mode", "AgentProfile.defaultModelPolicy.mode");
  }
  for (const key of ["provider", "model", "capabilityClass"] as const) {
    if (model[key] !== undefined) string(model[key], `AgentProfile.defaultModelPolicy.${key}`);
  }
  assertSafeSharedState(item, "AgentProfile");
  return item as unknown as AgentProfile;
}

export function validateProjectAgentBinding(value: unknown): ProjectAgentBinding {
  const item = record(value, "ProjectAgentBinding");
  allowedKeys(item, [
    "schemaVersion", "bindingId", "projectId", "projectContextFingerprint", "profileId", "profileRevision",
    "revision", "role", "enabled", "memoryScopes", "connectorGrantRefs", "createdAt", "createdBy", "updatedAt",
    "updatedBy", "previousRevision",
  ], "ProjectAgentBinding");
  versioned(item, "ProjectAgentBinding");
  const projectId = parseProjectId(item.projectId, "ProjectAgentBinding.projectId");
  const profileId = parseAgentProfileId(item.profileId, "ProjectAgentBinding.profileId");
  const bindingId = parseBindingId(item.bindingId, "ProjectAgentBinding.bindingId");
  if (bindingId !== bindingIdFor(projectId, profileId)) fail("Binding ID does not match Project/Profile identity", "ProjectAgentBinding.bindingId");
  digest(item.projectContextFingerprint, "ProjectAgentBinding.projectContextFingerprint");
  integer(item.profileRevision, "ProjectAgentBinding.profileRevision", 1);
  string(item.role, "ProjectAgentBinding.role");
  bool(item.enabled, "ProjectAgentBinding.enabled");
  const scopes = strings(item.memoryScopes, "ProjectAgentBinding.memoryScopes");
  for (const scope of scopes) if (!MEMORY_SCOPES.has(scope as MemoryScopeName)) fail("Invalid memory scope", "ProjectAgentBinding.memoryScopes");
  const grants = strings(item.connectorGrantRefs, "ProjectAgentBinding.connectorGrantRefs");
  for (const grant of grants) if (!GRANT_REF_RE.test(grant)) fail("Grant ref must use grant/<stable-id>", "ProjectAgentBinding.connectorGrantRefs");
  assertSafeSharedState(item, "ProjectAgentBinding");
  return item as unknown as ProjectAgentBinding;
}

export function validateThread(value: unknown): Thread {
  const item = record(value, "Thread");
  allowedKeys(item, [
    "schemaVersion", "threadId", "revision", "durability", "lifecycle", "projectId", "bindingId", "bindingRevision",
    "profileId", "profileRevision", "title", "references", "createdAt", "createdBy", "updatedAt", "updatedBy", "previousRevision",
  ], "Thread");
  versioned(item, "Thread");
  parseThreadId(item.threadId, "Thread.threadId");
  if (item.durability !== "durable") fail("Persisted Thread must be durable", "Thread.durability");
  if (!new Set(["open", "closed", "archived"]).has(string(item.lifecycle, "Thread.lifecycle"))) fail("Invalid Thread lifecycle", "Thread.lifecycle");
  const projectId = parseProjectId(item.projectId, "Thread.projectId");
  const profileId = parseAgentProfileId(item.profileId, "Thread.profileId");
  const bindingId = parseBindingId(item.bindingId, "Thread.bindingId");
  if (bindingId !== bindingIdFor(projectId, profileId)) fail("Thread binding does not match Project/Profile", "Thread.bindingId");
  integer(item.bindingRevision, "Thread.bindingRevision", 1);
  integer(item.profileRevision, "Thread.profileRevision", 1);
  string(item.title, "Thread.title");
  if (!Array.isArray(item.references)) fail("Expected array", "Thread.references");
  item.references.forEach((raw, index) => {
    const ref = record(raw, `Thread.references[${index}]`);
    allowedKeys(ref, ["ordinal", "kind", "referenceId", "recordedAt", "contentHash", "citations"], `Thread.references[${index}]`);
    if (integer(ref.ordinal, `Thread.references[${index}].ordinal`, 1) !== index + 1) fail("Thread reference ordinals must be contiguous", `Thread.references[${index}].ordinal`);
    const kind = string(ref.kind, `Thread.references[${index}].kind`);
    if (!new Set(["message", "artifact", "workRun"]).has(kind)) fail("Invalid Thread reference kind", `Thread.references[${index}].kind`);
    const referenceId = string(ref.referenceId, `Thread.references[${index}].referenceId`);
    if (kind === "artifact" && !ARTIFACT_ID_RE.test(referenceId)) fail("Artifact reference must use artifact/<stable-id>", `Thread.references[${index}].referenceId`);
    if (kind === "workRun" && !WORK_RUN_ID_RE.test(referenceId)) fail("Work Run reference must use work-run/<stable-id>", `Thread.references[${index}].referenceId`);
    iso(ref.recordedAt, `Thread.references[${index}].recordedAt`);
    if (ref.contentHash !== undefined) digest(ref.contentHash, `Thread.references[${index}].contentHash`);
    strings(ref.citations, `Thread.references[${index}].citations`);
  });
  assertSafeSharedState(item, "Thread");
  return item as unknown as Thread;
}

export function validateRoomIdentity(value: unknown): RoomIdentity {
  const item = record(value, "RoomIdentity");
  allowedKeys(item, ["schemaVersion", "projectId", "profileId", "profileRevision", "bindingId", "bindingRevision", "threadId", "threadRevision"], "RoomIdentity");
  if (item.schemaVersion !== 1) fail("Unsupported schemaVersion", "RoomIdentity.schemaVersion");
  const projectId = parseProjectId(item.projectId, "RoomIdentity.projectId");
  const profileId = parseAgentProfileId(item.profileId, "RoomIdentity.profileId");
  if (parseBindingId(item.bindingId, "RoomIdentity.bindingId") !== bindingIdFor(projectId, profileId)) fail("Room binding identity mismatch", "RoomIdentity.bindingId");
  integer(item.profileRevision, "RoomIdentity.profileRevision", 1);
  integer(item.bindingRevision, "RoomIdentity.bindingRevision", 1);
  parseThreadId(item.threadId, "RoomIdentity.threadId");
  integer(item.threadRevision, "RoomIdentity.threadRevision", 1);
  assertSafeSharedState(item, "RoomIdentity");
  return item as unknown as RoomIdentity;
}

export function validateRoomProjection(value: unknown): RoomProjection {
  const item = record(value, "RoomProjection");
  allowedKeys(item, ["schemaVersion", "identity", "readOnly", "lifecycle", "relatedWorkRunIds", "approvedMemory", "connectorSummaries", "diagnostics"], "RoomProjection");
  if (item.schemaVersion !== 1 || item.readOnly !== true) fail("Room projection must be schema v1 and read-only", "RoomProjection");
  validateRoomIdentity(item.identity);
  if (!new Set(["open", "closed", "archived"]).has(string(item.lifecycle, "RoomProjection.lifecycle"))) fail("Invalid lifecycle", "RoomProjection.lifecycle");
  for (const id of strings(item.relatedWorkRunIds, "RoomProjection.relatedWorkRunIds")) if (!WORK_RUN_ID_RE.test(id)) fail("Invalid Work Run ID", "RoomProjection.relatedWorkRunIds");
  if (item.approvedMemory !== null) {
    const memory = record(item.approvedMemory, "RoomProjection.approvedMemory");
    allowedKeys(memory, ["revisionId", "revision", "fingerprint"], "RoomProjection.approvedMemory");
    if (!REVISION_ID_RE.test(string(memory.revisionId, "RoomProjection.approvedMemory.revisionId"))) fail("Invalid revision ID", "RoomProjection.approvedMemory.revisionId");
    integer(memory.revision, "RoomProjection.approvedMemory.revision", 1);
    digest(memory.fingerprint, "RoomProjection.approvedMemory.fingerprint");
  }
  if (!Array.isArray(item.connectorSummaries) || !Array.isArray(item.diagnostics)) fail("Room projections require connector and diagnostic arrays", "RoomProjection");
  item.connectorSummaries.forEach((raw, index) => {
    const connector = record(raw, `RoomProjection.connectorSummaries[${index}]`);
    allowedKeys(connector, ["connectorId", "status", "grantRef", "remediationKey"], `RoomProjection.connectorSummaries[${index}]`);
    string(connector.connectorId, `RoomProjection.connectorSummaries[${index}].connectorId`);
    if (!new Set(["available", "degraded", "unavailable", "disabled"]).has(string(connector.status, `RoomProjection.connectorSummaries[${index}].status`))) fail("Invalid connector status", `RoomProjection.connectorSummaries[${index}].status`);
    if (connector.grantRef !== undefined && !GRANT_REF_RE.test(string(connector.grantRef, `RoomProjection.connectorSummaries[${index}].grantRef`))) fail("Invalid grant reference", `RoomProjection.connectorSummaries[${index}].grantRef`);
    if (connector.remediationKey !== undefined) string(connector.remediationKey, `RoomProjection.connectorSummaries[${index}].remediationKey`);
  });
  item.diagnostics.forEach((raw, index) => {
    const diagnostic = record(raw, `RoomProjection.diagnostics[${index}]`);
    allowedKeys(diagnostic, ["code", "severity", "remediationKey"], `RoomProjection.diagnostics[${index}]`);
    string(diagnostic.code, `RoomProjection.diagnostics[${index}].code`);
    if (!new Set(["info", "warning", "error"]).has(string(diagnostic.severity, `RoomProjection.diagnostics[${index}].severity`))) fail("Invalid diagnostic severity", `RoomProjection.diagnostics[${index}].severity`);
    if (diagnostic.remediationKey !== undefined) string(diagnostic.remediationKey, `RoomProjection.diagnostics[${index}].remediationKey`);
  });
  const connectorIds = item.connectorSummaries.map((raw) => (raw as Record<string, unknown>).connectorId);
  if (new Set(connectorIds).size !== connectorIds.length) fail("Duplicate connector summaries are not allowed", "RoomProjection.connectorSummaries");
  assertSafeSharedState(item, "RoomProjection");
  return item as unknown as RoomProjection;
}

export function memorySectionHash(section: Pick<MemorySection, "content" | "citations">): string {
  return canonicalDigest({ content: section.content, citations: section.citations });
}

export function makeMemorySection(content = "", citations: string[] = []): MemorySection {
  const material = { content, citations: [...citations] };
  return { ...material, contentHash: memorySectionHash(material) };
}

function validateMemorySection(value: unknown, path: string): MemorySection {
  const item = record(value, path);
  allowedKeys(item, ["content", "citations", "contentHash"], path);
  // Memory contents are byte-preserving governed state. Whitespace is data.
  const content = exactString(item.content, `${path}.content`);
  const citations = strings(item.citations, `${path}.citations`);
  const contentHash = digest(item.contentHash, `${path}.contentHash`);
  if (contentHash !== memorySectionHash({ content, citations })) fail("Memory section content hash mismatch", `${path}.contentHash`);
  return item as unknown as MemorySection;
}

function validateDirective(value: unknown, path: string): ProtectedDirective {
  const item = record(value, path);
  allowedKeys(item, ["directiveId", "kind", "section", "contentHash", "retainUntil", "reason"], path);
  string(item.directiveId, `${path}.directiveId`);
  const kind = string(item.kind, `${path}.kind`);
  if (!new Set(["must-keep", "protected", "retain-until"]).has(kind)) fail("Invalid protected directive kind", `${path}.kind`);
  const section = string(item.section, `${path}.section`) as MemoryScopeName;
  if (!MEMORY_SCOPES.has(section)) fail("Invalid directive section", `${path}.section`);
  if (item.contentHash !== undefined) digest(item.contentHash, `${path}.contentHash`);
  if (kind !== "retain-until" && item.retainUntil !== undefined) fail("retainUntil is valid only for retain-until", `${path}.retainUntil`);
  if (kind === "retain-until") iso(item.retainUntil, `${path}.retainUntil`);
  string(item.reason, `${path}.reason`);
  return item as unknown as ProtectedDirective;
}

function validateConflict(value: unknown, path: string): MemoryConflict {
  const item = record(value, path);
  allowedKeys(item, ["conflictId", "section", "reason", "sourceRefs", "resolved"], path);
  string(item.conflictId, `${path}.conflictId`);
  const section = string(item.section, `${path}.section`) as MemoryScopeName;
  if (!MEMORY_SCOPES.has(section)) fail("Invalid conflict section", `${path}.section`);
  string(item.reason, `${path}.reason`);
  strings(item.sourceRefs, `${path}.sourceRefs`);
  if (item.resolved !== false) fail("Only unresolved conflicts belong in governed memory", `${path}.resolved`);
  return item as unknown as MemoryConflict;
}

function validateCandidateDiff(value: unknown, path: string): CandidateDiff {
  const item = record(value, path);
  allowedKeys(item, ["operation", "section", "beforeHash", "after"], path);
  const operation = string(item.operation, `${path}.operation`);
  if (!new Set(["replace", "remove"]).has(operation)) fail("Invalid candidate diff operation", `${path}.operation`);
  const section = string(item.section, `${path}.section`) as MemoryScopeName;
  if (!MEMORY_SCOPES.has(section)) fail("Invalid candidate diff section", `${path}.section`);
  if (item.beforeHash !== null) digest(item.beforeHash, `${path}.beforeHash`);
  if (operation === "remove" && item.after !== null) fail("Remove diff must have null after", `${path}.after`);
  if (operation === "replace" && item.after === null) fail("Replace diff requires an after section", `${path}.after`);
  if (item.after !== null) validateMemorySection(item.after, `${path}.after`);
  return item as unknown as CandidateDiff;
}

export function proposalFingerprintMaterial(proposal: Omit<MemoryProposal, "fingerprint"> | MemoryProposal): Record<string, unknown> {
  const { fingerprint: _fingerprint, ...material } = proposal as MemoryProposal;
  return material;
}

export function validateMemoryProposal(value: unknown): MemoryProposal {
  const item = record(value, "MemoryProposal");
  allowedKeys(item, [
    "schemaVersion", "proposalId", "lifecycle", "operation", "projectId", "profileId", "sourceIdentities", "expectedRevision",
    "sourceFingerprint", "candidateDiff", "protectedDirectives", "unresolvedConflicts", "provenance", "warnings", "modelLock",
    "approvalPolicy", "createdAt", "createdBy", "expiresAt", "fingerprint",
  ], "MemoryProposal");
  if (item.schemaVersion !== 1 || item.lifecycle !== "proposed") fail("Memory Proposal must be schema v1 and proposed", "MemoryProposal");
  if (!PROPOSAL_ID_RE.test(string(item.proposalId, "MemoryProposal.proposalId"))) fail("Invalid proposal ID", "MemoryProposal.proposalId");
  const operation = string(item.operation, "MemoryProposal.operation");
  if (!new Set(["checkpoint", "learn", "review"]).has(operation)) fail("Invalid Dream Time operation", "MemoryProposal.operation");
  parseProjectId(item.projectId, "MemoryProposal.projectId");
  parseAgentProfileId(item.profileId, "MemoryProposal.profileId");
  const source = record(item.sourceIdentities, "MemoryProposal.sourceIdentities");
  allowedKeys(source, ["threadId", "workRunId", "revisionIds", "artifactIds", "cutoffAt"], "MemoryProposal.sourceIdentities");
  if (source.threadId !== undefined) parseThreadId(source.threadId, "MemoryProposal.sourceIdentities.threadId");
  if (source.workRunId !== undefined && !WORK_RUN_ID_RE.test(string(source.workRunId, "MemoryProposal.sourceIdentities.workRunId"))) fail("Invalid Work Run ID", "MemoryProposal.sourceIdentities.workRunId");
  const revisionIds = strings(source.revisionIds, "MemoryProposal.sourceIdentities.revisionIds");
  revisionIds.forEach((id) => { if (!REVISION_ID_RE.test(id)) fail("Invalid Memory Revision ID", "MemoryProposal.sourceIdentities.revisionIds"); });
  const artifactIds = strings(source.artifactIds, "MemoryProposal.sourceIdentities.artifactIds");
  artifactIds.forEach((id) => { if (!ARTIFACT_ID_RE.test(id)) fail("Invalid Artifact ID", "MemoryProposal.sourceIdentities.artifactIds"); });
  if (!source.threadId && !source.workRunId && revisionIds.length === 0 && artifactIds.length === 0) fail("Proposal requires at least one source identity", "MemoryProposal.sourceIdentities");
  iso(source.cutoffAt, "MemoryProposal.sourceIdentities.cutoffAt");
  const expected = record(item.expectedRevision, "MemoryProposal.expectedRevision");
  allowedKeys(expected, ["revisionId", "revision", "fingerprint"], "MemoryProposal.expectedRevision");
  const expectedNumber = integer(expected.revision, "MemoryProposal.expectedRevision.revision", 0);
  if (expectedNumber === 0) {
    if (expected.revisionId !== null || expected.fingerprint !== null) fail("Revision zero must use null identity and fingerprint", "MemoryProposal.expectedRevision");
  } else {
    if (!REVISION_ID_RE.test(string(expected.revisionId, "MemoryProposal.expectedRevision.revisionId"))) fail("Invalid expected revision ID", "MemoryProposal.expectedRevision.revisionId");
    digest(expected.fingerprint, "MemoryProposal.expectedRevision.fingerprint");
  }
  digest(item.sourceFingerprint, "MemoryProposal.sourceFingerprint");
  if (!Array.isArray(item.candidateDiff) || item.candidateDiff.length === 0) fail("Candidate diff must be non-empty", "MemoryProposal.candidateDiff");
  const diffs = item.candidateDiff.map((diff, index) => validateCandidateDiff(diff, `MemoryProposal.candidateDiff[${index}]`));
  if (new Set(diffs.map((diff) => diff.section)).size !== diffs.length) fail("A proposal may mutate each section at most once", "MemoryProposal.candidateDiff");
  const allowedSections = operation === "checkpoint" ? new Set(["recentContext", "openItems"]) : new Set(["stableMemory"]);
  for (const diff of diffs) if (!allowedSections.has(diff.section)) fail(`${operation} cannot mutate ${diff.section}`, "MemoryProposal.candidateDiff");
  if ((operation === "learn" || operation === "review") && diffs.some((diff) => diff.after && diff.after.citations.length === 0)) {
    fail(`${operation} changes require citations`, "MemoryProposal.candidateDiff");
  }
  if (!Array.isArray(item.protectedDirectives) || !Array.isArray(item.unresolvedConflicts) || !Array.isArray(item.provenance) || !Array.isArray(item.warnings)) {
    fail("Proposal governance collections must be arrays", "MemoryProposal");
  }
  const directives = item.protectedDirectives.map((directive, index) => validateDirective(directive, `MemoryProposal.protectedDirectives[${index}]`));
  const conflicts = item.unresolvedConflicts.map((conflict, index) => validateConflict(conflict, `MemoryProposal.unresolvedConflicts[${index}]`));
  if (new Set(directives.map((directive) => directive.directiveId)).size !== directives.length) fail("Duplicate protected directive IDs", "MemoryProposal.protectedDirectives");
  if (new Set(conflicts.map((conflict) => conflict.conflictId)).size !== conflicts.length) fail("Duplicate conflict IDs", "MemoryProposal.unresolvedConflicts");
  item.provenance.forEach((provenance, index) => validateProvenance(provenance, `MemoryProposal.provenance[${index}]`));
  item.warnings.forEach((warning, index) => validateWarning(warning, `MemoryProposal.warnings[${index}]`));
  validateModelLock(item.modelLock, "MemoryProposal.modelLock");
  const policy = record(item.approvalPolicy, "MemoryProposal.approvalPolicy");
  allowedKeys(policy, ["mode", "autoApprovalHook"], "MemoryProposal.approvalPolicy");
  const hook = record(policy.autoApprovalHook, "MemoryProposal.approvalPolicy.autoApprovalHook");
  allowedKeys(hook, ["enabled", "warningFreeOnly", "workingMemoryOnly"], "MemoryProposal.approvalPolicy.autoApprovalHook");
  if (policy.mode !== "manual" || hook.enabled !== false || hook.warningFreeOnly !== true || hook.workingMemoryOnly !== true) {
    fail("Dream Time approval policy must default to manual with disabled safe hook", "MemoryProposal.approvalPolicy");
  }
  const createdAt = iso(item.createdAt, "MemoryProposal.createdAt");
  iso(item.expiresAt, "MemoryProposal.expiresAt");
  if (Date.parse(item.expiresAt as string) <= Date.parse(createdAt)) fail("Proposal expiry must follow creation", "MemoryProposal.expiresAt");
  string(item.createdBy, "MemoryProposal.createdBy");
  const fingerprint = digest(item.fingerprint, "MemoryProposal.fingerprint");
  if (fingerprint !== canonicalDigest(proposalFingerprintMaterial(item as unknown as MemoryProposal))) fail("Proposal fingerprint mismatch", "MemoryProposal.fingerprint");
  assertSafeSharedState(item, "MemoryProposal");
  return item as unknown as MemoryProposal;
}

export function revisionFingerprintMaterial(revision: Omit<MemoryRevision, "fingerprint"> | MemoryRevision): Record<string, unknown> {
  const { fingerprint: _fingerprint, ...material } = revision as MemoryRevision;
  return material;
}

export function validateMemoryRevision(value: unknown): MemoryRevision {
  const item = record(value, "MemoryRevision");
  allowedKeys(item, [
    "schemaVersion", "revisionId", "revision", "previousRevisionId", "previousFingerprint", "projectId", "profileId", "lifecycle",
    "sections", "protectedDirectives", "unresolvedConflicts", "exactDiff", "provenance", "approval", "createdAt", "fingerprint",
  ], "MemoryRevision");
  if (item.schemaVersion !== 1 || item.lifecycle !== "approved") fail("Memory Revision must be approved schema v1", "MemoryRevision");
  if (!REVISION_ID_RE.test(string(item.revisionId, "MemoryRevision.revisionId"))) fail("Invalid revision ID", "MemoryRevision.revisionId");
  const number = integer(item.revision, "MemoryRevision.revision", 1);
  if (number === 1) {
    if (item.previousRevisionId !== null || item.previousFingerprint !== null) fail("First revision must have null predecessor", "MemoryRevision");
  } else {
    if (!REVISION_ID_RE.test(string(item.previousRevisionId, "MemoryRevision.previousRevisionId"))) fail("Invalid predecessor ID", "MemoryRevision.previousRevisionId");
    digest(item.previousFingerprint, "MemoryRevision.previousFingerprint");
  }
  parseProjectId(item.projectId, "MemoryRevision.projectId");
  parseAgentProfileId(item.profileId, "MemoryRevision.profileId");
  const sections = record(item.sections, "MemoryRevision.sections");
  allowedKeys(sections, ["recentContext", "openItems", "stableMemory"], "MemoryRevision.sections");
  for (const name of MEMORY_SCOPES) validateMemorySection(sections[name], `MemoryRevision.sections.${name}`);
  if (!Array.isArray(item.protectedDirectives) || !Array.isArray(item.unresolvedConflicts) || !Array.isArray(item.exactDiff) || !Array.isArray(item.provenance)) fail("Revision governance collections must be arrays", "MemoryRevision");
  const directives = item.protectedDirectives.map((directive, index) => validateDirective(directive, `MemoryRevision.protectedDirectives[${index}]`));
  const conflicts = item.unresolvedConflicts.map((conflict, index) => validateConflict(conflict, `MemoryRevision.unresolvedConflicts[${index}]`));
  if (new Set(directives.map((directive) => directive.directiveId)).size !== directives.length) fail("Duplicate protected directive IDs", "MemoryRevision.protectedDirectives");
  if (new Set(conflicts.map((conflict) => conflict.conflictId)).size !== conflicts.length) fail("Duplicate conflict IDs", "MemoryRevision.unresolvedConflicts");
  item.exactDiff.forEach((diff, index) => validateCandidateDiff(diff, `MemoryRevision.exactDiff[${index}]`));
  item.provenance.forEach((provenance, index) => validateProvenance(provenance, `MemoryRevision.provenance[${index}]`));
  const approval = record(item.approval, "MemoryRevision.approval");
  allowedKeys(approval, ["proposalId", "transitionTokenHash", "actor", "policyVersion", "policyResult"], "MemoryRevision.approval");
  if (!PROPOSAL_ID_RE.test(string(approval.proposalId, "MemoryRevision.approval.proposalId"))) fail("Invalid proposal ID", "MemoryRevision.approval.proposalId");
  digest(approval.transitionTokenHash, "MemoryRevision.approval.transitionTokenHash");
  string(approval.actor, "MemoryRevision.approval.actor");
  string(approval.policyVersion, "MemoryRevision.approval.policyVersion");
  if (approval.policyResult !== "allowed") fail("Approved revision requires allowed policy", "MemoryRevision.approval.policyResult");
  iso(item.createdAt, "MemoryRevision.createdAt");
  const fingerprint = digest(item.fingerprint, "MemoryRevision.fingerprint");
  if (fingerprint !== canonicalDigest(revisionFingerprintMaterial(item as unknown as MemoryRevision))) fail("Revision fingerprint mismatch", "MemoryRevision.fingerprint");
  assertSafeSharedState(item, "MemoryRevision");
  return item as unknown as MemoryRevision;
}

export function validateMemoryEvent(value: unknown): MemoryEvent {
  const item = record(value, "MemoryEvent");
  allowedKeys(item, ["schemaVersion", "eventId", "ordinal", "transitionAction", "action", "proposalId", "revisionId", "transitionTokenHash", "actor", "occurredAt", "exactDiff", "provenance", "policyResult"], "MemoryEvent");
  if (item.schemaVersion !== 1 || !EVENT_ID_RE.test(string(item.eventId, "MemoryEvent.eventId"))) fail("Invalid Memory Event identity", "MemoryEvent");
  integer(item.ordinal, "MemoryEvent.ordinal", 1);
  if (!new Set(["approve", "reject"]).has(string(item.transitionAction, "MemoryEvent.transitionAction"))) fail("Invalid Memory Event transition action", "MemoryEvent.transitionAction");
  const action = string(item.action, "MemoryEvent.action");
  if (!new Set(["approved", "rejected", "stale", "expired"]).has(action)) fail("Invalid Memory Event action", "MemoryEvent.action");
  if ((action === "approved" && item.transitionAction !== "approve") || (action === "rejected" && item.transitionAction !== "reject")) fail("Memory Event action conflicts with transition action", "MemoryEvent.action");
  if (!PROPOSAL_ID_RE.test(string(item.proposalId, "MemoryEvent.proposalId"))) fail("Invalid proposal ID", "MemoryEvent.proposalId");
  if (item.revisionId !== null && !REVISION_ID_RE.test(string(item.revisionId, "MemoryEvent.revisionId"))) fail("Invalid revision ID", "MemoryEvent.revisionId");
  digest(item.transitionTokenHash, "MemoryEvent.transitionTokenHash");
  string(item.actor, "MemoryEvent.actor");
  iso(item.occurredAt, "MemoryEvent.occurredAt");
  if (!Array.isArray(item.exactDiff) || !Array.isArray(item.provenance)) fail("Event diff/provenance must be arrays", "MemoryEvent");
  item.exactDiff.forEach((diff, index) => validateCandidateDiff(diff, `MemoryEvent.exactDiff[${index}]`));
  item.provenance.forEach((provenance, index) => validateProvenance(provenance, `MemoryEvent.provenance[${index}]`));
  const policy = record(item.policyResult, "MemoryEvent.policyResult");
  allowedKeys(policy, ["allowed", "policyVersion", "reason"], "MemoryEvent.policyResult");
  bool(policy.allowed, "MemoryEvent.policyResult.allowed");
  string(policy.policyVersion, "MemoryEvent.policyResult.policyVersion");
  string(policy.reason, "MemoryEvent.policyResult.reason");
  assertSafeSharedState(item, "MemoryEvent");
  return item as unknown as MemoryEvent;
}

export function validateApprovalDecision(value: unknown): ApprovalDecision {
  const item = record(value, "ApprovalDecision");
  allowedKeys(item, ["schemaVersion", "decisionId", "proposalId", "transitionAction", "state", "revisionId", "transitionTokenHash", "actor", "decidedAt", "proposalFingerprint", "policyVersion", "reason"], "ApprovalDecision");
  if (item.schemaVersion !== 1) fail("Unsupported decision schema", "ApprovalDecision.schemaVersion");
  string(item.decisionId, "ApprovalDecision.decisionId");
  if (!PROPOSAL_ID_RE.test(string(item.proposalId, "ApprovalDecision.proposalId"))) fail("Invalid proposal ID", "ApprovalDecision.proposalId");
  if (!new Set(["approve", "reject"]).has(string(item.transitionAction, "ApprovalDecision.transitionAction"))) fail("Invalid decision transition action", "ApprovalDecision.transitionAction");
  const state = string(item.state, "ApprovalDecision.state");
  if (!new Set(["approved", "rejected", "stale", "expired"]).has(state)) fail("Invalid decision state", "ApprovalDecision.state");
  if ((state === "approved" && item.transitionAction !== "approve") || (state === "rejected" && item.transitionAction !== "reject")) fail("Decision state conflicts with transition action", "ApprovalDecision.state");
  if (item.revisionId !== null && !REVISION_ID_RE.test(string(item.revisionId, "ApprovalDecision.revisionId"))) fail("Invalid revision ID", "ApprovalDecision.revisionId");
  digest(item.transitionTokenHash, "ApprovalDecision.transitionTokenHash");
  string(item.actor, "ApprovalDecision.actor");
  iso(item.decidedAt, "ApprovalDecision.decidedAt");
  digest(item.proposalFingerprint, "ApprovalDecision.proposalFingerprint");
  string(item.policyVersion, "ApprovalDecision.policyVersion");
  string(item.reason, "ApprovalDecision.reason");
  assertSafeSharedState(item, "ApprovalDecision");
  return item as unknown as ApprovalDecision;
}

export function validateContextChunk(value: unknown, path = "ContextChunk"): ContextChunk {
  const item = record(value, path);
  allowedKeys(item, ["chunkId", "content", "provenance", "mandatory", "priority", "tokenCount", "contentHash"], path);
  string(item.chunkId, `${path}.chunkId`);
  if (!Array.isArray(item.provenance)) fail("Expected provenance array", `${path}.provenance`);
  item.provenance.forEach((provenance, index) => validateProvenance(provenance, `${path}.provenance[${index}]`));
  bool(item.mandatory, `${path}.mandatory`);
  integer(item.priority, `${path}.priority`, 0);
  integer(item.tokenCount, `${path}.tokenCount`, 1);
  const hash = digest(item.contentHash, `${path}.contentHash`);
  if (hash !== canonicalDigest(item.content)) fail("Context chunk content hash mismatch", `${path}.contentHash`);
  assertSafeSharedState(item.content, `${path}.content`);
  return item as unknown as ContextChunk;
}

function validateContextLayer(value: unknown, path: string): ContextLayer {
  const item = record(value, path);
  allowedKeys(item, ["name", "provenance", "chunks", "tokenCount", "contentHash"], path);
  const name = string(item.name, `${path}.name`);
  if (!new Set(["platformKernel", "agentConstitution", "governedWorkingMemory", "runtimeEnvelope"]).has(name)) fail("Invalid context layer", `${path}.name`);
  if (!Array.isArray(item.provenance) || !Array.isArray(item.chunks)) fail("Layer provenance/chunks must be arrays", path);
  item.provenance.forEach((provenance, index) => validateProvenance(provenance, `${path}.provenance[${index}]`));
  const chunks = item.chunks.map((chunk, index) => validateContextChunk(chunk, `${path}.chunks[${index}]`));
  const tokenCount = integer(item.tokenCount, `${path}.tokenCount`, 0);
  if (tokenCount !== chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0)) fail("Layer token count mismatch", `${path}.tokenCount`);
  const hash = digest(item.contentHash, `${path}.contentHash`);
  if (hash !== canonicalDigest(chunks)) fail("Layer content hash mismatch", `${path}.contentHash`);
  return item as unknown as ContextLayer;
}

export function envelopeFingerprintMaterial(envelope: Omit<ContextEnvelope, "fingerprint"> | ContextEnvelope): Record<string, unknown> {
  const { fingerprint: _fingerprint, ...material } = envelope as ContextEnvelope;
  return material;
}

export function validateContextEnvelope(value: unknown): ContextEnvelope {
  const item = record(value, "ContextEnvelope");
  allowedKeys(item, ["schemaVersion", "envelopeId", "compiledAt", "modelLock", "tokenEstimator", "tokenBudget", "tokenCount", "layers", "omissions", "fingerprint"], "ContextEnvelope");
  if (item.schemaVersion !== 1) fail("Unsupported Context Envelope schema", "ContextEnvelope.schemaVersion");
  string(item.envelopeId, "ContextEnvelope.envelopeId");
  iso(item.compiledAt, "ContextEnvelope.compiledAt");
  const modelLock = validateModelLock(item.modelLock, "ContextEnvelope.modelLock");
  if (item.tokenEstimator !== "utf8-bytes-div4/v1") fail("Unsupported token estimator", "ContextEnvelope.tokenEstimator");
  const budget = integer(item.tokenBudget, "ContextEnvelope.tokenBudget", 1);
  if (budget > modelLock.contextWindow) fail("Context token budget exceeds locked model context window", "ContextEnvelope.tokenBudget");
  const count = integer(item.tokenCount, "ContextEnvelope.tokenCount", 0);
  if (!Array.isArray(item.layers) || item.layers.length !== 4) fail("Context Envelope requires exactly four layers", "ContextEnvelope.layers");
  const layers = item.layers.map((layer, index) => validateContextLayer(layer, `ContextEnvelope.layers[${index}]`));
  const names = layers.map((layer) => layer.name);
  if (names.join(",") !== "platformKernel,agentConstitution,governedWorkingMemory,runtimeEnvelope") fail("Context layers are out of canonical order", "ContextEnvelope.layers");
  if (count !== layers.reduce((sum, layer) => sum + layer.tokenCount, 0) || count > budget) fail("Envelope token accounting mismatch", "ContextEnvelope.tokenCount");
  if (!Array.isArray(item.omissions)) fail("Context omissions must be an array", "ContextEnvelope.omissions");
  const includedChunkIds = layers.flatMap((layer) => layer.chunks.map((chunk) => chunk.chunkId));
  if (new Set(includedChunkIds).size !== includedChunkIds.length) fail("Context chunk IDs must be globally unique", "ContextEnvelope.layers");
  const omittedChunkIds: string[] = [];
  item.omissions.forEach((raw, index) => {
    const omission = record(raw, `ContextEnvelope.omissions[${index}]`);
    allowedKeys(omission, ["layer", "chunkId", "reason", "tokenCount", "mandatory"], `ContextEnvelope.omissions[${index}]`);
    if (!new Set(["platformKernel", "agentConstitution", "governedWorkingMemory", "runtimeEnvelope"]).has(string(omission.layer, `ContextEnvelope.omissions[${index}].layer`))) fail("Invalid omission layer", `ContextEnvelope.omissions[${index}].layer`);
    string(omission.chunkId, `ContextEnvelope.omissions[${index}].chunkId`);
    omittedChunkIds.push(omission.chunkId as string);
    if (includedChunkIds.includes(omission.chunkId as string)) fail("Omitted context chunk is still present", `ContextEnvelope.omissions[${index}].chunkId`);
    integer(omission.tokenCount, `ContextEnvelope.omissions[${index}].tokenCount`, 1);
    if (omission.reason !== "token-budget" || omission.mandatory !== false) fail("Invalid context omission", `ContextEnvelope.omissions[${index}]`);
  });
  if (new Set(omittedChunkIds).size !== omittedChunkIds.length) fail("Duplicate context omissions are not allowed", "ContextEnvelope.omissions");
  const fingerprint = digest(item.fingerprint, "ContextEnvelope.fingerprint");
  if (fingerprint !== canonicalDigest(envelopeFingerprintMaterial(item as unknown as ContextEnvelope))) fail("Context Envelope fingerprint mismatch", "ContextEnvelope.fingerprint");
  assertSafeSharedState(item, "ContextEnvelope");
  return item as unknown as ContextEnvelope;
}
