# media-forge F-C — Tenancy + Tiers + Rate-limit

> **For agentic workers:** REQUIRED SUB-SKILL: `maxvision:subagent-driven-development` ou `maxvision:executing-plans`. Steps usam checkbox (`- [ ]`). Executar task-by-task com TDD (Red → Green → Commit).

**Goal:** Substituir a checagem plana de API keys por keys hasheadas num store Postgres próprio (tenant + tier + scopes), propagar `tenantId`/`tier`/`scopes` pelo `AuthContext` até o `registerAllTools` para gating de tools por tier, e reintroduzir Redis para rate-limit por tenant via fixed-window INCR+EXPIRE.

**Depende de:** F-A (entregue — `resolveAuth`, `AuthContext`, `handleMcpRequest`, `buildHttpApp`, `/mcp` stateless). Não depende de `credit-core` (F-D).

**Spec fonte:** `.maxvision/specs/2026-06-01-media-forge-infoproduct-design.md` §6 (hashing, rate-limit, gating, tenancy) + índice-mestre §F-C. Deploy: `.maxvision/deploy/media-forge-mcp.stack.yml`.

**Tech stack:** TypeScript ESM, Node ≥22.5, `pg` (Postgres), `ioredis`, `node:crypto` (HMAC-SHA256), vitest, Hono (já presente).

**Exit criteria:**
- Tool paga (ex.: `media_generate_video_t2v`) **não aparece em `tools/list`** para tenant `free` (gating por não-registro); `tools/call` retorna "method not found" (comportamento SDK padrão para tool não registrada — não há erro `tier_required` dedicado nesta fase).
- Rate-limit por tenant: 429 `Retry-After` quando janela esgotada.
- `resolveAuth` assíncrono — busca tenant/tier no Postgres; chave nunca em plaintext no DB.
- `pnpm typecheck && pnpm lint && pnpm test` verde (incluindo testes sync legados migrados).
- Stack atualizado com serviço `redis` + `REDIS_URL`; Postgres próprio documentado.

**Versão:** media-forge bump de `v0.1.1` → `v0.2.0` (package.json + McpServer `{ name: 'media-forge', version: '0.2.0' }`).

---

## Decisões de arquitetura (documentadas, não abertas)

### D1 — Postgres próprio vs compartilhado com credit-core

**Decisão: Postgres próprio do media-forge** (novo serviço `mcp-postgres` no stack).

Rationale: tenants/keys é concern de autenticação do media-forge; `credit-core` é o serviço de wallet (F-D, Lane 2) consumido por rede — acoplar ao mesmo DB viola a fronteira de serviço (eng review A3). O media-forge precisa de lookup de key com latência sub-5ms por request; separação garante autonomia de schema + índice especializado.

Trade-off: +1 Postgres no stack (mas pequeno — só 2 tabelas, zero I/O intenso).

Bootstrap da primeira key: migration seed insere um tenant `default` + uma key hasheada (tier `creator`) cujo `raw_key` é gerado no `scripts/create-key.mts` (Task 1b). Não há painel; rotação = `INSERT` + revogação = `UPDATE revoked_at`.

### D2 — Algoritmo de hash

**Decisão: HMAC-SHA256 com pepper de env (`MEDIA_FORGE_KEY_PEPPER`).**

Rationale: API key é segredo high-entropy gerado pelo server (32 bytes aleatórios, hex 64 chars) — não é senha humana, portanto scrypt/bcrypt com salt por-linha não é necessário e quebra lookup determinístico. Com HMAC-SHA256 + pepper estático: `key_hash = HMAC(SHA256, pepper, rawKey)` → hash determinístico → `WHERE key_hash = $1` com índice único O(1). O pepper garante que vazar o hash do DB sem a env var não revela a key. `node:crypto.createHmac('sha256', pepper).update(rawKey).digest('hex')` — confirmar API via context7 se necessário (padrão Node estável desde v0.5).

Trade-off: rotação do pepper invalida todas as keys (precisa re-hash em transação). Aceitável — pepper só muda em rotação de segurança planejada.

### D3 — Tiers concretos

Ancorado em §4.3 e §4.4 da spec:

| Tier | Código | Tools disponíveis | Restrições |
|---|---|---|---|
| `free` | `'free'` | só `IMAGE_TOOLS` (6 tools) + `UTILITY_TOOLS` (8) + `media_help` | sem vídeo, watermark, refill diário ~50–100 cr; **zero** Veo |
| `creator` | `'creator'` | `IMAGE_TOOLS` + `UTILITY_TOOLS` + `media_help` + `VIDEO_TOOLS` (7) + tools de custo (2) + rota (1) | cap de Veo por ciclo (1 incluso, F-E aplica); Higgsfield/Kling/Seedance incluídos |
| `pro` | `'pro'` | todas as 54 tools | sem cap extra; Refs tools habilitadas |

Implementação: `TIER_GATES: Record<Tier, ReadonlySet<string>>` em `src/http/tier-gates.ts` — calculado uma vez no módulo a partir dos nomes canônicos de `MCP_TOOLS` (54 tools, `schemas.ts`). `registerAllTools` pula o `reg(...)` de tools fora do gate do tier recebido.

Mapa de categorias (baseado em `schemas.ts` registry real):

- `IMAGE_TOOLS` (6): `media_generate_image`, `media_generate_imagen`, `media_edit_image`, `media_compose_scene`, `media_describe_image`, `media_extract_palette`
- `UTILITY_TOOLS` (8): `media_dry_run_payload`, `media_estimate_cost`, `media_validate_environment`, `media_capability_matrix`, `media_list_outputs`, `media_get_job_metadata`, `media_run_ocr`, `media_check_brand_compliance`
- `HELP_TOOLS` (1): `media_help`
- `VIDEO_TOOLS` (7): `media_generate_video_t2v`, `media_generate_video_i2v`, `media_generate_video_interpolate`, `media_generate_video_with_refs`, `media_extend_video`, `media_poll_video_operation`, `media_download_video`
- `COST_TOOLS` (2 + routing 1): `media_video_cost_estimate`, `media_video_cost_report`, `media_video_route`
- `WEBHOOK_TOOLS` (1): `media_video_webhook_status`
- `HIGGSFIELD_TOOLS` (10): `media_higgsfield_soul_id`, `media_higgsfield_dop`, `media_higgsfield_cinema_studio`, `media_higgsfield_speak`, `media_higgsfield_marketing_studio`, `media_higgsfield_recast`, `media_higgsfield_virality_predictor`, `media_higgsfield_generate`, `media_higgsfield_poll`, `media_higgsfield_download`
- `KLING_TOOLS` (11): `media_kling_motion_brush`, `media_kling_element_create`, `media_kling_element_list`, `media_kling_element_delete`, `media_kling_elements`, `media_kling_lip_sync`, `media_kling_omni_multishot`, `media_kling_video_extend`, `media_kling_poll`, `media_kling_download` + 1 adicional (confirmar contagem no executor)
- `SEEDANCE_TOOLS` (4): `media_seedance_text_to_video`, `media_seedance_image_to_video`, `media_seedance_multishot`, `media_seedance_reference_fusion`
- `REFS_TOOLS` (4): `media_refs_search`, `media_refs_compose_moodboard`, `media_refs_presign`, `media_refs_index`

### D4 — Algoritmo de rate-limit

**Decisão: fixed-window INCR+EXPIRE por tenant.**

Chave Redis: `rl:{tenantId}:{windowStart}` onde `windowStart = Math.floor(Date.now()/1000 / WINDOW_SEC) * WINDOW_SEC`.

Algoritmo:
```
count = INCR rl:{tenantId}:{windowStart}
if count == 1: EXPIRE rl:{tenantId}:{windowStart} WINDOW_SEC
if count > LIMIT: → 429 + Retry-After: (windowStart + WINDOW_SEC - now)
```

Limites por tier (configuráveis via env, defaults hardcoded):
- `free`: 20 req/min
- `creator`: 120 req/min
- `pro`: 600 req/min

Harness: `ioredis-mock` (`^8`) no `devDependencies` — integração gated por `REDIS_URL` (sem Redis vivo nos testes unitários). Espelha o padrão `DATABASE_URL` do credit-core.

Trade-off vs token-bucket: fixed-window pode deixar burst de 2× no seam de janela. Aceitável para MVP; token-bucket via Lua entra em F-I (observabilidade). O fixed-window é testável sem Lua e sem Redis real.

---

## File Structure

Arquivos **novos** (criar):
- `media-forge/src/http/key-store.ts` — adapter Postgres: lookup de key hasheada → tenant+tier+scopes; append de key
- `media-forge/src/http/tier-gates.ts` — mapa `Tier → Set<toolName>` calculado a partir dos nomes reais de `MCP_TOOLS`
- `media-forge/src/http/rate-limiter.ts` — fixed-window Redis (INCR+EXPIRE); interface `RateLimiter` + implementação `RedisRateLimiter`; `NullRateLimiter` (no-op para testes/self-host)
- `media-forge/migrations/001_tenants_keys.sql` — tabelas `tenants` + `api_keys`; índice único em `key_hash`
- `media-forge/scripts/create-key.mts` — script admin: gera raw key (32 bytes hex), calcula hash, insere tenant + key no DB, imprime raw key uma única vez
- `media-forge/tests/unit/http/key-store.test.ts`
- `media-forge/tests/unit/http/tier-gates.test.ts`
- `media-forge/tests/unit/http/rate-limiter.test.ts`
- `media-forge/tests/unit/http/auth-fc.test.ts` — testes da `resolveAuth` async (substitui os sync de F-A)
- `media-forge/tests/integration/http-mcp-tier.test.ts` — gating end-to-end

Arquivos **modificados**:
- `media-forge/src/http/auth.ts` — `AuthContext` estendido (`tenantId`, `tier`, `scopes`); `resolveAuth` vira async com assinatura nova; backward-compat via `resolveAuthFlat` (mantém testes F-A que testam a lógica plana)
- `media-forge/src/http/app-internal.ts` — propagação de `ctx.tier` para `buildServer`
- `media-forge/src/http/app.ts` — `await resolveAuth`; injeção de `store`+`limiter` via `HttpAppOpts`; check 429 antes de handle
- `media-forge/src/mcp/server.ts` — `BuildServerOpts` adiciona `tier?: Tier`; `buildServer` passa tier para `registerAllTools`; bump versão `'0.2.0'`
- `media-forge/src/mcp/handlers.ts` — `HandlersDeps` adiciona `tier?: Tier`; `registerAllTools` consome `TIER_GATES` para pular tools
- `media-forge/tests/unit/http/auth.test.ts` — migrar 4 testes sync para usar `resolveAuthFlat` (helper interno)
- `media-forge/package.json` — adicionar `pg`, `ioredis`; `version` bump `0.1.1 → 0.2.0`
- `.maxvision/deploy/media-forge-mcp.stack.yml` — adicionar serviço `mcp-postgres` + `mcp-redis`; envs `REDIS_URL`, `DATABASE_URL`, `MEDIA_FORGE_KEY_PEPPER`

---

## Task 1a: Schema Postgres + migration

**Files:** Create `media-forge/migrations/001_tenants_keys.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- media-forge/migrations/001_tenants_keys.sql
-- Tenancy: um tenant = uma assinatura/conta. Uma key por tenant (ou mais p/ rotação).
-- Nunca armazena a raw key — só o HMAC-SHA256 com pepper de env.

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
  scopes      TEXT[] NOT NULL DEFAULT '{}', -- ex: ['image','video'] — F-E usa; F-C ignora
  revoked_at  TIMESTAMPTZ,                 -- NULL = ativa; NOT NULL = revogada
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lookup O(1) pela chave de autenticacao (indice parcial: revogadas sao ignoradas)
-- NAO usar UNIQUE constraint na coluna — colidiria com reemissao de hash apos revogar.
-- O indice parcial garante unicidade entre keys ATIVAS e permite O(1) lookup.
CREATE UNIQUE INDEX IF NOT EXISTS ux_api_keys_hash_active ON api_keys (key_hash) WHERE revoked_at IS NULL;
-- Listagem de keys por tenant
CREATE INDEX IF NOT EXISTS ix_api_keys_tenant ON api_keys (tenant_id);
```

- [ ] **Step 2: Commit**

```bash
set -euo pipefail
cd media-forge
git add migrations/001_tenants_keys.sql
git commit -m "feat(fc): Postgres schema for tenants + hashed api_keys"
```

---

## Task 1b: Script `create-key.mts` (admin bootstrap)

**Files:** Create `media-forge/scripts/create-key.mts`

- [ ] **Step 1: Implementar**

```ts
// media-forge/scripts/create-key.mts
// Admin script: gera raw key, hash HMAC-SHA256, insere tenant + key no Postgres.
// Uso: DATABASE_URL=... MEDIA_FORGE_KEY_PEPPER=... pnpm tsx scripts/create-key.mts \
//        --tier creator --tenant-id <uuid-ou-novo>
// Imprime a raw key UMA VEZ. Não é recuperável depois.
import { createHmac, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith('--') ? [[a.slice(2), arr[i + 1] ?? '']] : [],
  ),
) as Record<string, string>;

const tier = (['free', 'creator', 'pro'] as const).find((t) => t === args['tier']) ?? 'creator';
const tenantId = args['tenant-id'] ?? randomUUID();
const pepper = process.env['MEDIA_FORGE_KEY_PEPPER'];
if (!pepper || pepper.length < 16) {
  process.stderr.write('MEDIA_FORGE_KEY_PEPPER must be set (>=16 chars)\n');
  process.exit(1);
}
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) { process.stderr.write('DATABASE_URL must be set\n'); process.exit(1); }

const rawKey = randomBytes(32).toString('hex'); // 64 chars hex — high-entropy
const keyHash = createHmac('sha256', pepper).update(rawKey).digest('hex');

const pool = new Pool({ connectionString: databaseUrl });
try {
  // Aplica migration se tabelas não existirem ainda
  const migrationPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '001_tenants_keys.sql');
  await pool.query(readFileSync(migrationPath, 'utf8'));

  await pool.query('BEGIN');
  await pool.query(
    `INSERT INTO tenants (id, tier) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET tier = EXCLUDED.tier`,
    [tenantId, tier],
  );
  await pool.query(
    `INSERT INTO api_keys (key_hash, tenant_id) VALUES ($1, $2)`,
    [keyHash, tenantId],
  );
  await pool.query('COMMIT');
  process.stdout.write(
    `tenant_id=${tenantId}\ntier=${tier}\nraw_key=${rawKey}\n` +
    `\nSAVE THE RAW KEY — IT WILL NOT BE SHOWN AGAIN.\n`,
  );
} catch (err) {
  await pool.query('ROLLBACK').catch(() => {});
  process.stderr.write(`Error: ${(err as Error).message}\n`);
  process.exit(1);
} finally {
  await pool.end();
}
```

- [ ] **Step 2: Adicionar `tsx` ao devDependencies e script ao package.json**

Em `media-forge/package.json` devDependencies (se não presente): `"tsx": "^4.19.0"`.
Em scripts: `"db:create-key": "tsx scripts/create-key.mts"`.

- [ ] **Step 3: Commit**

```bash
set -euo pipefail
cd media-forge
git add scripts/create-key.mts package.json
git commit -m "feat(fc): admin create-key script (HMAC-SHA256 hashed, inserts tenant+key)"
```

---

## Task 2: `hashKey` + `KeyStore` adapter Postgres

**Files:** Create `media-forge/src/http/key-store.ts`, Test `media-forge/tests/unit/http/key-store.test.ts`

- [ ] **Step 1: Test que falha**

```ts
// media-forge/tests/unit/http/key-store.test.ts
import { describe, it, expect } from 'vitest';
import { hashKey } from '../../../src/http/key-store.js';

describe('hashKey', () => {
  const pepper = 'test-pepper-1234';

  it('produz hex 64 chars', () => {
    expect(hashKey('my-raw-key', pepper)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('determinístico — mesma key+pepper → mesmo hash', () => {
    expect(hashKey('key-aaa', pepper)).toBe(hashKey('key-aaa', pepper));
  });

  it('sensível à key — keys diferentes → hashes diferentes', () => {
    expect(hashKey('key-aaa', pepper)).not.toBe(hashKey('key-bbb', pepper));
  });

  it('sensível ao pepper — peppers diferentes → hashes diferentes', () => {
    expect(hashKey('key-aaa', 'pepper-A')).not.toBe(hashKey('key-aaa', 'pepper-B'));
  });
});
```

- [ ] **Step 2: Rodar — falha**

Run: `cd media-forge && pnpm vitest run tests/unit/http/key-store.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar**

```ts
// media-forge/src/http/key-store.ts
// KeyStore: adapter Postgres para lookup de API key hasheada → AuthContext.
// hashKey é puro (testável sem DB). KeyStore requer Pool do Postgres.
import { createHmac } from 'node:crypto';
import type { Pool } from 'pg';
import type { AuthContext, Tier } from './auth.js';

/** HMAC-SHA256(pepper, rawKey) → hex 64 chars. Determinístico + indexável. */
export function hashKey(rawKey: string, pepper: string): string {
  return createHmac('sha256', pepper).update(rawKey).digest('hex');
}

export interface KeyRecord {
  tenantId: string;
  tier: Tier;
  scopes: string[];
}

export interface IKeyStore {
  /** Resolve uma raw key para o tenant/tier/scopes. null = key inválida ou revogada. */
  resolve(rawKey: string): Promise<KeyRecord | null>;
}

export class KeyStore implements IKeyStore {
  private pepper: string;

  constructor(
    private pool: Pool,
    pepper: string,
  ) {
    if (!pepper || pepper.length < 16) throw new Error('MEDIA_FORGE_KEY_PEPPER must be >=16 chars');
    this.pepper = pepper;
  }

  async resolve(rawKey: string): Promise<KeyRecord | null> {
    const kh = hashKey(rawKey, this.pepper);
    const r = await this.pool.query<{ tenant_id: string; tier: string; scopes: string[] }>(
      `SELECT t.id AS tenant_id, t.tier, k.scopes
         FROM api_keys k
         JOIN tenants t ON t.id = k.tenant_id
        WHERE k.key_hash = $1
          AND k.revoked_at IS NULL`,
      [kh],
    );
    if (r.rowCount === 0) return null;
    const row = r.rows[0]!;
    return {
      tenantId: row.tenant_id,
      tier: row.tier as Tier,
      scopes: row.scopes ?? [],
    };
  }
}

/** FlatKeyStore: backward-compat para MEDIA_FORGE_API_KEYS (lista plana).
 *  Usado em self-host sem Postgres e em testes unitários.
 *  Tier sempre 'pro'; tenantId = 'self'. */
export class FlatKeyStore implements IKeyStore {
  private keys: Set<string>;

  constructor(apiKeys: string) {
    this.keys = new Set(
      apiKeys
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    );
  }

  async resolve(rawKey: string): Promise<KeyRecord | null> {
    if (!this.keys.has(rawKey)) return null;
    return { tenantId: 'self', tier: 'pro', scopes: [] };
  }
}
```

- [ ] **Step 4: Rodar — passa**

Run: `cd media-forge && pnpm vitest run tests/unit/http/key-store.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
set -euo pipefail
cd media-forge
git add src/http/key-store.ts tests/unit/http/key-store.test.ts
git commit -m "feat(fc): hashKey (HMAC-SHA256 deterministic) + KeyStore + FlatKeyStore adapters"
```

---

## Task 3: `tier-gates.ts` — mapa tier → Set<toolName>

**Files:** Create `media-forge/src/http/tier-gates.ts`, Test `media-forge/tests/unit/http/tier-gates.test.ts`

- [ ] **Step 1: Test que falha**

```ts
// media-forge/tests/unit/http/tier-gates.test.ts
import { describe, it, expect } from 'vitest';
import { TIER_GATES, isToolAllowed } from '../../../src/http/tier-gates.js';

describe('TIER_GATES', () => {
  it('free tem acesso a media_generate_image', () => {
    expect(isToolAllowed('free', 'media_generate_image')).toBe(true);
  });

  it('free NÃO tem acesso a media_generate_video_t2v', () => {
    expect(isToolAllowed('free', 'media_generate_video_t2v')).toBe(false);
  });

  it('free NÃO tem acesso a nenhuma tool Higgsfield', () => {
    const higgsfieldTools = [...TIER_GATES.pro].filter((t) => t.startsWith('media_higgsfield'));
    for (const tool of higgsfieldTools) {
      expect(isToolAllowed('free', tool), `free should not have ${tool}`).toBe(false);
    }
  });

  it('creator tem acesso a media_generate_video_t2v', () => {
    expect(isToolAllowed('creator', 'media_generate_video_t2v')).toBe(true);
  });

  it('creator NÃO tem acesso a refs tools', () => {
    expect(isToolAllowed('creator', 'media_refs_search')).toBe(false);
  });

  it('pro tem acesso a todas as tools', () => {
    // Amostra — não enumerar 54 no teste; pro deve ter superset de creator
    expect(isToolAllowed('pro', 'media_refs_search')).toBe(true);
    expect(isToolAllowed('pro', 'media_generate_video_t2v')).toBe(true);
    expect(isToolAllowed('pro', 'media_generate_image')).toBe(true);
  });

  it('pro tem mais tools que creator', () => {
    expect(TIER_GATES.pro.size).toBeGreaterThan(TIER_GATES.creator.size);
  });

  it('creator tem mais tools que free', () => {
    expect(TIER_GATES.creator.size).toBeGreaterThan(TIER_GATES.free.size);
  });
});
```

- [ ] **Step 2: Rodar — falha**

Run: `cd media-forge && pnpm vitest run tests/unit/http/tier-gates.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
// media-forge/src/http/tier-gates.ts
// Mapa tier → Set de tool names permitidas.
// Nomes extraídos do MCP_TOOLS registry real (src/mcp/schemas.ts, 54 tools).
// Qualquer adição de tool ao registry deve ser categorizada aqui.
import type { Tier } from './auth.js';

// Categorias baseadas no MCP_TOOLS registry (schemas.ts)
const IMAGE_TOOLS = new Set([
  'media_generate_image',
  'media_generate_imagen',
  'media_edit_image',
  'media_compose_scene',
  'media_describe_image',
  'media_extract_palette',
]);

const UTILITY_TOOLS = new Set([
  'media_dry_run_payload',
  'media_estimate_cost',
  'media_validate_environment',
  'media_capability_matrix',
  'media_list_outputs',
  'media_get_job_metadata',
  'media_run_ocr',
  'media_check_brand_compliance',
]);

const HELP_TOOLS = new Set(['media_help']);

const VIDEO_TOOLS = new Set([
  'media_generate_video_t2v',
  'media_generate_video_i2v',
  'media_generate_video_interpolate',
  'media_generate_video_with_refs',
  'media_extend_video',
  'media_poll_video_operation',
  'media_download_video',
]);

const COST_TOOLS = new Set([
  'media_video_cost_estimate',
  'media_video_cost_report',
  'media_video_route',
  'media_video_webhook_status',
]);

const HIGGSFIELD_TOOLS = new Set([
  'media_higgsfield_soul_id',
  'media_higgsfield_dop',
  'media_higgsfield_cinema_studio',
  'media_higgsfield_speak',
  'media_higgsfield_marketing_studio',
  'media_higgsfield_recast',
  'media_higgsfield_virality_predictor',
  'media_higgsfield_generate',
  'media_higgsfield_poll',
  'media_higgsfield_download',
]);

const KLING_TOOLS = new Set([
  'media_kling_motion_brush',
  'media_kling_element_create',
  'media_kling_element_list',
  'media_kling_element_delete',
  'media_kling_elements',
  'media_kling_lip_sync',
  'media_kling_omni_multishot',
  'media_kling_video_extend',
  'media_kling_poll',
  'media_kling_download',
  // executor: confirmar 11ª tool de Kling contra schemas.ts e adicionar aqui
]);

const SEEDANCE_TOOLS = new Set([
  'media_seedance_text_to_video',
  'media_seedance_image_to_video',
  'media_seedance_multishot',
  'media_seedance_reference_fusion',
]);

const REFS_TOOLS = new Set([
  'media_refs_search',
  'media_refs_compose_moodboard',
  'media_refs_presign',
  'media_refs_index',
]);

function union(...sets: Set<string>[]): Set<string> {
  const out = new Set<string>();
  for (const s of sets) for (const v of s) out.add(v);
  return out;
}

export const TIER_GATES: Record<Tier, ReadonlySet<string>> = {
  // free: só imagem + utilidade + help (spec §4.4: "Free tier só caminho imagem")
  free: union(IMAGE_TOOLS, UTILITY_TOOLS, HELP_TOOLS),

  // creator: + vídeo (Veo/Kling/Higgsfield/Seedance) + custo/rota (cap por ciclo vem de F-E)
  creator: union(
    IMAGE_TOOLS, UTILITY_TOOLS, HELP_TOOLS,
    VIDEO_TOOLS, COST_TOOLS,
    HIGGSFIELD_TOOLS, KLING_TOOLS, SEEDANCE_TOOLS,
  ),

  // pro: tudo — inclui refs (pgvector) + todas as ferramentas
  pro: union(
    IMAGE_TOOLS, UTILITY_TOOLS, HELP_TOOLS,
    VIDEO_TOOLS, COST_TOOLS,
    HIGGSFIELD_TOOLS, KLING_TOOLS, SEEDANCE_TOOLS,
    REFS_TOOLS,
  ),
};

/** Verifica se uma tool está disponível para o tier informado. */
export function isToolAllowed(tier: Tier, toolName: string): boolean {
  return TIER_GATES[tier].has(toolName);
}
```

- [ ] **Step 4: Rodar — passa**

Run: `cd media-forge && pnpm vitest run tests/unit/http/tier-gates.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
set -euo pipefail
cd media-forge
git add src/http/tier-gates.ts tests/unit/http/tier-gates.test.ts
git commit -m "feat(fc): tier gates (free/creator/pro) mapped from real MCP_TOOLS registry"
```

---

## Task 4: `rate-limiter.ts` — fixed-window Redis + NullRateLimiter

**Files:** Create `media-forge/src/http/rate-limiter.ts`, Test `media-forge/tests/unit/http/rate-limiter.test.ts`

- [ ] **Step 1: Instalar deps**

Em `media-forge/package.json` dependencies: `"ioredis": "^5.4.0"`.
Em devDependencies: `"ioredis-mock": "^8.9.0"`.

Run: `cd media-forge && pnpm install`
Expected: lockfile atualizado.

- [ ] **Step 2: Test que falha**

```ts
// media-forge/tests/unit/http/rate-limiter.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import IORedisMock from 'ioredis-mock';
import { RedisRateLimiter, NullRateLimiter, type RateLimitResult } from '../../../src/http/rate-limiter.js';

describe('NullRateLimiter', () => {
  it('sempre permite', async () => {
    const lim = new NullRateLimiter();
    const r = await lim.check('tenant-x', 'pro');
    expect(r.allowed).toBe(true);
  });
});

describe('RedisRateLimiter', () => {
  let redis: IORedisMock;
  let limiter: RedisRateLimiter;

  beforeEach(() => {
    redis = new IORedisMock();
    // limite baixo pra teste: 3 req/janela de 60s para tier 'free'
    limiter = new RedisRateLimiter(redis as never, { free: 3, creator: 120, pro: 600 }, 60);
  });

  it('permite até o limite', async () => {
    for (let i = 0; i < 3; i++) {
      const r = await limiter.check('t1', 'free');
      expect(r.allowed, `request ${i + 1} deve ser permitida`).toBe(true);
    }
  });

  it('bloqueia após atingir o limite', async () => {
    for (let i = 0; i < 3; i++) await limiter.check('t1', 'free');
    const r = await limiter.check('t1', 'free');
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
  });

  it('tenants independentes não se afetam', async () => {
    for (let i = 0; i < 3; i++) await limiter.check('t1', 'free');
    const r = await limiter.check('t2', 'free'); // t2 ainda não usou
    expect(r.allowed).toBe(true);
  });

  it('creator tem limite maior que free', async () => {
    // 4 requests: passa para creator mas bloquearia free (limite=3)
    for (let i = 0; i < 4; i++) await limiter.check('t3', 'creator');
    const r = await limiter.check('t3', 'creator');
    expect(r.allowed).toBe(true); // creator tem 120, não 3
  });
});
```

- [ ] **Step 3: Rodar — falha**

Run: `cd media-forge && pnpm vitest run tests/unit/http/rate-limiter.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implementar**

```ts
// media-forge/src/http/rate-limiter.ts
// Rate-limit por tenant: fixed-window INCR+EXPIRE via ioredis.
// NullRateLimiter: no-op para self-host sem Redis e para testes.
import type { Redis } from 'ioredis';
import type { Tier } from './auth.js';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec?: number; // presente apenas quando allowed=false
}

export interface RateLimiter {
  check(tenantId: string, tier: Tier): Promise<RateLimitResult>;
}

export type TierLimits = Record<Tier, number>; // req por janela

const DEFAULT_LIMITS: TierLimits = { free: 20, creator: 120, pro: 600 };
const DEFAULT_WINDOW_SEC = 60;

export class RedisRateLimiter implements RateLimiter {
  constructor(
    private redis: Redis,
    private limits: TierLimits = DEFAULT_LIMITS,
    private windowSec: number = DEFAULT_WINDOW_SEC,
  ) {}

  async check(tenantId: string, tier: Tier): Promise<RateLimitResult> {
    const limit = this.limits[tier];
    const now = Math.floor(Date.now() / 1000);
    const windowStart = Math.floor(now / this.windowSec) * this.windowSec;
    const key = `rl:${tenantId}:${windowStart}`;

    const count = await this.redis.incr(key);
    if (count === 1) {
      // Primeira requisição da janela — define TTL para expirar automaticamente
      await this.redis.expire(key, this.windowSec + 1);
    }

    if (count > limit) {
      const retryAfterSec = windowStart + this.windowSec - now;
      return { allowed: false, retryAfterSec: Math.max(1, retryAfterSec) };
    }
    return { allowed: true };
  }
}

/** No-op: usado em self-host (sem Redis) e em testes unitários de auth/app. */
export class NullRateLimiter implements RateLimiter {
  async check(_tenantId: string, _tier: Tier): Promise<RateLimitResult> {
    return { allowed: true };
  }
}

/** Factory: retorna RedisRateLimiter se REDIS_URL presente, NullRateLimiter caso contrário. */
export function createRateLimiter(env: NodeJS.ProcessEnv = process.env): RateLimiter {
  const url = env['REDIS_URL'];
  if (!url) return new NullRateLimiter();
  // Importação dinâmica para não exigir ioredis em ambientes sem Redis
  const { default: Redis } = require('ioredis') as { default: new (url: string) => Redis };
  return new RedisRateLimiter(new Redis(url));
}
```

> Nota: `require` dinâmico em `createRateLimiter` é intencional pra evitar importação de ioredis em ambientes sem o pacote. Se houver conflito de tipos com ESM, substituir por `await import('ioredis')` em uma factory async — o executor ajusta conforme o tsconfig do projeto (NodeNext + ESM).

- [ ] **Step 5: Rodar — passa**

Run: `cd media-forge && pnpm vitest run tests/unit/http/rate-limiter.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
set -euo pipefail
cd media-forge
git add src/http/rate-limiter.ts tests/unit/http/rate-limiter.test.ts package.json pnpm-lock.yaml
git commit -m "feat(fc): fixed-window Redis rate-limiter + NullRateLimiter (ioredis-mock tests)"
```

---

## Task 5: Estender `AuthContext` + `resolveAuth` async

**Files:** Modify `media-forge/src/http/auth.ts`, Modify `media-forge/tests/unit/http/auth.test.ts`

> Esta task muda a assinatura pública de `resolveAuth` de sync para async e injeta `tenantId`/`tier`/`scopes` no `AuthContext`. Os 4 testes sync de F-A são migrados para usar a `FlatKeyStore` diretamente (lógica plana permanece testada via `FlatKeyStore.resolve`).

- [ ] **Step 1: Migrar testes legados de F-A**

```ts
// media-forge/tests/unit/http/auth.test.ts
// Migrado de F-A: testa a lógica plana via FlatKeyStore (que é o que F-A usava).
// resolveAuth async é testado em auth-fc.test.ts (Task 5 Step 3).
import { describe, it, expect } from 'vitest';
import { FlatKeyStore } from '../../../src/http/key-store.js';

describe('FlatKeyStore (lógica plana de F-A)', () => {
  const store = new FlatKeyStore('key-aaa,key-bbb');

  it('aceita key válida → tier pro + tenantId self', async () => {
    const r = await store.resolve('key-aaa');
    expect(r).not.toBeNull();
    expect(r!.tier).toBe('pro');
    expect(r!.tenantId).toBe('self');
  });

  it('rejeita key desconhecida', async () => {
    expect(await store.resolve('nope')).toBeNull();
  });

  it('rejeita string vazia', async () => {
    expect(await store.resolve('')).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar — deve passar (FlatKeyStore já existe da Task 2)**

Run: `cd media-forge && pnpm vitest run tests/unit/http/auth.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 3: Implementar auth.ts estendido**

```ts
// media-forge/src/http/auth.ts
// Autenticação do transporte HTTP. F-C: AuthContext estendido + resolveAuth async.
// F-A: resolveAuth sync foi substituído; FlatKeyStore (key-store.ts) preserva a lógica plana.
import type { IKeyStore } from './key-store.js';

export type Tier = 'free' | 'creator' | 'pro';

export interface AuthContext {
  apiKey: string;     // raw key apresentada (nunca persistida — só usada no request)
  tenantId: string;   // F-C: id do tenant no Postgres (ou 'self' no modo flat/self-host)
  tier: Tier;         // F-C: tier do tenant
  scopes: string[];   // F-C: escopos da key (ex: ['image','video']) — F-E usa; F-C propaga
}

export type AuthResult = { ok: true; ctx: AuthContext } | { ok: false; reason: string };

/** Extrai Bearer token do header Authorization. */
function extractBearer(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return m ? (m[1] ?? '').trim() : null;
}

/**
 * Resolve a raw key via store (Postgres ou plana).
 * Async — o store pode fazer I/O (DB lookup).
 */
export async function resolveAuth(
  authHeader: string | undefined,
  store: IKeyStore,
): Promise<AuthResult> {
  const rawKey = extractBearer(authHeader);
  if (!rawKey) return { ok: false, reason: 'missing or malformed Authorization header' };

  const record = await store.resolve(rawKey);
  if (!record) return { ok: false, reason: 'unknown or revoked API key' };

  return {
    ok: true,
    ctx: {
      apiKey: rawKey,
      tenantId: record.tenantId,
      tier: record.tier,
      scopes: record.scopes,
    },
  };
}
```

- [ ] **Step 4: Testes da `resolveAuth` async (com store fake)**

```ts
// media-forge/tests/unit/http/auth-fc.test.ts
import { describe, it, expect } from 'vitest';
import { resolveAuth } from '../../../src/http/auth.js';
import type { IKeyStore, KeyRecord } from '../../../src/http/key-store.js';

const makeStore = (map: Record<string, KeyRecord>): IKeyStore => ({
  async resolve(k: string) { return map[k] ?? null; },
});

const store = makeStore({
  'key-creator': { tenantId: 'tenant-1', tier: 'creator', scopes: [] },
  'key-free': { tenantId: 'tenant-2', tier: 'free', scopes: [] },
  'key-pro': { tenantId: 'tenant-3', tier: 'pro', scopes: ['image', 'video'] },
});

describe('resolveAuth async', () => {
  it('aceita Bearer válido → AuthContext com tenantId+tier+scopes', async () => {
    const r = await resolveAuth('Bearer key-creator', store);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ctx.tenantId).toBe('tenant-1');
      expect(r.ctx.tier).toBe('creator');
      expect(r.ctx.apiKey).toBe('key-creator');
    }
  });

  it('rejeita header ausente', async () => {
    const r = await resolveAuth(undefined, store);
    expect(r.ok).toBe(false);
  });

  it('rejeita key desconhecida', async () => {
    const r = await resolveAuth('Bearer nope', store);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('unknown');
  });

  it('rejeita esquema não-Bearer', async () => {
    const r = await resolveAuth('Basic key-creator', store);
    expect(r.ok).toBe(false);
  });

  it('free tier: tenantId e scopes presentes', async () => {
    const r = await resolveAuth('Bearer key-free', store);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ctx.tier).toBe('free');
      expect(Array.isArray(r.ctx.scopes)).toBe(true);
    }
  });

  it('pro tier: scopes retornados do store', async () => {
    const r = await resolveAuth('Bearer key-pro', store);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ctx.scopes).toEqual(['image', 'video']);
  });
});
```

- [ ] **Step 5: Rodar — passa**

Run: `cd media-forge && pnpm vitest run tests/unit/http/auth-fc.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
set -euo pipefail
cd media-forge
git add src/http/auth.ts tests/unit/http/auth.test.ts tests/unit/http/auth-fc.test.ts
git commit -m "feat(fc): extend AuthContext (tenantId/tier/scopes) + async resolveAuth via IKeyStore"
```

---

## Task 6: Atualizar `app.ts` — await resolveAuth + rate-limit 429

**Files:** Modify `media-forge/src/http/app.ts`

> `app.ts` chama `handleMcpRequest(c.req.raw, auth.ctx, env)` — 3 args (confirmado no arquivo real). Adiciona injeção de `store` + `limiter` via `HttpAppOpts`. `resolveAuth` vira `await`. Check de rate-limit após auth, antes de handle. Testes unitários de app.test.ts precisam de atualização mínima (store injetado).

- [ ] **Step 1: Atualizar testes `app.test.ts`**

```ts
// media-forge/tests/unit/http/app.test.ts
import { describe, it, expect } from 'vitest';
import { buildHttpApp } from '../../../src/http/app.js';
import { FlatKeyStore } from '../../../src/http/key-store.js';
import { NullRateLimiter } from '../../../src/http/rate-limiter.js';

const store = new FlatKeyStore('key-aaa');
const limiter = new NullRateLimiter();
const env = { MEDIA_FORGE_API_KEYS: 'key-aaa' } as NodeJS.ProcessEnv;

describe('buildHttpApp', () => {
  it('GET /health → 200 {ok:true}', async () => {
    const app = buildHttpApp({ env, store, limiter });
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('POST /mcp sem auth → 401', async () => {
    const app = buildHttpApp({ env, store, limiter });
    const res = await app.request('/mcp', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
  });

  it('GET /metrics → 200 text', async () => {
    const app = buildHttpApp({ env, store, limiter });
    const res = await app.request('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
  });
});

describe('rate-limit 429', () => {
  it('limiter bloqueando → 429 + Retry-After', async () => {
    // Limiter que sempre bloqueia
    const blockingLimiter = {
      async check() { return { allowed: false, retryAfterSec: 30 }; },
    };
    const app = buildHttpApp({ env, store, limiter: blockingLimiter });
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { Authorization: 'Bearer key-aaa', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('30');
  });
});
```

- [ ] **Step 2: Rodar — falha (app.ts precisa aceitar store+limiter)**

Run: `cd media-forge && pnpm vitest run tests/unit/http/app.test.ts`
Expected: FAIL (assinatura incompatível).

- [ ] **Step 3: Implementar**

```ts
// media-forge/src/http/app.ts
// Hono app do transporte HTTP. F-C: resolveAuth async + rate-limit + store injetável.
import { Hono } from 'hono';
import { resolveAuth } from './auth.js';
import { handleMcpRequest } from './app-internal.js';
import type { IKeyStore } from './key-store.js';
import { FlatKeyStore } from './key-store.js';
import type { RateLimiter } from './rate-limiter.js';
import { NullRateLimiter } from './rate-limiter.js';

export interface HttpAppOpts {
  env?: NodeJS.ProcessEnv;
  store?: IKeyStore;
  limiter?: RateLimiter;
}

export function buildHttpApp(opts: HttpAppOpts = {}) {
  const env = opts.env ?? process.env;
  const store: IKeyStore =
    opts.store ??
    new FlatKeyStore(env['MEDIA_FORGE_API_KEYS'] ?? '');
  const limiter: RateLimiter = opts.limiter ?? new NullRateLimiter();
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true }));
  app.get('/metrics', (c) =>
    c.text('# media-forge metrics\n', 200, { 'content-type': 'text/plain; version=0.0.4' }),
  );

  app.post('/mcp', async (c) => {
    // 1. Autenticação
    const auth = await resolveAuth(c.req.header('Authorization'), store);
    if (!auth.ok) return c.json({ error: 'unauthorized', reason: auth.reason }, 401);

    // 2. Rate-limit por tenant
    const rl = await limiter.check(auth.ctx.tenantId, auth.ctx.tier);
    if (!rl.allowed) {
      return c.json(
        { error: 'rate_limit_exceeded' },
        429,
        { 'Retry-After': String(rl.retryAfterSec ?? 60) },
      );
    }

    // 3. Handle MCP (propaga ctx com tenantId+tier+scopes)
    return handleMcpRequest(c.req.raw, auth.ctx, env);
  });

  return app;
}
```

- [ ] **Step 4: Rodar — passa**

Run: `cd media-forge && pnpm vitest run tests/unit/http/app.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
set -euo pipefail
cd media-forge
git add src/http/app.ts tests/unit/http/app.test.ts
git commit -m "feat(fc): app.ts await resolveAuth + 429 rate-limit check + store/limiter injection"
```

---

## Task 7: Propagar tier pelo `buildServer` → `registerAllTools` (gating)

**Files:** Modify `media-forge/src/http/app-internal.ts`, Modify `media-forge/src/mcp/server.ts`, Modify `media-forge/src/mcp/handlers.ts`

> Cadeia de propagação: `handleMcpRequest(req, ctx, env)` → `buildServer({config, tier: ctx.tier})` → `registerAllTools(server, {client, config, tier})` → pula `reg(...)` de tools fora do gate.

- [ ] **Step 1: Estender `BuildServerOpts` e `HandlersDeps` + bump versão**

Em `media-forge/src/mcp/server.ts`:

```ts
// Adicionar ao BuildServerOpts
export interface BuildServerOpts {
  config?: ReturnType<typeof loadConfig>;
  client?: ReturnType<typeof createClient>;
  tier?: Tier; // F-C: gating de tools por tier
}
```

Dentro de `buildServer`, passar `tier` para `registerAllTools`:
```ts
// em buildServer, a linha existente:
//   registerAllTools(server, { client, config });
// vira:
registerAllTools(server, { client, config, tier: opts.tier ?? 'pro' });
```

Bump de versão no construtor do McpServer:
```ts
// de: new McpServer({ name: 'media-forge', version: '0.1.1' })
// para:
const server = new McpServer({ name: 'media-forge', version: '0.2.0' });
```

Em `media-forge/package.json`: `"version": "0.2.0"`.

- [ ] **Step 2: Estender `HandlersDeps` em handlers.ts**

No topo de `registerAllTools`:
```ts
// Adicionar import no topo do arquivo:
import type { Tier } from '../http/auth.js';
import { isToolAllowed } from '../http/tier-gates.js';

// Estender HandlersDeps:
export interface HandlersDeps {
  client: ReturnType<typeof createClient>;
  config: ReturnType<typeof loadConfig>;
  tier?: Tier; // F-C: undefined = 'pro' (backward compat para stdio/testes existentes)
}

// Em registerAllTools:
export function registerAllTools(server: McpServer, deps: HandlersDeps): void {
  const { client, config } = deps;
  const effectiveTier: Tier = deps.tier ?? 'pro';
  const reg = looseRegister(server);

  // Wrapper que só registra se o tier permitir
  function regIfAllowed(toolName: string, ...args: Parameters<typeof reg>) {
    if (!isToolAllowed(effectiveTier, toolName)) return; // tool gated — não registra
    reg(...args);
  }
  // ... substituir todas as chamadas reg( com regIfAllowed( passando t.name como 1º arg
```

> Atenção: o padrão de cada tool é `reg(t.name, { ... }, handler)`. A substituição é `regIfAllowed(t.name, t.name, { ... }, handler)`. O executor deve fazer isso para todas as ~54 chamadas de `reg(` no `registerAllTools` — search+replace com ajuste manual de assinatura.

- [ ] **Step 3: Atualizar `app-internal.ts` — injetar tier**

```ts
// media-forge/src/http/app-internal.ts
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { buildServer } from '../mcp/server.js';
import { loadConfig } from '../core/config.js';
import type { AuthContext } from './auth.js';

export async function handleMcpRequest(
  req: Request,
  ctx: AuthContext,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Response> {
  // ctx.tier propaga para gating de tools (F-C).
  // ctx.tenantId disponível para audit/billing futuro (F-E).
  const config = loadConfig(env);
  const server = buildServer({ config, tier: ctx.tier });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}
```

- [ ] **Step 4: Typecheck**

Run: `cd media-forge && pnpm typecheck`
Expected: 0 erros. Se houver erros de tipo em handlers.ts pelo `regIfAllowed`, ajustar assinatura do wrapper para manter compatibilidade com `looseRegister`.

- [ ] **Step 5: Commit**

```bash
set -euo pipefail
cd media-forge
git add src/mcp/server.ts src/mcp/handlers.ts src/http/app-internal.ts package.json
git commit -m "feat(fc): propagate tier through buildServer/registerAllTools; bump v0.2.0; gate tools by tier"
```

---

## Task 8: Teste de integração end-to-end — gating por tier

**Files:** Create `media-forge/tests/integration/http-mcp-tier.test.ts`

- [ ] **Step 1: Test**

```ts
// media-forge/tests/integration/http-mcp-tier.test.ts
import { describe, it, expect } from 'vitest';
import { buildHttpApp } from '../../src/http/app.js';
import { FlatKeyStore } from '../../src/http/key-store.js';
import { NullRateLimiter } from '../../src/http/rate-limiter.js';
import type { IKeyStore, KeyRecord } from '../../src/http/key-store.js';

// Store fake: key-free → free, key-creator → creator
const fakeStore: IKeyStore = {
  async resolve(k: string): Promise<KeyRecord | null> {
    if (k === 'key-free') return { tenantId: 't-free', tier: 'free', scopes: [] };
    if (k === 'key-creator') return { tenantId: 't-creator', tier: 'creator', scopes: [] };
    return null;
  },
};
const limiter = new NullRateLimiter();
const env = { GOOGLE_API_KEY: 'test-key' } as NodeJS.ProcessEnv;

const toolsListBody = JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
});

async function listTools(key: string): Promise<string[]> {
  const app = buildHttpApp({ env, store: fakeStore, limiter });
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: toolsListBody,
  });
  if (res.status !== 200) return [];
  const json = await res.json() as { result?: { tools?: Array<{ name: string }> } };
  return json.result?.tools?.map((t) => t.name) ?? [];
}

describe('tier gating (integração MCP)', () => {
  it('free tier: media_generate_image presente', async () => {
    const tools = await listTools('key-free');
    expect(tools).toContain('media_generate_image');
  });

  it('free tier: media_generate_video_t2v AUSENTE', async () => {
    const tools = await listTools('key-free');
    expect(tools).not.toContain('media_generate_video_t2v');
  });

  it('free tier: nenhuma tool Higgsfield presente', async () => {
    const tools = await listTools('key-free');
    const higgsfield = tools.filter((t) => t.startsWith('media_higgsfield'));
    expect(higgsfield).toHaveLength(0);
  });

  it('creator tier: media_generate_video_t2v presente', async () => {
    const tools = await listTools('key-creator');
    expect(tools).toContain('media_generate_video_t2v');
  });

  it('creator tier: media_refs_search AUSENTE', async () => {
    const tools = await listTools('key-creator');
    expect(tools).not.toContain('media_refs_search');
  });
});
```

- [ ] **Step 2: Rodar**

Run: `cd media-forge && pnpm vitest run tests/integration/http-mcp-tier.test.ts`
Expected: PASS (5 tests). Se a integração exigir env adicional (ex.: GOOGLE_API_KEY, MEDIA_FORGE_REFS_ENABLED), ajustar `env` no teste.

- [ ] **Step 3: Commit**

```bash
set -euo pipefail
cd media-forge
git add tests/integration/http-mcp-tier.test.ts
git commit -m "test(fc): integration tier gating — free/creator tool lists verified via MCP tools/list"
```

---

## Task 9: Atualizar stack — Redis + Postgres + envs F-C

**Files:** Modify `.maxvision/deploy/media-forge-mcp.stack.yml`

> O stack atual tem o comentário explícito: "serviço mcp_redis (sem consumidor até F-C)" e "REDIS_URL" foram removidos. F-C reintroduz ambos. Adicionar também `mcp-postgres` (Postgres próprio do media-forge) e as envs `DATABASE_URL`, `MEDIA_FORGE_KEY_PEPPER`.

- [ ] **Step 1: Editar stack**

```yaml
# media-forge-mcp — Swarm stack (MCP HTTP hospedado da forja de mídia)
# F-C: reintroduz mcp-redis (rate-limit por tenant) + mcp-postgres (tenants/keys hasheadas).
# Contrato de env = SOMENTE o que o código consome. Secrets via Portainer — nunca no arquivo.
# Redeploy: Portainer (stack id 69) ou: docker stack deploy -c media-forge-mcp.stack.yml media-forge-mcp

version: "3.9"

services:
  mcp-server:
    image: ghcr.io/produtoramaxvision/media-forge-mcp:${MEDIA_FORGE_TAG:-latest}
    networks:
      - net
    depends_on:
      - mcp-redis
      - mcp-postgres
    environment:
      NODE_ENV: production
      TZ: America/Sao_Paulo
      MEDIA_FORGE_HTTP_PORT: "3000"
      MEDIA_FORGE_LOG_LEVEL: info
      MEDIA_FORGE_LOG_FORMAT: json
      MEDIA_FORGE_REFS_ENABLED: "false"
      # F-A auth (mantida para self-host/bootstrap — se DATABASE_URL presente, ignorada pelo KeyStore real)
      MEDIA_FORGE_API_KEYS: ${MEDIA_FORGE_API_KEYS}
      # F-C tenancy
      DATABASE_URL: ${DATABASE_URL}
      MEDIA_FORGE_KEY_PEPPER: ${MEDIA_FORGE_KEY_PEPPER}
      # F-C rate-limit
      REDIS_URL: redis://mcp-redis:6379
      # Providers
      GOOGLE_API_KEY: ${GOOGLE_API_KEY}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      MEDIA_FORGE_OCR_GOOGLE_VISION_KEY: ${MEDIA_FORGE_OCR_GOOGLE_VISION_KEY}
      FAL_KEY: ${FAL_KEY}
      BYTEPLUS_ARK_API_KEY: ${BYTEPLUS_ARK_API_KEY}
      HF_API_KEY: ${HF_API_KEY}
      HF_API_SECRET: ${HF_API_SECRET}
    deploy:
      replicas: 1
      restart_policy:
        condition: on-failure
      update_config:
        order: start-first
      labels:
        - traefik.enable=true
        - traefik.docker.network=net
        - traefik.http.routers.media-forge.entrypoints=websecure
        - traefik.http.routers.media-forge.rule=Host(`media-forge.produtoramaxvision.com.br`)
        - traefik.http.routers.media-forge.tls=true
        - traefik.http.routers.media-forge.tls.certresolver=letsencryptresolver
        - traefik.http.services.media-forge.loadbalancer.server.port=3000

  mcp-redis:
    image: redis:7-alpine
    networks:
      - net
    command: redis-server --save "" --appendonly no --maxmemory 64mb --maxmemory-policy allkeys-lru
    deploy:
      replicas: 1
      restart_policy:
        condition: on-failure
      resources:
        limits:
          memory: 96M

  mcp-postgres:
    image: postgres:16-alpine
    networks:
      - net
    environment:
      POSTGRES_DB: media_forge
      POSTGRES_USER: media_forge
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - mcp-pg-data:/var/lib/postgresql/data
    deploy:
      replicas: 1
      restart_policy:
        condition: on-failure
      resources:
        limits:
          memory: 256M
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U media_forge -d media_forge"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  mcp-pg-data:

networks:
  net:
    external: true
```

> Envs a configurar no Portainer (novas em F-C): `DATABASE_URL` (ex.: `postgres://media_forge:<POSTGRES_PASSWORD>@mcp-postgres:5432/media_forge`), `MEDIA_FORGE_KEY_PEPPER` (32+ chars aleatórios, nunca commitar), `POSTGRES_PASSWORD`.

- [ ] **Step 2: Commit**

```bash
set -euo pipefail
git add .maxvision/deploy/media-forge-mcp.stack.yml
git commit -m "deploy(fc): add mcp-redis + mcp-postgres to stack; wire REDIS_URL/DATABASE_URL/KEY_PEPPER"
```

---

## Task 10: Adicionar `pg` ao package.json + inicialização do store no `server.ts`

**Files:** Modify `media-forge/package.json`, Modify `media-forge/src/http/server.ts`

> O `startHttpServer()` criado em F-A precisa instanciar o store real (KeyStore com Postgres) ou o fallback (FlatKeyStore) e o rate-limiter real (RedisRateLimiter) e injetá-los no `buildHttpApp`.

- [ ] **Step 1: Adicionar `pg` ao package.json**

Em `media-forge/package.json` dependencies: `"pg": "^8.13.0"`.
Em devDependencies: `"@types/pg": "^8.11.0"`.

Run: `cd media-forge && pnpm install`

- [ ] **Step 2: Atualizar `startHttpServer`**

```ts
// media-forge/src/http/server.ts
import { serve } from '@hono/node-server';
import { buildHttpApp } from './app.js';
import { KeyStore, FlatKeyStore } from './key-store.js';
import { createRateLimiter } from './rate-limiter.js';
import { logger } from '../core/logger.js';

export function startHttpServer(): void {
  const port = Number(process.env['MEDIA_FORGE_HTTP_PORT'] ?? 8787);
  const env = process.env;

  // Escolha do store: KeyStore (Postgres) se DATABASE_URL presente, FlatKeyStore caso contrário.
  // Graceful degradation: self-host sem Postgres usa MEDIA_FORGE_API_KEYS plana.
  let store: ConstructorParameters<typeof buildHttpApp>[0]['store'];
  const databaseUrl = env['DATABASE_URL'];
  if (databaseUrl) {
    const { Pool } = require('pg') as typeof import('pg');
    const pepper = env['MEDIA_FORGE_KEY_PEPPER'];
    if (!pepper) {
      logger.error('MEDIA_FORGE_KEY_PEPPER must be set when DATABASE_URL is configured');
      process.exit(1);
    }
    const pool = new Pool({ connectionString: databaseUrl });
    store = new KeyStore(pool, pepper);
    logger.info('media-forge: using Postgres KeyStore (F-C tenancy)');
  } else {
    const flatKeys = env['MEDIA_FORGE_API_KEYS'] ?? '';
    if (!flatKeys) {
      logger.error('Either DATABASE_URL or MEDIA_FORGE_API_KEYS must be set');
      process.exit(1);
    }
    store = new FlatKeyStore(flatKeys);
    logger.info('media-forge: using flat KeyStore (F-A compat, no tenancy)');
  }

  const limiter = createRateLimiter(env);

  const app = buildHttpApp({ store, limiter });
  serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });
  logger.info('media-forge MCP HTTP server ready', { port, tenancy: !!databaseUrl });
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startHttpServer();
}
```

- [ ] **Step 3: Typecheck**

Run: `cd media-forge && pnpm typecheck`
Expected: 0 erros.

- [ ] **Step 4: Commit**

```bash
set -euo pipefail
cd media-forge
git add src/http/server.ts package.json pnpm-lock.yaml
git commit -m "feat(fc): startHttpServer wires KeyStore+RateLimiter; graceful fallback to FlatKeyStore"
```

---

## Task 11: Validação final F-C

- [ ] **Step 1: Suite completa**

Run: `cd media-forge && pnpm typecheck && pnpm lint && pnpm test`
Expected:
- `pnpm typecheck`: 0 erros
- `pnpm lint`: sem warnings novos
- `pnpm test`: todos os testes verdes, incluindo:
  - `tests/unit/http/key-store.test.ts` (4 tests — hashKey)
  - `tests/unit/http/tier-gates.test.ts` (8 tests)
  - `tests/unit/http/rate-limiter.test.ts` (7 tests — NullRateLimiter + RedisRateLimiter via ioredis-mock)
  - `tests/unit/http/auth.test.ts` (3 tests — FlatKeyStore migrado)
  - `tests/unit/http/auth-fc.test.ts` (6 tests — resolveAuth async)
  - `tests/unit/http/app.test.ts` (4 tests — incluindo 429)
  - `tests/integration/http-mcp.test.ts` (1 test — F-A, não deve regredir)
  - `tests/integration/http-mcp-tier.test.ts` (5 tests — gating end-to-end)
- Suite legada (stdio, image, video) intacta

- [ ] **Step 2: Smoke manual (opcional — requer Postgres+Redis locais)**

```bash
set -euo pipefail
cd media-forge
pnpm build
DATABASE_URL=postgres://localhost/media_forge_test \
  MEDIA_FORGE_KEY_PEPPER=test-pepper-min16chars \
  REDIS_URL=redis://localhost:6379 \
  MEDIA_FORGE_HTTP_PORT=8788 \
  node dist/http/server.js &
SERVER_PID=$!
sleep 2
# Criar key de teste
DATABASE_URL=postgres://localhost/media_forge_test \
  MEDIA_FORGE_KEY_PEPPER=test-pepper-min16chars \
  pnpm db:create-key --tier free
# (copiar a raw_key impressa e testar)
kill $SERVER_PID
```

- [ ] **Step 3: Verificar fallow (gate de PR)**

Run: `cd media-forge && pnpm exec fallow audit --format json --quiet`
Expected: verdict `pass` (ou `warn` sem novos erros de arquitetura).

- [ ] **Step 4: Commit final de versão**

```bash
set -euo pipefail
cd media-forge
git add -p  # revisar arquivos residuais se houver
git commit -m "chore(fc): v0.2.0 validation pass — typecheck+lint+tests green"
```

---

## Self-Review

### Spec coverage
- §6 hashing: HMAC-SHA256 com pepper (D2) — Tasks 1a, 2, 5. Nunca plaintext.
- §6 rate-limit Redis: fixed-window INCR+EXPIRE por tenant — Tasks 4, 6, 9.
- §6 gating server-side: tier→Set<toolName> via `TIER_GATES` — Tasks 3, 7, 8.
- §6 revogação: `revoked_at` na tabela `api_keys` (deletar linha = revogar) — Task 1a.
- §3.4 modo hosted vs self: `FlatKeyStore` mantém self-host via `MEDIA_FORGE_API_KEYS`; `KeyStore` ativa com `DATABASE_URL` — Task 10.
- §4.4 "Free tier só caminho imagem": `TIER_GATES.free` = IMAGE_TOOLS + UTILITY_TOOLS + HELP_TOOLS, zero vídeo — Task 3.
- §4.3 tiers: `free`/`creator`/`pro` ancorados nos números da spec — D3.
- Deploy: stack atualizado com redis:7-alpine + postgres:16-alpine + envs `REDIS_URL`/`DATABASE_URL`/`MEDIA_FORGE_KEY_PEPPER` — Task 9.
- Versão v0.2.0: package.json + McpServer — Task 7.

### Placeholder scan
- Todos os tasks têm código TypeScript completo (sem `// TODO`, `// FIXME`, `...`).
- Task 7 Step 2: a instrução de substituição `reg(` → `regIfAllowed(` é explícita; o executor aplica para as ~54 chamadas — marcado como passo manual, não oculto.
- Task 4 nota `require` dinâmico: alternativa async documentada — sem TBD silencioso.
- Kling 11ª tool: confirmação do nome real contra schemas.ts indicada ao executor — não é placeholder, é verificação de contagem.

### Type consistency
- `Tier = 'free' | 'creator' | 'pro'` definido em `auth.ts` — importado por `key-store.ts`, `tier-gates.ts`, `rate-limiter.ts`, `server.ts`, `handlers.ts`.
- `IKeyStore` (key-store.ts) é a interface que `app.ts` + `server.ts` consomem — `KeyStore` e `FlatKeyStore` a implementam.
- `AuthContext` estendido (tenantId/tier/scopes) flui: `resolveAuth` → `app.ts` → `handleMcpRequest` (3 args, confirmado no arquivo real) → `buildServer({tier})` → `registerAllTools({tier})`.
- `BuildServerOpts.tier` é opcional com default `'pro'` — backward-compat para `buildServer()` sem args em testes e no modo stdio.

### Itens fora de escopo (diferidos)
- Cost-gate server-side antes de despachar (spec §6) → F-E (depende de `credit-core`).
- Quote-before-run → F-E.
- Quota/concorrência por tenant → F-E.
- Idempotência em tools caras → F-E.
- Licença JWT para self-host (tier via `MEDIA_FORGE_LICENSE`) → F-F.
- Audit logging (tenantId+tool+custo, nunca PII) → F-I (observabilidade).
- Modo `MEDIA_FORGE_MODE=self` explícito no env contract → F-F (licença C1).

### Decisões em aberto residuais (nenhuma bloqueia F-C)
Nenhuma. As 4 decisões (D1 Postgres próprio, D2 HMAC-SHA256, D3 tiers, D4 fixed-window) foram tomadas e documentadas.

### Contagem de tasks
**10 tasks de implementação** (1a, 1b, 2, 3, 4, 5, 6, 7, 8, 9, 10) + **1 task de validação** (11) = **11 tasks** totais.

Estimativa de steps: ~50 steps (checkboxes) entre Red/Green/Commit + typecheck + gates.
