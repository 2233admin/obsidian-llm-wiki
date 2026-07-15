import assert from "node:assert/strict";
import { readdirSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
  canonicalDigest,
  createDelegationPlan,
  dreamTimeSourceFingerprint,
  makeMemorySection,
  type DreamTimeWorkerInput,
  type MemoryProposalCandidate,
} from "../../packages/agent-domain/dist/src/index.js";
import {
  connector as hostConnector,
  descriptor as hostDescriptor,
  health as hostHealth,
  policy as hostPolicy,
  requirement as hostRequirement,
} from "../../mcp-server/src/host-capabilities/test-fixtures";
import { normalizedProjectContext, resolveProjectContext } from "../../mcp-server/src/project/project-context";
import {
  OBSIDIAN_CONTROL_PLANE_ACTOR,
  ProductionControlPlaneTransport,
} from "../src/production-control-plane-host";
import { AgentControlPlaneClient } from "../src/control-plane-client";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("production registry executes Settings, Agent, Dream Time, Project Hub, Usage, and Promotion through one dispatcher", async () => {
  const vaultPath = mkdtempSync(join(tmpdir(), "llmwiki-obsidian-production-"));
  roots.push(vaultPath);
  const transport = new ProductionControlPlaneTransport({
    vaultPath,
    userDeviceId: "device-test",
    userDevicePath: join(vaultPath, "device-settings.json"),
    environment: {},
  });

  const definitions = await invoke<{ definitions: unknown[] }>(transport, "settings.definitions.list");
  assert.ok(definitions.definitions.length > 0);

  const project = await invoke<{ projectId: string }>(transport, "project.init", {
    project: "alpha",
    description: "Production registry acceptance",
  });
  assert.equal(project.projectId, "project/alpha");
  mkdirSync(join(vaultPath, "01-Projects", "alpha", "runs"), { recursive: true });
  writeFileSync(join(vaultPath, "01-Projects", "alpha", "runs", "parent.json"), JSON.stringify({
    schema_version: 2,
    work_run_id: "work-run/parent",
    project_id: "project/alpha",
    state: "running",
    artifact_projections: [{ artifact_id: "artifact/run-input" }],
  }), "utf-8");

  const profileResult = await invoke<{ status: string; record: Record<string, unknown> }>(transport, "agent.profile.create", {
    input: {
      profileId: "agent/researcher",
      displayName: "Researcher",
      role: "Project researcher",
      responsibilities: ["Preserve governed context"],
      capabilityClaims: ["source-synthesis"],
      constitution: { principles: ["Cite sources"], instructions: ["Preserve provenance"] },
      defaultModelPolicy: { mode: "local", provider: "local", model: "fixture-model" },
      actor: OBSIDIAN_CONTROL_PLANE_ACTOR,
    },
  });
  assert.equal(profileResult.status, "committed");
  assert.equal(profileResult.record.profileId, "agent/researcher");
  await invoke(transport, "agent.profile.create", {
    input: {
      profileId: "agent/planner",
      displayName: "Planner",
      role: "Requesting planner",
      responsibilities: ["Request governed consultation"],
      capabilityClaims: ["context-consult"],
      constitution: { principles: ["Use scoped grants"], instructions: ["Preserve provenance"] },
      defaultModelPolicy: { mode: "local", provider: "local", model: "fixture-model" },
      actor: OBSIDIAN_CONTROL_PLANE_ACTOR,
    },
  });

  const projectContextFingerprint = canonicalDigest(
    normalizedProjectContext(resolveProjectContext(vaultPath, "project/alpha")),
  );
  const bindingResult = await invoke<{ status: string; record: Record<string, unknown> }>(transport, "agent.binding.create", {
    input: {
      projectId: "project/alpha",
      projectContextFingerprint,
      profileId: "agent/researcher",
      profileRevision: 1,
      role: "Project researcher",
      connectorGrantRefs: [],
      actor: OBSIDIAN_CONTROL_PLANE_ACTOR,
    },
  });
  assert.equal(bindingResult.status, "committed");
  const binding = bindingResult.record;
  assert.equal(binding.bindingId, "binding/alpha/researcher");
  const plannerBindingResult = await invoke<{ status: string; record: Record<string, unknown> }>(transport, "agent.binding.create", {
    input: {
      projectId: "project/alpha",
      projectContextFingerprint,
      profileId: "agent/planner",
      profileRevision: 1,
      role: "Requesting planner",
      connectorGrantRefs: [],
      actor: OBSIDIAN_CONTROL_PLANE_ACTOR,
    },
  });
  assert.equal(plannerBindingResult.status, "committed");
  assert.equal(plannerBindingResult.record.bindingId, "binding/alpha/planner");

  const threadResult = await invoke<{ status: string; record: Record<string, unknown> }>(transport, "agent.thread.create", {
    input: {
      threadId: "thread/production",
      projectId: "project/alpha",
      bindingId: binding.bindingId,
      bindingRevision: 1,
      profileId: "agent/researcher",
      profileRevision: 1,
      title: "Production acceptance",
      actor: OBSIDIAN_CONTROL_PLANE_ACTOR,
    },
  });
  assert.equal(threadResult.status, "committed");
  assert.equal(threadResult.record.threadId, "thread/production");
  await invoke(transport, "agent.thread.append", {
    threadId: "thread/production",
    expectedRevision: 1,
    reference: {
      kind: "artifact",
      referenceId: "artifact/production-input",
      recordedAt: "2026-07-15T00:00:00.000Z",
      citations: ["source/production-input"],
    },
    actor: OBSIDIAN_CONTROL_PLANE_ACTOR,
  });

  const room = await invoke<Record<string, unknown>>(transport, "agent.room.get", {
    project: "project/alpha",
    profileId: "agent/researcher",
    threadId: "thread/production",
  });
  const roomIdentity = room.identity as { projectId?: string; threadId?: string };
  assert.equal(roomIdentity.projectId, "project/alpha");
  assert.equal(roomIdentity.threadId, "thread/production");

  const modelLock = {
    provider: "local",
    model: "fixture-model",
    contextWindow: 32_768,
    tokenizer: "fixture-tokenizer/v1",
    policyFingerprint: canonicalDigest({ policy: "production-test" }),
  };
  const workerInput: DreamTimeWorkerInput = {
    operation: "checkpoint",
    projectId: "project/alpha",
    profileId: "agent/researcher",
    sourceIdentities: {
      threadId: "thread/production",
      revisionIds: [],
      artifactIds: ["artifact/production-input"],
      cutoffAt: "2026-07-15T00:00:00.000Z",
    },
    expectedRevision: { revisionId: null, revision: 0, fingerprint: null },
    sourceFingerprint: "" as never,
    currentSections: {
      recentContext: makeMemorySection(),
      openItems: makeMemorySection(),
      stableMemory: makeMemorySection(),
    },
    protectedDirectives: [],
    unresolvedConflicts: [],
    modelLock,
    expiresAt: "2099-07-16T00:00:00.000Z",
  };
  workerInput.sourceFingerprint = dreamTimeSourceFingerprint(workerInput);
  const { currentSections: _currentSections, ...candidateLocks } = workerInput;
  const candidate: MemoryProposalCandidate = {
    ...candidateLocks,
    proposalId: "memory-proposal/production",
    candidateDiff: [{
      operation: "replace",
      section: "recentContext",
      beforeHash: null,
      after: makeMemorySection("Production checkpoint", ["artifact/production-input"]),
    }],
    provenance: [{ kind: "thread", id: "thread/production", revision: 2 }],
    warnings: [],
  };
  const proposed = await invoke<{ proposalId: string }>(transport, "dreamtime.checkpoint.propose", {
    project: "project/alpha",
    profileId: "agent/researcher",
    workerInput,
    candidate,
    actor: OBSIDIAN_CONTROL_PLANE_ACTOR,
  });
  assert.equal(proposed.proposalId, candidate.proposalId);

  const proposal = await invoke<{ proposal: MemoryProposalCandidate & { fingerprint: string } }>(transport, "dreamtime.proposal.read", {
    project: "project/alpha",
    profileId: "agent/researcher",
    proposalId: candidate.proposalId,
  });
  const approval = {
    project: "project/alpha",
    profileId: "agent/researcher",
    proposalId: candidate.proposalId,
    presentedFingerprint: proposal.proposal.fingerprint,
    expectedRevision: 0,
    transitionToken: "production-approve-v1",
    actor: OBSIDIAN_CONTROL_PLANE_ACTOR,
    reason: "Acceptance approval",
  };
  const approved = await invoke<Record<string, any>>(transport, "dreamtime.approve", approval);
  const replayedApproval = await invoke<Record<string, any>>(transport, "dreamtime.approve", approval);
  assert.equal(approved.idempotent, false);
  assert.equal(replayedApproval.idempotent, true);
  assert.deepEqual(replayedApproval.decision, approved.decision);
  assert.deepEqual(replayedApproval.revision, approved.revision);
  const approvedProposal = await invoke<{ proposal: { lifecycle: string } }>(transport, "dreamtime.proposal.read", {
    project: "project/alpha",
    profileId: "agent/researcher",
    proposalId: candidate.proposalId,
  });
  assert.equal(approvedProposal.proposal.lifecycle, "approved");

  const client = new AgentControlPlaneClient(transport);
  const approvedRevision = approved.revision as Record<string, any>;
  const plannedConsult = await client.planDelegation({
    project: "project/alpha",
    input: {
      planId: "delegation-plan/production-consult",
      projectId: "project/alpha",
      parentWorkRunId: "work-run/parent",
      objective: "Consult one exact approved target memory revision",
      assignment: {
        assignmentPlanId: "assignment-plan/production-consult",
        assignmentPlanVersion: 1,
        assignmentPlanFingerprint: canonicalDigest({ assignment: "production-consult" }),
        deviceSnapshot: {
          snapshotId: "device-snapshot/production-consult",
          deviceId: "device/test",
          revision: 1,
          fingerprint: canonicalDigest({ device: "production-consult" }),
          capturedAt: "2026-07-15T00:00:00.000Z",
          expiresAt: "2099-07-16T00:00:00.000Z",
        },
        profileId: "agent/planner",
        profileRevision: 1,
        bindingId: "binding/alpha/planner",
        bindingRevision: 1,
        contextEnvelopeFingerprint: canonicalDigest({ context: "production-consult" }),
      },
      inputArtifactIds: [],
      requestedCapabilityScope: {
        connectors: ["agent-memory"],
        operations: ["context.consult"],
        resources: [`agent/researcher@${approvedRevision.revisionId}`],
        sideEffectClasses: ["read-only"],
      },
      budget: { policyVersion: "budget/v1", maxInputTokens: 1_000, maxOutputTokens: 500, maxDurationMs: 60_000 },
      expiresAt: "2099-07-16T00:00:00.000Z",
      expectedOutput: { outputClass: "run-output", mediaType: "application/json", requiredArtifactCount: 1, acceptanceCriteria: ["Read only"] },
      sideEffectPolicy: { externalEffectsRequirePerRunApproval: true, requestedExternalClasses: [] },
      provenance: [{ kind: "workRun", id: "work-run/parent" }],
      createdAt: "2026-07-15T00:00:00.000Z",
      createdBy: OBSIDIAN_CONTROL_PLANE_ACTOR,
    },
    actor: OBSIDIAN_CONTROL_PLANE_ACTOR,
  });
  const issuedConsult = await client.approveDelegation({
    project: "project/alpha",
    planId: plannedConsult.planId,
    presentedFingerprint: plannedConsult.fingerprint,
    expectedRevision: 1,
    approvedExternalClasses: [],
    actor: OBSIDIAN_CONTROL_PLANE_ACTOR,
  });
  const grant = issuedConsult.grant;
  const consultEnvelope = {
    project: "project/alpha" as const,
    request: {
      requestId: "context-consult/production" as const,
      projectId: "project/alpha" as const,
      requestingAgent: { profileId: "agent/planner" as const, profileRevision: 1, workRunId: issuedConsult.child.workRunId },
      targetAgent: { profileId: "agent/researcher" as const, profileRevision: 1 },
      attachTo: { kind: "workRun" as const, id: "work-run/parent" as const },
      objective: "Read approved context only",
      requestedSections: ["recentContext" as const],
      asOf: {
        revisionId: approvedRevision.revisionId,
        revision: approvedRevision.revision,
        fingerprint: approvedRevision.fingerprint,
      },
      contextFingerprint: canonicalDigest({ context: "production-consult" }),
      capabilityGrantId: grant.grantId,
      authorizationDecision: grant.policyDecision,
      provenance: [{ kind: "workRun" as const, id: issuedConsult.child.workRunId }],
      createdAt: "2026-07-15T00:00:00.000Z",
      expiresAt: "2099-07-16T00:00:00.000Z",
    },
    invocationToken: "production-consult-token",
    workerOutput: {
      content: { answer: "Consultable context" },
      mediaType: "application/json",
      outputClass: "durable-knowledge-candidate" as const,
      provenance: [{ kind: "memoryRevision" as const, id: approvedRevision.revisionId, fingerprint: approvedRevision.fingerprint }],
    },
    inputArtifactIds: [],
    actor: OBSIDIAN_CONTROL_PLANE_ACTOR,
  };
  const consult = await client.executeConsult(consultEnvelope);
  const consultReplay = await client.executeConsult(consultEnvelope);
  assert.equal(consult.requestingProfileId, "agent/planner");
  assert.equal(consult.targetProfileId, "agent/researcher");
  assert.equal(consult.targetRevisionId, approvedRevision.revisionId);
  assert.equal(consult.idempotent, false);
  assert.equal(consultReplay.idempotent, true);
  assert.equal(consultReplay.artifact.contentHash, consult.artifact.contentHash);

  const plannedDelegation = await client.planDelegation({
    project: "project/alpha",
    input: {
      planId: "delegation-plan/production",
      projectId: "project/alpha",
      parentWorkRunId: "work-run/parent",
      objective: "Produce one governed artifact",
      assignment: {
        assignmentPlanId: "assignment-plan/production",
        assignmentPlanVersion: 1,
        assignmentPlanFingerprint: canonicalDigest({ assignment: "production" }),
        deviceSnapshot: {
          snapshotId: "device-snapshot/production",
          deviceId: "device/test",
          revision: 1,
          fingerprint: canonicalDigest({ device: "production" }),
          capturedAt: "2026-07-15T00:00:00.000Z",
          expiresAt: "2099-07-16T00:00:00.000Z",
        },
        profileId: "agent/researcher",
        profileRevision: 1,
        bindingId: "binding/alpha/researcher",
        bindingRevision: 1,
        contextEnvelopeFingerprint: canonicalDigest({ context: "delegation" }),
      },
      inputArtifactIds: ["artifact/run-input"],
      requestedCapabilityScope: { connectors: [], operations: [], resources: [], sideEffectClasses: ["read-only"] },
      budget: { policyVersion: "budget/v1", maxInputTokens: 1_000, maxOutputTokens: 500, maxDurationMs: 60_000 },
      expiresAt: "2099-07-16T00:00:00.000Z",
      expectedOutput: { outputClass: "run-output", mediaType: "application/json", requiredArtifactCount: 1, acceptanceCriteria: ["Preserve provenance"] },
      sideEffectPolicy: { externalEffectsRequirePerRunApproval: true, requestedExternalClasses: [] },
      provenance: [{ kind: "workRun", id: "work-run/parent" }, { kind: "artifact", id: "artifact/run-input" }],
      createdAt: "2026-07-15T00:00:00.000Z",
      createdBy: OBSIDIAN_CONTROL_PLANE_ACTOR,
    },
    actor: OBSIDIAN_CONTROL_PLANE_ACTOR,
  });
  assert.equal(plannedDelegation.approval.status, "pending");
  const readPlannedDelegation = await client.readDelegation("project/alpha", plannedDelegation.planId);
  assert.equal(readPlannedDelegation.candidateProfileId, "agent/researcher");
  assert.equal(readPlannedDelegation.child, undefined);
  const delegationApproval = await client.approveDelegation({
    project: "project/alpha",
    planId: plannedDelegation.planId,
    presentedFingerprint: plannedDelegation.fingerprint,
    expectedRevision: 1,
    approvedExternalClasses: [],
    actor: OBSIDIAN_CONTROL_PLANE_ACTOR,
  });
  assert.equal(delegationApproval.idempotent, false);
  const readApprovedDelegation = await client.readDelegation("project/alpha", plannedDelegation.planId);
  assert.equal(readApprovedDelegation.approval.status, "approved");
  assert.equal(readApprovedDelegation.child?.workRunId, delegationApproval.child.workRunId);

  const handoffArgs = {
    project: "project/alpha",
    profileId: "agent/researcher",
    proposalId: candidate.proposalId,
    proposalFingerprint: proposal.proposal.fingerprint,
    candidateDiff: proposal.proposal.candidateDiff,
    provenance: proposal.proposal.provenance,
    actor: OBSIDIAN_CONTROL_PLANE_ACTOR,
  };
  const firstHandoff = await invoke<{ reviewPath: string }>(transport, "dreamtime.promotion.handoff", handoffArgs);
  assert.match(firstHandoff.reviewPath, /^00-Inbox\/AI-Output\/vault-dreamtime\/promotion-candidate-[a-f0-9]{24}\.md$/);
  const reviewFullPath = join(vaultPath, ...firstHandoff.reviewPath.split("/"));
  const firstBytes = readFileSync(reviewFullPath);
  const secondHandoff = await invoke<{ reviewPath: string }>(transport, "dreamtime.promotion.handoff", handoffArgs);
  assert.equal(secondHandoff.reviewPath, firstHandoff.reviewPath);
  assert.deepEqual(readFileSync(reviewFullPath), firstBytes, "Promotion replay must preserve exact candidate bytes");
  assert.match(firstBytes.toString("utf-8"), /quarantine-state: new/);
  assert.match(firstBytes.toString("utf-8"), /idempotency-key: promotion-candidate-/);

  const hub = await invoke<Record<string, any>>(transport, "project.hub.get", { ref: "project/alpha" });
  assert.equal(hub.projectId, "project/alpha");
  assert.ok(hub.sections.agents.data.profiles.some((item: Record<string, unknown>) => item.profileId === "agent/researcher"));
  const usage = await invoke<Record<string, any>>(transport, "usage.project", { project: "project/alpha" });
  assert.equal(usage.projectId, "project/alpha");
  assert.ok(usage.projection.sourceEventCount >= 1);

  const auditDir = join(vaultPath, ".wiki-audit");
  const audit = readdirSync(auditDir)
    .flatMap(file => readFileSync(join(auditDir, file), "utf-8").trim().split("\n"))
    .filter(Boolean)
    .map(line => JSON.parse(line) as Record<string, unknown>);
  assert.ok(audit.some(entry => entry.tool === "agent.profile.create"));
  assert.ok(audit.some(entry => entry.tool === "dreamtime.approve"));
  assert.ok(audit.every(entry => entry.actor === OBSIDIAN_CONTROL_PLANE_ACTOR));
  assert.ok(audit.every(entry => entry.role === "human"));
});

test("production dispatcher mounts Host Capability operations and rejects impersonated or client-forged authority", async () => {
  const vaultPath = mkdtempSync(join(tmpdir(), "llmwiki-obsidian-policy-"));
  roots.push(vaultPath);
  const transport = new ProductionControlPlaneTransport({
    vaultPath,
    userDeviceId: "device-policy",
    userDevicePath: join(vaultPath, "device-settings.json"),
    environment: {},
  });
  await assert.rejects(
    () => invoke(transport, "agent.profile.create", {
      input: {
        profileId: "agent/impersonated",
        displayName: "Impersonated",
        role: "Invalid actor",
        responsibilities: [],
        capabilityClaims: [],
        constitution: { principles: [], instructions: [] },
        defaultModelPolicy: { mode: "local", provider: "local", model: "fixture-model" },
        actor: "not-the-obsidian-actor",
      },
    }),
    /actor/i,
  );
  const doctor = await invoke<{
    ok: boolean;
    counts: { descriptors: number; connectors: number; assignments: number };
  }>(transport, "host.doctor");
  assert.equal(doctor.ok, true);
  assert.deepEqual(doctor.counts, { descriptors: 0, connectors: 0, assignments: 0 });
  await assert.rejects(
    () => invoke(transport, "host.project", { project: "project/alpha", binding: {}, grant: {} }),
    /binding|grant|unsupported|authority|authorization/i,
  );
});

test("production client executes one backend-authoritative Host Capability flow", async () => {
  const vaultPath = mkdtempSync(join(tmpdir(), "llmwiki-obsidian-host-flow-"));
  roots.push(vaultPath);
  let transportCalls = 0;
  const transport = new ProductionControlPlaneTransport({
    vaultPath,
    userDeviceId: "device-host-flow",
    userDevicePath: join(vaultPath, "device-settings.json"),
    environment: { GITHUB_TOKEN: "never-render-host-token" },
    hostCapabilityTransportFactory: async () => ({
      invoke: async request => {
        transportCalls += 1;
        return { acceptedOperation: request.operation, acceptedInput: request.input };
      },
    }),
  });
  const client = new AgentControlPlaneClient(transport);
  const projectId = "project/host-flow" as const;
  await invoke(transport, "project.init", { project: "host-flow", description: "Host flow acceptance" });
  mkdirSync(join(vaultPath, "01-Projects", "host-flow", "runs"), { recursive: true });
  writeFileSync(join(vaultPath, "01-Projects", "host-flow", "runs", "host-parent.json"), JSON.stringify({
    schema_version: 2,
    work_run_id: "work-run/host-parent",
    project_id: projectId,
    state: "running",
    artifact_projections: [],
  }), "utf-8");

  for (const [key, value] of [
    ["providers.host_capability.enabled", true],
    ["providers.host_capability.provider", "github"],
    ["providers.host_capability.transport", "http"],
    ["providers.host_capability.endpoint", "https://github.example.invalid/mcp"],
    ["providers.host_capability.secret_ref", { provider: "environment", locator: "GITHUB_TOKEN" }],
  ] as const) {
    const scope = await invoke<{ document: { revision: number } }>(transport, "settings.scopes.get", { scope: "session" });
    const result = await invoke<{ status: string }>(transport, "settings.assignment.set", {
      scope: "session",
      key,
      value,
      expectedRevision: scope.document.revision,
      updatedBy: OBSIDIAN_CONTROL_PLANE_ACTOR,
    });
    assert.equal(result.status, "committed");
  }

  const profile = await client.createProfile({
    profileId: "agent/host-reviewer",
    displayName: "Host reviewer",
    role: "Host capability reviewer",
    responsibilities: ["Use governed host operations"],
    capabilityClaims: ["code.review"],
    constitution: { principles: ["Use server-issued grants"], instructions: ["Preserve provenance"] },
    defaultModelPolicy: { mode: "local", provider: "local", model: "model/local" },
    actor: OBSIDIAN_CONTROL_PLANE_ACTOR,
  });
  assert.equal(profile.status, "committed");
  const projectContextFingerprint = canonicalDigest(
    normalizedProjectContext(resolveProjectContext(vaultPath, projectId)),
  );
  const delegationPlan = createDelegationPlan({
    planId: "delegation-plan/production-host",
    projectId,
    parentWorkRunId: "work-run/host-parent",
    objective: "Execute one governed Host Capability",
    assignment: {
      assignmentPlanId: "assignment-plan/production-host",
      assignmentPlanVersion: 1,
      assignmentPlanFingerprint: canonicalDigest({ assignment: "production-host" }),
      deviceSnapshot: {
        snapshotId: "device-snapshot/production-host",
        deviceId: "device/host-flow",
        revision: 1,
        fingerprint: canonicalDigest({ device: "host-flow" }),
        capturedAt: "2026-07-15T00:00:00.000Z",
        expiresAt: "2099-07-16T00:00:00.000Z",
      },
      profileId: "agent/host-reviewer",
      profileRevision: 1,
      bindingId: "binding/host-flow/host-reviewer",
      bindingRevision: 1,
      contextEnvelopeFingerprint: canonicalDigest({ context: "production-host" }),
    },
    inputArtifactIds: [],
    requestedCapabilityScope: {
      connectors: ["github"],
      operations: ["expert.search"],
      resources: ["descriptor/expert/code-review@1.0.0"],
      sideEffectClasses: ["read-only"],
    },
    budget: { policyVersion: "budget/v1", maxInputTokens: 1_000, maxOutputTokens: 500, maxDurationMs: 60_000 },
    expiresAt: "2099-07-16T00:00:00.000Z",
    expectedOutput: {
      outputClass: "run-output",
      mediaType: "application/json",
      requiredArtifactCount: 1,
      acceptanceCriteria: ["Return one governed result"],
    },
    sideEffectPolicy: { externalEffectsRequirePerRunApproval: true, requestedExternalClasses: [] },
    provenance: [{ kind: "workRun", id: "work-run/host-parent" }],
    createdAt: "2026-07-15T00:00:00.000Z",
    createdBy: OBSIDIAN_CONTROL_PLANE_ACTOR,
  });
  const grantSuffix = canonicalDigest({ planId: delegationPlan.planId, fingerprint: delegationPlan.fingerprint })
    .slice("sha256:".length, "sha256:".length + 24);
  const grantId = `grant/child-${grantSuffix}`;
  const binding = await client.createBinding({
    projectId,
    projectContextFingerprint,
    profileId: "agent/host-reviewer",
    profileRevision: 1,
    role: "Host capability reviewer",
    connectorGrantRefs: [grantId as `grant/${string}`],
    actor: OBSIDIAN_CONTROL_PLANE_ACTOR,
  });
  assert.equal(binding.status, "committed");

  await client.registerHostDescriptor({
    schemaVersion: 1,
    descriptor: hostDescriptor({
      connectorRef: { connectorId: "connector/github", connectorVersion: "1.0.0" },
    }),
    health: hostHealth({ expiresAt: "2099-07-16T00:00:00.000Z" }),
  });
  await client.registerHostConnector({
    schemaVersion: 1,
    connector: hostConnector({
      connectorId: "connector/github",
      displayName: "GitHub connector",
    }),
    health: hostHealth({ expiresAt: "2099-07-16T00:00:00.000Z" }),
    configuration: {},
  }, projectId);

  const plannedDelegation = await client.planDelegation({
    project: projectId,
    input: delegationPlan,
    actor: OBSIDIAN_CONTROL_PLANE_ACTOR,
  });
  const issued = await client.approveDelegation({
    project: projectId,
    planId: plannedDelegation.planId,
    presentedFingerprint: plannedDelegation.fingerprint,
    expectedRevision: 1,
    approvedExternalClasses: [],
    actor: OBSIDIAN_CONTROL_PLANE_ACTOR,
  });
  assert.equal(issued.grant.grantId, grantId);
  const authorization = { project: projectId, bindingId: binding.record.bindingId, grantId };
  const projected = await client.hostProject(projectId, authorization);
  assert.equal(projected.bindingId, binding.record.bindingId);
  assert.equal(projected.grantId, grantId);

  const searched = await client.searchHostCapabilities({ ...authorization, query: "review" });
  assert.equal(searched.count, 1);
  const selected = searched.results[0]!;
  const described = await client.describeHostCapability({
    ...authorization,
    descriptorId: selected.descriptorId,
    descriptorVersion: selected.descriptorVersion,
  });
  assert.equal(described.description.descriptorFingerprint, selected.descriptorFingerprint);
  const planned = await client.planHostAssignment({
    ...authorization,
    requirement: hostRequirement({ projectId, workRunId: issued.child.workRunId }),
    policy: hostPolicy(),
    devices: [],
  });
  assert.equal(planned.plan.approval?.status, "pending");
  const approved = await client.approveHostAssignment({
    ...authorization,
    planId: planned.plan.planId,
    expectedFingerprint: planned.planFingerprint,
    approvedBy: OBSIDIAN_CONTROL_PLANE_ACTOR,
  });
  assert.equal(approved.plan.approval?.status, "approved");
  assert.throws(() => client.invokeHostCapability({
    ...authorization,
    planId: approved.plan.planId,
    descriptorId: selected.descriptorId,
    descriptorVersion: selected.descriptorVersion,
    operation: "expert.search",
    describedDescriptorFingerprint: selected.descriptorFingerprint,
    input: { oauthAccessToken: "opaque-plaintext-token" },
  }), /forbidden|Secret Reference/i);
  assert.equal(transportCalls, 0);
  const invoked = await client.invokeHostCapability({
    ...authorization,
    planId: approved.plan.planId,
    descriptorId: selected.descriptorId,
    descriptorVersion: selected.descriptorVersion,
    operation: "expert.search",
    describedDescriptorFingerprint: selected.descriptorFingerprint,
    input: { query: "production" },
  });
  assert.equal(transportCalls, 1);
  assert.equal(
    (invoked.result as { result?: { acceptedOperation?: string } }).result?.acceptedOperation,
    "expert.search",
  );
  assert.equal(JSON.stringify(invoked).includes("never-render-host-token"), false);
});

function invoke<T = unknown>(
  transport: ProductionControlPlaneTransport,
  operation: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return transport.invoke<T>(operation, args);
}
