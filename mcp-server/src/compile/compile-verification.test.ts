import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";

import { verifyStagedCompileArtifacts } from "./compile-verification.js";
import type { CompileArtifactReceipt } from "./types.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function artifact(stage: string, content: string, target = "topic-a/wiki/page.md"): CompileArtifactReceipt {
  const file = join(stage, "wiki", "page.md");
  writeFileSync(file, content, "utf8");
  const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
  return {
    artifactId: "artifact/compile-test",
    relativePath: target,
    stagedPath: "staging/topic-a/wiki/page.md",
    proposedTarget: target,
    contentDigest: digest,
    mediaType: "text/markdown",
  };
}

describe("Compile artifact verification", () => {
  test("opens the promotion gate for an in-scope artifact with a matching digest", () => {
    const root = mkdtempSync(join(tmpdir(), "llmwiki-compile-verification-"));
    roots.push(root);
    const stage = join(root, "topic-a");
    mkdirSync(join(stage, "wiki"), { recursive: true });
    const report = verifyStagedCompileArtifacts(stage, "topic-a", [artifact(stage, "# page\n")]);
    assert.equal(report.passed, true);
    assert.equal(report.recommendedDecision, "promote");
    assert.equal(report.acceptanceCoverage, 1);
  });

  test("keeps promotion closed when the manifest digest or target scope is wrong", () => {
    const root = mkdtempSync(join(tmpdir(), "llmwiki-compile-verification-"));
    roots.push(root);
    const stage = join(root, "topic-a");
    mkdirSync(join(stage, "wiki"), { recursive: true });
    const invalid = artifact(stage, "# page\n");
    invalid.proposedTarget = "../Projects/authority.md";
    invalid.contentDigest = "sha256:" + "0".repeat(64);
    const report = verifyStagedCompileArtifacts(stage, "topic-a", [invalid]);
    assert.equal(report.passed, false);
    assert.equal(report.recommendedDecision, "request_changes");
    assert.ok(report.checks.some((check) => check.checkId.startsWith("target:") && !check.passed));
    assert.ok(report.checks.some((check) => check.checkId.startsWith("digest:") && !check.passed));
  });
});
