/**
 * GraphifyAdapter -- bridges to graphify knowledge graph via subprocess.
 *
 * graphify (PyPI: graphifyy) converts project content -- code, docs, PDFs,
 * images, video -- into a queryable knowledge graph stored as graph.json.
 * This adapter supports three capabilities:
 *
 *   search -- run `graphify query` and return the BFS/DFS traversal text
 *   graph  -- read graph.json and collapse symbol-level nodes to file-level
 *   read   -- look up all symbols in a given source file
 *
 * Prerequisites (optional dependency, adapter degrades gracefully if absent):
 *   uv tool install graphifyy
 *   graphify extract /path/to/vault
 *
 * Config:
 *   binary      -- path to graphify CLI (default: "graphify")
 *   vaultPath   -- project root to scan (default: process.cwd())
 *   outputDir   -- dir containing graph.json (default: <vaultPath>/graphify-out)
 *   timeout     -- subprocess timeout ms (default: 30000)
 *   autoRescan  -- run `graphify update` before graph() returns (default: false)
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join, basename } from "node:path";
import type {
  VaultMindAdapter,
  AdapterCapability,
  SearchResult,
  SearchOpts,
  GraphData,
  GraphNode,
  GraphEdge,
} from "./interface.js";

const exec = promisify(execFile);

/** On Windows, .cmd/.bat wrappers need shell:true to run via execFile. */
function shellOpt(binary: string): { shell?: boolean } {
  return /\.(cmd|bat)$/i.test(binary) ? { shell: true } : {};
}

export interface GraphifyAdapterConfig {
  /** Path to graphify CLI binary (default: "graphify") */
  binary?: string;
  /** Project root to scan (default: process.cwd()) */
  vaultPath?: string;
  /** Directory containing graphify-out/graph.json (default: <vaultPath>/graphify-out) */
  outputDir?: string;
  /** Subprocess timeout in ms (default: 30000) */
  timeout?: number;
  /** Run `graphify update <vaultPath>` before returning graph() results (default: false) */
  autoRescan?: boolean;
}

// Internal shapes matching graphify's graph.json schema (see validate.py)
interface RawNode {
  id: string;
  label: string;
  file_type: string;
  source_file: string;
  [key: string]: unknown;
}

interface RawEdge {
  source: string;
  target: string;
  relation: string;
  confidence: string;
  source_file: string;
  [key: string]: unknown;
}

interface RawGraph {
  nodes: RawNode[];
  edges?: RawEdge[];
  links?: RawEdge[]; // NetworkX <= 3.1 alias
}

// Relations that represent intra-structural hierarchy -> vault-mind "tag"
const TAG_RELATIONS = new Set(["contains", "method"]);

export class GraphifyAdapter implements VaultMindAdapter {
  readonly name = "graphify";
  readonly capabilities: readonly AdapterCapability[] = ["search", "graph", "read"];

  private readonly binary: string;
  private readonly vaultPath: string;
  private readonly graphPath: string;
  private readonly timeout: number;
  private readonly autoRescan: boolean;
  private available = false;

  get isAvailable(): boolean {
    return this.available;
  }

  constructor(config?: GraphifyAdapterConfig) {
    this.binary = config?.binary ?? "graphify";
    this.vaultPath = config?.vaultPath ?? process.cwd();
    const outputDir = config?.outputDir ?? join(this.vaultPath, "graphify-out");
    this.graphPath = join(outputDir, "graph.json");
    this.timeout = config?.timeout ?? 30_000;
    this.autoRescan = config?.autoRescan ?? false;
  }

  async init(): Promise<void> {
    try {
      await exec(this.binary, ["--version"], { timeout: 5_000, ...shellOpt(this.binary) });
      this.available = true;
    } catch {
      process.stderr.write(
        "vault-mind: [warn] graphify CLI not found -- adapter disabled (install: uv tool install graphifyy)\n",
      );
    }
  }

  async dispose(): Promise<void> {}

  async search(query: string, opts?: SearchOpts): Promise<SearchResult[]> {
    if (!this.available) return [];
    const budget = (opts?.maxResults ?? 20) * 100;
    const args = ["query", query, "--graph", this.graphPath, "--budget", String(budget)];
    try {
      const { stdout } = await exec(this.binary, args, {
        timeout: this.timeout,
        maxBuffer: 10 * 1024 * 1024,
        cwd: this.vaultPath,
        ...shellOpt(this.binary),
      });
      const text = stdout.trim();
      if (!text) return [];
      return [
        {
          source: this.name,
          path: this.graphPath,
          content: text.slice(0, 4_000),
          score: 1.0,
          metadata: { query },
        },
      ];
    } catch {
      return [];
    }
  }

  async graph(): Promise<GraphData> {
    if (!this.available) return { nodes: [], edges: [] };

    if (this.autoRescan) {
      try {
        await exec(this.binary, ["update", this.vaultPath], {
          timeout: this.timeout * 3,
          cwd: this.vaultPath,
          ...shellOpt(this.binary),
        });
      } catch {
        // non-fatal: proceed with existing graph.json
      }
    }

    const raw = await this.readGraphJson();
    if (!raw) return { nodes: [], edges: [] };

    const rawNodes: RawNode[] = Array.isArray(raw.nodes) ? raw.nodes : [];
    const rawEdges: RawEdge[] = Array.isArray(raw.edges)
      ? raw.edges
      : Array.isArray(raw.links)
        ? raw.links
        : [];

    // Build id -> source_file lookup for edge resolution
    const idToFile = new Map<string, string>();
    for (const n of rawNodes) {
      if (n.id && n.source_file) idToFile.set(n.id, n.source_file);
    }

    // Collapse to file-level nodes (unique source_file values)
    const fileSet = new Set<string>();
    for (const n of rawNodes) {
      if (n.source_file) fileSet.add(n.source_file);
    }
    const nodes: GraphNode[] = [...fileSet].map((path) => ({
      path,
      title: basename(path),
    }));

    // Build file-level edges, skip same-file, dedup by (from, to, type)
    const edgeSet = new Set<string>();
    const edges: GraphEdge[] = [];

    for (const e of rawEdges) {
      const fromFile = idToFile.get(e.source);
      const toFile = idToFile.get(e.target);
      if (!fromFile || !toFile || fromFile === toFile) continue;

      const type: GraphEdge["type"] = TAG_RELATIONS.has(e.relation) ? "tag" : "link";
      const key = `${fromFile}\0${toFile}\0${type}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({ from: fromFile, to: toFile, type });
      }
    }

    return { nodes, edges };
  }

  async read(path: string): Promise<string> {
    if (!this.available) return "";

    const raw = await this.readGraphJson();
    if (!raw) return "";

    const rawNodes: RawNode[] = Array.isArray(raw.nodes) ? raw.nodes : [];
    const matched = rawNodes.filter(
      (n) => n.source_file === path || n.source_file.endsWith(path),
    );
    if (matched.length === 0) return "";

    return matched.map((n) => `[${n.file_type}] ${n.label}`).join("\n");
  }

  private async readGraphJson(): Promise<RawGraph | null> {
    try {
      const json = await readFile(this.graphPath, "utf-8");
      return JSON.parse(json) as RawGraph;
    } catch {
      return null;
    }
  }
}
