import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AgentControlPlaneClient,
  assertSafeControlPlaneMutation,
  assertSecretReferenceSelection,
  CONTROL_PLANE_OPERATIONS,
  ControlPlaneContractError,
  controlPlaneIdempotencyToken,
  projectHostCapabilityRows,
  refreshAgentControlPlaneProjection,
  safePresentationText,
  safeSummary,
  validatedHostAuthorizationSnapshot,
  type AgentProfile,
  type MemoryProposal,
  type ProjectAgentBinding,
  type RoomProjection,
  type Thread,
} from "../src/control-plane-client";

class FakeTransport {
  readonly calls: Array<{ operation: string; args: Record<string, unknown> }> = [];

  constructor(private readonly responses: Record<string, unknown | Error | ((attempt: number, args: Record<string, unknown>) => unknown)> = {}) {}

  async invoke<T>(operation: string, args: Record<string, unknown>): Promise<T> {
    this.calls.push({ operation, args: structuredClone(args) });
    const result = this.responses[operation];
    if (result instanceof Error) throw result;
    if (result === undefined) throw new Error(`No fake response for ${operation}`);
    if (typeof result === "function") {
      const attempt = this.calls.filter(call => call.operation === operation).length;
      return structuredClone(result(attempt, args)) as T;
    }
    return structuredClone(result) as T;
  }
}

const profile: AgentProfile = {
  schemaVersion: 1,
  profileId: "agent/reviewer",
  displayName: "Reviewer",
  role: "reviewer",
  responsibilities: ["review"],
  capabilityClaims: ["code-review"],
  constitution: { principles: ["evidence first"], instructions: ["cite artifacts"] },
  defaultModelPolicy: { mode: "inherit" },
  revision: 2,
  createdAt: "2026-07-15T00:00:00.000Z",
  createdBy: "operator",
  updatedAt: "2026-07-15T01:00:00.000Z",
  updatedBy: "operator",
};

const binding: ProjectAgentBinding = {
  schemaVersion: 1,
  bindingId: "binding/example/reviewer",
  projectId: "project/example",
  projectContextFingerprint: `sha256:${"1".repeat(64)}`,
  profileId: profile.profileId,
  profileRevision: profile.revision,
  role: "reviewer",
  enabled: true,
  memoryScopes: ["recentContext", "openItems", "stableMemory"],
  connectorGrantRefs: ["grant/review"],
  revision: 1,
  createdAt: "2026-07-15T00:00:00.000Z",
  createdBy: "operator",
  updatedAt: "2026-07-15T00:00:00.000Z",
  updatedBy: "operator",
};

const thread: Thread = {
  schemaVersion: 1,
  threadId: "thread/review",
  durability: "durable",
  lifecycle: "open",
  projectId: binding.projectId,
  bindingId: binding.bindingId,
  bindingRevision: binding.revision,
  profileId: profile.profileId,
  profileRevision: profile.revision,
  title: "Review",
  references: [],
  revision: 1,
  createdAt: "2026-07-15T00:00:00.000Z",
  createdBy: "operator",
  updatedAt: "2026-07-15T00:00:00.000Z",
  updatedBy: "operator",
};

const room: RoomProjection = {
  schemaVersion: 1,
  identity: {
    schemaVersion: 1,
    projectId: binding.projectId,
    profileId: profile.profileId,
    profileRevision: profile.revision,
    bindingId: binding.bindingId,
    bindingRevision: binding.revision,
    threadId: thread.threadId,
    threadRevision: thread.revision,
  },
  readOnly: true,
  lifecycle: "open",
  relatedWorkRunIds: ["work-run/review"],
  approvedMemory: {
    revisionId: "memory-revision/one",
    revision: 1,
    fingerprint: `sha256:${"2".repeat(64)}`,
  },
  connectorSummaries: [{ connectorId: "connector/github", status: "available", grantRef: "grant/review" }],
  diagnostics: [],
};

const proposal = {
  schemaVersion: 1,
  proposalId: "memory-proposal/checkpoint",
  lifecycle: "proposed",
  operation: "checkpoint",
  projectId: binding.projectId,
  profileId: profile.profileId,
  sourceIdentities: {
    threadId: thread.threadId,
    revisionIds: ["memory-revision/one"],
    artifactIds: [],
    cutoffAt: "2026-07-15T02:00:00.000Z",
  },
  expectedRevision: {
    revisionId: "memory-revision/one",
    revision: 1,
    fingerprint: `sha256:${"2".repeat(64)}`,
  },
  sourceFingerprint: `sha256:${"3".repeat(64)}`,
  candidateDiff: [],
  protectedDirectives: [],
  unresolvedConflicts: [],
  provenance: [],
  warnings: [],
  modelLock: {
    provider: "local",
    model: "test",
    contextWindow: 8192,
    tokenizer: "test",
    policyFingerprint: `sha256:${"4".repeat(64)}`,
  },
  approvalPolicy: {
    mode: "manual",
    autoApprovalHook: { enabled: false, warningFreeOnly: true, workingMemoryOnly: true },
  },
  createdAt: "2026-07-15T02:00:00.000Z",
  createdBy: "worker",
  expiresAt: "2026-07-16T02:00:00.000Z",
  fingerprint: `sha256:${"5".repeat(64)}`,
} satisfies MemoryProposal;

describe("Obsidian Agent control-plane contract", () => {
  it("pins the shared backend operation names instead of inventing plugin stores", () => {
    assert.deepEqual(CONTROL_PLANE_OPERATIONS, {
      profileCreate: "agent.profile.create",
      profileRead: "agent.profile.read",
      profileList: "agent.profile.list",
      profileUpdate: "agent.profile.update",
      bindingCreate: "agent.binding.create",
      bindingRead: "agent.binding.read",
      bindingList: "agent.binding.list",
      bindingUpdate: "agent.binding.update",
      threadCreate: "agent.thread.create",
      threadRead: "agent.thread.read",
      threadList: "agent.thread.list",
      threadAppend: "agent.thread.append",
      threadTransition: "agent.thread.transition",
      roomGet: "agent.room.get",
      contextCompile: "agent.context.compile",
      migrationPlan: "agent.migration.plan",
      dreamTimeCheckpointPropose: "dreamtime.checkpoint.propose",
      dreamTimeLearnPropose: "dreamtime.learn.propose",
      dreamTimeReviewPropose: "dreamtime.review.propose",
      dreamTimeProposalRead: "dreamtime.proposal.read",
      dreamTimeApprove: "dreamtime.approve",
      dreamTimeReject: "dreamtime.reject",
      dreamTimeRevisionCurrent: "dreamtime.revision.current",
      dreamTimeRevisionRead: "dreamtime.revision.read",
      dreamTimeRevisionHistory: "dreamtime.revision.history",
      dreamTimeDoctor: "dreamtime.doctor",
      dreamTimePromotionHandoff: "dreamtime.promotion.handoff",
      consultExecute: "consult.execute",
      delegationPlan: "delegation.plan",
      delegationApprove: "delegation.approve",
      delegationRead: "delegation.read",
      delegationTransition: "delegation.transition",
      delegationArtifactProject: "delegation.artifact.project",
      projectHubGet: "project.hub.get",
      hostDescriptorRegister: "host.descriptor.register",
      hostDescriptorList: "host.descriptor.list",
      hostDescriptorRead: "host.descriptor.read",
      hostConnectorRegister: "host.connector.register",
      hostConnectorList: "host.connector.list",
      hostConnectorRead: "host.connector.read",
      hostAssignmentPlan: "host.assignment.plan",
      hostAssignmentApprove: "host.assignment.approve",
      hostAssignmentRead: "host.assignment.read",
      hostProxySearch: "host.proxy.search",
      hostProxyDescribe: "host.proxy.describe",
      hostProxyInvoke: "host.proxy.invoke",
      hostDoctor: "host.doctor",
      hostProject: "host.project",
      usageProject: "usage.project",
    });
  });

  it("sends Profile and Binding mutations through the backend and returns backend revisions", async () => {
    const transport = new FakeTransport({
      [CONTROL_PLANE_OPERATIONS.profileCreate]: { status: "committed", record: profile },
      [CONTROL_PLANE_OPERATIONS.bindingCreate]: { status: "committed", record: binding },
    });
    const client = new AgentControlPlaneClient(transport);
    const createdProfile = await client.createProfile({
      profileId: profile.profileId,
      displayName: profile.displayName,
      role: profile.role,
      constitution: profile.constitution,
      actor: "obsidian-control-plane",
    });
    const createdBinding = await client.createBinding({
      projectId: binding.projectId,
      projectContextFingerprint: binding.projectContextFingerprint,
      profileId: binding.profileId,
      profileRevision: binding.profileRevision,
      role: binding.role,
      connectorGrantRefs: binding.connectorGrantRefs,
      actor: "obsidian-control-plane",
    });
    assert.equal(createdProfile.status, "committed");
    assert.equal(createdBinding.status, "committed");
    assert.deepEqual(transport.calls.map(call => call.operation), [
      "agent.profile.create",
      "agent.binding.create",
    ]);
    assert.equal(Object.hasOwn(client, "profiles"), false);
    assert.equal(Object.hasOwn(client, "bindings"), false);
    assert.equal(Object.hasOwn(client, "approvals"), false);
  });

  it("rejects sensitive material before invoking a mutating backend operation", () => {
    for (const candidate of [
      { secretValue: "abc" },
      { secret: "abc" },
      { leaseToken: "lease-usable" },
      { grant_token: "grant-usable" },
      { accessToken: "opaque-access-token" },
      { access_token: "opaque-access-token" },
      { refreshToken: "opaque-refresh-token" },
      { session_token: "opaque-session-token" },
      { bearerToken: "opaque-bearer-token" },
      { oauth_access_token: "opaque-oauth-token" },
      { authorization: "Bearer abc" },
      { prompt: "client-composed-governance" },
      { details: "C:\\Users\\operator\\private.txt" },
      { nested: { responseBody: "private model output" } },
    ]) {
      assert.throws(() => assertSafeControlPlaneMutation(candidate), ControlPlaneContractError);
    }
    assert.doesNotThrow(() => assertSafeControlPlaneMutation({
      transitionToken: `llmwiki-v1-${"a".repeat(64)}`,
    }));
  });

  it("accepts logical Secret References and rejects obvious credential-shaped locators", () => {
    assert.doesNotThrow(() => assertSecretReferenceSelection({
      settingKey: "providers.openai.secret",
      reference: { provider: "environment", locator: "OPENAI_API_KEY" },
    }));
    assert.throws(() => assertSecretReferenceSelection({
      settingKey: "providers.openai.secret",
      reference: { provider: "environment", locator: "sk-live-plaintext" },
    }), ControlPlaneContractError);
  });

  it("routes Host Capability registrations through the backend without persisting credentials", async () => {
    const descriptorRegistration = {
      schemaVersion: 1,
      descriptor: { descriptorId: "descriptor/linear", kind: "project-management" },
    };
    const connectorRegistration = {
      schemaVersion: 1,
      connector: { connectorId: "connector/linear", transport: "http" },
      configuration: {},
    };
    const transport = new FakeTransport({
      [CONTROL_PLANE_OPERATIONS.hostDescriptorRegister]: descriptorRegistration,
      [CONTROL_PLANE_OPERATIONS.hostDescriptorList]: { registrations: [descriptorRegistration] },
      [CONTROL_PLANE_OPERATIONS.hostDescriptorRead]: descriptorRegistration,
      [CONTROL_PLANE_OPERATIONS.hostConnectorRegister]: connectorRegistration,
      [CONTROL_PLANE_OPERATIONS.hostConnectorList]: { registrations: [connectorRegistration] },
      [CONTROL_PLANE_OPERATIONS.hostConnectorRead]: connectorRegistration,
      [CONTROL_PLANE_OPERATIONS.hostAssignmentPlan]: { plan: { planId: "assignment-plan/linear" } },
      [CONTROL_PLANE_OPERATIONS.hostAssignmentApprove]: { plan: { planId: "assignment-plan/linear", approval: { status: "approved" } } },
      [CONTROL_PLANE_OPERATIONS.hostAssignmentRead]: { plan: { planId: "assignment-plan/linear" } },
      [CONTROL_PLANE_OPERATIONS.hostProxySearch]: { count: 1, results: [{ descriptorId: "descriptor/linear" }] },
      [CONTROL_PLANE_OPERATIONS.hostProxyDescribe]: { description: { descriptorId: "descriptor/linear" } },
      [CONTROL_PLANE_OPERATIONS.hostProxyInvoke]: { result: { ok: true } },
    });
    const client = new AgentControlPlaneClient(transport);
    const authorization = {
      project: binding.projectId,
      bindingId: binding.bindingId,
      grantId: "grant/linear",
    };

    await client.registerHostDescriptor(descriptorRegistration);
    assert.throws(() => client.registerHostConnector({
      ...connectorRegistration,
      configuration: {
        parameters: { endpoint: "https://linear.example.invalid/mcp" },
        secretReference: { provider: "environment", locator: "LINEAR_API_KEY" },
      },
    }, binding.projectId), ControlPlaneContractError);
    await client.registerHostConnector(connectorRegistration, binding.projectId);
    assert.equal((await client.listHostDescriptors()).length, 1);
    await client.readHostDescriptor("descriptor/linear", "1.0.0");
    assert.equal((await client.listHostConnectors(binding.projectId)).length, 1);
    await client.readHostConnector("connector/linear", "1.0.0", binding.projectId);
    await client.planHostAssignment({ ...authorization, requirement: {}, policy: {}, devices: [] });
    await client.approveHostAssignment({
      ...authorization,
      planId: "assignment-plan/linear",
      expectedFingerprint: `sha256:${"7".repeat(64)}`,
      approvedBy: "obsidian-control-plane",
    });
    await client.readHostAssignment({ ...authorization, planId: "assignment-plan/linear" });
    await client.searchHostCapabilities({ ...authorization, query: "issue" });
    await client.describeHostCapability({ ...authorization, descriptorId: "descriptor/linear", descriptorVersion: "1.0.0" });
    await client.invokeHostCapability({
      ...authorization,
      planId: "assignment-plan/linear",
      descriptorId: "descriptor/linear",
      descriptorVersion: "1.0.0",
      operation: "linear.issue.list",
      describedDescriptorFingerprint: `sha256:${"8".repeat(64)}`,
      input: { status: "open" },
    });
    assert.throws(() => client.invokeHostCapability({
      ...authorization,
      planId: "assignment-plan/linear",
      descriptorId: "descriptor/linear",
      descriptorVersion: "1.0.0",
      operation: "linear.issue.list",
      describedDescriptorFingerprint: `sha256:${"8".repeat(64)}`,
      input: { accessToken: "opaque-plaintext-token" },
    }), ControlPlaneContractError);
    assert.deepEqual(transport.calls.map(call => call.operation), [
      CONTROL_PLANE_OPERATIONS.hostDescriptorRegister,
      CONTROL_PLANE_OPERATIONS.hostConnectorRegister,
      CONTROL_PLANE_OPERATIONS.hostDescriptorList,
      CONTROL_PLANE_OPERATIONS.hostDescriptorRead,
      CONTROL_PLANE_OPERATIONS.hostConnectorList,
      CONTROL_PLANE_OPERATIONS.hostConnectorRead,
      CONTROL_PLANE_OPERATIONS.hostAssignmentPlan,
      CONTROL_PLANE_OPERATIONS.hostAssignmentApprove,
      CONTROL_PLANE_OPERATIONS.hostAssignmentRead,
      CONTROL_PLANE_OPERATIONS.hostProxySearch,
      CONTROL_PLANE_OPERATIONS.hostProxyDescribe,
      CONTROL_PLANE_OPERATIONS.hostProxyInvoke,
    ]);
    assert.equal(JSON.stringify(transport.calls).includes("LINEAR_API_KEY"), false);
    assert.equal(JSON.stringify(transport.calls).includes("Bearer "), false);
  });

  it("accepts Host authority only from the exact successfully refreshed backend projection", () => {
    const authorization = { bindingId: binding.bindingId, grantId: "grant/review" };
    assert.deepEqual(validatedHostAuthorizationSnapshot(binding.projectId, authorization, {
      projectId: binding.projectId,
      bindingId: binding.bindingId,
      grantId: "grant/review",
    }), {
      project: binding.projectId,
      bindingId: binding.bindingId,
      grantId: "grant/review",
    });
    assert.equal(validatedHostAuthorizationSnapshot(binding.projectId, authorization, null), null);
    assert.equal(validatedHostAuthorizationSnapshot(binding.projectId, authorization, {
      projectId: binding.projectId,
      bindingId: binding.bindingId,
      grantId: "grant/replaced",
    }), null);
    assert.equal(validatedHostAuthorizationSnapshot(binding.projectId, authorization, {
      projectId: "project/other",
      bindingId: binding.bindingId,
      grantId: "grant/review",
    }), null);
  });

  it("composes a read-only project view from fresh backend projections and degrades per operation", async () => {
    const transport = new FakeTransport({
      [CONTROL_PLANE_OPERATIONS.profileList]: { profiles: [profile] },
      [CONTROL_PLANE_OPERATIONS.bindingList]: { bindings: [binding] },
      [CONTROL_PLANE_OPERATIONS.threadList]: { threads: [thread] },
      [CONTROL_PLANE_OPERATIONS.roomGet]: room,
      [CONTROL_PLANE_OPERATIONS.dreamTimeDoctor]: {
        projectId: binding.projectId,
        profileId: profile.profileId,
        state: "healthy",
        diagnostics: [],
        proposalSummaries: [{
          proposalId: proposal.proposalId,
          operation: proposal.operation,
          lifecycle: proposal.lifecycle,
          fingerprint: proposal.fingerprint,
          createdAt: proposal.createdAt,
          expiresAt: proposal.expiresAt,
          warningCount: 0,
        }],
      },
      [CONTROL_PLANE_OPERATIONS.dreamTimeRevisionHistory]: { revisions: [] },
      [CONTROL_PLANE_OPERATIONS.dreamTimeProposalRead]: { proposal },
      [CONTROL_PLANE_OPERATIONS.delegationRead]: new Error("delegation failed with Bearer never-render at C:\\Users\\operator\\private.txt"),
      [CONTROL_PLANE_OPERATIONS.projectHubGet]: {
        projectId: binding.projectId,
        generatedAt: "2026-07-15T03:00:00.000Z",
        readOnly: true,
        diagnostics: [],
        sections: {},
      },
      [CONTROL_PLANE_OPERATIONS.usageProject]: {
        projectId: binding.projectId,
        projection: { revision: 3, sourceEventCount: 7, unknownCounts: { cost: 2 } },
      },
      [CONTROL_PLANE_OPERATIONS.hostDoctor]: {
        ok: true,
        schemaVersion: 1,
        counts: { descriptors: 0, connectors: 0, assignments: 0 },
        findings: [],
      },
      [CONTROL_PLANE_OPERATIONS.hostProject]: {
        projectId: binding.projectId,
        bindingId: binding.bindingId,
        grantId: "grant/review",
        descriptors: [],
        assignments: [],
      },
    });
    const view = await refreshAgentControlPlaneProjection(new AgentControlPlaneClient(transport), {
      project: binding.projectId,
      profileId: profile.profileId,
      threadId: thread.threadId,
      proposalId: proposal.proposalId,
      delegationId: "delegation/review",
      hostAuthorization: { bindingId: binding.bindingId, grantId: "grant/review" },
    }, new Date("2026-07-15T04:00:00.000Z"));
    assert.equal(view.room?.identity.threadId, thread.threadId);
    assert.equal(view.proposal?.fingerprint, proposal.fingerprint);
    assert.equal(view.usage?.projection.sourceEventCount, 7);
    assert.equal(view.hostDoctor?.ok, true);
    assert.equal(view.host?.bindingId, binding.bindingId);
    assert.equal(view.delegation, null);
    assert.deepEqual(view.diagnostics.map(item => item.code), ["delegation-plan-unavailable"]);
    assert.equal(view.diagnostics[0]?.message, "[redacted unsafe value]");
    assert.deepEqual(
      transport.calls.find(call => call.operation === CONTROL_PLANE_OPERATIONS.hostDoctor)?.args,
      { project: binding.projectId },
    );
    assert.deepEqual(
      transport.calls.find(call => call.operation === CONTROL_PLANE_OPERATIONS.hostProject)?.args,
      { project: binding.projectId, bindingId: binding.bindingId, grantId: "grant/review" },
    );
    assert.equal(view.refreshedAt, "2026-07-15T04:00:00.000Z");
  });

  it("derives deterministic semantic idempotency tokens and does not cache approval state", async () => {
    const transport = new FakeTransport({
      [CONTROL_PLANE_OPERATIONS.dreamTimeApprove]: {
        status: "approved",
        idempotent: false,
        revision: null,
      },
      [CONTROL_PLANE_OPERATIONS.delegationApprove]: {
        child: { workRunId: "work-run/child" },
        grant: { grantId: "grant/child" },
        idempotent: false,
      },
    });
    const client = new AgentControlPlaneClient(transport);
    await client.approveDreamTime({
      project: binding.projectId,
      profileId: profile.profileId,
      proposalId: proposal.proposalId,
      presentedFingerprint: proposal.fingerprint,
      expectedRevision: 1,
      actor: "obsidian-control-plane",
    });
    await client.approveDelegation({
      project: binding.projectId,
      planId: "delegation/review",
      presentedFingerprint: `sha256:${"6".repeat(64)}`,
      expectedRevision: 3,
      approvedExternalClasses: ["external-write", "external-delete"],
      actor: "obsidian-control-plane",
    });
    assert.deepEqual(transport.calls.map(call => call.operation), ["dreamtime.approve", "delegation.approve"]);
    assert.equal(transport.calls[0]?.args.presentedFingerprint, proposal.fingerprint);
    assert.match(String(transport.calls[0]?.args.transitionToken), /^llmwiki-v1-[a-f0-9]{64}$/);
    assert.deepEqual(transport.calls[1]?.args.approvedExternalClasses, ["external-delete", "external-write"]);
    assert.equal(Object.hasOwn(client, "approvalState"), false);
    assert.equal(Object.hasOwn(client, "transitionToken"), false);
  });

  it("retries a lost response with the same token and changes it only for different semantics", async () => {
    const transport = new FakeTransport({
      [CONTROL_PLANE_OPERATIONS.dreamTimeApprove]: (attempt: number) => {
        if (attempt === 1) throw new Error("response lost after backend commit");
        return { status: "approved", idempotent: true, revision: null };
      },
    });
    const client = new AgentControlPlaneClient(transport);
    const request = {
      project: binding.projectId,
      profileId: profile.profileId,
      proposalId: proposal.proposalId,
      presentedFingerprint: proposal.fingerprint,
      expectedRevision: 1,
      actor: "obsidian-control-plane",
    } as const;
    await assert.rejects(client.approveDreamTime(request), /response lost/);
    await client.approveDreamTime(request);
    assert.equal(transport.calls.length, 2);
    assert.equal(transport.calls[0]?.args.transitionToken, transport.calls[1]?.args.transitionToken);

    const base = {
      operation: CONTROL_PLANE_OPERATIONS.delegationApprove,
      project: binding.projectId,
      subject: "delegation/review",
      fingerprint: `sha256:${"6".repeat(64)}`,
      expectedRevision: 3,
      actor: "obsidian-control-plane",
      action: "approve",
      approvedExternalClasses: ["external-write", "external-delete"],
    } as const;
    const first = controlPlaneIdempotencyToken(base);
    const reordered = controlPlaneIdempotencyToken({ ...base, approvedExternalClasses: ["external-delete", "external-write"] });
    const changedFingerprint = controlPlaneIdempotencyToken({ ...base, fingerprint: `sha256:${"7".repeat(64)}` });
    const changedRevision = controlPlaneIdempotencyToken({ ...base, expectedRevision: 4 });
    const changedClasses = controlPlaneIdempotencyToken({ ...base, approvedExternalClasses: ["external-delete"] });
    const changedOperation = controlPlaneIdempotencyToken({ ...base, operation: CONTROL_PLANE_OPERATIONS.dreamTimeApprove });
    const changedProject = controlPlaneIdempotencyToken({ ...base, project: "project/other" });
    const changedSubject = controlPlaneIdempotencyToken({ ...base, subject: "delegation/other" });
    const changedActor = controlPlaneIdempotencyToken({ ...base, actor: "other-operator" });
    const changedAction = controlPlaneIdempotencyToken({ ...base, action: "reject" });
    assert.equal(first, reordered);
    assert.notEqual(first, changedFingerprint);
    assert.notEqual(first, changedRevision);
    assert.notEqual(first, changedClasses);
    assert.notEqual(first, changedOperation);
    assert.notEqual(first, changedProject);
    assert.notEqual(first, changedSubject);
    assert.notEqual(first, changedActor);
    assert.notEqual(first, changedAction);
  });

  it("redacts open-ended diagnostics before rendering", () => {
    const summary = safeSummary({
      state: "degraded",
      connector: { connectorId: "connector/cloud", health: "unavailable" },
      secretValue: "never-render",
      leaseToken: "never-render",
      accessToken: "opaque-access-token",
      refresh_token: "opaque-refresh-token",
      sessionToken: "opaque-session-token",
      bearer_token: "opaque-bearer-token",
      oauthAccessToken: "opaque-oauth-token",
      nested: { authorization: "Bearer never-render", safe: "visible" },
      diagnostic: {
        message: "connector failed at C:\\Users\\operator\\private.txt",
        retry: "inspect /var/lib/private.txt before retry",
      },
      values: [
        "Bearer nested-value-secret",
        "sk-proj-1234567890abcdef",
        "ghp_1234567890abcdef",
        "C:\\Users\\operator\\private.txt",
        "/home/operator/private.txt",
        "/var/lib/private.txt",
        "\\\\server\\share\\private.txt",
        "access_token=opaque-embedded-token",
      ],
    });
    assert.match(summary, /connector\/cloud/);
    assert.match(summary, /visible/);
    assert.doesNotMatch(summary, /never-render|opaque-(?:access|refresh|session|bearer|oauth|embedded)-token/);
    assert.doesNotMatch(summary, /nested-value-secret|sk-proj|ghp_|Users|\/home\/operator|\/var\/lib|server/);
    assert.match(summary, /\[redacted unsafe value\]/);
    assert.doesNotMatch(summary, /secretValue|leaseToken|authorization|accessToken|refresh_token|sessionToken|bearer_token|oauthAccessToken/);
    for (const unsafe of [
      "connector failed with Bearer never-render",
      "token at C:\\Users\\operator\\private.txt",
      "token at /home/operator/private.txt",
      "token at \\\\server\\share\\private.txt",
      "api_key=never-render",
      ["fetch https", "//operator", "never-render@example.invalid/resource"].join(":"),
    ]) {
      assert.equal(safePresentationText(unsafe), "[redacted unsafe value]");
    }
    assert.equal(safePresentationText("connector/github is healthy"), "connector/github is healthy");
  });

  it("bounds open-ended summaries with explicit truncation markers", () => {
    const summary = safeSummary({
      oversized: "x".repeat(5_000),
      manyKeys: Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`key${index}`, `value${index}`])),
      manyItems: Array.from({ length: 100 }, (_, index) => index),
      total: Array.from({ length: 50 }, () => "y".repeat(2_000)),
    });
    assert.ok(summary.length <= 50_000);
    assert.match(summary, /\[truncated:/);
    assert.match(summary, /object fields omitted/);
    assert.match(summary, /array items omitted/);
    assert.doesNotMatch(summary, /x{2500}/);
  });

  it("projects Project Hub host capabilities into explicit expert and connector rows", () => {
    const rows = projectHostCapabilityRows({
      descriptors: [{
        descriptorId: "expert/reviewer",
        displayName: "Reviewer",
        health: "available",
        capabilities: ["review", "diagnose"],
        connectorRef: "connector/github",
      }],
      connectors: [{
        connectorId: "connector/github",
        displayName: "GitHub",
        kind: "remote-api",
        transport: "https",
        health: "degraded",
        secretReferenceConfigured: true,
      }],
      assignments: [{ planId: "assignment/review", approval: "approved" }],
    });
    assert.deepEqual(rows.experts[0], {
      id: "expert/reviewer",
      displayName: "Reviewer",
      health: "available",
      capabilities: ["review", "diagnose"],
      connectorRef: "connector/github",
    });
    assert.equal(rows.connectors[0]?.id, "connector/github");
    assert.equal(rows.connectors[0]?.secretReferenceConfigured, true);
    assert.equal(rows.assignments[0]?.planId, "assignment/review");
  });
});
