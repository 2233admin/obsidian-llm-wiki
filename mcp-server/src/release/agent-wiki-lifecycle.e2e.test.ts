/**
 * Agent Wiki lifecycle E2E (filesystem baseline + optional provider contract smoke).
 *
 * Flow: register → plan → ingest → maintain → retrieve → revise → retract
 *
 * Uses public modules only. Does not modify production code.
 * Compile step is driven by CompileTrigger against the production compile.py;
 * extraction uses a deterministic loopback OpenAI-compatible test provider.
 */

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, test } from "node:test";

import { FilesystemAdapter } from "../adapters/filesystem.js";
import { CompileTrigger } from "../compile-trigger.js";
import type { Operation, OperationContext } from "../core/types.js";
import { DurableMaintenanceQueue } from "../maintenance/queue.js";
import { resolveAgentWikiFeatureFlags } from "./feature-flags.js";
import {
  buildRetrievalPlan,
  normalizeSearchResult,
  routeEvidence,
} from "../retrieval/evidence.js";
import { makeSourceOps } from "../source/source.js";
import {
  normalizeOpenCliDiscovery,
  openCliCompatibilitySurface,
  openCliDiscoveryCommand,
} from "../toolchain/provider-contracts.js";
import {
  ToolchainCapabilityRegistry,
  type ToolchainProbe,
} from "../toolchain/compatibility.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures", "agent-wiki-e2e");
const REPO_ROOT = resolve(HERE, "../../..");
const COMPILER_ROOT = join(REPO_ROOT, "compiler");

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

describe("Agent Wiki lifecycle E2E", () => {
  test("filesystem baseline: register→plan→ingest→maintain→retrieve→revise→retract + OpenCLI smoke", async () => {
    const vault = mkdtempSync(join(tmpdir(), "agent-wiki-e2e-"));
    const topic = "lifecycle-topic";
    const topicSourceRel = "raw/lifecycle-alpha.md";
    const sourceRel = `${topic}/${topicSourceRel}`;
    let provider: Awaited<ReturnType<typeof startLocalProvider>> | undefined;
    try {
      // --- 0) Feature flags baseline (public API) ---
      const flags = resolveAgentWikiFeatureFlags({
        VAULT_MIND_AGENT_WIKI_INGEST: "enabled",
        VAULT_MIND_COMPILE_TRIGGER_MODE: "durable",
        VAULT_MIND_RETRIEVAL_MODE: "tiered",
        VAULT_MIND_TOOLCHAIN_PROBES: "enabled",
      });
      assert.equal(flags.sourceIngestExecution, true);
      assert.equal(flags.durableMaintenance, true);
      assert.equal(flags.tieredRetrieval, true);

      // --- 1) Register ---
      seedSource(vault, sourceRel, readFixture("sample-source.md"));
      // CompileTrigger.drain only processes topics that look like real KB topics.
      writeFileSync(
        join(vault, topic, "_meta.json"),
        JSON.stringify({ topic, created: "2026-07-23", sources: {} }, null, 2) + "\n",
        "utf8",
      );
      const registered = await call(vault, "source.register", {
        inputType: "vaultPath",
        input: sourceRel,
        title: "Lifecycle Alpha",
        tags: ["e2e", "agent-wiki"],
      });
      assert.equal(registered.ok, true);
      assert.equal(registered.inputType, "vaultPath");
      assert.ok(typeof registered.id === "string" && (registered.id as string).length > 0);
      assert.ok(existsSync(join(vault, "_llmwiki", "source-registry.json")));

      // --- 2) Plan (report-only) ---
      const plan = await call(vault, "source.ingest.plan", {
        id: registered.id as string,
        inputType: "vaultPath",
      });
      assert.equal(plan.reportOnly, true);
      assert.equal(plan.willCreateIngestRun, false);
      assert.equal(plan.status, "ready");
      assert.match(plan.planId as string, /^ingest_plan_/);
      assert.match(plan.idempotencyKey as string, /^sha256:/);
      assert.deepEqual(plan.writes, []);
      assert.deepEqual(plan.externalEffects, []);

      // --- 3) Ingest (filesystem capture path) ---
      const ingested = await call(vault, "source.ingest.run", {
        id: registered.id as string,
        planId: plan.planId as string,
        leaseOwner: "e2e-worker/1",
      });
      const run = ingested.run as Record<string, unknown>;
      assert.equal(run.state, "succeeded");
      assert.deepEqual(run.completedStages, ["capture", "derive", "materialize"]);
      assert.equal(ingested.contentChanged, true);
      assert.ok(typeof ingested.evidencePath === "string");
      const evidencePath = ingested.evidencePath as string;
      assert.ok(existsSync(join(vault, ...evidencePath.split("/"))));
      const evidenceBody = readFileSync(join(vault, ...evidencePath.split("/")), "utf8");
      assert.match(evidenceBody, /source-revision: "sha256:/);
      assert.match(evidenceBody, /Lifecycle Alpha|durable maintenance/i);
      assert.ok(Array.isArray(ingested.maintenanceEntryIds));
      assert.equal((ingested.maintenanceEntryIds as string[]).length, 1);
      assert.ok(existsSync(join(vault, "_llmwiki", "maintenance", "queue.v1.json")));

      const verified = await call(vault, "source.ingest.verify", {
        runId: run.runId as string,
      });
      assert.equal(verified.verified, true);

      // --- 4) Maintain (real durable queue + CompileTrigger drain) ---
      const queue = new DurableMaintenanceQueue(vault);
      const planReport = queue.plan({
        reportOnly: true,
        now: new Date(Date.now() + 60_000),
      });
      assert.ok(planReport.eligible.length >= 1, "maintenance queue should have eligible work after ingest");
      assert.deepEqual(planReport.eligible[0]?.topicKeys, [topic]);
      assert.deepEqual(planReport.eligible[0]?.sourceIds, [registered.id]);

      provider = await startLocalProvider();
      const trigger = new CompileTrigger({
        vaultPath: vault,
        compilerPath: COMPILER_ROOT,
        python: process.env.PYTHON || "python",
        autoCompile: false,
        schedulingMode: "durable",
        debounceMs: 0,
        maximumLagMs: 60_000,
        environmentResolver: async () => ({
          ...process.env,
          PYTHONUTF8: "1",
          PYTHONIOENCODING: "utf-8",
          COMPILE_PROVIDER: "openai",
          COMPILE_MODEL: "agent-wiki-e2e-local",
          OPENAI_API_KEY: "local-e2e-placeholder",
          OPENAI_BASE_URL: provider?.baseUrl,
        }),
      });
      const maintenancePlan = trigger.maintenancePlan({
        now: new Date(Date.now() + 1_000),
        reportOnly: true,
      });
      assert.ok(maintenancePlan);
      assert.equal(maintenancePlan?.eligible.length, 0);
      const maintenanceNow = new Date(Date.now() + 60_000);
      const dueMaintenancePlan = trigger.maintenancePlan({
        now: maintenanceNow,
        reportOnly: true,
      });
      assert.ok((dueMaintenancePlan?.eligible.length ?? 0) >= 1);

      const drain = await trigger.drainMaintenance({
        owner: "e2e-maintain",
        maxTopics: 8,
        timeBudgetMs: 30_000,
        now: () => maintenanceNow,
      });
      assert.equal(drain.ok, true);
      assert.ok(Array.isArray(drain.processed));
      assert.ok((drain.processed as string[]).length >= 1);
      assert.ok(
        existsSync(join(vault, topic, "wiki", "concepts", "memory.md")),
        "production compiler should materialize the provider's concept projection",
      );

      // --- 5) Retrieve (filesystem + tiered routing) ---
      const fsAdapter = new FilesystemAdapter(vault);
      await fsAdapter.init();
      const hits = await fsAdapter.search("durable maintenance", { maxResults: 10 });
      assert.ok(hits.length >= 1, "filesystem search should find evidence or projections");
      const planNav = buildRetrievalPlan("concept overview navigation", "low");
      const planFact = buildRetrievalPlan("factual support verify evidence", "high");
      assert.equal(planNav.tierOrder[0], "compiled");
      assert.equal(planFact.tierOrder[0], "raw-evidence");
      const routed = routeEvidence(
        hits.map((hit) => normalizeSearchResult({
          ...hit,
          metadata: {
            ...(hit.metadata ?? {}),
            sourceId: registered.id,
            sourceRevision: plan.sourceVersion,
            profileRevision: "filesystem/1",
            freshness: "fresh",
          },
        })),
        planFact,
      );
      assert.ok(routed.length >= 1);
      assert.ok(routed.some((item) => item.evidence.tier === "raw-evidence" || item.evidence.tier === "compiled"));
      assert.ok(routed.every((item) => item.evidence.provenance.providerId));

      // --- 6) Revise (new source bytes → new plan → re-ingest → contentChanged) ---
      seedSource(vault, sourceRel, readFixture("sample-source-revised.md"));
      const planV2 = await call(vault, "source.ingest.plan", {
        id: registered.id as string,
        inputType: "vaultPath",
      });
      assert.notEqual(planV2.planId, plan.planId);
      assert.notEqual(planV2.sourceVersion, plan.sourceVersion);
      const revised = await call(vault, "source.ingest.run", {
        id: registered.id as string,
        planId: planV2.planId as string,
        leaseOwner: "e2e-worker/2",
      });
      assert.equal((revised.run as Record<string, unknown>).state, "succeeded");
      assert.equal(revised.contentChanged, true);
      assert.ok((revised.maintenanceEntryIds as string[]).length >= 1);
      const evidenceV2 = readFileSync(join(vault, ...(revised.evidencePath as string).split("/")), "utf8");
      assert.match(evidenceV2, /revised/i);
      assert.doesNotMatch(evidenceV2, /Alpha depends on durable maintenance/);

      // Source-versioned contribution revise via public compiler module (real Python).
      const topicRoot = join(vault, topic);
      const revisePy = runContributionPython(topicRoot, topicSourceRel, "revise");
      assert.equal(revisePy.status, 0, revisePy.stderr || revisePy.stdout);
      const reviseOut = JSON.parse(revisePy.stdout.trim().split(/\r?\n/).at(-1) ?? "{}") as {
        activated: string;
        deactivated: string[];
        conceptExists: boolean;
        hasObsolete: boolean;
        hasShared: boolean;
      };
      assert.ok(reviseOut.activated);
      assert.equal(reviseOut.hasObsolete, false);
      assert.equal(reviseOut.hasShared, true);
      assert.equal(reviseOut.conceptExists, true);

      // --- 7) Retract (remove source contributions; shared-only would remain if multi-source) ---
      const retractPy = runContributionPython(topicRoot, topicSourceRel, "retract");
      assert.equal(retractPy.status, 0, retractPy.stderr || retractPy.stdout);
      const retractOut = JSON.parse(retractPy.stdout.trim().split(/\r?\n/).at(-1) ?? "{}") as {
        conceptExists: boolean;
        deactivated: string[];
      };
      assert.equal(retractOut.conceptExists, false);
      assert.ok(retractOut.deactivated.length >= 1);

      // --- Optional provider contract smoke (OpenCLI, no live network) ---
      const opencliVersion = readFixture("opencli-version.json");
      const opencliResult = normalizeOpenCliDiscovery({
        surface: "version",
        command: ["opencli", ...openCliDiscoveryCommand("version")],
        exitCode: 0,
        stdout: opencliVersion,
      });
      assert.equal(opencliResult.ok, true);
      assert.equal(opencliResult.boundary, "capture-provider");
      assert.ok(opencliResult.capabilities.includes("version.structured"));
      const surface = openCliCompatibilitySurface();
      assert.equal(surface.boundary, "capture-provider");
      assert.equal((surface.authority as { vault: boolean }).vault, false);
      assert.equal((surface.authority as { promotion: boolean }).promotion, false);

      const probe: ToolchainProbe = {
        observe: async () => ({
          observedVersion: "1.8.6",
          capabilities: [
            "version.structured",
            "command.list.structured",
            "definition.validate",
            "definition.verify",
            "doctor",
            "profiles.list",
            "plugins.list",
            "adapters.status",
          ],
          command: ["opencli", "list", "--format", "json"],
          exitCode: 0,
          output: opencliVersion,
        }),
      };
      const registry = new ToolchainCapabilityRegistry(probe, 60_000, () => new Date("2026-07-23T00:00:00.000Z"));
      const receipt = await registry.inspect("opencli");
      assert.equal(receipt.health, "available");
      assert.equal(receipt.compatibility, "compatible");
      assert.equal(receipt.toolchainId, "opencli");
    } finally {
      if (provider) await closeLocalProvider(provider.server);
      rmSync(vault, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function call(
  vault: string,
  name: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const operation = operationFor(vault, name);
  return await operation.handler(context(vault), params) as Record<string, unknown>;
}

function operationFor(vault: string, name: string): Operation {
  const operation = makeSourceOps(vault, { ingestExecutionEnabled: true })
    .find((candidate) => candidate.name === name);
  assert.ok(operation, `${name} operation exists`);
  return operation;
}

function context(vault: string): OperationContext {
  return {
    vault: { execute: async () => null },
    adapters: null,
    config: { vault_path: vault },
    logger,
    dryRun: false,
  };
}

function seedSource(vault: string, relativePath: string, content: string): void {
  const full = join(vault, ...relativePath.split("/"));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
}

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

async function startLocalProvider(): Promise<{ server: Server; baseUrl: string }> {
  const extraction = JSON.stringify({
    summary: "Lifecycle Agent Wiki source with durable maintenance.",
    concepts: [{ name: "Memory", definition: "Durable maintained Agent Wiki memory." }],
    relationships: [],
    claims: [{
      content: "Durable maintenance keeps Agent Wiki memory current.",
      confidence: 0.99,
      conceptKeys: ["memory"],
    }],
  });
  const server = createServer((request, response) => {
    request.resume();
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not-found" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      choices: [{ message: { role: "assistant", content: extraction } }],
    }));
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (error: Error) => rejectListen(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolveListen();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    server,
    baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}/v1`,
  };
}

async function closeLocalProvider(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
}

/**
 * Drive compiler contribution_manifest revise/retract against the topic root.
 * Invokes the real Python module via fixture helper (no production TS edits).
 */
function runContributionPython(
  topicRoot: string,
  sourcePath: string,
  mode: "revise" | "retract",
): { status: number | null; stdout: string; stderr: string } {
  const helper = join(FIXTURES, "contribution_lifecycle.py");
  const result = spawnSync(
    "python",
    [
      helper,
      "--compiler-root",
      COMPILER_ROOT,
      "--topic-root",
      topicRoot,
      "--source-path",
      sourcePath,
      "--mode",
      mode,
    ],
    {
      encoding: "utf8",
      cwd: REPO_ROOT,
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
