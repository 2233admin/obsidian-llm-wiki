// rrf.bench.ts -- micro-benchmark: linear vs heap-based RRF.
// Run: node --test mcp-server/dist/rrf.bench.js

import { fuseRRF, fuseRRFOptimized } from "./rrf.js";
import type { RankedBundle } from "./rrf.js";

function mkResult(path: string, source: string): { path: string; source: string; content: string; score: number } {
  return { path, source, content: "", score: 1 };
}

const sources: RankedBundle[] = Array.from({ length: 6 }, (_, si) => {
  const src = String.fromCharCode(97 + si);
  const results = Array.from({ length: 500 }, (_, i) => {
    const isShared = i < 500 * 0.1;
    const path = isShared ? "shared-" + (i % 50) : src + "-doc-" + i;
    return mkResult(path, src);
  });
  return { source: src, weight: 1, results };
});

const RUNS = 50;
const LIMIT = 10;

// Warm-up.
for (let i = 0; i < 5; i++) {
  fuseRRF(sources);
  fuseRRFOptimized(sources, (r) => r.path, LIMIT);
}

const linearStart = Date.now();
for (let i = 0; i < RUNS; i++) {
  fuseRRF(sources);
}
const linearMs = Date.now() - linearStart;

const optStart = Date.now();
for (let i = 0; i < RUNS; i++) {
  fuseRRFOptimized(sources, (r) => r.path, LIMIT);
}
const optMs = Date.now() - optStart;

const avgLinear = linearMs / RUNS;
const avgOpt = optMs / RUNS;
const speedup = avgLinear / avgOpt;

console.log(
  "RRF benchmark (6 sources x 500 results, limit=10, 50 runs):" + String.fromCharCode(10) +
  "  linear:    " + avgLinear.toFixed(3) + " ms/op" + String.fromCharCode(10) +
  "  optimized: " + avgOpt.toFixed(3) + " ms/op" + String.fromCharCode(10) +
  "  speedup:   " + speedup.toFixed(2) + "x",
);

// Correctness check.
const linear = fuseRRF(sources);
const optimized = fuseRRFOptimized(sources, (r) => r.path, LIMIT);
if (optimized.length !== LIMIT) process.exit(1);
for (let i = 0; i < LIMIT; i++) {
  if (optimized[i].path !== linear[i].path) {
    console.error("rank " + i + ": path mismatch -- linear=" + linear[i].path + " opt=" + optimized[i].path);
    process.exit(1);
  }
}
console.log("Correctness check: PASS");
