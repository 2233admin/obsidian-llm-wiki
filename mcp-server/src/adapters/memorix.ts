/**
 * adapter-memorix -- reads memorix's local SQLite store directly.
 *
 * memorix (npm @AVIDS2/memorix) is an MCP server with its own stdio
 * lifecycle. Instead of MCP-to-MCP nesting (a relay client inside another
 * MCP server), this adapter opens memorix's persisted SQLite file
 * (~/.memorix/data/memorix.db) read-only and serves text search over the
 * `observations` table -- memorix's primary memory record.
 *
 * Schema (observations): id, entityName, type, title, narrative, facts,
 * concepts, projectId, sessionId, topicKey, valueCategory, status,
 * createdAt, ...
 *
 * Search path: title + narrative + concepts via SQL LIKE. Status='active'
 * filter excludes archived observations.
 *
 * Gracefully returns [] if the DB doesn't exist or query fails.
 *
 * Requires Node >= 22 for built-in `node:sqlite` (zero npm deps).
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  VaultMindAdapter,
  AdapterCapability,
  SearchResult,
  SearchOpts,
} from "./interface.js";

export interface MemorixAdapterConfig {
  /** Absolute path to memorix.db
   *  (default: env MEMORIX_DB or ~/.memorix/data/memorix.db) */
  dbPath?: string;
  /** Maximum results per query (default: 20) */
  maxResults?: number;
}

const DEFAULT_DB = join(homedir(), ".memorix", "data", "memorix.db");

export class MemorixAdapter implements VaultMindAdapter {
  readonly name = "memorix";
  readonly capabilities: readonly AdapterCapability[] = ["search"];

  private readonly dbPath: string;
  private readonly defaultMax: number;
  private db: DatabaseSync | null = null;
  private available = false;

  get isAvailable(): boolean { return this.available; }

  constructor(config?: MemorixAdapterConfig) {
    this.dbPath = config?.dbPath ?? process.env.MEMORIX_DB ?? DEFAULT_DB;
    this.defaultMax = config?.maxResults ?? 20;
  }

  async init(): Promise<void> {
    try {
      if (!existsSync(this.dbPath)) {
        process.stderr.write(
          `obsidian-llm-wiki: [warn] memorix DB not found at ${this.dbPath}, adapter disabled\n`,
        );
        this.available = false;
        return;
      }
      this.db = new DatabaseSync(this.dbPath, { readOnly: true });
      // Probe: confirm `observations` table exists and is readable
      const probe = this.db.prepare(
        "SELECT COUNT(*) AS n FROM observations",
      ).get() as { n: number } | undefined;
      const n = probe?.n ?? 0;
      if (n === 0) {
        process.stderr.write(
          `obsidian-llm-wiki: [warn] memorix DB reachable but 0 observations\n`,
        );
      }
      this.available = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `obsidian-llm-wiki: [warn] memorix DB unavailable (${msg}), adapter disabled\n`,
      );
      this.available = false;
      if (this.db) {
        try { this.db.close(); } catch { /* ignore */ }
        this.db = null;
      }
    }
  }

  async dispose(): Promise<void> {
    if (this.db) {
      try { this.db.close(); } catch { /* ignore */ }
      this.db = null;
    }
  }

  async search(query: string, opts?: SearchOpts): Promise<SearchResult[]> {
    if (!this.available || !this.db) return [];
    const limit = Math.max(1, Math.min(opts?.maxResults ?? this.defaultMax, 100));
    // Escape SQL LIKE wildcards so user input like "50%" matches literally.
    const escaped = query
      .replace(/\\/g, "\\\\")
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_");
    const pattern = `%${escaped}%`;

    try {
      const stmt = this.db.prepare(
        `SELECT id, entityName, type, title, narrative, projectId, sessionId,
                topicKey, valueCategory, createdAt, status
         FROM observations
         WHERE status = 'active'
           AND (title LIKE ? ESCAPE '\\'
                OR narrative LIKE ? ESCAPE '\\'
                OR concepts LIKE ? ESCAPE '\\')
         ORDER BY createdAt DESC
         LIMIT ?`,
      );
      const rows = stmt.all(pattern, pattern, pattern, limit) as Array<{
        id: number;
        entityName: string;
        type: string;
        title: string;
        narrative: string;
        projectId: string;
        sessionId: string | null;
        topicKey: string | null;
        valueCategory: string | null;
        createdAt: string;
        status: string;
      }>;

      return rows.map((r) => ({
        source: this.name,
        path: `memorix/${r.projectId || "global"}/${r.type}/${r.id}`,
        content: `${r.title}: ${String(r.narrative ?? "").slice(0, 400)}`,
        // Text-LIKE has no intrinsic relevance; 0.5 keeps memorix neutral
        // in unified RRF fusion. Tune via adapter_weights if needed.
        score: 0.5,
        metadata: {
          type: r.type,
          entityName: r.entityName,
          projectId: r.projectId,
          sessionId: r.sessionId,
          topicKey: r.topicKey,
          valueCategory: r.valueCategory,
          createdAt: r.createdAt,
          item_id: r.id,
        },
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `obsidian-llm-wiki: [error] memorix query failed: ${msg}\n`,
      );
      return [];
    }
  }
}
