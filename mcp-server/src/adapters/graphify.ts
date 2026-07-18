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
import {
  basename,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import type {
  VaultMindAdapter,
  AdapterCapability,
  SearchResult,
  SearchOpts,
  GraphData,
  GraphNode,
  GraphEdge,
  GraphEdgeConfidence,
  GraphEdgeEvidence,
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

// Relations that represent intra-structural hierarchy -> LLM Wiki "tag"
const TAG_RELATIONS = new Set(["contains", "method"]);

function normalizeConfidence(confidence: string): GraphEdgeConfidence {
  const normalized = confidence.trim().toLowerCase();
  if (
    normalized === "extracted" ||
    normalized === "inferred" ||
    normalized === "ambiguous"
  ) {
    return normalized;
  }
  return "unknown";
}

function sameEvidence(
  left: GraphEdgeEvidence,
  right: GraphEdgeEvidence,
): boolean {
  return (
    left.adapter === right.adapter &&
    left.relation === right.relation &&
    left.confidence === right.confidence &&
    left.sourcePath === right.sourcePath
  );
}

export class GraphifyAdapter implements VaultMindAdapter {
  readonly name = "graphify";
  readonly capabilities: readonly AdapterCapability[] = ["search", "graph", "read"];

  private readonly binary: string;
  private readonly vaultPath: string;
  private readonly graphPath: string;
  private readonly timeout: number;
  private readonly autoRescan: boolean;
  private available = false;
  private cliAvailable = false;

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
      this.cliAvailable = true;
      this.available = true;
    } catch {
      const cachedGraph = await this.readGraphJson();
      if (cachedGraph) {
        this.available = true;
        process.stderr.write(
          "llmwiki: [warn] graphify CLI not found -- cached graph remains read-only; search and rescan disabled\n",
        );
      } else {
        process.stderr.write(
          "llmwiki: [warn] graphify CLI not found -- adapter disabled (install: uv tool install graphifyy)\n",
        );
      }
    }
  }

  async dispose(): Promise<void> {}

  async search(query: string, opts?: SearchOpts): Promise<SearchResult[]> {
    if (!this.cliAvailable) return [];
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
          path: "graphify-out/graph.json",
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

    if (this.autoRescan && this.cliAvailable) {
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
      const sourcePath = this.portableSourcePath(n.source_file);
      if (n.id && sourcePath) idToFile.set(n.id, sourcePath);
    }

    // Collapse to file-level nodes (unique source_file values)
    const fileSet = new Set<string>();
    for (const n of rawNodes) {
      const sourcePath = this.portableSourcePath(n.source_file);
      if (sourcePath) fileSet.add(sourcePath);
    }
    const nodes: GraphNode[] = [...fileSet].map((path) => ({
      path,
      title: basename(path),
    }));

    // Build file-level edges, skip same-file, and aggregate distinct evidence.
    const edgeMap = new Map<string, GraphEdge>();

    for (const e of rawEdges) {
      const fromFile = idToFile.get(e.source);
      const toFile = idToFile.get(e.target);
      if (!fromFile || !toFile || fromFile === toFile) continue;

      const type: GraphEdge["type"] = TAG_RELATIONS.has(e.relation) ? "tag" : "link";
      const key = `${fromFile}\0${toFile}\0${type}`;
      const evidenceSourcePath = this.portableSourcePath(e.source_file);
      const evidence: GraphEdgeEvidence = {
        adapter: this.name,
        relation: e.relation,
        confidence: normalizeConfidence(e.confidence),
        ...(evidenceSourcePath ? { sourcePath: evidenceSourcePath } : {}),
      };
      const existing = edgeMap.get(key);
      if (existing) {
        const existingEvidence = existing.evidence ?? [];
        if (!existingEvidence.some((item) => sameEvidence(item, evidence))) {
          existingEvidence.push(evidence);
          existing.evidence = existingEvidence;
        }
      } else {
        edgeMap.set(key, {
          from: fromFile,
          to: toFile,
          type,
          evidence: [evidence],
        });
      }
    }

    return { nodes, edges: [...edgeMap.values()] };
  }

  private portableSourcePath(value: string): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    if (!trimmed || /[\0\r\n]/.test(trimmed)) return undefined;
    if (isAbsolute(trimmed) || /^[A-Za-z]:[\\/]/.test(trimmed)) {
      const candidate = relative(resolve(this.vaultPath), resolve(trimmed)).replace(/\\/g, "/");
      if (!candidate || candidate.startsWith("../") || candidate === ".." || isAbsolute(candidate)) {
        return undefined;
      }
      return candidate;
    }
    const normalized = trimmed.replace(/\\/g, "/").replace(/^\.\/+/, "");
    if (
      !normalized
      || normalized.startsWith("/")
      || normalized.split("/").some((part) => part === "" || part === "." || part === "..")
    ) {
      return undefined;
    }
    return normalized;
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
