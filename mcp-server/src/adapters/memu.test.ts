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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemUAdapter, resolveMemUAdapterConfig } from "./memu.js";

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
  test("portable defaults use credential-free DSN, PATH Python, current cwd, and relative fallback", () => {
    const cwd = join("portable", "memu");
    const windows = resolveMemUAdapterConfig({}, {}, { cwd, platform: "win32" });
    assert.equal(windows.dsn, "postgresql://localhost:5432/memu");
    assert.equal(windows.userId, "default");
    assert.equal(windows.pythonExe, "python");
    assert.equal(windows.memuSearchPythonExe, "python");
    assert.equal(windows.memuGraphCwd, cwd);
    assert.equal(windows.memuSearchPy, "memu_search.py");
    assert.equal(windows.graphRecallTimeoutMs, 15_000);
    assert.equal(windows.memuSearchTimeoutMs, 20_000);

    const posix = resolveMemUAdapterConfig({}, {}, { cwd, platform: "linux" });
    assert.equal(posix.pythonExe, "python3");
    assert.equal(posix.memuSearchPythonExe, "python3");
  });

  test("explicit configuration wins over environment, which wins over portable defaults", () => {
    const environment = {
      MEMU_DSN: "postgresql://environment/memu",
      MEMU_USER_ID: "environment-user",
      MEMU_GRAPH_PYTHON: "environment-graph-python",
      MEMU_GRAPH_CWD: "environment-cwd",
      MEMU_GRAPH_TIMEOUT_MS: "1234",
      MEMU_SEARCH_PY: "environment-search.py",
      MEMU_SEARCH_PYTHON: "environment-search-python",
      MEMU_SEARCH_TIMEOUT_MS: "2345",
      OLLAMA_EMBED_MODEL: "environment-model",
    } satisfies NodeJS.ProcessEnv;
    const fromEnvironment = resolveMemUAdapterConfig({}, environment, {
      cwd: "default-cwd",
      platform: "win32",
    });
    assert.equal(fromEnvironment.dsn, environment.MEMU_DSN);
    assert.equal(fromEnvironment.userId, environment.MEMU_USER_ID);
    assert.equal(fromEnvironment.pythonExe, environment.MEMU_GRAPH_PYTHON);
    assert.equal(fromEnvironment.memuGraphCwd, environment.MEMU_GRAPH_CWD);
    assert.equal(fromEnvironment.graphRecallTimeoutMs, 1234);
    assert.equal(fromEnvironment.memuSearchPy, environment.MEMU_SEARCH_PY);
    assert.equal(fromEnvironment.memuSearchPythonExe, environment.MEMU_SEARCH_PYTHON);
    assert.equal(fromEnvironment.memuSearchTimeoutMs, 2345);
    assert.equal(fromEnvironment.embedModel, environment.OLLAMA_EMBED_MODEL);

    const explicit = resolveMemUAdapterConfig({
      dsn: "postgresql://explicit/memu",
      userId: "explicit-user",
      pythonExe: "explicit-graph-python",
      memuGraphCwd: "explicit-cwd",
      graphRecallTimeoutMs: 3456,
      memuSearchPy: "explicit-search.py",
      memuSearchPythonExe: "explicit-search-python",
      memuSearchTimeoutMs: 4567,
      embedModel: "explicit-model",
    }, environment, { cwd: "default-cwd", platform: "win32" });
    assert.equal(explicit.dsn, "postgresql://explicit/memu");
    assert.equal(explicit.userId, "explicit-user");
    assert.equal(explicit.pythonExe, "explicit-graph-python");
    assert.equal(explicit.memuGraphCwd, "explicit-cwd");
    assert.equal(explicit.graphRecallTimeoutMs, 3456);
    assert.equal(explicit.memuSearchPy, "explicit-search.py");
    assert.equal(explicit.memuSearchPythonExe, "explicit-search-python");
    assert.equal(explicit.memuSearchTimeoutMs, 4567);
    assert.equal(explicit.embedModel, "explicit-model");
  });

  test("relative fallback script runs from configured cwd using Python from PATH", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "llmwiki-memu-search-"));
    const privateDsn = "postgresql://memu-user:fallback-secret@localhost:5432/memu";
    try {
      writeFileSync(
        join(cwd, "memu_search.py"),
        [
          "import json",
          "import os",
          "import sys",
          `assert os.environ.get('MEMU_DSN') == ${JSON.stringify(privateDsn)}`,
          "assert '--dsn' not in sys.argv",
          "print(json.dumps([{'id':'portable','summary':'portable fallback','memory_type':'note','score':1}]))",
          "",
        ].join("\n"),
        "utf-8",
      );
      const adapter = new MemUAdapter({ dsn: privateDsn, memuGraphCwd: cwd });
      const runFallback = Reflect.get(adapter, "runMemuSearchPy") as (
        query: string,
        vector: readonly number[] | null,
        limit: number,
      ) => Promise<Array<{ path: string; content: string }>>;
      const results = await runFallback.call(adapter, "portable", null, 1);
      assert.equal(results.length, 1);
      assert.equal(results[0].path, "memu/item/portable");
      assert.equal(results[0].content, "portable fallback");
      assert.doesNotMatch(JSON.stringify(results), /fallback-secret/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("graph recall spawn keeps the private DSN in child env and out of argv and results", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "llmwiki-memu-graph-"));
    const privateDsn = "postgresql://memu-user:graph-secret@localhost:5432/memu";
    const packageDir = join(cwd, "memu_graph");
    const parentStdout: string[] = [];
    const parentStderr: string[] = [];
    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;
    try {
      mkdirSync(packageDir);
      writeFileSync(join(packageDir, "__init__.py"), "", "utf-8");
      writeFileSync(
        join(packageDir, "cli.py"),
        [
          "import argparse",
          "import json",
          "import os",
          "import sys",
          "parser = argparse.ArgumentParser()",
          "sub = parser.add_subparsers(dest='command', required=True)",
          "recall = sub.add_parser('graph-recall')",
          "recall.add_argument('--dsn', default=os.environ.get('MEMU_DSN'))",
          "args = parser.parse_args()",
          `assert args.dsn == ${JSON.stringify(privateDsn)}`,
          "assert '--dsn' not in sys.argv",
          "request = json.load(sys.stdin)",
          "assert request['query'] == 'portable graph'",
          "print(os.environ['MEMU_DSN'], file=sys.stderr)",
          "print(json.dumps({'path':'precise','nodes':[{'id':'n1','name':'Portable','type':'note','description':'safe graph result','content':'','community_id':None,'pagerank':1,'ppr_score':1}],'edges':[]}))",
          "",
        ].join("\n"),
        "utf-8",
      );
      process.stdout.write = ((chunk: string | Uint8Array) => {
        parentStdout.push(String(chunk));
        return true;
      }) as typeof process.stdout.write;
      process.stderr.write = ((chunk: string | Uint8Array) => {
        parentStderr.push(String(chunk));
        return true;
      }) as typeof process.stderr.write;

      const adapter = new MemUAdapter({
        dsn: privateDsn,
        memuGraphCwd: cwd,
        graphRecallTimeoutMs: 5_000,
      });
      const runGraphRecall = Reflect.get(adapter, "runGraphRecall") as (
        query: string,
        vector: readonly number[] | null,
        maxNodes: number,
      ) => Promise<unknown>;
      const result = await runGraphRecall.call(adapter, "portable graph", null, 1);

      assert.equal((result as { path?: string } | null)?.path, "precise");
      const publicSurface = JSON.stringify({ result, parentStdout, parentStderr });
      assert.doesNotMatch(publicSurface, /graph-secret/);
      assert.ok(!publicSurface.includes(privateDsn));
    } finally {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("fallback rejects child output containing the resolved DSN without reflecting it", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "llmwiki-memu-secret-output-"));
    const privateDsn = "postgresql://memu-user:output-secret@localhost:5432/memu";
    const parentStdout: string[] = [];
    const parentStderr: string[] = [];
    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;
    try {
      writeFileSync(
        join(cwd, "memu_search.py"),
        [
          "import json",
          "import os",
          "import sys",
          "print(os.environ['MEMU_DSN'], file=sys.stderr)",
          "print(json.dumps([{'id':'unsafe','summary':os.environ['MEMU_DSN'],'score':1}]))",
          "",
        ].join("\n"),
        "utf-8",
      );
      process.stdout.write = ((chunk: string | Uint8Array) => {
        parentStdout.push(String(chunk));
        return true;
      }) as typeof process.stdout.write;
      process.stderr.write = ((chunk: string | Uint8Array) => {
        parentStderr.push(String(chunk));
        return true;
      }) as typeof process.stderr.write;

      const adapter = new MemUAdapter({ dsn: privateDsn, memuGraphCwd: cwd });
      const runFallback = Reflect.get(adapter, "runMemuSearchPy") as (
        query: string,
        vector: readonly number[] | null,
        limit: number,
      ) => Promise<unknown[]>;
      const result = await runFallback.call(adapter, "anything", null, 1);

      assert.deepEqual(result, []);
      const publicSurface = JSON.stringify({ result, parentStdout, parentStderr });
      assert.doesNotMatch(publicSurface, /output-secret/);
      assert.ok(!publicSurface.includes(privateDsn));
    } finally {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("missing explicit fallback interpreter fails closed", async () => {
    const adapter = new MemUAdapter({
      memuSearchPythonExe: "llmwiki-python-that-does-not-exist",
      memuSearchTimeoutMs: 500,
    });
    const runFallback = Reflect.get(adapter, "runMemuSearchPy") as (
      query: string,
      vector: readonly number[] | null,
      limit: number,
    ) => Promise<unknown[]>;
    assert.deepEqual(await runFallback.call(adapter, "anything", null, 1), []);
  });

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
