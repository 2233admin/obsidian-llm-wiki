import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AdapterRegistry } from "./adapters/registry.js";
import type { SearchResult, VaultMindAdapter } from "./adapters/interface.js";
import { traceUnifiedQuery, unifiedQuery } from "./unified-query.js";

function adapter(name: string, results: SearchResult[] | Error): VaultMindAdapter {
  return {
    name,
    capabilities: ["search"],
    async init() {},
    async dispose() {},
    async search() {
      if (results instanceof Error) throw results;
      return results;
    },
  };
}

describe("unified tiered retrieval and redacted traces", () => {
  it("routes raw Evidence before stale compiled projections for high-detail factual support", async () => {
    const registry = new AdapterRegistry();
    registry.register(adapter("filesystem", [
      {
        source: "filesystem",
        path: "topic/wiki/summary.md",
        content: "compiled assertion",
        score: 1,
        metadata: {
          projectionRevision: "rev-1",
          activeSourceRevision: "rev-2",
          sourceId: "source/a",
          sourceRevision: "rev-1",
        },
      },
      {
        source: "filesystem",
        path: "topic/raw/source-a.md",
        content: "verbatim supporting evidence",
        score: 0.5,
        metadata: { sourceId: "source/a", sourceRevision: "rev-2" },
      },
    ]));
    const result = await unifiedQuery(registry, "support the assertion", {
      intent: "factual support with evidence",
      detail: "high",
    });
    assert.equal(result.results[0].evidence.tier, "raw-evidence");
    assert.equal(result.results[1].evidence.freshness.state, "stale");
    assert.equal(result.results[0].evidence.provenance.sourceRevision, "rev-2");
  });

  it("normalizes all named optional adapter results and preserves typed partial degradation", async () => {
    const registry = new AdapterRegistry();
    for (const name of ["qmd", "graphify", "lightrag", "raganything", "hindsight", "filesystem"]) {
      registry.register(adapter(name, [{
        source: name,
        path: `${name}/result.md`,
        content: `${name} evidence`,
        score: 1,
        metadata: name === "lightrag"
          ? { partial: true, missingCapabilities: ["structured-chunks"], diagnosticCodes: ["PARTIAL_RESULT"] }
          : {},
      }]));
    }
    const trace = await traceUnifiedQuery(registry, "agent wiki evidence", { maxResults: 20 });
    assert.equal(trace.evidence.length, 6);
    assert.ok(trace.evidence.every((item) => item.normalizedIdentifier.startsWith("llmwiki://evidence/")));
    const partial = trace.evidence.find((item) => item.source === "lightrag");
    assert.equal(partial?.partial.status, "partial");
    assert.deepEqual(partial?.partial.missingCapabilities, ["structured-chunks"]);
  });

  it("converts reflected adapter failures to bounded codes without trace leakage", async () => {
    const registry = new AdapterRegistry();
    registry.register(adapter("qmd", new Error("request https://user:pass@private.example.test?token=sk-secret failed")));
    const trace = await traceUnifiedQuery(registry, "safe query");
    assert.equal(trace.plan.branches[0].status, "error");
    assert.equal(trace.plan.branches[0].diagnosticCode, "SENSITIVE_ERROR_REDACTED");
    const serialized = JSON.stringify(trace);
    assert.equal(serialized.includes("sk-secret"), false);
    assert.equal(serialized.includes("private.example.test"), false);
  });

  it("restores legacy pure-RRF ordering behind the reversible retrieval flag", async () => {
    const registry = new AdapterRegistry();
    registry.register(adapter("filesystem", [
      { source: "filesystem", path: "topic/wiki/a.md", content: "compiled", score: 1 },
      { source: "filesystem", path: "topic/raw/b.md", content: "raw", score: 0.5 },
    ]));
    const trace = await traceUnifiedQuery(registry, "support", {
      intent: "factual support",
      detail: "high",
      tierRouting: false,
    });
    assert.equal(trace.mode, "legacy-rrf");
    assert.equal(trace.results[0].path, "topic/wiki/a.md");
    assert.equal(trace.results[1].path, "topic/raw/b.md");
  });
});
