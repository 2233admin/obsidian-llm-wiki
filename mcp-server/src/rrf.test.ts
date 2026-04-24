/**
 * Unit tests for RRF fusion. Pure function, no I/O.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { fuseRRF, RRF_K, type RankedBundle } from "./rrf.js";
import type { SearchResult } from "./adapters/interface.js";

function mkResult(path: string, source: string, score = 1): SearchResult {
  return { path, source, content: "", score };
}

test("RRF: empty bundles returns empty", () => {
  assert.deepEqual(fuseRRF([]), []);
});

test("RRF: single bundle preserves rank order", () => {
  const bundle: RankedBundle = {
    source: "a",
    weight: 1,
    results: [mkResult("p1", "a"), mkResult("p2", "a"), mkResult("p3", "a")],
  };
  const fused = fuseRRF([bundle]);
  assert.equal(fused.length, 3);
  assert.equal(fused[0].path, "p1");
  assert.equal(fused[1].path, "p2");
  assert.equal(fused[2].path, "p3");
  assert.equal(fused[0].score, 1 / (RRF_K + 1));
  assert.ok(fused[0].score > fused[1].score);
  assert.ok(fused[1].score > fused[2].score);
});

test("RRF: duplicate doc across sources accumulates", () => {
  const bundleA: RankedBundle = {
    source: "a",
    weight: 1,
    results: [mkResult("shared", "a"), mkResult("a-only", "a")],
  };
  const bundleB: RankedBundle = {
    source: "b",
    weight: 1,
    results: [mkResult("b-only", "b"), mkResult("shared", "b")],
  };
  const fused = fuseRRF([bundleA, bundleB]);

  const shared = fused.find((r) => r.path === "shared");
  const aOnly = fused.find((r) => r.path === "a-only");
  const bOnly = fused.find((r) => r.path === "b-only");
  assert.ok(shared && aOnly && bOnly);

  assert.equal(shared!.score, 1 / (RRF_K + 1) + 1 / (RRF_K + 2));
  assert.equal(aOnly!.score, 1 / (RRF_K + 2));
  assert.equal(bOnly!.score, 1 / (RRF_K + 1));

  // Shared doc wins -- the whole point of fusion.
  assert.equal(fused[0].path, "shared");
});

test("RRF: weights multiply contribution", () => {
  const bundleA: RankedBundle = {
    source: "a",
    weight: 2,
    results: [mkResult("p1", "a")],
  };
  const bundleB: RankedBundle = {
    source: "b",
    weight: 1,
    results: [mkResult("p1", "b")],
  };
  const fused = fuseRRF([bundleA, bundleB]);
  assert.equal(fused[0].score, 2 / (RRF_K + 1) + 1 / (RRF_K + 1));
});

test("RRF: custom key function lets callers override collision policy", () => {
  const r1: SearchResult = {
    path: "p",
    source: "a",
    content: "",
    score: 1,
    metadata: { id: "x" },
  };
  const r2: SearchResult = {
    path: "p",
    source: "b",
    content: "",
    score: 1,
    metadata: { id: "y" },
  };
  const fused = fuseRRF(
    [
      { source: "a", weight: 1, results: [r1] },
      { source: "b", weight: 1, results: [r2] },
    ],
    (r) => String(r.metadata?.id ?? r.path),
  );
  assert.equal(fused.length, 2);
});

test("RRF: metadata.rrfSources lists contributing sources", () => {
  const bundleA: RankedBundle = {
    source: "a",
    weight: 1,
    results: [mkResult("shared", "a")],
  };
  const bundleB: RankedBundle = {
    source: "b",
    weight: 1,
    results: [mkResult("shared", "b")],
  };
  const fused = fuseRRF([bundleA, bundleB]);
  const sources = (fused[0].metadata?.rrfSources as string[]) ?? [];
  assert.equal(sources.length, 2);
  assert.ok(sources.includes("a"));
  assert.ok(sources.includes("b"));
});

test("RRF: duplicate doc within same bundle counts only first occurrence", () => {
  // Cormack 2009 assumes unique ranked lists per source. If an adapter
  // returns the same path at rank 1 AND rank 5 in its own list, the
  // naive implementation would double-count that adapter's contribution
  // on that doc. Guard: first occurrence wins, later duplicates are
  // silently skipped.
  const bundle: RankedBundle = {
    source: "a",
    weight: 1,
    results: [
      mkResult("p1", "a"),
      mkResult("p2", "a"),
      mkResult("p1", "a"), // duplicate -- should not inflate p1's score
      mkResult("p3", "a"),
    ],
  };
  const fused = fuseRRF([bundle]);
  const p1 = fused.find((r) => r.path === "p1");
  assert.ok(p1);
  // p1 should score only for rank 1 (not rank 1 + rank 3).
  assert.equal(p1!.score, 1 / (RRF_K + 1));
  // Still 3 distinct docs in output.
  assert.equal(fused.length, 3);
});

test("RRF: tied scores resolve deterministically by path ascending", () => {
  // Two docs in different sources, both at rank 1, equal weight.
  // Pre-fix, V8 stable sort + Map insertion order meant ties resolved
  // by Promise.allSettled completion order -- non-deterministic across
  // runs. Post-fix, path lexicographic order is the tie-breaker.
  const bundleA: RankedBundle = {
    source: "a",
    weight: 1,
    results: [mkResult("zebra", "a")],
  };
  const bundleB: RankedBundle = {
    source: "b",
    weight: 1,
    results: [mkResult("apple", "b")],
  };
  const fused = fuseRRF([bundleA, bundleB]);
  // Both have identical RRF score = 1/(60+1).
  assert.equal(fused[0].score, fused[1].score);
  // Tie-break by path asc puts "apple" first.
  assert.equal(fused[0].path, "apple");
  assert.equal(fused[1].path, "zebra");
});

test("RRF: all bundles with empty results returns empty", () => {
  // Useful when every adapter failed or returned nothing -- fuseRRF
  // should not crash on the empty inner lists.
  const fused = fuseRRF([
    { source: "a", weight: 1, results: [] },
    { source: "b", weight: 1, results: [] },
  ]);
  assert.deepEqual(fused, []);
});
