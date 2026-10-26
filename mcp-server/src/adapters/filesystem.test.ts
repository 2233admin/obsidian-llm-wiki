import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FilesystemAdapter, queryTerms } from "./filesystem.js";

const vault = mkdtempSync(join(tmpdir(), "fs-adapter-"));
mkdirSync(join(vault, "01-Projects", "demo"), { recursive: true });
writeFileSync(join(vault, "01-Projects", "demo", "risks.md"), "# Risks\nThe Python runtime may be missing on new machines.\n");
writeFileSync(join(vault, "01-Projects", "demo", "plan.md"), "# Plan\nShip the Python installer.\n");
writeFileSync(join(vault, "01-Projects", "demo", "风险.md"), "# 风险\n新机器上可能缺少运行时。\n");
writeFileSync(join(vault, "notes.md"), "Unrelated risks outside the project.\n");
after(() => rmSync(vault, { recursive: true, force: true }));

describe("FilesystemAdapter.search", () => {
  const adapter = new FilesystemAdapter(vault);
  const glob = "{01-Projects,10-Projects}/demo/**";

  test("splits questions into terms without stopwords or punctuation", () => {
    assert.deepEqual(queryTerms("What are the risks?"), ["risks"]);
    assert.deepEqual(queryTerms("Is the Python runtime missing?"), ["python", "runtime", "missing"]);
    assert.deepEqual(queryTerms("有什么风险"), ["有什", "什么", "么风", "风险"]);
    assert.deepEqual(queryTerms("what?"), ["what?"]);
  });

  test("finds evidence for a natural-language question", async () => {
    const results = await adapter.search("What are the risks?", { glob });
    assert.deepEqual(results.map((result) => result.path), ["01-Projects/demo/risks.md"]);
    assert.equal(results[0]!.content, "# Risks");
  });

  test("ranks files by how many query terms they contain", async () => {
    const results = await adapter.search("Is the Python runtime missing?", { glob });
    assert.deepEqual(results.map((result) => result.path), ["01-Projects/demo/risks.md", "01-Projects/demo/plan.md"]);
    assert.ok(results[0]!.score > results[1]!.score);
  });

  test("keeps literal phrase matches at full score", async () => {
    const results = await adapter.search("Python runtime", { glob });
    assert.equal(results[0]!.path, "01-Projects/demo/risks.md");
    assert.equal(results[0]!.score, 1);
  });

  test("matches CJK questions through bigrams", async () => {
    const results = await adapter.search("有什么风险？", { glob });
    assert.deepEqual(results.map((result) => result.path), ["01-Projects/demo/风险.md"]);
  });

  test("respects the glob scope", async () => {
    const results = await adapter.search("risks");
    assert.ok(results.some((result) => result.path === "notes.md"));
    const scoped = await adapter.search("risks", { glob });
    assert.ok(scoped.every((result) => result.path.startsWith("01-Projects/demo/")));
  });
});
