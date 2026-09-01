/**
 * VaultBrainAdapter -- semantic storage adapter backed by PGLite (pgvector + pg_trgm).
 * Hybrid search via RRF fusion of keyword (pg_trgm similarity) and vector (cosine) results.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type {
  VaultMindAdapter,
  AdapterCapability,
  SearchResult,
  SearchOpts,
} from "../interface.js";
import type { VaultBrainEngine, ChunkResult, FileStamp, ReindexState } from "./engine.js";
import { PGliteEngine } from "./pglite-engine.js";
import { chunkMarkdown, embedTextsWithProfile } from "./ingest.js";
import { EmbeddingIndexRebuildRequiredError } from "./embedding-index.js";

const RRF_K = 60;

export interface VaultBrainEmbeddingConfig {
  profileId?: string;
  endpoint?: string;
  model?: string;
  dimensions?: number;
}

export class VaultBrainAdapter implements VaultMindAdapter {
  readonly name = "vaultbrain";
  readonly capabilities: readonly AdapterCapability[] = ["search", "embeddings"];

  private engine: VaultBrainEngine | null = null;
  private _available = false;
  private readonly mutationTails = new Map<string, Promise<unknown>>();

  get isAvailable(): boolean { return this._available; }

  constructor(
    private readonly dataDir?: string,
    private readonly embedding: VaultBrainEmbeddingConfig = {},
  ) {}

  async init(): Promise<void> {
    const dir = this.dataDir ?? join(homedir(), ".vault-mind", "vaultbrain");
    try {
      const engine = new PGliteEngine(dir);
      await engine.connect();
      await engine.initSchema();
      this.engine = engine;
      this._available = true;
    } catch (err) {
      console.warn(`[vaultbrain] init failed, adapter disabled: ${(err as Error).message}`);
      this.engine = null;
      this._available = false;
    }
  }

  async dispose(): Promise<void> {
    if (this.engine) {
      try {
        await this.engine.disconnect();
      } catch {
        // non-fatal
      }
      this.engine = null;
    }
  }

  /** Chunk count -- lazy backfill uses this to detect an empty (never-indexed) store. */
  async countChunks(): Promise<number> {
    return this.engine ? this.engine.countChunks() : 0;
  }

  /** Embedded chunk count -- 0 while chunks exist means Ollama never embedded (semantic off). */
  async countEmbeddedChunks(): Promise<number> {
    return this.engine ? this.engine.countEmbeddedChunks() : 0;
  }

  /** Index-wide last-write watermark (epoch ms) -- vault-status uses this for staleness detection. */
  async getLastIndexedAtMs(): Promise<number | null> {
    return this.engine ? this.engine.getLastIndexedAtMs() : null;
  }

  async search(query: string, opts?: SearchOpts): Promise<SearchResult[]> {
    if (!this.engine) return [];
    const limit = opts?.maxResults ?? 20;
    const perListLimit = Math.ceil(limit * 2);

    // Keyword search (always runs)
    let kwResults: ChunkResult[] = [];
    try {
      kwResults = await this.engine.searchKeyword(query, perListLimit);
    } catch {
      // non-fatal
    }

    // Vector search (via Ollama BGE-M3 by default, falls back gracefully)
    let vecResults: ChunkResult[] = [];
    try {
      const embeddings = await embedTextsWithProfile([query], this.embedOptions());
      const result = embeddings[0];
      if (result && result.vector.length > 0) {
        await this.engine.ensureEmbeddingFingerprint(result.fingerprint);
        vecResults = await this.engine.searchVector(result.vector, perListLimit);
      }
    } catch (error) {
      if (error instanceof EmbeddingIndexRebuildRequiredError) throw error;
      // non-fatal, fall back to keyword-only
    }

    // RRF fusion
    const scoreMap = new Map<string, { result: ChunkResult; score: number }>();

    for (let rank = 0; rank < kwResults.length; rank++) {
      const r = kwResults[rank];
      const key = `${r.slug}::${r.chunkIndex}`;
      const rrfScore = 1 / (RRF_K + rank);
      const existing = scoreMap.get(key);
      if (existing) existing.score += rrfScore;
      else scoreMap.set(key, { result: r, score: rrfScore });
    }

    for (let rank = 0; rank < vecResults.length; rank++) {
      const r = vecResults[rank];
      const key = `${r.slug}::${r.chunkIndex}`;
      const rrfScore = 1 / (RRF_K + rank);
      const existing = scoreMap.get(key);
      if (existing) existing.score += rrfScore;
      else scoreMap.set(key, { result: r, score: rrfScore });
    }

    return Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ result, score }) => ({
        source: this.name,
        path: result.slug,
        content: result.chunkText,
        score,
      }));
  }

  /**
   * Ingest a Markdown file, skipping unchanged content before rebuilding chunks.
   * Returns true when the page is written and false when no write occurs.
   */
  async ingest(
    path: string,
    content: string,
    stamp?: FileStamp,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const slug = pathToSlug(path);
    return this.enqueueMutation(slug, async () => {
      if (!this.engine) return false;
      if (signal?.aborted) throw new Error("VaultBrain ingest aborted");

      const title = extractTitle(content);
      const hash = simpleHash(content);
      if ((await this.engine.getPageHash(slug)) === hash) return false;

      const chunks = chunkMarkdown(content);
      const embeddings = await embedTextsWithProfile(chunks, {
        ...this.embedOptions(),
        signal,
      });
      if (signal?.aborted) throw new Error("VaultBrain ingest aborted");
      if (embeddings[0]) {
        await this.engine.ensureEmbeddingFingerprint(embeddings[0].fingerprint);
        if (embeddings.some(result => result.fingerprint.digest !== embeddings[0]!.fingerprint.digest)) {
          throw new Error("VaultBrain embedding batch returned mixed profile fingerprints");
        }
      }
      if (signal?.aborted) throw new Error("VaultBrain ingest aborted");

      await this.engine.replacePage(
        slug,
        title,
        content,
        hash,
        chunks.map((chunkText, i) => ({
          chunkIndex: i,
          chunkText,
          embedding: embeddings[i]?.vector ?? null,
          tokenCount: Math.ceil(chunkText.length / 4),
        })),
        extractWikiLinks(content),
        extractTags(content),
        stamp,
      );
      return true;
    });
  }

  async listIndexedSlugs(): Promise<string[]> {
    if (!this.engine) return [];
    return this.engine.listPageSlugs();
  }
  async getIndexedStamp(path: string): Promise<FileStamp | null> {
    if (!this.engine) return null;
    return this.engine.getPageStamp(pathToSlug(path));
  }
  async setReindexState(state: ReindexState): Promise<void> {
    if (this.engine) await this.engine.setReindexState(state);
  }

  async getReindexState(): Promise<ReindexState | null> {
    if (!this.engine) return null;
    return this.engine.getReindexState();
  }

  async deletePath(path: string, signal?: AbortSignal): Promise<void> {
    await this.deleteSlug(pathToSlug(path), signal);
  }

  async deleteSlug(slug: string, signal?: AbortSignal): Promise<void> {
    await this.enqueueMutation(slug, async () => {
      if (signal?.aborted) throw new Error("VaultBrain delete aborted");
      if (this.engine) await this.engine.deletePage(slug);
    });
  }
  private enqueueMutation<T>(slug: string, mutation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTails.get(slug) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(mutation);
    this.mutationTails.set(slug, current);
    const clear = () => {
      if (this.mutationTails.get(slug) === current) this.mutationTails.delete(slug);
    };
    void current.then(clear, clear);
    return current;
  }

  private embedOptions() {
    return {
      profileId: this.embedding.profileId,
      url: this.embedding.endpoint,
      model: this.embedding.model,
      dimensions: this.embedding.dimensions,
    };
  }
}

// --- Helpers ---

export function pathToSlug(path: string): string {
  return path.replace(/\\/g, "/").replace(/\.md$/, "");
}

function extractTitle(content: string): string {
  const h1 = content.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  const lines = content.split("\n").filter((l) => l.trim());
  return lines[0]?.slice(0, 80) ?? "";
}

function simpleHash(content: string): string {
  // djb2 -- fast, good enough for change detection
  let h = 5381;
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) + h) + content.charCodeAt(i);
    h = h & h; // force 32-bit
  }
  return (h >>> 0).toString(16);
}

function extractWikiLinks(content: string): string[] {
  const matches = content.matchAll(/\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g);
  return [...matches].map((m) => m[1].trim().toLowerCase().replace(/\s+/g, "-"));
}

function extractTags(content: string): string[] {
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter) return [];
  const inlineTags = frontmatter[1].match(/^tags:\s*\[([^\]]+)\]/m);
  const blockTags = frontmatter[1].match(/^tags:\s*\n((?:\s*-\s*.+\n?)+)/m);
  const tagSource = inlineTags?.[1] ?? blockTags?.[1];
  if (!tagSource) return [];
  return tagSource
    .split(/[\n,]/)
    .map((t) => t.replace(/^-\s*/, "").replace(/['"]/g, "").trim())
    .filter(Boolean);
}
