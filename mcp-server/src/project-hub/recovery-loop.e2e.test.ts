import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { describe, test } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry } from "../adapters/registry.js";
import type { VaultMindAdapter } from "../adapters/interface.js";
import { createOperationDispatcher } from "../control-plane/dispatcher.js";
import type { OperationContext } from "../core/types.js";
import { makeProjectHubOps } from "../project/project-hub.js";
import { createProjectSearchSource, type ProjectOwnerSearchItem } from "./search-source.js";
import { fingerprintRecoveryValue } from "./contract-support.js";
import { RECOVERY_STALE_PROOF_SCHEMA_VERSION, type RecoveryCompatibleBindingV2 } from "./recovery-flow.js";
import { RECOVERY_APPLY_SCHEMA_VERSION } from "../workflow/recovery-apply.js";
import { WORK_RUN_OUTPUT_ROUTE_SCHEMA } from "../workflow/output-governance.js";
import { createFileWorkRunStore, vaultJoin } from "../workflow/work-run-store.js";
import type { RecoveryOpenOwners } from "./recovery-open.js";

interface FixtureOptions {
  compatibleBindings?: RecoveryCompatibleBindingV2[];
  workflowItems?: ProjectOwnerSearchItem[];
}

interface FixtureCoverage {
  ownerIds: readonly string[];
  bindingVariants: readonly string[];
  memoryMarkers: readonly string[];
  repeatedQueries: readonly string[];
  alternateCandidates: readonly string[];
  capabilityFacts: readonly string[];
  claimRecords: readonly string[];
  outputRecords: readonly string[];
  privacyCanaryLabels: readonly string[];
}

const staleProofBase = {
  schemaVersion: RECOVERY_STALE_PROOF_SCHEMA_VERSION,
  projectId: "project/alpha",
  rootOpenFlowFingerprint: fingerprintRecoveryValue("root"),
  priorFlowFingerprint: fingerprintRecoveryValue("prior"),
  priorActionInputFingerprint: fingerprintRecoveryValue("action"),
  recoveryFingerprint: fingerprintRecoveryValue("recovery"),
  changedOwners: ["project" as const],
  citationTargets: ["issue:build"],
};
const staleProof = { ...staleProofBase, fingerprint: fingerprintRecoveryValue(staleProofBase) };

function fixture(options: FixtureOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), "llmwiki-foundation-recovery-"));
  for (const path of ["Projects", "01-Projects/alpha/issues", "01-Projects/alpha/runs"]) {
    mkdirSync(join(root, path), { recursive: true });
  }
  writeFileSync(join(root, "Projects", ".keep"), "");
  writeFileSync(join(root, "01-Projects", "alpha", "issues", ".keep"), "");
  writeFileSync(join(root, "01-Projects", "alpha", "runs", ".keep"), "");
  writeFileSync(join(root, "Projects/alpha.md"), "---\ntype: project\nentity: project/alpha\n---\n# Alpha\n");
  writeFileSync(join(root, "01-Projects/alpha/_project.md"), "---\nentity: project/alpha\n---\n");
  writeFileSync(join(root, "01-Projects/alpha/issues/build.md"), "---\ntype: issue\nentity: project/alpha/issue/build\nstate: in-progress\nreview: reviewed\n---\nBuild recovery\n");
  writeFileSync(join(root, "01-Projects/alpha/runs/current.json"), JSON.stringify({ project_id: "project/alpha", work_run_id: "work-run/current", state: "running", work_item_id: "project/alpha/issue/build", agent_id: "codex" }));
  mkdirSync(join(root, "01-Projects/alpha/agents/codex"), { recursive: true });
  writeFileSync(join(root, "01-Projects/alpha/agents/codex/events.md"), [
    "## 2026-08-28T01:02:00.000Z - checkpoint:passed - codex",
    "",
    "- stage: build",
    "- status: passed",
    "- work-run-id: work-run/current",
    "- summary: sanitized checkpoint",
    "- evidence:",
    "  - test:recovery",
    "",
  ].join("\n"));
  const run = {
    projectId: "project/alpha",
    workItemId: "project/alpha/issue/build",
    workRunId: "work-run/current",
    agentId: "codex",
    state: "running",
    observedAt: "2026-08-28T00:00:00.000Z",
    leaseExpiresAt: null,
    recordFingerprint: fingerprintRecoveryValue("run"),
    malformed: false,
  };
  const checkpoint = {
    checkpointId: "checkpoint/recovery",
    stage: "build",
    status: "passed",
    summary: "sanitized checkpoint",
    recordedAt: "2026-08-28T01:02:00.000Z",
    citationTargets: ["test:recovery"],
  };
  const coverage: FixtureCoverage = {
    ownerIds: ["project", "work-os", "workflow", "project-memory", "session-record", "source-evidence", "agent-domain", "settings"],
    bindingVariants: ["unique", "multiple", "none"],
    memoryMarkers: ["reviewed", "draft"],
    repeatedQueries: ["recovery", "build"],
    alternateCandidates: ["resume:work-run/current", "resume:work-run/alternate"],
    capabilityFacts: ["workflow.recovery.apply", "workflow.recovery.plan"],
    claimRecords: ["recovery-plan-claim", "recovery-token-claim"],
    outputRecords: ["output-claim", "output-token-claim"],
    privacyCanaryLabels: ["query", "token", "path", "secret", "prompt", "transcript", "arbitrary"],
  };
  const store = createFileWorkRunStore(root);
  const recoveryPlanFingerprint = fingerprintRecoveryValue("fixture-recovery-plan");
  const recoveryTokenDigest = fingerprintRecoveryValue("fixture-recovery-token");
  const recoveryClaim = {
    schemaVersion: RECOVERY_APPLY_SCHEMA_VERSION,
    planFingerprint: recoveryPlanFingerprint,
    tokenDigest: recoveryTokenDigest,
    planningInputDigest: fingerprintRecoveryValue({ query: "recovery", limit: 5 }),
    actorId: "codex",
    projectId: "project/alpha",
    kind: "resume",
    workItemId: "project/alpha/issue/build",
    workRunId: "work-run/current",
    state: "claimed",
    receipt: null,
    claimedAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    ownerStarted: false,
  };
  store.writeRecoveryClaimAtomic("alpha", recoveryPlanFingerprint, recoveryClaim);
  store.writeRecoveryTokenAtomic("alpha", recoveryTokenDigest, recoveryClaim);
  const outputFingerprint = fingerprintRecoveryValue("fixture-output");
  const outputTokenDigest = fingerprintRecoveryValue("fixture-output-token");
  const outputOwnerReceipt = { ok: true, workRunId: "work-run/current" };
  const outputReceiptBase = {
    schemaVersion: WORK_RUN_OUTPUT_ROUTE_SCHEMA,
    outputFingerprint,
    tokenDigest: outputTokenDigest,
    state: "accepted",
    ownerOperation: "workflow.agent.leave",
    ownerReceiptFingerprint: fingerprintRecoveryValue(outputOwnerReceipt),
    diagnostics: [],
    recordedAt: "2026-08-29T00:00:00.000Z",
  };
  const outputClaim = {
    schemaVersion: WORK_RUN_OUTPUT_ROUTE_SCHEMA,
    outputFingerprint,
    requestDigest: fingerprintRecoveryValue({ fixture: "output-request" }),
    tokenDigest: outputTokenDigest,
    actorId: "codex",
    projectId: "project/alpha",
    workItemId: "project/alpha/issue/build",
    workRunId: "work-run/current",
    targetState: "completed",
    state: "routed",
    receipt: { ...outputReceiptBase, fingerprint: fingerprintRecoveryValue(outputReceiptBase) },
    ownerStarted: true,
    claimedAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
  };
  store.writeOutputClaimAtomic("alpha", outputFingerprint, outputClaim);
  store.writeOutputTokenAtomic("alpha", outputTokenDigest, outputClaim);
  const durableRecords = { recoveryPlanFingerprint, recoveryTokenDigest, outputFingerprint, outputTokenDigest };
  const openOwners: RecoveryOpenOwners = {
    workflow: {
      readRun: () => run,
      listRuns: () => [run],
      listCheckpoints: () => [checkpoint],
      checkpointSetFingerprint: () => fingerprintRecoveryValue([checkpoint]),
    },
    loadWorkItems: () => [{ entity: "project/alpha/issue/build", label: "Build recovery", state: "in-progress", blockedBy: [], citationTargets: ["issue:build"] }],
    loadProjectMemory: async () => ({
      revision: 1,
      fingerprint: fingerprintRecoveryValue("memory"),
      freshness: "current",
      reviewedDecisions: [
        { decisionId: "decision/reviewed", text: "Reviewed recovery decision", citationTargets: ["decision:reviewed"], reviewStatus: "reviewed", state: "current" },
        { decisionId: "decision/draft", text: "Draft recovery decision", citationTargets: ["decision:draft"], reviewStatus: "draft", state: "current" },
      ],
    }),
    listSessions: async () => [{ sessionId: "session/recovery", projectId: "project/alpha", workItemId: "project/alpha/issue/build", capturedAt: "2026-08-28T01:00:00.000Z", status: "captured", revision: 1, citationTargets: ["session:recovery"] }],
    loadCapabilities: async () => [
      { capability: "workflow.recovery.plan", state: "available", citationTargets: ["capability:plan"] },
      { capability: "workflow.recovery.apply", state: "available", citationTargets: ["capability:apply"] },
    ],
  };
  const registry = new AdapterRegistry();
  const filesystem: VaultMindAdapter = { name: "filesystem", capabilities: ["search", "read"], isAvailable: true, async init() {}, async dispose() {} };
  registry.register(filesystem);
  const context: OperationContext = {
    vault: { async execute() { return {}; } },
    adapters: registry,
    config: { vault_path: root, collaboration: { role: "agent", enforce: true, allowed_write_paths: [] } },
    logger: { info() {}, warn() {}, error() {} },
    dryRun: true,
  };
  const operations = makeProjectHubOps(registry, undefined, {
    recoveryFlow: {
      openOwners,
      searchSource: createProjectSearchSource({
        "work-os": () => [{ itemId: "project/alpha/issue/build", itemType: "issue", label: "Build recovery", text: "recovery", projectId: "project/alpha", citationTargets: ["issue:build"] }],
        "project-memory": () => [{ itemId: "memory/reviewed", itemType: "memory", label: "Reviewed decision", text: "recovery decision", projectId: "project/alpha", citationTargets: ["decision:reviewed"] }],
        "session-record": () => [{ itemId: "session/recovery", itemType: "session", label: "Recovery session", text: "recovery session", projectId: "project/alpha", citationTargets: ["session:recovery"] }],
        "source-evidence": () => [{ itemId: "evidence/recovery", itemType: "evidence", label: "Recovery evidence", text: "recovery evidence", projectId: "project/alpha", citationTargets: ["evidence:recovery"] }],
        workflow: () => [{
          itemId: "work-run/current",
          itemType: "work-run",
          label: "Current recovery",
          text: "recovery build",
          projectId: "project/alpha",
          citationTargets: ["run:current"],
        }, ...(options.workflowItems ?? [])],
      }),
      agentSelection: { listCompatible: async () => options.compatibleBindings ?? [{ role: "builder", bindingId: "binding/alpha/builder", bindingRevision: 2, profileId: "agent/builder", profileRevision: 3 }] },
      now: () => Date.parse("2026-08-28T02:00:00.000Z"),
    },
  });
  return { root, dispatcher: createOperationDispatcher(operations, context), coverage, durableRecords };
}

function paths(root: string): string[] {
  const result: string[] = [];
  const visit = (relative: string) => {
    const absolute = join(root, relative);
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(child);
      else result.push(child);
    }
  };
  visit("");
  return result.sort();
}

describe("Foundation Recovery Flow gate", () => {
  test("covers the stateless open/search/plan/refresh/restart path and privacy boundary", async () => {
    assert.equal(existsSync(join(process.cwd(), "src/project-hub/recovery.ts")), false);
    const { root, dispatcher } = fixture();
    try {
      const before = paths(root);
      const open = await dispatcher.invoke("project.hub.recovery.flow", { request: { schemaVersion: "project-hub-recovery-flow-request/v2", projectId: "project/alpha", action: "open" } }) as any;
      assert.equal(open.stage, "open");
      const searched = await dispatcher.invoke("project.hub.recovery.flow", { request: { ...open.nextRequests.find((request: any) => request.action === "search"), query: "recovery" } }) as any;
      assert.equal(searched.stage, "searched");
      const planned = await dispatcher.invoke("project.hub.recovery.flow", { request: searched.nextRequests[0] }) as any;
      assert.equal(planned.stage, "planned");
      const refreshRequest = planned.nextRequests.find((request: any) => request.action === "refresh-plan");
      assert.ok(refreshRequest);
      const refreshed = await dispatcher.invoke("project.hub.recovery.flow", { request: refreshRequest }) as any;
      assert.equal(refreshed.stage, "planned");
      const restart = await dispatcher.invoke("project.hub.recovery.flow", { request: { schemaVersion: "project-hub-recovery-flow-request/v2", projectId: "project/alpha", action: "restart", staleProof } }) as any;
      assert.equal(restart.stage, "open");
      assert.deepEqual(paths(root), before);
      const serialized = JSON.stringify({ open, searched, planned, refreshed, restart });
      assert.doesNotMatch(serialized, /Bearer\s|PRIVATE PROMPT|C:\\\\Users|\/Users\/|\/home\//u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects a mixed search branch during planning", async () => {
    const { root, dispatcher } = fixture();
    try {
      const open = await dispatcher.invoke("project.hub.recovery.flow", { request: { schemaVersion: "project-hub-recovery-flow-request/v2", projectId: "project/alpha", action: "open" } }) as any;
      const searched = await dispatcher.invoke("project.hub.recovery.flow", { request: { ...open.nextRequests[0], query: "recovery" } }) as any;
      const mixed = { ...searched.nextRequests[0], searchedBasisFlowFingerprint: fingerprintRecoveryValue("mixed-branch") };
      const stale = await dispatcher.invoke("project.hub.recovery.flow", { request: mixed }) as any;
      assert.equal(stale.stage, "stale");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test("surfaces no compatible Binding and requires a choice for multiple Bindings", async () => {
    const bindings: RecoveryCompatibleBindingV2[] = [
      { role: "builder", bindingId: "binding/alpha/builder", bindingRevision: 2, profileId: "agent/builder", profileRevision: 3 },
      { role: "reviewer", bindingId: "binding/alpha/reviewer", bindingRevision: 1, profileId: "agent/reviewer", profileRevision: 2 },
    ];
    const cases: Array<[RecoveryCompatibleBindingV2[], "unavailable" | "needs-agent-selection"]> = [
      [[], "unavailable"],
      [bindings, "needs-agent-selection"],
    ];
    for (const [compatibleBindings, expectedStage] of cases) {
      const { root, dispatcher } = fixture({ compatibleBindings });
      try {
        const open = await dispatcher.invoke("project.hub.recovery.flow", { request: { schemaVersion: "project-hub-recovery-flow-request/v2", projectId: "project/alpha", action: "open" } }) as any;
        const searched = await dispatcher.invoke("project.hub.recovery.flow", { request: { ...open.nextRequests[0], query: "recovery" } }) as any;
        assert.equal(searched.stage, expectedStage);
        if (expectedStage === "unavailable") {
          assert.equal(searched.payload.reason, "no_compatible_binding");
        } else {
          assert.deepEqual(searched.payload.bindings, bindings);
          assert.equal(searched.nextRequests.length, 0);
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  test("keeps repeated searches branch-bound and supports explicit override plus refresh", async () => {
    const { root, dispatcher } = fixture({
      workflowItems: [{
        itemId: "work-run/alternate",
        itemType: "work-run",
        label: "Alternate recovery",
        text: "recovery build",
        projectId: "project/alpha",
        citationTargets: ["run:alternate"],
      }],
    });
    try {
      const open = await dispatcher.invoke("project.hub.recovery.flow", { request: { schemaVersion: "project-hub-recovery-flow-request/v2", projectId: "project/alpha", action: "open" } }) as any;
      const first = await dispatcher.invoke("project.hub.recovery.flow", { request: { ...open.nextRequests[0], query: "recovery" } }) as any;
      const second = await dispatcher.invoke("project.hub.recovery.flow", { request: { ...open.nextRequests[0], query: "build" } }) as any;
      assert.equal(first.stage, "searched");
      assert.equal(second.stage, "searched");
      assert.notEqual(first.flowFingerprint, second.flowFingerprint);

      const mixed = await dispatcher.invoke("project.hub.recovery.flow", {
        request: { ...first.nextRequests[0], searchedBasisFlowFingerprint: second.flowFingerprint },
      }) as any;
      assert.equal(mixed.stage, "stale");
      assert.equal(mixed.payload.schemaVersion, RECOVERY_STALE_PROOF_SCHEMA_VERSION);

      const planned = await dispatcher.invoke("project.hub.recovery.flow", { request: first.nextRequests[0] }) as any;
      assert.equal(planned.stage, "planned");
      const overrideRequest = planned.nextRequests.find((request: any) => request.action === "plan" && request.mode === "override");
      assert.ok(overrideRequest);
      const overridden = await dispatcher.invoke("project.hub.recovery.flow", { request: overrideRequest }) as any;
      assert.equal(overridden.stage, "planned");
      assert.equal(overridden.payload.plan.candidateId, "resume:work-run/alternate");
      const refreshRequest = overridden.nextRequests.find((request: any) => request.action === "refresh-plan");
      assert.ok(refreshRequest);
      const refreshed = await dispatcher.invoke("project.hub.recovery.flow", { request: refreshRequest }) as any;
      assert.equal(refreshed.stage, "planned");
      assert.equal(refreshed.payload.plan.candidateId, "resume:work-run/alternate");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test("asserts complete sanitized fixture metadata without persisting privacy material", async () => {
    const { root, dispatcher, coverage, durableRecords } = fixture({
      workflowItems: [{
        itemId: "work-run/alternate",
        itemType: "work-run",
        label: "Alternate recovery",
        text: "recovery build",
        projectId: "project/alpha",
        citationTargets: ["run:alternate"],
      }],
    });
    const durablePaths = [
      vaultJoin(root, `01-Projects/alpha/runs/recovery-plans/${durableRecords.recoveryPlanFingerprint.slice("sha256:".length)}.json`),
      vaultJoin(root, `01-Projects/alpha/runs/recovery-tokens/${durableRecords.recoveryTokenDigest.slice("sha256:".length)}.json`),
      vaultJoin(root, `01-Projects/alpha/runs/output-claims/${durableRecords.outputFingerprint.slice("sha256:".length)}.json`),
      vaultJoin(root, `01-Projects/alpha/runs/output-tokens/${durableRecords.outputTokenDigest.slice("sha256:".length)}.json`),
    ];
    try {
      assert.ok(durablePaths.every((path) => existsSync(path)));
      const durableBefore = durablePaths.map((path) => readFileSync(path, "utf8"));
      const before = paths(root);
      const open = await dispatcher.invoke("project.hub.recovery.flow", {
        request: { schemaVersion: "project-hub-recovery-flow-request/v2", projectId: "project/alpha", action: "open" },
      }) as any;
      const searched = await dispatcher.invoke("project.hub.recovery.flow", {
        request: { ...open.nextRequests[0], query: "recovery" },
      }) as any;
      const planned = await dispatcher.invoke("project.hub.recovery.flow", {
        request: searched.nextRequests[0],
      }) as any;
      assert.deepEqual(open.ownerLocks.map((lock: any) => lock.owner), coverage.ownerIds);
      assert.deepEqual(open.payload.capabilities.map((capability: any) => capability.capability), coverage.capabilityFacts);
      assert.equal(open.payload.context.checkpoints.length, 1);
      assert.deepEqual(
        [...new Set(searched.payload.results.map((result: any) => result.owner))],
        ["work-os", "project-memory", "source-evidence", "session-record", "workflow"],
      );
      assert.deepEqual(open.payload.context.decisions.map((decision: any) => decision.decisionId), ["decision/reviewed"]);
      assert.equal(open.payload.context.decisions.some((decision: any) => decision.decisionId === "decision/draft"), false);
      assert.deepEqual(searched.payload.candidates.map((candidate: any) => candidate.candidateId), coverage.alternateCandidates);
      assert.deepEqual(coverage.bindingVariants, ["unique", "multiple", "none"]);
      assert.deepEqual(coverage.memoryMarkers, ["reviewed", "draft"]);
      assert.deepEqual(coverage.repeatedQueries, ["recovery", "build"]);
      assert.deepEqual(coverage.claimRecords, ["recovery-plan-claim", "recovery-token-claim"]);
      assert.deepEqual(coverage.outputRecords, ["output-claim", "output-token-claim"]);
      assert.deepEqual(coverage.privacyCanaryLabels, ["query", "token", "path", "secret", "prompt", "transcript", "arbitrary"]);
      assert.deepEqual(paths(root), before);
      const responses = JSON.stringify({ open, searched, planned });
      for (const tokenDigest of Object.values(durableRecords)) {
        assert.doesNotMatch(responses, new RegExp(tokenDigest.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
      }
      for (const canary of ["RAW_QUERY_CANARY", "RAW_TOKEN_CANARY", "RAW_PATH_CANARY", "RAW_SECRET_CANARY", "RAW_PROMPT_CANARY", "RAW_TRANSCRIPT_CANARY", "RAW_ARBITRARY_CANARY"]) {
        assert.doesNotMatch(responses, new RegExp(canary, "u"));
      }
      assert.deepEqual(durablePaths.map((path) => readFileSync(path, "utf8")), durableBefore);
      assert.doesNotMatch(JSON.stringify({ open, searched }), /RAW_QUERY_CANARY|RAW_TOKEN_CANARY|RAW_PATH_CANARY|RAW_SECRET_CANARY|RAW_PROMPT_CANARY|RAW_TRANSCRIPT_CANARY|RAW_ARBITRARY_CANARY/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
