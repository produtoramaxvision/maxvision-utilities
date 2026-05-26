-- migrations/002-refs-index-marengo.sql
-- Parallel pgvector table for Marengo 3.0 embeddings (512-dim).
-- Separate from refs_index (1024-dim Voyage) so dims never conflict.
-- Apply: psql "$PGVECTOR_ADMIN_URL" -f migrations/002-refs-index-marengo.sql
-- Then: psql "$PGVECTOR_ADMIN_URL" -c "GRANT SELECT, INSERT, UPDATE, DELETE ON media_forge_refs.refs_index_marengo TO media_forge_refs_rw;"

CREATE TABLE IF NOT EXISTS media_forge_refs.refs_index_marengo (
  object_key   TEXT PRIMARY KEY,
  category     TEXT NOT NULL,
  embedding    vector(512) NOT NULL,
  bytes        INTEGER,
  format       TEXT,
  indexed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS refs_index_marengo_category_idx
  ON media_forge_refs.refs_index_marengo (category);

CREATE INDEX IF NOT EXISTS refs_index_marengo_hnsw_idx
  ON media_forge_refs.refs_index_marengo
  USING hnsw (embedding vector_cosine_ops);
