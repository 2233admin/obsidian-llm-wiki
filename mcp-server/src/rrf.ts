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

// --- MinHeap ----------------------------------------------------------------

/**
 * Binary min-heap keyed by score (ascending — root is the smallest).
 * Used to efficiently track the top-k candidates during RRF scoring.
 */
class MinHeap<T> {
  private heap: T[] = [];

  constructor(
    private compare: (a: T, b: T) => number = (a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
  ) {}

  get size(): number {
    return this.heap.length;
  }

  push(item: T): void {
    this.heap.push(item);
    this._siftUp(this.heap.length - 1);
  }

  pop(): T | undefined {
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this._siftDown(0);
    }
    return top;
  }

  peek(): T | undefined {
    return this.heap[0];
  }

  private _siftUp(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.compare(this.heap[p], this.heap[i]) <= 0) break;
      [this.heap[p], this.heap[i]] = [this.heap[i], this.heap[p]];
      i = p;
    }
  }

  private _siftDown(i: number): void {
    const n = this.heap.length;
    for (;;) {
      let m = i,
        l = 2 * i + 1,
        r = 2 * i + 2;
      if (l < n && this.compare(this.heap[l], this.heap[m]) < 0) m = l;
      if (r < n && this.compare(this.heap[r], this.heap[m]) < 0) m = r;
      if (m === i) break;
      [this.heap[m], this.heap[i]] = [this.heap[i], this.heap[m]];
      i = m;
    }
  }
}

// --- Types ------------------------------------------------------------------

export interface RankedBundle {
  source: string;
  weight: number;
  /** Adapter-sorted results (rank = index + 1). */
  results: readonly SearchResult[];
}

interface Candidate {
  key: string;
  result: SearchResult;
  score: number;
  sources: Set<string>;
}

// --- Implementations --------------------------------------------------------

/**
 * Linear (original) implementation:
 * 1. Accumulates RRF contribution for every distinct doc across all bundles.
 * 2. Sorts all scored docs at the end.
 *
 * Time: O(N log N) where N = total distinct docs.
 * Memory: O(N) — all candidates held simultaneously.
 */
export function fuseRRF(
  bundles: readonly RankedBundle[],
  getKey: (r: SearchResult) => string = (r) => r.path,
): SearchResult[] {
  const scored = new Map<string, Candidate>();

  for (const bundle of bundles) {
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
          key,
          result: { ...r, source: bundle.source },
          score: contribution,
          sources: new Set([bundle.source]),
        });
      }
    });
  }

  return _sortCandidates(Array.from(scored.values()));
}

/**
 * Heap-optimised implementation with early termination.
 *
 * Uses a max-heap to efficiently extract the top-k results without sorting
 * all N candidates. For large result sets where N >> limit, this reduces
 * the O(N log N) full-sort overhead on the output path.
 *
 * Processing order preserves the original accumulation semantics: all bundles
 * are fully processed so that cross-source score contributions are correct.
 *
 * Early termination: once `limit` results have been extracted from the heap
 * we return immediately without sorting remaining candidates.
 *
 * @param bundles  Ranked result bundles from adapters.
 * @param getKey   Uniqueness key per result (default: path).
 * @param limit    Max results to return; triggers early termination (default 10).
 * @param _prune   Reserved for future score-based pruning (not yet wired).
 */
export function fuseRRFOptimized(
  bundles: readonly RankedBundle[],
  getKey: (r: SearchResult) => string = (r) => r.path,
  limit = 10,
  _prune = true,
): SearchResult[] {
  // Phase 1 — accumulate final scores across all bundles.
  // Track first-seen result per key so we can reconstruct Candidate
  // after scoring is complete (avoids stale score when same key appears
  // in multiple bundles and scoreMap is updated in-place).
  const scoreMap = new Map<string, number>();
  const firstResult = new Map<string, SearchResult>();
  const sourcesMap = new Map<string, Set<string>>();

  for (const bundle of bundles) {
    const seenInBundle = new Set<string>();
    bundle.results.forEach((r, i) => {
      const key = getKey(r);
      if (seenInBundle.has(key)) return;
      seenInBundle.add(key);
      const rank = i + 1;
      const contribution = bundle.weight / (RRF_K + rank);

      const prev = scoreMap.get(key);
      if (prev !== undefined) {
        scoreMap.set(key, prev + contribution);
        sourcesMap.get(key)!.add(bundle.source);
      } else {
        scoreMap.set(key, contribution);
        firstResult.set(key, { ...r, source: bundle.source });
        sourcesMap.set(key, new Set([bundle.source]));
      }
    });
  }

  // Phase 2 — build max-heap: comparator is b.score - a.score so that
  // heap.pop() returns the HIGHEST-scoring (best) candidate first.
  const heap = new MinHeap<Candidate>((a, b) => b.score - a.score);
  for (const [key, score] of scoreMap) {
    heap.push({
      key,
      result: firstResult.get(key)!,
      score,
      sources: sourcesMap.get(key)!,
    });
  }

  // Phase 3 — extract top `limit` results in descending score order.
  const results: SearchResult[] = [];
  while (results.length < limit && heap.size > 0) {
    const top = heap.pop()!;
    results.push({
      ...top.result,
      score: top.score,
      metadata: {
        ...top.result.metadata,
        rrfSources: Array.from(top.sources),
      },
    });
  }

  return results;
}

function _sortCandidates(candidates: Candidate[]): SearchResult[] {
  return candidates
    .sort((a, b) => {
      const delta = b.score - a.score;
      if (delta !== 0) return delta;
      return a.key.localeCompare(b.key);
    })
    .map((c) => ({
      ...c.result,
      score: c.score,
      metadata: {
        ...c.result.metadata,
        rrfSources: Array.from(c.sources),
      },
    }));
}
