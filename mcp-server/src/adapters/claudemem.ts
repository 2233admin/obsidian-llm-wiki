/**
 * adapter-claudemem -- reads Claude Code's persisted memory markdown files.
 *
 * Claude Code stores Curry's long-form persisted memory under
 *   ~/.claude/projects/C--Users-Administrator/memory/
 * (override via env CLAUDE_MEMORY_DIR). Each *.md file carries optional
 * YAML frontmatter (---name/description/type/recall_role/workset---) plus
 * a markdown body.
 *
 * Walks the directory recursively (Node 18.17+ readdirSync recursive). The
 * `_inbox/` (raw observations awaiting promotion) and `_meta/` (decision
 * logs) subtrees are excluded by user rule (raw-material-quarantine +
 * decision-log-on-reject). All other subdirectories (claude-config,
 * codex-config, cli-reference, ai-personas, etc.) are walked and indexed.
 *
 * Search path: filename + frontmatter.description + body via case-insensitive
 * substring count. Everything cached in memory at init.
 *
 * Gracefully returns [] if the directory doesn't exist.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import type {
  VaultMindAdapter,
  AdapterCapability,
  SearchResult,
  SearchOpts,
} from "./interface.js";

export interface ClaudeMemAdapterConfig {
  /** Absolute path to the memory directory
   *  (default: env CLAUDE_MEMORY_DIR or
   *  ~/.claude/projects/C--Users-Administrator/memory) */
  dir?: string;
  /** Maximum results per query (default: 20) */
  maxResults?: number;
}

const DEFAULT_DIR = join(
  homedir(),
  ".claude",
  "projects",
  "C--Users-Administrator",
  "memory",
);

interface CachedFile {
  path: string;       // absolute path
  filename: string;   // basename without extension
  description: string;
  name: string;
  type: string;
  recall_role: string;
  workset: string;
  body: string;
  haystack: string;   // lower-cased filename + description + body
}

/**
 * Minimal flat-key frontmatter parser. Only recognises 5 keys; ignores
 * nested structures, multiline values, anchors. Anything weirder than
 * `key: value` falls through and the line is skipped.
 */
function parseFrontmatter(raw: string): {
  fm: Pick<CachedFile, "name" | "description" | "type" | "recall_role" | "workset">;
  body: string;
} {
  const empty = { name: "", description: "", type: "", recall_role: "", workset: "" };
  if (!raw.startsWith("---")) return { fm: empty, body: raw };
  // Split on first occurrence of \n
  const afterFirst = raw.indexOf("\n");
  if (afterFirst < 0) return { fm: empty, body: raw };
  const rest = raw.slice(afterFirst + 1);
  const closeIdx = rest.indexOf("\n---");
  if (closeIdx < 0) return { fm: empty, body: raw };
  const fmBlock = rest.slice(0, closeIdx);
  const body = rest.slice(closeIdx + 4).replace(/^\r?\n/, "");
  const fm = { ...empty };
  for (const line of fmBlock.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key === "name") fm.name = val;
    else if (key === "description") fm.description = val;
    else if (key === "type") fm.type = val;
    else if (key === "recall_role") fm.recall_role = val;
    else if (key === "workset") fm.workset = val;
  }
  return { fm, body };
}

export class ClaudeMemAdapter implements VaultMindAdapter {
  readonly name = "claudemem";
  readonly capabilities: readonly AdapterCapability[] = ["search"];

  private readonly dir: string;
  private readonly defaultMax: number;
  private files: CachedFile[] = [];
  private available = false;

  get isAvailable(): boolean { return this.available; }

  constructor(config?: ClaudeMemAdapterConfig) {
    this.dir = config?.dir ?? process.env.CLAUDE_MEMORY_DIR ?? DEFAULT_DIR;
    this.defaultMax = config?.maxResults ?? 20;
  }

  async init(): Promise<void> {
    try {
      if (!existsSync(this.dir)) {
        process.stderr.write(
          `obsidian-llm-wiki: [warn] claudemem dir not found at ${this.dir}, adapter disabled\n`,
        );
        this.available = false;
        return;
      }
      // Recursive walk. Node 18.17+ readdirSync supports `recursive: true` +
      // `withFileTypes: true`. Each Dirent.parentPath gives the directory it
      // was found in, so we reconstruct the absolute path explicitly.
      const entries = readdirSync(this.dir, {
        recursive: true,
        withFileTypes: true,
      });
      const cached: CachedFile[] = [];
      let skipped = 0;
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith(".md")) continue;
        const parent = (entry as unknown as { parentPath?: string; path?: string }).parentPath
          ?? (entry as unknown as { path?: string }).path
          ?? this.dir;
        const full = join(parent, entry.name);
        const rel = relative(this.dir, full);
        // Exclude _inbox/ and _meta/ subtrees per user rule.
        // Match path-prefix on the relative path's first segment so any
        // depth under those roots is excluded.
        const firstSeg = rel.split(sep)[0];
        if (firstSeg === "_inbox" || firstSeg === "_meta") {
          skipped++;
          continue;
        }
        let raw: string;
        try { raw = readFileSync(full, "utf-8"); } catch { continue; }
        const { fm, body } = parseFrontmatter(raw);
        const filename = entry.name.replace(/\.md$/i, "");
        cached.push({
          path: full,
          filename,
          description: fm.description,
          name: fm.name,
          type: fm.type,
          recall_role: fm.recall_role,
          workset: fm.workset,
          body,
          haystack: (filename + "\n" + fm.description + "\n" + body).toLowerCase(),
        });
      }
      this.files = cached;
      if (cached.length === 0) {
        process.stderr.write(
          `obsidian-llm-wiki: [warn] claudemem dir reachable but 0 .md files\n`,
        );
      } else {
        process.stderr.write(
          `obsidian-llm-wiki: [info] claudemem indexed ${cached.length} .md files (skipped ${skipped} in _inbox/_meta)\n`,
        );
      }
      this.available = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `obsidian-llm-wiki: [warn] claudemem unavailable (${msg}), adapter disabled\n`,
      );
      this.available = false;
      this.files = [];
    }
  }

  async dispose(): Promise<void> {
    this.files = [];
  }

  async search(query: string, opts?: SearchOpts): Promise<SearchResult[]> {
    if (!this.available || this.files.length === 0) return [];
    const limit = Math.max(1, Math.min(opts?.maxResults ?? this.defaultMax, 100));
    const q = query.toLowerCase().trim();
    if (q.length === 0) return [];

    const scored: Array<{ file: CachedFile; count: number }> = [];
    for (const f of this.files) {
      let count = 0;
      let pos = 0;
      while (true) {
        const idx = f.haystack.indexOf(q, pos);
        if (idx < 0) break;
        count++;
        pos = idx + q.length;
        if (count >= 100) break;  // sanity cap
      }
      if (count > 0) scored.push({ file: f, count });
    }

    scored.sort((a, b) => b.count - a.count);
    const top = scored.slice(0, limit);

    return top.map(({ file, count }) => {
      // Snippet: 50 chars before + 50 after the first match in body, falling
      // back to description if the match was in filename/description only.
      const bodyLower = file.body.toLowerCase();
      const bodyIdx = bodyLower.indexOf(q);
      let snippet: string;
      if (bodyIdx >= 0) {
        const start = Math.max(0, bodyIdx - 50);
        const end = Math.min(file.body.length, bodyIdx + q.length + 50);
        snippet = file.body.slice(start, end).replace(/\s+/g, " ").trim();
      } else {
        snippet = file.description.slice(0, 200);
      }
      const desc = file.description || file.filename;
      return {
        source: this.name,
        path: file.path,
        content: `${desc}: ${snippet}`,
        score: Math.min(1, count / 10),
        metadata: {
          name: file.name,
          type: file.type,
          recall_role: file.recall_role,
          workset: file.workset,
          match_count: count,
        },
      };
    });
  }
}
