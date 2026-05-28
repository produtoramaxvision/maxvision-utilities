CREATE TABLE IF NOT EXISTS kling_elements (
  element_id    TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  category      TEXT,
  source_url    TEXT,
  source_hash   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at  TEXT,
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_kling_elements_category ON kling_elements(category);
CREATE INDEX IF NOT EXISTS idx_kling_elements_last_used ON kling_elements(last_used_at);
