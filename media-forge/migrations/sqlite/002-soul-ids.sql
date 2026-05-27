CREATE TABLE IF NOT EXISTS soul_ids (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  character_name TEXT NOT NULL,
  asset_paths_json TEXT NOT NULL,
  trained_at TEXT NOT NULL,
  last_used TEXT,
  training_credits INTEGER,
  training_usd REAL,
  fingerprint TEXT NOT NULL,           -- D-fingerprint: sha256(normalized name + sorted asset paths)
  training_state TEXT NOT NULL DEFAULT 'COMMITTED'  -- 'PENDING' | 'COMMITTED' (training-lock pattern)
);

-- D-2 idempotency: at most one record per (provider, lowercased character name).
-- Concurrent createSoulId() calls for the same character collapse into a single row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_soul_ids_provider_name_lc
  ON soul_ids (provider, LOWER(character_name));

-- Lookup index (kept alongside unique index for backwards-compat with name-only finds).
CREATE INDEX IF NOT EXISTS idx_soul_ids_character_name_lc
  ON soul_ids (LOWER(character_name));

CREATE INDEX IF NOT EXISTS idx_soul_ids_provider
  ON soul_ids (provider);

-- Fingerprint index for fast idempotency checks before issuing the training API call.
CREATE INDEX IF NOT EXISTS idx_soul_ids_fingerprint
  ON soul_ids (fingerprint);
