import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";

import {
  AGENT_RUN_PROTOCOL_VERSION,
  AGENT_RUN_SCHEMA_VERSION,
  AgentRunStore,
  LegacyAgentRunnerAdapter,
  type AgentExecutionPort,
  type AgentRunResult,
} from "./agent-runner-port.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const value = mkdtempSync(join(tmpdir(), "llmwiki-agent-run-"));
  roots.push(value);
  return value;
}

function result(action: string, status: string = "ok"): AgentRunResult {
  return { action, status, target: "vault", details: `${action} ${status}` };
}

describe("AgentRunnerPort", () => {
  test("persists one Run identity and receipt around legacy execution", async () => {
    const execution: AgentExecutionPort = {
      run: async (request) => result(request.action),
      abort: () => ({ ok: false, message: "No agent action running" }),
    };
    const port = new LegacyAgentRunnerAdapter(execution, {
      vaultPath: root(),
      now: () => new Date("2026-08-15T00:00:00.000Z"),
      runId: () => "agent-run/test-success",
    });

    const handle = await port.submit({ action: "emerge", mode: "manual" });
    const receipt = await handle.wait();

    assert.equal(receipt.runId, "agent-run/test-success");
    assert.equal(receipt.status, "succeeded");
    assert.equal(receipt.result?.action, "emerge");
    const persisted = await port.inspect(handle.runId);
    assert.equal(persisted?.status, "succeeded");
    assert.match(persisted?.requestDigest ?? "", /^sha256:/);
  });

  test("does not claim canceled when the executor cannot confirm termination", async () => {
    let release!: () => void;
    const done = new Promise<void>((resolve) => { release = resolve; });
    const execution: AgentExecutionPort = {
      run: async (request) => {
        await done;
        return result(request.action);
      },
      abort: () => ({ ok: true, message: "Abort requested" }),
    };
    const port = new LegacyAgentRunnerAdapter(execution, { vaultPath: root() });
    const handle = await port.submit({ action: "challenge" });
    const cancel = await port.cancel(handle.runId);

    assert.equal(cancel.status, "cancel_requested");
    release();
    const final = await handle.wait();
    assert.equal(final.status, "abandoned");
    assert.ok(final.diagnostics.some((item) => item.code === "CANCEL_OUTCOME_UNKNOWN"));
  });

  test("converges stale active Runs to abandoned during recovery", async () => {
    const vaultPath = root();
    const store = new AgentRunStore(vaultPath);
    store.create({
      schemaVersion: AGENT_RUN_SCHEMA_VERSION,
      protocolVersion: AGENT_RUN_PROTOCOL_VERSION,
      runId: "agent-run/test-recovery",
      action: "prune",
      mode: "manual",
      status: "running",
      requestDigest: "sha256:test",
      createdAt: "2026-08-14T23:00:00.000Z",
      updatedAt: "2026-08-14T23:00:00.000Z",
      startedAt: "2026-08-14T23:00:00.000Z",
      diagnostics: [],
    });
    const execution: AgentExecutionPort = {
      run: async (request) => result(request.action),
      abort: () => ({ ok: false, message: "No agent action running" }),
    };
    const port = new LegacyAgentRunnerAdapter(execution, {
      vaultPath,
      now: () => new Date("2026-08-15T00:10:00.000Z"),
      staleAfterMs: 1,
    });

    const recovered = await port.recover();
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0]?.runId, "agent-run/test-recovery");
    assert.equal(recovered[0]?.status, "abandoned");
  });
});
