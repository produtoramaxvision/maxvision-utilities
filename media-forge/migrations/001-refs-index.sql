-- migrations/001-refs-index.sql (HARDENED per context7-mcp pgvector best practices + eng review)
-- Schema for the semantic-search index over media-forge-refs.
-- Idempotent: safe to re-run.
--
-- NOTE: SET LOCAL maintenance_work_mem / max_parallel_maintenance_workers only take
-- effect inside a transaction block. When applying with psql, use --single-transaction
-- (psql -1 / --single-transaction) or wrap in BEGIN/COMMIT to ensure the SET LOCAL
-- scopes correctly and does not leak to other sessions on the shared container.

CREATE EXTENSION IF NOT EXISTS vector;
SELECT extversion FROM pg_extension WHERE extname = 'vector';  -- log for audit

CREATE SCHEMA IF NOT EXISTS media_forge_refs;

CREATE TABLE IF NOT EXISTS media_forge_refs.refs_index (
  object_key   TEXT NOT NULL,
  frame_idx    SMALLINT NOT NULL,
  category     TEXT NOT NULL,
  embedding    vector(1024) NOT NULL,
  palette      TEXT[],
  duration_ms  INTEGER,
  bytes        INTEGER,
  width        INTEGER,
  height       INTEGER,
  format       TEXT,
  source_film  TEXT,
  indexed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (object_key, frame_idx)
);

CREATE INDEX IF NOT EXISTS refs_index_category_idx
  ON media_forge_refs.refs_index (category);

-- HNSW index: tuned per context7 pgvector docs.
-- m=16 (default) is optimal for high-dim. ef_construction=64 (default) balances
-- build time vs recall. Bump maintenance_work_mem locally so the graph fits in RAM.
-- max_parallel_maintenance_workers=4 speeds up the HNSW graph construction.
-- IMPORTANT: these SET LOCAL statements require a transaction context (use --single-transaction).
SET LOCAL maintenance_work_mem = '2GB';
SET LOCAL max_parallel_maintenance_workers = 4;

CREATE INDEX IF NOT EXISTS refs_index_embedding_hnsw_idx
  ON media_forge_refs.refs_index
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Restore conservative defaults (other tenants share this container)
RESET maintenance_work_mem;
RESET max_parallel_maintenance_workers;
