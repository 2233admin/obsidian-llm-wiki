/**
 * adapter-filesystem -- default adapter, zero external dependencies.
 * Uses Node.js fs + child_process (ripgrep/grep fallback) for search.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, relative, sep } from "node:path";
import type {
  VaultMindAdapter,
  AdapterCapability,
  SearchResult,
  SearchOpts,
} from "./interface.js";

const exec = promisify(execFile);

export class FilesystemAdapter implements VaultMindAdapter {
  readonly name = "filesystem";
  readonly capabilities: readonly AdapterCapability[] = ["search", "read", "write"];

  private readonly basePath: string;

  constructor(private vaultPath: string) {
    // Normalize base path with trailing separator for safe prefix comparison
    this.basePath = vaultPath.endsWith(sep) ? vaultPath : vaultPath + sep;
  }

  async init(): Promise<void> {
    // No setup needed -- vault path validated at config load time
  }

  async dispose(): Promise<void> {
    // Nothing to clean up
  }

  async search(query: string, opts?: SearchOpts): Promise<SearchResult[]> {
    const maxResults = opts?.maxResults ?? 20;
    const args = [
      "--files-with-matches",
      "--fixed-strings", // treat query literal, not regex (ReDoS protection)
      "--max-count", "1", // stop after the first match in each file
    ];

    if (!opts?.caseSensitive) args.push("-i");
    if (opts?.glob) args.push("--glob", opts.glob);

    args.push("--", query, this.vaultPath); // "--" stops option parsing

    try {
      const { stdout } = await exec("rg", args, { maxBuffer: 2 * 1024 * 1024 });
      const files = stdout.split(/\r?\n/).filter(Boolean).slice(0, maxResults);
      const results: SearchResult[] = [];

      for (const file of files) {
        try {
          const content = await readFile(file, "utf-8");
          results.push({
            source: this.name,
            path: relative(this.vaultPath, file).replace(/\\/g, "/"),
            content: this.extractSnippet(content, query, opts),
            score: 1.0,
          });
        } catch {
          // File may have changed between rg and read; skip stale matches.
        }
      }

      return results;
    } catch (err: unknown) {
      if (this.isExitCode(err, 1)) return []; // rg exit 1 = no matches
      return this.fallbackSearch(query, opts);
    }
  }

  async read(path: string): Promise<string> {
    const fullPath = this.resolvePath(path);
    return readFile(fullPath, "utf-8");
  }

  async write(path: string, content: string, dryRun = false): Promise<void> {
    const fullPath = this.resolvePath(path);
    if (dryRun) return;  // validation passed, skip actual write
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf-8");
  }

  // --- Internal ---

  private resolvePath(p: string): string {
    const resolved = join(this.vaultPath, p);
    // Prefix-safe traversal check: compare against base path with trailing separator
    if (resolved !== this.vaultPath && !resolved.startsWith(this.basePath)) {
      throw new Error(`Path traversal blocked: ${p}`);
    }
    return resolved;
  }

  private extractSnippet(content: string, query: string, opts?: SearchOpts): string {
    const context = Math.max(0, opts?.context ?? 0);
    const needle = opts?.caseSensitive ? query : query.toLowerCase();
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const haystack = opts?.caseSensitive ? lines[i] : lines[i].toLowerCase();
      if (haystack.includes(needle)) {
        const start = Math.max(0, i - context);
        const end = Math.min(lines.length, i + context + 1);
        return lines.slice(start, end).join("\n").trim();
      }
    }

    return lines.find((line) => line.trim())?.trim() ?? "";
  }

  private parseRipgrepJson(stdout: string): SearchResult[] {
    const results: SearchResult[] = [];
    for (const line of stdout.split("\n").filter(Boolean)) {
      try {
        const msg = JSON.parse(line);
        if (msg.type === "match") {
          const path = relative(this.vaultPath, msg.data.path.text).replace(/\\/g, "/");
          results.push({
            source: this.name,
            path,
            content: msg.data.lines.text.trim(),
            score: 1.0, // ripgrep doesn't rank -- all matches equal
          });
        }
      } catch {
        // Skip malformed JSON lines
      }
    }
    return results;
  }

  private async fallbackSearch(query: string, opts?: SearchOpts): Promise<SearchResult[]> {
    const args = ["-r", "-l", "-F"];
    if (!opts?.caseSensitive) args.push("-i");
    args.push("--", query, this.vaultPath);

    try {
      const { stdout } = await exec("grep", args, { maxBuffer: 5 * 1024 * 1024 });
      const files = stdout.split(/\r?\n/).filter(Boolean).slice(0, opts?.maxResults ?? 20);
      const results: SearchResult[] = [];

      for (const file of files) {
        try {
          const content = await readFile(file, "utf-8");
          results.push({
            source: this.name,
            path: relative(this.vaultPath, file).replace(/\\/g, "/"),
            content: this.extractSnippet(content, query, opts),
            score: 1.0,
          });
        } catch {
          // File may have changed between grep and read; skip stale matches.
        }
      }

      return results;
    } catch (err: unknown) {
      if (this.isExitCode(err, 1)) return []; // grep exit 1 = no matches
      throw new Error("Search failed: neither ripgrep nor grep available");
    }
  }

  private isExitCode(err: unknown, code: number): boolean {
    return !!err && typeof err === "object" && "code" in err && (err as { code: number }).code === code;
  }
}
