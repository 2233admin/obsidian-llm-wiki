/**
 * adapter-gitnexus -- bridges to GitNexus knowledge graph via subprocess.
 *
 * GitNexus runs as a separate MCP server with Neo4j/graph backend.
 * This adapter calls `gitnexus query` CLI for code-level search results
 * and maps them into the unified SearchResult format.
 *
 * Default routes through stable-ops `gni` wrapper (drift / embedding /
 * dirty-worktree / impact-fallback safeguards) when present.
 *
 * Windows quirks:
 *   - `gni` and the npm `gitnexus` shim are extensionless bash scripts.
 *     Node's execFile/spawn cannot honor shebangs on Windows (CreateProcessW
 *     limitation), so we wrap with bash.exe.
 *   - `.cmd`/`.bat` files trigger EINVAL since Node 18.20.2 / 20.12.2 due to
 *     CVE-2024-27980. We deliberately avoid them and prefer bash-wrapping
 *     the bare script.
 *
 * Configuration override priority (highest first):
 *   1. constructor config.binary / config.bashExe
 *   2. env OBSIDIAN_LLM_WIKI_GITNEXUS_BIN / OBSIDIAN_LLM_WIKI_BASH_EXE
 *   3. probe common install locations
 *   4. PATH lookup ("gni" / "bash") -- works on Linux, may fail on Windows
 *
 * Gracefully returns [] when CLI is unavailable.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type {
  VaultMindAdapter,
  AdapterCapability,
  SearchResult,
  SearchOpts,
} from "./interface.js";

const isWin = process.platform === "win32";

function firstExisting(candidates: ReadonlyArray<string | undefined | null>): string | null {
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return null;
}

function resolveDefaultBinary(): string {
  const appdata = process.env.APPDATA ? process.env.APPDATA.replace(/\\/g, "/") : null;
  const userprofile = process.env.USERPROFILE ? process.env.USERPROFILE.replace(/\\/g, "/") : null;
  const found = firstExisting([
    process.env.OBSIDIAN_LLM_WIKI_GITNEXUS_BIN,
    "D:/projects/gitnexus-stable-ops/bin/gni",
    userprofile ? `${userprofile}/.local/bin/gni` : null,
    appdata ? `${appdata}/npm/gitnexus` : null,
  ]);
  return found ?? "gni";
}

/**
 * Resolve the underlying raw `gitnexus` CLI (not the gni wrapper). Cypher
 * search needs raw JSON output -- gni's `_run_cypher` strips the JSON envelope
 * and only echoes markdown, and gni's arg parsing breaks when `--repo` is
 * passed pre-resolved. read-only cypher does not benefit from gni's safety
 * wrappers (those are for analyze/reindex/impact write paths).
 */
function resolveDefaultRawBinary(): string {
  const appdata = process.env.APPDATA ? process.env.APPDATA.replace(/\\/g, "/") : null;
  const userprofile = process.env.USERPROFILE ? process.env.USERPROFILE.replace(/\\/g, "/") : null;
  const found = firstExisting([
    process.env.OBSIDIAN_LLM_WIKI_GITNEXUS_RAW_BIN,
    appdata ? `${appdata}/npm/gitnexus` : null,
    userprofile ? `${userprofile}/.local/bin/gitnexus` : null,
  ]);
  return found ?? "gitnexus";
}

function resolveBashExe(): string {
  const found = firstExisting([
    process.env.OBSIDIAN_LLM_WIKI_BASH_EXE,
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  ]);
  return found ?? "bash";
}

export interface GitNexusAdapterConfig {
  /** Absolute path to stable-ops gni wrapper (used for init / health check). Default probes stable-ops + npm globals. */
  binary?: string;
  /** Absolute path to raw gitnexus CLI (used for cypher search to get JSON envelope). Default probes npm globals. */
  rawBinary?: string;
  /** Absolute path to bash.exe (Windows only). Default probes Git Bash install. */
  bashExe?: string;
  /** Repository filter -- only search these repos */
  repos?: string[];
  /** Timeout in ms (default: 15000) */
  timeout?: number;
}

export class GitNexusAdapter implements VaultMindAdapter {
  readonly name = "gitnexus";
  readonly capabilities: readonly AdapterCapability[] = ["search"];

  private binary: string;
  private rawBinary: string;
  private readonly bashExe: string;
  private readonly repos: string[];
  private readonly timeout: number;
  private available = false;

  get isAvailable(): boolean { return this.available; }

  constructor(config?: GitNexusAdapterConfig) {
    this.binary = config?.binary ?? resolveDefaultBinary();
    this.rawBinary = config?.rawBinary ?? resolveDefaultRawBinary();
    this.bashExe = config?.bashExe ?? resolveBashExe();
    // Env fallback: OBSIDIAN_LLM_WIKI_GITNEXUS_REPOS is comma-separated repo
    // NAMES (not paths), matching `gni list` output. Empty/unset -> [] which
    // makes search() return [] until repos are configured.
    const envRepos = process.env.OBSIDIAN_LLM_WIKI_GITNEXUS_REPOS
      ? process.env.OBSIDIAN_LLM_WIKI_GITNEXUS_REPOS.split(",").map(s => s.trim()).filter(Boolean)
      : [];
    this.repos = config?.repos ?? envRepos;
    this.timeout = config?.timeout ?? 15_000;
  }

  private async run(binary: string, args: readonly string[], timeoutMs: number): Promise<{ stdout: string; code: number }> {
    return new Promise((resolve) => {
      const useBashWrap = isWin && !/\.exe$/i.test(binary);
      const cmd = useBashWrap ? this.bashExe : binary;
      const cmdArgs: string[] = useBashWrap ? [binary, ...args] : [...args];
      let stdout = "";
      let resolved = false;
      const settle = (code: number): void => {
        if (resolved) return;
        resolved = true;
        resolve({ stdout, code });
      };
      const childEnv: NodeJS.ProcessEnv = { ...process.env };
      if (!childEnv.GITNEXUS_BIN) {
        childEnv.GITNEXUS_BIN = this.rawBinary;
      }
      let p;
      try {
        p = spawn(cmd, cmdArgs, { env: childEnv });
      } catch {
        settle(-1);
        return;
      }
      const t = setTimeout(() => {
        try { p.kill("SIGKILL"); } catch { /* already dead */ }
        settle(-1);
      }, timeoutMs);
      p.stdout?.on("data", (d) => { stdout += d.toString(); });
      p.on("close", (code) => {
        clearTimeout(t);
        settle(code ?? -1);
      });
      p.on("error", () => {
        clearTimeout(t);
        settle(-1);
      });
    });
  }

  async init(): Promise<void> {
    const { code } = await this.run(this.binary, ["--version"], 5000);
    if (code === 0) {
      this.available = true;
      return;
    }
    process.stderr.write(
      `obsidian-llm-wiki: [warn] gitnexus CLI not runnable (binary=${this.binary}, bashWrap=${isWin}), adapter disabled\n`,
    );
  }

  async dispose(): Promise<void> {}

  async search(query: string, opts?: SearchOpts): Promise<SearchResult[]> {
    if (!this.available) return [];
    if (this.repos.length === 0) return [];  // no scope -> no search (caller must configure repos)
    const limit = opts?.maxResults ?? 20;
    const perRepoLimit = Math.max(1, Math.ceil(limit / this.repos.length));

    const all: SearchResult[] = [];
    for (const repo of this.repos) {
      const rows = await this.cypherSearch(repo, query, perRepoLimit);
      all.push(...rows);
      if (all.length >= limit) break;
    }
    return all.slice(0, limit);
  }

  /**
   * Run a Cypher query against `repo` to find nodes whose name / filePath /
   * description contain `query` (case-insensitive). Parses the markdown table
   * payload returned by `gitnexus cypher`.
   *
   * Output shape: {"markdown": "| col | col |\n| --- | --- |\n| v | v |", "row_count": N}
   * or {"error": "..."} on failure.
   */
  private async cypherSearch(repo: string, query: string, limit: number): Promise<SearchResult[]> {
    const escaped = query.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    // Note: `label(n)` returns the node label (Class, File, Function, ...).
    // Kuzu's `n._label` is a serialization-only synthetic field and cannot
    // be used in RETURN -- it triggers "Cannot find property _label for n".
    const cypher =
      "MATCH (n) " +
      `WHERE toLower(coalesce(n.name, '')) CONTAINS toLower('${escaped}') ` +
      `   OR toLower(coalesce(n.filePath, '')) CONTAINS toLower('${escaped}') ` +
      `   OR toLower(coalesce(n.description, '')) CONTAINS toLower('${escaped}') ` +
      "RETURN label(n) AS label, " +
      "       coalesce(n.name, '') AS name, " +
      "       coalesce(n.filePath, '') AS path, " +
      "       coalesce(n.description, '') AS description " +
      `LIMIT ${limit}`;

    // Use rawBinary (raw gitnexus) -- gni cypher strips JSON envelope and
    // mis-parses pre-passed --repo via _detect_repo. read-only cypher does
    // not need gni's safety wrappers.
    const { stdout, code } = await this.run(this.rawBinary, ["cypher", "--repo", repo, cypher], this.timeout);
    if (code !== 0 || !stdout.trim()) return [];

    let payload: { markdown?: string; error?: string };
    try {
      payload = JSON.parse(stdout.trim());
    } catch {
      return [];
    }
    if (payload.error || !payload.markdown) return [];

    return parseCypherMarkdownTable(payload.markdown).map((row) => {
      const [label, name, path, description] = row;
      const content = description
        ? `${name} (${label}): ${description}`.slice(0, 500)
        : `${name} (${label})`;
      return {
        source: this.name,
        path: path || `gitnexus://${repo}/${label}/${name}`,
        content,
        score: 0.6,
        metadata: { repo, label, name },
      };
    });
  }
}

/**
 * Parse a markdown table emitted by `gitnexus cypher` into rows of cell values.
 * Format:
 *   | col1 | col2 | col3 |
 *   | --- | --- | --- |
 *   | val1 | val2 | val3 |
 *   ...
 *
 * Cells with embedded `|` characters are not handled (rare in code symbol
 * names / file paths). Empty markdown / no-rows returns [].
 */
function parseCypherMarkdownTable(markdown: string): string[][] {
  const lines = markdown.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 3) return [];  // header + separator + at least one data row
  const rows: string[][] = [];
  // Skip first 2 lines (header + separator).
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("|") || !line.endsWith("|")) continue;
    // Strip leading/trailing | then split. Note: this loses empty leading/trailing cells, which is intentional.
    const inner = line.slice(1, -1);
    const cells = inner.split("|").map((c) => c.trim());
    rows.push(cells);
  }
  return rows;
}
