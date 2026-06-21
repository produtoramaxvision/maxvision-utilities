-- media-forge/migrations/002_generations.sql
-- Gallery: persistent generation records per tenant (F-I).
-- Apply AFTER 001_tenants_keys.sql (depends on no FK to tenants for flexibility).
-- Runner: manual (same as 001_tenants_keys.sql — no automatic runner in startHttpServer).

CREATE TABLE IF NOT EXISTS generations (
  id               BIGSERIAL PRIMARY KEY,
  generation_id    TEXT NOT NULL UNIQUE,      -- job_id do media-forge (idempotência)
  tenant_id        TEXT NOT NULL,
  model            TEXT NOT NULL,             -- ex: 'veo-3-1-pro', 'imagen-4-ultra'
  provider         TEXT NOT NULL,             -- ex: 'google', 'kling', 'higgsfield'
  cost_usd         NUMERIC(12,6) NOT NULL,    -- COGS real (recordActualCost)
  credits_debited  BIGINT NOT NULL,           -- créditos debitados (capture do credit-core)
  credit_value_usd NUMERIC(12,8) NOT NULL,    -- valor do crédito no momento do capture
  minio_key        TEXT,                      -- chave MinIO/S3 do asset entregue (F-B)
  signed_url       TEXT,                      -- URL assinada no momento do insert (pode expirar)
  status           TEXT NOT NULL DEFAULT 'completed', -- 'completed' | 'failed'
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_gen_tenant_created ON generations (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_gen_model ON generations (model);
