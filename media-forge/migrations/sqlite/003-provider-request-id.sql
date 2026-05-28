CREATE TABLE IF NOT EXISTS provider_request_map (
  provider TEXT NOT NULL,
  provider_request_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (provider, provider_request_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_request_map_job_id
  ON provider_request_map (job_id);
