import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { canonicalDigest, canonicalJson, deepClone, digestTransitionToken } from "./canonical.js";
import { DomainConflictError, DomainNotFoundError, DomainValidationError } from "./errors.js";
import { withRecoverableFileLock } from "./locks.js";
import { assertSafeSharedState, assertSafeSingleSegment } from "./security.js";
import type {
  ArtifactProjection,
  ArtifactProjectionRequest,
  AllowedPolicyDecision,
  CapabilityGrant,
  ChildTransitionRequest,
  ChildTransitionResult,
  ChildWorkRun,
  ContextConsultMemoryReader,
  ContextConsultRequest,
  ContextConsultResult,
  ContextConsultWorker,
  ContextConsultWorkerInput,
  DelegationApprovalRequest,
  DelegationApprovalResult,
  DelegationPlan,
  MemoryRevisionLock,
  RunOutputClass,
  SideEffectClass,
} from "./collaboration-types.js";
import type { ArtifactId, JsonValue, MemoryRevision, ProjectId, ProvenanceRef } from "./types.js";
import {
  artifactProjectionFingerprintMaterial,
  authorizeCapabilityUse,
  capabilityGrantFingerprintMaterial,
  childWorkRunFingerprintMaterial,
  contextConsultRequestFingerprintMaterial,
  contextConsultResultFingerprintMaterial,
  delegationPlanFingerprintMaterial,
  isExternalSideEffect,
  operationWriteReviewFor,
  promotionReviewFor,
  validateArtifactProjection,
  validateCapabilityGrant,
  validateChildWorkRun,
  validateContextConsultRequest,
  validateContextConsultResult,
  validateDelegationPlan,
} from "./collaboration-validation.js";

export interface CapabilityGrantCreate extends Omit<CapabilityGrant, "schemaVersion" | "fingerprint"> {}

export interface ArtifactProjectionCreate extends Omit<ArtifactProjection, "schemaVersion" | "projectionId" | "artifactId" | "promotionReview" | "operationWriteReview" | "fingerprint"> {
  projectionId?: ArtifactProjection["projectionId"];
  artifactId?: ArtifactProjection["artifactId"];
  promotionPolicyVersion: string;
  operationWritePolicyVersion: string;
  grant?: CapabilityGrant;
}

export interface ContextConsultRequestCreate extends Omit<ContextConsultRequest, "schemaVersion" | "requestId" | "invocationTokenHash" | "fingerprint"> {
  requestId?: ContextConsultRequest["requestId"];
  invocationToken: string;
}

export interface DelegationPlanCreate extends Omit<DelegationPlan, "schemaVersion" | "planId" | "fingerprint"> {
  planId?: DelegationPlan["planId"];
}

export interface ContextConsultExecution {
  idempotent: boolean;
  result: ContextConsultResult;
}

export interface ContextConsultStoreOptions {
  collaborationRoot: string;
  projectId: ProjectId;
  clock?: () => string;
  lockTimeoutMs?: number;
  lockRetryMs?: number;
  staleLockMs?: number;
  faultInjector?: (point: CollaborationFaultPoint) => void | Promise<void>;
}

export type CollaborationFaultPoint =
  | "after-delegation-intent"
  | "after-delegation-receipt"
  | "after-delegation-grant"
  | "after-child-intent"
  | "after-child-receipt";

export interface ExecuteContextConsultInput {
  request: ContextConsultRequest;
  invocationToken: string;
  grant: CapabilityGrant;
  targetMemory: ContextConsultMemoryReader;
  worker: ContextConsultWorker;
  inputArtifactIds?: ArtifactId[];
}

export interface DelegationStoreOptions extends ContextConsultStoreOptions {}

interface DelegationReceipt {
  schemaVersion: 1;
  kind: "delegation-approval";
  planId: DelegationPlan["planId"];
  planFingerprint: string;
  transitionTokenHash: string;
  childWorkRunId: ChildWorkRun["workRunId"];
  childRevision: number;
  grantId: CapabilityGrant["grantId"];
  actor: string;
  requestFingerprint: string;
  approvedExternalClasses: SideEffectClass[];
  policyDecision: AllowedPolicyDecision;
  issuedAt: string;
  grantFingerprint: string;
  childFingerprint: string;
}

interface ChildReceipt {
  schemaVersion: 1;
  kind: "child-transition" | "artifact-projection";
  transitionTokenHash: string;
  childWorkRunId: ChildWorkRun["workRunId"];
  childRevision: number;
  expectedRevision: number;
  artifactProjectionId?: ArtifactProjection["projectionId"];
  actor: string;
  committedAt: string;
  requestFingerprint: string;
  resultFingerprint: string;
  request: ChildOperationSemantics;
}

type ChildOperationSemantics =
  | {
      kind: "artifact-projection";
      childWorkRunId: ChildWorkRun["workRunId"];
      expectedRevision: number;
      actor: string;
      artifact: ArtifactProjection;
    }
  | {
      kind: "child-transition";
      childWorkRunId: ChildWorkRun["workRunId"];
      expectedRevision: number;
      actor: string;
      lifecycle: ChildWorkRun["lifecycle"];
      diagnosticArtifact?: ArtifactProjection;
    };

export function createCapabilityGrant(input: CapabilityGrantCreate): CapabilityGrant {
  const material: Omit<CapabilityGrant, "fingerprint"> = { schemaVersion: 1, ...deepClone(input) };
  return validateCapabilityGrant({
    ...material,
    fingerprint: canonicalDigest(capabilityGrantFingerprintMaterial(material as CapabilityGrant)),
  });
}

export function createArtifactProjection(input: ArtifactProjectionCreate): ArtifactProjection {
  const {
    promotionPolicyVersion,
    operationWritePolicyVersion,
    grant,
    projectionId = `artifact-projection/${randomUUID()}`,
    artifactId = `artifact/${randomUUID()}`,
    ...rest
  } = deepClone(input);
  const material: Omit<ArtifactProjection, "fingerprint"> = {
    schemaVersion: 1,
    projectionId,
    artifactId,
    ...rest,
    promotionReview: promotionReviewFor(rest.outputClass, promotionPolicyVersion),
    operationWriteReview: operationWriteReviewFor(
      rest.sideEffectClass,
      operationWritePolicyVersion,
      rest.sourceWorkRunId,
      grant,
      rest.operationTarget,
      rest.createdAt,
    ),
  };
  return validateArtifactProjection({ ...material, fingerprint: canonicalDigest(artifactProjectionFingerprintMaterial(material as ArtifactProjection)) });
}

export function createContextConsultRequest(input: ContextConsultRequestCreate): ContextConsultRequest {
  const { invocationToken, requestId = `context-consult/${randomUUID()}`, ...rest } = deepClone(input);
  if (!invocationToken) throw new DomainValidationError("Context Consult invocation token is required");
  const material: Omit<ContextConsultRequest, "fingerprint"> = {
    schemaVersion: 1,
    requestId,
    ...rest,
    invocationTokenHash: digestTransitionToken(invocationToken),
  };
  return validateContextConsultRequest({ ...material, fingerprint: canonicalDigest(contextConsultRequestFingerprintMaterial(material as ContextConsultRequest)) });
}

export function createDelegationPlan(input: DelegationPlanCreate): DelegationPlan {
  const { planId = `delegation-plan/${randomUUID()}`, ...rest } = deepClone(input);
  const material: Omit<DelegationPlan, "fingerprint"> = { schemaVersion: 1, planId, ...rest };
  return validateDelegationPlan({ ...material, fingerprint: canonicalDigest(delegationPlanFingerprintMaterial(material as DelegationPlan)) });
}

export class ContextConsultStore {
  readonly projectId: ProjectId;
  private readonly scopeRoot: string;
  private readonly now: () => string;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryMs: number;
  private readonly staleLockMs?: number;

  constructor(options: ContextConsultStoreOptions) {
    if (!options.collaborationRoot) throw new DomainValidationError("collaborationRoot is required");
    if (!/^project\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(options.projectId)) throw new DomainValidationError("Invalid Project ID");
    this.projectId = options.projectId;
    this.scopeRoot = join(options.collaborationRoot, options.projectId.slice("project/".length), "consults");
    this.now = options.clock ?? (() => new Date().toISOString());
    this.lockTimeoutMs = options.lockTimeoutMs ?? 5_000;
    this.lockRetryMs = options.lockRetryMs ?? 15;
    this.staleLockMs = options.staleLockMs;
  }

  async execute(input: ExecuteContextConsultInput): Promise<ContextConsultExecution> {
    const request = validateContextConsultRequest(deepClone(input.request));
    const grant = validateCapabilityGrant(deepClone(input.grant));
    if (request.projectId !== this.projectId) throw new DomainConflictError("Context Consult is outside this Project scope");
    if (request.invocationTokenHash !== digestTransitionToken(input.invocationToken)) throw new DomainConflictError("Context Consult invocation token does not match request");
    if (request.capabilityGrantId !== grant.grantId) throw new DomainConflictError("Context Consult grant identity mismatch");
    const resource = consultResource(request);
    const useDecision = authorizeCapabilityUse(grant, {
      projectId: request.projectId,
      profileId: request.requestingAgent.profileId,
      profileRevision: request.requestingAgent.profileRevision,
      workRunId: request.requestingAgent.workRunId,
      connector: "agent-memory",
      operation: "context.consult",
      resource,
      sideEffectClass: "read-only",
      attemptedAt: this.now(),
    });
    if (!useDecision.allowed) throw new DomainConflictError("Context Consult denied by Capability Grant", { policyResult: useDecision });
    if (Date.parse(this.now()) >= Date.parse(request.expiresAt)) throw new DomainConflictError("Context Consult request expired");

    const existing = await this.readByInvocationToken(request.invocationTokenHash);
    if (existing) {
      await this.assertReplayMatches(request, existing);
      return { idempotent: true, result: existing };
    }

    return this.withLock(async () => {
      const replay = await this.readByInvocationToken(request.invocationTokenHash);
      if (replay) {
        await this.assertReplayMatches(request, replay);
        return { idempotent: true, result: replay };
      }
      const asOfMemory = await input.targetMemory.readApprovedRevision(deepFreeze(deepClone(request.asOf)));
      assertConsultRevision(request, asOfMemory);
      const workerInput: ContextConsultWorkerInput = {
        requestId: request.requestId,
        projectId: request.projectId,
        objective: request.objective,
        targetAgent: deepClone(request.targetAgent),
        asOf: deepClone(request.asOf),
        contextFingerprint: request.contextFingerprint,
        sections: Object.fromEntries(request.requestedSections.map((section) => [section, deepClone(asOfMemory.sections[section])])),
        inputArtifactIds: [...(input.inputArtifactIds ?? [])],
      };
      // The worker receives only an immutable projection. No memory writer exists in this API.
      const output = deepClone(await input.worker.generate(deepFreeze(deepClone(workerInput))));
      assertSafeSharedState(output, "ContextConsultWorkerOutput");
      const observed = await input.targetMemory.readCurrentApprovedRevision();
      assertMemoryIdentity(observed, request.projectId, request.targetAgent.profileId);
      const observedLock = memoryLock(observed);
      const stale = observedLock.fingerprint !== request.asOf.fingerprint;
      const completedAt = this.now();
      const warnings = [
        ...(output.warnings ?? []),
        ...(stale ? [{
          code: "consult-target-advanced",
          severity: "warning" as const,
          message: "Target memory advanced during generation; current-context operations must re-consult.",
        }] : []),
      ];
      const artifact = createArtifactProjection({
        projectionId: `artifact-projection/consult-${stableSuffix(request.requestId)}`,
        artifactId: `artifact/consult-${stableSuffix(request.requestId)}`,
        projectId: request.projectId,
        producer: { kind: "context-consult", ...request.targetAgent },
        sourceWorkRunId: request.requestingAgent.workRunId,
        contextFingerprint: request.asOf.fingerprint,
        inputArtifactIds: [...workerInput.inputArtifactIds],
        contentHash: canonicalDigest(output.content),
        mediaType: output.mediaType,
        outputClass: output.outputClass,
        sideEffectClass: "read-only",
        provenance: dedupeProvenance([
          ...request.provenance,
          { kind: "memoryRevision", id: request.asOf.revisionId, revision: request.asOf.revision, fingerprint: request.asOf.fingerprint },
          ...output.provenance,
        ]),
        warnings,
        createdAt: completedAt,
        promotionPolicyVersion: "promotion-policy/v1",
        operationWritePolicyVersion: "operation-write-policy/v1",
      });
      const resultMaterial: Omit<ContextConsultResult, "fingerprint"> = {
        schemaVersion: 1,
        resultId: `context-consult-result/${stableSuffix(request.requestId)}`,
        requestId: request.requestId,
        projectId: request.projectId,
        requestingWorkRunId: request.requestingAgent.workRunId,
        targetAgent: deepClone(request.targetAgent),
        consultedRevision: deepClone(request.asOf),
        observedCurrentRevision: observedLock,
        freshness: stale ? "stale" : "current",
        staleForCurrentContextOperations: stale,
        provenance: artifact.provenance,
        warnings,
        artifact,
        completedAt,
        invocationTokenHash: request.invocationTokenHash,
      };
      const result = validateContextConsultResult({
        ...resultMaterial,
        fingerprint: canonicalDigest(contextConsultResultFingerprintMaterial(resultMaterial as ContextConsultResult)),
      });
      await writeIfAbsentOrSame(this.requestPath(request.requestId), request);
      await writeIfAbsentOrSame(this.resultPath(request.invocationTokenHash), result);
      return { idempotent: false, result: deepClone(result) };
    });
  }

  async readByInvocationToken(invocationTokenHash: string): Promise<ContextConsultResult | null> {
    ensureDigest(invocationTokenHash, "invocationTokenHash");
    return readValidated(this.resultPath(invocationTokenHash), validateContextConsultResult);
  }

  private resultPath(tokenHash: string): string {
    return join(this.scopeRoot, "results", digestSuffix(tokenHash), "result.json");
  }

  private requestPath(requestId: ContextConsultRequest["requestId"]): string {
    return join(this.scopeRoot, "requests", stableSuffix(requestId), "request.json");
  }

  private async assertReplayMatches(
    request: ContextConsultRequest,
    result: ContextConsultResult,
  ): Promise<void> {
    if (result.requestId !== request.requestId) {
      throw new DomainConflictError("Invocation token was already used for another Context Consult");
    }
    const committed = await readValidated(this.requestPath(result.requestId), validateContextConsultRequest);
    if (!committed || committed.fingerprint !== request.fingerprint) {
      throw new DomainConflictError("Invocation token replay changed Context Consult request semantics");
    }
  }

  private withLock<R>(action: () => Promise<R>): Promise<R> {
    return withRecoverableFileLock({
      lockPath: join(this.scopeRoot, ".lock"),
      now: this.now,
      timeoutMs: this.lockTimeoutMs,
      retryMs: this.lockRetryMs,
      staleLockMs: this.staleLockMs,
    }, action);
  }
}

export class DelegationStore {
  readonly projectId: ProjectId;
  private readonly scopeRoot: string;
  private readonly now: () => string;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryMs: number;
  private readonly staleLockMs?: number;
  private readonly faultInjector?: ContextConsultStoreOptions["faultInjector"];

  constructor(options: DelegationStoreOptions) {
    if (!options.collaborationRoot) throw new DomainValidationError("collaborationRoot is required");
    if (!/^project\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(options.projectId)) throw new DomainValidationError("Invalid Project ID");
    this.projectId = options.projectId;
    this.scopeRoot = join(options.collaborationRoot, options.projectId.slice("project/".length), "delegations");
    this.now = options.clock ?? (() => new Date().toISOString());
    this.lockTimeoutMs = options.lockTimeoutMs ?? 5_000;
    this.lockRetryMs = options.lockRetryMs ?? 15;
    this.staleLockMs = options.staleLockMs;
    this.faultInjector = options.faultInjector;
  }

  async createPlan(rawPlan: DelegationPlan): Promise<DelegationPlan> {
    const plan = validateDelegationPlan(deepClone(rawPlan));
    if (plan.projectId !== this.projectId) throw new DomainConflictError("Delegation Plan is outside this Project scope");
    await this.withLock(() => writeIfAbsentOrSame(this.planPath(plan.planId), plan));
    return deepClone(plan);
  }

  async readPlan(planId: DelegationPlan["planId"]): Promise<DelegationPlan | null> {
    assertSafeSingleSegment(stableSuffix(planId), "Delegation Plan ID");
    return readValidated(this.planPath(planId), validateDelegationPlan);
  }

  async approve(request: DelegationApprovalRequest): Promise<DelegationApprovalResult> {
    if (!request.transitionToken) throw new DomainValidationError("Delegation approval transition token is required");
    const tokenHash = digestTransitionToken(request.transitionToken);
    return this.withLock(async () => {
      const plan = await this.readPlan(request.planId);
      if (!plan) throw new DomainNotFoundError(`Delegation Plan ${request.planId} does not exist`);
      const tokenReceipt = await this.readDelegationReceipt(tokenHash);
      const planDecision = await this.readPlanDecision(plan.planId);
      if (tokenReceipt) return this.recoverDelegation(tokenReceipt, request, plan);
      if (planDecision) {
        if (planDecision.transitionTokenHash !== tokenHash) {
          throw new DomainConflictError("Delegation Plan was already approved with another transition token", { childWorkRunId: planDecision.childWorkRunId });
        }
        return this.recoverDelegation(planDecision, request, plan);
      }
      if (plan.fingerprint !== request.presentedFingerprint) throw new DomainConflictError("Delegation Plan fingerprint changed before approval");
      if (Date.parse(this.now()) >= Date.parse(plan.expiresAt)) throw new DomainConflictError("Delegation Plan expired");
      const policy = deepClone(await request.authorize(deepFreeze(deepClone(plan))));
      if (!policy.allowed || policy.actor !== request.actor) throw new DomainConflictError("Delegation approval authorization denied or actor mismatched");
      const requestedExternal = plan.sideEffectPolicy.requestedExternalClasses;
      const approvedExternal = [...new Set(request.approvedExternalClasses)].sort();
      if (canonicalDigest([...requestedExternal].sort()) !== canonicalDigest(approvedExternal)) {
        throw new DomainConflictError("External side effects require explicit approval of the exact per-run classes", {
          requestedExternal,
          approvedExternal,
        });
      }
      const suffix = digestSuffix(canonicalDigest({ planId: plan.planId, fingerprint: plan.fingerprint }));
      const workRunId: ChildWorkRun["workRunId"] = `work-run/child-${suffix.slice(0, 24)}`;
      const grantId: CapabilityGrant["grantId"] = `grant/child-${suffix.slice(0, 24)}`;
      const issuedAt = this.now();
      const outcome = this.delegationOutcome(plan, {
        actor: request.actor,
        approvedExternal,
        policy,
        issuedAt,
        workRunId,
        grantId,
      });
      const receipt: DelegationReceipt = {
        schemaVersion: 1,
        kind: "delegation-approval",
        planId: plan.planId,
        planFingerprint: plan.fingerprint,
        transitionTokenHash: tokenHash,
        childWorkRunId: workRunId,
        childRevision: 1,
        grantId,
        actor: request.actor,
        requestFingerprint: delegationApprovalRequestFingerprint(request),
        approvedExternalClasses: approvedExternal,
        policyDecision: policy,
        issuedAt,
        grantFingerprint: outcome.grant.fingerprint,
        childFingerprint: outcome.child.fingerprint,
      };

      // The plan-scoped intent is the serialization point. Once it exists, the
      // exact approved outcome can be reconstructed after any later interruption.
      await writeIfAbsentOrSame(this.planDecisionPath(plan.planId), receipt);
      await this.injectFault("after-delegation-intent");
      await writeIfAbsentOrSame(this.delegationReceiptPath(tokenHash), receipt);
      await this.injectFault("after-delegation-receipt");
      await writeIfAbsentOrSame(this.grantPath(outcome.grant.grantId), outcome.grant);
      await this.injectFault("after-delegation-grant");
      await writeIfAbsentOrSame(this.childRevisionPath(workRunId, 1), outcome.child);
      return { idempotent: false, child: deepClone(outcome.child), grant: deepClone(outcome.grant) };
    });
  }

  private delegationOutcome(
    plan: DelegationPlan,
    input: {
      actor: string;
      approvedExternal: SideEffectClass[];
      policy: AllowedPolicyDecision;
      issuedAt: string;
      workRunId: ChildWorkRun["workRunId"];
      grantId: CapabilityGrant["grantId"];
    },
  ): { child: ChildWorkRun; grant: CapabilityGrant } {
      const { actor, approvedExternal, policy, issuedAt, workRunId, grantId } = input;
      const requestedExternal = plan.sideEffectPolicy.requestedExternalClasses;
      const approvalFingerprint = canonicalDigest({
        planId: plan.planId,
        planFingerprint: plan.fingerprint,
        workRunId,
        actor,
        policyVersion: policy.policyVersion,
        approvedExternal,
      });
      const grant = createCapabilityGrant({
        grantId,
        projectId: plan.projectId,
        profileId: plan.assignment.profileId,
        profileRevision: plan.assignment.profileRevision,
        workRunId,
        delegationPlanId: plan.planId,
        scope: deepClone(plan.requestedCapabilityScope),
        issuedAt,
        expiresAt: plan.expiresAt,
        issuedBy: actor,
        policyDecision: policy,
        externalSideEffectApproval: requestedExternal.length > 0 ? {
          mode: "per-run",
          approvedClasses: approvedExternal,
          approvedWorkRunId: workRunId,
          approvalFingerprint,
        } : { mode: "none", approvedClasses: [] },
      });
      const childMaterial: Omit<ChildWorkRun, "fingerprint"> = {
        schemaVersion: 1,
        workRunId,
        revision: 1,
        projectId: plan.projectId,
        parentWorkRunId: plan.parentWorkRunId,
        delegationPlanId: plan.planId,
        delegationPlanFingerprint: plan.fingerprint,
        lifecycle: "ready",
        assignment: deepClone(plan.assignment),
        expectedOutput: deepClone(plan.expectedOutput),
        inputArtifactIds: [...plan.inputArtifactIds],
        grantSummary: grant,
        artifacts: [],
        parentStateEffect: "none",
        createdAt: issuedAt,
        createdBy: actor,
        updatedAt: issuedAt,
        updatedBy: actor,
      };
      const child = validateChildWorkRun({
        ...childMaterial,
        fingerprint: canonicalDigest(childWorkRunFingerprintMaterial(childMaterial as ChildWorkRun)),
      });
      return { child, grant };
  }

  async readChild(workRunId: ChildWorkRun["workRunId"]): Promise<ChildWorkRun | null> {
    const revisions = await this.readChildChain(workRunId);
    return revisions.length === 0 ? null : deepClone(revisions.at(-1)!);
  }

  async readGrant(grantId: CapabilityGrant["grantId"]): Promise<CapabilityGrant | null> {
    const grant = await readJson<CapabilityGrant>(this.grantPath(grantId));
    return grant ? deepClone(validateCapabilityGrant(grant)) : null;
  }

  private async readChildChain(workRunId: ChildWorkRun["workRunId"]): Promise<ChildWorkRun[]> {
    const revisions = await this.childRevisionNumbers(workRunId);
    for (let index = 0; index < revisions.length; index += 1) {
      if (revisions[index] !== index + 1) {
        throw new DomainConflictError("Child Work Run revision history is not contiguous", { workRunId, revisions });
      }
    }
    const chain: ChildWorkRun[] = [];
    for (const revision of revisions) {
      const child = await readValidated(this.childRevisionPath(workRunId, revision), validateChildWorkRun);
      if (!child) throw new DomainConflictError("Child Work Run revision disappeared while reading its chain", { workRunId, revision });
      if (child.workRunId !== workRunId || child.revision !== revision) {
        throw new DomainConflictError("Child Work Run revision identity does not match its immutable path", { workRunId, revision });
      }
      const previous = chain.at(-1);
      if (!previous) {
        if (child.previousRevision !== undefined) throw new DomainConflictError("Child Work Run revision 1 must not claim a predecessor");
      } else {
        if (child.previousRevision?.revision !== previous.revision || child.previousRevision.fingerprint !== previous.fingerprint) {
          throw new DomainConflictError("Child Work Run predecessor fingerprint lock mismatch", {
            workRunId,
            revision,
            expectedPreviousRevision: previous.revision,
            expectedPreviousFingerprint: previous.fingerprint,
          });
        }
        if (childImmutableFingerprint(child) !== childImmutableFingerprint(previous)) {
          throw new DomainConflictError("Child Work Run immutable identity changed across revisions", { workRunId, revision });
        }
      }
      chain.push(child);
    }
    return chain;
  }

  async projectArtifact(workRunId: ChildWorkRun["workRunId"], request: ArtifactProjectionRequest): Promise<ChildTransitionResult> {
    const tokenHash = digestTransitionToken(request.transitionToken);
    return this.withLock(async () => {
      const artifact = validateArtifactProjection(deepClone(request.artifact));
      const semantics: ChildOperationSemantics = {
        kind: "artifact-projection",
        childWorkRunId: workRunId,
        expectedRevision: request.expectedRevision,
        actor: request.actor,
        artifact,
      };
      const requestFingerprint = canonicalDigest(semantics);
      const replay = await this.readChildReceipt(tokenHash);
      if (replay) return this.childReplay(replay, workRunId, tokenHash, requestFingerprint);
      await this.recoverNextChildIntent(workRunId);
      const recoveredReplay = await this.readChildReceipt(tokenHash);
      if (recoveredReplay) return this.childReplay(recoveredReplay, workRunId, tokenHash, requestFingerprint);
      const current = await this.requireChild(workRunId);
      if (current.revision !== request.expectedRevision) throw revisionConflict(current, request.expectedRevision);
      const committedAt = this.now();
      const next = this.nextChildForArtifact(current, semantics, committedAt);
      const receipt: ChildReceipt = {
        schemaVersion: 1,
        kind: "artifact-projection",
        transitionTokenHash: tokenHash,
        childWorkRunId: workRunId,
        childRevision: next.revision,
        expectedRevision: request.expectedRevision,
        artifactProjectionId: artifact.projectionId,
        actor: request.actor,
        committedAt,
        requestFingerprint,
        resultFingerprint: next.fingerprint,
        request: semantics,
      };
      await writeIfAbsentOrSame(this.childIntentPath(workRunId, next.revision), receipt);
      await this.injectFault("after-child-intent");
      await writeIfAbsentOrSame(this.childReceiptPath(tokenHash), receipt);
      await this.injectFault("after-child-receipt");
      await writeIfAbsentOrSame(this.childRevisionPath(workRunId, next.revision), next);
      return { idempotent: false, child: deepClone(next) };
    });
  }

  async transition(workRunId: ChildWorkRun["workRunId"], request: ChildTransitionRequest): Promise<ChildTransitionResult> {
    const tokenHash = digestTransitionToken(request.transitionToken);
    return this.withLock(async () => {
      const semantics: ChildOperationSemantics = {
        kind: "child-transition",
        childWorkRunId: workRunId,
        expectedRevision: request.expectedRevision,
        actor: request.actor,
        lifecycle: request.lifecycle,
        ...(request.diagnosticArtifact ? { diagnosticArtifact: validateArtifactProjection(deepClone(request.diagnosticArtifact)) } : {}),
      };
      const requestFingerprint = canonicalDigest(semantics);
      const replay = await this.readChildReceipt(tokenHash);
      if (replay) return this.childReplay(replay, workRunId, tokenHash, requestFingerprint);
      await this.recoverNextChildIntent(workRunId);
      const recoveredReplay = await this.readChildReceipt(tokenHash);
      if (recoveredReplay) return this.childReplay(recoveredReplay, workRunId, tokenHash, requestFingerprint);
      const current = await this.requireChild(workRunId);
      if (current.revision !== request.expectedRevision) throw revisionConflict(current, request.expectedRevision);
      const committedAt = this.now();
      const next = this.nextChildForTransition(current, semantics, committedAt);
      const receipt: ChildReceipt = {
        schemaVersion: 1,
        kind: "child-transition",
        transitionTokenHash: tokenHash,
        childWorkRunId: workRunId,
        childRevision: next.revision,
        expectedRevision: request.expectedRevision,
        actor: request.actor,
        committedAt,
        requestFingerprint,
        resultFingerprint: next.fingerprint,
        request: semantics,
      };
      await writeIfAbsentOrSame(this.childIntentPath(workRunId, next.revision), receipt);
      await this.injectFault("after-child-intent");
      await writeIfAbsentOrSame(this.childReceiptPath(tokenHash), receipt);
      await this.injectFault("after-child-receipt");
      await writeIfAbsentOrSame(this.childRevisionPath(workRunId, next.revision), next);
      return { idempotent: false, child: deepClone(next) };
    });
  }

  private async recoverDelegation(
    receipt: DelegationReceipt,
    request: DelegationApprovalRequest,
    plan: DelegationPlan,
  ): Promise<DelegationApprovalResult> {
    if (receipt.planId !== request.planId
      || receipt.planFingerprint !== request.presentedFingerprint
      || receipt.transitionTokenHash !== digestTransitionToken(request.transitionToken)
      || receipt.requestFingerprint !== delegationApprovalRequestFingerprint(request)) {
      throw new DomainConflictError("Delegation transition token was already used for different approval semantics");
    }
    const outcome = this.delegationOutcome(plan, {
      actor: receipt.actor,
      approvedExternal: receipt.approvedExternalClasses,
      policy: receipt.policyDecision,
      issuedAt: receipt.issuedAt,
      workRunId: receipt.childWorkRunId,
      grantId: receipt.grantId,
    });
    if (outcome.child.fingerprint !== receipt.childFingerprint || outcome.grant.fingerprint !== receipt.grantFingerprint) {
      throw new DomainConflictError("Delegation recovery outcome no longer matches its durable approval intent");
    }
    await writeIfAbsentOrSame(this.planDecisionPath(plan.planId), receipt);
    await writeIfAbsentOrSame(this.delegationReceiptPath(receipt.transitionTokenHash), receipt);
    await writeIfAbsentOrSame(this.grantPath(receipt.grantId), outcome.grant);
    await writeIfAbsentOrSame(this.childRevisionPath(receipt.childWorkRunId, receipt.childRevision), outcome.child);
    return { idempotent: true, child: deepClone(outcome.child), grant: deepClone(outcome.grant) };
  }

  private async childReplay(
    receipt: ChildReceipt,
    workRunId: ChildWorkRun["workRunId"],
    tokenHash: string,
    requestFingerprint: string,
  ): Promise<ChildTransitionResult> {
    if (receipt.childWorkRunId !== workRunId
      || receipt.transitionTokenHash !== tokenHash
      || receipt.requestFingerprint !== requestFingerprint) {
      throw new DomainConflictError("Child transition token was already used for different child operation semantics");
    }
    return { idempotent: true, child: await this.recoverChildIntent(receipt) };
  }

  private async recoverNextChildIntent(workRunId: ChildWorkRun["workRunId"]): Promise<void> {
    const current = await this.requireChild(workRunId);
    const pending = await this.readChildIntent(workRunId, current.revision + 1);
    if (pending) await this.recoverChildIntent(pending);
  }

  private async recoverChildIntent(receipt: ChildReceipt): Promise<ChildWorkRun> {
    if (receipt.schemaVersion !== 1
      || receipt.kind !== receipt.request.kind
      || receipt.childWorkRunId !== receipt.request.childWorkRunId
      || receipt.expectedRevision !== receipt.request.expectedRevision
      || receipt.childRevision !== receipt.expectedRevision + 1
      || receipt.actor !== receipt.request.actor
      || receipt.requestFingerprint !== canonicalDigest(receipt.request)) {
      throw new DomainConflictError("Child operation intent is internally inconsistent");
    }
    ensureDigest(receipt.transitionTokenHash, "ChildReceipt.transitionTokenHash");
    ensureDigest(receipt.requestFingerprint, "ChildReceipt.requestFingerprint");
    ensureDigest(receipt.resultFingerprint, "ChildReceipt.resultFingerprint");
    const chain = await this.readChildChain(receipt.childWorkRunId);
    const committed = chain.find((child) => child.revision === receipt.childRevision);
    if (committed) {
      if (committed.fingerprint !== receipt.resultFingerprint) {
        throw new DomainConflictError("Child operation intent result fingerprint differs from its immutable revision");
      }
      await writeIfAbsentOrSame(this.childIntentPath(receipt.childWorkRunId, receipt.childRevision), receipt);
      await writeIfAbsentOrSame(this.childReceiptPath(receipt.transitionTokenHash), receipt);
      return deepClone(committed);
    }
    const base = chain.find((child) => child.revision === receipt.expectedRevision);
    if (!base) throw new DomainConflictError("Child operation intent references a missing base revision");
    const next = receipt.request.kind === "artifact-projection"
      ? this.nextChildForArtifact(base, receipt.request, receipt.committedAt)
      : this.nextChildForTransition(base, receipt.request, receipt.committedAt);
    if (next.fingerprint !== receipt.resultFingerprint) {
      throw new DomainConflictError("Recovered Child Work Run differs from its durable operation intent");
    }
    await writeIfAbsentOrSame(this.childIntentPath(receipt.childWorkRunId, receipt.childRevision), receipt);
    await writeIfAbsentOrSame(this.childReceiptPath(receipt.transitionTokenHash), receipt);
    await writeIfAbsentOrSame(this.childRevisionPath(receipt.childWorkRunId, receipt.childRevision), next);
    return deepClone(next);
  }

  private nextChildForArtifact(
    current: ChildWorkRun,
    request: Extract<ChildOperationSemantics, { kind: "artifact-projection" }>,
    committedAt: string,
  ): ChildWorkRun {
    if (isTerminal(current.lifecycle)) throw new DomainConflictError("Terminal Child Work Run does not accept artifacts");
    const artifact = validateArtifactProjection(deepClone(request.artifact));
    this.assertChildArtifact(current, artifact);
    if (current.artifacts.some((item) => item.projectionId === artifact.projectionId || item.artifactId === artifact.artifactId)) {
      throw new DomainConflictError("Artifact Projection identity already exists on Child Work Run");
    }
    this.assertArtifactOperationPolicy(current, artifact);
    return this.nextChild(current, request.actor, { artifacts: [...current.artifacts, artifact] }, committedAt);
  }

  private nextChildForTransition(
    current: ChildWorkRun,
    request: Extract<ChildOperationSemantics, { kind: "child-transition" }>,
    committedAt: string,
  ): ChildWorkRun {
    if (!childTransitionAllowed(current.lifecycle, request.lifecycle)) {
      throw new DomainConflictError(`Invalid Child Work Run transition ${current.lifecycle} -> ${request.lifecycle}`);
    }
    let artifacts = [...current.artifacts];
    let terminalDiagnosticArtifactId = current.terminalDiagnosticArtifactId;
    if (request.lifecycle === "failed" || request.lifecycle === "cancelled") {
      if (!request.diagnosticArtifact) throw new DomainValidationError("Failed or cancelled child requires a diagnostic artifact");
      const diagnostic = validateArtifactProjection(deepClone(request.diagnosticArtifact));
      this.assertChildArtifact(current, diagnostic);
      if (diagnostic.outputClass !== "diagnostic" || diagnostic.sideEffectClass !== "read-only") {
        throw new DomainValidationError("Terminal diagnostic artifact must be a read-only diagnostic");
      }
      artifacts = [...artifacts, diagnostic];
      terminalDiagnosticArtifactId = diagnostic.artifactId;
    } else if (request.diagnosticArtifact) {
      throw new DomainValidationError("Diagnostic artifact is only accepted for failed or cancelled transitions");
    }
    if (request.lifecycle === "completed") {
      const matching = artifacts.filter((artifact) => artifact.outputClass === current.expectedOutput.outputClass
        && artifact.mediaType === current.expectedOutput.mediaType);
      if (matching.length < current.expectedOutput.requiredArtifactCount) {
        throw new DomainConflictError("Child cannot complete before satisfying the locked expected-output contract");
      }
    }
    return this.nextChild(current, request.actor, {
      lifecycle: request.lifecycle,
      artifacts,
      ...(terminalDiagnosticArtifactId ? { terminalDiagnosticArtifactId } : {}),
    }, committedAt);
  }

  private nextChild(current: ChildWorkRun, actor: string, patch: Partial<ChildWorkRun>, updatedAt = this.now()): ChildWorkRun {
    const material: Omit<ChildWorkRun, "fingerprint"> = {
      ...current,
      ...patch,
      revision: current.revision + 1,
      previousRevision: { revision: current.revision, fingerprint: current.fingerprint },
      updatedAt,
      updatedBy: actor,
    };
    delete (material as Partial<ChildWorkRun>).fingerprint;
    return validateChildWorkRun({ ...material, fingerprint: canonicalDigest(childWorkRunFingerprintMaterial(material as ChildWorkRun)) });
  }

  private assertChildArtifact(child: ChildWorkRun, artifact: ArtifactProjection): void {
    if (artifact.projectId !== child.projectId || artifact.sourceWorkRunId !== child.workRunId || artifact.parentWorkRunId !== child.parentWorkRunId) {
      throw new DomainConflictError("Artifact Projection does not match Child/Project/Parent identities");
    }
    if (artifact.contextFingerprint !== child.assignment.contextEnvelopeFingerprint) {
      throw new DomainConflictError("Artifact Projection context fingerprint differs from the locked assignment");
    }
    if (artifact.producer.profileId !== child.assignment.profileId || artifact.producer.profileRevision !== child.assignment.profileRevision) {
      throw new DomainConflictError("Artifact Projection producer differs from the locked child assignment");
    }
  }

  private assertArtifactOperationPolicy(child: ChildWorkRun, artifact: ArtifactProjection): void {
    if (!isExternalSideEffect(artifact.sideEffectClass)) return;
    if (!artifact.operationTarget) {
      throw new DomainConflictError("External artifact lacks its exact external operation target");
    }
    const decision = authorizeCapabilityUse(child.grantSummary, {
      projectId: child.projectId,
      profileId: child.assignment.profileId,
      profileRevision: child.assignment.profileRevision,
      workRunId: child.workRunId,
      connector: artifact.operationTarget.connector,
      operation: artifact.operationTarget.operation,
      resource: artifact.operationTarget.resource,
      sideEffectClass: artifact.sideEffectClass,
      attemptedAt: artifact.createdAt,
    });
    if (!decision.allowed || artifact.operationWriteReview.state !== "approved"
      || artifact.operationWriteReview.approvedWorkRunId !== child.workRunId
      || artifact.operationWriteReview.grantId !== child.grantSummary.grantId
      || artifact.operationWriteReview.decisionFingerprint !== canonicalDigest(decision)) {
      throw new DomainConflictError("External artifact lacks explicit per-run Operation Write approval for its exact external operation target", { policyResult: decision });
    }
  }

  private async requireChild(workRunId: ChildWorkRun["workRunId"]): Promise<ChildWorkRun> {
    const child = await this.readChild(workRunId);
    if (!child) throw new DomainNotFoundError(`Child Work Run ${workRunId} does not exist`);
    return child;
  }

  private planPath(planId: DelegationPlan["planId"]): string {
    return join(this.scopeRoot, "plans", stableSuffix(planId), "plan.json");
  }

  private planDecisionPath(planId: DelegationPlan["planId"]): string {
    return join(this.scopeRoot, "plans", stableSuffix(planId), "approval.json");
  }

  private childRevisionPath(workRunId: ChildWorkRun["workRunId"], revision: number): string {
    return join(this.scopeRoot, "children", stableSuffix(workRunId), "revisions", `${String(revision).padStart(12, "0")}.json`);
  }

  private grantPath(grantId: CapabilityGrant["grantId"]): string {
    return join(this.scopeRoot, "grants", stableSuffix(grantId), "grant.json");
  }

  private delegationReceiptPath(tokenHash: string): string {
    return join(this.scopeRoot, "receipts", "delegations", digestSuffix(tokenHash), "receipt.json");
  }

  private childReceiptPath(tokenHash: string): string {
    return join(this.scopeRoot, "receipts", "children", digestSuffix(tokenHash), "receipt.json");
  }

  private childIntentPath(workRunId: ChildWorkRun["workRunId"], revision: number): string {
    return join(this.scopeRoot, "children", stableSuffix(workRunId), "intents", `${String(revision).padStart(12, "0")}.json`);
  }

  private readDelegationReceipt(tokenHash: string): Promise<DelegationReceipt | null> {
    return readJson<DelegationReceipt>(this.delegationReceiptPath(tokenHash));
  }

  private readPlanDecision(planId: DelegationPlan["planId"]): Promise<DelegationReceipt | null> {
    return readJson<DelegationReceipt>(this.planDecisionPath(planId));
  }

  private readChildReceipt(tokenHash: string): Promise<ChildReceipt | null> {
    return readJson<ChildReceipt>(this.childReceiptPath(tokenHash));
  }

  private readChildIntent(workRunId: ChildWorkRun["workRunId"], revision: number): Promise<ChildReceipt | null> {
    return readJson<ChildReceipt>(this.childIntentPath(workRunId, revision));
  }

  private async childRevisionNumbers(workRunId: ChildWorkRun["workRunId"]): Promise<number[]> {
    assertSafeSingleSegment(stableSuffix(workRunId), "Child Work Run ID");
    const directory = join(this.scopeRoot, "children", stableSuffix(workRunId), "revisions");
    try {
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(directory, { withFileTypes: true });
      return entries.filter((entry) => entry.isFile() && /^\d{12}\.json$/.test(entry.name))
        .map((entry) => Number.parseInt(entry.name.slice(0, 12), 10))
        .sort((left, right) => left - right);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private withLock<R>(action: () => Promise<R>): Promise<R> {
    return withRecoverableFileLock({
      lockPath: join(this.scopeRoot, ".lock"),
      now: this.now,
      timeoutMs: this.lockTimeoutMs,
      retryMs: this.lockRetryMs,
      staleLockMs: this.staleLockMs,
    }, action);
  }

  private async injectFault(point: CollaborationFaultPoint): Promise<void> {
    await this.faultInjector?.(point);
  }
}

export function childTransitionAllowed(from: ChildWorkRun["lifecycle"], to: ChildWorkRun["lifecycle"]): boolean {
  if (from === "ready") return to === "running" || to === "failed" || to === "cancelled";
  if (from === "running") return to === "completed" || to === "failed" || to === "cancelled";
  return false;
}

function isTerminal(lifecycle: ChildWorkRun["lifecycle"]): boolean {
  return lifecycle === "completed" || lifecycle === "failed" || lifecycle === "cancelled";
}

function assertConsultRevision(request: ContextConsultRequest, memory: MemoryRevision): void {
  assertMemoryIdentity(memory, request.projectId, request.targetAgent.profileId);
  const actual = memoryLock(memory);
  if (canonicalDigest(actual) !== canonicalDigest(request.asOf)) {
    throw new DomainConflictError("Context Consult reader did not return the exact approved as-of revision", { expected: request.asOf, actual });
  }
}

function assertMemoryIdentity(memory: MemoryRevision, projectId: ProjectId, profileId: ContextConsultRequest["targetAgent"]["profileId"]): void {
  if (memory.lifecycle !== "approved" || memory.projectId !== projectId || memory.profileId !== profileId) {
    throw new DomainConflictError("Context Consult memory is not the approved target Project/Agent revision");
  }
}

function memoryLock(memory: { revisionId: MemoryRevisionLock["revisionId"]; revision: number; fingerprint: string }): MemoryRevisionLock {
  return { revisionId: memory.revisionId, revision: memory.revision, fingerprint: memory.fingerprint };
}

function consultResource(request: ContextConsultRequest): string {
  return `${request.targetAgent.profileId}@${request.asOf.revisionId}`;
}

function dedupeProvenance(values: ProvenanceRef[]): ProvenanceRef[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = canonicalJson(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stableSuffix(value: string): string {
  const suffix = value.slice(value.indexOf("/") + 1);
  assertSafeSingleSegment(suffix, "stable identity suffix");
  return suffix;
}

function digestSuffix(value: string): string {
  ensureDigest(value, "digest");
  return value.slice("sha256:".length);
}

function ensureDigest(value: string, path: string): void {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw new DomainValidationError("Expected sha256 digest", path);
}

function revisionConflict(current: ChildWorkRun, expectedRevision: number): DomainConflictError {
  return new DomainConflictError("Child Work Run revision conflict", {
    expectedRevision,
    actualRevision: current.revision,
    currentFingerprint: current.fingerprint,
  });
}

function delegationApprovalRequestFingerprint(request: DelegationApprovalRequest): string {
  return canonicalDigest({
    kind: "delegation-approval",
    planId: request.planId,
    presentedFingerprint: request.presentedFingerprint,
    actor: request.actor,
    approvedExternalClasses: [...new Set(request.approvedExternalClasses)].sort(),
  });
}

function childImmutableFingerprint(child: ChildWorkRun): string {
  return canonicalDigest({
    schemaVersion: child.schemaVersion,
    workRunId: child.workRunId,
    projectId: child.projectId,
    parentWorkRunId: child.parentWorkRunId,
    delegationPlanId: child.delegationPlanId,
    delegationPlanFingerprint: child.delegationPlanFingerprint,
    assignment: child.assignment,
    expectedOutput: child.expectedOutput,
    inputArtifactIds: child.inputArtifactIds,
    grantSummary: child.grantSummary,
    parentStateEffect: child.parentStateEffect,
    createdAt: child.createdAt,
    createdBy: child.createdBy,
  });
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

async function readValidated<T>(path: string, validate: (value: T) => T): Promise<T | null> {
  const value = await readJson<T>(path);
  return value === null ? null : deepClone(validate(value));
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeIfAbsentOrSame(path: string, value: unknown): Promise<void> {
  assertSafeSharedState(value, "collaboration record");
  if (await exists(path)) {
    const existing = await readJson<unknown>(path);
    if (canonicalDigest(existing) !== canonicalDigest(value)) throw new DomainConflictError("Immutable collaboration record already exists with different content");
    return;
  }
  await atomicCreate(path, `${canonicalJson(value)}\n`);
}

async function atomicCreate(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (await exists(path)) throw new DomainConflictError("Immutable collaboration target already exists");
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export function artifactContentHash(content: JsonValue): string {
  return canonicalDigest(content);
}

export function outputRequiresPromotion(outputClass: RunOutputClass): boolean {
  return promotionReviewFor(outputClass, "probe").required;
}

export function sideEffectRequiresOperationWrite(effect: SideEffectClass): boolean {
  return isExternalSideEffect(effect);
}
