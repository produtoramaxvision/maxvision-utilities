-- media-forge/migrations/001_tenants_keys.sql
-- Tenancy: um tenant = uma assinatura/conta. Uma key por tenant (ou mais p/ rotacao).
-- Nunca armazena a raw key -- so o HMAC-SHA256 com pepper de env.

CREATE TABLE IF NOT EXISTS tenants (
  id          TEXT PRIMARY KEY,           -- UUID gerado pelo script create-key
  tier        TEXT NOT NULL               -- 'free' | 'creator' | 'pro'
                CHECK (tier IN ('free', 'creator', 'pro')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta        JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS api_keys (
  id          BIGSERIAL PRIMARY KEY,
  key_hash    TEXT NOT NULL UNIQUE,        -- HMAC-SHA256(pepper, rawKey) hex 64 chars
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scopes      TEXT[] NOT NULL DEFAULT '{}', -- ex: ['image','video'] -- F-E usa; F-C ignora
  revoked_at  TIMESTAMPTZ,                 -- NULL = ativa; NOT NULL = revogada
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lookup O(1) pela chave de autenticacao (indice parcial: revogadas sao ignoradas)
-- NAO usar UNIQUE constraint na coluna -- colidiria com reemissao de hash apos revogar.
-- O indice parcial garante unicidade entre keys ATIVAS e permite O(1) lookup.
CREATE UNIQUE INDEX IF NOT EXISTS ux_api_keys_hash_active ON api_keys (key_hash) WHERE revoked_at IS NULL;
-- Listagem de keys por tenant
CREATE INDEX IF NOT EXISTS ix_api_keys_tenant ON api_keys (tenant_id);
