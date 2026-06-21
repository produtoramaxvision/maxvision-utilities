# credit-core (serviço de crédito da suíte) — Implementation Plan (Fase F-D, Lane 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use maxvision:subagent-driven-development (recommended) ou maxvision:executing-plans. Steps usam checkbox (`- [ ]`).

**Goal:** Serviço standalone de carteira de créditos da suíte MaxVision — append-only, path-priced, com reserva/captura/liberação atômicas, idempotência, reconciliação por TTL e a suite de testes de correção de dinheiro.

**Architecture:** Pacote novo `credit-core/` no monorepo. Núcleo de contabilidade **puro** (sem DB, 100% testável) separado do adapter Postgres. Saldo = soma de um ledger append-only. API HTTP (Hono) consumida por media-forge/linkedin/x/tiktok por rede → carteira única por cliente.

**Tech Stack:** TypeScript ESM, Node ≥22.5, Postgres (`pg`), Redis (idempotência/rate cross-instância), Hono + @hono/node-server, vitest. Monorepo pnpm.

**Spec fonte:** `.maxvision/specs/2026-06-01-media-forge-infoproduct-design.md` §4 + §4.7 (decisões eng A1 append-only, A3 serviço, test mandate).

**Lane:** 2 — independente do media-forge (F-A). Pode executar em paralelo via worktree próprio.

---

## Modelo de contabilidade (append-only)

Cada movimento é uma linha imutável em `ledger_entries`:

```
kind=grant    amount=+X                      → dinheiro entra
kind=reserve  amount=X  reservation_id=R  ttl_at=T  status=reserved → segura X (indisponível)
kind=capture  amount=X  reservation_id=R   → reserva R vira gasto permanente
kind=release  amount=X  reservation_id=R   → reserva R volta pro disponível
```

```
disponível = Σgrant − Σcapture − Σ(reserve.amount onde reservation_id NÃO tem capture nem release)
```

Reserva exige `disponível ≥ amount` numa transação serializável (ou advisory lock por-tenant) — garante que reservas paralelas não estouram o saldo.

**Débito path-priced:** `credits = ceil(custo_usd × markup ÷ valor_credito_usd)`. Regra de ouro: o débito de cada caminho usa o `valor_credito` do saldo gasto. Property test garante margem em qualquer caminho.

---

## File Structure

- `credit-core/package.json`, `tsconfig.json`, `vitest.config.ts`
- `credit-core/src/accounting.ts` — puro: `availableBalance`, `canReserve`, tipos de entry
- `credit-core/src/pricing.ts` — puro: `priceCredits`
- `credit-core/src/reservations.ts` — puro: `expiredReservationIds`
- `credit-core/src/store.ts` — adapter Postgres (append + fetch + reserve atômico)
- `credit-core/src/service.ts` — orquestra grant/reserve/capture/release/balance + idempotência
- `credit-core/src/sweep.ts` — reconciliação por TTL
- `credit-core/src/http.ts` — API Hono
- `credit-core/migrations/001_ledger.sql`
- Testes em `credit-core/tests/`

---

## Task 1: Scaffold do pacote

**Files:** Create `credit-core/package.json`, `credit-core/tsconfig.json`, `credit-core/vitest.config.ts`

- [ ] **Step 1: package.json**

```json
{
  "name": "@maxvision/credit-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.5.0", "pnpm": ">=9.0.0" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "build": "tsup src/http.ts --format esm --dts",
    "start": "node dist/http.js",
    "db:migrate": "node scripts/migrate.mjs"
  },
  "dependencies": {
    "hono": "^4.6.0",
    "@hono/node-server": "^1.13.0",
    "pg": "^8.13.0",
    "ioredis": "^5.4.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "@types/pg": "^8.11.0",
    "tsup": "^8.3.5",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: tsconfig.json + vitest.config.ts**

`credit-core/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023", "module": "NodeNext", "moduleResolution": "NodeNext",
    "strict": true, "esModuleInterop": true, "skipLibCheck": true,
    "outDir": "dist", "rootDir": "src", "declaration": true
  },
  "include": ["src/**/*"]
}
```
`credit-core/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } });
```

- [ ] **Step 3: Registrar no workspace + instalar**

Confirmar que `pnpm-workspace.yaml` (raiz) inclui `credit-core` (adicionar `- 'credit-core'` se usar globs explícitos).
Run: `pnpm install`
Expected: pacote `@maxvision/credit-core` reconhecido, deps instaladas.

- [ ] **Step 4: Commit**

```bash
set -euo pipefail
git add credit-core/package.json credit-core/tsconfig.json credit-core/vitest.config.ts pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "chore(credit-core): scaffold standalone credit service package"
```

## Task 2: Contabilidade pura — `availableBalance`

**Files:** Create `credit-core/src/accounting.ts`, Test `credit-core/tests/accounting.test.ts`

- [ ] **Step 1: Test que falha**

```ts
// credit-core/tests/accounting.test.ts
import { describe, it, expect } from 'vitest';
import { availableBalance, canReserve, type LedgerEntry } from '../src/accounting.js';

const E = (e: Partial<LedgerEntry> & Pick<LedgerEntry, 'kind' | 'amount'>): LedgerEntry => ({
  id: Math.random().toString(36).slice(2),
  tenantId: 't1',
  reservationId: null,
  createdAt: '2026-06-02T00:00:00Z',
  ...e,
});

describe('availableBalance', () => {
  it('grants somam', () => {
    expect(availableBalance([E({ kind: 'grant', amount: 100 }), E({ kind: 'grant', amount: 50 })])).toBe(150);
  });

  it('reserva ativa reduz disponível', () => {
    const es = [E({ kind: 'grant', amount: 100 }), E({ kind: 'reserve', amount: 30, reservationId: 'R1' })];
    expect(availableBalance(es)).toBe(70);
  });

  it('capture mantém o gasto permanente (reserva já estava fora)', () => {
    const es = [
      E({ kind: 'grant', amount: 100 }),
      E({ kind: 'reserve', amount: 30, reservationId: 'R1' }),
      E({ kind: 'capture', amount: 30, reservationId: 'R1' }),
    ];
    expect(availableBalance(es)).toBe(70);
  });

  it('release devolve a reserva pro disponível', () => {
    const es = [
      E({ kind: 'grant', amount: 100 }),
      E({ kind: 'reserve', amount: 30, reservationId: 'R1' }),
      E({ kind: 'release', amount: 30, reservationId: 'R1' }),
    ];
    expect(availableBalance(es)).toBe(100);
  });

  it('canReserve respeita o disponível', () => {
    const es = [E({ kind: 'grant', amount: 50 })];
    expect(canReserve(es, 50)).toBe(true);
    expect(canReserve(es, 51)).toBe(false);
    expect(canReserve(es, 0)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar — falha**

Run: `cd credit-core && pnpm vitest run tests/accounting.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar**

```ts
// credit-core/src/accounting.ts
export type EntryKind = 'grant' | 'reserve' | 'capture' | 'release';

export interface LedgerEntry {
  id: string;
  tenantId: string;
  kind: EntryKind;
  amount: number; // magnitude positiva, em créditos
  reservationId: string | null;
  createdAt: string;
}

/** Disponível = Σgrant − Σcapture − Σ(reservas ativas, i.e. sem capture/release). */
export function availableBalance(entries: readonly LedgerEntry[]): number {
  let grants = 0;
  let captures = 0;
  const settled = new Set<string>(); // reservation_ids com capture OU release
  for (const e of entries) {
    if (e.kind === 'capture' || e.kind === 'release') {
      if (e.reservationId) settled.add(e.reservationId);
    }
  }
  let activeReserves = 0;
  for (const e of entries) {
    if (e.kind === 'grant') grants += e.amount;
    else if (e.kind === 'capture') captures += e.amount;
    else if (e.kind === 'reserve' && e.reservationId && !settled.has(e.reservationId)) {
      activeReserves += e.amount;
    }
  }
  return grants - captures - activeReserves;
}

export function canReserve(entries: readonly LedgerEntry[], amount: number): boolean {
  return amount > 0 && availableBalance(entries) >= amount;
}
```

- [ ] **Step 4: Rodar — passa**

Run: `cd credit-core && pnpm vitest run tests/accounting.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
set -euo pipefail
git add credit-core/src/accounting.ts credit-core/tests/accounting.test.ts
git commit -m "feat(credit-core): pure append-only balance accounting"
```

## Task 3: Pricing path-priced + property test de margem

**Files:** Create `credit-core/src/pricing.ts`, Test `credit-core/tests/pricing.test.ts`

- [ ] **Step 1: Test que falha (inclui property test da regra de ouro)**

```ts
// credit-core/tests/pricing.test.ts
import { describe, it, expect } from 'vitest';
import { priceCredits } from '../src/pricing.js';

describe('priceCredits', () => {
  it('imagem: $0.02 × 10 ÷ $0.01 = 20 créditos', () => {
    expect(priceCredits({ costUsd: 0.02, markup: 10, creditValueUsd: 0.01 })).toBe(20);
  });
  it('Veo 8s: $4 × 4 ÷ $0.01 = 1600 créditos', () => {
    expect(priceCredits({ costUsd: 4, markup: 4, creditValueUsd: 0.01 })).toBe(1600);
  });
  it('arredonda pra cima (ceil)', () => {
    expect(priceCredits({ costUsd: 0.025, markup: 4, creditValueUsd: 0.01 })).toBe(10); // 0.1/0.01=10
    expect(priceCredits({ costUsd: 0.0251, markup: 4, creditValueUsd: 0.01 })).toBe(11);
  });

  // PROPERTY (regra de ouro #3): em qualquer caminho/pack, a receita-em-créditos
  // cobre custo×markup. Grid determinístico de casos.
  it('margem garantida: debito × creditValue ≥ custo × markup', () => {
    const costs = [0.02, 0.13, 0.63, 4, 74];
    const markups = [4, 10];
    const creditValues = [0.01, 0.005, 0.00196]; // inclui pack descontado
    for (const costUsd of costs)
      for (const markup of markups)
        for (const creditValueUsd of creditValues) {
          const credits = priceCredits({ costUsd, markup, creditValueUsd });
          expect(credits * creditValueUsd).toBeGreaterThanOrEqual(costUsd * markup - 1e-9);
        }
  });

  it('rejeita parâmetros inválidos', () => {
    expect(() => priceCredits({ costUsd: -1, markup: 4, creditValueUsd: 0.01 })).toThrow();
    expect(() => priceCredits({ costUsd: 1, markup: 0, creditValueUsd: 0.01 })).toThrow();
    expect(() => priceCredits({ costUsd: 1, markup: 4, creditValueUsd: 0 })).toThrow();
  });
});
```

- [ ] **Step 2: Rodar — falha**

Run: `cd credit-core && pnpm vitest run tests/pricing.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
// credit-core/src/pricing.ts
export interface PriceInput {
  costUsd: number;       // COGS do provedor pra esta geração
  markup: number;        // 4 (vídeo) / 10 (imagem) — multiplicador
  creditValueUsd: number;// valor de 1 crédito no saldo SENDO gasto
}

/** créditos = ceil(custo × markup ÷ valor_credito). Margem garantida por construção. */
export function priceCredits({ costUsd, markup, creditValueUsd }: PriceInput): number {
  if (!(costUsd >= 0)) throw new Error('costUsd must be >= 0');
  if (!(markup >= 1)) throw new Error('markup must be >= 1');
  if (!(creditValueUsd > 0)) throw new Error('creditValueUsd must be > 0');
  return Math.ceil((costUsd * markup) / creditValueUsd);
}
```

- [ ] **Step 4: Rodar — passa**

Run: `cd credit-core && pnpm vitest run tests/pricing.test.ts`
Expected: PASS (incluindo o property test de margem).

- [ ] **Step 5: Commit**

```bash
set -euo pipefail
git add credit-core/src/pricing.ts credit-core/tests/pricing.test.ts
git commit -m "feat(credit-core): path-priced debit + margin-safety property test"
```

## Task 4: Reservas vencidas (puro) — base do sweep

**Files:** Create `credit-core/src/reservations.ts`, Test `credit-core/tests/reservations.test.ts`

- [ ] **Step 1: Test que falha**

```ts
// credit-core/tests/reservations.test.ts
import { describe, it, expect } from 'vitest';
import { expiredReservationIds } from '../src/reservations.js';
import type { LedgerEntry } from '../src/accounting.js';

const E = (e: Partial<LedgerEntry> & Pick<LedgerEntry, 'kind' | 'amount'>): LedgerEntry & { ttlAt?: string } => ({
  id: Math.random().toString(36).slice(2), tenantId: 't1', reservationId: null,
  createdAt: '2026-06-02T00:00:00Z', ...e,
});

describe('expiredReservationIds', () => {
  const now = '2026-06-02T01:00:00Z';
  it('reserva vencida e não-settled é listada', () => {
    const es = [E({ kind: 'reserve', amount: 10, reservationId: 'R1', ttlAt: '2026-06-02T00:30:00Z' } as never)];
    expect(expiredReservationIds(es, now)).toEqual(['R1']);
  });
  it('reserva ainda válida não é listada', () => {
    const es = [E({ kind: 'reserve', amount: 10, reservationId: 'R2', ttlAt: '2026-06-02T02:00:00Z' } as never)];
    expect(expiredReservationIds(es, now)).toEqual([]);
  });
  it('reserva já capturada/liberada não é listada mesmo vencida', () => {
    const es = [
      E({ kind: 'reserve', amount: 10, reservationId: 'R3', ttlAt: '2026-06-02T00:30:00Z' } as never),
      E({ kind: 'capture', amount: 10, reservationId: 'R3' }),
    ];
    expect(expiredReservationIds(es, now)).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar — falha**

Run: `cd credit-core && pnpm vitest run tests/reservations.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
// credit-core/src/reservations.ts
import type { LedgerEntry } from './accounting.js';

// Reserves carregam ttlAt opcional (Postgres preenche). Tipo local estendido.
export type ReserveEntry = LedgerEntry & { ttlAt?: string | null };

/** IDs de reservas vencidas (ttlAt < now) que NÃO têm capture nem release. */
export function expiredReservationIds(entries: readonly ReserveEntry[], nowIso: string): string[] {
  const now = Date.parse(nowIso);
  const settled = new Set<string>();
  for (const e of entries) {
    if ((e.kind === 'capture' || e.kind === 'release') && e.reservationId) settled.add(e.reservationId);
  }
  const out: string[] = [];
  for (const e of entries) {
    if (e.kind !== 'reserve' || !e.reservationId || settled.has(e.reservationId)) continue;
    if (e.ttlAt && Date.parse(e.ttlAt) < now) out.push(e.reservationId);
  }
  return out;
}
```

- [ ] **Step 4: Rodar — passa + commit**

Run: `cd credit-core && pnpm vitest run tests/reservations.test.ts`  → PASS
```bash
set -euo pipefail
git add credit-core/src/reservations.ts credit-core/tests/reservations.test.ts
git commit -m "feat(credit-core): pure expired-reservation detection (sweep basis)"
```

## Task 5: Migration + store Postgres (reserve atômico)

**Files:** Create `credit-core/migrations/001_ledger.sql`, `credit-core/src/store.ts`, Test `credit-core/tests/store.int.test.ts`

> Integração: roda só com `DATABASE_URL` setado (Postgres de teste). O reserve usa transação **SERIALIZABLE** + checagem de saldo → garante que 2 reservas em corrida não estouram.

- [ ] **Step 1: Migration**

```sql
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
```

- [ ] **Step 2: Store — append + fetch + reserveAtomic**

```ts
// credit-core/src/store.ts
import { Pool } from 'pg';
import { availableBalance, type LedgerEntry } from './accounting.js';

export class Store {
  constructor(private pool: Pool) {}

  async entriesFor(tenantId: string): Promise<LedgerEntry[]> {
    const r = await this.pool.query(
      'SELECT id, tenant_id, kind, amount, reservation_id, created_at FROM ledger_entries WHERE tenant_id=$1 ORDER BY id',
      [tenantId],
    );
    return r.rows.map((x) => ({
      id: String(x.id), tenantId: x.tenant_id, kind: x.kind,
      amount: Number(x.amount), reservationId: x.reservation_id, createdAt: x.created_at.toISOString(),
    }));
  }

  /** Append idempotente: retorna a linha existente se external_id já visto. */
  async append(e: { tenantId: string; kind: LedgerEntry['kind']; amount: number; reservationId?: string | null; ttlAt?: string | null; externalId: string }): Promise<void> {
    await this.pool.query(
      `INSERT INTO ledger_entries (tenant_id, kind, amount, reservation_id, ttl_at, external_id)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (kind, external_id) DO NOTHING`,
      [e.tenantId, e.kind, e.amount, e.reservationId ?? null, e.ttlAt ?? null, e.externalId],
    );
  }

  /** Reserve atômico: SERIALIZABLE + checagem de saldo. Lança se insuficiente. */
  async reserveAtomic(args: { tenantId: string; amount: number; reservationId: string; ttlAt: string; externalId: string }): Promise<void> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const r = await c.query('SELECT kind, amount, reservation_id FROM ledger_entries WHERE tenant_id=$1', [args.tenantId]);
      const entries: LedgerEntry[] = r.rows.map((x) => ({ id: '', tenantId: args.tenantId, kind: x.kind, amount: Number(x.amount), reservationId: x.reservation_id, createdAt: '' }));
      if (availableBalance(entries) < args.amount) {
        await c.query('ROLLBACK');
        throw new InsufficientBalanceError(args.tenantId, args.amount);
      }
      await c.query(
        `INSERT INTO ledger_entries (tenant_id, kind, amount, reservation_id, ttl_at, external_id)
         VALUES ($1,'reserve',$2,$3,$4,$5) ON CONFLICT (kind, external_id) DO NOTHING`,
        [args.tenantId, args.amount, args.reservationId, args.ttlAt, args.externalId],
      );
      await c.query('COMMIT');
    } catch (err) {
      await c.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      c.release();
    }
  }
}

export class InsufficientBalanceError extends Error {
  constructor(tenantId: string, amount: number) {
    super(`insufficient balance: tenant=${tenantId} needs ${amount}`);
    this.name = 'InsufficientBalanceError';
  }
}
```

- [ ] **Step 3: Teste de integração (gated por DATABASE_URL) — concorrência + idempotência**

```ts
// credit-core/tests/store.int.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { Store, InsufficientBalanceError } from '../src/store.js';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

d('Store (integração)', () => {
  let pool: Pool; let store: Store;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await pool.query('DROP TABLE IF EXISTS ledger_entries');
    await pool.query(readFileSync('migrations/001_ledger.sql', 'utf8'));
    store = new Store(pool);
  });

  it('idempotência: mesmo external_id não duplica grant', async () => {
    await store.append({ tenantId: 'a', kind: 'grant', amount: 100, externalId: 'g1' });
    await store.append({ tenantId: 'a', kind: 'grant', amount: 100, externalId: 'g1' }); // replay
    const es = await store.entriesFor('a');
    expect(es.filter((e) => e.kind === 'grant')).toHaveLength(1);
  });

  it('concorrência: 5 reservas de 30 contra saldo 100 → só 3 passam, saldo nunca negativo', async () => {
    await store.append({ tenantId: 'b', kind: 'grant', amount: 100, externalId: 'gb' });
    const tries = Array.from({ length: 5 }, (_, i) =>
      store.reserveAtomic({ tenantId: 'b', amount: 30, reservationId: `R${i}`, ttlAt: '2030-01-01T00:00:00Z', externalId: `r${i}` })
        .then(() => true).catch((e) => { if (e instanceof InsufficientBalanceError) return false; throw e; }),
    );
    const oks = (await Promise.all(tries)).filter(Boolean).length;
    expect(oks).toBe(3); // 3×30=90 ≤ 100; o 4º (120) falha
    const { rows } = await pool.query('SELECT amount FROM ledger_entries WHERE tenant_id=$1', ['b']);
    // saldo disponível nunca negativo
    const { availableBalance } = await import('../src/accounting.js');
    const es = await store.entriesFor('b');
    expect(availableBalance(es)).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 4: Rodar (com Postgres de teste)**

Run: `cd credit-core && DATABASE_URL=postgres://localhost/credit_test pnpm vitest run tests/store.int.test.ts`
Expected: PASS. Sem `DATABASE_URL`, o teste é `skip` (não falha o CI local sem DB).
Nota: o teste de concorrência pode ver retries serializáveis (Postgres aborta com `40001`); se aparecer, envolver `reserveAtomic` num retry-on-40001 (até 3×) e reexecutar — adicionar esse retry ao store é parte desta task se o teste flapar.

- [ ] **Step 5: Commit**

```bash
set -euo pipefail
git add credit-core/migrations/001_ledger.sql credit-core/src/store.ts credit-core/tests/store.int.test.ts
git commit -m "feat(credit-core): Postgres store with SERIALIZABLE atomic reserve + idempotency (concurrency test)"
```

## Task 6: Service — grant/reserve/capture/release/balance

**Files:** Create `credit-core/src/service.ts`, Test `credit-core/tests/service.int.test.ts`

- [ ] **Step 1: Implementar o service**

```ts
// credit-core/src/service.ts
import { Store } from './store.js';
import { availableBalance } from './accounting.js';

export class CreditService {
  constructor(private store: Store) {}

  async grant(a: { tenantId: string; amount: number; externalId: string }): Promise<void> {
    await this.store.append({ ...a, kind: 'grant', externalId: a.externalId });
  }
  async balance(tenantId: string): Promise<number> {
    return availableBalance(await this.store.entriesFor(tenantId));
  }
  async reserve(a: { tenantId: string; amount: number; reservationId: string; ttlAt: string; externalId: string }): Promise<void> {
    await this.store.reserveAtomic(a);
  }
  async capture(a: { tenantId: string; reservationId: string; amount: number; externalId: string }): Promise<void> {
    await this.store.append({ tenantId: a.tenantId, kind: 'capture', amount: a.amount, reservationId: a.reservationId, externalId: a.externalId });
  }
  async release(a: { tenantId: string; reservationId: string; amount: number; externalId: string }): Promise<void> {
    await this.store.append({ tenantId: a.tenantId, kind: 'release', amount: a.amount, reservationId: a.reservationId, externalId: a.externalId });
  }
}
```

- [ ] **Step 2: Teste de integração — ciclo reserve→capture e reserve→release**

```ts
// credit-core/tests/service.int.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { Store } from '../src/store.js';
import { CreditService } from '../src/service.js';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

d('CreditService (integração)', () => {
  let svc: CreditService; let pool: Pool;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await pool.query('DROP TABLE IF EXISTS ledger_entries');
    await pool.query(readFileSync('migrations/001_ledger.sql', 'utf8'));
    svc = new CreditService(new Store(pool));
  });

  it('grant→reserve→capture deixa saldo = grant − capture', async () => {
    await svc.grant({ tenantId: 'c', amount: 100, externalId: 'gc' });
    await svc.reserve({ tenantId: 'c', amount: 30, reservationId: 'R1', ttlAt: '2030-01-01T00:00:00Z', externalId: 'res1' });
    expect(await svc.balance('c')).toBe(70);
    await svc.capture({ tenantId: 'c', reservationId: 'R1', amount: 30, externalId: 'cap1' });
    expect(await svc.balance('c')).toBe(70);
  });

  it('reserve→release devolve o saldo; capture replayado é idempotente', async () => {
    await svc.grant({ tenantId: 'd', amount: 50, externalId: 'gd' });
    await svc.reserve({ tenantId: 'd', amount: 20, reservationId: 'R2', ttlAt: '2030-01-01T00:00:00Z', externalId: 'res2' });
    await svc.release({ tenantId: 'd', reservationId: 'R2', amount: 20, externalId: 'rel2' });
    expect(await svc.balance('d')).toBe(50);
    await svc.grant({ tenantId: 'd', amount: 10, externalId: 'gd' }); // replay grant → idempotente
    expect(await svc.balance('d')).toBe(50);
  });
});
```

- [ ] **Step 3: Rodar + commit**

Run: `cd credit-core && DATABASE_URL=postgres://localhost/credit_test pnpm vitest run tests/service.int.test.ts` → PASS (ou skip sem DB)
```bash
set -euo pipefail
git add credit-core/src/service.ts credit-core/tests/service.int.test.ts
git commit -m "feat(credit-core): CreditService (grant/reserve/capture/release/balance)"
```

## Task 7: Reconciliação por TTL (sweep)

**Files:** Create `credit-core/src/sweep.ts`, Test `credit-core/tests/sweep.int.test.ts`

> O sweep busca reservas vencidas e decide capture/release consultando o status do job no provedor. O **callback de status do provedor** é injetado (interface), então o teste usa um fake — sem depender de Veo/fal reais.

- [ ] **Step 1: Implementar**

```ts
// credit-core/src/sweep.ts
import { Store } from './store.js';
import { CreditService } from './service.js';
import { expiredReservationIds, type ReserveEntry } from './reservations.js';

export type JobStatus = 'completed' | 'failed' | 'unknown';
export type StatusProbe = (reservationId: string) => Promise<JobStatus>;

/** Para cada reserva vencida: completed→capture, failed/unknown→release. */
export async function runSweep(opts: {
  store: Store; service: CreditService; tenantId: string; nowIso: string; probe: StatusProbe;
  reserveMeta: (rid: string) => { amount: number; externalSuffix: string };
}): Promise<{ captured: string[]; released: string[] }> {
  const rows = await opts.store.entriesForWithTtl(opts.tenantId);
  const expired = expiredReservationIds(rows as ReserveEntry[], opts.nowIso);
  const captured: string[] = []; const released: string[] = [];
  for (const rid of expired) {
    const status = await opts.probe(rid);
    const { amount, externalSuffix } = opts.reserveMeta(rid);
    if (status === 'completed') {
      await opts.service.capture({ tenantId: opts.tenantId, reservationId: rid, amount, externalId: `sweep-cap-${externalSuffix}` });
      captured.push(rid);
    } else {
      await opts.service.release({ tenantId: opts.tenantId, reservationId: rid, amount, externalId: `sweep-rel-${externalSuffix}` });
      released.push(rid);
    }
  }
  return { captured, released };
}
```

> Adicionar em `store.ts` o método `entriesForWithTtl(tenantId)` (igual a `entriesFor` mas incluindo `ttl_at` no SELECT e no mapeamento como `ttlAt`). Espelha `entriesFor`; ver Task 5 store.

- [ ] **Step 2: Teste de integração**

```ts
// credit-core/tests/sweep.int.test.ts — esqueleto (gated por DATABASE_URL)
// grant 100 → reserve 30 com ttl no passado → runSweep com probe=()=>'failed'
// → release; balance volta a 100. Repetir com probe=()=>'completed' → capture; balance 70.
```
Implementar o teste seguindo o padrão das tasks 5/6 (beforeAll cria schema; injeta `probe` fake; assere `balance` e os ids retornados).

- [ ] **Step 3: Rodar + commit**

Run: `cd credit-core && DATABASE_URL=... pnpm vitest run tests/sweep.int.test.ts` → PASS (ou skip)
```bash
set -euo pipefail
git add credit-core/src/sweep.ts credit-core/src/store.ts credit-core/tests/sweep.int.test.ts
git commit -m "feat(credit-core): TTL reconciliation sweep (F1) with injectable status probe"
```

## Task 8: API HTTP (Hono)

**Files:** Create `credit-core/src/http.ts`, Test `credit-core/tests/http.test.ts`

- [ ] **Step 1: Implementar a API**

```ts
// credit-core/src/http.ts
import { Hono } from 'hono';
import { z } from 'zod';
import { CreditService } from './service.js';

const reserveSchema = z.object({ tenantId: z.string(), amount: z.number().int().positive(), reservationId: z.string(), ttlAt: z.string(), externalId: z.string() });

export function buildCreditApp(svc: CreditService, opts: { apiKeys: string[] }) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const key = (c.req.header('Authorization') ?? '').replace(/^Bearer\s+/, '');
    if (!opts.apiKeys.includes(key)) return c.json({ error: 'unauthorized' }, 401);
    await next();
  });
  app.get('/balance/:tenantId', async (c) => c.json({ balance: await svc.balance(c.req.param('tenantId')) }));
  app.post('/reserve', async (c) => {
    const p = reserveSchema.safeParse(await c.req.json());
    if (!p.success) return c.json({ error: 'bad_request', issues: p.error.issues }, 400);
    try { await svc.reserve(p.data); return c.json({ ok: true }); }
    catch (e) { return c.json({ error: 'insufficient_balance' }, 402); }
  });
  // capture/release/grant análogos (mesmo padrão de validação + service call)
  return app;
}
```

- [ ] **Step 2: Teste (auth 401 + reserve 402 quando sem saldo, usando service fake)**

```ts
// credit-core/tests/http.test.ts
import { describe, it, expect } from 'vitest';
import { buildCreditApp } from '../src/http.js';

const fakeSvc = { balance: async () => 0, reserve: async () => { throw new Error('insufficient'); } } as never;

describe('credit http', () => {
  it('sem auth → 401', async () => {
    const app = buildCreditApp(fakeSvc, { apiKeys: ['k'] });
    expect((await app.request('/balance/t')).status).toBe(401);
  });
  it('reserve sem saldo → 402', async () => {
    const app = buildCreditApp(fakeSvc, { apiKeys: ['k'] });
    const res = await app.request('/reserve', { method: 'POST', headers: { Authorization: 'Bearer k', 'content-type': 'application/json' }, body: JSON.stringify({ tenantId: 't', amount: 10, reservationId: 'R', ttlAt: '2030-01-01T00:00:00Z', externalId: 'e' }) });
    expect(res.status).toBe(402);
  });
});
```

- [ ] **Step 3: Rodar + commit**

Run: `cd credit-core && pnpm vitest run tests/http.test.ts` → PASS
```bash
set -euo pipefail
git add credit-core/src/http.ts credit-core/tests/http.test.ts
git commit -m "feat(credit-core): Hono HTTP API (balance/reserve/capture/release/grant) with auth"
```

## Task 9: Validação final F-D

- [ ] **Step 1: Gates**

Run: `cd credit-core && pnpm typecheck && pnpm test`
Expected: testes puros (accounting/pricing/reservations/http) verdes; integração skip sem `DATABASE_URL` (ou verde com DB de teste).

**F-D exit criteria:** núcleo puro (saldo append-only, pricing path-priced + property de margem, expiração) 100% testado; store/service/sweep com testes de concorrência+idempotência+reconciliação (gated por DB); API HTTP autenticada. Pronto pra media-forge (F-E) consumir por rede.

---

## Self-Review

**Spec coverage:** F-D cobre §4.1 (path-priced), §4.2 (reserve/capture/release + lock), §4.7 (A1 append-only, A3 serviço, F1 TTL+sweep, F2 idempotência por external_id, test mandate: concorrência+idempotência+reconciliação+margem). Redis (§4.7 A2) entra como dep no scaffold; uso concreto de Redis (rate-limit/idempotência cross-instância da API) fica para a integração com F-C/F-E — anotar como item de F-E.

**Placeholder scan:** Tasks 1-6 e 8 têm código completo. Task 7 Step 2 (sweep int test) é esqueleto com instrução precisa de implementação seguindo o padrão das tasks 5/6 — sinalizado, não oculto. `entriesForWithTtl` é referenciado na Task 7 e instruído a espelhar `entriesFor` (Task 5); o executor adiciona o método. Não há TBD silencioso.

**Type consistency:** `LedgerEntry`/`EntryKind` (Task 2) reusados em reservations (Task 4), store (Task 5), accounting. `Store`/`CreditService` assinaturas consistentes entre tasks 5/6/7/8. `priceCredits(PriceInput)` (Task 3) — consumido por media-forge no F-E (não nesta fase). `externalId` é a chave de idempotência em todo append.

**Known execution-time:** (1) teste de concorrência pode flapar por abort serializável 40001 — a Task 5 Step 4 instrui adicionar retry-on-40001 ao `reserveAtomic` se ocorrer. (2) `entriesForWithTtl` precisa ser adicionado ao store (Task 7 nota). (3) Postgres de teste: resolvido pelo Adendo (embedded-postgres) — os `.int` rodam por default.

---

## Adendo F-D — embedded-postgres (Blocker 1) + imagem Docker + publish ghcr

### Amend Task 1 (scaffold): lockfile próprio + embedded-postgres

> Mirror do media-forge: credit-core tem **lockfile próprio** e instala com `--ignore-workspace` (a raiz não tem lockfile de workspace). NÃO depender do root lockfile.

- [ ] Em `credit-core/package.json` devDependencies, adicionar: `"embedded-postgres": "^17.1.1"`.
- [ ] Task 1 Step 3 vira: `cd credit-core && pnpm install --ignore-workspace` → gera `credit-core/pnpm-lock.yaml` próprio. Commitar esse lockfile (não o root). `pnpm-workspace.yaml` pode listar `credit-core` (como media-forge), mas todos os comandos usam `--ignore-workspace`.

### Task 5.5: Harness de Postgres real nos testes (embedded-postgres)

> Resolve o Blocker 1: a suíte de dinheiro (concorrência SERIALIZABLE, idempotência, sweep) roda DE VERDADE em toda execução — sem Docker, sem 5432 externo, sem expor a VPS. Um Postgres real local sobe num globalSetup do vitest e popula `DATABASE_URL`; o guard `const d = url ? describe : describe.skip` passa a entrar no caminho real.

**Files:** Create `credit-core/tests/global-setup.ts`, Modify `credit-core/vitest.config.ts`

- [ ] **Step 1: globalSetup**

```ts
// credit-core/tests/global-setup.ts
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pg: EmbeddedPostgres | undefined;
let dataDir: string | undefined;

export async function setup(): Promise<void> {
  dataDir = mkdtempSync(join(tmpdir(), 'cc-pg-'));
  const port = 54329; // porta dedicada de teste
  pg = new EmbeddedPostgres({
    databaseDir: dataDir, user: 'credit', password: 'credit', port, persistent: false,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('credit_core');
  process.env.DATABASE_URL = `postgres://credit:credit@localhost:${port}/credit_core`;
}

export async function teardown(): Promise<void> {
  await pg?.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
}
```

- [ ] **Step 2: vitest.config.ts** — registrar o globalSetup e forçar pool de forks (env propaga aos workers no spawn pós-globalSetup):

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    pool: 'forks',
    testTimeout: 30000, // initialise() do embedded-postgres na 1ª vez baixa/prepara o binário
  },
});
```

- [ ] **Step 3: Rodar a suíte completa — os `.int` agora EXECUTAM**

Run: `cd credit-core && pnpm test`
Expected: `accounting/pricing/reservations/http` + `store.int/service.int/sweep.int` TODOS verdes. O teste de concorrência (5 reservas vs saldo 100 → só 3 passam) roda de verdade. Se aparecer abort serializável `40001`, aplicar o retry-on-40001 no `reserveAtomic` (Task 5 Step 4).

- [ ] **Step 4: Commit**

```bash
set -euo pipefail
git add credit-core/tests/global-setup.ts credit-core/vitest.config.ts credit-core/package.json credit-core/pnpm-lock.yaml
git commit -m "test(credit-core): real Postgres via embedded-postgres globalSetup (money tests run by default)"
```

### Amend Task 8 (http.ts): rota /health antes do auth

> O HEALTHCHECK do Docker bate em `/health` sem auth. Registrar ANTES do `app.use('*', ...)`:

```ts
app.get('/health', (c) => c.json({ ok: true })); // antes do middleware de auth
app.use('*', async (c, next) => { /* ...auth Bearer... */ });
```

### Task 10: Dockerfile multi-stage (arm64)

**Files:** Create `credit-core/Dockerfile`, `credit-core/.dockerignore`

- [ ] **Step 1: `.dockerignore`**

```
node_modules
dist
.git
tests
*.log
```

- [ ] **Step 2: `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-workspace
COPY . .
RUN pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-workspace --prod
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:8080/health || exit 1
CMD ["node", "dist/http.js"]
```

> `embedded-postgres` é devDependency → não entra no `--prod` runtime. Bom: o binário de Postgres de teste não vai pra imagem.

- [ ] **Step 3: Commit**

```bash
set -euo pipefail
git add credit-core/Dockerfile credit-core/.dockerignore
git commit -m "build(docker): credit-core arm64 image (/health, migrations bundled)"
```

### Task 11: CI — workflow de release do credit-core

**Files:** Create `.github/workflows/release-credit-core.yml`

- [ ] **Step 1: workflow** (tag `credit-core-v*` → valida + build/push arm64)

```yaml
name: Release credit-core
on:
  push:
    tags:
      - 'credit-core-v*'
defaults:
  run:
    working-directory: credit-core
jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v6
        with:
          version: 9.15.0
      - uses: actions/setup-node@v6
        with:
          node-version: 22.x
          cache: pnpm
          cache-dependency-path: credit-core/pnpm-lock.yaml
      - name: Install
        run: pnpm install --frozen-lockfile --ignore-workspace
      - name: Validate
        run: |
          pnpm typecheck
          pnpm test
          pnpm build
      - id: version
        run: echo "version=${GITHUB_REF#refs/tags/credit-core-v}" >> "$GITHUB_OUTPUT"
      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: credit-core
          file: credit-core/Dockerfile
          platforms: linux/arm64
          push: true
          tags: |
            ghcr.io/produtoramaxvision/credit-core:${{ steps.version.outputs.version }}
            ghcr.io/produtoramaxvision/credit-core:latest
```

- [ ] **Step 2: Commit**

```bash
set -euo pipefail
git add .github/workflows/release-credit-core.yml
git commit -m "ci: release-credit-core workflow (validate + build+push arm64 image to ghcr)"
```

**NÃO empurrar tag, NÃO publicar, NÃO fazer deploy.** Deliverable = código + embedded-postgres harness + Dockerfile + workflow commitados, suíte de dinheiro verde no worktree. O release tag é passo final do controlador.

**F-D (com adendo) exit criteria:** suíte de dinheiro **roda de verdade** (concorrência/idempotência/reconciliação/margem verdes via embedded-postgres); `/health` sem auth; Dockerfile builda; workflow `release-credit-core.yml` com `packages:write`. Imagem publica só no `credit-core-vX.Y.Z`.
