import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";

import {
  COMPILE_RUN_PROTOCOL_VERSION,
  COMPILE_RUN_SCHEMA_VERSION,
  CompileRunStore,
  LegacyCompileRunAdapter,
  type CompileExecutionPort,
  type CompileResult,
} from "./compile-run-port.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function result(topic: string, ok = true): CompileResult {
  return {
    ok,
    topic,
    sourcesCompiled: ok ? 2 : 0,
    conceptsCreated: ok ? 1 : 0,
    contradictions: 0,
    ...(ok ? {} : { error: "compiler failed" }),
    timestamp: "2026-08-15T00:00:00.000Z",
  };
}

function root(): string {
  const value = mkdtempSync(join(tmpdir(), "llmwiki-compile-run-"));
  roots.push(value);
  return value;
}

describe("CompileRunPort", () => {
  test("persists one Run identity and receipt around legacy execution", async () => {
    const execution: CompileExecutionPort = {
      run: async (topic) => result(topic ?? "unknown"),
      abort: () => ({ ok: false, message: "No compilation running" }),
    };
    const port = new LegacyCompileRunAdapter(execution, {
      vaultPath: root(),
      now: () => new Date("2026-08-15T00:00:00.000Z"),
      runId: () => "compile-run/test-success",
    });

    const handle = await port.submit({ topic: "alpha", trigger: "manual" });
    assert.match(handle.runId, /^compile-run\//);
    const receipt = await handle.wait();

    assert.equal(receipt.runId, "compile-run/test-success");
    assert.equal(receipt.status, "succeeded");
    assert.equal(receipt.result?.topic, "alpha");
    const persisted = await port.inspect(handle.runId);
    assert.equal(persisted?.status, "succeeded");
    assert.equal(persisted?.requestDigest.startsWith("sha256:"), true);
  });

  test("does not claim canceled when the legacy executor cannot confirm termination", async () => {
    let release!: () => void;
    const done = new Promise<void>((resolve) => { release = resolve; });
    const execution: CompileExecutionPort = {
      run: async (topic) => {
        await done;
        return result(topic ?? "unknown");
      },
      abort: () => ({ ok: true, message: "Abort requested" }),
    };
    const port = new LegacyCompileRunAdapter(execution, { vaultPath: root() });
    const handle = await port.submit({ topic: "alpha", trigger: "manual" });
    const cancel = await port.cancel(handle.runId);

    assert.equal(cancel.status, "cancel_requested");
    release();
    const final = await handle.wait();
    assert.equal(final.status, "abandoned");
    assert.ok(final.diagnostics.some((item) => item.code === "CANCEL_OUTCOME_UNKNOWN"));
  });

  test("keeps verified artifacts pending until explicit approval, then promotes once", async () => {
    let promoteCalls = 0;
    const artifact = {
      artifactId: "artifact/compile-alpha-output",
      relativePath: "alpha/wiki/output.md",
      stagedPath: "staging/alpha/wiki/output.md",
      proposedTarget: "alpha/wiki/output.md",
      contentDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      mediaType: "text/markdown",
    };
    const execution: CompileExecutionPort = {
      run: async (_topic, context) => {
        context!.baseSnapshot = "snapshot-v1";
        return { ...result("alpha"), artifacts: [artifact] };
      },
      verify: async (_topic, _context, compileResult) => ({
        result: compileResult,
        verification: {
          artifactIds: [artifact.artifactId],
          checks: [{ checkId: "digest", passed: true, message: "verified" }],
          passed: true,
          acceptanceCoverage: 1,
          recommendedDecision: "promote",
        },
      }),
      promote: async (_topic, context, compileResult) => {
        promoteCalls += 1;
        assert.equal(context.baseSnapshot, "snapshot-v1");
        return {
          result: compileResult,
          verification: {
            artifactIds: [artifact.artifactId],
            checks: [{ checkId: "digest", passed: true, message: "verified" }],
            passed: true,
            acceptanceCoverage: 1,
            recommendedDecision: "promote",
          },
          promotion: { status: "promoted", targets: [artifact.proposedTarget], promotedAt: "2026-08-15T00:01:00.000Z" },
        };
      },
      abort: () => ({ ok: false, message: "No compilation running" }),
    };
    const port = new LegacyCompileRunAdapter(execution, {
      vaultPath: root(),
      runId: () => "compile-run/approval",
    });

    const handle = await port.submit({ topic: "alpha", trigger: "manual", promotionMode: "approval-required" });
    const pending = await handle.wait();
    assert.equal(pending.status, "awaiting_approval");
    assert.equal(pending.promotion?.status, "awaiting-approval");
    assert.equal(promoteCalls, 0);
    assert.equal((await port.inspect(handle.runId))?.baseSnapshot, "snapshot-v1");

    const approved = await port.approve(handle.runId);
    assert.equal(approved.status, "succeeded");
    assert.equal(approved.promotion?.status, "promoted");
    assert.equal(promoteCalls, 1);
  });

  test("converges stale active Runs to abandoned during recovery", async () => {
    const vaultPath = root();
    const store = new CompileRunStore(vaultPath);
    store.create({
      schemaVersion: COMPILE_RUN_SCHEMA_VERSION,
      protocolVersion: COMPILE_RUN_PROTOCOL_VERSION,
      runId: "compile-run/test-recovery",
      trigger: "manual",
      topic: "alpha",
      status: "running",
      requestDigest: "sha256:test",
      createdAt: "2026-08-14T23:00:00.000Z",
      updatedAt: "2026-08-14T23:00:00.000Z",
      startedAt: "2026-08-14T23:00:00.000Z",
      artifacts: [],
      diagnostics: [],
    });
    const execution: CompileExecutionPort = {
      run: async (topic) => result(topic ?? "unknown"),
      abort: () => ({ ok: false, message: "No compilation running" }),
    };
    const port = new LegacyCompileRunAdapter(execution, {
      vaultPath,
      now: () => new Date("2026-08-15T00:10:00.000Z"),
      staleAfterMs: 1,
      runId: () => "compile-run/test-recovery",
    });

    const recovered = await port.recover();
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0]?.runId, "compile-run/test-recovery");
    assert.equal(recovered[0]?.status, "abandoned");
    assert.equal((await port.inspect("compile-run/test-recovery"))?.status, "abandoned");
  });
});
