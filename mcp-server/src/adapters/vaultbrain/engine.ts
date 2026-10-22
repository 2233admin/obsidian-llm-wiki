/**
 * VaultBrainEngine -- trimmed interface over PGLite-backed semantic store.
 * Only methods actually used by VaultBrainAdapter are declared.
 */

import type { EmbeddingFingerprint } from "../../embedding/profile.js";

export interface ChunkResult {
  slug: string;
  chunkIndex: number;
  chunkText: string;
  score: number;
}

export interface ChunkInput {
  chunkIndex: number;
  chunkText: string;
  embedding: number[] | null;
  tokenCount: number;
}

export interface FileStamp {
  mtimeMs: number;
  sizeBytes: number;
}
export interface ReindexState {
  status: "running" | "complete" | "incomplete";
  startedAt: number;
  finishedAt?: number;
  indexed: number;
  total: number;
  skipped: number;
  deleted: number;
  errors: string[];
}

export interface VaultBrainEngine {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  ensureEmbeddingFingerprint(fingerprint: EmbeddingFingerprint): Promise<void>;
  upsertPage(slug: string, title: string, content: string, hash: string, stamp?: FileStamp): Promise<void>;
  getPageHash(slug: string): Promise<string | null>;
  getPageStamp(slug: string): Promise<FileStamp | null>;
  listPageSlugs(): Promise<string[]>;
  replacePage(
    slug: string,
    title: string,
    content: string,
    hash: string,
    chunks: ChunkInput[],
    links: string[],
    tags: string[],
    stamp?: FileStamp,
  ): Promise<void>;

  deletePage(slug: string): Promise<void>;
  clearPageMetadata(slug: string): Promise<void>;

  // chunks
  upsertChunks(slug: string, chunks: ChunkInput[]): Promise<void>;
  setReindexState(state: ReindexState): Promise<void>;
  getReindexState(): Promise<ReindexState | null>;
  deleteChunks(slug: string): Promise<void>;

  // search
  searchKeyword(query: string, limit: number): Promise<ChunkResult[]>;
  searchVector(embedding: number[], limit: number): Promise<ChunkResult[]>;
  countChunks(): Promise<number>;
  countEmbeddedChunks(): Promise<number>;

  /** MAX(pages.updated_at) in epoch ms -- the index-wide "last write" watermark, null if no pages. */
  getLastIndexedAtMs(): Promise<number | null>;

  // links
  upsertLink(fromSlug: string, toSlug: string): Promise<void>;

  // tags
  upsertTag(slug: string, tag: string): Promise<void>;
}
