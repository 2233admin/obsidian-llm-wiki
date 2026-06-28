/**
 * TASK13 13B -- lazy backfill coordinator.
 *
 * The recall stack (13A keyword floor + vaultbrain hybrid) is useless until the
 * chunks table is populated, and the live trace showed it never was. Rather than
 * make the integrator run `vault reindex` by hand (DX review F2: zero-setup is the
 * Champion target), the first recall against an empty store triggers a backfill.
 *
 * Measured strategy: the real vault (D:\knowledge) is 1256 markdown files. A
 * synchronous walk+chunk+insert of that many notes would block the first query
 * for tens of seconds, so large vaults index in the BACKGROUND (filesystem
 * fallback serves recall meanwhile, keyword sharpens once the pass finishes).
 * Small vaults (<= syncCap) index inline so the very first recall is already
 * complete. A single-flight guard (`_inFlight`) stops concurrent first-queries
 * from launching duplicate passes -- this is the re-entrancy lock the design
 * called out as load-bearing.
 *
 * Keyword backfill needs no Ollama: ingest stores chunk text + the generated
 * tsvector even when embedding fails (13A), so NL keyword recall works daemon-free.
 */

import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join, relative } from "node:path";
import type { VaultBrainAdapter } from "./index.js";

// Directories never worth indexing as knowledge (machine/state/derived output).
const PROTECTED_DIRS = new Set([
  ".git", ".obsidian", ".vault-mind", "node_modules", "wiki", ".trash",
]);

const DEFAULT_SYNC_CAP = 300; // <= this many notes: index inline; more: background.

export interface ReindexResult {
  indexed: number;
  total: number;
  skipped: number;
}

export type BackfillStatus =
  | "unavailable"          // no vaultbrain adapter / not connected
  | "populated"            // already has chunks (or no source files) -- nothing to do
  | "in_progress"          // a backfill launched by an earlier call is still running
  | "indexed_sync"         // small vault: indexed inline, this call waited for it
  | "indexing_background"; // large vault: backfill launched, not awaited

export interface BackfillOutcome {
  status: BackfillStatus;
  fileCount?: number;
}

let _vba: VaultBrainAdapter | null = null;
let _vaultPath = "";
let _inFlight: Promise<unknown> | null = null;

/** Wire the coordinator at server startup (index.ts). */
export function configureLazyIndex(vba: VaultBrainAdapter, vaultPath: string): void {
  _vba = vba;
  _vaultPath = vaultPath;
}

/** Walk the vault for indexable markdown, skipping machine/derived dirs. */
export function listVaultMarkdown(vaultPath: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable dir -- skip, non-fatal
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!PROTECTED_DIRS.has(e.name)) walk(join(dir, e.name));
      } else if (e.isFile() && e.name.endsWith(".md")) {
        files.push(join(dir, e.name));
      }
    }
  };
  walk(vaultPath);
  return files;
}

/**
 * Bulk-ingest every markdown file into vaultbrain. Shared by the manual
 * `vault.reindex` tool and the lazy backfill so there is one reindex impl.
 */
export async function reindexVault(
  vba: VaultBrainAdapter,
  vaultPath: string,
  opts?: { concurrency?: number },
): Promise<ReindexResult> {
  const files = listVaultMarkdown(vaultPath);
  const concurrency = Math.max(1, Math.floor(opts?.concurrency ?? 4));
  let indexed = 0;
  let skipped = 0;
  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (full) => {
        const content = readFileSync(full, "utf-8");
        const rel = relative(vaultPath, full).replace(/\\/g, "/");
        await vba.ingest(rel, content);
      }),
    );
    for (const r of results) {
      if (r.status === "fulfilled") indexed++;
      else skipped++;
    }
  }
  return { indexed, total: files.length, skipped };
}

/**
 * If vaultbrain is empty and no backfill is already running, trigger one.
 * Returns immediately for large vaults (background) so recall is never blocked;
 * awaits inline only for small vaults. Idempotent + single-flight.
 */
export async function ensureBackfill(opts?: { syncCap?: number }): Promise<BackfillOutcome> {
  const vba = _vba;
  if (!vba || !vba.isAvailable) return { status: "unavailable" };
  if (_inFlight) return { status: "in_progress" };

  // Claim the single-flight lock SYNCHRONOUSLY -- before the first await -- so a
  // concurrent first-query cannot slip past the guard above and launch a second
  // backfill. The lock auto-clears when released.
  let release!: () => void;
  const lock = new Promise<void>((r) => { release = r; });
  _inFlight = lock;
  void lock.then(() => { if (_inFlight === lock) _inFlight = null; });
  const done = (o: BackfillOutcome): BackfillOutcome => { release(); return o; };

  let count: number;
  try {
    count = await vba.countChunks();
  } catch {
    return done({ status: "unavailable" });
  }
  if (count > 0) return done({ status: "populated" });

  const fileCount = listVaultMarkdown(_vaultPath).length;
  if (fileCount === 0) return done({ status: "populated" });

  const syncCap = opts?.syncCap ?? DEFAULT_SYNC_CAP;
  if (fileCount <= syncCap) {
    try {
      await reindexVault(vba, _vaultPath);
    } finally {
      release();
    }
    return { status: "indexed_sync", fileCount };
  }

  // Large vault: run in the background, holding the lock until it finishes so
  // recall is not blocked but re-entrant calls see "in_progress".
  void reindexVault(vba, _vaultPath).finally(() => release());
  return { status: "indexing_background", fileCount };
}

/**
 * Actionable recall-status gaps (DX review F3): turn "limitations" into next steps.
 * - background/sync backfill -> tell the agent the index is (re)building.
 * - chunks exist but none embedded -> Ollama never ran; point at the fix while
 *   keyword recall keeps working.
 */
export async function recallGaps(
  backfill: BackfillOutcome,
): Promise<Array<{ type: "retrieval_limitation"; message: string }>> {
  const gaps: Array<{ type: "retrieval_limitation"; message: string }> = [];
  if (backfill.status === "indexing_background") {
    gaps.push({ type: "retrieval_limitation", message: `semantic index building in background (${backfill.fileCount} notes); recall sharpens once it finishes` });
  } else if (backfill.status === "indexed_sync") {
    gaps.push({ type: "retrieval_limitation", message: `indexed your vault (${backfill.fileCount} notes) just now for recall` });
  }
  const vba = _vba;
  if (vba && vba.isAvailable) {
    try {
      const total = await vba.countChunks();
      if (total > 0 && (await vba.countEmbeddedChunks()) === 0) {
        gaps.push({ type: "retrieval_limitation", message: "semantic recall is off (no embeddings) -- start Ollama and run `ollama pull bge-m3` for vector recall; keyword recall is active" });
      }
    } catch { /* non-fatal: never let status-hints break a recall */ }
  }
  return gaps;
}

/** Test-only: clear coordinator state between cases. */
export function _resetLazyIndex(): void {
  _vba = null;
  _vaultPath = "";
  _inFlight = null;
}
