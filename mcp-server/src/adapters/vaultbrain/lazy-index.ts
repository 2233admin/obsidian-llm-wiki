/**
 * TASK13 13B -- lazy backfill coordinator.
 *
 * The recall stack (13A keyword floor + vaultbrain hybrid) is useless until the
 * chunks table is populated, and the live trace showed it never was. Rather than
 * make the integrator run `vault reindex` by hand (DX review F2: zero-setup is the
 * Champion target), the first recall against an empty store triggers a backfill.
 *
 * Measured strategy: a representative 1256-file vault is large enough that a
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

import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { join, relative } from "node:path";
import { pathToSlug } from "./index.js";
import type { VaultBrainAdapter } from "./index.js";
import type { FileStamp, ReindexState } from "./engine.js";

// Directories never worth indexing as knowledge (machine/state/derived output).
export const PROTECTED_DIRS: Record<string, true> = {
  ".git": true,
  ".obsidian": true,
  ".vault-mind": true,
  "node_modules": true,
  "wiki": true,
  ".trash": true,
};

const DEFAULT_SYNC_CAP = 300; // <= this many notes: index inline; more: background.

export interface ReindexResult {
  indexed: number;
  total: number;
  skipped: number;
  deleted: number;
  errors: string[];
}
export interface ReindexProgress {
  phase: "scan" | "index" | "delete" | "complete";
  completed: number;
  total: number;
}

interface ReindexCandidate {
  fullPath: string;
  relativePath: string;
  stamp: FileStamp | null;
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
let _backfillAbortController: AbortController | null = null;

/** Wire the coordinator at server startup (index.ts). */
export function configureLazyIndex(vba: VaultBrainAdapter, vaultPath: string): void {
  _vba = vba;
  _vaultPath = vaultPath;
}

/** Stop an inline or background reconciliation; the persisted run remains incomplete. */
export function cancelBackfill(): void {
  _backfillAbortController?.abort();
}

/** Abort and wait for a lazy reconciliation to settle before process shutdown. */
export async function cancelBackfillAndWait(): Promise<void> {
  cancelBackfill();
  await _inFlight;
}

/**
 * True while a backfill launched by an earlier ensureBackfill() call is still
 * running. Read-only peek at the single-flight lock -- never triggers a
 * backfill itself. Lets passive status checks (vault-status.ts) observe
 * "indexing_background" without calling ensureBackfill().
 */
export function isBackfillInFlight(): boolean {
  return _inFlight !== null;
}

interface VaultMarkdownScan {
  files: string[];
  complete: boolean;
}

function scanVaultMarkdown(vaultPath: string): VaultMarkdownScan {
  const files: string[] = [];
  let complete = true;
  const walk = (dir: string): void => {
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      complete = false;
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!e.name.startsWith(".") && PROTECTED_DIRS[e.name] !== true) walk(join(dir, e.name));
      } else if (e.isFile() && !e.name.startsWith(".") && e.name.endsWith(".md")) {
        files.push(join(dir, e.name));
      }
    }
  };
  walk(vaultPath);
  return { files, complete };
}

/** Walk the vault for indexable markdown, skipping machine/derived dirs. */
export function listVaultMarkdown(vaultPath: string): string[] {
  return scanVaultMarkdown(vaultPath).files;
}

/**
 * Reconcile every markdown file with vaultbrain, skipping unchanged content
 * and removing indexed files that no longer exist in the vault.
 */
export async function reindexVault(
  vba: VaultBrainAdapter,
  vaultPath: string,
  opts?: {
    concurrency?: number;
    onProgress?: (event: ReindexProgress) => void;
    signal?: AbortSignal;
  },
): Promise<ReindexResult> {
  const scan = scanVaultMarkdown(vaultPath);
  const candidates: ReindexCandidate[] = scan.files.map((fullPath) => {
    let stamp: FileStamp | null = null;
    try {
      const stats = statSync(fullPath);
      stamp = { mtimeMs: Math.floor(stats.mtimeMs), sizeBytes: stats.size };
    } catch {
      // Reading below reports the actionable filesystem error.
    }
    return {
      fullPath,
      relativePath: relative(vaultPath, fullPath).replace(/\\/g, "/"),
      stamp,
    };
  });
  const errors: string[] = [];
  const startedAt = Date.now();
  const report = (event: ReindexProgress): void => {
    try {
      opts?.onProgress?.(event);
    } catch (error) {
      errors.push(`progress: ${errorMessage(error)}`);
    }
  };
  const persist = async (state: ReindexState): Promise<void> => {
    try {
      await vba.setReindexState(state);
    } catch (error) {
      errors.push(`reindex state: ${errorMessage(error)}`);
    }
  };
  await persist({
    status: "running",
    startedAt,
    indexed: 0,
    total: candidates.length,
    skipped: 0,
    deleted: 0,
    errors: [],
  });
  report({ phase: "scan", completed: 0, total: candidates.length });

  let indexedSlugs = new Set<string>();
  try {
    indexedSlugs = new Set(await vba.listIndexedSlugs());
  } catch (error) {
    errors.push(`indexed paths: ${errorMessage(error)}`);
  }
  const currentSlugs = new Set(candidates.map((candidate) => pathToSlug(candidate.relativePath)));
  const concurrency = Math.max(1, Math.floor(opts?.concurrency ?? 4));
  let indexed = 0;
  let skipped = 0;
  let deleted = 0;
  if (!scan.complete) errors.push("vault scan incomplete; stale deletion skipped");

  for (let i = 0; i < candidates.length; i += concurrency) {
    if (opts?.signal?.aborted) {
      errors.push("reindex cancelled");
      break;
    }
    const batch = candidates.slice(i, i + concurrency);
    const outcomes = await Promise.all(batch.map(async (candidate) => {
      try {
        if (opts?.signal?.aborted) return { kind: "cancelled" as const };
        if (candidate.stamp) {
          const indexedStamp = await vba.getIndexedStamp(candidate.relativePath);
          if (
            indexedStamp &&
            indexedStamp.mtimeMs === candidate.stamp.mtimeMs &&
            indexedStamp.sizeBytes === candidate.stamp.sizeBytes
          ) {
            return { kind: "skipped" as const };
          }
        }
        const content = readFileSync(candidate.fullPath, "utf-8");
        const changed = await vba.ingest(candidate.relativePath, content, candidate.stamp ?? undefined, opts?.signal);
        return changed === false
          ? { kind: "skipped" as const }
          : { kind: "indexed" as const };
      } catch (error) {
        return {
          kind: "error" as const,
          path: candidate.relativePath,
          message: errorMessage(error),
        };
      }
    }));
    for (const outcome of outcomes) {
      if (outcome.kind === "indexed") indexed++;
      else if (outcome.kind === "skipped") skipped++;
      else if (outcome.kind === "cancelled") errors.push("reindex cancelled");
      else errors.push(`${outcome.path}: ${outcome.message}`);
    }
    report({ phase: "index", completed: indexed + skipped, total: candidates.length });
    if (opts?.signal?.aborted) {
      errors.push("reindex cancelled");
      break;
    }
  }

  if (scan.complete && !opts?.signal?.aborted) {
    for (const slug of indexedSlugs) {
      if (currentSlugs.has(slug) || existsSync(join(vaultPath, `${slug}.md`))) continue;
      try {
        await vba.deleteSlug(slug, opts?.signal);
        deleted++;
        report({ phase: "delete", completed: deleted, total: indexedSlugs.size });
      } catch (error) {
        const message = errorMessage(error);
        errors.push(`${slug}: ${message}`);
      }
    }
  }

  const result = { indexed, total: candidates.length, skipped, deleted, errors };
  report({ phase: "complete", completed: indexed + skipped, total: candidates.length });
  await persist({
    ...result,
    status: errors.length === 0 && scan.complete ? "complete" : "incomplete",
    startedAt,
    finishedAt: Date.now(),
  });
  return result;
}

/**
 * If vaultbrain is empty and no backfill is already running, trigger one.
 * Returns immediately for large vaults (background) so recall is never blocked;
 * awaits inline only for small vaults. Idempotent + single-flight.
 */
export async function ensureBackfill(opts?: { syncCap?: number; force?: boolean }): Promise<BackfillOutcome> {
  const vba = _vba;
  if (!vba || !vba.isAvailable) return { status: "unavailable" };
  if (_inFlight) return { status: "in_progress" };

  // Claim the single-flight lock synchronously before the first await.
  let release!: () => void;
  const lock = new Promise<void>((r) => { release = r; });
  _inFlight = lock;
  void lock.then(() => { if (_inFlight === lock) _inFlight = null; });
  const done = (o: BackfillOutcome): BackfillOutcome => { release(); return o; };

  let count = 0;
  let priorState: ReindexState | null = null;
  if (!opts?.force) {
    try {
      count = await vba.countChunks();
      priorState = await vba.getReindexState();
    } catch {
      return done({ status: "unavailable" });
    }
    // Chunks alone do not prove a complete reconciliation. An incomplete or
    // interrupted run must be retried so failed notes do not stay invisible.
    if (count > 0 && (!priorState || priorState.status === "complete")) {
      return done({ status: "populated" });
    }
  }

  const scan = scanVaultMarkdown(_vaultPath);
  if (!scan.complete) return done({ status: "unavailable", fileCount: scan.files.length });
  const fileCount = scan.files.length;
  const controller = new AbortController();
  _backfillAbortController = controller;
  const releaseController = (): void => {
    if (_backfillAbortController === controller) _backfillAbortController = null;
  };
  const reindexOpts = { signal: controller.signal };

  const syncCap = opts?.syncCap ?? DEFAULT_SYNC_CAP;
  if (fileCount <= syncCap) {
    try {
      await reindexVault(vba, _vaultPath, reindexOpts);
    } finally {
      releaseController();
      release();
    }
    return { status: "indexed_sync", fileCount };
  }

  // Large vault: run in the background, holding the lock until it finishes.
  void reindexVault(vba, _vaultPath, reindexOpts)
    .then((result) => {
      for (const error of result.errors) {
        process.stderr.write(`obsidian-llm-wiki: [vaultbrain] background reindex warning: ${error}\n`);
      }
    })
    .catch((error) => {
      process.stderr.write(
        `obsidian-llm-wiki: [vaultbrain] background reindex error: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    })
    .finally(() => {
      releaseController();
      release();
    });
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
  } else if (backfill.status === "in_progress") {
    gaps.push({ type: "retrieval_limitation", message: "semantic index is already building; retry recall after it finishes or inspect `vault.reindex_status`" });
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
  _backfillAbortController?.abort();
  _backfillAbortController = null;
  _vba = null;
  _vaultPath = "";
  _inFlight = null;
}
