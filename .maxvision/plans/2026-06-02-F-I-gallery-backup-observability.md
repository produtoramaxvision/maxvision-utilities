# media-forge F-I — Gallery, Backup & Margin Observability

> **For agentic workers:** REQUIRED SUB-SKILL: `maxvision:subagent-driven-development` (recommended) ou `maxvision:executing-plans`. Steps usam checkbox (`- [ ]`).

**Goal:** Persistir cada geração concluída numa galeria Postgres por-tenant; expor `list_my_generations` como tool MCP paginada; calcular e alertar margem operacional; backups automáticos `pg_dump` (cron) para ambos os Postgres da suíte.

**Depende de:**
- F-B (entrega de artefatos: signed URL MinIO + metadata de geração disponíveis na conclusão do job)
- F-C (tenancy: `tenantId` no AuthContext per-request)
- F-D (`credit-core` vivo: ledger append-only com `kind=capture`, `external_id`, `amount` — fonte do saldo; a **galeria** desnormaliza `cost_usd` + `credits_debited` para cálculo de margem)

**Spec fonte:** `.maxvision/specs/2026-06-01-media-forge-infoproduct-design.md` §4.7 (F5 observabilidade de margem, galeria persistente), §4.1–4.4 (path-priced, regra de ouro #3, markup, credit_value_usd).

**Trabalhando em:** `C:\Users\MaxVision\Desktop\cursor-oficial\maxvision-utilities`

**Tech stack:** TypeScript ESM, Node ≥ 22.5, `pg` (Postgres próprio do media-forge — separado do credit-core), Hono, vitest, `embedded-postgres` (globalSetup), Docker Swarm + `prodrigestivill/postgres-backup-local`.

---

## Decisão arquitetural: galeria no Postgres próprio do media-forge

O credit-core tem DB Postgres exclusivo (append-only, sem joins analíticos). A galeria é um registro analítico do media-forge: `cost_usd`, `credits_debited`, `credit_value_usd`, `model`, `tenant_id`, `minio_key`, `created_at`. Colocar isso no credit-core violaria as fronteiras do serviço e exigiria queries cross-DB para observabilidade de margem. **Decisão: Postgres próprio no media-forge**, injetado via `pg.Pool` singleton criado no `startHttpServer` e passado via `BuildServerOpts`.

## Fonte da margem = a galeria (não o ledger)

O ledger do credit-core registra `amount` em créditos + `kind=capture`, mas não guarda `cost_usd` nem `model`. A galeria desnormaliza esses campos no momento do capture/entrega (F-B). Margem = agregação sobre a galeria: `Σ(credits_debited × credit_value_usd) − Σcost_usd` por período/caminho/tenant.

## Regra de ouro #3 e `credit_value_usd`

O débito de Veo num pack descontado usa o `credit_value_usd` do pack, não o padrão de $0.01. Sem gravar `credit_value_usd` por linha, a receita_usd não é reconstituível. O schema inclui `credit_value_usd NOT NULL`.

## Tenant server-side

`list_my_generations` lê `tenantId` do `AuthContext` injetado no server (F-C), **nunca de um argumento do cliente**. Qualquer arg de tenant fornecido pelo cliente é ignorado (defesa gating §6).

---

## File Structure

```
media-forge/
  src/
    gallery/
      schema.ts              -- tipos puros: GenerationRecord, GalleryPage
      gallery-store.ts       -- adapter Postgres (insert + paginated query)
      margin.ts              -- puro: computeMargin(rows, opts) → MarginReport
      margin-alert.ts        -- puro: marginBelowThreshold; Notifier interface
      gallery-notifier.ts    -- implementação concreta (email/Telegram via env)
    mcp/
      handlers.ts            -- SEAM: handler de geração chama insertGeneration()
      server.ts              -- SEAM: BuildServerOpts + galleryPool injetado
    http/
      server.ts              -- SEAM: Pool singleton criado aqui, passado via opts
  migrations/
    gallery/
      001_generations.sql    -- CREATE TABLE generations + índices
  tests/
    global-setup.ts          -- embedded-postgres (mirror credit-core Task 5.5)
    vitest.config.ts         -- globalSetup + pool forks + testTimeout 30000
    unit/
      gallery/
        margin.test.ts       -- puro: computeMargin, marginBelowThreshold
    integration/
      gallery/
        gallery-store.int.test.ts   -- insert idempotente + paginated query
        margin-query.int.test.ts    -- agregação real no Postgres
        alert-flow.int.test.ts      -- pipeline: insert → computeMargin → alert
  deploy/
    stacks/
      media-forge-stack.yml  -- service backup (postgres-backup-local) + media-forge-db

credit-core/
  deploy/
    stacks/
      credit-core-stack.yml  -- service backup (postgres-backup-local) + credit-core-db
```

> Os arquivos de stack são novos. Outros arquivos listados em `media-forge/src/mcp/` e `media-forge/src/http/` já existem — serão modificados nos seams indicados, não recriados.

---

## Modelo de dados

```sql
-- media-forge/migrations/gallery/001_generations.sql
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
```

**Colunas de margem:** `cost_usd` (COGS) + `credits_debited × credit_value_usd` = `receita_usd` por linha. Nenhuma query cross-DB é necessária.

**Idempotência:** `generation_id UNIQUE` + `INSERT ... ON CONFLICT (generation_id) DO NOTHING` — replay de webhook/callback não duplica linha.

---

## Task 1: Deps + migration

**Files:** Modify `media-forge/package.json`, Create `media-forge/migrations/gallery/001_generations.sql`

- [ ] **Step 1: Adicionar `pg` e `embedded-postgres` (devDep)**

Em `media-forge/package.json`:
```json
"dependencies": {
  "pg": "^8.13.0"
},
"devDependencies": {
  "embedded-postgres": "^17.1.1",
  "@types/pg": "^8.11.0"
}
```

> `pg` já pode estar presente (cost-tracker usa SQLite; verificar package.json antes de duplicar). `embedded-postgres` só em devDependencies — não entra no runtime Docker.

Run: `cd media-forge && pnpm install --ignore-workspace`
Expected: lockfile atualizado; `node -e "import('pg').then(m=>console.log(!!m.Pool))"` imprime `true`.

- [ ] **Step 2: Criar migration SQL**

```sql
-- media-forge/migrations/gallery/001_generations.sql
CREATE TABLE IF NOT EXISTS generations (
  id               BIGSERIAL PRIMARY KEY,
  generation_id    TEXT NOT NULL UNIQUE,
  tenant_id        TEXT NOT NULL,
  model            TEXT NOT NULL,
  provider         TEXT NOT NULL,
  cost_usd         NUMERIC(12,6) NOT NULL,
  credits_debited  BIGINT NOT NULL,
  credit_value_usd NUMERIC(12,8) NOT NULL,
  minio_key        TEXT,
  signed_url       TEXT,
  status           TEXT NOT NULL DEFAULT 'completed',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_gen_tenant_created ON generations (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_gen_model ON generations (model);
```

- [ ] **Step 3: Commit**

```bash
git add media-forge/package.json media-forge/pnpm-lock.yaml media-forge/migrations/gallery/001_generations.sql
git commit -m "feat(gallery): add pg dep + gallery schema migration 001"
```

---

## Task 2: Tipos puros + galeria pura

**Files:** Create `media-forge/src/gallery/schema.ts`

- [ ] **Step 1: Implementar**

```ts
// media-forge/src/gallery/schema.ts
export interface GenerationRecord {
  generationId: string;    // job_id do media-forge
  tenantId: string;
  model: string;
  provider: string;
  costUsd: number;
  creditsDebited: number;
  creditValueUsd: number;
  minioKey: string | null;
  signedUrl: string | null;
  status: 'completed' | 'failed';
  createdAt: string;       // ISO 8601
}

export interface GalleryPage {
  items: GenerationRecord[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface InsertGenerationOpts {
  generationId: string;
  tenantId: string;
  model: string;
  provider: string;
  costUsd: number;
  creditsDebited: number;
  creditValueUsd: number;
  minioKey?: string | null;
  signedUrl?: string | null;
  status?: 'completed' | 'failed';
}

export interface ListGenerationsOpts {
  tenantId: string;
  page: number;      // 1-based
  pageSize: number;  // max 100
}
```

- [ ] **Step 2: Commit**

```bash
git add media-forge/src/gallery/schema.ts
git commit -m "feat(gallery): pure GenerationRecord + GalleryPage types"
```

---

## Task 3: GalleryStore — adapter Postgres

**Files:** Create `media-forge/src/gallery/gallery-store.ts`, Test `media-forge/tests/integration/gallery/gallery-store.int.test.ts`

> Integração: roda com `GALLERY_DATABASE_URL` (preenchido pelo globalSetup do embedded-postgres). Insert idempotente via `ON CONFLICT (generation_id) DO NOTHING`. Query paginada usa `COUNT(*) OVER()` para evitar query extra de total.

- [ ] **Step 1: Test que falha**

```ts
// media-forge/tests/integration/gallery/gallery-store.int.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { GalleryStore } from '../../../src/gallery/gallery-store.js';

const url = process.env.GALLERY_DATABASE_URL;
const d = url ? describe : describe.skip;

d('GalleryStore', () => {
  let pool: Pool;
  let store: GalleryStore;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await pool.query('DROP TABLE IF EXISTS generations');
    await pool.query(readFileSync('migrations/gallery/001_generations.sql', 'utf8'));
    store = new GalleryStore(pool);
  });

  const base = {
    generationId: 'job-001',
    tenantId: 'tenant-a',
    model: 'veo-3-1-pro',
    provider: 'google',
    costUsd: 4.0,
    creditsDebited: 1600,
    creditValueUsd: 0.01,
    minioKey: 'outputs/tenant-a/job-001.mp4',
    signedUrl: 'https://example.com/signed',
    status: 'completed' as const,
  };

  it('insert e query retornam o registro', async () => {
    await store.insertGeneration(base);
    const page = await store.listGenerations({ tenantId: 'tenant-a', page: 1, pageSize: 10 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].generationId).toBe('job-001');
    expect(page.total).toBe(1);
    expect(page.hasMore).toBe(false);
  });

  it('insert idempotente: replay nao duplica linha', async () => {
    await store.insertGeneration(base);  // replay
    const page = await store.listGenerations({ tenantId: 'tenant-a', page: 1, pageSize: 10 });
    expect(page.items).toHaveLength(1);
  });

  it('paginacao: pageSize=1 com 2 registros → hasMore=true', async () => {
    await store.insertGeneration({ ...base, generationId: 'job-002' });
    const page = await store.listGenerations({ tenantId: 'tenant-a', page: 1, pageSize: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.hasMore).toBe(true);
    expect(page.total).toBe(2);
  });

  it('isolamento por tenant: tenant-b nao ve registros de tenant-a', async () => {
    const page = await store.listGenerations({ tenantId: 'tenant-b', page: 1, pageSize: 10 });
    expect(page.items).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Rodar — falha**

```bash
cd media-forge && pnpm vitest run tests/integration/gallery/gallery-store.int.test.ts
```
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```ts
// media-forge/src/gallery/gallery-store.ts
import { Pool } from 'pg';
import type { GenerationRecord, GalleryPage, InsertGenerationOpts, ListGenerationsOpts } from './schema.js';

export class GalleryStore {
  constructor(private pool: Pool) {}

  /** Insert idempotente por generation_id. Replay de webhook nao duplica. */
  async insertGeneration(opts: InsertGenerationOpts): Promise<void> {
    await this.pool.query(
      `INSERT INTO generations
         (generation_id, tenant_id, model, provider, cost_usd, credits_debited, credit_value_usd, minio_key, signed_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (generation_id) DO NOTHING`,
      [
        opts.generationId,
        opts.tenantId,
        opts.model,
        opts.provider,
        opts.costUsd,
        opts.creditsDebited,
        opts.creditValueUsd,
        opts.minioKey ?? null,
        opts.signedUrl ?? null,
        opts.status ?? 'completed',
      ],
    );
  }

  /** Query paginada (1-based page) ordenada por created_at DESC, filtrada por tenant_id. */
  async listGenerations(opts: ListGenerationsOpts): Promise<GalleryPage> {
    const { tenantId, page, pageSize } = opts;
    const size = Math.min(Math.max(pageSize, 1), 100);
    const offset = (Math.max(page, 1) - 1) * size;

    const r = await this.pool.query<GenerationRecord & { total_count: string }>(
      `SELECT
         generation_id   AS "generationId",
         tenant_id       AS "tenantId",
         model,
         provider,
         cost_usd        AS "costUsd",
         credits_debited AS "creditsDebited",
         credit_value_usd AS "creditValueUsd",
         minio_key       AS "minioKey",
         signed_url      AS "signedUrl",
         status,
         created_at      AS "createdAt",
         COUNT(*) OVER() AS total_count
       FROM generations
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [tenantId, size, offset],
    );

    const total = r.rows.length > 0 ? Number(r.rows[0].total_count) : 0;
    const items = r.rows.map(({ total_count: _tc, createdAt, ...rest }) => ({
      ...rest,
      createdAt: createdAt instanceof Date ? createdAt.toISOString() : String(createdAt),
    })) as GenerationRecord[];

    return {
      items,
      total,
      page: Math.max(page, 1),
      pageSize: size,
      hasMore: offset + items.length < total,
    };
  }
}
```

- [ ] **Step 4: Rodar — passa**

```bash
cd media-forge && pnpm vitest run tests/integration/gallery/gallery-store.int.test.ts
```
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add media-forge/src/gallery/gallery-store.ts media-forge/tests/integration/gallery/gallery-store.int.test.ts
git commit -m "feat(gallery): GalleryStore — idempotent insert + paginated query by tenant"
```

---

## Task 4: Margem pura — `computeMargin` + `marginBelowThreshold`

**Files:** Create `media-forge/src/gallery/margin.ts`, Create `media-forge/src/gallery/margin-alert.ts`, Test `media-forge/tests/unit/gallery/margin.test.ts`

> Funções puras sem I/O — mirror de `accounting.ts` / `pricing.ts` do credit-core. `Notifier` é interface injetável (mirror de `StatusProbe` do sweep).

- [ ] **Step 1: Test que falha**

```ts
// media-forge/tests/unit/gallery/margin.test.ts
import { describe, it, expect } from 'vitest';
import { computeMargin, marginBelowThreshold, type MarginReport } from '../../../src/gallery/margin.js';
import type { GenerationRecord } from '../../../src/gallery/schema.js';

const makeRow = (o: Partial<GenerationRecord> & { costUsd: number; creditsDebited: number; creditValueUsd: number; model: string }): GenerationRecord => ({
  generationId: Math.random().toString(36).slice(2),
  tenantId: 't1',
  provider: 'google',
  minioKey: null,
  signedUrl: null,
  status: 'completed',
  createdAt: '2026-06-02T00:00:00Z',
  ...o,
});

describe('computeMargin', () => {
  it('margem basica: receita - custo', () => {
    const rows = [
      makeRow({ costUsd: 4.0, creditsDebited: 1600, creditValueUsd: 0.01, model: 'veo-3-1-pro' }),
      makeRow({ costUsd: 0.02, creditsDebited: 20, creditValueUsd: 0.01, model: 'imagen-4-ultra' }),
    ];
    // receita = 1600*0.01 + 20*0.01 = 16+0.2 = 16.2
    // custo = 4.0 + 0.02 = 4.02
    // margem = 16.2 - 4.02 = 12.18; margem% = 12.18/16.2 ~ 75.2%
    const r = computeMargin(rows);
    expect(r.revenueUsd).toBeCloseTo(16.2, 4);
    expect(r.costUsd).toBeCloseTo(4.02, 4);
    expect(r.marginUsd).toBeCloseTo(12.18, 4);
    expect(r.marginPct).toBeCloseTo(75.185, 1);
  });

  it('sem geracoes: margem 0, nao NaN', () => {
    const r = computeMargin([]);
    expect(r.revenueUsd).toBe(0);
    expect(r.marginUsd).toBe(0);
    expect(r.marginPct).toBe(0);
  });

  it('por modelo: agrega por model key', () => {
    const rows = [
      makeRow({ costUsd: 4.0, creditsDebited: 1600, creditValueUsd: 0.01, model: 'veo-3-1-pro' }),
      makeRow({ costUsd: 4.0, creditsDebited: 1600, creditValueUsd: 0.01, model: 'veo-3-1-pro' }),
      makeRow({ costUsd: 0.02, creditsDebited: 20, creditValueUsd: 0.01, model: 'imagen-4-ultra' }),
    ];
    const r = computeMargin(rows);
    expect(r.byModel['veo-3-1-pro'].count).toBe(2);
    expect(r.byModel['imagen-4-ultra'].count).toBe(1);
  });

  // PROPERTY (regra de ouro): para qualquer combinacao valida de COGS/markup/creditValue,
  // a margem calculada deve ser >= 0 quando o preco foi calculado por priceCredits.
  it('property: receita >= custo quando creditos = ceil(custo*markup/creditValue)', () => {
    const costs = [0.02, 0.13, 0.63, 4.0, 74];
    const markups = [4, 10];
    const creditValues = [0.01, 0.005, 0.00196];
    for (const costUsd of costs)
      for (const markup of markups)
        for (const creditValueUsd of creditValues) {
          const creditsDebited = Math.ceil((costUsd * markup) / creditValueUsd);
          const rows = [makeRow({ costUsd, creditsDebited, creditValueUsd, model: 'any' })];
          const r = computeMargin(rows);
          expect(r.marginUsd).toBeGreaterThanOrEqual(-1e-9); // tolerancia float
        }
  });
});

describe('marginBelowThreshold', () => {
  it('alerta quando pct < limiar', () => {
    const report = { marginPct: 20 } as ReturnType<typeof computeMargin>;
    expect(marginBelowThreshold(report, 30)).toBe(true);
    expect(marginBelowThreshold(report, 10)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar — falha**

```bash
cd media-forge && pnpm vitest run tests/unit/gallery/margin.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implementar `margin.ts`**

```ts
// media-forge/src/gallery/margin.ts
import type { GenerationRecord } from './schema.js';

export interface ModelMargin {
  count: number;
  revenueUsd: number;
  costUsd: number;
  marginUsd: number;
  marginPct: number;
}

export interface MarginReport {
  count: number;
  revenueUsd: number;
  costUsd: number;
  marginUsd: number;
  marginPct: number;          // 0–100
  byModel: Record<string, ModelMargin>;
  periodStart?: string;
  periodEnd?: string;
}

/** Computa margem a partir de linhas da galeria (puro, sem I/O). */
export function computeMargin(rows: readonly GenerationRecord[], opts?: { periodStart?: string; periodEnd?: string }): MarginReport {
  let totalRevenue = 0;
  let totalCost = 0;
  const byModel: Record<string, { count: number; rev: number; cost: number }> = {};

  for (const r of rows) {
    if (r.status !== 'completed') continue;
    const rev = r.creditsDebited * r.creditValueUsd;
    totalRevenue += rev;
    totalCost += r.costUsd;
    const m = (byModel[r.model] ??= { count: 0, rev: 0, cost: 0 });
    m.count++;
    m.rev += rev;
    m.cost += r.costUsd;
  }

  const marginUsd = totalRevenue - totalCost;
  const marginPct = totalRevenue > 0 ? (marginUsd / totalRevenue) * 100 : 0;

  const byModelOut: Record<string, ModelMargin> = {};
  for (const [model, m] of Object.entries(byModel)) {
    const mMarginUsd = m.rev - m.cost;
    byModelOut[model] = {
      count: m.count,
      revenueUsd: m.rev,
      costUsd: m.cost,
      marginUsd: mMarginUsd,
      marginPct: m.rev > 0 ? (mMarginUsd / m.rev) * 100 : 0,
    };
  }

  return {
    count: rows.filter((r) => r.status === 'completed').length,
    revenueUsd: totalRevenue,
    costUsd: totalCost,
    marginUsd,
    marginPct,
    byModel: byModelOut,
    ...opts,
  };
}

/** Retorna true se a margem% estiver abaixo do limiar (dispara alerta). */
export function marginBelowThreshold(report: Pick<MarginReport, 'marginPct'>, thresholdPct: number): boolean {
  return report.marginPct < thresholdPct;
}
```

- [ ] **Step 4: Implementar `margin-alert.ts`**

```ts
// media-forge/src/gallery/margin-alert.ts
import type { MarginReport } from './margin.js';

/** Interface injetável para notificacao (email, Telegram, webhook, no-op). Mirror de StatusProbe do sweep. */
export interface Notifier {
  send(subject: string, body: string): Promise<void>;
}

export interface AlertOpts {
  thresholdPct: number;   // ex: 30
  notifier: Notifier;
  model?: string;         // se presente, avalia o byModel especifico
}

/** Avalia o MarginReport e dispara o Notifier se margem < limiar. Idempotente. */
export async function evaluateAndAlert(report: MarginReport, opts: AlertOpts): Promise<{ alerted: boolean }> {
  const { thresholdPct, notifier, model } = opts;
  const target = model ? report.byModel[model] : report;
  if (!target) return { alerted: false };
  if (target.marginPct < thresholdPct) {
    const label = model ? `model=${model}` : 'overall';
    await notifier.send(
      `[media-forge] Margem abaixo do limiar (${thresholdPct}%)`,
      `Margem atual (${label}): ${target.marginPct.toFixed(1)}% — limiar: ${thresholdPct}%\n` +
        `Receita: $${report.revenueUsd.toFixed(4)} | Custo: $${report.costUsd.toFixed(4)} | Margem: $${report.marginUsd.toFixed(4)}\n` +
        `Geracoes: ${report.count}`,
    );
    return { alerted: true };
  }
  return { alerted: false };
}
```

- [ ] **Step 5: Rodar — passa**

```bash
cd media-forge && pnpm vitest run tests/unit/gallery/margin.test.ts
```
Expected: PASS (incluindo o property test de margem).

- [ ] **Step 6: Commit**

```bash
git add media-forge/src/gallery/margin.ts media-forge/src/gallery/margin-alert.ts media-forge/tests/unit/gallery/margin.test.ts
git commit -m "feat(gallery): pure computeMargin + marginBelowThreshold + Notifier interface (margin property test)"
```

---

## Task 5: embedded-postgres globalSetup (harness de teste)

**Files:** Create `media-forge/tests/global-setup.ts`, Modify `media-forge/vitest.config.ts` (ou criar se ausente)

> Mirror exato do credit-core Task 5.5 (Adendo F-D). Porta dedicada 54330 para evitar conflito com o credit-core (54329).

- [ ] **Step 1: `tests/global-setup.ts`**

```ts
// media-forge/tests/global-setup.ts
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pg: EmbeddedPostgres | undefined;
let dataDir: string | undefined;

export async function setup(): Promise<void> {
  dataDir = mkdtempSync(join(tmpdir(), 'mf-pg-'));
  const port = 54330; // porta dedicada de teste (nao conflita com credit-core 54329)
  pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'mediaforge',
    password: 'mediaforge',
    port,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('media_forge_test');
  process.env.GALLERY_DATABASE_URL = `postgres://mediaforge:mediaforge@localhost:${port}/media_forge_test`;
}

export async function teardown(): Promise<void> {
  await pg?.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
}
```

- [ ] **Step 2: Atualizar `vitest.config.ts`**

Localizar o `vitest.config.ts` existente do media-forge e adicionar/substituir:

```ts
// media-forge/vitest.config.ts  (merge com config existente)
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    pool: 'forks',
    testTimeout: 30000,
  },
});
```

> Preservar qualquer outra configuração existente (include patterns, setupFiles etc.). O `pool: 'forks'` garante que `process.env.GALLERY_DATABASE_URL` propagado no globalSetup chega aos workers.

- [ ] **Step 3: Rodar a suíte completa com o harness**

```bash
cd media-forge && pnpm test
```
Expected: testes de galeria (store.int, margin.test) verdes; testes existentes do media-forge não quebram.

- [ ] **Step 4: Commit**

```bash
git add media-forge/tests/global-setup.ts media-forge/vitest.config.ts
git commit -m "test(gallery): embedded-postgres globalSetup (port 54330) for gallery integration tests"
```

---

## Task 6: `list_my_generations` — tool MCP paginada

**Files:** Modify `media-forge/src/mcp/handlers.ts` (adicionar tool), Create `media-forge/tests/unit/gallery/list-tool.test.ts`

> O `tenantId` vem exclusivamente do `AuthContext` injetado (F-C seam). A tool aceita somente `page` e `page_size` como input do cliente. `GalleryStore` é injetado via `registerAllTools` opts — testável sem Postgres real na unit.

- [ ] **Step 1: Test unitário que falha**

```ts
// media-forge/tests/unit/gallery/list-tool.test.ts
import { describe, it, expect, vi } from 'vitest';
import type { GalleryStore } from '../../../src/gallery/gallery-store.js';
import type { GalleryPage } from '../../../src/gallery/schema.js';

// Stub de GalleryStore
const mockPage: GalleryPage = {
  items: [
    {
      generationId: 'job-001', tenantId: 'tenant-a', model: 'veo-3-1-pro',
      provider: 'google', costUsd: 4.0, creditsDebited: 1600, creditValueUsd: 0.01,
      minioKey: 'outputs/job-001.mp4', signedUrl: 'https://example.com/s', status: 'completed',
      createdAt: '2026-06-02T00:00:00Z',
    },
  ],
  total: 1, page: 1, pageSize: 20, hasMore: false,
};

const storeMock: Pick<GalleryStore, 'listGenerations'> = {
  listGenerations: vi.fn().mockResolvedValue(mockPage),
};

describe('list_my_generations input contract', () => {
  it('page deve ser >= 1', () => {
    // Valida schema Zod diretamente
    const { ListMyGenerationsInput } = await import('../../../src/mcp/schemas.js');
    expect(ListMyGenerationsInput.safeParse({ page: 0 }).success).toBe(false);
    expect(ListMyGenerationsInput.safeParse({ page: 1, page_size: 20 }).success).toBe(true);
  });

  it('page_size maior que 100 eh rejeitado', async () => {
    const { ListMyGenerationsInput } = await import('../../../src/mcp/schemas.js');
    expect(ListMyGenerationsInput.safeParse({ page: 1, page_size: 101 }).success).toBe(false);
  });
});
```

> Nota: o import de `schemas.js` falha até a Task 6 Step 3 adicionar `ListMyGenerationsInput`. Isso é esperado: o teste falha na Step 2, passa na Step 4.

- [ ] **Step 2: Rodar — falha**

```bash
cd media-forge && pnpm vitest run tests/unit/gallery/list-tool.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Adicionar schema Zod em `src/mcp/schemas.ts`**

Localizar `media-forge/src/mcp/schemas.ts` e adicionar ao final:

```ts
// Adicionar em src/mcp/schemas.ts

export const ListMyGenerationsInput = z.object({
  page: z.number().int().min(1).default(1).describe('Página (1-based, default: 1)'),
  page_size: z.number().int().min(1).max(100).default(20).describe('Itens por página (max 100, default: 20)'),
});
export type ListMyGenerationsInputT = z.infer<typeof ListMyGenerationsInput>;
```

- [ ] **Step 4: Registrar a tool em `handlers.ts`**

Localizar a função `registerAllTools` em `src/mcp/handlers.ts`. Adicionar o import e o registro da tool:

```ts
// Adicionar ao import de schemas no topo do handlers.ts:
import { ListMyGenerationsInput, type ListMyGenerationsInputT } from './schemas.js';

// Adicionar ao tipo RegisterAllToolsOpts (interface já existente em handlers.ts):
// galleryStore?: GalleryStore;   <-- adicionar este campo

// Dentro de registerAllTools, ao final dos registros de tools:
server.tool(
  'list_my_generations',
  'Lista as gerações concluídas do tenant autenticado (paginada, mais recentes primeiro).',
  ListMyGenerationsInput.shape,
  async (input: ListMyGenerationsInputT) => {
    // tenantId vem do AuthContext injetado via opts.auth (F-C seam).
    // Em F-A/F-I, o opts.auth?.tenantId pode ser undefined (self-host sem tenant).
    // Nesse caso, usar 'default' como tenant implícito.
    const tenantId = opts.auth?.tenantId ?? 'default';
    const store = opts.galleryStore;
    if (!store) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'gallery_not_configured' }) }], isError: true };
    }
    const page = await store.listGenerations({
      tenantId,
      page: input.page,
      pageSize: input.page_size,
    });
    return { content: [{ type: 'text', text: JSON.stringify(page) }] };
  },
);
```

> `opts.auth` é o seam de F-C. Em F-I, adicionar `auth?: { tenantId?: string }` e `galleryStore?: GalleryStore` à interface `RegisterAllToolsOpts`. Quando F-C for implementada, o `auth.tenantId` será preenchido pelo middleware Bearer resolvido.

- [ ] **Step 5: Rodar — passa**

```bash
cd media-forge && pnpm vitest run tests/unit/gallery/list-tool.test.ts
```
Expected: PASS.

- [ ] **Step 6: Typecheck**

```bash
cd media-forge && pnpm typecheck
```
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add media-forge/src/mcp/schemas.ts media-forge/src/mcp/handlers.ts media-forge/tests/unit/gallery/list-tool.test.ts
git commit -m "feat(gallery): list_my_generations MCP tool (paginated, tenant from AuthContext)"
```

---

## Task 7: Escrita na galeria no momento do capture/entrega

**Files:** Create `media-forge/src/gallery/gallery-notifier.ts`, Modify `media-forge/src/http/server.ts` (Pool singleton), Modify `media-forge/src/mcp/server.ts` (BuildServerOpts), Create `media-forge/tests/integration/gallery/alert-flow.int.test.ts`

> O ponto de inserção na galeria é onde o media-forge hoje chama `recordActualCost`. Cada provider chama `recordActualCostUSD(jobId, usd)` em `base.ts` após confirmar o job. F-B (seam) entrega também `minioKey` e `signedUrl`. F-I adiciona a chamada a `galleryStore.insertGeneration()` no mesmo ponto, após `recordActualCost`.

- [ ] **Step 1: `gallery-notifier.ts` — implementação concreta do Notifier**

```ts
// media-forge/src/gallery/gallery-notifier.ts
import type { Notifier } from './margin-alert.js';
import { logger } from '../core/logger.js';

/** Notifier via Telegram Bot API. Requer GALLERY_ALERT_TELEGRAM_TOKEN + GALLERY_ALERT_TELEGRAM_CHAT_ID. */
export function createTelegramNotifier(env: NodeJS.ProcessEnv = process.env): Notifier {
  const token = env.GALLERY_ALERT_TELEGRAM_TOKEN;
  const chatId = env.GALLERY_ALERT_TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    // Degradacao graceful: loga localmente sem enviar
    return {
      async send(subject: string, body: string): Promise<void> {
        logger.warn('[margin-alert] Notifier nao configurado (GALLERY_ALERT_TELEGRAM_TOKEN/CHAT_ID ausentes)', { subject, body });
      },
    };
  }
  return {
    async send(subject: string, body: string): Promise<void> {
      const text = encodeURIComponent(`${subject}\n\n${body}`);
      const url = `https://api.telegram.org/bot${token}/sendMessage?chat_id=${chatId}&text=${text}`;
      const res = await fetch(url);
      if (!res.ok) logger.error('[margin-alert] Telegram send failed', { status: res.status });
    },
  };
}

/** Notifier no-op — pra testes e modo self-host sem configuracao de alerta. */
export const noopNotifier: Notifier = {
  async send(): Promise<void> {},
};
```

- [ ] **Step 2: Pool singleton no `startHttpServer`**

Localizar `media-forge/src/http/server.ts`. Modificar `startHttpServer` para criar o `pg.Pool` singleton e injetá-lo via `buildHttpApp` / `buildServer` opts:

```ts
// Trecho a adicionar em src/http/server.ts (dentro de startHttpServer):
import { Pool } from 'pg';
import { GalleryStore } from '../gallery/gallery-store.js';

// Pool singleton criado UMA vez, passado pra todos os requests via buildHttpApp
const galleryDatabaseUrl = process.env.GALLERY_DATABASE_URL;
let galleryPool: Pool | undefined;
let galleryStore: GalleryStore | undefined;
if (galleryDatabaseUrl) {
  galleryPool = new Pool({ connectionString: galleryDatabaseUrl });
  galleryStore = new GalleryStore(galleryPool);
  // Rodar migration na inicializacao
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const migrationsDir = join(fileURLToPath(import.meta.url), '../../..', 'migrations/gallery');
  await galleryPool.query(readFileSync(join(migrationsDir, '001_generations.sql'), 'utf8'));
  logger.info('media-forge gallery Postgres connected', { url: galleryDatabaseUrl.replace(/:([^:@]+)@/, ':****@') });
} else {
  logger.warn('GALLERY_DATABASE_URL unset — gallery disabled; list_my_generations returns error');
}
// Passar galleryStore para buildHttpApp -> buildServer -> registerAllTools
const app = buildHttpApp({ galleryStore });
```

> `buildHttpApp` e `BuildServerOpts` precisam de `galleryStore?: GalleryStore`. Propagar via `HttpAppOpts` → `handleMcpRequest` → `buildServer(opts)` → `registerAllTools(server, opts)`.

- [ ] **Step 3: Ponto de inserção na galeria (seam F-B)**

No código gerado por F-B (que ainda será implementado), o local exato de inserção na galeria é após a chamada a `recordActualCostUSD` em cada provider. Documentar o seam:

```ts
// SEAM F-I em qualquer provider (ex: bytedance-seedance.ts, google-veo.ts, kling.ts)
// Após: recordActualCost({ dbPath, jobId, actualUsd })
// Adicionar (quando galleryStore disponível via injeção):
await galleryStore?.insertGeneration({
  generationId: jobId,
  tenantId: ctx.tenantId,             // AuthContext de F-C
  model: this.model,                  // ex: 'veo-3-1-pro'
  provider: this.provider,            // ex: 'google'
  costUsd: actualUsd,
  creditsDebited: ctx.creditsReserved, // do AuthContext (F-C/F-D)
  creditValueUsd: ctx.creditValueUsd,  // do AuthContext (F-C/F-D)
  minioKey: result.minioKey ?? null,   // do F-B
  signedUrl: result.signedUrl ?? null, // do F-B
  status: 'completed',
});
```

> **Nota para executor:** o corpo exato de cada provider é definido em F-B. Este seam documenta onde F-I se conecta. F-I deve ser aplicada APÓS F-B ter definido a estrutura `result.minioKey` / `result.signedUrl`.

- [ ] **Step 4: Teste de pipeline (alert-flow)**

```ts
// media-forge/tests/integration/gallery/alert-flow.int.test.ts
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { GalleryStore } from '../../../src/gallery/gallery-store.js';
import { computeMargin } from '../../../src/gallery/margin.js';
import { evaluateAndAlert } from '../../../src/gallery/margin-alert.js';
import type { Notifier } from '../../../src/gallery/margin-alert.js';

const url = process.env.GALLERY_DATABASE_URL;
const d = url ? describe : describe.skip;

d('alert-flow (integração)', () => {
  let pool: Pool;
  let store: GalleryStore;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await pool.query('DROP TABLE IF EXISTS generations');
    await pool.query(readFileSync('migrations/gallery/001_generations.sql', 'utf8'));
    store = new GalleryStore(pool);
  });

  it('insere geracao, computa margem e dispara alerta quando abaixo do limiar', async () => {
    // Geração com margem 0% (custo = receita exactamente)
    await store.insertGeneration({
      generationId: 'job-margem-zero',
      tenantId: 't-alert',
      model: 'veo-3-1-pro',
      provider: 'google',
      costUsd: 4.0,
      creditsDebited: 400,  // 400 * 0.01 = $4.00 = custo (margem 0%)
      creditValueUsd: 0.01,
      status: 'completed',
    });

    const { rows } = await pool.query<{
      generation_id: string; tenant_id: string; model: string; provider: string;
      cost_usd: string; credits_debited: string; credit_value_usd: string;
      minio_key: string | null; signed_url: string | null; status: string; created_at: Date;
    }>(
      `SELECT * FROM generations WHERE tenant_id = 't-alert'`,
    );
    const records = rows.map((r) => ({
      generationId: r.generation_id, tenantId: r.tenant_id, model: r.model,
      provider: r.provider, costUsd: Number(r.cost_usd), creditsDebited: Number(r.credits_debited),
      creditValueUsd: Number(r.credit_value_usd), minioKey: r.minio_key, signedUrl: r.signed_url,
      status: r.status as 'completed' | 'failed', createdAt: r.created_at.toISOString(),
    }));

    const report = computeMargin(records);
    expect(report.marginPct).toBeCloseTo(0, 2);

    const sent: string[] = [];
    const notifier: Notifier = { async send(s) { sent.push(s); } };
    const { alerted } = await evaluateAndAlert(report, { thresholdPct: 30, notifier });

    expect(alerted).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('[media-forge]');
  });

  it('nao alerta quando margem acima do limiar', async () => {
    await store.insertGeneration({
      generationId: 'job-margem-boa',
      tenantId: 't-ok',
      model: 'imagen-4-ultra',
      provider: 'google',
      costUsd: 0.02,
      creditsDebited: 20,   // 20 * 0.01 = $0.20 = 10x markup => 90% margem
      creditValueUsd: 0.01,
      status: 'completed',
    });
    const page = await store.listGenerations({ tenantId: 't-ok', page: 1, pageSize: 10 });
    const report = computeMargin(page.items);
    const sent: string[] = [];
    const notifier: Notifier = { async send(s) { sent.push(s); } };
    await evaluateAndAlert(report, { thresholdPct: 30, notifier });
    expect(sent).toHaveLength(0);
  });
});
```

- [ ] **Step 5: Rodar — passa**

```bash
cd media-forge && pnpm vitest run tests/integration/gallery/alert-flow.int.test.ts
```
Expected: PASS (2 testes).

- [ ] **Step 6: Commit**

```bash
git add media-forge/src/gallery/gallery-notifier.ts media-forge/src/http/server.ts media-forge/src/mcp/server.ts media-forge/tests/integration/gallery/alert-flow.int.test.ts
git commit -m "feat(gallery): Pool singleton + Telegram notifier + alert-flow integration test"
```

---

## Task 8: Observabilidade de margem no `/metrics` (Prometheus)

**Files:** Modify `media-forge/src/http/app.ts` (endpoint `/metrics`), Create `media-forge/tests/unit/gallery/margin-query.test.ts`

> F-A já criou o stub `/metrics` que retorna texto vazio. F-I estende com gauges de margem calculados on-scrape sobre uma janela de 24h. A query no Postgres é leve (usa `ix_gen_tenant_created`). Calcular-no-scrape (não pré-agregar) é aceitável para Prometheus com scrape interval padrão (15–60s).

- [ ] **Step 1: Query de margem por período em `gallery-store.ts`**

Adicionar ao `GalleryStore`:

```ts
/** Retorna linhas de gerações concluídas num intervalo (para agregação de margem). */
async generationsInPeriod(opts: { since: string; until: string }): Promise<GenerationRecord[]> {
  const r = await this.pool.query(
    `SELECT
       generation_id AS "generationId", tenant_id AS "tenantId", model, provider,
       cost_usd AS "costUsd", credits_debited AS "creditsDebited",
       credit_value_usd AS "creditValueUsd", minio_key AS "minioKey",
       signed_url AS "signedUrl", status, created_at AS "createdAt"
     FROM generations
     WHERE status = 'completed' AND created_at >= $1 AND created_at < $2
     ORDER BY created_at DESC
     LIMIT 10000`,
    [opts.since, opts.until],
  );
  return r.rows.map((x) => ({
    ...x,
    costUsd: Number(x.costUsd),
    creditsDebited: Number(x.creditsDebited),
    creditValueUsd: Number(x.creditValueUsd),
    createdAt: x.createdAt instanceof Date ? x.createdAt.toISOString() : String(x.createdAt),
  }));
}
```

- [ ] **Step 2: Estender `/metrics` em `app.ts`**

Localizar o handler `GET /metrics` em `src/http/app.ts` e substituir pelo handler real:

```ts
// src/http/app.ts — handler /metrics estendido
app.get('/metrics', async (c) => {
  const store: GalleryStore | undefined = (c.env as { galleryStore?: GalleryStore })?.galleryStore
    ?? (opts as HttpAppOpts & { galleryStore?: GalleryStore }).galleryStore;

  const lines: string[] = [
    '# HELP media_forge_up Server up',
    '# TYPE media_forge_up gauge',
    'media_forge_up 1',
  ];

  if (store) {
    try {
      const now = new Date();
      const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const rows = await store.generationsInPeriod({ since, until: now.toISOString() });
      const report = computeMargin(rows);

      lines.push(
        '# HELP media_forge_margin_pct_24h Overall margin % (last 24h)',
        '# TYPE media_forge_margin_pct_24h gauge',
        `media_forge_margin_pct_24h ${report.marginPct.toFixed(4)}`,
        '# HELP media_forge_revenue_usd_24h Revenue USD (last 24h)',
        '# TYPE media_forge_revenue_usd_24h gauge',
        `media_forge_revenue_usd_24h ${report.revenueUsd.toFixed(6)}`,
        '# HELP media_forge_cost_usd_24h COGS USD (last 24h)',
        '# TYPE media_forge_cost_usd_24h gauge',
        `media_forge_cost_usd_24h ${report.costUsd.toFixed(6)}`,
        '# HELP media_forge_generations_total_24h Completed generations (last 24h)',
        '# TYPE media_forge_generations_total_24h gauge',
        `media_forge_generations_total_24h ${report.count}`,
      );

      for (const [model, m] of Object.entries(report.byModel)) {
        const safeModel = model.replace(/[^a-zA-Z0-9_]/g, '_');
        lines.push(`media_forge_margin_pct_24h{model="${safeModel}"} ${m.marginPct.toFixed(4)}`);
      }
    } catch (err) {
      lines.push(`# ERROR computing metrics: ${(err as Error).message}`);
    }
  }

  return c.text(lines.join('\n') + '\n', 200, {
    'content-type': 'text/plain; version=0.0.4; charset=utf-8',
  });
});
```

> `computeMargin` importado de `../gallery/margin.js`. `GalleryStore` passado via `HttpAppOpts` (acrescentar campo à interface).

- [ ] **Step 3: Teste de integração da query**

```ts
// media-forge/tests/integration/gallery/margin-query.int.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { GalleryStore } from '../../../src/gallery/gallery-store.js';
import { computeMargin } from '../../../src/gallery/margin.js';

const url = process.env.GALLERY_DATABASE_URL;
const d = url ? describe : describe.skip;

d('generationsInPeriod', () => {
  let store: GalleryStore;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: url });
    await pool.query('DROP TABLE IF EXISTS generations');
    await pool.query(readFileSync('migrations/gallery/001_generations.sql', 'utf8'));
    store = new GalleryStore(pool);
    await store.insertGeneration({
      generationId: 'j1', tenantId: 't1', model: 'veo-3-1-pro', provider: 'google',
      costUsd: 4, creditsDebited: 1600, creditValueUsd: 0.01, status: 'completed',
    });
    await store.insertGeneration({
      generationId: 'j2', tenantId: 't1', model: 'imagen-4-ultra', provider: 'google',
      costUsd: 0.02, creditsDebited: 20, creditValueUsd: 0.01, status: 'completed',
    });
  });

  it('retorna registros dentro do período', async () => {
    const since = new Date(Date.now() - 60 * 1000).toISOString(); // 1 min atrás
    const until = new Date(Date.now() + 60 * 1000).toISOString(); // 1 min à frente
    const rows = await store.generationsInPeriod({ since, until });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const report = computeMargin(rows);
    expect(report.marginUsd).toBeGreaterThan(0);
    expect(report.byModel).toHaveProperty('veo-3-1-pro');
    expect(report.byModel).toHaveProperty('imagen-4-ultra');
  });

  it('período fora do range retorna vazio', async () => {
    const since = '2020-01-01T00:00:00Z';
    const until = '2020-01-02T00:00:00Z';
    const rows = await store.generationsInPeriod({ since, until });
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Rodar — passa**

```bash
cd media-forge && pnpm vitest run tests/integration/gallery/margin-query.int.test.ts
```
Expected: PASS (2 testes).

- [ ] **Step 5: Typecheck + commit**

```bash
cd media-forge && pnpm typecheck
git add media-forge/src/gallery/gallery-store.ts media-forge/src/http/app.ts media-forge/tests/integration/gallery/margin-query.int.test.ts
git commit -m "feat(gallery): /metrics Prometheus gauges (margin%, revenue, cost, generations - 24h window)"
```

---

## Task 9: Alertas periódicos por cron interno

**Files:** Create `media-forge/src/gallery/margin-cron.ts`, Modify `media-forge/src/http/server.ts`

> Cron leve interno (setInterval, sem dep externa) que roda `evaluateAndAlert` a cada `GALLERY_ALERT_INTERVAL_MINUTES` (default 60). Não usar node-cron nem bibliotecas externas — setInterval com cleanup em SIGTERM.

- [ ] **Step 1: `margin-cron.ts`**

```ts
// media-forge/src/gallery/margin-cron.ts
import { logger } from '../core/logger.js';
import { computeMargin } from './margin.js';
import { evaluateAndAlert } from './margin-alert.js';
import type { Notifier } from './margin-alert.js';
import type { GalleryStore } from './gallery-store.js';

export interface MarginCronOpts {
  store: GalleryStore;
  notifier: Notifier;
  thresholdPct: number;   // ex: 30
  intervalMs: number;     // ex: 60 * 60 * 1000 (1h)
  windowHours?: number;   // janela analítica, default 24
}

/** Inicia o cron de alerta de margem. Retorna cleanup function. */
export function startMarginCron(opts: MarginCronOpts): () => void {
  const { store, notifier, thresholdPct, intervalMs, windowHours = 24 } = opts;

  const run = async (): Promise<void> => {
    try {
      const now = new Date();
      const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000).toISOString();
      const rows = await store.generationsInPeriod({ since, until: now.toISOString() });
      const report = computeMargin(rows);
      const { alerted } = await evaluateAndAlert(report, { thresholdPct, notifier });
      if (alerted) {
        logger.warn('[margin-cron] Alerta de margem disparado', {
          marginPct: report.marginPct.toFixed(1),
          revenueUsd: report.revenueUsd,
          costUsd: report.costUsd,
        });
      } else {
        logger.info('[margin-cron] Margem OK', { marginPct: report.marginPct.toFixed(1) });
      }
    } catch (err) {
      logger.error('[margin-cron] Erro ao calcular margem', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // Rodar imediatamente na inicialização (nao esperar o primeiro intervalo)
  void run();
  const timer = setInterval(run, intervalMs);
  return () => clearInterval(timer);
}
```

- [ ] **Step 2: Ativar o cron em `startHttpServer`**

No `src/http/server.ts`, após criar `galleryStore`:

```ts
// Dentro de startHttpServer, após criar galleryStore:
import { startMarginCron } from '../gallery/margin-cron.js';
import { createTelegramNotifier } from '../gallery/gallery-notifier.js';

if (galleryStore) {
  const thresholdPct = Number(process.env.GALLERY_ALERT_MARGIN_THRESHOLD_PCT ?? 30);
  const intervalMs = Number(process.env.GALLERY_ALERT_INTERVAL_MINUTES ?? 60) * 60 * 1000;
  const notifier = createTelegramNotifier(process.env);
  const stopCron = startMarginCron({ store: galleryStore, notifier, thresholdPct, intervalMs });
  // Registrar shutdown do cron junto com o server
  process.once('SIGTERM', stopCron);
  process.once('SIGINT', stopCron);
}
```

- [ ] **Step 3: Commit**

```bash
git add media-forge/src/gallery/margin-cron.ts media-forge/src/http/server.ts
git commit -m "feat(gallery): margin alert cron (setInterval, configurable threshold + interval)"
```

---

## Task 10: Backup Postgres — service `postgres-backup-local`

**Files:** Create `media-forge/deploy/stacks/media-forge-stack.yml`, Create `credit-core/deploy/stacks/credit-core-stack.yml`

> A imagem `prodrigestivill/postgres-backup-local` (`ghcr.io/prodrigestivill/postgres-backup-local`) faz `pg_dump` + compressão automática, rotação por KEEP_DAYS/WEEKS/MONTHS e armazena localmente (volume) ou em S3-compatible (via `aws-s3-host`). Padrão confirmado: a VPS tem o service `meuagente-postgres_app_backup` usando essa imagem — espelhar env vars e padrão de volume.

**Confirmar antes de executar:** comparar `POSTGRES_HOST`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `SCHEDULE`, `BACKUP_KEEP_DAYS` contra a stack `meuagente` da VPS (ver decisão em aberto #5).

- [ ] **Step 1: Stack do media-forge (galeria Postgres + backup)**

```yaml
# media-forge/deploy/stacks/media-forge-stack.yml
# Stack Docker Swarm: media-forge-db (Postgres galeria) + backup + media-forge-mcp
# Deploy: Portainer → Stack → Upload YAML → confirmar vars de ambiente no .env da stack
version: '3.8'

services:
  media-forge-db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: media_forge
      POSTGRES_USER: mediaforge
      POSTGRES_PASSWORD_FILE: /run/secrets/mf_db_password
    secrets:
      - mf_db_password
    volumes:
      - media_forge_db_data:/var/lib/postgresql/data
    networks:
      - media_forge_internal
    deploy:
      replicas: 1
      restart_policy:
        condition: on-failure
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mediaforge -d media_forge"]
      interval: 10s
      timeout: 5s
      retries: 5

  media-forge-db-backup:
    # Imagem: espelha meuagente-postgres_app_backup (prodrigestivill/postgres-backup-local)
    # Confirmar: SCHEDULE, BACKUP_KEEP_DAYS/WEEKS/MONTHS, POSTGRES_HOST contra stack meuagente
    image: ghcr.io/prodrigestivill/postgres-backup-local:16
    environment:
      POSTGRES_HOST: media-forge-db
      POSTGRES_DB: media_forge
      POSTGRES_USER: mediaforge
      POSTGRES_PASSWORD_FILE: /run/secrets/mf_db_password
      SCHEDULE: "@daily"             # CONFIRMAR: espelhar valor da stack meuagente
      BACKUP_KEEP_DAYS: "7"          # CONFIRMAR
      BACKUP_KEEP_WEEKS: "4"         # CONFIRMAR
      BACKUP_KEEP_MONTHS: "6"        # CONFIRMAR
      HEALTHCHECK_PORT: "8080"
    secrets:
      - mf_db_password
    volumes:
      - media_forge_db_backups:/backups
    networks:
      - media_forge_internal
    depends_on:
      - media-forge-db
    deploy:
      replicas: 1
      restart_policy:
        condition: on-failure

  media-forge-mcp:
    image: ghcr.io/produtoramaxvision/media-forge-mcp:latest
    environment:
      GALLERY_DATABASE_URL: "postgres://mediaforge:${MF_DB_PASSWORD}@media-forge-db:5432/media_forge"
      MEDIA_FORGE_HTTP_PORT: "3000"
      # Demais vars: MEDIA_FORGE_API_KEYS, GOOGLE_API_KEY, MINIO_*, GALLERY_ALERT_TELEGRAM_TOKEN etc.
    networks:
      - media_forge_internal
      - traefik_public
    depends_on:
      - media-forge-db
    deploy:
      replicas: 1
      restart_policy:
        condition: on-failure
      labels:
        - "traefik.enable=true"
        - "traefik.http.routers.media-forge-mcp.rule=Host(`media-forge.produtoramaxvision.com.br`)"
        - "traefik.http.services.media-forge-mcp.loadbalancer.server.port=3000"

volumes:
  media_forge_db_data:
  media_forge_db_backups:

networks:
  media_forge_internal:
    driver: overlay
    internal: true
  traefik_public:
    external: true

secrets:
  mf_db_password:
    external: true
```

- [ ] **Step 2: Stack do credit-core (backup)**

```yaml
# credit-core/deploy/stacks/credit-core-stack.yml
# Adicionar service de backup ao stack existente do credit-core
# (apenas o service de backup — o Postgres e o service principal já existem ou serão adicionados)
version: '3.8'

services:
  credit-core-db-backup:
    image: ghcr.io/prodrigestivill/postgres-backup-local:16
    environment:
      POSTGRES_HOST: credit-core-db       # nome do service Postgres do credit-core
      POSTGRES_DB: credit_core
      POSTGRES_USER: creditcore
      POSTGRES_PASSWORD_FILE: /run/secrets/cc_db_password
      SCHEDULE: "@daily"                  # CONFIRMAR: espelhar valor da stack meuagente
      BACKUP_KEEP_DAYS: "7"
      BACKUP_KEEP_WEEKS: "4"
      BACKUP_KEEP_MONTHS: "6"
      HEALTHCHECK_PORT: "8080"
    secrets:
      - cc_db_password
    volumes:
      - credit_core_db_backups:/backups
    networks:
      - credit_core_internal
    deploy:
      replicas: 1
      restart_policy:
        condition: on-failure

volumes:
  credit_core_db_backups:

secrets:
  cc_db_password:
    external: true
```

- [ ] **Step 3: Commit**

```bash
git add media-forge/deploy/stacks/media-forge-stack.yml credit-core/deploy/stacks/credit-core-stack.yml
git commit -m "ops(backup): pg_dump cron via postgres-backup-local for media-forge-db + credit-core-db"
```

---

## Task 11: Runbook de recovery (backup → restore drill)

**Files:** Create `media-forge/deploy/stacks/RUNBOOK-RECOVERY.md`

> Este arquivo de runbook é documentação operacional — diferente de relatório. O usuário pediu explicitamente runbook de recovery como parte do entregável F-I (exit criteria: "pg_dump cron; alerta de margem" + spec §4.7 F4 backup). Escopo estritamente operacional.

- [ ] **Step 1: Criar RUNBOOK-RECOVERY.md**

```markdown
# Runbook: Recovery de Banco de Dados (media-forge-db + credit-core-db)

## Verificar backups disponíveis

```bash
# No host da VPS ou no container de backup
docker exec $(docker ps -qf name=media-forge-db-backup) ls -lh /backups/
# Formato: media_forge-YYYYMMDD-HHMMSS.sql.gz (ou .dump)
```

## Restore no media-forge-db (cenário: DB corrompido ou migração errada)

```bash
# 1. Parar o media-forge-mcp para evitar writes durante restore
docker service scale <stack>_media-forge-mcp=0

# 2. Copiar o arquivo de backup do container para o host
docker cp $(docker ps -qf name=media-forge-db-backup):/backups/media_forge-YYYYMMDD-HHMMSS.sql.gz /tmp/mf-restore.sql.gz

# 3. Dropar e recriar o DB (conectar no container media-forge-db)
docker exec -it $(docker ps -qf name=media-forge-db) psql -U mediaforge -c "DROP DATABASE IF EXISTS media_forge;"
docker exec -it $(docker ps -qf name=media-forge-db) psql -U mediaforge -c "CREATE DATABASE media_forge;"

# 4. Restaurar
gunzip -c /tmp/mf-restore.sql.gz | docker exec -i $(docker ps -qf name=media-forge-db) psql -U mediaforge -d media_forge

# 5. Restore drill: verificar contagem de linhas (nao deve ser 0 apos restore real)
docker exec -it $(docker ps -qf name=media-forge-db) psql -U mediaforge -d media_forge -c "SELECT COUNT(*) FROM generations;"

# 6. Restartar o service
docker service scale <stack>_media-forge-mcp=1
```

## Restore no credit-core-db

```bash
# Mesmo fluxo, substituindo:
# - container: credit-core-db / credit-core-db-backup
# - DB: credit_core
# - User: creditcore
# - Tabela de verificacao: ledger_entries

docker exec -it $(docker ps -qf name=credit-core-db) psql -U creditcore -d credit_core -c "SELECT COUNT(*) FROM ledger_entries;"
```

## Verificar integridade pos-restore

```bash
# media-forge: checar generation_id UNIQUE e índices
docker exec -it $(docker ps -qf name=media-forge-db) psql -U mediaforge -d media_forge -c "\d generations"

# credit-core: checar external_id constraint e status de reservas ativas
docker exec -it $(docker ps -qf name=credit-core-db) psql -U creditcore -d credit_core \
  -c "SELECT kind, COUNT(*) FROM ledger_entries GROUP BY kind;"
```

## Alerta de backup falho

O container `media-forge-db-backup` expõe `HEALTHCHECK_PORT=8080`. Configurar no Portainer/Prometheus:
- Alert: `container_health_status{name=~".*backup.*"} != 1` por mais de 2h.
- Verificar logs: `docker service logs <stack>_media-forge-db-backup`
```

- [ ] **Step 2: Commit**

```bash
git add media-forge/deploy/stacks/RUNBOOK-RECOVERY.md
git commit -m "ops(backup): recovery runbook with restore drill for media-forge-db + credit-core-db"
```

---

## Task 12: Validação final F-I

- [ ] **Step 1: Suite completa**

```bash
cd media-forge && pnpm typecheck && pnpm lint && pnpm test
```
Expected: todos os testes verdes (unit/gallery, integration/gallery, testes existentes). Nenhum `describe.skip` que não seja pelo `GALLERY_DATABASE_URL` ausente (que o globalSetup resolve).

- [ ] **Step 2: Smoke test da tool `list_my_generations`**

```bash
# Com server rodando localmente:
cd media-forge && pnpm build
MEDIA_FORGE_API_KEYS=key-aaa GALLERY_DATABASE_URL=postgres://... MEDIA_FORGE_HTTP_PORT=8787 node dist/http/server.js &

# Chamar a tool via MCP initialize + tools/call
curl -s -X POST localhost:8787/mcp \
  -H "Authorization: Bearer key-aaa" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_my_generations","arguments":{"page":1,"page_size":10}}}'
# Expected: {"result":{"content":[{"type":"text","text":"{\"items\":[],\"total\":0,...}"}]}}

kill %1
```

- [ ] **Step 3: Confirmar `/metrics` inclui gauges de margem**

```bash
curl -s localhost:8787/metrics | grep media_forge_margin
# Expected: media_forge_margin_pct_24h <valor>
```

- [ ] **Step 4: Confirmar stdio intacto**

```bash
grep -n "startStdioServer" media-forge/src/mcp/server.ts
```
Expected: presente (stdio nao foi removido).

**F-I exit criteria:**
- `pnpm test` verde (galeria: store + margin + alert-flow + margin-query)
- Tool `list_my_generations` registrada; retorna `GalleryPage` JSON; `tenantId` do AuthContext
- `/metrics` expõe `media_forge_margin_pct_24h` e gauges por modelo
- Cron de alerta dispara `evaluateAndAlert` a cada `GALLERY_ALERT_INTERVAL_MINUTES`
- Stack YAML com service `media-forge-db-backup` (`postgres-backup-local`)
- Stack YAML com service `credit-core-db-backup`
- Runbook de recovery com restore drill concreto

---

## Adendo F-I — variáveis de ambiente novas

| Variável | Obrigatório | Default | Descrição |
|---|---|---|---|
| `GALLERY_DATABASE_URL` | Hosted: sim | — | `postgres://user:pass@host:5432/db` — galeria do media-forge |
| `GALLERY_ALERT_MARGIN_THRESHOLD_PCT` | Não | `30` | Limiar de alerta de margem (%) |
| `GALLERY_ALERT_INTERVAL_MINUTES` | Não | `60` | Intervalo do cron de alerta (min) |
| `GALLERY_ALERT_TELEGRAM_TOKEN` | Não | — | Bot token do Telegram para notificações |
| `GALLERY_ALERT_TELEGRAM_CHAT_ID` | Não | — | Chat ID do Telegram para notificações |

Se `GALLERY_DATABASE_URL` ausente: galeria desabilitada; `list_my_generations` retorna `{ error: 'gallery_not_configured' }`; `/metrics` não inclui gauges de margem. Degradação graceful — self-host sem Postgres continua funcionando.

---

## Self-Review

**Spec coverage:** F-I cobre §4.7 (galeria persistente, `list_my_generations`, backup automático Postgres, observabilidade de margem F5 — dashboard/alerta de custo/margem por tenant e caminho). Schema inclui `credit_value_usd` (regra de ouro #3, §4.4). Alerta operacional via Telegram (email via Notifier injetável).

**Decisões em aberto:**

1. **Ponto de inserção exato na galeria (seam F-B):** `insertGeneration()` é chamada após `recordActualCostUSD`, mas o shape de `result.minioKey` / `result.signedUrl` é definido por F-B. O seam está documentado na Task 7 Step 3 — o executor de F-I (quando F-B estiver pronto) aplica o seam com os nomes reais de campos.

2. **`tenantId` e `creditsDebited` no provider (seam F-C):** o `ctx.tenantId`, `ctx.creditsReserved` e `ctx.creditValueUsd` são injetados via AuthContext de F-C. Enquanto F-C não existir, `tenantId` usa `'default'` (self-host). O executor confirma os nomes exatos de campo quando F-C estiver implementada.

3. **Auth: `opts.auth?.tenantId` em `registerAllTools`:** a interface `RegisterAllToolsOpts` de `handlers.ts` precisa do campo `auth?: { tenantId?: string }`. Em F-A a interface não tem esse campo. O executor adiciona sem quebrar F-A (campo opcional).

4. **`vitest.config.ts` existente no media-forge:** se já existir configuração com `setupFiles`, `reporters` ou `coverage`, o executor faz `merge` preservando a config existente em vez de substituir.

5. **Env vars do backup na VPS (SCHEDULE, KEEP_DAYS/WEEKS/MONTHS):** confirmados pela imagem `prodrigestivill/postgres-backup-local` como variáveis canônicas. Valores `@daily` / 7 / 4 / 6 são padrões razoáveis — confirmar contra a stack `meuagente` da VPS antes de deployar (pode estar usando `@hourly` ou valores diferentes de KEEP).

6. **Formato do arquivo de backup:** a imagem `postgres-backup-local` usa `pg_dump -Fc` (formato custom) por padrão, não `.sql.gz` puro. O runbook usa `gunzip -c ... | psql` (para `.sql.gz`) — se o formato for `Fc`, o restore usa `pg_restore -d`. Confirmar o `POSTGRES_EXTRA_OPTS` da stack meuagente para alinhar o formato antes de produção.

**Placeholder scan:** nenhum placeholder silencioso. Campos marcados como "CONFIRMAR" nos YAMLs são itens operacionais explícitos (não são `TODO` de código), documentados nas decisões em aberto #5 e #6. O seam F-B é documentado com código-de-intenção explícito (Task 7 Step 3), não código incompleto.

**Type consistency:** `GenerationRecord` / `GalleryPage` (Task 2) usados em `GalleryStore` (Task 3), `computeMargin` (Task 4), `GalleryStore.generationsInPeriod` (Task 8). `InsertGenerationOpts` alinha com o seam F-B (Task 7). `Notifier` interface (Task 4) implementada por `createTelegramNotifier`/`noopNotifier` (Task 7) e consumida por `evaluateAndAlert` (Task 4) e `startMarginCron` (Task 9). `MarginReport` consistente entre Tasks 4, 8 e 9.

**Known execution-time:** (1) `embedded-postgres` baixa binário Postgres na 1ª execução (~tempo de CI); o `testTimeout: 30000` cobre isso. (2) `globalSetup` + `pool: 'forks'` é o padrão exato do credit-core — validado. (3) Se o media-forge já tiver `vitest.config.ts` com `include` diferente de `'tests/**/*.test.ts'`, preservar o padrão existente. (4) O cron via `setInterval` no Node.js funciona mesmo com o event loop ativo (HTTP server mantém o loop); não há risco de GC.
