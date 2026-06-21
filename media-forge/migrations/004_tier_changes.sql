-- 004_tier_changes.sql — audit trail for every tenant tier change (money/auth).
CREATE TABLE IF NOT EXISTS tier_changes (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  from_tier   TEXT NOT NULL,
  to_tier     TEXT NOT NULL CHECK (to_tier IN ('free','creator','pro')),
  reason      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tier_changes_tenant ON tier_changes (tenant_id, created_at DESC);
