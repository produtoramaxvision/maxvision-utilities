-- credit-core/migrations/001_ledger.sql
CREATE TABLE IF NOT EXISTS ledger_entries (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('grant','reserve','capture','release')),
  amount        BIGINT NOT NULL CHECK (amount >= 0),
  reservation_id TEXT,
  ttl_at        TIMESTAMPTZ,
  external_id   TEXT NOT NULL,
  meta          JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- idempotência: um external_id por kind nunca duplica
CREATE UNIQUE INDEX IF NOT EXISTS ux_ledger_external ON ledger_entries (kind, external_id);
CREATE INDEX IF NOT EXISTS ix_ledger_tenant ON ledger_entries (tenant_id);
CREATE INDEX IF NOT EXISTS ix_ledger_reservation ON ledger_entries (reservation_id);
