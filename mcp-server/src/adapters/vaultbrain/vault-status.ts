/**
 * TASK13 13B follow-up -- vault readiness classifier (gstack-style first-run detector).
 *
 * A caller (agent, CLI, whatever) needs to know *before* touching recall whether
 * the vault is even set up, has notes, and is indexed -- without triggering any
 * side effects (never call ensureBackfill()/reindexVault() from here; those
 * actively build an index, this only peeks at current state). The 5-bucket
 * classification is deliberately dumb: it maps counts/timestamps to one token.
 * Turning that token into human-readable guidance is a later step, out of scope.
 *
 * classifyVaultReadiness() is pure -- no fs/DB access -- so it is cheap to unit
 * test for all 5 buckets. gatherVaultStatus() does the actual (timeout-guarded)
 * fs + DB peeking and then classifies, mirroring how ensureBackfill() already
 * separates "collect state" from "decide what to do" in lazy-index.ts.
 */

import { existsSync, statSync } from "node:fs";
import type { VaultBrainAdapter } from "./index.js";
import { listVaultMarkdown, isBackfillInFlight, type BackfillStatus } from "./lazy-index.js";

const MIN_MARKDOWN_FILES = 5; // fewer than this -> empty_vault bucket.
const DEFAULT_QUERY_TIMEOUT_MS = 2000;

export type VaultReadinessBucket =
  | "vault_missing"
  | "empty_vault"
  | "unindexed"
  | "stale_or_backgrounding"
  | "ready";

export interface VaultReadinessInput {
  /** True when the vault root is configured (non-empty) and exists on disk. */
  vaultExists: boolean;
  /** Count of markdown files under the vault root (0 if vault doesn't exist). */
  markdownCount: number;
  /** Current vaultbrain chunk count (0 if adapter unavailable or truly empty). */
  chunkCount: number;
  /** True when a backfill is actively running right now (in_progress/indexing_background). */
  indexingInProgress: boolean;
  /** mtimeMs of the newest markdown file, if any files exist. */
  newestMarkdownMtimeMs: number | null;
  /** mtimeMs of the last recorded index write, if known. */
  lastIndexedAtMs: number | null;
}

export interface VaultReadiness {
  bucket: VaultReadinessBucket;
  /** Raw counts/timestamps that justified the bucket -- for debugging/future prose mapping. */
  markdownCount: number;
  chunkCount: number;
  indexingInProgress: boolean;
  newestMarkdownMtimeMs: number | null;
  lastIndexedAtMs: number | null;
}

/**
 * Pure classifier: input counts/flags -> one of 5 readiness buckets. No I/O.
 */
export function classifyVaultReadiness(input: VaultReadinessInput): VaultReadiness {
  const {
    vaultExists,
    markdownCount,
    chunkCount,
    indexingInProgress,
    newestMarkdownMtimeMs,
    lastIndexedAtMs,
  } = input;

  const base = { markdownCount, chunkCount, indexingInProgress, newestMarkdownMtimeMs, lastIndexedAtMs };

  let bucket: VaultReadinessBucket;
  if (!vaultExists) {
    bucket = "vault_missing";
  } else if (markdownCount < MIN_MARKDOWN_FILES) {
    bucket = "empty_vault";
  } else if (chunkCount === 0) {
    bucket = "unindexed";
  } else if (
    indexingInProgress ||
    (newestMarkdownMtimeMs !== null &&
      lastIndexedAtMs !== null &&
      newestMarkdownMtimeMs > lastIndexedAtMs)
  ) {
    bucket = "stale_or_backgrounding";
  } else {
    bucket = "ready";
  }

  return { bucket, ...base };
}

/** Backfill statuses that mean "an indexing pass is actively running right now". */
function isActivelyIndexing(status: BackfillStatus | undefined): boolean {
  return status === "in_progress" || status === "indexing_background";
}

/**
 * Race a promise against a timeout. On timeout the promise settles with
 * `onTimeout` rather than rejecting -- callers decide the fail-closed value.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(onTimeout);
      }
    }, ms);
    promise.then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
      },
      () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(onTimeout);
        }
      },
    );
  });
}

export interface GatherVaultStatusOpts {
  /**
   * In-progress backfill status, if the caller already has one (e.g. from
   * ensureBackfill's last outcome). Optional override -- when omitted, this
   * falls back to isBackfillInFlight() (lazy-index.ts's single-flight lock),
   * which is a passive read of the actual coordinator state, so production
   * callers get real "actively indexing right now" detection for free
   * without having to plumb ensureBackfill's return value through.
   */
  backfillStatus?: BackfillStatus;
  /** Timeout for the chunk-count / last-indexed-at DB queries (default 2000ms). */
  queryTimeoutMs?: number;
}

/**
 * Passive, read-only peek at current vault/index state -- never triggers a
 * backfill or any other write. Wraps the vaultbrain DB queries in a short
 * timeout so a stuck/slow DB can never hang this classifier.
 *
 * Fail-closed default: on any fs/DB failure or timeout, this reports
 * "unindexed" as the safe bucket (chunkCount=0, no indexing claimed) rather
 * than throwing -- "unindexed" is the least presumptuous state: it never
 * claims the vault is ready (which could mislead a caller into skipping
 * setup) and never claims indexing is in progress (which could make a
 * caller wait for something that isn't happening).
 */
export async function gatherVaultStatus(
  vaultPath: string | undefined,
  vba: VaultBrainAdapter | undefined,
  opts?: GatherVaultStatusOpts,
): Promise<VaultReadiness> {
  const timeoutMs = opts?.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;

  let vaultExists = false;
  let markdownCount = 0;
  let newestMarkdownMtimeMs: number | null = null;
  try {
    vaultExists = Boolean(vaultPath && vaultPath.trim() && existsSync(vaultPath));
    if (vaultExists && vaultPath) {
      const files = listVaultMarkdown(vaultPath);
      markdownCount = files.length;
      for (const file of files) {
        try {
          const mtimeMs = statSync(file).mtimeMs;
          if (newestMarkdownMtimeMs === null || mtimeMs > newestMarkdownMtimeMs) {
            newestMarkdownMtimeMs = mtimeMs;
          }
        } catch {
          // unreadable file -- skip, non-fatal (mirrors listVaultMarkdown's own skip-on-error)
        }
      }
    }
  } catch {
    // fail closed: treat as if the vault isn't there -- see classifyVaultReadiness's
    // vault_missing branch, the most conservative bucket when fs state is unknown.
    vaultExists = false;
    markdownCount = 0;
    newestMarkdownMtimeMs = null;
  }

  let chunkCount = 0;
  let lastIndexedAtMs: number | null = null;
  if (vba && vba.isAvailable) {
    chunkCount = await withTimeout(vba.countChunks(), timeoutMs, 0);
    lastIndexedAtMs = await withTimeout(vba.getLastIndexedAtMs(), timeoutMs, null);
  }

  // backfillStatus is an optional override; default to a passive read of the
  // lazy-index single-flight lock so production callers (context.vault_status)
  // detect an actively-running background backfill without triggering one.
  const indexingInProgress =
    opts?.backfillStatus !== undefined ? isActivelyIndexing(opts.backfillStatus) : isBackfillInFlight();

  return classifyVaultReadiness({
    vaultExists,
    markdownCount,
    chunkCount,
    indexingInProgress,
    newestMarkdownMtimeMs,
    lastIndexedAtMs,
  });
}
