import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { _resetLazyIndex } from "../adapters/vaultbrain/lazy-index.js";
import { parseVaultRecallArgs, renderRecallResult, runVaultRecall } from "./vault-cli.js";

test("vault recall parses query and explicit vault path", () => {
  assert.deepEqual(parseVaultRecallArgs(["recall", "durable notes", "--vault", "D:/vault"]), {
    query: "durable notes",
    vaultPath: "D:\\vault",
  });
});

test("vault recall uses canonical environment path", () => {
  assert.deepEqual(parseVaultRecallArgs(["recall", "topic"], { VAULT_MIND_VAULT_PATH: "D:/vault" }), {
    query: "topic",
    vaultPath: "D:\\vault",
  });
});

test("vault recall renders citations with stable IDs", () => {
  const output = renderRecallResult({
    query: "topic",
    answer: "topic is documented [C1].",
    claims: [],
    citations: [{ id: "C1", rank: 1, source: "filesystem", path: "Notes/topic.md", snippet: "A useful fact." }],
    gaps: [],
    contradictions: [],
    confidence: "medium",
    trace: {} as never,
  });
  assert.match(output, /Query: topic/);
  assert.match(output, /\[C1\] Notes\/topic\.md: A useful fact\./);
});

test("vault recall indexes a fixture and cites a distributed natural-language query", { timeout: 30_000 }, async () => {
  const vaultPath = mkdtempSync(join(tmpdir(), "vault-recall-cli-"));
  const brainDataDir = mkdtempSync(join(tmpdir(), "vault-recall-brain-"));
  writeFileSync(join(vaultPath, "status.md"), "The current project status is documented here.\n", "utf8");
  writeFileSync(join(vaultPath, "blockers.md"), "Open blockers are tracked by the compiler team.\n", "utf8");
  try {
    const output = await runVaultRecall({
      query: "project status blockers",
      vaultPath,
      brainDataDir,
    });
    assert.match(output, /Citations:/);
    assert.match(output, /status|blockers/);
  } finally {
    _resetLazyIndex();
    rmSync(vaultPath, { recursive: true, force: true });
    rmSync(brainDataDir, { recursive: true, force: true });
  }
});
