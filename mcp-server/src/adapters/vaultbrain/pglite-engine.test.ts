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
import { embeddingFingerprint, resolveEmbeddingProfile } from "../../embedding/profile.js";
import { EmbeddingIndexRebuildRequiredError } from "./embedding-index.js";

const PGLITE_TEST_TIMEOUT_MS = 20_000;

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

test("embedding fingerprint binds once and returns a per-index rebuild plan on model drift", { timeout: PGLITE_TEST_TIMEOUT_MS }, async () => {
  const { engine, dir } = await freshEngine();
  try {
    const bge = embeddingFingerprint(resolveEmbeddingProfile({ profileId: "ollama/bge-m3" }));
    const qwen = embeddingFingerprint(resolveEmbeddingProfile({ profileId: "ollama/qwen3-embedding:0.6b" }));
    await engine.ensureEmbeddingFingerprint(bge);
    await engine.ensureEmbeddingFingerprint(bge);
    await assert.rejects(
      () => engine.ensureEmbeddingFingerprint(qwen),
      (error: unknown) => {
        assert.ok(error instanceof EmbeddingIndexRebuildRequiredError);
        assert.equal(error.rebuildPlan.indexId, "vaultbrain");
        assert.equal(error.rebuildPlan.reason, "fingerprint-mismatch");
        assert.equal(error.rebuildPlan.actualFingerprint?.digest, bge.digest);
        assert.equal(error.rebuildPlan.expectedFingerprint.digest, qwen.digest);
        assert.ok(error.rebuildPlan.steps.every(step => step.includes("vaultbrain") || step.includes(qwen.digest)));
        return true;
      },
    );
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("searchKeyword: English NL phrase ranks (regression: was 0 under literal match)", { timeout: PGLITE_TEST_TIMEOUT_MS }, async () => {
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

test("searchKeyword: CJK query matches via trigram (no segmentation needed)", { timeout: PGLITE_TEST_TIMEOUT_MS }, async () => {
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

test("getLastIndexedAtMs: null with no pages, MAX(updated_at) after upsertPage", { timeout: PGLITE_TEST_TIMEOUT_MS }, async () => {
  const { engine, dir } = await freshEngine();
  try {
    assert.equal(await engine.getLastIndexedAtMs(), null, "empty store has no watermark");

    const before = Date.now();
    await engine.upsertPage("a", "A", "content a", "hash-a");
    const after = Date.now();

    const watermark = await engine.getLastIndexedAtMs();
    assert.ok(watermark !== null, "watermark set after a page is upserted");
    // allow slack for clock/precision differences between test host and PGlite's now()
    assert.ok(watermark! >= before - 1000 && watermark! <= after + 1000, `watermark ${watermark} should be near upsert time`);

    const firstWatermark = watermark!;
    await new Promise((r) => setTimeout(r, 10));
    await engine.upsertPage("b", "B", "content b", "hash-b");
    const secondWatermark = await engine.getLastIndexedAtMs();
    assert.ok(secondWatermark! >= firstWatermark, "watermark advances (MAX) after a later upsert");
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("page stamps persist alongside page hashes", { timeout: PGLITE_TEST_TIMEOUT_MS }, async () => {
  const { engine, dir } = await freshEngine();
  try {
    await engine.upsertPage("stamp", "Stamp", "content", "hash", { mtimeMs: 1234, sizeBytes: 56 });
    assert.deepEqual(await engine.getPageStamp("stamp"), { mtimeMs: 1234, sizeBytes: 56 });
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reindex state persists in vaultbrain metadata", { timeout: PGLITE_TEST_TIMEOUT_MS }, async () => {
  const { engine, dir } = await freshEngine();
  try {
    const state = {
      status: "incomplete" as const,
      startedAt: 1,
      finishedAt: 2,
      indexed: 1,
      total: 2,
      skipped: 0,
      deleted: 0,
      errors: ["b.md: read failed"],
    };
    await engine.setReindexState(state);
    assert.deepEqual(await engine.getReindexState(), state);
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("replacePage atomically replaces chunks, metadata, and page record", { timeout: PGLITE_TEST_TIMEOUT_MS }, async () => {
  const { engine, dir } = await freshEngine();
  try {
    await engine.upsertPage("replace", "Old", "old content", "old-hash");
    await engine.upsertChunks("replace", [chunk(0, "legacyneedle only")]);
    await engine.upsertLink("replace", "old-target");
    await engine.upsertTag("replace", "old-tag");

    await engine.replacePage(
      "replace",
      "New",
      "new content",
      "new-hash",
      [chunk(0, "freshneedle only")],
      ["new-target"],
      ["new-tag"],
      { mtimeMs: 10, sizeBytes: 18 },
    );

    assert.equal(await engine.getPageHash("replace"), "new-hash");
    assert.deepEqual(await engine.getPageStamp("replace"), { mtimeMs: 10, sizeBytes: 18 });
    assert.ok((await engine.searchKeyword("legacyneedle", 10)).every((hit) => hit.chunkText !== "legacyneedle only"));
    assert.equal((await engine.searchKeyword("freshneedle", 10))[0]?.chunkText, "freshneedle only");
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("replacePage rolls back the whole page when a write fails", { timeout: PGLITE_TEST_TIMEOUT_MS }, async () => {
  const { engine, dir } = await freshEngine();
  try {
    await engine.upsertPage("rollback", "Old", "old content", "old-hash");
    await engine.upsertChunks("rollback", [chunk(0, "legacyneedle")]);
    await engine.upsertLink("rollback", "old-target");
    await engine.upsertTag("rollback", "old-tag");

    await assert.rejects(() =>
      engine.replacePage(
        "rollback",
        "New",
        "new content",
        "new-hash",
        [chunk(2_147_483_648, "invalid integer")],
        ["new-target"],
        ["new-tag"],
      ),
    );

    assert.equal(await engine.getPageHash("rollback"), "old-hash");
    assert.equal((await engine.searchKeyword("legacyneedle", 10))[0]?.chunkText, "legacyneedle");
    assert.equal((await engine.searchKeyword("new-target", 10)).length, 0);
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("page hashes and deletion reconcile indexed page state", { timeout: PGLITE_TEST_TIMEOUT_MS }, async () => {
  const { engine, dir } = await freshEngine();
  try {
    await engine.upsertPage("keep", "Keep", "content", "hash-keep");
    await engine.upsertChunks("keep", [chunk(0, "keep chunk")]);
    await engine.upsertPage("remove", "Remove", "content", "hash-remove");
    await engine.upsertChunks("remove", [chunk(0, "remove chunk")]);

    assert.equal(await engine.getPageHash("keep"), "hash-keep");
    assert.deepEqual(await engine.listPageSlugs(), ["keep", "remove"]);

    await engine.deletePage("remove");

    const remaining = await engine.searchKeyword("remove chunk", 10);
    assert.ok(remaining.every((hit) => hit.slug !== "remove"));
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("searchKeyword: no match -> [] ; identical queries are deterministic", { timeout: PGLITE_TEST_TIMEOUT_MS }, async () => {
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
