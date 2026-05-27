CREATE TABLE IF NOT EXISTS video_jobs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  mode TEXT NOT NULL,
  params_hash TEXT NOT NULL,
  est_usd REAL NOT NULL,
  actual_usd REAL,
  duration_ms INTEGER,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_video_jobs_provider_created
  ON video_jobs (provider, created_at);

CREATE INDEX IF NOT EXISTS idx_video_jobs_created
  ON video_jobs (created_at);
