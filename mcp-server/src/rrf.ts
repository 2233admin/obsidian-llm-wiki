/**
 * Reciprocal Rank Fusion (Cormack et al. 2009).
 *
 *   score(doc) = sum over sources ( weight / (k + rank_in_source) )
 *
 * Adopted from GBrain's hybrid-search pattern. k=60 is the paper's
 * recommended constant -- small enough to let top ranks dominate,
 * large enough to keep tail contributions non-zero.
 *
 * Same document appearing in multiple sources accumulates contribution,
 * which is the whole point: a doc that's top-5 in both keyword and
 * vector search beats a doc that's top-1 in just one.
 */

import type { SearchResult } from "./adapters/interface.js";

export const RRF_K = 60;

export interface RankedBundle {
  source: string;
  weight: number;
  /** Adapter-sorted results (rank = index + 1). */
  results: readonly SearchResult[];
}

export function fuseRRF(
  bundles: readonly RankedBundle[],
  getKey: (r: SearchResult) => string = (r) => r.path,
): SearchResult[] {
  const scored = new Map<
    string,
    { result: SearchResult; score: number; sources: Set<string> }
  >();

  for (const bundle of bundles) {
    // Cormack 2009 assumes each source is a ranked list with unique items.
    // If an adapter returns the same path twice (e.g. filesystem grep
    // matching multiple lines in one file, memu returning multiple chunks
    // of the same page), only the first (highest-rank) occurrence counts
    // toward this bundle's contribution. Otherwise we inflate that source's
    // weight on that doc.
    const seenInBundle = new Set<string>();
    bundle.results.forEach((r, i) => {
      const key = getKey(r);
      if (seenInBundle.has(key)) return;
      seenInBundle.add(key);
      const rank = i + 1;
      const contribution = bundle.weight / (RRF_K + rank);
      const prev = scored.get(key);
      if (prev) {
        prev.score += contribution;
        prev.sources.add(bundle.source);
      } else {
        scored.set(key, {
          result: { ...r, source: bundle.source },
          score: contribution,
          sources: new Set([bundle.source]),
        });
      }
    });
  }

  return Array.from(scored.values())
    .map((e) => ({
      ...e.result,
      score: e.score,
      metadata: {
        ...e.result.metadata,
        rrfSources: Array.from(e.sources),
      },
    }))
    .sort((a, b) => {
      // Primary: RRF score descending.
      // Tie-break: path ascending for determinism -- without this, ties
      // resolve by Map insertion order, which is Promise.allSettled
      // completion order, which is adapter race. Test runs would flap.
      const delta = b.score - a.score;
      if (delta !== 0) return delta;
      return a.path.localeCompare(b.path);
    });
}
