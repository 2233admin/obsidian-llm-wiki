/**
 * adapter-filesystem -- default adapter, zero external dependencies.
 * Uses Node.js fs + child_process (ripgrep/grep fallback) for search.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  VaultMindAdapter,
  AdapterCapability,
  SearchResult,
  SearchOpts,
} from "./interface.js";
import { normalizeSearchResult } from "../retrieval/evidence.js";

function expandGlobBraces(pattern: string): string[] {
  const start = pattern.indexOf("{");
  if (start === -1) return [pattern];
  const end = pattern.indexOf("}", start + 1);
  if (end === -1) return [pattern];
  const alternatives = pattern.slice(start + 1, end).split(",");
  return alternatives.flatMap((alternative) =>
    expandGlobBraces(`${pattern.slice(0, start)}${alternative}${pattern.slice(end + 1)}`));
}

function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      source += ".*";
      index += 1;
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += /[\\^$+?.()|[\]{}]/.test(character) ? `\\${character}` : character;
    }
  }
  return new RegExp(`^(?:${source})$`);
}

function matchesGlob(relativePath: string, glob: string | undefined): boolean {
  if (!glob) return true;
  const normalized = relativePath.replace(/\\/g, "/");
  return expandGlobBraces(glob.replace(/\\/g, "/")).some((pattern) => globToRegExp(pattern).test(normalized));
}

const exec = promisify(execFile);

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "does", "for", "from", "how", "i",
  "in", "is", "it", "me", "my", "of", "on", "or", "our", "should", "that", "the", "this", "to",
  "was", "we", "were", "what", "when", "where", "which", "who", "why", "will", "with", "you",
]);

/**
 * Splits a natural-language query into literal search terms: words minus
 * stopwords, and CJK runs as overlapping bigrams (they have no spaces).
 * Falls back to the whole query when nothing is left.
 */
export function queryTerms(query: string, caseSensitive = false): string[] {
  const text = caseSensitive ? query : query.toLowerCase();
  const terms = new Set<string>();
  for (const token of text.match(/\p{Script=Han}+|[^\s\p{P}\p{S}\p{Script=Han}]+/gu) ?? []) {
    if (/\p{Script=Han}/u.test(token)) {
      if (token.length === 1) terms.add(token);
      for (let index = 0; index + 1 < token.length; index += 1) terms.add(token.slice(index, index + 2));
    } else if (token.length > 1 && !STOPWORDS.has(token.toLowerCase())) {
      terms.add(token);
    }
  }
  return terms.size ? [...terms] : [query.trim()];
}

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
    const terms = queryTerms(query, opts?.caseSensitive);
    const args = [
      "--files-with-matches",
      "--fixed-strings", // treat terms literally, not regex (ReDoS protection)
    ];

    if (!opts?.caseSensitive) args.push("-i");
    if (opts?.glob) args.push("--glob", opts.glob);
    for (const term of terms) args.push("-e", term);

    const scopedSearch = Boolean(opts?.glob);
    args.push("--", scopedSearch ? "." : this.vaultPath); // "--" stops option parsing

    let files: string[];
    try {
      const { stdout } = await exec("rg", args, {
        maxBuffer: 2 * 1024 * 1024,
        ...(scopedSearch ? { cwd: this.vaultPath } : {}),
      });
      files = stdout.split(/\r?\n/).filter(Boolean)
        .map((file) => (isAbsolute(file) ? file : join(this.vaultPath, file)));
    } catch (err: unknown) {
      if (this.isExitCode(err, 1)) return []; // rg exit 1 = no matches
      files = await this.fallbackFiles(terms, opts);
    }
    return this.rankFiles(files, query, terms, opts);
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

  /** Scores each file by the share of query terms it contains; a literal match of the whole query scores 1. */
  private async rankFiles(files: string[], query: string, terms: string[], opts?: SearchOpts): Promise<SearchResult[]> {
    const fold = (text: string) => (opts?.caseSensitive ? text : text.toLowerCase());
    const phrase = fold(query.trim());
    const ranked: Array<{ result: SearchResult; score: number }> = [];
    for (const fullPath of files) {
      let content: string;
      try {
        content = await readFile(fullPath, "utf-8");
      } catch {
        continue; // File may have changed between search and read; skip stale matches.
      }
      const haystack = fold(content);
      const matched = terms.filter((term) => haystack.includes(term));
      if (!matched.length) continue;
      const score = haystack.includes(phrase) ? 1 : matched.length / terms.length;
      ranked.push({
        score,
        result: normalizeSearchResult({
          source: this.name,
          path: relative(this.vaultPath, fullPath).replace(/\\/g, "/"),
          content: this.extractSnippet(content, [phrase, ...matched], opts),
          score,
        }, this.name),
      });
    }
    return ranked
      .sort((left, right) => right.score - left.score || left.result.path.localeCompare(right.result.path))
      .slice(0, opts?.maxResults ?? 20)
      .map((item) => item.result);
  }

  private extractSnippet(content: string, needles: string[], opts?: SearchOpts): string {
    const context = Math.max(0, opts?.context ?? 0);
    const lines = content.split(/\r?\n/);

    for (const needle of needles) for (let i = 0; i < lines.length; i++) {
      const haystack = opts?.caseSensitive ? lines[i] : lines[i].toLowerCase();
      if (haystack.includes(needle)) {
        const start = Math.max(0, i - context);
        const end = Math.min(lines.length, i + context + 1);
        return lines.slice(start, end).join("\n").trim();
      }
    }

    return lines.find((line) => line.trim())?.trim() ?? "";
  }

  private async fallbackFiles(terms: string[], opts?: SearchOpts): Promise<string[]> {
    const args = ["-r", "-l", "-F"];
    if (!opts?.caseSensitive) args.push("-i");
    for (const term of terms) args.push("-e", term);
    args.push("--", this.vaultPath);

    try {
      const { stdout } = await exec("grep", args, { maxBuffer: 5 * 1024 * 1024 });
      return stdout.split(/\r?\n/).filter(Boolean)
        .map((file) => (isAbsolute(file) ? file : resolve(file)))
        .filter((fullPath) => {
          const relPath = relative(this.vaultPath, fullPath);
          return !relPath.startsWith("..") && !isAbsolute(relPath) && matchesGlob(relPath, opts?.glob);
        });
    } catch (err: unknown) {
      if (this.isExitCode(err, 1)) return []; // grep exit 1 = no matches
      throw new Error("Search failed: neither ripgrep nor grep available");
    }
  }

  private isExitCode(err: unknown, code: number): boolean {
    return !!err && typeof err === "object" && "code" in err && (err as { code: number }).code === code;
  }
}
