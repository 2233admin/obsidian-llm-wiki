/**
 * Unified query -- parallel search across all adapters, weighted fusion merge.
 *
 * Promise.allSettled ensures one adapter failure doesn't block the rest.
 * Results are scored, source-annotated, and merged by descending score.
 */

import type { AdapterRegistry } from "./adapters/registry.js";
import type { SearchResult, SearchOpts } from "./adapters/interface.js";
import { fuseRRF, RRF_K, type RankedBundle } from "./rrf.js";

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

export interface QueryTraceBranch {
  adapter: string;
  capabilities: string[];
  weight: number;
  status: "ok" | "error" | "skipped";
  count: number;
  latencyMs: number;
  error?: string;
}

export interface QueryTraceEvidence {
  rank: number;
  source: string;
  path: string;
  score: number;
  snippet: string;
  rrfSources: string[];
  metadata?: Record<string, unknown>;
}

export interface QueryTraceResult extends UnifiedQueryResult {
  query: string;
  mode: "keyword";
  plan: {
    intent: "transparent_retrieval_trace";
    requestedAdapters: string[] | "all-search-capable";
    selectedAdapters: string[];
    fusion: {
      algorithm: "reciprocal_rank_fusion";
      k: number;
      rankBase: 1;
      scoreFormula: string;
    };
    branches: QueryTraceBranch[];
  };
  evidence: QueryTraceEvidence[];
  limitations: string[];
}

export type QueryAnswerConfidence = "low" | "medium" | "high";

export interface QueryAnswerCitation {
  id: string;
  rank: number;
  source: string;
  path: string;
  snippet: string;
  metadata?: Record<string, unknown>;
}

export interface QueryAnswerClaim {
  text: string;
  citations: string[];
  confidence: QueryAnswerConfidence;
}

export interface QueryAnswerGap {
  type: "no_evidence" | "adapter_error" | "retrieval_limitation" | "unknown_recency" | "semantic_review_missing";
  message: string;
  source?: string;
}

export interface QueryAnswerResult {
  query: string;
  answer: string;
  claims: QueryAnswerClaim[];
  citations: QueryAnswerCitation[];
  gaps: QueryAnswerGap[];
  contradictions: QueryAnswerClaim[];
  confidence: QueryAnswerConfidence;
  trace: QueryTraceResult;
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

export async function traceUnifiedQuery(
  registry: AdapterRegistry,
  query: string,
  opts?: UnifiedQueryOpts,
): Promise<QueryTraceResult> {
  const searchAdapters = registry.getByCapability("search");
  const selected = opts?.adapters
    ? searchAdapters.filter((a) => opts.adapters!.includes(a.name))
    : searchAdapters;
  const requestedAdapters = opts?.adapters ?? "all-search-capable";
  const result = await unifiedQuery(registry, query, opts);
  const weights = opts?.weights ?? {};
  const branches: QueryTraceBranch[] = selected.map((adapter) => {
    const stats = result.sources[adapter.name];
    const weight = weights[adapter.name] ?? 1;
    if (!stats) {
      return {
        adapter: adapter.name,
        capabilities: [...adapter.capabilities],
        weight,
        status: "skipped",
        count: 0,
        latencyMs: 0,
      };
    }
    return {
      adapter: adapter.name,
      capabilities: [...adapter.capabilities],
      weight,
      status: stats.error ? "error" : "ok",
      count: stats.count,
      latencyMs: stats.latencyMs,
      error: stats.error,
    };
  });

  const evidence = result.results.map((item, index) => ({
    rank: index + 1,
    source: item.source,
    path: item.path,
    score: item.score,
    snippet: trimSnippet(item.content),
    rrfSources: readRrfSources(item),
    metadata: item.metadata,
  }));

  return {
    ...result,
    query,
    mode: "keyword",
    plan: {
      intent: "transparent_retrieval_trace",
      requestedAdapters,
      selectedAdapters: selected.map((adapter) => adapter.name),
      fusion: {
        algorithm: "reciprocal_rank_fusion",
        k: RRF_K,
        rankBase: 1,
        scoreFormula: "sum(weight / (k + rank_in_source))",
      },
      branches,
    },
    evidence,
    limitations: buildTraceLimitations(query, opts, searchAdapters.map((adapter) => adapter.name), selected.map((adapter) => adapter.name), result),
  };
}

export async function answerQuery(
  registry: AdapterRegistry,
  query: string,
  opts?: UnifiedQueryOpts,
): Promise<QueryAnswerResult> {
  const trace = await traceUnifiedQuery(registry, query, opts);
  const citations = trace.evidence.map((item, index) => ({
    id: `C${index + 1}`,
    rank: item.rank,
    source: item.source,
    path: item.path,
    snippet: item.snippet,
    metadata: item.metadata,
  }));
  const claims = citations.slice(0, Math.min(5, citations.length)).map((citation) => ({
    text: claimFromCitation(citation),
    citations: [citation.id],
    confidence: claimConfidence(query, citation),
  }));
  const gaps = answerGaps(trace);
  const confidence = answerConfidence(claims, gaps);
  return {
    query,
    answer: renderAnswer(query, claims, gaps),
    claims,
    citations,
    gaps,
    contradictions: [],
    confidence,
    trace,
  };
}

function trimSnippet(content: string, maxLength = 600): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function readRrfSources(result: SearchResult): string[] {
  const sources = result.metadata?.rrfSources;
  if (Array.isArray(sources)) {
    return sources.filter((source): source is string => typeof source === "string");
  }
  return [result.source];
}

function buildTraceLimitations(
  query: string,
  opts: UnifiedQueryOpts | undefined,
  availableAdapters: string[],
  selectedAdapters: string[],
  result: UnifiedQueryResult,
): string[] {
  const limitations: string[] = [
    "query.trace explains retrieval and fusion; it does not verify that evidence supports a generated answer.",
  ];
  if (query.trim().split(/\s+/).length === 1) {
    limitations.push("single-term queries can over-rank literal matches; use a phrase or more context for better evidence.");
  }
  if (selectedAdapters.includes("filesystem")) {
    limitations.push("filesystem search is literal ripgrep matching, not BM25.");
  }
  if (selectedAdapters.includes("vaultbrain")) {
    limitations.push("vaultbrain keyword search uses pg_trgm similarity plus optional vector search, not a native BM25 scorer.");
  }
  const requested = opts?.adapters ?? [];
  const missing = requested.filter((adapter) => !availableAdapters.includes(adapter));
  if (missing.length > 0) {
    limitations.push(`requested adapters not registered or not search-capable: ${missing.join(", ")}`);
  }
  if (selectedAdapters.length === 0) {
    limitations.push("no search-capable adapters were selected.");
  }
  if (result.results.length === 0) {
    limitations.push("no evidence was retrieved for this query.");
  }
  return limitations;
}

function claimFromCitation(citation: QueryAnswerCitation): string {
  const sentence = firstUsefulSentence(citation.snippet);
  if (sentence) return sentence;
  return `Retrieved evidence from ${citation.path}`;
}

function firstUsefulSentence(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const match = normalized.match(/^(.{24,240}?[.!?])(\s|$)/);
  if (match) return match[1].trim();
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 239)}…`;
}

function claimConfidence(query: string, citation: QueryAnswerCitation): QueryAnswerConfidence {
  const q = query.trim().toLowerCase();
  const snippet = citation.snippet.toLowerCase();
  if (q && snippet.includes(q)) return "high";
  if (snippet.length > 0) return "medium";
  return "low";
}

function answerGaps(trace: QueryTraceResult): QueryAnswerGap[] {
  const gaps: QueryAnswerGap[] = [];
  if (trace.evidence.length === 0) {
    gaps.push({
      type: "no_evidence",
      message: "No retrieved evidence was available, so no citation-backed answer can be produced.",
    });
  }
  for (const branch of trace.plan.branches) {
    if (branch.status === "error") {
      gaps.push({
        type: "adapter_error",
        source: branch.adapter,
        message: branch.error ?? `${branch.adapter} search failed.`,
      });
    }
  }
  for (const limitation of trace.limitations) {
    gaps.push({
      type: "retrieval_limitation",
      message: limitation,
    });
  }
  if (trace.evidence.length > 0) {
    gaps.push({
      type: "unknown_recency",
      message: "Evidence freshness is not verified unless timestamps are present in source metadata.",
    });
    gaps.push({
      type: "semantic_review_missing",
      message: "Phase A does not perform semantic contradiction detection; contradictions are reported only after a later reviewer/reranker layer exists.",
    });
  }
  return gaps;
}

function answerConfidence(claims: QueryAnswerClaim[], gaps: QueryAnswerGap[]): QueryAnswerConfidence {
  if (claims.length === 0) return "low";
  if (gaps.some((gap) => gap.type === "adapter_error") && claims.length < 2) return "low";
  if (claims.length >= 3 && claims.every((claim) => claim.confidence === "high")) return "high";
  return "medium";
}

function renderAnswer(query: string, claims: QueryAnswerClaim[], gaps: QueryAnswerGap[]): string {
  if (claims.length === 0) {
    return `I could not answer "${query}" from retrieved vault evidence.`;
  }
  const lines = [`Based on retrieved vault evidence for "${query}":`];
  claims.forEach((claim, index) => {
    lines.push(`${index + 1}. ${claim.text} [${claim.citations.join(", ")}]`);
  });
  const topGaps = gaps
    .filter((gap) => gap.type !== "retrieval_limitation")
    .slice(0, 3)
    .map((gap) => gap.message);
  if (topGaps.length > 0) {
    lines.push("");
    lines.push("Gaps:");
    topGaps.forEach((gap) => lines.push(`- ${gap}`));
  }
  return lines.join("\n");
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
