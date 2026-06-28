/**
 * VaultBrain schema -- aligned with vaultbrain-ingest.mjs data layout.
 * Uses slug-based chunk association (no FK dependency).
 * pgvector HNSW index for embedding search, pg_trgm for keyword search.
 */

const EMBED_DIM = parseInt(process.env.VAULTBRAIN_EMBED_DIM ?? "1024", 10);

export const VAULTBRAIN_SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS pages (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT,
  content TEXT,
  hash TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chunks (
  slug TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding vector(${EMBED_DIM}),
  token_count INTEGER,
  UNIQUE(slug, chunk_index)
);

CREATE TABLE IF NOT EXISTS page_tags (
  slug TEXT,
  tag TEXT,
  PRIMARY KEY (slug, tag)
);

CREATE TABLE IF NOT EXISTS page_links (
  from_slug TEXT,
  to_slug TEXT,
  PRIMARY KEY (from_slug, to_slug)
);

CREATE INDEX IF NOT EXISTS chunks_embedding_idx
  ON chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS chunks_trgm_idx
  ON chunks USING gin (chunk_text gin_trgm_ops);

CREATE INDEX IF NOT EXISTS chunks_slug_idx
  ON chunks (slug);

-- Full-text keyword search (bilingual floor, no embeddings required).
-- A generated tsvector stays in sync with chunk_text; ts_rank_cd over it ranks
-- English / multi-word NL phrases. CJK can't be word-segmented by 'simple', so
-- the engine RRF-fuses this with pg_trgm (chunks_trgm_idx above). ADD COLUMN
-- IF NOT EXISTS migrates stores created before this column existed.
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS chunk_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', chunk_text)) STORED;

CREATE INDEX IF NOT EXISTS chunks_tsv_idx
  ON chunks USING gin (chunk_tsv);
`;
