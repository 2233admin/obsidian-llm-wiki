/**
 * Unit tests for QmdAdapter.
 *
 * We don't assume qmd is installed on CI/dev machines, so tests use a
 * fake binary (a shell script / node script) fed via the `binary` option.
 * That keeps coverage meaningful without requiring qmd on PATH.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildQmdQueryArgs, QmdAdapter, type QmdSdkStore } from "./qmd.js";

function makeFakeBinary(stdout: string, exitCode = 0): {
  path: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "qmd-fake-"));
  // Cross-platform: use a node script as the fake "binary".
  const binPath = join(dir, "fake-qmd.cjs");
  const encoded = JSON.stringify(stdout);
  const script =
    "#!/usr/bin/env node\n" +
    `process.stdout.write(${encoded});\n` +
    `process.exit(${exitCode});\n`;
  writeFileSync(binPath, script, { mode: 0o755 });
  try {
    chmodSync(binPath, 0o755);
  } catch {
    // Windows may not need chmod
  }
  return {
    path: binPath,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    },
  };
}

describe("QmdAdapter", () => {
  it("isAvailable=false when binary missing (graceful degradation)", async () => {
    const adapter = new QmdAdapter({ binary: "definitely-not-a-real-binary-xyz123" });
    await adapter.init();
    assert.equal(adapter.isAvailable, false);
    const results = await adapter.search("anything");
    assert.deepEqual(results, []);
  });

  it("isAvailable=true when binary --version exits 0", async () => {
    const fake = makeFakeBinary("2.5.3\n");
    try {
      const adapter = new QmdAdapter({ binary: process.execPath, binaryArgs: [fake.path] });
      await adapter.init();
      assert.equal(adapter.isAvailable, true);
      await adapter.dispose();
    } finally {
      fake.cleanup();
    }
  });

  it("search() parses qmd --json output into SearchResult[]", async () => {
    const fakeOutput = JSON.stringify([
      {
        docid: "#abc123",
        score: 0.93,
        file: "notes/guide.md",
        line: 42,
        title: "Software Craftsmanship",
        context: "Work documentation",
        snippet: "This section covers the **craftsmanship** of building...",
      },
      {
        docid: "#def456",
        score: 0.81,
        file: "notes/meeting.md",
        title: "Weekly standup",
        snippet: "Discussed craftsmanship as a principle.",
      },
    ]);
    const fake = makeFakeBinary(fakeOutput, 0);
    try {
      // Drive node as the "binary", passing the fake script as its first arg.
      // Cross-platform: avoids Windows shebang limitations.
      const adapter = new QmdAdapter({
        binary: process.execPath,
        binaryArgs: [fake.path],
      });
      (adapter as unknown as { _available: boolean })._available = true;
      const results = await adapter.search("craftsmanship", { maxResults: 10 });
      assert.equal(results.length, 2);
      assert.equal(results[0].source, "qmd");
      assert.equal(results[0].path, "notes/guide.md");
      assert.equal(results[0].score, 0.93);
      assert.equal(results[0].content, "This section covers the **craftsmanship** of building...");
      assert.equal(results[0].metadata?.docid, "#abc123");
      assert.equal(results[0].metadata?.line, 42);
      assert.equal(results[1].content, "Discussed craftsmanship as a principle.");
    } finally {
      fake.cleanup();
    }
  });

  it("builds the qmd 2.5 structured-query contract with multiple collections", () => {
    assert.deepEqual(
      buildQmdQueryArgs("agent wiki", {
        limit: 7,
        collections: ["vault", "project", "vault"],
        intent: "find implementation evidence",
        explain: true,
        index: "work",
      }),
      [
        "--index",
        "work",
        "query",
        "intent: find implementation evidence\nlex: agent wiki\nvec: agent wiki",
        "--json",
        "-n",
        "7",
        "-c",
        "vault",
        "-c",
        "project",
        "--explain",
      ],
    );
  });

  it("normalizes qmd URIs while preserving the canonical URI as metadata", async () => {
    const fake = makeFakeBinary(JSON.stringify([{
      docid: "#uri",
      score: 1,
      file: "qmd://vault/notes/agent-wiki.md",
      snippet: "match",
    }]));
    try {
      const adapter = new QmdAdapter({ binary: process.execPath, binaryArgs: [fake.path] });
      (adapter as unknown as { _available: boolean })._available = true;
      const [result] = await adapter.search("agent wiki");
      assert.equal(result?.path, "notes/agent-wiki.md");
      assert.equal(result?.metadata?.uri, "qmd://vault/notes/agent-wiki.md");
    } finally {
      fake.cleanup();
    }
  });

  it("normalizes qmd 2.x index health and preserves the configured model fingerprint", async () => {
    const fixture = readFileSync(join(import.meta.dirname, "fixtures", "qmd-2.5-status.json"), "utf-8");
    const fake = makeFakeBinary(fixture);
    try {
      const adapter = new QmdAdapter({
        binary: process.execPath,
        binaryArgs: [fake.path],
        index: "work",
        collections: ["vault"],
        modelFingerprint: "sha256:qwen3-test",
      });
      (adapter as unknown as { _available: boolean })._available = true;
      const health = await adapter.indexHealth();
      assert.equal(health.available, true);
      assert.equal(health.documentCount, 10);
      assert.equal(health.embeddedDocumentCount, 8);
      assert.equal(health.embeddingCoverage, 0.8);
      assert.deepEqual(health.collections, ["vault", "project"]);
      assert.equal(health.modelFingerprint, "sha256:qwen3-test");
    } finally {
      fake.cleanup();
    }
  });

  it("gates optional SDK mode on Node, package, search, lifecycle, and health contracts", async () => {
    let searchCalls = 0;
    let closeCalls = 0;
    const sdk: QmdSdkStore = {
      async search(options) {
        searchCalls += 1;
        assert.deepEqual(options.collections, ["vault", "project"]);
        assert.equal(options.intent, "support the claim");
        assert.equal(options.explain, true);
        return [{
          docid: "#sdk",
          score: 0.91,
          file: "qmd://vault/notes/sdk.md",
          snippet: "SDK evidence",
          explanation: { rerank: 0.91 },
        }];
      },
      async getIndexHealth() {
        return { documents: 4, embedded: 4, collections: [{ name: "vault" }] };
      },
      async close() {
        closeCalls += 1;
      },
    };
    const adapter = new QmdAdapter({
      mode: "sdk",
      sdk,
      sdkPackageVersion: "2.5.3",
      nodeVersion: "22.15.0",
      collections: ["vault", "project"],
    });
    await adapter.init();
    assert.equal(adapter.isAvailable, true);
    const [result] = await adapter.search("claim", {
      intent: "support the claim",
      explain: true,
      maxResults: 5,
    });
    assert.equal(searchCalls, 1);
    assert.equal(result.path, "notes/sdk.md");
    assert.equal(result.metadata?.uri, "qmd://vault/notes/sdk.md");
    assert.deepEqual(result.metadata?.explanation, { rerank: 0.91 });
    assert.equal(result.metadata?.invocationMode, "sdk");
    const health = await adapter.indexHealth();
    assert.equal(health.embeddingCoverage, 1);
    await adapter.dispose();
    assert.equal(closeCalls, 1);
  });

  it("degrades incompatible SDK mode without invoking the injected provider", async () => {
    let invoked = false;
    const sdk: QmdSdkStore = {
      async search() { invoked = true; return []; },
      async getStatus() { return {}; },
      async close() {},
    };
    const adapter = new QmdAdapter({
      mode: "sdk",
      sdk,
      sdkPackageVersion: "1.1.6",
      nodeVersion: "20.19.0",
    });
    await adapter.init();
    assert.equal(adapter.isAvailable, false);
    assert.deepEqual(await adapter.search("must not run"), []);
    assert.equal(invoked, false);
    const health = await adapter.indexHealth();
    assert.ok(health.diagnostics.includes("QMD_SDK_NODE_INCOMPATIBLE"));
    assert.ok(health.diagnostics.includes("QMD_SDK_PACKAGE_INCOMPATIBLE"));
  });

  it("search() returns [] on invalid JSON", async () => {
    const fake = makeFakeBinary("this is not json", 0);
    try {
      const adapter = new QmdAdapter({
        binary: process.execPath,
        binaryArgs: [fake.path],
      });
      (adapter as unknown as { _available: boolean })._available = true;
      const results = await adapter.search("q");
      assert.deepEqual(results, []);
    } finally {
      fake.cleanup();
    }
  });

  it("search() returns [] on non-zero exit", async () => {
    const fake = makeFakeBinary("[]", 2);
    try {
      const adapter = new QmdAdapter({
        binary: process.execPath,
        binaryArgs: [fake.path],
      });
      (adapter as unknown as { _available: boolean })._available = true;
      const results = await adapter.search("q");
      assert.deepEqual(results, []);
    } finally {
      fake.cleanup();
    }
  });

  it("search() returns [] when not available (no subprocess spawn)", async () => {
    const adapter = new QmdAdapter();
    // _available stays false by default
    const results = await adapter.search("anything");
    assert.deepEqual(results, []);
  });
});
