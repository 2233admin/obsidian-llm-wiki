import { canonicalDigest } from "./canonical.js";
import { DomainValidationError } from "./errors.js";
import { assertSafeSharedState } from "./security.js";
import type {
  ArtifactProjection,
  AssignmentInputContract,
  CapabilityGrant,
  CapabilityScope,
  CapabilityUseDecision,
  CapabilityUseRequest,
  ChildWorkRun,
  ContextConsultRequest,
  ContextConsultResult,
  DelegationPlan,
  OperationWriteReview,
  OperationTarget,
  PromotionReview,
  RunOutputClass,
  SideEffectClass,
} from "./collaboration-types.js";

const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const PROFILE_ID_RE = /^agent\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const PROJECT_ID_RE = /^project\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const WORK_RUN_ID_RE = /^work-run\/[a-z0-9][a-z0-9-]*$/;
const BINDING_ID_RE = /^binding\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const GRANT_ID_RE = /^grant\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ARTIFACT_ID_RE = /^artifact\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PROJECTION_ID_RE = /^artifact-projection\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CONSULT_REQUEST_ID_RE = /^context-consult\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CONSULT_RESULT_ID_RE = /^context-consult-result\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PLAN_ID_RE = /^delegation-plan\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ASSIGNMENT_ID_RE = /^assignment-plan\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DEVICE_SNAPSHOT_ID_RE = /^device-snapshot\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const SIDE_EFFECT_CLASSES = new Set<SideEffectClass>([
  "read-only",
  "local-write",
  "external-write",
  "external-delete",
  "external-execute",
]);

const OUTPUT_CLASSES = new Set<RunOutputClass>([
  "run-output",
  "durable-knowledge-candidate",
  "decision-candidate",
  "architecture-candidate",
  "runbook-candidate",
  "external-operation-result",
  "diagnostic",
]);

const DURABLE_OUTPUT_CLASSES = new Set<RunOutputClass>([
  "durable-knowledge-candidate",
  "decision-candidate",
  "architecture-candidate",
  "runbook-candidate",
]);

const EXTERNAL_SIDE_EFFECTS = new Set<SideEffectClass>([
  "external-write",
  "external-delete",
  "external-execute",
]);

function fail(message: string, path?: string): never {
  throw new DomainValidationError(message, path);
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value || value !== value.trim()) fail("Expected non-empty trimmed string", path);
  return value;
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (!Number.isInteger(value) || (value as number) < minimum) fail(`Expected integer >= ${minimum}`, path);
  return value as number;
}

function iso(value: unknown, path: string): string {
  const parsed = text(value, path);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(parsed) || Number.isNaN(Date.parse(parsed))) {
    fail("Expected UTC ISO-8601 timestamp", path);
  }
  return parsed;
}

function digest(value: unknown, path: string): string {
  const parsed = text(value, path);
  if (!DIGEST_RE.test(parsed)) fail("Expected sha256 digest", path);
  return parsed;
}

function id(value: unknown, pattern: RegExp, path: string): string {
  const parsed = text(value, path);
  if (!pattern.test(parsed)) fail("Invalid stable identity", path);
  return parsed;
}

function uniqueStrings(value: unknown, path: string, allowEmpty = true): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) fail("Expected array", path);
  const parsed = value.map((item, index) => text(item, `${path}[${index}]`));
  if (new Set(parsed).size !== parsed.length) fail("Duplicate values are not allowed", path);
  return parsed;
}

function validateTimestampOrder(earlier: string, later: string, path: string): void {
  if (Date.parse(later) <= Date.parse(earlier)) fail("Expiry must be later than creation", path);
}

function validateScope(scope: CapabilityScope, path: string): void {
  uniqueStrings(scope.connectors, `${path}.connectors`);
  uniqueStrings(scope.operations, `${path}.operations`);
  uniqueStrings(scope.resources, `${path}.resources`);
  if (!Array.isArray(scope.sideEffectClasses)) fail("Expected array", `${path}.sideEffectClasses`);
  for (const [index, effect] of scope.sideEffectClasses.entries()) {
    if (!SIDE_EFFECT_CLASSES.has(effect)) fail("Unknown side-effect class", `${path}.sideEffectClasses[${index}]`);
  }
  if (new Set(scope.sideEffectClasses).size !== scope.sideEffectClasses.length) fail("Duplicate values are not allowed", `${path}.sideEffectClasses`);
}

function validateAssignment(assignment: AssignmentInputContract, path: string): void {
  id(assignment.assignmentPlanId, ASSIGNMENT_ID_RE, `${path}.assignmentPlanId`);
  integer(assignment.assignmentPlanVersion, `${path}.assignmentPlanVersion`, 1);
  digest(assignment.assignmentPlanFingerprint, `${path}.assignmentPlanFingerprint`);
  id(assignment.deviceSnapshot.snapshotId, DEVICE_SNAPSHOT_ID_RE, `${path}.deviceSnapshot.snapshotId`);
  text(assignment.deviceSnapshot.deviceId, `${path}.deviceSnapshot.deviceId`);
  integer(assignment.deviceSnapshot.revision, `${path}.deviceSnapshot.revision`, 1);
  digest(assignment.deviceSnapshot.fingerprint, `${path}.deviceSnapshot.fingerprint`);
  const capturedAt = iso(assignment.deviceSnapshot.capturedAt, `${path}.deviceSnapshot.capturedAt`);
  const expiresAt = iso(assignment.deviceSnapshot.expiresAt, `${path}.deviceSnapshot.expiresAt`);
  validateTimestampOrder(capturedAt, expiresAt, `${path}.deviceSnapshot.expiresAt`);
  id(assignment.profileId, PROFILE_ID_RE, `${path}.profileId`);
  integer(assignment.profileRevision, `${path}.profileRevision`, 1);
  id(assignment.bindingId, BINDING_ID_RE, `${path}.bindingId`);
  integer(assignment.bindingRevision, `${path}.bindingRevision`, 1);
  digest(assignment.contextEnvelopeFingerprint, `${path}.contextEnvelopeFingerprint`);
}

export function capabilityGrantFingerprintMaterial(grant: CapabilityGrant): Omit<CapabilityGrant, "fingerprint"> {
  const { fingerprint: _fingerprint, ...material } = grant;
  return material;
}

export function artifactProjectionFingerprintMaterial(artifact: ArtifactProjection): Omit<ArtifactProjection, "fingerprint"> {
  const { fingerprint: _fingerprint, ...material } = artifact;
  return material;
}

export function contextConsultRequestFingerprintMaterial(request: ContextConsultRequest): Omit<ContextConsultRequest, "fingerprint"> {
  const { fingerprint: _fingerprint, ...material } = request;
  return material;
}

export function contextConsultResultFingerprintMaterial(result: ContextConsultResult): Omit<ContextConsultResult, "fingerprint"> {
  const { fingerprint: _fingerprint, ...material } = result;
  return material;
}

export function delegationPlanFingerprintMaterial(plan: DelegationPlan): Omit<DelegationPlan, "fingerprint"> {
  const { fingerprint: _fingerprint, ...material } = plan;
  return material;
}

export function childWorkRunFingerprintMaterial(child: ChildWorkRun): Omit<ChildWorkRun, "fingerprint"> {
  const { fingerprint: _fingerprint, ...material } = child;
  return material;
}

export function validateCapabilityGrant(value: CapabilityGrant): CapabilityGrant {
  assertSafeSharedState(value, "CapabilityGrant");
  if (value.schemaVersion !== 1) fail("Unsupported schemaVersion", "CapabilityGrant.schemaVersion");
  id(value.grantId, GRANT_ID_RE, "CapabilityGrant.grantId");
  id(value.projectId, PROJECT_ID_RE, "CapabilityGrant.projectId");
  id(value.profileId, PROFILE_ID_RE, "CapabilityGrant.profileId");
  integer(value.profileRevision, "CapabilityGrant.profileRevision", 1);
  id(value.workRunId, WORK_RUN_ID_RE, "CapabilityGrant.workRunId");
  if (value.delegationPlanId !== undefined) id(value.delegationPlanId, PLAN_ID_RE, "CapabilityGrant.delegationPlanId");
  validateScope(value.scope, "CapabilityGrant.scope");
  const issuedAt = iso(value.issuedAt, "CapabilityGrant.issuedAt");
  const expiresAt = iso(value.expiresAt, "CapabilityGrant.expiresAt");
  validateTimestampOrder(issuedAt, expiresAt, "CapabilityGrant.expiresAt");
  text(value.issuedBy, "CapabilityGrant.issuedBy");
  if (value.policyDecision.allowed !== true) fail("Only an allowed policy decision can issue a grant", "CapabilityGrant.policyDecision.allowed");
  text(value.policyDecision.policyVersion, "CapabilityGrant.policyDecision.policyVersion");
  text(value.policyDecision.reason, "CapabilityGrant.policyDecision.reason");
  iso(value.policyDecision.decidedAt, "CapabilityGrant.policyDecision.decidedAt");
  text(value.policyDecision.actor, "CapabilityGrant.policyDecision.actor");
  const external = value.scope.sideEffectClasses.filter((effect) => EXTERNAL_SIDE_EFFECTS.has(effect));
  if (external.length > 0) {
    if (value.externalSideEffectApproval.mode !== "per-run"
      || value.externalSideEffectApproval.approvedWorkRunId !== value.workRunId
      || !value.externalSideEffectApproval.approvalFingerprint) {
      fail("External effects require an explicit per-run approval bound to this Work Run", "CapabilityGrant.externalSideEffectApproval");
    }
    digest(value.externalSideEffectApproval.approvalFingerprint, "CapabilityGrant.externalSideEffectApproval.approvalFingerprint");
    for (const effect of external) {
      if (!value.externalSideEffectApproval.approvedClasses.includes(effect)) {
        fail("External effect is outside the explicit per-run approval", "CapabilityGrant.externalSideEffectApproval.approvedClasses");
      }
    }
  } else if (value.externalSideEffectApproval.mode !== "none" || value.externalSideEffectApproval.approvedClasses.length !== 0) {
    fail("A non-external grant cannot claim external approval", "CapabilityGrant.externalSideEffectApproval");
  }
  digest(value.fingerprint, "CapabilityGrant.fingerprint");
  if (value.fingerprint !== canonicalDigest(capabilityGrantFingerprintMaterial(value))) fail("Capability Grant fingerprint mismatch", "CapabilityGrant.fingerprint");
  return value;
}

export function authorizeCapabilityUse(grant: CapabilityGrant, request: CapabilityUseRequest): CapabilityUseDecision {
  validateCapabilityGrant(grant);
  assertSafeSharedState(request, "CapabilityUseRequest");
  const reasons: string[] = [];
  if (request.projectId !== grant.projectId) reasons.push("project");
  if (request.profileId !== grant.profileId || request.profileRevision !== grant.profileRevision) reasons.push("agent-profile-version");
  if (request.workRunId !== grant.workRunId) reasons.push("work-run");
  if (!grant.scope.connectors.includes(request.connector)) reasons.push("connector");
  if (!grant.scope.operations.includes(request.operation)) reasons.push("operation");
  if (!grant.scope.resources.includes(request.resource)) reasons.push("resource");
  if (!grant.scope.sideEffectClasses.includes(request.sideEffectClass)) reasons.push("side-effect-class");
  if (Date.parse(request.attemptedAt) >= Date.parse(grant.expiresAt)) reasons.push("expired");
  if (EXTERNAL_SIDE_EFFECTS.has(request.sideEffectClass)
    && (grant.externalSideEffectApproval.mode !== "per-run"
      || grant.externalSideEffectApproval.approvedWorkRunId !== request.workRunId
      || !grant.externalSideEffectApproval.approvedClasses.includes(request.sideEffectClass))) {
    reasons.push("per-run-external-approval");
  }
  const allowed = reasons.length === 0;
  return {
    allowed,
    policyVersion: grant.policyDecision.policyVersion,
    reason: allowed ? "Capability use is inside the explicit expiring grant" : `Denied outside grant: ${reasons.join(", ")}`,
    grantId: grant.grantId,
    requestFingerprint: canonicalDigest(request),
    decidedAt: request.attemptedAt,
  };
}

function validatePromotionReview(outputClass: RunOutputClass, review: PromotionReview, path: string): void {
  text(review.policyVersion, `${path}.policyVersion`);
  const durable = DURABLE_OUTPUT_CLASSES.has(outputClass);
  if (durable && (!review.required || review.state === "not-required")) {
    fail("Durable output must enter Promotion Policy independently", path);
  }
  if (!durable && review.required && review.state === "not-required") fail("Required promotion cannot be not-required", path);
  if (!review.required && review.state !== "not-required") fail("Non-required promotion must be not-required", path);
  if (review.state === "candidate-created" && !review.candidateId) fail("Promotion candidate identity is required", `${path}.candidateId`);
}

function validateOperationWriteReview(artifact: ArtifactProjection, review: OperationWriteReview, path: string): void {
  text(review.policyVersion, `${path}.policyVersion`);
  const external = EXTERNAL_SIDE_EFFECTS.has(artifact.sideEffectClass);
  if (artifact.producer.kind === "context-consult" && artifact.sideEffectClass !== "read-only") {
    fail("Context Consult artifacts are read-only", "ArtifactProjection.sideEffectClass");
  }
  if (external) {
    if (!artifact.operationTarget) fail("External artifact must carry its exact connector, operation, and resource", "ArtifactProjection.operationTarget");
    if (!review.required || review.approvalScope !== "per-run" || review.approvedWorkRunId !== artifact.sourceWorkRunId) {
      fail("External artifact effects require per-run Operation Write approval", path);
    }
    if (review.state !== "approved" && review.state !== "denied" && review.state !== "approval-required") {
      fail("Invalid external Operation Write review state", `${path}.state`);
    }
    if (review.state === "approved") {
      if (!review.grantId) fail("Approved external write must cite its per-run grant", `${path}.grantId`);
      digest(review.decisionFingerprint, `${path}.decisionFingerprint`);
    } else if (review.decisionFingerprint !== undefined) {
      fail("Only an approved external write may carry a decision fingerprint", `${path}.decisionFingerprint`);
    }
  } else if (review.required || review.state !== "not-required" || review.approvalScope !== "none") {
    fail("Non-external artifacts must not claim Operation Write approval", path);
  } else if (review.decisionFingerprint !== undefined) {
    fail("Non-external artifacts must not carry an Operation Write decision fingerprint", `${path}.decisionFingerprint`);
  }
}

function validateOperationTarget(target: OperationTarget, path: string): void {
  text(target.connector, `${path}.connector`);
  text(target.operation, `${path}.operation`);
  text(target.resource, `${path}.resource`);
}

export function validateArtifactProjection(value: ArtifactProjection): ArtifactProjection {
  assertSafeSharedState(value, "ArtifactProjection");
  if (value.schemaVersion !== 1) fail("Unsupported schemaVersion", "ArtifactProjection.schemaVersion");
  id(value.projectionId, PROJECTION_ID_RE, "ArtifactProjection.projectionId");
  id(value.artifactId, ARTIFACT_ID_RE, "ArtifactProjection.artifactId");
  id(value.projectId, PROJECT_ID_RE, "ArtifactProjection.projectId");
  id(value.producer.profileId, PROFILE_ID_RE, "ArtifactProjection.producer.profileId");
  integer(value.producer.profileRevision, "ArtifactProjection.producer.profileRevision", 1);
  id(value.sourceWorkRunId, WORK_RUN_ID_RE, "ArtifactProjection.sourceWorkRunId");
  if (value.parentWorkRunId !== undefined) id(value.parentWorkRunId, WORK_RUN_ID_RE, "ArtifactProjection.parentWorkRunId");
  digest(value.contextFingerprint, "ArtifactProjection.contextFingerprint");
  for (const [index, artifactId] of value.inputArtifactIds.entries()) id(artifactId, ARTIFACT_ID_RE, `ArtifactProjection.inputArtifactIds[${index}]`);
  if (new Set(value.inputArtifactIds).size !== value.inputArtifactIds.length) fail("Duplicate values are not allowed", "ArtifactProjection.inputArtifactIds");
  digest(value.contentHash, "ArtifactProjection.contentHash");
  text(value.mediaType, "ArtifactProjection.mediaType");
  if (!OUTPUT_CLASSES.has(value.outputClass)) fail("Unknown output class", "ArtifactProjection.outputClass");
  if (!SIDE_EFFECT_CLASSES.has(value.sideEffectClass)) fail("Unknown side-effect class", "ArtifactProjection.sideEffectClass");
  if (value.operationTarget !== undefined) validateOperationTarget(value.operationTarget, "ArtifactProjection.operationTarget");
  validatePromotionReview(value.outputClass, value.promotionReview, "ArtifactProjection.promotionReview");
  validateOperationWriteReview(value, value.operationWriteReview, "ArtifactProjection.operationWriteReview");
  iso(value.createdAt, "ArtifactProjection.createdAt");
  digest(value.fingerprint, "ArtifactProjection.fingerprint");
  if (value.fingerprint !== canonicalDigest(artifactProjectionFingerprintMaterial(value))) fail("Artifact Projection fingerprint mismatch", "ArtifactProjection.fingerprint");
  return value;
}

export function validateContextConsultRequest(value: ContextConsultRequest): ContextConsultRequest {
  assertSafeSharedState(value, "ContextConsultRequest");
  if (value.schemaVersion !== 1) fail("Unsupported schemaVersion", "ContextConsultRequest.schemaVersion");
  id(value.requestId, CONSULT_REQUEST_ID_RE, "ContextConsultRequest.requestId");
  id(value.projectId, PROJECT_ID_RE, "ContextConsultRequest.projectId");
  id(value.requestingAgent.profileId, PROFILE_ID_RE, "ContextConsultRequest.requestingAgent.profileId");
  integer(value.requestingAgent.profileRevision, "ContextConsultRequest.requestingAgent.profileRevision", 1);
  id(value.requestingAgent.workRunId, WORK_RUN_ID_RE, "ContextConsultRequest.requestingAgent.workRunId");
  id(value.targetAgent.profileId, PROFILE_ID_RE, "ContextConsultRequest.targetAgent.profileId");
  integer(value.targetAgent.profileRevision, "ContextConsultRequest.targetAgent.profileRevision", 1);
  text(value.objective, "ContextConsultRequest.objective");
  if (!Array.isArray(value.requestedSections) || value.requestedSections.length === 0 || new Set(value.requestedSections).size !== value.requestedSections.length) {
    fail("Consult must request one or more unique memory sections", "ContextConsultRequest.requestedSections");
  }
  id(value.asOf.revisionId, /^memory-revision\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, "ContextConsultRequest.asOf.revisionId");
  integer(value.asOf.revision, "ContextConsultRequest.asOf.revision", 1);
  digest(value.asOf.fingerprint, "ContextConsultRequest.asOf.fingerprint");
  digest(value.contextFingerprint, "ContextConsultRequest.contextFingerprint");
  id(value.capabilityGrantId, GRANT_ID_RE, "ContextConsultRequest.capabilityGrantId");
  if (value.authorizationDecision.allowed !== true) fail("Consult requires an allowed authorization decision", "ContextConsultRequest.authorizationDecision.allowed");
  const createdAt = iso(value.createdAt, "ContextConsultRequest.createdAt");
  const expiresAt = iso(value.expiresAt, "ContextConsultRequest.expiresAt");
  validateTimestampOrder(createdAt, expiresAt, "ContextConsultRequest.expiresAt");
  digest(value.invocationTokenHash, "ContextConsultRequest.invocationTokenHash");
  digest(value.fingerprint, "ContextConsultRequest.fingerprint");
  if (value.fingerprint !== canonicalDigest(contextConsultRequestFingerprintMaterial(value))) fail("Context Consult request fingerprint mismatch", "ContextConsultRequest.fingerprint");
  return value;
}

export function validateContextConsultResult(value: ContextConsultResult): ContextConsultResult {
  assertSafeSharedState(value, "ContextConsultResult");
  if (value.schemaVersion !== 1) fail("Unsupported schemaVersion", "ContextConsultResult.schemaVersion");
  id(value.resultId, CONSULT_RESULT_ID_RE, "ContextConsultResult.resultId");
  id(value.requestId, CONSULT_REQUEST_ID_RE, "ContextConsultResult.requestId");
  id(value.projectId, PROJECT_ID_RE, "ContextConsultResult.projectId");
  id(value.requestingWorkRunId, WORK_RUN_ID_RE, "ContextConsultResult.requestingWorkRunId");
  validateArtifactProjection(value.artifact);
  if (value.artifact.projectId !== value.projectId || value.artifact.sourceWorkRunId !== value.requestingWorkRunId || value.artifact.producer.kind !== "context-consult") {
    fail("Consult artifact identity must remain attached to the requesting Work Run", "ContextConsultResult.artifact");
  }
  if (value.consultedRevision.fingerprint !== value.artifact.contextFingerprint) fail("Consult artifact must retain the as-of fingerprint", "ContextConsultResult.artifact.contextFingerprint");
  const isStale = value.observedCurrentRevision.fingerprint !== value.consultedRevision.fingerprint;
  if ((value.freshness === "stale") !== isStale || value.staleForCurrentContextOperations !== isStale) {
    fail("Consult freshness must reflect the observed current revision", "ContextConsultResult.freshness");
  }
  iso(value.completedAt, "ContextConsultResult.completedAt");
  digest(value.invocationTokenHash, "ContextConsultResult.invocationTokenHash");
  digest(value.fingerprint, "ContextConsultResult.fingerprint");
  if (value.fingerprint !== canonicalDigest(contextConsultResultFingerprintMaterial(value))) fail("Context Consult result fingerprint mismatch", "ContextConsultResult.fingerprint");
  return value;
}

export function validateDelegationPlan(value: DelegationPlan): DelegationPlan {
  assertSafeSharedState(value, "DelegationPlan");
  if (value.schemaVersion !== 1) fail("Unsupported schemaVersion", "DelegationPlan.schemaVersion");
  id(value.planId, PLAN_ID_RE, "DelegationPlan.planId");
  id(value.projectId, PROJECT_ID_RE, "DelegationPlan.projectId");
  id(value.parentWorkRunId, WORK_RUN_ID_RE, "DelegationPlan.parentWorkRunId");
  text(value.objective, "DelegationPlan.objective");
  validateAssignment(value.assignment, "DelegationPlan.assignment");
  for (const [index, artifactId] of value.inputArtifactIds.entries()) id(artifactId, ARTIFACT_ID_RE, `DelegationPlan.inputArtifactIds[${index}]`);
  if (new Set(value.inputArtifactIds).size !== value.inputArtifactIds.length) fail("Duplicate values are not allowed", "DelegationPlan.inputArtifactIds");
  validateScope(value.requestedCapabilityScope, "DelegationPlan.requestedCapabilityScope");
  integer(value.budget.maxInputTokens, "DelegationPlan.budget.maxInputTokens", 1);
  integer(value.budget.maxOutputTokens, "DelegationPlan.budget.maxOutputTokens", 1);
  integer(value.budget.maxDurationMs, "DelegationPlan.budget.maxDurationMs", 1);
  text(value.budget.policyVersion, "DelegationPlan.budget.policyVersion");
  if (value.budget.maxCostMinorUnits !== undefined) integer(value.budget.maxCostMinorUnits, "DelegationPlan.budget.maxCostMinorUnits", 0);
  if ((value.budget.maxCostMinorUnits === undefined) !== (value.budget.currency === undefined)) fail("Cost and currency must be supplied together", "DelegationPlan.budget");
  if (value.budget.currency !== undefined) text(value.budget.currency, "DelegationPlan.budget.currency");
  const createdAt = iso(value.createdAt, "DelegationPlan.createdAt");
  const expiresAt = iso(value.expiresAt, "DelegationPlan.expiresAt");
  validateTimestampOrder(createdAt, expiresAt, "DelegationPlan.expiresAt");
  if (Date.parse(value.assignment.deviceSnapshot.expiresAt) < Date.parse(value.expiresAt)) {
    fail("Delegation cannot outlive its locked device snapshot", "DelegationPlan.expiresAt");
  }
  if (!OUTPUT_CLASSES.has(value.expectedOutput.outputClass)) fail("Unknown output class", "DelegationPlan.expectedOutput.outputClass");
  text(value.expectedOutput.mediaType, "DelegationPlan.expectedOutput.mediaType");
  integer(value.expectedOutput.requiredArtifactCount, "DelegationPlan.expectedOutput.requiredArtifactCount", 1);
  uniqueStrings(value.expectedOutput.acceptanceCriteria, "DelegationPlan.expectedOutput.acceptanceCriteria", false);
  if (value.sideEffectPolicy.externalEffectsRequirePerRunApproval !== true) fail("External effects must always require per-run approval", "DelegationPlan.sideEffectPolicy.externalEffectsRequirePerRunApproval");
  const requestedExternal = value.requestedCapabilityScope.sideEffectClasses.filter((effect) => EXTERNAL_SIDE_EFFECTS.has(effect));
  if (canonicalDigest([...requestedExternal].sort()) !== canonicalDigest([...value.sideEffectPolicy.requestedExternalClasses].sort())) {
    fail("Side-effect policy must enumerate the exact requested external classes", "DelegationPlan.sideEffectPolicy.requestedExternalClasses");
  }
  digest(value.fingerprint, "DelegationPlan.fingerprint");
  if (value.fingerprint !== canonicalDigest(delegationPlanFingerprintMaterial(value))) fail("Delegation Plan fingerprint mismatch", "DelegationPlan.fingerprint");
  return value;
}

export function validateChildWorkRun(value: ChildWorkRun): ChildWorkRun {
  assertSafeSharedState(value, "ChildWorkRun");
  if (value.schemaVersion !== 1) fail("Unsupported schemaVersion", "ChildWorkRun.schemaVersion");
  id(value.workRunId, WORK_RUN_ID_RE, "ChildWorkRun.workRunId");
  integer(value.revision, "ChildWorkRun.revision", 1);
  if (value.previousRevision) {
    if (value.previousRevision.revision !== value.revision - 1) fail("Child predecessor revision must be exact", "ChildWorkRun.previousRevision.revision");
    digest(value.previousRevision.fingerprint, "ChildWorkRun.previousRevision.fingerprint");
  } else if (value.revision !== 1) fail("Only revision 1 may omit a predecessor", "ChildWorkRun.previousRevision");
  id(value.projectId, PROJECT_ID_RE, "ChildWorkRun.projectId");
  id(value.parentWorkRunId, WORK_RUN_ID_RE, "ChildWorkRun.parentWorkRunId");
  id(value.delegationPlanId, PLAN_ID_RE, "ChildWorkRun.delegationPlanId");
  digest(value.delegationPlanFingerprint, "ChildWorkRun.delegationPlanFingerprint");
  validateAssignment(value.assignment, "ChildWorkRun.assignment");
  validateCapabilityGrant(value.grantSummary);
  if (value.grantSummary.projectId !== value.projectId || value.grantSummary.workRunId !== value.workRunId
    || value.grantSummary.profileId !== value.assignment.profileId || value.grantSummary.profileRevision !== value.assignment.profileRevision) {
    fail("Child Work Run must lock the same Project, Agent version, and grant scope", "ChildWorkRun.grantSummary");
  }
  for (const artifact of value.artifacts) {
    validateArtifactProjection(artifact);
    if (artifact.projectId !== value.projectId || artifact.sourceWorkRunId !== value.workRunId || artifact.parentWorkRunId !== value.parentWorkRunId) {
      fail("Child artifacts must project from this child to its recorded parent", "ChildWorkRun.artifacts");
    }
  }
  if ((value.lifecycle === "failed" || value.lifecycle === "cancelled") && !value.terminalDiagnosticArtifactId) {
    fail("Failed or cancelled child requires a diagnostic artifact", "ChildWorkRun.terminalDiagnosticArtifactId");
  }
  if (value.parentStateEffect !== "none") fail("Child state cannot infer a parent state transition", "ChildWorkRun.parentStateEffect");
  iso(value.createdAt, "ChildWorkRun.createdAt");
  iso(value.updatedAt, "ChildWorkRun.updatedAt");
  digest(value.fingerprint, "ChildWorkRun.fingerprint");
  if (value.fingerprint !== canonicalDigest(childWorkRunFingerprintMaterial(value))) fail("Child Work Run fingerprint mismatch", "ChildWorkRun.fingerprint");
  return value;
}

export function promotionReviewFor(outputClass: RunOutputClass, policyVersion: string): PromotionReview {
  return DURABLE_OUTPUT_CLASSES.has(outputClass)
    ? { required: true, state: "candidate-required", policyVersion }
    : { required: false, state: "not-required", policyVersion };
}

export function operationWriteReviewFor(
  sideEffectClass: SideEffectClass,
  policyVersion: string,
  workRunId: ChildWorkRun["workRunId"],
  grant?: CapabilityGrant,
  operationTarget?: OperationTarget,
  attemptedAt?: string,
): OperationWriteReview {
  if (!EXTERNAL_SIDE_EFFECTS.has(sideEffectClass)) {
    return { required: false, state: "not-required", policyVersion, approvalScope: "none" };
  }
  const decision = grant && operationTarget && attemptedAt
    ? authorizeCapabilityUse(grant, {
        projectId: grant.projectId,
        profileId: grant.profileId,
        profileRevision: grant.profileRevision,
        workRunId,
        connector: operationTarget.connector,
        operation: operationTarget.operation,
        resource: operationTarget.resource,
        sideEffectClass,
        attemptedAt,
      })
    : undefined;
  const approved = decision?.allowed === true;
  return {
    required: true,
    state: approved ? "approved" : "approval-required",
    policyVersion,
    approvalScope: "per-run",
    approvedWorkRunId: workRunId,
    ...(grant ? { grantId: grant.grantId } : {}),
    ...(approved && decision ? { decisionFingerprint: canonicalDigest(decision) } : {}),
  };
}

export function isExternalSideEffect(value: SideEffectClass): boolean {
  return EXTERNAL_SIDE_EFFECTS.has(value);
}
