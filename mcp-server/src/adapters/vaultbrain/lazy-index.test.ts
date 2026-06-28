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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  listVaultMarkdown,
  reindexVault,
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

// Minimal fake: the coordinator only touches isAvailable + countChunks + ingest.
// countChunks reflects what ingest has recorded, so an empty store reports 0 and
// becomes populated after a backfill. ingestGate lets a test hold ingests mid-flight.
function fakeVba(opts?: { available?: boolean; ingestGate?: Promise<void> }) {
  const ingested: string[] = [];
  const adapter = {
    name: "vaultbrain",
    isAvailable: opts?.available ?? true,
    async countChunks() { return ingested.length; },
    async ingest(path: string) {
      if (opts?.ingestGate) await opts.ingestGate;
      ingested.push(path);
    },
  } as unknown as VaultBrainAdapter;
  return { adapter, ingested };
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

test("ensureBackfill: unavailable adapter -> unavailable", async () => {
  _resetLazyIndex();
  const dir = makeVault({ "a.md": "x" });
  const { adapter } = fakeVba({ available: false });
  configureLazyIndex(adapter, dir);
  try {
    assert.equal((await ensureBackfill({ syncCap: 10 })).status, "unavailable");
  } finally { _resetLazyIndex(); rmSync(dir, { recursive: true, force: true }); }
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
