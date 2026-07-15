import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  ContextConsultStore,
  DelegationStore,
  authorizeCapabilityUse,
  canonicalDigest,
  createArtifactProjection,
  createCapabilityGrant,
  createContextConsultRequest,
  createDelegationPlan,
  childWorkRunFingerprintMaterial,
  validateContextConsultRequest,
  validateDelegationPlan,
  type AllowedPolicyDecision,
  type ArtifactProjection,
  type CapabilityGrant,
  type DelegationPlan,
  type MemoryRevision,
} from "../src/index.js";
import { NOW, approvedMemory, emptySections } from "./helpers.js";

const NEXT = "2026-07-15T00:10:00.000Z";
const EXPIRES = "2026-07-15T01:00:00.000Z";
const DEVICE_EXPIRES = "2026-07-15T02:00:00.000Z";
const policy: AllowedPolicyDecision = {
  allowed: true,
  policyVersion: "collaboration-policy/v1",
  reason: "Fixture actor is authorized for the exact Project and Work Run",
  decidedAt: NOW,
  actor: "user/tester",
};

test("collaboration fixtures satisfy their executable contract validators", async () => {
  const consult = JSON.parse(await readFile(new URL("../fixtures/context-consult-request.v1.json", import.meta.url), "utf8"));
  const delegation = JSON.parse(await readFile(new URL("../fixtures/delegation-plan.v1.json", import.meta.url), "utf8"));
  assert.equal(validateContextConsultRequest(consult).requestId, "context-consult/fixture");
  assert.equal(validateDelegationPlan(delegation).planId, "delegation-plan/fixture");
});

test("collaboration Work Run IDs use the cross-runtime lowercase-kebab contract", async () => {
  const consult = JSON.parse(await readFile(new URL("../fixtures/context-consult-request.v1.json", import.meta.url), "utf8"));
  const delegation = JSON.parse(await readFile(new URL("../fixtures/delegation-plan.v1.json", import.meta.url), "utf8"));
  assert.throws(() => validateContextConsultRequest({
    ...consult,
    requestingAgent: { ...consult.requestingAgent, workRunId: "work-run/Parent" },
  }), /Invalid stable identity/);
  assert.throws(() => validateDelegationPlan({
    ...delegation,
    parentWorkRunId: "work-run/parent.child",
  }), /Invalid stable identity/);
});

async function temporaryRoot(): Promise<{ root: string; cleanup(): Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "agent-collaboration-"));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

function consultGrant(): CapabilityGrant {
  return createCapabilityGrant({
    grantId: "grant/consult-fixture",
    projectId: "project/demo",
    profileId: "agent/planner",
    profileRevision: 3,
    workRunId: "work-run/parent",
    scope: {
      connectors: ["agent-memory"],
      operations: ["context.consult"],
      resources: ["agent/researcher@memory-revision/fixture-1"],
      sideEffectClasses: ["read-only"],
    },
    issuedAt: NOW,
    expiresAt: EXPIRES,
    issuedBy: "user/tester",
    policyDecision: policy,
    externalSideEffectApproval: { mode: "none", approvedClasses: [] },
  });
}

function plan(overrides: Partial<Parameters<typeof createDelegationPlan>[0]> = {}): DelegationPlan {
  return createDelegationPlan({
    planId: "delegation-plan/fixture",
    projectId: "project/demo",
    parentWorkRunId: "work-run/parent",
    objective: "Produce one provenance-preserving project conclusion",
    assignment: {
      assignmentPlanId: "assignment-plan/fixture",
      assignmentPlanVersion: 4,
      assignmentPlanFingerprint: canonicalDigest({ assignment: 4 }),
      deviceSnapshot: {
        snapshotId: "device-snapshot/fixture",
        deviceId: "device/test-5090",
        revision: 2,
        fingerprint: canonicalDigest({ device: 2 }),
        capturedAt: NOW,
        expiresAt: DEVICE_EXPIRES,
      },
      profileId: "agent/researcher",
      profileRevision: 7,
      bindingId: "binding/demo/researcher",
      bindingRevision: 5,
      contextEnvelopeFingerprint: canonicalDigest({ context: "locked" }),
    },
    inputArtifactIds: ["artifact/project-brief"],
    requestedCapabilityScope: {
      connectors: ["github"],
      operations: ["issue.comment"],
      resources: ["repo/Radiant303/SpringNote"],
      sideEffectClasses: ["read-only", "external-write"],
    },
    budget: {
      policyVersion: "budget-policy/v1",
      maxInputTokens: 20_000,
      maxOutputTokens: 4_000,
      maxDurationMs: 600_000,
      maxCostMinorUnits: 100,
      currency: "USD",
    },
    expiresAt: EXPIRES,
    expectedOutput: {
      outputClass: "durable-knowledge-candidate",
      mediaType: "text/markdown",
      requiredArtifactCount: 1,
      acceptanceCriteria: ["Cites the locked input artifact"],
    },
    sideEffectPolicy: {
      externalEffectsRequirePerRunApproval: true,
      requestedExternalClasses: ["external-write"],
    },
    provenance: [
      { kind: "workRun", id: "work-run/parent" },
      { kind: "artifact", id: "artifact/project-brief" },
      { kind: "deviceCapability", id: "device-snapshot/fixture", revision: 2, fingerprint: canonicalDigest({ device: 2 }) },
    ],
    createdAt: NOW,
    createdBy: "user/tester",
    ...overrides,
  });
}

function childArtifact(child: Awaited<ReturnType<DelegationStore["readChild"]>> extends infer T ? NonNullable<T> : never, options: {
  id: string;
  outputClass?: "durable-knowledge-candidate" | "diagnostic";
  sideEffectClass?: "read-only" | "external-write";
  grant?: CapabilityGrant;
  operationTarget?: { connector: string; operation: string; resource: string };
}): ArtifactProjection {
  return createArtifactProjection({
    projectionId: `artifact-projection/${options.id}`,
    artifactId: `artifact/${options.id}`,
    projectId: child.projectId,
    producer: {
      kind: "child-work-run",
      profileId: child.assignment.profileId,
      profileRevision: child.assignment.profileRevision,
    },
    sourceWorkRunId: child.workRunId,
    parentWorkRunId: child.parentWorkRunId,
    contextFingerprint: child.assignment.contextEnvelopeFingerprint,
    inputArtifactIds: [...child.inputArtifactIds],
    contentHash: canonicalDigest({ artifact: options.id }),
    mediaType: "text/markdown",
    outputClass: options.outputClass ?? "durable-knowledge-candidate",
    sideEffectClass: options.sideEffectClass ?? "read-only",
    provenance: [
      { kind: "workRun", id: child.workRunId, revision: child.revision },
      { kind: "artifact", id: "artifact/project-brief" },
    ],
    warnings: [],
    createdAt: NEXT,
    promotionPolicyVersion: "promotion-policy/v1",
    operationWritePolicyVersion: "operation-write-policy/v1",
    ...(options.sideEffectClass === "external-write" ? {
      operationTarget: options.operationTarget ?? {
        connector: "github",
        operation: "issue.comment",
        resource: "repo/Radiant303/SpringNote",
      },
    } : {}),
    ...(options.grant ? { grant: options.grant } : {}),
  });
}

test("Context Consult is as-of, immutable, stale-aware, and idempotent", async () => {
  const temp = await temporaryRoot();
  try {
    const sourceMemory = approvedMemory({
      ...emptySections(),
      stableMemory: {
        content: "A reviewed source fact",
        citations: ["source/fixture"],
        contentHash: canonicalDigest({ content: "A reviewed source fact", citations: ["source/fixture"] }),
      },
    });
    const requestingMemory = approvedMemory();
    const sourceBefore = canonicalDigest(sourceMemory);
    const requestingBefore = canonicalDigest(requestingMemory);
    const currentMemory: MemoryRevision = {
      ...sourceMemory,
      revisionId: "memory-revision/fixture-2",
      revision: 2,
      previousRevisionId: sourceMemory.revisionId,
      previousFingerprint: sourceMemory.fingerprint,
      fingerprint: canonicalDigest({ revision: 2, source: sourceMemory.fingerprint }),
    };
    let workerInputFrozen = false;
    let reads = 0;
    const grant = consultGrant();
    const request = createContextConsultRequest({
      requestId: "context-consult/fixture",
      projectId: "project/demo",
      requestingAgent: { profileId: "agent/planner", profileRevision: 3, workRunId: "work-run/parent" },
      targetAgent: { profileId: "agent/researcher", profileRevision: 1 },
      attachTo: { kind: "workRun", id: "work-run/parent" },
      objective: "Consult only the reviewed stable-memory fact",
      requestedSections: ["stableMemory"],
      asOf: { revisionId: sourceMemory.revisionId, revision: sourceMemory.revision, fingerprint: sourceMemory.fingerprint },
      contextFingerprint: canonicalDigest({ requester: "locked" }),
      capabilityGrantId: grant.grantId,
      authorizationDecision: policy,
      provenance: [{ kind: "workRun", id: "work-run/parent" }],
      createdAt: NOW,
      expiresAt: EXPIRES,
      invocationToken: "consult-token",
    });
    const store = new ContextConsultStore({ collaborationRoot: temp.root, projectId: "project/demo", clock: () => NEXT });
    const first = await store.execute({
      request,
      invocationToken: "consult-token",
      grant,
      targetMemory: {
        async readApprovedRevision() { reads += 1; return structuredClone(sourceMemory); },
        async readCurrentApprovedRevision() { reads += 1; return structuredClone(currentMemory); },
      },
      worker: {
        async generate(input) {
          workerInputFrozen = Object.isFrozen(input) && Object.isFrozen(input.sections) && Object.isFrozen(input.sections.stableMemory!);
          assert.deepEqual(Object.keys(input.sections), ["stableMemory"]);
          return {
            content: { answer: input.sections.stableMemory!.content },
            mediaType: "application/json",
            outputClass: "durable-knowledge-candidate",
            provenance: [{ kind: "memoryRevision", id: input.asOf.revisionId, fingerprint: input.asOf.fingerprint }],
          };
        },
      },
    });
    assert.equal(first.idempotent, false);
    assert.equal(first.result.freshness, "stale");
    assert.equal(first.result.staleForCurrentContextOperations, true);
    assert.equal(first.result.consultedRevision.fingerprint, sourceMemory.fingerprint);
    assert.equal(first.result.artifact.contextFingerprint, sourceMemory.fingerprint);
    assert.equal(first.result.artifact.promotionReview.state, "candidate-required");
    assert.equal(first.result.artifact.operationWriteReview.state, "not-required");
    assert.equal(workerInputFrozen, true);
    assert.equal(canonicalDigest(sourceMemory), sourceBefore);
    assert.equal(canonicalDigest(requestingMemory), requestingBefore);

    const replay = await store.execute({
      request,
      invocationToken: "consult-token",
      grant,
      targetMemory: {
        async readApprovedRevision() { throw new Error("replay must not read memory again"); },
        async readCurrentApprovedRevision() { throw new Error("replay must not read memory again"); },
      },
      worker: { async generate() { throw new Error("replay must not regenerate"); } },
    });
    assert.equal(replay.idempotent, true);
    assert.equal(replay.result.fingerprint, first.result.fingerprint);
    assert.equal(reads, 2);

    const {
      schemaVersion: _schemaVersion,
      invocationTokenHash: _invocationTokenHash,
      fingerprint: _fingerprint,
      ...requestInput
    } = request;
    const changedRequest = createContextConsultRequest({
      ...requestInput,
      objective: "Changed objective must not replay under the same invocation token",
      invocationToken: "consult-token",
    });
    await assert.rejects(() => store.execute({
      request: changedRequest,
      invocationToken: "consult-token",
      grant,
      targetMemory: {
        async readApprovedRevision() { throw new Error("changed replay must fail before memory access"); },
        async readCurrentApprovedRevision() { throw new Error("changed replay must fail before memory access"); },
      },
      worker: { async generate() { throw new Error("changed replay must not regenerate"); } },
    }), /replay changed Context Consult request semantics/);
  } finally {
    await temp.cleanup();
  }
});

test("Capability Grant denies every dimension outside its exact scope and expiry", () => {
  const grant = consultGrant();
  const base = {
    projectId: "project/demo" as const,
    profileId: "agent/planner" as const,
    profileRevision: 3,
    workRunId: "work-run/parent" as const,
    connector: "agent-memory",
    operation: "context.consult",
    resource: "agent/researcher@memory-revision/fixture-1",
    sideEffectClass: "read-only" as const,
    attemptedAt: NEXT,
  };
  assert.equal(authorizeCapabilityUse(grant, base).allowed, true);
  for (const changed of [
    { projectId: "project/other" as const },
    { profileId: "agent/other" as const },
    { profileRevision: 4 },
    { workRunId: "work-run/other" as const },
    { connector: "github" },
    { operation: "context.write" },
    { resource: "agent/other@memory-revision/fixture-1" },
    { attemptedAt: EXPIRES },
  ]) {
    assert.equal(authorizeCapabilityUse(grant, { ...base, ...changed }).allowed, false);
  }
});

test("Delegation approval creates exactly one same-Project child with locked inputs and per-run grant", async () => {
  const temp = await temporaryRoot();
  try {
    const store = new DelegationStore({ collaborationRoot: temp.root, projectId: "project/demo", clock: () => NEXT });
    const createdPlan = await store.createPlan(plan());
    const request = {
      planId: createdPlan.planId,
      presentedFingerprint: createdPlan.fingerprint,
      transitionToken: "approve-fixture",
      actor: "user/tester",
      approvedExternalClasses: ["external-write" as const],
      authorize: async () => policy,
    };
    const approved = await store.approve(request);
    const replay = await store.approve(request);
    assert.equal(approved.idempotent, false);
    assert.equal(replay.idempotent, true);
    assert.equal(replay.child.workRunId, approved.child.workRunId);
    assert.equal(replay.grant.grantId, approved.grant.grantId);
    assert.equal(approved.child.projectId, createdPlan.projectId);
    assert.equal(approved.child.parentWorkRunId, createdPlan.parentWorkRunId);
    assert.deepEqual(approved.child.assignment, createdPlan.assignment);
    assert.deepEqual(approved.child.expectedOutput, createdPlan.expectedOutput);
    assert.equal(approved.child.parentStateEffect, "none");
    assert.equal(approved.grant.externalSideEffectApproval.mode, "per-run");
    assert.equal(approved.grant.externalSideEffectApproval.approvedWorkRunId, approved.child.workRunId);
    assert.doesNotMatch(JSON.stringify(approved.grant), /token|credential|password|secret/i);
  } finally {
    await temp.cleanup();
  }
});

test("a stale collaboration lock left by a crashed process is recovered conservatively", async () => {
  const temp = await temporaryRoot();
  try {
    const lockDirectory = join(temp.root, "demo", "delegations");
    const lockPath = join(lockDirectory, ".lock");
    await mkdir(lockDirectory, { recursive: true });
    await writeFile(lockPath, JSON.stringify({ schemaVersion: 1, ownerId: "crashed-owner", pid: 2_147_483_647, acquiredAt: "2020-01-01T00:00:00.000Z" }), "utf8");
    await utimes(lockPath, new Date(0), new Date(0));
    const store = new DelegationStore({
      collaborationRoot: temp.root,
      projectId: "project/demo",
      clock: () => NEXT,
      lockTimeoutMs: 100,
      lockRetryMs: 5,
      staleLockMs: 10,
    });
    const created = await store.createPlan(plan({ planId: "delegation-plan/stale-lock" }));
    assert.equal(created.planId, "delegation-plan/stale-lock");
  } finally {
    await temp.cleanup();
  }
});

test("a live owner cannot be evicted only because its heartbeat mtime appears stale", async () => {
  const temp = await temporaryRoot();
  try {
    const lockDirectory = join(temp.root, "demo", "delegations");
    const lockPath = join(lockDirectory, ".lock");
    await mkdir(lockDirectory, { recursive: true });
    await writeFile(lockPath, JSON.stringify({
      schemaVersion: 1,
      ownerId: "live-owner",
      pid: process.pid,
      acquiredAt: "2020-01-01T00:00:00.000Z",
    }), "utf8");
    await utimes(lockPath, new Date(0), new Date(0));
    const store = new DelegationStore({
      collaborationRoot: temp.root,
      projectId: "project/demo",
      clock: () => NEXT,
      lockTimeoutMs: 25,
      lockRetryMs: 5,
      staleLockMs: 10,
    });
    await assert.rejects(
      () => store.createPlan(plan({ planId: "delegation-plan/live-lock" })),
      /Timed out after 25ms waiting for an Agent Domain lock/,
    );
    const serialized = await readFile(lockPath, "utf8");
    assert.match(serialized, /"ownerId":"live-owner"/);
  } finally {
    await temp.cleanup();
  }
});

test("Delegation approval recovers the exact same child and grant after its durable intent is interrupted", async () => {
  const temp = await temporaryRoot();
  try {
    const createdPlan = plan({ planId: "delegation-plan/interrupted-approval" });
    let interrupted = false;
    const first = new DelegationStore({
      collaborationRoot: temp.root,
      projectId: "project/demo",
      clock: () => NEXT,
      faultInjector(point) {
        if (!interrupted && point === "after-delegation-intent") {
          interrupted = true;
          throw new Error("simulated delegation approval interruption");
        }
      },
    });
    await first.createPlan(createdPlan);
    const request = {
      planId: createdPlan.planId,
      presentedFingerprint: createdPlan.fingerprint,
      transitionToken: "recover-delegation-approval",
      actor: "user/tester",
      approvedExternalClasses: ["external-write" as const],
      authorize: async () => policy,
    };
    await assert.rejects(() => first.approve(request), /simulated delegation approval interruption/);

    const recovered = await new DelegationStore({
      collaborationRoot: temp.root,
      projectId: "project/demo",
      clock: () => "2026-07-15T00:20:00.000Z",
    }).approve(request);
    assert.equal(recovered.idempotent, true);
    assert.equal(recovered.child.revision, 1);
    assert.equal(recovered.child.createdAt, NEXT);
    assert.equal(recovered.grant.issuedAt, NEXT);

    const replay = await new DelegationStore({
      collaborationRoot: temp.root,
      projectId: "project/demo",
      clock: () => "2026-07-15T00:30:00.000Z",
    }).approve(request);
    assert.equal(replay.idempotent, true);
    assert.equal(replay.child.fingerprint, recovered.child.fingerprint);
    assert.equal(replay.grant.fingerprint, recovered.grant.fingerprint);
    await assert.rejects(() => new DelegationStore({
      collaborationRoot: temp.root,
      projectId: "project/demo",
      clock: () => "2026-07-15T00:30:00.000Z",
    }).approve({ ...request, actor: "user/other" }), /different approval semantics/);
  } finally {
    await temp.cleanup();
  }
});

test("external delegation is denied unless the exact per-run side-effect classes are approved", async () => {
  const temp = await temporaryRoot();
  try {
    const store = new DelegationStore({ collaborationRoot: temp.root, projectId: "project/demo", clock: () => NEXT });
    const createdPlan = await store.createPlan(plan());
    await assert.rejects(() => store.approve({
      planId: createdPlan.planId,
      presentedFingerprint: createdPlan.fingerprint,
      transitionToken: "missing-external-approval",
      actor: "user/tester",
      approvedExternalClasses: [],
      authorize: async () => policy,
    }), /explicit approval/);
    assert.equal(await store.readChild("work-run/child-impossible"), null);
  } finally {
    await temp.cleanup();
  }
});

test("child projects reviewed artifacts, completes independently, and replay never terminates parent", async () => {
  const temp = await temporaryRoot();
  try {
    const parent = { workRunId: "work-run/parent", lifecycle: "running", revision: 9 } as const;
    const parentBefore = canonicalDigest(parent);
    const store = new DelegationStore({ collaborationRoot: temp.root, projectId: "project/demo", clock: () => NEXT });
    const createdPlan = await store.createPlan(plan());
    const approved = await store.approve({
      planId: createdPlan.planId,
      presentedFingerprint: createdPlan.fingerprint,
      transitionToken: "approve-child",
      actor: "user/tester",
      approvedExternalClasses: ["external-write"],
      authorize: async () => policy,
    });
    const started = await store.transition(approved.child.workRunId, {
      expectedRevision: 1,
      lifecycle: "running",
      transitionToken: "start-child",
      actor: "user/tester",
    });
    const artifact = childArtifact(started.child, { id: "child-conclusion", sideEffectClass: "external-write", grant: approved.grant });
    assert.equal(artifact.promotionReview.state, "candidate-required");
    assert.equal(artifact.operationWriteReview.state, "approved");
    const projected = await store.projectArtifact(approved.child.workRunId, {
      expectedRevision: 2,
      transitionToken: "project-child-artifact",
      actor: "user/tester",
      artifact,
    });
    const projectionReplay = await store.projectArtifact(approved.child.workRunId, {
      expectedRevision: 2,
      transitionToken: "project-child-artifact",
      actor: "user/tester",
      artifact,
    });
    assert.equal(projected.child.revision, 3);
    assert.equal(projectionReplay.idempotent, true);
    assert.equal(projectionReplay.child.revision, 3);
    const completed = await store.transition(approved.child.workRunId, {
      expectedRevision: 3,
      lifecycle: "completed",
      transitionToken: "complete-child",
      actor: "user/tester",
    });
    assert.equal(completed.child.lifecycle, "completed");
    assert.equal(completed.child.parentStateEffect, "none");
    assert.equal(completed.child.artifacts[0]!.promotionReview.state, "candidate-required");
    assert.equal(canonicalDigest(parent), parentBefore);
  } finally {
    await temp.cleanup();
  }
});

test("Child transition recovers from a durable intent written before its immutable revision", async () => {
  const temp = await temporaryRoot();
  try {
    const bootstrap = new DelegationStore({ collaborationRoot: temp.root, projectId: "project/demo", clock: () => NEXT });
    const createdPlan = await bootstrap.createPlan(plan({ planId: "delegation-plan/interrupted-child" }));
    const approved = await bootstrap.approve({
      planId: createdPlan.planId,
      presentedFingerprint: createdPlan.fingerprint,
      transitionToken: "approve-interrupted-child",
      actor: "user/tester",
      approvedExternalClasses: ["external-write"],
      authorize: async () => policy,
    });
    let interrupted = false;
    const first = new DelegationStore({
      collaborationRoot: temp.root,
      projectId: "project/demo",
      clock: () => NEXT,
      faultInjector(point) {
        if (!interrupted && point === "after-child-intent") {
          interrupted = true;
          throw new Error("simulated child transition interruption");
        }
      },
    });
    const request = {
      expectedRevision: 1,
      lifecycle: "running" as const,
      transitionToken: "recover-child-transition",
      actor: "user/tester",
    };
    await assert.rejects(() => first.transition(approved.child.workRunId, request), /simulated child transition interruption/);

    const recovered = await new DelegationStore({
      collaborationRoot: temp.root,
      projectId: "project/demo",
      clock: () => "2026-07-15T00:20:00.000Z",
    }).transition(approved.child.workRunId, request);
    assert.equal(recovered.idempotent, true);
    assert.equal(recovered.child.revision, 2);
    assert.equal(recovered.child.lifecycle, "running");
    assert.equal(recovered.child.updatedAt, NEXT);
  } finally {
    await temp.cleanup();
  }
});

test("Artifact projection recovers from a durable intent and rejects changed replay semantics", async () => {
  const temp = await temporaryRoot();
  try {
    const bootstrap = new DelegationStore({ collaborationRoot: temp.root, projectId: "project/demo", clock: () => NEXT });
    const createdPlan = await bootstrap.createPlan(plan({ planId: "delegation-plan/interrupted-artifact" }));
    const approved = await bootstrap.approve({
      planId: createdPlan.planId,
      presentedFingerprint: createdPlan.fingerprint,
      transitionToken: "approve-interrupted-artifact",
      actor: "user/tester",
      approvedExternalClasses: ["external-write"],
      authorize: async () => policy,
    });
    const started = await bootstrap.transition(approved.child.workRunId, {
      expectedRevision: 1,
      lifecycle: "running",
      transitionToken: "start-interrupted-artifact",
      actor: "user/tester",
    });
    const artifact = childArtifact(started.child, { id: "interrupted-artifact" });
    let interrupted = false;
    const first = new DelegationStore({
      collaborationRoot: temp.root,
      projectId: "project/demo",
      clock: () => NEXT,
      faultInjector(point) {
        if (!interrupted && point === "after-child-intent") {
          interrupted = true;
          throw new Error("simulated artifact projection interruption");
        }
      },
    });
    const request = {
      expectedRevision: 2,
      transitionToken: "recover-artifact-projection",
      actor: "user/tester",
      artifact,
    };
    await assert.rejects(() => first.projectArtifact(approved.child.workRunId, request), /simulated artifact projection interruption/);
    const recovered = await bootstrap.projectArtifact(approved.child.workRunId, request);
    assert.equal(recovered.idempotent, true);
    assert.equal(recovered.child.revision, 3);
    assert.equal(recovered.child.artifacts[0]?.fingerprint, artifact.fingerprint);
    await assert.rejects(() => bootstrap.projectArtifact(approved.child.workRunId, {
      ...request,
      actor: "user/other",
    }), /different child operation semantics/);
  } finally {
    await temp.cleanup();
  }
});

test("Child transition token is bound to kind, actor, expected revision, and canonical request semantics", async () => {
  const temp = await temporaryRoot();
  try {
    const store = new DelegationStore({ collaborationRoot: temp.root, projectId: "project/demo", clock: () => NEXT });
    const createdPlan = await store.createPlan(plan({ planId: "delegation-plan/token-binding" }));
    const approved = await store.approve({
      planId: createdPlan.planId,
      presentedFingerprint: createdPlan.fingerprint,
      transitionToken: "approve-token-binding",
      actor: "user/tester",
      approvedExternalClasses: ["external-write"],
      authorize: async () => policy,
    });
    await store.transition(approved.child.workRunId, {
      expectedRevision: 1,
      lifecycle: "running",
      transitionToken: "bound-child-token",
      actor: "user/tester",
    });
    await assert.rejects(() => store.transition(approved.child.workRunId, {
      expectedRevision: 1,
      lifecycle: "failed",
      transitionToken: "bound-child-token",
      actor: "user/other",
      diagnosticArtifact: childArtifact(approved.child, { id: "token-mismatch", outputClass: "diagnostic" }),
    }), /different child operation semantics/);
    await assert.rejects(() => store.projectArtifact(approved.child.workRunId, {
      expectedRevision: 1,
      transitionToken: "bound-child-token",
      actor: "user/tester",
      artifact: childArtifact(approved.child, { id: "cross-kind" }),
    }), /different child operation semantics/);
  } finally {
    await temp.cleanup();
  }
});

test("Child Work Run reads reject revision gaps, predecessor tampering, and immutable identity changes", async () => {
  const temp = await temporaryRoot();
  try {
    const store = new DelegationStore({ collaborationRoot: temp.root, projectId: "project/demo", clock: () => NEXT });
    const predecessorPlan = await store.createPlan(plan({ planId: "delegation-plan/predecessor-chain" }));
    const predecessorChild = await store.approve({
      planId: predecessorPlan.planId,
      presentedFingerprint: predecessorPlan.fingerprint,
      transitionToken: "approve-predecessor-chain",
      actor: "user/tester",
      approvedExternalClasses: ["external-write"],
      authorize: async () => policy,
    });
    const revision2 = await store.transition(predecessorChild.child.workRunId, {
      expectedRevision: 1,
      lifecycle: "running",
      transitionToken: "start-predecessor-chain",
      actor: "user/tester",
    });
    const tamperedMaterial = {
      ...revision2.child,
      revision: 3,
      previousRevision: { revision: 2, fingerprint: canonicalDigest({ forged: true }) },
      updatedAt: "2026-07-15T00:20:00.000Z",
    };
    delete (tamperedMaterial as Partial<typeof revision2.child>).fingerprint;
    const tampered = {
      ...tamperedMaterial,
      fingerprint: canonicalDigest(childWorkRunFingerprintMaterial(tamperedMaterial as typeof revision2.child)),
    };
    const predecessorDirectory = join(temp.root, "demo", "delegations", "children", predecessorChild.child.workRunId.slice("work-run/".length), "revisions");
    await writeFile(join(predecessorDirectory, "000000000003.json"), JSON.stringify(tampered), "utf8");
    await assert.rejects(() => store.readChild(predecessorChild.child.workRunId), /predecessor fingerprint/);

    const gapPlan = await store.createPlan(plan({ planId: "delegation-plan/gapped-chain" }));
    const gapChild = await store.approve({
      planId: gapPlan.planId,
      presentedFingerprint: gapPlan.fingerprint,
      transitionToken: "approve-gapped-chain",
      actor: "user/tester",
      approvedExternalClasses: ["external-write"],
      authorize: async () => policy,
    });
    const gappedMaterial = {
      ...gapChild.child,
      revision: 3,
      previousRevision: { revision: 2, fingerprint: canonicalDigest({ missing: 2 }) },
      updatedAt: "2026-07-15T00:20:00.000Z",
    };
    delete (gappedMaterial as Partial<typeof gapChild.child>).fingerprint;
    const gapped = {
      ...gappedMaterial,
      fingerprint: canonicalDigest(childWorkRunFingerprintMaterial(gappedMaterial as typeof gapChild.child)),
    };
    const gapDirectory = join(temp.root, "demo", "delegations", "children", gapChild.child.workRunId.slice("work-run/".length), "revisions");
    await mkdir(gapDirectory, { recursive: true });
    await writeFile(join(gapDirectory, "000000000003.json"), JSON.stringify(gapped), "utf8");
    await assert.rejects(() => store.readChild(gapChild.child.workRunId), /not contiguous/);

    const identityPlan = await store.createPlan(plan({ planId: "delegation-plan/identity-chain" }));
    const identityChild = await store.approve({
      planId: identityPlan.planId,
      presentedFingerprint: identityPlan.fingerprint,
      transitionToken: "approve-identity-chain",
      actor: "user/tester",
      approvedExternalClasses: ["external-write"],
      authorize: async () => policy,
    });
    const identityMaterial = {
      ...identityChild.child,
      revision: 2,
      previousRevision: { revision: 1, fingerprint: identityChild.child.fingerprint },
      parentWorkRunId: "work-run/other-parent" as const,
      updatedAt: "2026-07-15T00:20:00.000Z",
    };
    delete (identityMaterial as Partial<typeof identityChild.child>).fingerprint;
    const identityTampered = {
      ...identityMaterial,
      fingerprint: canonicalDigest(childWorkRunFingerprintMaterial(identityMaterial as typeof identityChild.child)),
    };
    const identityDirectory = join(temp.root, "demo", "delegations", "children", identityChild.child.workRunId.slice("work-run/".length), "revisions");
    await writeFile(join(identityDirectory, "000000000002.json"), JSON.stringify(identityTampered), "utf8");
    await assert.rejects(() => store.readChild(identityChild.child.workRunId), /immutable identity changed/);
  } finally {
    await temp.cleanup();
  }
});

for (const lifecycle of ["failed", "cancelled"] as const) {
  test(`child ${lifecycle} records a replay-safe diagnostic without changing parent state`, async () => {
    const temp = await temporaryRoot();
    try {
      const parent = { workRunId: "work-run/parent", lifecycle: "running", revision: 9 } as const;
      const parentBefore = canonicalDigest(parent);
      const uniquePlan = plan({ planId: `delegation-plan/${lifecycle}` });
      const store = new DelegationStore({ collaborationRoot: temp.root, projectId: "project/demo", clock: () => NEXT });
      await store.createPlan(uniquePlan);
      const approved = await store.approve({
        planId: uniquePlan.planId,
        presentedFingerprint: uniquePlan.fingerprint,
        transitionToken: `approve-${lifecycle}`,
        actor: "user/tester",
        approvedExternalClasses: ["external-write"],
        authorize: async () => policy,
      });
      const diagnostic = childArtifact(approved.child, { id: `${lifecycle}-diagnostic`, outputClass: "diagnostic", sideEffectClass: "read-only" });
      const terminal = await store.transition(approved.child.workRunId, {
        expectedRevision: 1,
        lifecycle,
        transitionToken: `${lifecycle}-token`,
        actor: "user/tester",
        diagnosticArtifact: diagnostic,
      });
      const replay = await store.transition(approved.child.workRunId, {
        expectedRevision: 1,
        lifecycle,
        transitionToken: `${lifecycle}-token`,
        actor: "user/tester",
        diagnosticArtifact: diagnostic,
      });
      assert.equal(terminal.child.lifecycle, lifecycle);
      assert.equal(terminal.child.terminalDiagnosticArtifactId, diagnostic.artifactId);
      assert.equal(terminal.child.parentStateEffect, "none");
      assert.equal(replay.idempotent, true);
      assert.equal(replay.child.revision, terminal.child.revision);
      assert.equal(canonicalDigest(parent), parentBefore);
    } finally {
      await temp.cleanup();
    }
  });
}

test("Operation Write Policy rejects an external artifact not bound to the child grant", async () => {
  const temp = await temporaryRoot();
  try {
    const store = new DelegationStore({ collaborationRoot: temp.root, projectId: "project/demo", clock: () => NEXT });
    const createdPlan = await store.createPlan(plan({ planId: "delegation-plan/unapproved-artifact" }));
    const approved = await store.approve({
      planId: createdPlan.planId,
      presentedFingerprint: createdPlan.fingerprint,
      transitionToken: "approve-unapproved-artifact",
      actor: "user/tester",
      approvedExternalClasses: ["external-write"],
      authorize: async () => policy,
    });
    const artifact = childArtifact(approved.child, { id: "unapproved-external", sideEffectClass: "external-write" });
    assert.equal(artifact.operationWriteReview.state, "approval-required");
    await assert.rejects(() => store.projectArtifact(approved.child.workRunId, {
      expectedRevision: 1,
      transitionToken: "project-unapproved-external",
      actor: "user/tester",
      artifact,
    }), /per-run Operation Write approval/);
    assert.equal((await store.readChild(approved.child.workRunId))!.revision, 1);
  } finally {
    await temp.cleanup();
  }
});

test("Operation Write approval is bound to the artifact's exact connector, operation, and resource", async () => {
  const temp = await temporaryRoot();
  try {
    const store = new DelegationStore({ collaborationRoot: temp.root, projectId: "project/demo", clock: () => NEXT });
    const createdPlan = await store.createPlan(plan({ planId: "delegation-plan/wrong-operation-target" }));
    const approved = await store.approve({
      planId: createdPlan.planId,
      presentedFingerprint: createdPlan.fingerprint,
      transitionToken: "approve-wrong-operation-target",
      actor: "user/tester",
      approvedExternalClasses: ["external-write"],
      authorize: async () => policy,
    });
    const artifact = childArtifact(approved.child, {
      id: "wrong-operation-target",
      sideEffectClass: "external-write",
      grant: approved.grant,
      operationTarget: {
        connector: "github",
        operation: "issue.comment",
        resource: "repo/other/private-repository",
      },
    });
    await assert.rejects(() => store.projectArtifact(approved.child.workRunId, {
      expectedRevision: 1,
      transitionToken: "project-wrong-operation-target",
      actor: "user/tester",
      artifact,
    }), /exact external operation target/);
    assert.equal((await store.readChild(approved.child.workRunId))!.revision, 1);
  } finally {
    await temp.cleanup();
  }
});
