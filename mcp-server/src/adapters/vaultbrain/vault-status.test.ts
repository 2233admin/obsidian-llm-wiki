/**
 * TASK13 13B follow-up -- vault readiness classifier tests.
 *
 * classifyVaultReadiness is pure, so each bucket is a direct input->output
 * assertion. gatherVaultStatus is covered separately with a fake adapter +
 * a real temp-dir vault to exercise the fs peek and timeout fail-close path.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyVaultReadiness, gatherVaultStatus } from "./vault-status.js";
import { configureLazyIndex, ensureBackfill, _resetLazyIndex } from "./lazy-index.js";
import type { VaultBrainAdapter } from "./index.js";

function makeVault(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "vbstatus-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }
  return dir;
}

function fakeVba(opts?: {
  available?: boolean;
  count?: number;
  delayMs?: number;
  reject?: boolean;
  lastIndexedAtMs?: number | null;
}) {
  return {
    name: "vaultbrain",
    isAvailable: opts?.available ?? true,
    async countChunks() {
      if (opts?.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (opts?.reject) throw new Error("boom");
      return opts?.count ?? 0;
    },
    async getLastIndexedAtMs() {
      if (opts?.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (opts?.reject) throw new Error("boom");
      return opts?.lastIndexedAtMs ?? null;
    },
  } as unknown as VaultBrainAdapter;
}

test("classifyVaultReadiness: vault_missing when vault does not exist", () => {
  const res = classifyVaultReadiness({
    vaultExists: false,
    markdownCount: 0,
    chunkCount: 0,
    indexingInProgress: false,
    newestMarkdownMtimeMs: null,
    lastIndexedAtMs: null,
  });
  assert.equal(res.bucket, "vault_missing");
});

test("classifyVaultReadiness: empty_vault when fewer than 5 markdown files", () => {
  const res = classifyVaultReadiness({
    vaultExists: true,
    markdownCount: 4,
    chunkCount: 0,
    indexingInProgress: false,
    newestMarkdownMtimeMs: null,
    lastIndexedAtMs: null,
  });
  assert.equal(res.bucket, "empty_vault");
});

test("classifyVaultReadiness: unindexed when markdown exists but chunk count is 0", () => {
  const res = classifyVaultReadiness({
    vaultExists: true,
    markdownCount: 10,
    chunkCount: 0,
    indexingInProgress: false,
    newestMarkdownMtimeMs: 1000,
    lastIndexedAtMs: null,
  });
  assert.equal(res.bucket, "unindexed");
});

test("classifyVaultReadiness: stale_or_backgrounding when indexing is actively in progress", () => {
  const res = classifyVaultReadiness({
    vaultExists: true,
    markdownCount: 10,
    chunkCount: 50,
    indexingInProgress: true,
    newestMarkdownMtimeMs: 1000,
    lastIndexedAtMs: 1000,
  });
  assert.equal(res.bucket, "stale_or_backgrounding");
});

test("classifyVaultReadiness: stale_or_backgrounding when newest markdown is newer than last index", () => {
  const res = classifyVaultReadiness({
    vaultExists: true,
    markdownCount: 10,
    chunkCount: 50,
    indexingInProgress: false,
    newestMarkdownMtimeMs: 2000,
    lastIndexedAtMs: 1000,
  });
  assert.equal(res.bucket, "stale_or_backgrounding");
});

test("classifyVaultReadiness: ready when chunks exist, not indexing, and no staleness", () => {
  const res = classifyVaultReadiness({
    vaultExists: true,
    markdownCount: 10,
    chunkCount: 50,
    indexingInProgress: false,
    newestMarkdownMtimeMs: 1000,
    lastIndexedAtMs: 2000,
  });
  assert.equal(res.bucket, "ready");
});

test("classifyVaultReadiness: ready when no last-indexed timestamp is known (can't prove staleness)", () => {
  const res = classifyVaultReadiness({
    vaultExists: true,
    markdownCount: 10,
    chunkCount: 50,
    indexingInProgress: false,
    newestMarkdownMtimeMs: 2000,
    lastIndexedAtMs: null,
  });
  assert.equal(res.bucket, "ready");
});

test("gatherVaultStatus: vault_missing for unset/undefined vault path", async () => {
  const res = await gatherVaultStatus(undefined, fakeVba());
  assert.equal(res.bucket, "vault_missing");
  assert.equal(res.markdownCount, 0);
});

test("gatherVaultStatus: vault_missing when configured dir does not exist on disk", async () => {
  const res = await gatherVaultStatus("D:/does/not/exist/anywhere", fakeVba());
  assert.equal(res.bucket, "vault_missing");
});

test("gatherVaultStatus: empty_vault for a real dir with too few markdown files", async () => {
  const dir = makeVault({ "a.md": "x", "b.md": "y" });
  try {
    const res = await gatherVaultStatus(dir, fakeVba());
    assert.equal(res.bucket, "empty_vault");
    assert.equal(res.markdownCount, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gatherVaultStatus: unindexed when markdown exists but adapter unavailable (chunkCount 0)", async () => {
  const dir = makeVault({ "a.md": "1", "b.md": "2", "c.md": "3", "d.md": "4", "e.md": "5" });
  try {
    const res = await gatherVaultStatus(dir, fakeVba({ available: false }));
    assert.equal(res.bucket, "unindexed");
    assert.equal(res.chunkCount, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gatherVaultStatus: ready when markdown + chunks exist and no backfill status given", async () => {
  const dir = makeVault({ "a.md": "1", "b.md": "2", "c.md": "3", "d.md": "4", "e.md": "5" });
  try {
    const res = await gatherVaultStatus(dir, fakeVba({ count: 20 }));
    assert.equal(res.bucket, "ready");
    assert.equal(res.chunkCount, 20);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gatherVaultStatus: stale_or_backgrounding when caller reports an active backfill", async () => {
  const dir = makeVault({ "a.md": "1", "b.md": "2", "c.md": "3", "d.md": "4", "e.md": "5" });
  try {
    const res = await gatherVaultStatus(dir, fakeVba({ count: 20 }), { backfillStatus: "indexing_background" });
    assert.equal(res.bucket, "stale_or_backgrounding");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gatherVaultStatus: uses the real getLastIndexedAtMs watermark to detect staleness (no opts given)", async () => {
  const dir = makeVault({ "a.md": "1", "b.md": "2", "c.md": "3", "d.md": "4", "e.md": "5" });
  try {
    // last index write happened before any of the markdown files' mtimes -> stale.
    const res = await gatherVaultStatus(dir, fakeVba({ count: 20, lastIndexedAtMs: 1 }));
    assert.equal(res.bucket, "stale_or_backgrounding");
    assert.equal(res.lastIndexedAtMs, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gatherVaultStatus: ready when real watermark is newer than newest markdown mtime", async () => {
  const dir = makeVault({ "a.md": "1", "b.md": "2", "c.md": "3", "d.md": "4", "e.md": "5" });
  try {
    const res = await gatherVaultStatus(dir, fakeVba({ count: 20, lastIndexedAtMs: Date.now() + 60_000 }));
    assert.equal(res.bucket, "ready");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gatherVaultStatus: defaults indexingInProgress to isBackfillInFlight() when no backfillStatus opt is given", async () => {
  _resetLazyIndex();
  const dir = makeVault({ "a.md": "1", "b.md": "2", "c.md": "3", "d.md": "4", "e.md": "5" });
  let openGate!: () => void;
  const gate = new Promise<void>((r) => { openGate = r; });
  const ingested: string[] = [];
  // ensureBackfill's own empty-store check calls countChunks() once BEFORE
  // deciding sync-vs-background; it must see 0 there (real "never indexed"
  // condition) so vba tracks a "primed" flag that flips only after that first
  // check, so the later gatherVaultStatus() call (which must land on
  // stale_or_backgrounding, not unindexed) sees a pre-existing chunk count as
  // if an earlier index pass already populated the store and this backfill is
  // a re-index catching up with drifted content.
  let primed = false;
  const vba = {
    name: "vaultbrain",
    isAvailable: true,
    async countChunks() { return primed ? 20 : 0; },
    async getLastIndexedAtMs() { return null; },
    async ingest(path: string) { primed = true; await gate; ingested.push(path); },
  } as unknown as VaultBrainAdapter;
  try {
    configureLazyIndex(vba, dir);
    // syncCap 0 forces the background path so ensureBackfill returns before the
    // (gated) ingests run -- mirrors lazy-index.test.ts's single-flight setup.
    const outcome = await ensureBackfill({ syncCap: 0 });
    assert.equal(outcome.status, "indexing_background");
    // Let the background reindexVault() call actually start (and flip `primed`
    // via its first ingest) before checking status, without letting any file
    // finish ingesting (the gate stays closed).
    for (let i = 0; i < 100 && !primed; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.equal(primed, true, "background pass must have started ingesting");

    // No opts.backfillStatus passed -- exactly how context.vault_status calls
    // gatherVaultStatus in production -- must still observe the real in-flight
    // backfill via isBackfillInFlight() and report stale_or_backgrounding.
    const res = await gatherVaultStatus(dir, vba);
    assert.equal(res.indexingInProgress, true);
    assert.equal(res.bucket, "stale_or_backgrounding");

    openGate();
    for (let i = 0; i < 100 && ingested.length < 5; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
  } finally {
    _resetLazyIndex();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gatherVaultStatus: fails closed to unindexed (chunkCount 0) when countChunks rejects", async () => {
  const dir = makeVault({ "a.md": "1", "b.md": "2", "c.md": "3", "d.md": "4", "e.md": "5" });
  try {
    const res = await gatherVaultStatus(dir, fakeVba({ reject: true }));
    assert.equal(res.bucket, "unindexed");
    assert.equal(res.chunkCount, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gatherVaultStatus: fails closed to unindexed (chunkCount 0) when countChunks exceeds timeout", async () => {
  const dir = makeVault({ "a.md": "1", "b.md": "2", "c.md": "3", "d.md": "4", "e.md": "5" });
  try {
    const res = await gatherVaultStatus(dir, fakeVba({ count: 99, delayMs: 200 }), { queryTimeoutMs: 20 });
    assert.equal(res.bucket, "unindexed");
    assert.equal(res.chunkCount, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
