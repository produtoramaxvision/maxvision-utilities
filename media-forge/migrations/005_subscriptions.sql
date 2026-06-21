-- 005_subscriptions.sql — local subscription source of truth for tier reconcile.
CREATE TABLE IF NOT EXISTS subscriptions (
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  provider    TEXT NOT NULL,
  sub_id      TEXT NOT NULL,
  status      TEXT NOT NULL,
  tier        TEXT NOT NULL CHECK (tier IN ('creator','pro')),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, sub_id)
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON subscriptions (tenant_id, status);
