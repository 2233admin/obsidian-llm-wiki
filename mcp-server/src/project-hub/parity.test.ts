import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { describe, test } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry } from "../adapters/registry.js";
import type { VaultMindAdapter } from "../adapters/interface.js";
import { createOperationDispatcher } from "../control-plane/dispatcher.js";
import type { OperationContext } from "../core/types.js";
import { makeProjectHubOps } from "../project/project-hub.js";
import { createProjectSearchSource } from "./search-source.js";
import { fingerprintRecoveryValue } from "./contract-support.js";
import type { RecoveryOpenOwners } from "./recovery-open.js";
import { runRecoveryFlowCli } from "./cli.js";
import { makeWorkflowOps } from "../workflow/workflow.js";
import type { RecoveryApplyDependencies, RecoveryApplyResponseV2 } from "../workflow/recovery-apply.js";
import type { RecoveryPlannedResponseV2 } from "./recovery-flow.js";
import type { WorkRunStore } from "../workflow/work-run-store.js";
function memoryStore(): WorkRunStore {
  const claims = new Map<string, Record<string, unknown>>();
  const tokens = new Map<string, Record<string, unknown>>();
  return {
    withLock<T>(action: () => T): T { return action(); },
    readRun: () => null,
    writeRunAtomic: () => {},
    readLocalLease: () => null,
    writeLocalLeaseAtomic: () => {},
    readRecoveryClaim: (_project, fingerprint) => claims.get(fingerprint) ?? null,
    writeRecoveryClaimAtomic: (_project, fingerprint, value) => { claims.set(fingerprint, value); },
    readRecoveryToken: (_project, digest) => tokens.get(digest) ?? null,
    writeRecoveryTokenAtomic: (_project, digest, value) => { tokens.set(digest, value); },
    readOutputClaim: () => null,
    writeOutputClaimAtomic: () => {},
    readOutputToken: () => null,
    writeOutputTokenAtomic: () => {},
    readOutputRun: () => null,
    writeOutputRunAtomic: () => {},
    listOutputClaims: () => [],
  };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "llmwiki-recovery-parity-"));
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
  const openOwners: RecoveryOpenOwners = {
    workflow: { readRun: () => run, listRuns: () => [run], listCheckpoints: () => [], checkpointSetFingerprint: () => fingerprintRecoveryValue([]), readRuntimeProjection: () => ({ activeRuns: [], staleRuns: [], runCount: 0, agentStateFiles: [], workflowState: null, stage: null, stageCitation: null, sourceFiles: [], drift: [] }) },
    loadWorkItems: () => [{ entity: "project/alpha/issue/build", label: "Build recovery", state: "in-progress", blockedBy: [], citationTargets: ["issue:build"] }],
    loadProjectMemory: async () => ({ revision: 1, fingerprint: fingerprintRecoveryValue("memory"), freshness: "current", reviewedDecisions: [] }),
    listSessions: async () => [],
    listSourceEvidence: async () => ({ records: [] }),
    loadAgentDomainCapabilities: async () => ({ records: [{ capability: "workflow.recovery.plan", state: "available", citationTargets: ["capability:plan"] }] }),
    loadSettingsCapabilities: async () => ({ records: [] }),
  };
  const registry = new AdapterRegistry();
  const filesystem: VaultMindAdapter = { name: "filesystem", capabilities: ["search", "read"], isAvailable: true, async init() {}, async dispose() {} };
  const store = memoryStore();
  let ownerCalls = 0;
  const owner = async (plan: { projectId: string; workItemId: string; workRunId: string | null }, actor: string) => {
    ownerCalls += 1;
    return {
      ok: true,
      projectId: plan.projectId,
      workItemId: plan.workItemId,
      workRunId: plan.workRunId ?? "work-run/recovery-created",
      agent: actor,
    };
  };
  const recoveryApplyDependencies: RecoveryApplyDependencies = {
    store,
    recomputeCurrentPlanBasis: async () => {},
    join: async (plan, actor) => owner(plan, actor),
    createAndJoin: async (plan, actor) => owner(plan, actor),
    now: () => Date.parse("2026-08-28T02:00:00.000Z"),
    loadApplyCapability: async () => ({ capability: "workflow.recovery.apply", state: "available" }),
  };
  const ctx: OperationContext = {
    vault: { async execute() { return {}; } },
    adapters: registry,
    config: {
      vault_path: root,
      collaboration: {
        actor: "obsidian-control-plane",
        role: "agent",
        enforce: true,
        allowed_write_paths: ["01-Projects/alpha/**", ".vault-mind/**"],
      },
    },
    logger: { info() {}, warn() {}, error() {} },
    dryRun: true,
  };
  const operations = [
    ...makeProjectHubOps(registry, undefined, {
      recoveryFlow: {
        openOwners,
        searchSource: createProjectSearchSource({
          "work-os": () => [{ itemId: "project/alpha/issue/build", itemType: "issue", label: "Build recovery", text: "recovery", projectId: "project/alpha", citationTargets: ["issue:build"] }],
        }),
        agentSelection: { listCompatible: async () => [{ role: "builder", bindingId: "binding/alpha/builder", bindingRevision: 2, profileId: "agent/builder", profileRevision: 3 }] },
        now: () => Date.parse("2026-08-28T02:00:00.000Z"),
      },
    }),
    ...makeWorkflowOps(root, { recoveryApplyDependencies }),
  ];
  const dispatcher = createOperationDispatcher(operations, ctx);
  return { root, dispatcher, ownerCalls: () => ownerCalls };
}

describe("Recovery Flow domain/MCP/CLI/Obsidian parity", () => {
  test("returns identical stages, fingerprints, and apply receipts across shared surfaces", async () => {
    const { root, dispatcher, ownerCalls } = fixture();
    try {
      const openRequest = { schemaVersion: "project-hub-recovery-flow-request/v2", projectId: "project/alpha", action: "open" } as const;
      const domainOpen = await dispatcher.invoke("project.hub.recovery.flow", { request: openRequest });
      const cliOpen = await runRecoveryFlowCli(["open", "--vault", root, "--project", "project/alpha"], dispatcher.invoke.bind(dispatcher));
      assert.deepEqual(cliOpen.result, domainOpen);

      const searchRequest = (domainOpen as any).nextRequests[0];
      const searchPath = join(root, "search.json");
      writeFileSync(searchPath, JSON.stringify(searchRequest));
      const domainSearch = await dispatcher.invoke("project.hub.recovery.flow", { request: searchRequest });
      const cliSearch = await runRecoveryFlowCli(["search", "--vault", root, "--input-file", searchPath], dispatcher.invoke.bind(dispatcher));
      assert.deepEqual(cliSearch.result, domainSearch);

      const planRequest = (domainSearch as any).nextRequests[0];
      const planPath = join(root, "plan.json");
      writeFileSync(planPath, JSON.stringify(planRequest));
      const domainPlan = await dispatcher.invoke("project.hub.recovery.flow", { request: planRequest });
      const cliPlan = await runRecoveryFlowCli(["plan", "--vault", root, "--input-file", planPath], dispatcher.invoke.bind(dispatcher));
      assert.deepEqual(cliPlan.result, domainPlan);
      assert.equal((cliPlan.result as any).flowFingerprint, (domainPlan as any).flowFingerprint);
      const applyPlan = (domainPlan as RecoveryPlannedResponseV2).payload.plan;
      // Load the real Obsidian adapter at runtime; a static import would pull it outside this package's tsc root.
      const { ProjectHubRecoveryClient, recoveryApplyTransitionToken } = await import(
        new URL("../../../obsidian-plugin/src/project-hub/recovery-client.ts", import.meta.url).href,
      );
      const applyRequest = {
        schemaVersion: "recovery-apply-request/v2",
        plan: applyPlan,
        planFingerprint: applyPlan.fingerprint,
        planningInput: { query: "recovery", limit: 5 },
        transitionToken: recoveryApplyTransitionToken({
          projectId: applyPlan.projectId,
          planFingerprint: applyPlan.fingerprint,
          confirmationActor: "obsidian-control-plane",
        }),
      };
      const mcpApply = await dispatcher.invoke("workflow.recovery.apply", { request: applyRequest }) as RecoveryApplyResponseV2;
      const applyPath = join(root, "apply.json");
      writeFileSync(applyPath, JSON.stringify(applyRequest));
      const cliApply = await runRecoveryFlowCli(
        ["apply", "--vault", root, "--input-file", applyPath],
        dispatcher.invoke.bind(dispatcher),
      );
      const obsidianClient = new ProjectHubRecoveryClient({
        async invoke<T>(operation: string, args: Record<string, unknown>): Promise<T> {
          return await dispatcher.invoke(operation, args) as T;
        },
      });
      const obsidianApply = await obsidianClient.apply(
        applyPlan,
        { query: " recovery ", limit: 5 },
        "obsidian-control-plane",
      );
      assert.equal(mcpApply.state, "applied");
      assert.ok(mcpApply.receipt);
      assert.equal(mcpApply.receipt.planFingerprint, applyPlan.fingerprint);
      assert.equal(mcpApply.receipt.tokenDigest, mcpApply.tokenDigest);
      assert.deepEqual(cliApply.result, mcpApply);
      assert.deepEqual(obsidianApply, mcpApply);
      assert.equal(ownerCalls(), 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
