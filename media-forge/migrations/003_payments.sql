CREATE TABLE IF NOT EXISTS billing_customers (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  provider        TEXT NOT NULL CHECK (provider IN ('asaas','stripe')),
  customer_id     TEXT NOT NULL,          -- id do customer no provedor
  subscription_id TEXT,                   -- id da assinatura (quando recorrente)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, customer_id)
);
CREATE INDEX IF NOT EXISTS ix_billing_customers_tenant ON billing_customers (tenant_id);

CREATE TABLE IF NOT EXISTS payments (
  id                BIGSERIAL PRIMARY KEY,
  payment_id        TEXT NOT NULL,         -- id do pagamento no provedor (idempotência)
  provider          TEXT NOT NULL CHECK (provider IN ('asaas','stripe')),
  tenant_id         TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('subscription','pack')),
  brl               NUMERIC(10,2),
  credits           BIGINT NOT NULL,
  credit_value_usd  DOUBLE PRECISION NOT NULL,  -- valor do crédito DESTE lote (regra de ouro #3)
  credit_kind       TEXT NOT NULL DEFAULT 'paid' CHECK (credit_kind IN ('paid','promo')),
  status            TEXT NOT NULL CHECK (status IN ('pending','confirmed','granted','failed')),
  external_grant_id TEXT,                  -- external_id usado no grant ao credit-core
  raw_event         JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_at        TIMESTAMPTZ,
  UNIQUE (provider, payment_id)            -- idempotência por payment_id
);
CREATE INDEX IF NOT EXISTS ix_payments_tenant ON payments (tenant_id);
CREATE INDEX IF NOT EXISTS ix_payments_status ON payments (status);
