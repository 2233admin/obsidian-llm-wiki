/**
 * VaultBrainEngine -- trimmed interface over PGLite-backed semantic store.
 * Only methods actually used by VaultBrainAdapter are declared.
 */

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

export interface VaultBrainEngine {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  initSchema(): Promise<void>;

  // pages
  upsertPage(slug: string, title: string, content: string, hash: string): Promise<void>;
  deletePage(slug: string): Promise<void>;

  // chunks
  upsertChunks(slug: string, chunks: ChunkInput[]): Promise<void>;
  deleteChunks(slug: string): Promise<void>;
  /**
   * Drop the entire content_chunks table (CASCADE). Used by vault.reset
   * for schema migration (e.g. embedding dim 1536 -> 1024). Caller must
   * re-run initSchema() to recreate the table with the new schema.
   */
  dropChunks(): Promise<void>;

  // search
  searchKeyword(query: string, limit: number): Promise<ChunkResult[]>;
  searchVector(embedding: number[], limit: number): Promise<ChunkResult[]>;

  // links
  upsertLink(fromSlug: string, toSlug: string): Promise<void>;

  // tags
  upsertTag(slug: string, tag: string): Promise<void>;
}
