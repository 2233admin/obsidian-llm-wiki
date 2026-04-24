/**
 * Unified query -- parallel search across all adapters, weighted fusion merge.
 *
 * Promise.allSettled ensures one adapter failure doesn't block the rest.
 * Results are scored, source-annotated, and merged by descending score.
 */

import type { AdapterRegistry } from "./adapters/registry.js";
import type { SearchResult, SearchOpts } from "./adapters/interface.js";
import { fuseRRF, type RankedBundle } from "./rrf.js";

export interface UnifiedQueryOpts extends SearchOpts {
  /** Only query these adapter names (default: all search-capable) */
  adapters?: string[];
  /** Per-adapter score weight multiplier (default: 1.0) */
  weights?: Record<string, number>;
}

export interface AdapterStats {
  count: number;
  latencyMs: number;
  error?: string;
}

export interface UnifiedQueryResult {
  results: SearchResult[];
  sources: Record<string, AdapterStats>;
  totalResults: number;
}

export async function unifiedQuery(
  registry: AdapterRegistry,
  query: string,
  opts?: UnifiedQueryOpts,
): Promise<UnifiedQueryResult> {
  const searchAdapters = registry.getByCapability("search");
  const filtered = opts?.adapters
    ? searchAdapters.filter((a) => opts.adapters!.includes(a.name))
    : searchAdapters;

  if (filtered.length === 0) {
    return { results: [], sources: {}, totalResults: 0 };
  }

  const weights = opts?.weights ?? {};
  const sources: Record<string, AdapterStats> = {};

  // Per-adapter limit: request ~1.5x share so fusion has headroom to merge
  const totalMax = opts?.maxResults ?? 50;
  // Each adapter gets at least totalMax results so weak sources can still
  // contribute to RRF fusion. Without this floor, the old formula capped
  // per-adapter results at totalMax*1.5/N which (at N=4) gave each adapter
  // only ~19 rows; a weak adapter's rank-20 relevant doc could never enter
  // the fusion pool, defeating RRF's whole purpose of lifting weak-source
  // signals.
  const perAdapterMax = Math.max(
    totalMax,
    Math.ceil((totalMax * 1.5) / filtered.length),
  );

  const settled = await Promise.allSettled(
    filtered.map(async (adapter): Promise<RankedBundle> => {
      const start = Date.now();
      const w = weights[adapter.name] ?? 1.0;
      try {
        const results = await adapter.search!(query, { ...opts, maxResults: perAdapterMax });
        sources[adapter.name] = { count: results.length, latencyMs: Date.now() - start };
        return {
          source: adapter.name,
          weight: w,
          results: results.map((r) => ({ ...r, source: adapter.name })),
        };
      } catch (e) {
        sources[adapter.name] = {
          count: 0,
          latencyMs: Date.now() - start,
          error: (e as Error).message,
        };
        return { source: adapter.name, weight: w, results: [] };
      }
    }),
  );

  const bundles: RankedBundle[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") bundles.push(r.value);
  }

  // RRF fusion: rank-based not score-based, same doc across sources accumulates.
  const merged = fuseRRF(bundles);

  const maxResults = opts?.maxResults ?? 50;
  return {
    results: merged.slice(0, maxResults),
    sources,
    totalResults: merged.length,
  };
}

export interface UnifiedVectorQueryOpts {
  /** Only query these adapter names (default: all embeddings-capable) */
  adapters?: string[];
  /** Per-adapter score weight multiplier (default: 1.0) */
  weights?: Record<string, number>;
  /** Max results merged across adapters (default: 50) */
  maxResults?: number;
}

/**
 * Vector-mode fan-out. Dispatches searchByVector() to all adapters that
 * declare the "embeddings" capability AND implement the method. Same
 * fusion + weighting semantics as unifiedQuery; caller is responsible for
 * providing a vector that matches each target adapter's stored vector
 * space (memu: 1024-dim).
 */
export async function unifiedQueryByVector(
  registry: AdapterRegistry,
  vector: readonly number[],
  opts?: UnifiedVectorQueryOpts,
): Promise<UnifiedQueryResult> {
  if (vector.length === 0) {
    return { results: [], sources: {}, totalResults: 0 };
  }

  const vectorAdapters = registry
    .getByCapability("embeddings")
    .filter((a) => typeof a.searchByVector === "function");
  const filtered = opts?.adapters
    ? vectorAdapters.filter((a) => opts.adapters!.includes(a.name))
    : vectorAdapters;

  if (filtered.length === 0) {
    return { results: [], sources: {}, totalResults: 0 };
  }

  const weights = opts?.weights ?? {};
  const sources: Record<string, AdapterStats> = {};
  const totalMax = opts?.maxResults ?? 50;
  // Each adapter gets at least totalMax results so weak sources can still
  // contribute to RRF fusion. Without this floor, the old formula capped
  // per-adapter results at totalMax*1.5/N which (at N=4) gave each adapter
  // only ~19 rows; a weak adapter's rank-20 relevant doc could never enter
  // the fusion pool, defeating RRF's whole purpose of lifting weak-source
  // signals.
  const perAdapterMax = Math.max(
    totalMax,
    Math.ceil((totalMax * 1.5) / filtered.length),
  );

  const settled = await Promise.allSettled(
    filtered.map(async (adapter): Promise<RankedBundle> => {
      const start = Date.now();
      const w = weights[adapter.name] ?? 1.0;
      try {
        const results = await adapter.searchByVector!(vector, {
          maxResults: perAdapterMax,
        });
        sources[adapter.name] = { count: results.length, latencyMs: Date.now() - start };
        return {
          source: adapter.name,
          weight: w,
          results: results.map((r) => ({ ...r, source: adapter.name })),
        };
      } catch (e) {
        sources[adapter.name] = {
          count: 0,
          latencyMs: Date.now() - start,
          error: (e as Error).message,
        };
        return { source: adapter.name, weight: w, results: [] };
      }
    }),
  );

  const bundles: RankedBundle[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") bundles.push(r.value);
  }

  // RRF fusion: see unifiedQuery for rationale.
  const merged = fuseRRF(bundles);

  return {
    results: merged.slice(0, totalMax),
    sources,
    totalResults: merged.length,
  };
}
