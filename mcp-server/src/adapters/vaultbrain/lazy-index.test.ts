/**
 * TASK13 13B -- lazy backfill coordinator tests.
 *
 * Uses a fake adapter (no PGlite) to isolate the coordinator logic: empty-store
 * detection, the sync-vs-background decision (measured: large vaults must not
 * block the first query), and the single-flight lock that stops concurrent
 * first-queries from launching duplicate reindex passes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, statSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  listVaultMarkdown,
  reindexVault,
  recallGaps,
  ensureBackfill,
  configureLazyIndex,
  _resetLazyIndex,
} from "./lazy-index.js";
import type { VaultBrainAdapter } from "./index.js";

function makeVault(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "vblazy-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }
  return dir;
}

// Minimal fake for coordinator lifecycle tests. The indexed-path methods model
// the adapter's reconciliation surface without requiring PGlite.
function fakeVba(opts?: {
  available?: boolean;
  ingestGate?: Promise<void>;
  indexedSlugs?: string[];
  indexedStamps?: Record<string, FileStamp>;
  ingestResult?: (path: string) => boolean;
  stateEvents?: unknown[];
  reindexState?: ReindexState | null;
  chunkCount?: number;
}) {
  const ingested: string[] = [];
  const deleted: string[] = [];
  const indexedSlugs = new Set(opts?.indexedSlugs ?? []);
  const adapter = {
    name: "vaultbrain",
    isAvailable: opts?.available ?? true,
    async countChunks() { return opts?.chunkCount ?? ingested.length; },
    async ingest(path: string) {
      if (opts?.ingestGate) await opts.ingestGate;
      const changed = opts?.ingestResult?.(path) ?? true;
      if (changed) ingested.push(path);
      return changed;
    },
    async listIndexedSlugs() { return [...indexedSlugs]; },
    async setReindexState(state: unknown) { opts?.stateEvents?.push(state); },
    async getReindexState() { return opts?.reindexState ?? null; },
    async getIndexedStamp(path: string) { return opts?.indexedStamps?.[path] ?? null; },
    async deletePath(_path: string) {},
    async deleteSlug(slug: string) {
      indexedSlugs.delete(slug);
      deleted.push(slug);
    },
  } as unknown as VaultBrainAdapter;
  return { adapter, ingested, deleted };
}

test("listVaultMarkdown skips machine/derived dirs", () => {
  const dir = makeVault({
    "a.md": "x", "sub/b.md": "x", ".git/c.md": "x", "wiki/d.md": "x", ".obsidian/e.md": "x",
  });
  try {
    const got = listVaultMarkdown(dir)
      .map((f) => f.slice(dir.length).replace(/\\/g, "/"))
      .sort();
    assert.deepEqual(got, ["/a.md", "/sub/b.md"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ensureBackfill: small vault indexes inline, then no-ops when populated", async () => {
  _resetLazyIndex();
  const dir = makeVault({ "a.md": "x", "b.md": "y" });
  const { adapter, ingested } = fakeVba();
  configureLazyIndex(adapter, dir);
  try {
    const out = await ensureBackfill({ syncCap: 10 });
    assert.equal(out.status, "indexed_sync");
    assert.equal(out.fileCount, 2);
    assert.equal(ingested.length, 2);

    const again = await ensureBackfill({ syncCap: 10 });
    assert.equal(again.status, "populated");
  } finally { _resetLazyIndex(); rmSync(dir, { recursive: true, force: true }); }
});

test("ensureBackfill: large vault backfills in background, single-flight locked", async () => {
  _resetLazyIndex();
  const dir = makeVault({ "a.md": "x", "b.md": "y", "c.md": "z" });
  let openGate!: () => void;
  const gate = new Promise<void>((r) => { openGate = r; });
  const { adapter, ingested } = fakeVba({ ingestGate: gate });
  configureLazyIndex(adapter, dir);
  try {
    // syncCap 1 < 3 files -> background; returns before ingests run
    const first = await ensureBackfill({ syncCap: 1 });
    assert.equal(first.status, "indexing_background");
    assert.equal(first.fileCount, 3);
    assert.equal(ingested.length, 0, "background not awaited yet");

    // re-entrant call while the background pass is gated -> in_progress, no 2nd pass
    const second = await ensureBackfill({ syncCap: 1 });
    assert.equal(second.status, "in_progress");

    openGate();
    for (let i = 0; i < 100 && ingested.length < 3; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.equal(ingested.length, 3, "all files indexed exactly once");

    const third = await ensureBackfill({ syncCap: 1 });
    assert.equal(third.status, "populated");
  } finally { _resetLazyIndex(); rmSync(dir, { recursive: true, force: true }); }
});

test("ensureBackfill retries when durable state says the prior run was incomplete", async () => {
  _resetLazyIndex();
  const dir = makeVault({ "retry.md": "retryable note" });
  const { adapter, ingested } = fakeVba({
    chunkCount: 1,
    reindexState: {
      status: "incomplete",
      startedAt: 1,
      finishedAt: 2,
      indexed: 0,
      total: 1,
      skipped: 0,
      deleted: 0,
      errors: ["retry.md: previous failure"],
    },
  });
  configureLazyIndex(adapter, dir);
  try {
    const result = await ensureBackfill({ syncCap: 10 });
    assert.equal(result.status, "indexed_sync");
    assert.deepEqual(ingested, ["retry.md"]);
  } finally {
    _resetLazyIndex();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ensureBackfill: unavailable adapter -> unavailable", async () => {
  _resetLazyIndex();
  const dir = makeVault({ "a.md": "x" });
  const { adapter } = fakeVba({ available: false });
  configureLazyIndex(adapter, dir);
  try {
    assert.equal((await ensureBackfill({ syncCap: 10 })).status, "unavailable");
  } finally { _resetLazyIndex(); rmSync(dir, { recursive: true, force: true }); }
});

test("recallGaps explains an already-running reconciliation", async () => {
  _resetLazyIndex();
  try {
    const gaps = await recallGaps({ status: "in_progress" });
    assert.match(gaps[0]?.message ?? "", /retry recall|vault\.reindex_status/);
  } finally {
    _resetLazyIndex();
  }
});

test("reindexVault ingests every markdown file, skipping protected dirs", async () => {
  const dir = makeVault({ "a.md": "x", "deep/b.md": "y", ".git/skip.md": "z" });
  const { adapter, ingested } = fakeVba();
  try {
    const res = await reindexVault(adapter, dir);
    assert.equal(res.total, 2);
    assert.equal(res.indexed, 2);
    assert.equal(ingested.length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("reindexVault counts unchanged files as skipped and removes stale indexed files", async () => {
  const dir = makeVault({ "a.md": "x", "b.md": "y", "double.md.md": "z" });
  const { adapter, deleted } = fakeVba({
    indexedSlugs: ["a", "b", "double.md", "stale"],
    ingestResult: (path) => path !== "a.md",
  });
  try {
    const res = await reindexVault(adapter, dir);
    assert.equal(res.total, 3);
    assert.equal(res.indexed, 2);
    assert.equal(res.skipped, 1);
    assert.equal(res.deleted, 1);
    assert.deepEqual(deleted, ["stale"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("reindexVault skips a file when persisted mtime and size match", async () => {
  const dir = makeVault({ "a.md": "unchanged" });
  const file = statSync(join(dir, "a.md"));
  const { adapter, ingested } = fakeVba({
    indexedStamps: { "a.md": { mtimeMs: Math.floor(file.mtimeMs), sizeBytes: file.size } },
  });
  try {
    const res = await reindexVault(adapter, dir);
    assert.equal(res.indexed, 0);
    assert.equal(res.skipped, 1);
    assert.deepEqual(ingested, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("reindexVault reports progress and persists complete state", async () => {
  const dir = makeVault({ "a.md": "x", "b.md": "y" });
  const states: unknown[] = [];
  const progress: unknown[] = [];
  const { adapter } = fakeVba({ stateEvents: states });
  try {
    const res = await reindexVault(adapter, dir, {
      onProgress: (event) => progress.push(event),
    });
    const firstState = states[0];
    const lastState = states.at(-1);
    assert.ok(firstState && typeof firstState === "object" && "status" in firstState);
    assert.ok(lastState && typeof lastState === "object" && "status" in lastState);
    assert.equal(firstState.status, "running");
    assert.equal(lastState.status, "complete");
    assert.ok(progress.length >= 2);
    assert.deepEqual(progress.at(-1), { phase: "complete", completed: 2, total: 2 });
    assert.equal(res.errors.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("reindexVault preserves indexed slugs when the vault scan is incomplete", async () => {
  const dir = makeVault({ "a.md": "x" });
  rmSync(dir, { recursive: true, force: true });
  const { adapter, deleted } = fakeVba({ indexedSlugs: ["a"] });
  const res = await reindexVault(adapter, dir);
  assert.equal(res.deleted, 0);
  assert.deepEqual(deleted, []);
  assert.ok(res.errors.some((error) => error.includes("stale deletion skipped")));
});
