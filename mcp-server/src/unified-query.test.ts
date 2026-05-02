/**
 * Integration tests for unifiedQuery() call site.
 *
 * Uses inline fake adapters -- no real filesystem/memu/PG dependency.
 * Purpose: if someone swaps the fusion algorithm again, regression surfaces
 * here before the rrf.ts unit tests do (which only test fuseRRF in isolation).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { unifiedQuery } from "./unified-query.js";
import type { VaultMindAdapter, SearchResult } from "./adapters/interface.js";
import { AdapterRegistry } from "./adapters/registry.js";

// ---------------------------------------------------------------------------
// Minimal fake adapter factory
// ---------------------------------------------------------------------------

function fakeAdapter(
  name: string,
  results: SearchResult[],
): VaultMindAdapter {
  return {
    name,
    capabilities: ["search"] as const,
    isAvailable: true,
    async init() {},
    async dispose() {},
    async search(_query, _opts) {
      return results;
    },
  };
}

function mkResult(path: string, source: string, score = 1): SearchResult {
  return { path, source, content: "", score };
}

function makeRegistry(...adapters: VaultMindAdapter[]): AdapterRegistry {
  const reg = new AdapterRegistry();
  for (const a of adapters) reg.register(a);
  return reg;
}

// ---------------------------------------------------------------------------
// Test 1: Single adapter -- results come back in original rank order
// ---------------------------------------------------------------------------

test("unifiedQuery: single adapter round-trip preserves rank", async () => {
  const results = [
    mkResult("alpha", "fake"),
    mkResult("beta", "fake"),
    mkResult("gamma", "fake"),
  ];
  const registry = makeRegistry(fakeAdapter("fake", results));

  const out = await unifiedQuery(registry, "anything");

  assert.equal(out.results.length, 3);
  // RRF with one source: rank-1 doc has highest score (1/(60+1)),
  // so original order should be preserved.
  assert.equal(out.results[0].path, "alpha");
  assert.equal(out.results[1].path, "beta");
  assert.equal(out.results[2].path, "gamma");
  assert.equal(out.totalResults, 3);
  assert.ok("fake" in out.sources);
  assert.equal(out.sources.fake.count, 3);
});

// ---------------------------------------------------------------------------
// Test 2: Two adapters with a shared doc -- shared doc ranks first (RRF core)
// ---------------------------------------------------------------------------

test("unifiedQuery: shared doc across two adapters ranks first", async () => {
  // adapterA: [docX rank-1, docA rank-2]
  // adapterB: [docB rank-1, docX rank-2]
  // docX appears in both sources => accumulated RRF score beats single-source docs.
  //
  // Scores:
  //   docX = 1/(60+1) + 1/(60+2) = ~0.01639 + ~0.01613 = ~0.03252
  //   docA = 1/(60+2) = ~0.01613
  //   docB = 1/(60+1) = ~0.01639
  // Order: docX > docB > docA (docB ties need path tie-break: "docA" < "docB")

  const adapterA = fakeAdapter("a", [
    mkResult("docX", "a"),
    mkResult("docA", "a"),
  ]);
  const adapterB = fakeAdapter("b", [
    mkResult("docB", "b"),
    mkResult("docX", "b"),
  ]);
  const registry = makeRegistry(adapterA, adapterB);

  const out = await unifiedQuery(registry, "any query");

  assert.equal(out.results.length, 3);
  // docX must be ranked first -- this is RRF's entire point.
  assert.equal(out.results[0].path, "docX", "shared doc should rank first");

  // Verify docX has rrfSources listing both adapters.
  const rrfSources = out.results[0].metadata?.rrfSources as string[] | undefined;
  assert.ok(Array.isArray(rrfSources), "rrfSources metadata present");
  assert.ok(rrfSources!.includes("a"), "rrfSources includes adapter a");
  assert.ok(rrfSources!.includes("b"), "rrfSources includes adapter b");

  assert.equal(out.totalResults, 3);
  assert.ok("a" in out.sources && "b" in out.sources);
});
