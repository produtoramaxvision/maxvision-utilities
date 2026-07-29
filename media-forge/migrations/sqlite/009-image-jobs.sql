-- 009-image-jobs.sql — mirrors video_jobs (001-video-jobs.sql) for image
-- generations so the cost guard's daily-spend query has a real ledger to sum
-- for images. No `mode`/`duration_ms`/`tenant_id` columns — image jobs are
-- synchronous single-shot calls, not async submit/poll lifecycles.
CREATE TABLE IF NOT EXISTS image_jobs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  params_hash TEXT NOT NULL,
  est_usd REAL NOT NULL,
  actual_usd REAL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_image_jobs_provider_created
  ON image_jobs (provider, created_at);

CREATE INDEX IF NOT EXISTS idx_image_jobs_created
  ON image_jobs (created_at);
