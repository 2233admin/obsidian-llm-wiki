/**
 * End-to-end smoke test for the rewritten memU adapter.
 *
 * Verifies that search() and 1024d searchByVector() now route through
 * memu_graph.cli (PPR + dual-path) instead of the old ILIKE / raw-cosine
 * paths. Looks for two concrete signals in metadata:
 *   - recall_path: "merged" | "precise" | "generalized" | "empty"
 *   - ppr_score: positive float, distinguishable across rows
 *
 * Run after `npm run build`:
 *   node _probe_memu.mjs                # default query "openclaw"
 *   QUERY="memu" node _probe_memu.mjs   # override query
 */
import { MemUAdapter } from "./dist/adapters/memu.js";

const QUERY = process.env.QUERY ?? "openclaw";
const TOPK = Number(process.env.TOPK ?? 5);

const fmt = (s, w) => String(s ?? "").slice(0, w).padEnd(w);
const num = (v, p = 4) =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(p) : "n/a ";

function printRows(label, rows) {
  console.log(`\n=== ${label} (${rows.length} rows) ===`);
  if (rows.length === 0) {
    console.log("  <empty>");
    return;
  }
  console.log(
    `  ${fmt("name", 40)} ${fmt("type", 10)} score   ppr     pagerank  community  path`,
  );
  for (const r of rows.slice(0, TOPK)) {
    const m = r.metadata ?? {};
    console.log(
      `  ${fmt(m.name ?? r.path, 40)} ${fmt(m.type, 10)} ${num(r.score)} ${num(m.ppr_score)} ${num(m.pagerank, 6)}  ${fmt(m.community_id ?? "-", 9)} ${fmt(m.recall_path, 10)}`,
    );
  }
}

const t0 = Date.now();
const adapter = new MemUAdapter();
console.log(`QUERY="${QUERY}" topk=${TOPK}`);
console.log(`init ...`);
await adapter.init();
console.log(`isAvailable=${adapter.isAvailable} (init ${Date.now() - t0}ms)`);

if (!adapter.isAvailable) {
  console.error("adapter not available, aborting probe");
  process.exit(1);
}

// Path 1: search() — embeds via ollama, sends query+vec to graph_recall.
const tA = Date.now();
const searchRows = await adapter.search(QUERY, { maxResults: TOPK });
const dtA = Date.now() - tA;
printRows(`search("${QUERY}")  [${dtA}ms]`, searchRows);

// Path 2: searchByVector(1024d) — vec-only graph_recall (empty query string).
// Reuse a real 1024d vector by going through the same ollama endpoint the
// adapter uses internally; falls back to skip if ollama is down.
let vec1024 = null;
try {
  const resp = await fetch("http://localhost:11434/v1/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "qwen3-embedding:0.6b",
      input: [QUERY],
    }),
  });
  if (resp.ok) {
    const j = await resp.json();
    const v = j?.data?.[0]?.embedding;
    if (Array.isArray(v) && v.length === 1024) vec1024 = v;
  }
} catch {}

if (vec1024) {
  const tB = Date.now();
  const vecRows = await adapter.searchByVector(vec1024, { maxResults: TOPK });
  const dtB = Date.now() - tB;
  printRows(`searchByVector(1024d)  [${dtB}ms]`, vecRows);
} else {
  console.log("\n=== searchByVector(1024d) === SKIPPED (ollama unreachable)");
}

// Sanity assertions: prove we routed through graph_recall.
const sample = searchRows[0]?.metadata ?? {};
const haveRecallPath = typeof sample.recall_path === "string";
const havePprScore = typeof sample.ppr_score === "number" && sample.ppr_score > 0;
const haveCommunity = sample.community_id !== undefined;
console.log("\n=== assertions ===");
console.log(`  metadata.recall_path present : ${haveRecallPath ? "YES" : "no"}`);
console.log(`  metadata.ppr_score positive  : ${havePprScore ? "YES" : "no"}`);
console.log(`  metadata.community_id present: ${haveCommunity ? "YES" : "no"}`);

const distinct =
  searchRows.length > 1
    ? Math.max(...searchRows.map((r) => r.metadata?.ppr_score ?? 0)) /
      Math.max(
        Math.min(...searchRows.map((r) => r.metadata?.ppr_score ?? 1e-9)),
        1e-9,
      )
    : 1;
console.log(`  PPR top/bottom ratio         : ${distinct.toFixed(2)}x  (>3 means ranking has signal)`);

await adapter.dispose();
console.log(`\ndone in ${Date.now() - t0}ms`);
