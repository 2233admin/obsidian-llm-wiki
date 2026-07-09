/**
 * PGliteEngine -- embedded Postgres (WASM) implementation of VaultBrainEngine.
 * Uses @electric-sql/pglite with pgvector + pg_trgm extensions.
 */

import type { VaultBrainEngine, ChunkResult, ChunkInput } from "./engine.js";
import { VAULTBRAIN_SCHEMA_SQL } from "./schema.js";

// Dynamic type placeholder -- PGlite's exact type is resolved at runtime
type PGliteDB = {
  exec(sql: string): Promise<unknown>;
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
  waitReady: Promise<void>;
};

const dynamicImport = new Function(
  "specifier",
  "return import(specifier)",
) as (specifier: string) => Promise<Record<string, unknown>>;

export class PGliteEngine implements VaultBrainEngine {
  private db: PGliteDB | null = null;

  constructor(private readonly dataDir: string) {}

  async connect(): Promise<void> {
    // Dynamic import so loading failure (missing wasm, etc.) is catchable at call-site
    const { PGlite } = await import("@electric-sql/pglite");
    const { vector } = await dynamicImport("@electric-sql/pglite/vector");
    const { pg_trgm } = await import("@electric-sql/pglite/contrib/pg_trgm");
    const vectorExtension = vector as typeof pg_trgm;

    this.db = new PGlite(this.dataDir, { extensions: { vector: vectorExtension, pg_trgm } }) as unknown as PGliteDB;
    await this.db.waitReady;
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  async initSchema(): Promise<void> {
    await this.requireDb().exec(VAULTBRAIN_SCHEMA_SQL);
  }

  async upsertPage(slug: string, title: string, content: string, hash: string): Promise<void> {
    await this.requireDb().query(
      `INSERT INTO pages (slug, title, content, hash, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title,
         content = EXCLUDED.content,
         hash = EXCLUDED.hash,
         updated_at = now()`,
      [slug, title, content, hash],
    );
  }

  async deletePage(slug: string): Promise<void> {
    await this.requireDb().query(`DELETE FROM pages WHERE slug = $1`, [slug]);
  }

  async upsertChunks(slug: string, chunks: ChunkInput[]): Promise<void> {
    if (chunks.length === 0) return;
    const db = this.requireDb();

    for (const chunk of chunks) {
      const embeddingStr = chunk.embedding && chunk.embedding.length > 0
        ? JSON.stringify(chunk.embedding)
        : null;

      if (embeddingStr) {
        await db.query(
          `INSERT INTO chunks (slug, chunk_index, chunk_text, embedding, token_count)
           VALUES ($1, $2, $3, $4::vector, $5)
           ON CONFLICT (slug, chunk_index) DO UPDATE SET
             chunk_text = EXCLUDED.chunk_text,
             embedding = EXCLUDED.embedding,
             token_count = EXCLUDED.token_count`,
          [slug, chunk.chunkIndex, chunk.chunkText, embeddingStr, chunk.tokenCount],
        );
      } else {
        await db.query(
          `INSERT INTO chunks (slug, chunk_index, chunk_text, embedding, token_count)
           VALUES ($1, $2, $3, NULL, $4)
           ON CONFLICT (slug, chunk_index) DO UPDATE SET
             chunk_text = EXCLUDED.chunk_text,
             token_count = EXCLUDED.token_count`,
          [slug, chunk.chunkIndex, chunk.chunkText, chunk.tokenCount],
        );
      }
    }
  }

  async deleteChunks(slug: string): Promise<void> {
    await this.requireDb().query(`DELETE FROM chunks WHERE slug = $1`, [slug]);
  }

  async searchKeyword(query: string, limit: number): Promise<ChunkResult[]> {
    // Bilingual keyword floor (no daemon, no embeddings). RRF-fuse two rankings:
    //   - ts_rank_cd over a 'simple' tsvector -> English / multi-word NL phrases.
    //     The tsquery ORs the query's lexemes (term1 | term2 | ...) so partial
    //     overlap still ranks -- a natural-language phrase no longer returns 0
    //     just because no chunk contains the whole literal string.
    //   - pg_trgm similarity()                -> CJK, which 'simple' cannot
    //     word-segment (a space-less Chinese run becomes one token).
    // RRF (k=60) merges by RANK within each list, so the two incomparable score
    // scales never fight; a chunk strong in either list surfaces.
    const { rows } = await this.requireDb().query<{
      slug: string;
      chunk_index: number;
      chunk_text: string;
      score: number;
    }>(
      `WITH q AS (
         SELECT to_tsquery('simple',
                  NULLIF(array_to_string(
                    tsvector_to_array(to_tsvector('simple', $1)), ' | '), '')
                ) AS tsq
       ),
       scored AS (
         SELECT slug, chunk_index, chunk_text,
                ts_rank_cd(chunk_tsv, (SELECT tsq FROM q)) AS ts_score,
                similarity(chunk_text, $1) AS trgm_score,
                (chunk_text ILIKE '%' || $1 || '%') AS substr_hit
         FROM chunks
         WHERE chunk_tsv @@ (SELECT tsq FROM q)
            OR similarity(chunk_text, $1) >= 0.1
            OR chunk_text ILIKE '%' || $1 || '%'
       ),
       ranked AS (
         SELECT slug, chunk_index, chunk_text, ts_score, trgm_score, substr_hit,
                rank() OVER (ORDER BY ts_score DESC)   AS ts_rank,
                rank() OVER (ORDER BY trgm_score DESC) AS trgm_rank
         FROM scored
       )
       SELECT slug, chunk_index, chunk_text,
              ( CASE WHEN ts_score   > 0 THEN 1.0 / (60 + ts_rank)   ELSE 0 END
              + CASE WHEN trgm_score > 0 THEN 1.0 / (60 + trgm_rank) ELSE 0 END
              + CASE WHEN substr_hit     THEN 1.0 / 60               ELSE 0 END
              ) AS score
       FROM ranked
       ORDER BY score DESC, slug, chunk_index
       LIMIT $2`,
      [query, limit],
    );
    return rows.map((r) => ({
      slug: r.slug,
      chunkIndex: r.chunk_index,
      chunkText: r.chunk_text,
      score: Number(r.score),
    }));
  }

  async searchVector(embedding: number[], limit: number): Promise<ChunkResult[]> {
    const vecStr = JSON.stringify(embedding);
    const { rows } = await this.requireDb().query<{
      slug: string;
      chunk_index: number;
      chunk_text: string;
      score: number;
    }>(
      `SELECT slug, chunk_index, chunk_text,
              1 - (embedding <=> $1::vector) AS score
       FROM chunks
       WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [vecStr, limit],
    );
    return rows.map((r) => ({
      slug: r.slug,
      chunkIndex: r.chunk_index,
      chunkText: r.chunk_text,
      score: Number(r.score),
    }));
  }

  async countChunks(): Promise<number> {
    const { rows } = await this.requireDb().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM chunks`,
    );
    return Number(rows[0]?.n ?? 0);
  }

  async countEmbeddedChunks(): Promise<number> {
    const { rows } = await this.requireDb().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM chunks WHERE embedding IS NOT NULL`,
    );
    return Number(rows[0]?.n ?? 0);
  }

  async getLastIndexedAtMs(): Promise<number | null> {
    const { rows } = await this.requireDb().query<{ last: string | null }>(
      `SELECT MAX(updated_at) AS last FROM pages`,
    );
    const last = rows[0]?.last;
    return last ? new Date(last).getTime() : null;
  }

  async upsertLink(fromSlug: string, toSlug: string): Promise<void> {
    await this.requireDb().query(
      `INSERT INTO page_links (from_slug, to_slug)
       VALUES ($1, $2)
       ON CONFLICT (from_slug, to_slug) DO NOTHING`,
      [fromSlug, toSlug],
    );
  }

  async upsertTag(slug: string, tag: string): Promise<void> {
    await this.requireDb().query(
      `INSERT INTO page_tags (slug, tag)
       VALUES ($1, $2)
       ON CONFLICT (slug, tag) DO NOTHING`,
      [slug, tag],
    );
  }

  private requireDb(): PGliteDB {
    if (!this.db) throw new Error("PGliteEngine not connected. Call connect() first.");
    return this.db;
  }
}
