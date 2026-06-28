/**
 * TASK 13A -- bilingual keyword floor for vaultbrain's PGlite engine.
 *
 * Proves searchKeyword (ts_rank_cd over a 'simple' tsvector, RRF-fused with
 * pg_trgm similarity) now:
 *   - ranks an English natural-language *phrase* instead of returning 0, which
 *     is the failure the live trace showed (filesystem literal ripgrep + the old
 *     pg_trgm-only keyword both returned 0 for "...project status and blockers");
 *   - matches CJK via trigram, which 'simple' tsvector cannot word-segment;
 *   - needs NO embeddings (null-embedding chunks => no Ollama dependency);
 *   - is deterministic and returns [] on no match.
 *
 * Runs the real PGlite (WASM Postgres) engine against a throwaway temp dir.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGliteEngine } from "./pglite-engine.js";
import type { ChunkInput } from "./engine.js";

function chunk(i: number, text: string): ChunkInput {
  return { chunkIndex: i, chunkText: text, embedding: null, tokenCount: Math.ceil(text.length / 4) };
}

async function freshEngine(): Promise<{ engine: PGliteEngine; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "vbtest-"));
  const engine = new PGliteEngine(dir);
  await engine.connect();
  await engine.initSchema();
  return { engine, dir };
}

test("searchKeyword: English NL phrase ranks (regression: was 0 under literal match)", async () => {
  const { engine, dir } = await freshEngine();
  try {
    await engine.upsertChunks("a", [
      chunk(0, "The current work-OS project status and open blockers are tracked here."),
    ]);
    await engine.upsertChunks("b", [chunk(0, "Unrelated note about gardening and tomatoes.")]);

    const hits = await engine.searchKeyword("project status and blockers", 10);
    assert.ok(hits.length > 0, "NL multi-word query must return ranked hits, not 0");
    assert.equal(hits[0].slug, "a", "the work-OS chunk should rank first");
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("searchKeyword: CJK query matches via trigram (no segmentation needed)", async () => {
  const { engine, dir } = await freshEngine();
  try {
    await engine.upsertChunks("zh", [chunk(0, "当前项目状态与阻塞项都记录在这里。")]);
    await engine.upsertChunks("en", [chunk(0, "Totally unrelated english content.")]);

    const hits = await engine.searchKeyword("项目状态", 10);
    assert.ok(hits.length > 0, "CJK query must return hits via pg_trgm");
    assert.equal(hits[0].slug, "zh");
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("searchKeyword: no match -> [] ; identical queries are deterministic", async () => {
  const { engine, dir } = await freshEngine();
  try {
    await engine.upsertChunks("a", [chunk(0, "alpha beta gamma")]);
    await engine.upsertChunks("b", [chunk(0, "delta epsilon zeta")]);

    const none = await engine.searchKeyword("zzzznomatchxyz", 10);
    assert.equal(none.length, 0, "garbage query returns empty");

    const r1 = await engine.searchKeyword("alpha", 10);
    const r2 = await engine.searchKeyword("alpha", 10);
    assert.deepEqual(r1.map((r) => r.slug), r2.map((r) => r.slug), "deterministic order");
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});
