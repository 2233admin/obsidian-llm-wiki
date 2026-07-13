/**
 * QmdAdapter -- optional search adapter backed by tobi/qmd.
 *
 * tobi/qmd is an on-device BM25 + vector hybrid search tool recommended
 * by Karpathy in his LLM Wiki gist. This adapter spawns `qmd query`
 * as a subprocess, parses --json output, and maps results into the
 * VaultMindAdapter SearchResult shape.
 *
 * Prerequisites (contributor-responsibility, not a hard dep):
 *   1. Install qmd:   npm install -g @tobilu/qmd
 *   2. Add a collection that covers your vault:
 *      qmd collection add /path/to/vault --name vault --mask "**\/*.md"
 *   3. Index + embed:  qmd update && qmd embed
 *
 * If the qmd CLI is not on PATH, init() sets isAvailable=false and
 * search() returns [] -- the rest of the system degrades gracefully.
 */

import { spawn } from "node:child_process";
import type {
  VaultMindAdapter,
  AdapterCapability,
  SearchResult,
  SearchOpts,
} from "./interface.js";

interface QmdHit {
  docid: string;
  score: number;
  file: string;
  line?: number;
  title?: string;
  context?: string;
  snippet?: string;
  body?: string;
}

export interface QmdAdapterOpts {
  /** Restrict queries to a single qmd collection (default: all). */
  collection?: string;
  /** Override the qmd binary path (default: "qmd" on PATH). */
  binary?: string;
  /** Arguments to prepend before subcommand args -- useful for wrappers
   *  like `bun x @tobilu/qmd` or for tests that drive node as the binary. */
  binaryArgs?: string[];
  /** Min score threshold 0-1 (default: no filter). */
  minScore?: number;
}

export class QmdAdapter implements VaultMindAdapter {
  readonly name = "qmd";
  readonly capabilities: readonly AdapterCapability[] = ["search"];

  private _available = false;
  private readonly collection?: string;
  private readonly binary: string;
  private readonly binaryArgs: readonly string[];
  private readonly minScore?: number;

  constructor(opts?: QmdAdapterOpts) {
    this.collection = opts?.collection;
    this.binary = opts?.binary ?? "qmd";
    this.binaryArgs = opts?.binaryArgs ?? [];
    this.minScore = opts?.minScore;
  }

  get isAvailable(): boolean {
    return this._available;
  }

  async init(): Promise<void> {
    try {
      const { code } = await this.runQmd(["--version"]);
      this._available = code === 0;
    } catch {
      this._available = false;
    }
    if (!this._available) {
      process.stderr.write(
        "llmwiki: [qmd] CLI not available on PATH -- adapter disabled\n",
      );
    }
  }

  async search(query: string, opts?: SearchOpts): Promise<SearchResult[]> {
    if (!this._available) return [];
    const limit = opts?.maxResults ?? 20;
    const args = ["query", query, "--json", "-n", String(limit)];
    if (this.collection) args.push("-c", this.collection);
    if (this.minScore != null) args.push("--min-score", String(this.minScore));

    const { stdout, code } = await this.runQmd(args);
    if (code !== 0) return [];

    let hits: QmdHit[];
    try {
      hits = JSON.parse(stdout) as QmdHit[];
    } catch {
      return [];
    }
    if (!Array.isArray(hits)) return [];

    return hits.map<SearchResult>((h) => ({
      source: "qmd",
      path: h.file,
      content: h.snippet ?? h.body ?? h.title ?? "",
      score: typeof h.score === "number" ? h.score : 0,
      metadata: {
        docid: h.docid,
        line: h.line,
        title: h.title,
        context: h.context,
      },
    }));
  }

  async dispose(): Promise<void> {
    // subprocess adapter -- nothing to clean up
  }

  private runQmd(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve) => {
      let proc;
      try {
        proc = spawn(this.binary, [...this.binaryArgs, ...args], { stdio: ["ignore", "pipe", "pipe"] });
      } catch {
        resolve({ stdout: "", stderr: "spawn failed synchronously", code: -1 });
        return;
      }
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d: Buffer) => {
        stdout += d.toString("utf-8");
      });
      proc.stderr.on("data", (d: Buffer) => {
        stderr += d.toString("utf-8");
      });
      proc.on("error", () => {
        resolve({ stdout, stderr: stderr || "spawn error", code: -1 });
      });
      proc.on("close", (code) => {
        resolve({ stdout, stderr, code: code ?? -1 });
      });
    });
  }
}
