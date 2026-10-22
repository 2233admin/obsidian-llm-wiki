import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { describe, test } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRecoveryFlowCli, safeCliError } from "./cli.js";

const root = mkdtempSync(join(tmpdir(), "llmwiki-recovery-cli-"));

describe("Recovery Flow CLI", () => {
  test("maps open to the shared Flow Operation", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const result = await runRecoveryFlowCli(
      ["open", "--vault", root, "--project", "project/alpha"],
      async (operation, args) => {
        calls.push([operation, args]);
        return { stage: "open" };
      },
    );
    assert.deepEqual(result, { command: "open", result: { stage: "open" } });
    assert.deepEqual(calls, [["project.hub.recovery.flow", {
      request: { schemaVersion: "project-hub-recovery-flow-request/v2", projectId: "project/alpha", action: "open" },
    }]]);
  });

  test("loads complete later-stage requests from JSON files", async () => {
    const inputPath = join(root, "request.json");
    const request = {
      schemaVersion: "project-hub-recovery-flow-request/v2",
      projectId: "project/alpha",
      action: "search",
      openFlowFingerprint: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      query: "recovery",
      limit: 25,
    };
    writeFileSync(inputPath, JSON.stringify(request));
    let received: Record<string, unknown> | undefined;
    const result = await runRecoveryFlowCli(["search", "--vault", root, "--input-file", inputPath], async (_operation, args) => {
      received = args;
      return { stage: "searched" };
    });
    assert.equal(result.command, "search");
    assert.deepEqual(received, { request });
  });

  test("requires JSON input for apply and never reads claim files", async () => {
    await assert.rejects(
      () => runRecoveryFlowCli(["apply", "--vault", root], async () => ({ ok: true })),
      /--input-file is required/u,
    );
  });

  test("maps apply to Workflow with the complete JSON request", async () => {
    const inputPath = join(root, "apply.json");
    const request = { schemaVersion: "recovery-apply-request/v2", plan: { fingerprint: "sha256:plan" }, planFingerprint: "sha256:plan", planningInput: { query: "recovery", limit: 1 }, transitionToken: "token" };
    writeFileSync(inputPath, JSON.stringify(request));
    let operation = "";
    let received: Record<string, unknown> | undefined;
    await runRecoveryFlowCli(["apply", "--vault", root, "--input-file", inputPath], async (name, args) => {
      operation = name;
      received = args;
      return { state: "applied" };
    });
    assert.equal(operation, "workflow.recovery.apply");
    assert.deepEqual(received, { request });
  });

  test("redacts credentials and absolute paths from adapter errors", () => {
    assert.deepEqual(
      safeCliError(new Error("Bearer super-secret while reading C:\\Users\\alice\\vault")),
      { code: -32603, message: "[redacted] while reading [path]" },
    );
  });
});

process.once("exit", () => rmSync(root, { recursive: true, force: true }));
