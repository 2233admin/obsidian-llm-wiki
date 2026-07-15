/**
 * adapter-memu -- routes memU graph recall through two search paths.
 *
 * This adapter implements a cascading fallback strategy:
 *
 *   1. Graph recall (primary): spawns `python -m memu_graph.cli graph-recall`
 *      via stdin/stdout JSON bridge. Implements PPR + community recall from
 *      gm_nodes / gm_edges (1024-dim). Cold-start ~630ms. Unavailable if
 *      memu_graph is not importable in the target Python environment.
 *
 *   2. Pure-PG search (fallback): spawns `memu_search.py` which uses Python-side
 *      cosine similarity against memory_items (1024-dim bge-m3 embeddings stored
 *      as JSONB). Bypasses pgvector entirely -- works on Windows where pgvector
 *      is unavailable. Also handles ILIKE fallback when embedding generation fails.
 *
 * Search paths:
 *   - search(query)  -> embeds via Ollama bge-m3 (1024-dim), falls back to ILIKE
 *   - searchByVector(vec) 1024-dim -> cosine via memu_search.py
 *   - searchByVector(vec) 4096-dim -> raw pgvector cosine on memory_items
 *
 * Requires: a Settings-derived Postgres connection, Ollama serving bge-m3 at :11434.
 * Gracefully degrades to [] if unavailable.
 * The constructor never reads process.env or resolves Secret References directly.
 * At each Python subprocess boundary it preserves the inherited environment and
 * overrides MEMU_DSN with the Settings-resolved value so credentials never enter
 * the operating-system argument vector.
 */

import pg from "pg";
import { spawn } from "node:child_process";
import { embedTextOllama } from "../embedding/ollama.js";
import type {
  VaultMindAdapter,
  AdapterCapability,
  SearchResult,
  SearchOpts,
} from "./interface.js";

const { Pool } = pg;

export interface MemUAdapterConfig {
  /** Postgres DSN injected by the Settings runtime (default: credential-free localhost). */
  dsn?: string;
  /** user_id scope filter (default: "default") */
  userId?: string;
  /** Maximum results per query (default: 20) */
  maxResults?: number;
  /** Query timeout in ms (default: 5000) */
  timeout?: number;
  /**
   * memory_type values to exclude from the 4096-dim memory_items vector path.
   * Default ["event"] -- chat-history events dominate row count (~96% of
   * memory_items in production) and overwhelm higher-signal types under
   * cosine ranking. The 1024d graph path is unaffected (gm_nodes already
   * filters out event noise structurally). Pass [] to include all types.
   */
  excludeMemoryTypes?: readonly string[];
  /** Python interpreter to spawn for memu-graph CLI. Default: python/python3 from PATH. */
  pythonExe?: string;
  /** Working directory for the subprocess (so it can import memu_graph). Default: process cwd. */
  memuGraphCwd?: string;
  /** Subprocess timeout in ms. Default: 15_000 (cold-start ~630ms + worst-case slow PG) */
  graphRecallTimeoutMs?: number;
  /** Path to memu_search.py fallback script. Default: memu_search.py in the configured cwd. */
  memuSearchPy?: string;
  /** Python interpreter for memu_search.py (may differ from memuGraph python). Default: python from PATH */
  memuSearchPythonExe?: string;
  /** Subprocess timeout for memu_search.py in ms. Default: 20_000. */
  memuSearchTimeoutMs?: number;
  /** Ollama embedding model. Default: bge-m3 (1024-dim, available on this machine) */
  embedModel?: string;
}

const DEFAULT_DSN = "postgresql://localhost:5432/memu";
const DEFAULT_GRAPH_RECALL_TIMEOUT_MS = 15_000;
const DEFAULT_MEMU_SEARCH_PY = "memu_search.py";
const DEFAULT_MEMU_SEARCH_TIMEOUT_MS = 20_000;

function memuChildEnvironment(dsn: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    MEMU_DSN: dsn,
  };
}

function redactResolvedDsn(value: string, dsn: string): string {
  return dsn.length > 0 ? value.split(dsn).join("[redacted]") : value;
}

export interface ResolvedMemUAdapterConfig {
  dsn: string;
  userId: string;
  maxResults: number;
  timeout: number;
  excludeMemoryTypes: readonly string[];
  pythonExe: string;
  memuGraphCwd: string;
  graphRecallTimeoutMs: number;
  memuSearchPy: string;
  memuSearchPythonExe: string;
  memuSearchTimeoutMs: number;
  embedModel: string;
}

function pathPython(platform: NodeJS.Platform): string {
  return platform === "win32" ? "python" : "python3";
}

function positiveEnvironmentNumber(
  environment: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const raw = environment[key];
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Resolve portable runtime configuration without probing Python or Postgres. */
export function resolveMemUAdapterConfig(
  config: MemUAdapterConfig = {},
  environment: NodeJS.ProcessEnv = {},
  runtime: { cwd?: string; platform?: NodeJS.Platform } = {},
): ResolvedMemUAdapterConfig {
  const python = pathPython(runtime.platform ?? process.platform);
  return {
    dsn: config.dsn ?? environment.MEMU_DSN ?? DEFAULT_DSN,
    userId: config.userId ?? environment.MEMU_USER_ID ?? "default",
    maxResults: config.maxResults ?? 20,
    timeout: config.timeout ?? 5_000,
    excludeMemoryTypes: config.excludeMemoryTypes ?? ["event"],
    pythonExe: config.pythonExe ?? environment.MEMU_GRAPH_PYTHON ?? python,
    memuGraphCwd: config.memuGraphCwd ?? environment.MEMU_GRAPH_CWD ?? runtime.cwd ?? process.cwd(),
    graphRecallTimeoutMs:
      config.graphRecallTimeoutMs
      ?? positiveEnvironmentNumber(environment, "MEMU_GRAPH_TIMEOUT_MS", DEFAULT_GRAPH_RECALL_TIMEOUT_MS),
    memuSearchPy: config.memuSearchPy ?? environment.MEMU_SEARCH_PY ?? DEFAULT_MEMU_SEARCH_PY,
    memuSearchPythonExe: config.memuSearchPythonExe ?? environment.MEMU_SEARCH_PYTHON ?? python,
    memuSearchTimeoutMs:
      config.memuSearchTimeoutMs
      ?? positiveEnvironmentNumber(environment, "MEMU_SEARCH_TIMEOUT_MS", DEFAULT_MEMU_SEARCH_TIMEOUT_MS),
    embedModel: config.embedModel ?? environment.OLLAMA_EMBED_MODEL ?? "bge-m3",
  };
}

interface RecallNode {
  id: string;
  name: string;
  type: string;
  description: string;
  content: string;
  community_id: string | null;
  pagerank: number;
  ppr_score: number;
}

interface RecallEdge {
  from_name: string;
  to_name: string;
  type: string;
  instruction: string;
}

interface RecallResult {
  path: "precise" | "generalized" | "merged" | "empty";
  nodes: RecallNode[];
  edges: RecallEdge[];
}

export class MemUAdapter implements VaultMindAdapter {
  readonly name = "memu";
  readonly capabilities: readonly AdapterCapability[] = ["search", "embeddings"];

  private readonly dsn: string;
  private readonly userId: string;
  private readonly defaultMax: number;
  private readonly timeout: number;
  private readonly excludeMemoryTypes: readonly string[];
  private readonly pythonExe: string;
  private readonly memuGraphCwd: string;
  private readonly graphRecallTimeoutMs: number;
  private readonly memuSearchPy: string;
  private readonly memuSearchPythonExe: string;
  private readonly memuSearchTimeoutMs: number;
  private readonly embedModel: string;
  private pool: pg.Pool | null = null;
  private available = false;

  get isAvailable(): boolean { return this.available; }

  constructor(config: MemUAdapterConfig = {}) {
    const resolved = resolveMemUAdapterConfig(config, {});
    this.dsn = resolved.dsn;
    this.userId = resolved.userId;
    this.defaultMax = resolved.maxResults;
    this.timeout = resolved.timeout;
    this.excludeMemoryTypes = resolved.excludeMemoryTypes;
    this.pythonExe = resolved.pythonExe;
    this.memuGraphCwd = resolved.memuGraphCwd;
    this.graphRecallTimeoutMs = resolved.graphRecallTimeoutMs;
    this.memuSearchPy = resolved.memuSearchPy;
    this.memuSearchPythonExe = resolved.memuSearchPythonExe;
    this.memuSearchTimeoutMs = resolved.memuSearchTimeoutMs;
    this.embedModel = resolved.embedModel;
  }

  async init(): Promise<void> {
    try {
      this.pool = new Pool({
        connectionString: this.dsn,
        max: 2,
        connectionTimeoutMillis: 3_000,
        statement_timeout: this.timeout,
      });
      // Probe: confirm table + scope has data. Zero rows is a soft warning,
      // not a hard failure -- the DB might be fresh.
      const { rows } = await this.pool.query(
        "SELECT COUNT(*)::int AS n FROM memory_items WHERE user_id = $1",
        [this.userId],
      );
      const n = (rows[0]?.n as number) ?? 0;
      if (n === 0) {
        process.stderr.write(
          `obsidian-llm-wiki: [warn] memU PG reachable but 0 items for user_id=${this.userId}\n`,
        );
      }
      this.available = true;
    } catch (err) {
      const kind = err instanceof Error ? err.name : "Error";
      process.stderr.write(
        `obsidian-llm-wiki: [warn] memU PG unavailable (${kind}), adapter disabled\n`,
      );
      this.available = false;
      if (this.pool) {
        await this.pool.end().catch(() => {});
        this.pool = null;
      }
    }
  }

  async dispose(): Promise<void> {
    if (this.pool) {
      await this.pool.end().catch(() => {});
      this.pool = null;
    }
  }

  async search(query: string, opts?: SearchOpts): Promise<SearchResult[]> {
    if (!this.available || !this.pool) return [];
    const limit = Math.max(1, Math.min(opts?.maxResults ?? this.defaultMax, 100));
    const vec = await embedTextOllama(query, { model: this.embedModel });
    const queryVec = vec.length === 1024 ? vec : null;
    const result = await this.runGraphRecall(query, queryVec, limit);
    if (result) return this.mapRecallResult(result);
    // Fallback: pure-PG cosine via memu_search.py (bypasses pgvector, pg_trgm fallback)
    const pyResult = await this.runMemuSearchPy(query, queryVec, limit);
    return pyResult;
  }

  async searchByVector(
    vector: readonly number[],
    opts?: SearchOpts,
  ): Promise<SearchResult[]> {
    if (!this.available || !this.pool) return [];
    if (vector.length === 0) return [];
    if (vector.length === 1024) {
      const limit = Math.max(1, Math.min(opts?.maxResults ?? this.defaultMax, 100));
      const result = await this.runGraphRecall("", vector, limit);
      if (result) return this.mapRecallResult(result);
      const pyResult = await this.runMemuSearchPy("", vector, limit);
      return pyResult;
    }
    if (vector.length === 4096) return this.searchMemoryItemsByVector(vector, opts);
    return [];
  }

  /**
   * Vector search against memory_items (Qwen3-Embedding-8B, 4096-dim).
   * No local 4096-dim inference service is typically running, so this path
   * is rarely exercised. Kept for forward compatibility.
   */
  private async searchMemoryItemsByVector(
    vector: readonly number[],
    opts?: SearchOpts,
  ): Promise<SearchResult[]> {
    if (!this.pool) return [];
    const limit = Math.max(1, Math.min(opts?.maxResults ?? this.defaultMax, 100));
    const vecLiteral = `[${vector.join(",")}]`;
    const excludeArr =
      this.excludeMemoryTypes.length > 0 ? [...this.excludeMemoryTypes] : null;

    try {
      const { rows } = await this.pool.query<{
        id: string;
        summary: string;
        memory_type: string;
        user_id: string;
        created_at: Date;
        similarity: number;
      }>(
        `SELECT id, summary, memory_type, user_id, created_at,
                (1 - (embedding <=> $2::vector))::float8 AS similarity
         FROM memory_items
         WHERE user_id = $1 AND embedding IS NOT NULL
           AND ($4::text[] IS NULL OR memory_type <> ALL($4::text[]))
         ORDER BY embedding <=> $2::vector
         LIMIT $3`,
        [this.userId, vecLiteral, limit, excludeArr],
      );

      return rows.map((r) => ({
        source: this.name,
        path: `memu/${r.user_id}/${r.memory_type}/${r.id}`,
        content: String(r.summary ?? "").slice(0, 500),
        score: typeof r.similarity === "number" ? r.similarity : 0,
        metadata: {
          table: "memory_items",
          memory_type: r.memory_type,
          user_id: r.user_id,
          created_at:
            r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
          item_id: r.id,
          cosine_similarity: r.similarity,
        },
      }));
    } catch (err) {
      const kind = err instanceof Error ? err.name : "Error";
      process.stderr.write(
        `obsidian-llm-wiki: [error] memU PG vector query (memory_items) failed (${kind})\n`,
      );
      return [];
    }
  }

  /**
   * Spawn `python -m memu_graph.cli graph-recall` with the resolved DSN only in
   * the device-local child environment, write JSON request to stdin, and parse
   * JSON from stdout. Kill on timeout. Returns null on any error (silent fail +
   * stderr warn, mirrors adapter pattern).
   */
  private async runGraphRecall(
    query: string,
    queryVec: readonly number[] | null,
    maxNodes: number,
  ): Promise<RecallResult | null> {
    const request = {
      query,
      query_vec: queryVec && queryVec.length === 1024 ? Array.from(queryVec) : null,
      max_nodes: maxNodes,
    };

    return new Promise<RecallResult | null>((resolve) => {
      let stdout = "";
      let settled = false;

      const proc = spawn(
        this.pythonExe,
        ["-m", "memu_graph.cli", "graph-recall"],
        {
          cwd: this.memuGraphCwd,
          env: memuChildEnvironment(this.dsn),
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        proc.kill("SIGKILL");
        process.stderr.write(
          `obsidian-llm-wiki: [warn] memu_graph.cli timeout after ${this.graphRecallTimeoutMs}ms\n`,
        );
        resolve(null);
      }, this.graphRecallTimeoutMs);

      proc.stdout.on("data", (d) => { stdout += d.toString("utf-8"); });
      proc.stderr.on("data", () => { /* drain redacted subprocess diagnostics */ });

      proc.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        process.stderr.write(
          `obsidian-llm-wiki: [warn] memu_graph.cli spawn failed: ${redactResolvedDsn(err.message, this.dsn)}\n`,
        );
        resolve(null);
      });

      proc.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          process.stderr.write(
            `obsidian-llm-wiki: [warn] memu_graph.cli exit ${code}; stderr redacted\n`,
          );
          resolve(null);
          return;
        }
        if (this.dsn.length > 0 && stdout.includes(this.dsn)) {
          process.stderr.write(
            "obsidian-llm-wiki: [warn] memu_graph.cli stdout contained resolved DSN; output rejected\n",
          );
          resolve(null);
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as RecallResult;
          resolve(parsed);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          process.stderr.write(
            `obsidian-llm-wiki: [warn] memu_graph.cli stdout JSON parse failed: ${msg}\n`,
          );
          resolve(null);
        }
      });

      try {
        proc.stdin.end(JSON.stringify(request));
      } catch (e) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const msg = e instanceof Error ? e.message : String(e);
        process.stderr.write(
          `obsidian-llm-wiki: [warn] memu_graph.cli stdin write failed: ${redactResolvedDsn(msg, this.dsn)}\n`,
        );
        resolve(null);
      }
    });
  }

  /**
   * Fallback: spawn memu_search.py for pure-PG cosine search via Python-side
   * computation (bypasses pgvector on Windows). Used when memu_graph.cli is
   * unavailable or times out.
   */
  private async runMemuSearchPy(
    query: string,
    vec: readonly number[] | null,
    limit: number,
  ): Promise<SearchResult[]> {
    return new Promise<SearchResult[]>((resolve) => {
      let stdout = "";
      let settled = false;

      const args = [
        this.memuSearchPy,
        "--limit", String(limit),
      ];
      if (query) {
        args.push("--query", query);
        if (vec) args.push("--embed", JSON.stringify(Array.from(vec)));
      } else if (vec) {
        args.push("--embed", JSON.stringify(Array.from(vec)));
      } else {
        resolve([]);
        return;
      }

      const proc = spawn(this.memuSearchPythonExe, args, {
        cwd: this.memuGraphCwd,
        env: memuChildEnvironment(this.dsn),
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        proc.kill("SIGKILL");
        process.stderr.write(
          `obsidian-llm-wiki: [warn] memu_search.py timeout after ${this.memuSearchTimeoutMs}ms\n`,
        );
        resolve([]);
      }, this.memuSearchTimeoutMs);

      proc.stdout.on("data", (d) => { stdout += d.toString("utf-8"); });
      proc.stderr.on("data", () => { /* drain redacted subprocess diagnostics */ });

      proc.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        process.stderr.write(
          `obsidian-llm-wiki: [warn] memu_search.py spawn failed: ${redactResolvedDsn(err.message, this.dsn)}\n`,
        );
        resolve([]);
      });

      proc.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          process.stderr.write(
            `obsidian-llm-wiki: [warn] memu_search.py exit ${code}; stderr redacted\n`,
          );
          resolve([]);
          return;
        }
        if (this.dsn.length > 0 && stdout.includes(this.dsn)) {
          process.stderr.write(
            "obsidian-llm-wiki: [warn] memu_search.py stdout contained resolved DSN; output rejected\n",
          );
          resolve([]);
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as Array<{
            id?: string;
            summary?: string;
            memory_type?: string;
            happened_at?: string;
            extra?: Record<string, unknown>;
            score?: number;
          }>;
          resolve(this.mapMemuSearchPyResult(parsed));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          process.stderr.write(
            `obsidian-llm-wiki: [warn] memu_search.py stdout JSON parse failed: ${msg}\n`,
          );
          resolve([]);
        }
      });
    });
  }

  private mapMemuSearchPyResult(rows: Array<{
    id?: string;
    summary?: string;
    memory_type?: string;
    happened_at?: string;
    extra?: Record<string, unknown>;
    score?: number;
  }>): SearchResult[] {
    if (rows.length === 0) return [];
    const maxScore = Math.max(...rows.map((r) => r.score ?? 0), 1e-9);
    return rows.map((r) => ({
      source: this.name,
      path: `memu/item/${r.id ?? "?"}`,
      content: String(r.summary ?? "").slice(0, 500),
      score: (r.score ?? 0) / maxScore,
      metadata: {
        table: "memory_items",
        memory_type: r.memory_type ?? "note",
        item_id: r.id,
        happened_at: r.happened_at,
        extra: r.extra ?? {},
      },
    }));
  }

  /**
   * Convert a graph_recall RecallResult into the unified SearchResult shape.
   * Score: max-norm PPR to [0,1] for fusion compatibility; raw pagerank /
   * ppr_score / recall_path retained in metadata for downstream callers
   * that want to weight by community / path / centrality.
   */
  private mapRecallResult(result: RecallResult): SearchResult[] {
    if (result.nodes.length === 0) return [];
    const maxPpr = Math.max(...result.nodes.map((n) => n.ppr_score), 1e-9);
    return result.nodes.map((n) => {
      const desc = n.description ? n.description.slice(0, 400) : "";
      const namedTitle = `${n.name} (${n.type})`;
      return {
        source: this.name,
        path: `memu/graph/${n.type}/${n.id}`,
        content: desc ? `${namedTitle}: ${desc}` : namedTitle,
        score: n.ppr_score / maxPpr,
        metadata: {
          table: "gm_nodes",
          recall_path: result.path,
          type: n.type,
          name: n.name,
          community_id: n.community_id,
          pagerank: n.pagerank,
          ppr_score: n.ppr_score,
          item_id: n.id,
        },
      };
    });
  }
}
