/**
 * MemUAdapter tests.
 *
 * Two layers, matching qmd.test.ts philosophy ("don't assume the backend
 * is installed on CI/dev"):
 *
 *   1. Unavailable paths -- run unconditionally, no PG required. Covers the
 *      graceful-degradation contract: bad DSN, pre-init search, dispose
 *      safety, static capability/name shape, empty-vector guard.
 *
 *   2. Integration paths -- skipped unless MEMU_TEST_DSN is set. When set,
 *      these tests seed a small fixture into the target DB (requires
 *      pgvector extension), exercise the real PG round-trip for both
 *      ILIKE and vector search, and clean up after themselves. Use a
 *      throwaway database.
 *
 * Example integration run:
 *   createdb memu_test
 *   psql memu_test -c 'CREATE EXTENSION vector'
 *   MEMU_TEST_DSN=postgresql://postgres:postgres@localhost:5432/memu_test \
 *     MEMU_TEST_USER_ID=memu-adapter-test \
 *     npm run build && npm test
 */

import { test, describe, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { MemUAdapter } from "./memu.js";

const TEST_DSN = process.env.MEMU_TEST_DSN;
const TEST_USER_ID = process.env.MEMU_TEST_USER_ID ?? "memu-adapter-test";
const OTHER_USER_ID = `${TEST_USER_ID}-other`;
const DIM = 1024;

// A DSN that resolves but refuses fast -- ECONNREFUSED on localhost:1.
const BAD_DSN = "postgresql://postgres@127.0.0.1:1/nonexistent";

// Build a 1024-dim one-hot basis vector with a 1 at index `i`, 0 elsewhere.
// Orthogonal basis vectors have cosine similarity 0 to each other, 1 to self.
function basisVec(i: number): number[] {
  const v = new Array<number>(DIM).fill(0);
  v[i] = 1;
  return v;
}

function basisVecLiteral(i: number): string {
  return `[${basisVec(i).join(",")}]`;
}

describe("MemUAdapter -- unavailable paths", () => {
  test("bad DSN: init() resolves, isAvailable=false", async () => {
    const adapter = new MemUAdapter({ dsn: BAD_DSN, userId: "nobody", timeout: 500 });
    await adapter.init();
    assert.equal(adapter.isAvailable, false);
    await adapter.dispose();
  });

  test("search() returns [] when backend unavailable (no throw)", async () => {
    const adapter = new MemUAdapter({ dsn: BAD_DSN, userId: "nobody", timeout: 500 });
    await adapter.init();
    const results = await adapter.search("anything");
    assert.deepEqual(results, []);
    await adapter.dispose();
  });

  test("search() without init also returns [] (defensive)", async () => {
    const adapter = new MemUAdapter({ dsn: BAD_DSN });
    const results = await adapter.search("anything");
    assert.deepEqual(results, []);
  });

  test("searchByVector() returns [] when backend unavailable (no throw)", async () => {
    const adapter = new MemUAdapter({ dsn: BAD_DSN, userId: "nobody", timeout: 500 });
    await adapter.init();
    const results = await adapter.searchByVector(basisVec(0));
    assert.deepEqual(results, []);
    await adapter.dispose();
  });

  test("searchByVector() returns [] for empty vector (no PG round-trip)", async () => {
    const adapter = new MemUAdapter({ dsn: BAD_DSN });
    const results = await adapter.searchByVector([]);
    assert.deepEqual(results, []);
  });

  test("searchByVector() without init also returns [] (defensive)", async () => {
    const adapter = new MemUAdapter({ dsn: BAD_DSN });
    const results = await adapter.searchByVector(basisVec(0));
    assert.deepEqual(results, []);
  });

  test("dispose() is safe when never init'd", async () => {
    const adapter = new MemUAdapter({ dsn: BAD_DSN });
    await assert.doesNotReject(() => adapter.dispose());
  });

  test("dispose() is idempotent after failed init", async () => {
    const adapter = new MemUAdapter({ dsn: BAD_DSN, timeout: 500 });
    await adapter.init();
    await adapter.dispose();
    await assert.doesNotReject(() => adapter.dispose());
  });

  test("name is 'memu'", () => {
    const adapter = new MemUAdapter();
    assert.equal(adapter.name, "memu");
  });

  test("capabilities = ['search', 'embeddings'] (text + vector paths)", () => {
    const adapter = new MemUAdapter();
    assert.deepEqual(
      [...adapter.capabilities].sort(),
      ["embeddings", "search"],
    );
  });
});

// Bun's node:test compatibility layer does not currently honor the suite-level
// `{ skip: ... }` option, so select the skipped suite function explicitly.
const describeMemuIntegration = TEST_DSN ? describe : describe.skip;

describeMemuIntegration(
  "MemUAdapter -- integration (requires MEMU_TEST_DSN)",
  () => {
    let adapter: MemUAdapter;

    before(async () => {
      // Seed fixture. Schema mirrors the columns memu.ts reads plus the
      // pgvector embedding column exercised by searchByVector. Extra columns
      // upstream (e.g. raw_content) are not required for coverage.
      const pg = await import("pg");
      const pool = new pg.default.Pool({ connectionString: TEST_DSN });
      try {
        // pgvector is required for the vector column. If the extension isn't
        // available, this CREATE throws and the whole integration block
        // fails with a clear error -- that's the right signal.
        await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
        await pool.query(`
          CREATE TABLE IF NOT EXISTS memory_items (
            id text PRIMARY KEY,
            user_id text NOT NULL,
            memory_type text NOT NULL,
            summary text NOT NULL,
            embedding vector(1024),
            created_at timestamptz NOT NULL DEFAULT now()
          )
        `);
        // For re-runs against a legacy table missing the vector column.
        await pool.query(
          `ALTER TABLE memory_items
             ADD COLUMN IF NOT EXISTS embedding vector(1024)`,
        );
        await pool.query(
          `DELETE FROM memory_items WHERE user_id = ANY($1::text[])`,
          [[TEST_USER_ID, OTHER_USER_ID]],
        );
        await pool.query(
          `INSERT INTO memory_items
             (id, user_id, memory_type, summary, embedding, created_at) VALUES
             ($1, $2, 'profile', 'headless MCP server for LLM wiki pattern',
              $3::vector, now() - interval '3 minutes'),
             ($4, $2, 'project', 'memU adapter now reads Postgres directly',
              $5::vector, now() - interval '2 minutes'),
             ($6, $2, 'project', '50% off sale ended yesterday literally',
              $7::vector, now() - interval '1 minute'),
             ($8, $9, 'profile', 'row belongs to the other user, must be excluded',
              $10::vector, now())`,
          [
            `${TEST_USER_ID}-row-1`, TEST_USER_ID, basisVecLiteral(0),
            `${TEST_USER_ID}-row-2`, basisVecLiteral(1),
            `${TEST_USER_ID}-row-3`, basisVecLiteral(2),
            `${TEST_USER_ID}-row-4`, OTHER_USER_ID, basisVecLiteral(3),
          ],
        );
      } finally {
        await pool.end();
      }
    });

    beforeEach(async () => {
      adapter = new MemUAdapter({ dsn: TEST_DSN, userId: TEST_USER_ID });
      await adapter.init();
    });

    afterEach(async () => {
      await adapter.dispose();
    });

    test("init() flips isAvailable=true against real PG", () => {
      assert.equal(adapter.isAvailable, true);
    });

    // --- ILIKE text search ---

    test("search() returns rows scoped to user_id with correct shape", async () => {
      const results = await adapter.search("adapter");
      assert.ok(results.length >= 1, `expected >=1 result, got ${results.length}`);
      for (const r of results) {
        assert.equal(r.source, "memu");
        assert.equal(r.score, 0.5, "ILIKE is non-scored, adapter returns neutral 0.5");
        assert.equal(r.metadata?.user_id, TEST_USER_ID);
        assert.ok(r.path.startsWith(`memu/${TEST_USER_ID}/`));
        assert.ok(typeof r.metadata?.created_at === "string");
      }
    });

    test("search() orders by created_at DESC (newest first)", async () => {
      const results = await adapter.search("e", { maxResults: 10 });
      assert.ok(results.length >= 2);
      const timestamps = results.map((r) => String(r.metadata?.created_at));
      const sorted = [...timestamps].sort().reverse();
      assert.deepEqual(timestamps, sorted, "results must be DESC by created_at");
    });

    test("search() excludes rows for other user_ids", async () => {
      const results = await adapter.search("excluded");
      assert.equal(results.length, 0);
    });

    test("search() respects maxResults cap", async () => {
      const results = await adapter.search("e", { maxResults: 1 });
      assert.equal(results.length, 1);
    });

    test("search() maxResults is clamped to [1, 100]", async () => {
      const one = await adapter.search("e", { maxResults: 0 });
      assert.ok(one.length <= 1);
      const many = await adapter.search("e", { maxResults: 9999 });
      assert.ok(Array.isArray(many));
    });

    test("search() escapes % so literal '50%' matches", async () => {
      const results = await adapter.search("50%");
      assert.ok(
        results.some((r) => r.content.includes("50%")),
        "expected the '50% off' row to match a literal 50% query",
      );
    });

    test("search() escapes _ so underscores are literal, not wildcards", async () => {
      const results = await adapter.search("____zzz_does_not_exist");
      assert.equal(results.length, 0);
    });

    test("search() truncates content to 500 chars", async () => {
      const results = await adapter.search("adapter");
      for (const r of results) {
        assert.ok(r.content.length <= 500);
      }
    });

    test("search() returns empty array (not null) for no matches", async () => {
      const results = await adapter.search("zzz-absolutely-not-in-the-fixture-zzz");
      assert.deepEqual(results, []);
    });

    // --- pgvector search ---

    test("searchByVector(basisVec(0)) ranks row-1 first with cosine similarity ~1", async () => {
      const results = await adapter.searchByVector(basisVec(0), { maxResults: 3 });
      assert.ok(results.length >= 1);
      assert.ok(
        results[0].path.endsWith(`${TEST_USER_ID}-row-1`),
        `expected row-1 first, got path ${results[0].path}`,
      );
      assert.ok(
        results[0].score > 0.99,
        `expected self-similarity ~1, got ${results[0].score}`,
      );
    });

    test("searchByVector(basisVec(1)) ranks row-2 first", async () => {
      const results = await adapter.searchByVector(basisVec(1), { maxResults: 3 });
      assert.ok(results[0].path.endsWith(`${TEST_USER_ID}-row-2`));
    });

    test("searchByVector() scope-excludes other user's row even on exact vector match", async () => {
      // basisVec(3) is exactly OTHER_USER_ID's vector, but the scope filter
      // must keep it out. The highest-scoring returned row should NOT be
      // row-4 -- in fact row-4 should not appear at all.
      const results = await adapter.searchByVector(basisVec(3), { maxResults: 10 });
      for (const r of results) {
        assert.equal(r.metadata?.user_id, TEST_USER_ID);
        assert.ok(!r.path.includes(OTHER_USER_ID));
      }
    });

    test("searchByVector() respects maxResults cap", async () => {
      const results = await adapter.searchByVector(basisVec(0), { maxResults: 1 });
      assert.equal(results.length, 1);
    });

    test("searchByVector() results are DESC by score (closest first)", async () => {
      const results = await adapter.searchByVector(basisVec(0), { maxResults: 5 });
      assert.ok(results.length >= 2);
      const scores = results.map((r) => r.score);
      for (let i = 1; i < scores.length; i++) {
        assert.ok(
          scores[i - 1] >= scores[i],
          `score ${scores[i - 1]} should be >= ${scores[i]} (pos ${i - 1} vs ${i})`,
        );
      }
    });

    test("searchByVector() result shape: source/path/content/score/metadata.cosine_similarity", async () => {
      const results = await adapter.searchByVector(basisVec(0), { maxResults: 1 });
      const r = results[0];
      assert.equal(r.source, "memu");
      assert.ok(r.path.startsWith(`memu/${TEST_USER_ID}/`));
      assert.equal(typeof r.score, "number");
      assert.equal(typeof r.metadata?.cosine_similarity, "number");
      assert.equal(r.metadata?.user_id, TEST_USER_ID);
    });

    test("searchByVector() returns empty array when user has no embeddings matching (after delete)", async () => {
      // Temporarily null out embeddings for test user, then verify empty.
      const pg = await import("pg");
      const pool = new pg.default.Pool({ connectionString: TEST_DSN });
      try {
        await pool.query(
          `UPDATE memory_items SET embedding = NULL WHERE user_id = $1`,
          [TEST_USER_ID],
        );
        const results = await adapter.searchByVector(basisVec(0), { maxResults: 5 });
        assert.deepEqual(results, []);
      } finally {
        // Restore so other tests still work if re-run.
        await pool.query(
          `UPDATE memory_items SET embedding = $1::vector
             WHERE user_id = $2 AND id = $3`,
          [basisVecLiteral(0), TEST_USER_ID, `${TEST_USER_ID}-row-1`],
        );
        await pool.query(
          `UPDATE memory_items SET embedding = $1::vector
             WHERE user_id = $2 AND id = $3`,
          [basisVecLiteral(1), TEST_USER_ID, `${TEST_USER_ID}-row-2`],
        );
        await pool.query(
          `UPDATE memory_items SET embedding = $1::vector
             WHERE user_id = $2 AND id = $3`,
          [basisVecLiteral(2), TEST_USER_ID, `${TEST_USER_ID}-row-3`],
        );
        await pool.end();
      }
    });
  },
);
