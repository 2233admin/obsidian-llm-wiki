/**
 * PGliteEngine -- embedded Postgres (WASM) implementation of VaultBrainEngine.
 * Uses @electric-sql/pglite with pg_trgm keyword search and optional pgvector.
 */
import type { VaultBrainEngine, ChunkResult, ChunkInput } from "./engine.js";
import { VAULTBRAIN_SCHEMA_SQL, VAULTBRAIN_VECTOR_SCHEMA_SQL } from "./schema.js";

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

async function loadOptionalVectorExtension(): Promise<unknown | null> {
  try {
    const mod = await dynamicImport("@electric-sql/pglite/vector");
    return mod.vector ?? null;
  } catch {
    return null;
  }
}

export class PGliteEngine implements VaultBrainEngine {
  private db: PGliteDB | null = null;
  private vectorEnabled = false;

  constructor(private readonly dataDir: string) {}

  async connect(): Promise<void> {
    const { PGlite } = await import("@electric-sql/pglite");
    const { pg_trgm } = await import("@electric-sql/pglite/contrib/pg_trgm");
    const vector = await loadOptionalVectorExtension();
    const extensions: Record<string, unknown> = { pg_trgm };
    if (vector) extensions.vector = vector;

    this.db = new PGlite(this.dataDir, { extensions } as never) as unknown as PGliteDB;
    await this.db.waitReady;
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  async initSchema(): Promise<void> {
    const db = this.requireDb();
    await db.exec(VAULTBRAIN_SCHEMA_SQL);

    try {
      await db.exec(VAULTBRAIN_VECTOR_SCHEMA_SQL);
      this.vectorEnabled = true;
    } catch {
      this.vectorEnabled = false;
    }
  }

  async upsertPage(slug: string, title: string, content: string, hash: string): Promise<void> {
    await this.requireDb().query(
      `INSERT INTO pages (slug, title, content, hash)
       VALUES ($1, $2, $3, $4)
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
      const embeddingStr = chunk.embedding && chunk.embedding.length > 0 ? JSON.stringify(chunk.embedding) : null;
      if (this.vectorEnabled && embeddingStr) {
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
          `INSERT INTO chunks (slug, chunk_index, chunk_text, token_count)
           VALUES ($1, $2, $3, $4)
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
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return [];

    const { rows } = await this.requireDb().query<{
      slug: string;
      chunk_index: number;
      chunk_text: string;
      score: number;
    }>(
      `WITH q AS (
         SELECT websearch_to_tsquery('simple', $1) AS tsq
       ), scored AS (
         SELECT
           slug,
           chunk_index,
           chunk_text,
           ts_rank_cd(chunk_tsv, (SELECT tsq FROM q)) AS ts_score,
           similarity(chunk_text, $1) AS trgm_score,
           (chunk_text ILIKE '%' || $1 || '%') AS substr_hit
         FROM chunks
         WHERE chunk_tsv @@ (SELECT tsq FROM q)
            OR similarity(chunk_text, $1) >= 0.2
            OR chunk_text ILIKE '%' || $1 || '%'
       ), ranked AS (
         SELECT
           slug,
           chunk_index,
           chunk_text,
           ts_score,
           trgm_score,
           substr_hit,
           rank() OVER (ORDER BY ts_score DESC, slug, chunk_index) AS ts_rank,
           rank() OVER (ORDER BY trgm_score DESC, slug, chunk_index) AS trgm_rank
         FROM scored
       )
       SELECT
         slug,
         chunk_index,
         chunk_text,
         CASE WHEN ts_score > 0 THEN 1.0 / (60 + ts_rank) ELSE 0 END +
         CASE WHEN trgm_score >= 0.2 THEN 1.0 / (60 + trgm_rank) ELSE 0 END +
         CASE WHEN substr_hit THEN 1.0 / 60 ELSE 0 END AS score
       FROM ranked
       WHERE ts_score > 0 OR trgm_score >= 0.2 OR substr_hit
       ORDER BY score DESC, slug, chunk_index
       LIMIT $2`,
      [normalizedQuery, limit],
    );

    return rows.map((r) => ({
      slug: r.slug,
      chunkIndex: r.chunk_index,
      chunkText: r.chunk_text,
      score: Number(r.score),
    }));
  }

  async searchVector(embedding: number[], limit: number): Promise<ChunkResult[]> {
    if (!this.vectorEnabled) return [];
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
    if (!this.vectorEnabled) return 0;
    const { rows } = await this.requireDb().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM chunks WHERE embedding IS NOT NULL`,
    );
    return Number(rows[0]?.n ?? 0);
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

