# media-forge — Fase F-E: Pagamentos & Billing (Asaas + Stripe → carteira credit-core)

> **For agentic workers:** REQUIRED SUB-SKILL: Use maxvision:subagent-driven-development (recomendado) ou maxvision:executing-plans. Steps usam checkbox (`- [ ]`). Executar task-by-task, TDD (test que falha → implementação → test passa → commit).

**Goal:** Plugar o media-forge na carteira `credit-core` (debitar créditos por geração via reserve→capture→release) e creditá-la pelos rails de pagamento — Asaas (assinatura recorrente Pix R$37,90/mês + packs Pix R$19,90/49,90/99,90) e Stripe (cartão internacional / C1). Webhooks de pagamento concedem créditos de forma idempotente; um sweep reconcilia pagamentos pendentes.

**Architecture:** media-forge é **consumidor por rede** do serviço `credit-core` (`http://credit-core:8080`, Bearer `CREDIT_API_KEY`, rede Docker `net`). Toda geração: `reserve` (estimativa, TTL) ANTES de despachar → `capture` (custo real via `priceCredits`) na conclusão OU `release` na falha. Pagamentos: webhooks Asaas/Stripe → `grant` na carteira, idempotente por `payment_id`. Um `payments` table local (media-forge Postgres) é a fonte de verdade de cada compra (idempotência + reconciliação + `creditValueUsd` por pack — regra de ouro #3). credit-core **não** é tocado neste plano (já deployado, F-D).

**Tech Stack:** TypeScript ESM, Node ≥22.5, Hono (rotas de webhook no mesmo app HTTP do F-A), `pg` (Postgres media-forge), `ioredis` (contador de Veo por ciclo + idempotência cross-instância), `stripe` (SDK oficial), Asaas via `fetch` (sem SDK oficial maduro; `asaas-mcp` confirma shapes em sandbox), vitest.

**Spec fonte:** `.maxvision/specs/2026-06-01-media-forge-infoproduct-design.md` §4 (billing path-priced, ledger reserve/capture/release, 3 regras de ouro, números travados R$37,90 + packs), §4.6 (rails Asaas/Stripe), §4.7 (F1 reconciliação, F2 idempotência por external_id).

**Depende de:**
- **F-C** (entregue) — `AuthContext = { tenantId, tier, scopes }`, `HandlersDeps` carrega `tier`, `buildServer` propaga tier, tier-gates (`free` = só imagem, já gateado por não-registro de tools de vídeo).
- **F-D** `credit-core` (deployado) — API HTTP real: `GET /balance/:tenantId`; `POST /grant {tenantId,amount,externalId}`; `POST /reserve {tenantId,amount,reservationId,ttlAt,externalId}` → 402; `POST /capture {tenantId,reservationId,amount,externalId}`; `POST /release {tenantId,reservationId,amount,externalId}`. Idempotência por `external_id` (ON CONFLICT). `priceCredits({costUsd,markup,creditValueUsd})` = `ceil(custo×markup÷valor_credito)`.

**Lane:** 1 — junta lanes 1+2 (media-forge passa a debitar a carteira credit-core).

**Exit criteria:** (1) compra de pack credita a carteira (idempotente por `payment_id`); (2) cada geração reserva→captura créditos (imagem síncrona; vídeo reserva no submit, captura na conclusão); (3) saldo insuficiente bloqueia a geração (402 do `/reserve`); (4) Veo respeita cap por ciclo + débito recalculado pelo `creditValueUsd` do saldo; (5) sweep de pagamentos pendentes reconcilia; (6) `pnpm typecheck && pnpm lint && pnpm test` verde.

---

## PRÉ-REQUISITOS — GATES DO USUÁRIO (bloqueiam o go-live, NÃO o código)

> O plano é codável e testável **inteiramente com mocks/sandbox**. As credenciais reais e a criação de produtos só são exigidas para o smoke end-to-end (Task 11) e o deploy. Marcar como gate explícito.

### Credenciais a fornecer (sandbox primeiro)
| Var de ambiente | Origem | Notas |
|---|---|---|
| `CREDIT_API_URL` | infra (já deployado) | `http://credit-core:8080` (rede Docker `net`) |
| `CREDIT_API_KEY` | `CREDIT_API_KEYS` do credit-core | Bearer; uma das chaves aceitas pelo serviço |
| `ASAAS_API_KEY` | painel Asaas (sandbox) | `https://api-sandbox.asaas.com`; produção troca a base URL |
| `ASAAS_WEBHOOK_TOKEN` | configurado por você no painel de webhooks Asaas | string estática; o webhook compara contra o header `asaas-access-token` |
| `STRIPE_SECRET_KEY` | painel Stripe (test mode, `sk_test_...`) | |
| `STRIPE_WEBHOOK_SECRET` | `stripe listen` ou endpoint do dashboard (`whsec_...`) | usado por `constructEvent` |
| `DATABASE_URL` | Postgres media-forge | tabelas `payments` + `billing_customers` (migration desta fase) |
| `REDIS_URL` | Redis da VPS (mesmo do F-C) | contador de Veo/ciclo + idempotência |

### Produtos/planos a criar (gate manual, antes do smoke)
1. **Asaas — assinatura recorrente "Criador"**: cobrança Pix recorrente mensal de **R$37,90** (cycle MONTHLY). Anotar o `subscription` id padrão e mapear no código como `PLAN_CREATOR`.
2. **Asaas — 3 packs Pix one-time**: R$19,90 (1.500 cr) · R$49,90 (4.200 cr) · R$99,90 (9.000 cr). Cobrança Pix avulsa (billingType `PIX`). Anotar os valores → o código mapeia `valor BRL → {credits, creditValueUsd}`.
3. **Stripe — produto + price recorrente** (assinatura intl) e **price one-time** (packs intl/C1), expostos via Checkout Session. Anotar os `price` ids.
4. **Webhooks**: registrar a URL pública `…/webhooks/asaas` (eventos de pagamento) e `…/webhooks/stripe` no Stripe dashboard / `stripe listen`.

### Decisões a ratificar (o plano propõe defaults — confirmar)
| Decisão | Default proposto pelo plano | Onde impacta |
|---|---|---|
| **Fonte do `creditValueUsd` para débito (regra de ouro #3)** | A carteira credit-core só guarda créditos (número), sem valor-por-lote. media-forge guarda em `payments.credit_value_usd` o valor de cada compra. Para um débito de Veo, usa-se o **menor `creditValueUsd` entre os lotes pagos ativos do tenant** (mais conservador → garante a margem). Free/promo = lote separado bloqueado pra Veo (regra #1). Default global (sem lote pago): `0.01`. | Task 6 (recálculo Veo), Task 5 (capture) |
| **Tipagem de crédito promo/free (regra de ouro #1)** | `grant` carrega `meta.kind = 'promo' \| 'paid'`. Veo só debita de saldo `paid`. Free/refill diário = `promo`. *credit-core não diferencia tipos na API atual* → media-forge rastreia em `payments`/refill local e **bloqueia Veo se o saldo pago for insuficiente**, independente do saldo promo. | Task 6 (gate Veo), Task 4 (grant) |
| **Cap de Veo por ciclo (regra de ouro #2)** | `creator` = **1 Veo incluso por ciclo** (contador Redis `veo:{tenantId}:{cycleId}`); além do incluso, Veo é permitido mas debitado pelo `creditValueUsd` recalculado (conservador). Cap rígido opcional via env `MEDIA_FORGE_VEO_HARD_CAP`. Reset = renovação da assinatura (webhook de pagamento confirmado avança `cycleId`). | Task 6 |
| **Câmbio buffer R$5,55/USD** | usado só para exibição do quote em BRL e para a checagem de margem por pack; não afeta o débito em créditos (que é path-priced em USD). | Task 7 (margin check) |
| **Contrato anti-double-settle (live vs sweep do credit-core)** | `external_id` de capture/release é **determinístico por reserva**: `cap-{reservationId}` / `rel-{reservationId}`. O sweep do credit-core (F-D) usa `sweep-cap-{suffix}` — **divergente**. NOTA: Para não dobrar capture, F-E padroniza `reservationId = jobId` e `external_id = cap-{jobId}`; o sweep do credit-core deve usar o **mesmo** esquema OU o credit-core deve rejeitar settle de reserva já settled. **Item de contrato cross-serviço a confirmar com F-D antes do go-live.** | Task 2, Task 8 |

---

## File Structure

**Create (media-forge):**
- `src/billing/credit-client.ts` — cliente HTTP media-forge → credit-core (reserve/capture/release/grant/balance) com retry + idempotência por job id
- `src/billing/debit.ts` — orquestra reserve→capture/release em torno de uma geração (puro o quanto der; injeta o client)
- `src/billing/veo-cap.ts` — contador de Veo por ciclo (Redis) + regra de ouro #2/#3 (gate + escolha do `creditValueUsd`)
- `src/billing/payments-store.ts` — adapter Postgres: `payments` + `billing_customers` (idempotência por `payment_id`; lookup customer→tenant; lotes ativos pra `creditValueUsd`)
- `src/billing/packs.ts` — puro: mapa `valor BRL → {credits, creditValueUsd}`; checagem de margem por pack
- `src/billing/asaas-webhook.ts` — handler do webhook Asaas (auth por token + grant idempotente)
- `src/billing/stripe-webhook.ts` — handler do webhook Stripe (constructEvent + grant idempotente)
- `src/billing/reconcile.ts` — sweep de pagamentos pendentes (F1 de pagamento)
- `migrations/media-forge/002_payments.sql` — `payments` + `billing_customers`

**Modify (media-forge):**
- `src/http/app.ts` — rotas `POST /webhooks/asaas`, `POST /webhooks/stripe` (raw body p/ Stripe)
- `src/mcp/handlers.ts` — `HandlersDeps` ganha `tenantId?` + `creditClient?`; geração de imagem (síncrona) e submit de vídeo (assíncrona) embrulhados por `debit.ts`; conclusão de vídeo (poll/webhook-router) dispara o capture
- `src/http/app-internal.ts` — propaga `ctx.tenantId` para `buildServer`/`HandlersDeps`
- `src/mcp/server.ts` — `BuildServerOpts` ganha `tenantId?`; bump versão `'0.3.0'`
- `package.json` — add `stripe`, `pg` (se ausente), `ioredis` (se ausente)

**Test:**
- `tests/unit/billing/credit-client.test.ts`, `debit.test.ts`, `packs.test.ts`, `veo-cap.test.ts`
- `tests/unit/billing/asaas-webhook.test.ts`, `stripe-webhook.test.ts`
- `tests/integration/billing/payments-store.int.test.ts` (gated por `DATABASE_URL`/embedded-postgres)
- `tests/integration/billing/reconcile.int.test.ts`

**O que F-E NÃO refaz (já é F-C):** gating `free = só imagem` (tier-gates por não-registro). F-E adiciona só: gate de saldo (o 402 do `/reserve` É o gate), cap de Veo e regras de ouro #1/#3.

---

## Task 1: Deps + cliente credit-core (reserve/capture/release/grant/balance) com retry + idempotência

**Files:** Modify `package.json`; Create `src/billing/credit-client.ts`, Test `tests/unit/billing/credit-client.test.ts`

### Step 1: Deps

- [ ] Em `media-forge/package.json` `dependencies`, adicionar (confirmar se `pg`/`ioredis` já não vieram do F-C):
```json
"stripe": "^17.5.0",
"pg": "^8.13.0",
"ioredis": "^5.4.0"
```
Run: `cd media-forge && pnpm install`
Expected: lockfile atualizado, sem erro.

### Step 2: Test que falha

```ts
// tests/unit/billing/credit-client.test.ts
import { describe, it, expect, vi } from 'vitest';
import { CreditClient, InsufficientCreditError } from '../../../src/billing/credit-client.js';

const base = { baseUrl: 'http://credit-core:8080', apiKey: 'ck' };

function fetchReturning(status: number, body: unknown, calls: number[] = []) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    calls.push(status);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
}

describe('CreditClient', () => {
  it('balance() faz GET /balance/:tenantId com Bearer', async () => {
    const fetchImpl = fetchReturning(200, { balance: 2500 });
    const c = new CreditClient({ ...base, fetchImpl });
    expect(await c.balance('t1')).toBe(2500);
    const [, init] = fetchImpl.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer ck' });
  });

  it('reserve() 402 → InsufficientCreditError (sem retry)', async () => {
    const calls: number[] = [];
    const fetchImpl = fetchReturning(402, { error: 'insufficient_balance' }, calls);
    const c = new CreditClient({ ...base, fetchImpl });
    await expect(
      c.reserve({ tenantId: 't1', amount: 100, reservationId: 'R1', ttlAt: '2030-01-01T00:00:00Z', externalId: 'res-R1' }),
    ).rejects.toBeInstanceOf(InsufficientCreditError);
    expect(calls).toEqual([402]); // 402 é determinístico → não retenta
  });

  it('capture() retenta em 5xx e tem sucesso na 2ª tentativa', async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      return n === 1
        ? new Response('boom', { status: 503 })
        : new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const c = new CreditClient({ ...base, fetchImpl, retry: { retries: 2, baseDelayMs: 0 } });
    await c.capture({ tenantId: 't1', reservationId: 'R1', amount: 80, externalId: 'cap-R1' });
    expect(n).toBe(2);
  });

  it('externalId idempotente: mesma reserva → mesmo external_id é responsabilidade do caller (client só repassa)', async () => {
    const fetchImpl = fetchReturning(200, { ok: true });
    const c = new CreditClient({ ...base, fetchImpl });
    await c.release({ tenantId: 't1', reservationId: 'R1', amount: 80, externalId: 'rel-R1' });
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ externalId: 'rel-R1' });
  });
});
```

### Step 3: Rodar — falha

Run: `cd media-forge && pnpm vitest run tests/unit/billing/credit-client.test.ts`
Expected: FAIL (módulo inexistente).

### Step 4: Implementar

```ts
// src/billing/credit-client.ts
// Cliente HTTP media-forge → credit-core. Idempotência é responsabilidade do
// caller (externalId determinístico por reserva); o client só repassa + retenta
// erros transitórios (5xx / rede). 402 (saldo insuficiente) é determinístico:
// NUNCA retenta. ON CONFLICT no credit-core torna o replay seguro mesmo em retry.

export interface CreditClientOpts {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  retry?: { retries: number; baseDelayMs: number };
}

export interface ReserveArgs {
  tenantId: string; amount: number; reservationId: string; ttlAt: string; externalId: string;
}
export interface SettleArgs {
  tenantId: string; reservationId: string; amount: number; externalId: string;
}
export interface GrantArgs {
  tenantId: string; amount: number; externalId: string;
}

export class InsufficientCreditError extends Error {
  constructor(public tenantId: string, public amount: number) {
    super(`insufficient credit: tenant=${tenantId} needs ${amount}`);
    this.name = 'InsufficientCreditError';
  }
}
export class CreditServiceError extends Error {
  constructor(public status: number, body: string) {
    super(`credit-core ${status}: ${body.slice(0, 200)}`);
    this.name = 'CreditServiceError';
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class CreditClient {
  private fetchImpl: typeof fetch;
  private retries: number;
  private baseDelayMs: number;

  constructor(private opts: CreditClientOpts) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.retries = opts.retry?.retries ?? 3;
    this.baseDelayMs = opts.retry?.baseDelayMs ?? 200;
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.opts.apiKey}`, 'content-type': 'application/json' };
  }

  /** POST com retry-on-5xx. 402 lança InsufficientCreditError SEM retentar. */
  private async post(path: string, body: unknown): Promise<unknown> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const res = await this.fetchImpl(`${this.opts.baseUrl}${path}`, {
        method: 'POST', headers: this.headers(), body: JSON.stringify(body),
      });
      if (res.status === 402) throw new InsufficientCreditError((body as { tenantId: string }).tenantId, (body as { amount: number }).amount);
      if (res.ok) return res.json().catch(() => ({}));
      if (res.status >= 500 && attempt < this.retries) {
        lastErr = new CreditServiceError(res.status, await res.text().catch(() => ''));
        await sleep(this.baseDelayMs * 2 ** attempt);
        continue;
      }
      throw new CreditServiceError(res.status, await res.text().catch(() => ''));
    }
    throw lastErr ?? new CreditServiceError(0, 'retry exhausted');
  }

  async balance(tenantId: string): Promise<number> {
    const res = await this.fetchImpl(`${this.opts.baseUrl}/balance/${encodeURIComponent(tenantId)}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new CreditServiceError(res.status, await res.text().catch(() => ''));
    const j = (await res.json()) as { balance: number };
    return j.balance;
  }

  async reserve(a: ReserveArgs): Promise<void> { await this.post('/reserve', a); }
  async capture(a: SettleArgs): Promise<void> { await this.post('/capture', a); }
  async release(a: SettleArgs): Promise<void> { await this.post('/release', a); }
  async grant(a: GrantArgs): Promise<void> { await this.post('/grant', a); }
}
```

### Step 5: Rodar — passa + commit

Run: `cd media-forge && pnpm vitest run tests/unit/billing/credit-client.test.ts` → PASS
```bash
set -euo pipefail
cd media-forge
git add package.json pnpm-lock.yaml src/billing/credit-client.ts tests/unit/billing/credit-client.test.ts
git commit -m "feat(billing): credit-core HTTP client with retry + idempotent settle (402 no-retry)"
```

---

## Task 2: Orquestrador reserve→capture/release por geração (`debit.ts`)

**Files:** Create `src/billing/debit.ts`, Test `tests/unit/billing/debit.test.ts`

> Define o ciclo de débito de UMA geração. `reservationId = jobId` (contrato anti-double-settle — ver decisão na tabela de pré-requisitos). `external_id` determinístico: `res-{jobId}` / `cap-{jobId}` / `rel-{jobId}`. Imagem usa o ciclo síncrono completo (reserve→executa→capture/release). Vídeo usa só `reserveForJob` no submit; o capture vem depois (Task 5, na conclusão).

### Step 1: Test que falha

```ts
// tests/unit/billing/debit.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runWithDebit, reserveForJob, captureJob, releaseJob } from '../../../src/billing/debit.js';

function fakeClient() {
  return {
    reserve: vi.fn(async () => {}),
    capture: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
    balance: vi.fn(async () => 1000),
    grant: vi.fn(async () => {}),
  };
}

describe('debit', () => {
  it('sucesso: reserve(estimativa) → executa → capture(custo real)', async () => {
    const client = fakeClient();
    const out = await runWithDebit(
      { client: client as never, tenantId: 't1', jobId: 'J1', estimateCredits: 30, ttlAt: '2030-01-01T00:00:00Z' },
      async () => ({ result: 'img', actualCredits: 20 }),
    );
    expect(out.result).toBe('img');
    expect(client.reserve).toHaveBeenCalledWith(expect.objectContaining({ reservationId: 'J1', externalId: 'res-J1', amount: 30 }));
    expect(client.capture).toHaveBeenCalledWith(expect.objectContaining({ reservationId: 'J1', externalId: 'cap-J1', amount: 20 }));
    expect(client.release).not.toHaveBeenCalled();
  });

  it('falha na execução: release(estimativa) e re-lança o erro', async () => {
    const client = fakeClient();
    await expect(
      runWithDebit(
        { client: client as never, tenantId: 't1', jobId: 'J2', estimateCredits: 30, ttlAt: '2030-01-01T00:00:00Z' },
        async () => { throw new Error('provider down'); },
      ),
    ).rejects.toThrow('provider down');
    expect(client.release).toHaveBeenCalledWith(expect.objectContaining({ reservationId: 'J2', externalId: 'rel-J2', amount: 30 }));
    expect(client.capture).not.toHaveBeenCalled();
  });

  it('reserveForJob/captureJob/releaseJob usam external_id determinístico', async () => {
    const client = fakeClient();
    await reserveForJob({ client: client as never, tenantId: 't', jobId: 'J3', estimateCredits: 5, ttlAt: '2030-01-01T00:00:00Z' });
    await captureJob({ client: client as never, tenantId: 't', jobId: 'J3', actualCredits: 4 });
    expect(client.reserve).toHaveBeenCalledWith(expect.objectContaining({ externalId: 'res-J3' }));
    expect(client.capture).toHaveBeenCalledWith(expect.objectContaining({ externalId: 'cap-J3', amount: 4 }));
  });
});
```

### Step 2: Rodar — falha

Run: `cd media-forge && pnpm vitest run tests/unit/billing/debit.test.ts` → FAIL

### Step 3: Implementar

```ts
// src/billing/debit.ts
// Ciclo de débito de uma geração. reservationId = jobId (contrato anti-double-settle).
// external_id determinístico: res-/cap-/rel- + jobId → idempotente em retry/replay.
import type { CreditClient } from './credit-client.js';

export interface ReserveForJobArgs {
  client: CreditClient; tenantId: string; jobId: string; estimateCredits: number; ttlAt: string;
}
export interface SettleForJobArgs {
  client: CreditClient; tenantId: string; jobId: string;
}

export async function reserveForJob(a: ReserveForJobArgs): Promise<void> {
  await a.client.reserve({
    tenantId: a.tenantId, amount: a.estimateCredits, reservationId: a.jobId,
    ttlAt: a.ttlAt, externalId: `res-${a.jobId}`,
  });
}

/** Captura o CUSTO REAL (não a estimativa). Settla a reserva; a diferença
 *  estimativa-vs-real cai fora corretamente no ledger append-only. */
export async function captureJob(a: SettleForJobArgs & { actualCredits: number }): Promise<void> {
  await a.client.capture({
    tenantId: a.tenantId, reservationId: a.jobId, amount: a.actualCredits, externalId: `cap-${a.jobId}`,
  });
}

export async function releaseJob(a: SettleForJobArgs & { reservedCredits: number }): Promise<void> {
  await a.client.release({
    tenantId: a.tenantId, reservationId: a.jobId, amount: a.reservedCredits, externalId: `rel-${a.jobId}`,
  });
}

export interface RunWithDebitArgs {
  client: CreditClient; tenantId: string; jobId: string; estimateCredits: number; ttlAt: string;
}

/** Ciclo SÍNCRONO completo (imagem): reserve → executa → capture(real) | release(estimativa). */
export async function runWithDebit<T>(
  a: RunWithDebitArgs,
  exec: () => Promise<{ result: T; actualCredits: number }>,
): Promise<{ result: T; actualCredits: number }> {
  await reserveForJob(a);
  let out: { result: T; actualCredits: number };
  try {
    out = await exec();
  } catch (err) {
    await releaseJob({ client: a.client, tenantId: a.tenantId, jobId: a.jobId, reservedCredits: a.estimateCredits });
    throw err;
  }
  await captureJob({ client: a.client, tenantId: a.tenantId, jobId: a.jobId, actualCredits: out.actualCredits });
  return out;
}
```

### Step 4: Rodar — passa + commit

Run: `cd media-forge && pnpm vitest run tests/unit/billing/debit.test.ts` → PASS
```bash
set -euo pipefail
cd media-forge
git add src/billing/debit.ts tests/unit/billing/debit.test.ts
git commit -m "feat(billing): per-generation reserve->capture/release orchestrator (deterministic external_id)"
```

---

## Task 3: Packs — mapa BRL → {credits, creditValueUsd} + checagem de margem (puro)

**Files:** Create `src/billing/packs.ts`, Test `tests/unit/billing/packs.test.ts`

> Os números travados da spec §4.3: R$19,90→1.500cr · R$49,90→4.200cr · R$99,90→9.000cr; assinatura R$37,90→~2.500cr. O `creditValueUsd` de cada pack = `(valor_brl ÷ R$5,55/USD) ÷ créditos`. A checagem de margem (regra de ouro #3): `creditValueUsd × créditos_Veo ≥ COGS_Veo × (1+markup) + fee` — roda em **todo** pack antes de publicar.

### Step 1: Test que falha

```ts
// tests/unit/billing/packs.test.ts
import { describe, it, expect } from 'vitest';
import { PACKS, SUBSCRIPTION, packForBrl, marginSafe, VEO_8S_COGS_USD } from '../../../src/billing/packs.js';

describe('packs', () => {
  it('mapeia os 3 packs Pix da spec', () => {
    expect(packForBrl(19.9)?.credits).toBe(1500);
    expect(packForBrl(49.9)?.credits).toBe(4200);
    expect(packForBrl(99.9)?.credits).toBe(9000);
    expect(packForBrl(7.77)).toBeUndefined();
  });

  it('assinatura Criador = R$37,90 / ~2500 cr', () => {
    expect(SUBSCRIPTION.brl).toBe(37.9);
    expect(SUBSCRIPTION.credits).toBe(2500);
  });

  it('creditValueUsd decresce com packs maiores (mais créditos por real)', () => {
    const small = packForBrl(19.9)!;
    const large = packForBrl(99.9)!;
    expect(large.creditValueUsd).toBeLessThan(small.creditValueUsd);
  });

  // REGRA DE OURO #3: em qualquer pack, Veo recalculado ainda cobre COGS×(1+markup)+fee.
  it('todos os packs passam na checagem de margem de Veo (gate de publicação)', () => {
    for (const p of [...PACKS, SUBSCRIPTION]) {
      expect(marginSafe(p), `pack ${p.brl} deve ser margin-safe`).toBe(true);
    }
  });

  it('marginSafe rejeita um pack hipotético barato demais', () => {
    expect(marginSafe({ brl: 1, credits: 1_000_000, creditValueUsd: 0.0000001 })).toBe(false);
  });
});
```

### Step 2: Rodar — falha

Run: `cd media-forge && pnpm vitest run tests/unit/billing/packs.test.ts` → FAIL

### Step 3: Implementar

```ts
// src/billing/packs.ts
// Números travados da spec §4.3 (decisão do usuário 2026-06-01).
// creditValueUsd = (brl / FX_BRL_PER_USD) / credits. Regra de ouro #3: o débito de
// Veo usa o creditValueUsd do SALDO gasto; a checagem de margem garante que mesmo o
// pack mais "barato por crédito" ainda cobre COGS_Veo×(1+markup)+fee.

export const FX_BRL_PER_USD = 5.55; // câmbio com buffer (spec §4.3)
export const VIDEO_MARKUP = 4;      // markup de vídeo (spec §4.3)
export const VEO_8S_COGS_USD = 4.0; // COGS Veo 8s (spec §4.3 tabela)
export const ASAAS_FEE_USD = 1.99 / FX_BRL_PER_USD; // ~R$1,99 fixo (spec §4.6)

export interface Pack {
  readonly brl: number;
  readonly credits: number;
  readonly creditValueUsd: number;
}

function mkPack(brl: number, credits: number): Pack {
  return { brl, credits, creditValueUsd: brl / FX_BRL_PER_USD / credits };
}

export const PACKS: readonly Pack[] = [
  mkPack(19.9, 1500),
  mkPack(49.9, 4200),
  mkPack(99.9, 9000),
];

export const SUBSCRIPTION: Pack = mkPack(37.9, 2500);

export function packForBrl(brl: number): Pack | undefined {
  // tolerância de centavos pra ruído de ponto flutuante vindo do provedor
  return [...PACKS, SUBSCRIPTION].find((p) => Math.abs(p.brl - brl) < 0.005);
}

/** Quantos créditos um Veo 8s debitaria neste pack (regra de ouro #3, conservador). */
export function veoDebitCredits(creditValueUsd: number): number {
  return Math.ceil((VEO_8S_COGS_USD * VIDEO_MARKUP) / creditValueUsd);
}

/** Gate de publicação: receita-em-USD do débito de Veo ≥ COGS×(1+markup) + fee. */
export function marginSafe(p: Pack): boolean {
  const debitCredits = veoDebitCredits(p.creditValueUsd);
  const revenueUsd = debitCredits * p.creditValueUsd;
  const floorUsd = VEO_8S_COGS_USD * (1 + VIDEO_MARKUP) + ASAAS_FEE_USD;
  return revenueUsd >= floorUsd;
}
```

### Step 4: Rodar — passa + commit

Run: `cd media-forge && pnpm vitest run tests/unit/billing/packs.test.ts` → PASS
```bash
set -euo pipefail
cd media-forge
git add src/billing/packs.ts tests/unit/billing/packs.test.ts
git commit -m "feat(billing): pack catalog (locked BRL numbers) + golden-rule#3 margin-safety gate"
```

---

## Task 4: Persistência — `payments` + `billing_customers` (idempotência por payment_id)

**Files:** Create `migrations/media-forge/002_payments.sql`, `src/billing/payments-store.ts`, Test `tests/integration/billing/payments-store.int.test.ts`

> `payments` backa: (a) **grant idempotente** por `payment_id` (UNIQUE), (b) **reconciliação** de pendentes (Task 9), (c) **lotes ativos** pra escolher o `creditValueUsd` conservador (Task 6). `billing_customers` mapeia o customer/subscription do provedor → `tenantId` (webhook não consegue creditar sem isso). Gated por `DATABASE_URL` (embedded-postgres, espelhando o harness do credit-core F-D).

### Step 1: Migration

```sql
-- migrations/media-forge/002_payments.sql
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
```

### Step 2: Store

```ts
// src/billing/payments-store.ts
import { Pool } from 'pg';

export interface PaymentRow {
  paymentId: string; provider: 'asaas' | 'stripe'; tenantId: string;
  kind: 'subscription' | 'pack'; brl: number | null; credits: number;
  creditValueUsd: number; creditKind: 'paid' | 'promo'; status: string;
}

export class PaymentsStore {
  constructor(private pool: Pool) {}

  async tenantForCustomer(provider: string, customerId: string): Promise<string | undefined> {
    const r = await this.pool.query(
      'SELECT tenant_id FROM billing_customers WHERE provider=$1 AND customer_id=$2',
      [provider, customerId],
    );
    return r.rows[0]?.tenant_id;
  }

  async linkCustomer(a: { tenantId: string; provider: string; customerId: string; subscriptionId?: string }): Promise<void> {
    await this.pool.query(
      `INSERT INTO billing_customers (tenant_id, provider, customer_id, subscription_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (provider, customer_id) DO UPDATE SET subscription_id = COALESCE(EXCLUDED.subscription_id, billing_customers.subscription_id)`,
      [a.tenantId, a.provider, a.customerId, a.subscriptionId ?? null],
    );
  }

  /** Insere o pagamento (idempotente por payment_id). Retorna false se já existia
   *  (replay) → o caller NÃO concede crédito de novo. */
  async recordPaymentOnce(p: PaymentRow & { externalGrantId: string; rawEvent: unknown }): Promise<boolean> {
    const r = await this.pool.query(
      `INSERT INTO payments
         (payment_id, provider, tenant_id, kind, brl, credits, credit_value_usd, credit_kind, status, external_grant_id, raw_event)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'confirmed',$9,$10)
       ON CONFLICT (provider, payment_id) DO NOTHING
       RETURNING id`,
      [p.paymentId, p.provider, p.tenantId, p.kind, p.brl, p.credits, p.creditValueUsd, p.creditKind, p.externalGrantId, p.rawEvent],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async markGranted(provider: string, paymentId: string): Promise<void> {
    await this.pool.query(
      `UPDATE payments SET status='granted', granted_at=now() WHERE provider=$1 AND payment_id=$2`,
      [provider, paymentId],
    );
  }

  /** Lotes pagos ativos do tenant — base do creditValueUsd conservador (regra #3). */
  async paidCreditValuesFor(tenantId: string): Promise<number[]> {
    const r = await this.pool.query(
      `SELECT credit_value_usd FROM payments
        WHERE tenant_id=$1 AND credit_kind='paid' AND status IN ('confirmed','granted')`,
      [tenantId],
    );
    return r.rows.map((x) => Number(x.credit_value_usd));
  }

  /** Pagamentos confirmados mas ainda não concedidos (reconciliação F1 de pagamento). */
  async pendingGrants(): Promise<Array<{ provider: string; paymentId: string; tenantId: string; credits: number; externalGrantId: string }>> {
    const r = await this.pool.query(
      `SELECT provider, payment_id, tenant_id, credits, external_grant_id FROM payments WHERE status='confirmed'`,
    );
    return r.rows.map((x) => ({ provider: x.provider, paymentId: x.payment_id, tenantId: x.tenant_id, credits: Number(x.credits), externalGrantId: x.external_grant_id }));
  }
}
```

### Step 3: Teste de integração (idempotência por payment_id)

```ts
// tests/integration/billing/payments-store.int.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { PaymentsStore } from '../../../src/billing/payments-store.js';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

d('PaymentsStore', () => {
  let store: PaymentsStore; let pool: Pool;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await pool.query('DROP TABLE IF EXISTS payments; DROP TABLE IF EXISTS billing_customers;');
    await pool.query(readFileSync('migrations/media-forge/002_payments.sql', 'utf8'));
    store = new PaymentsStore(pool);
  });

  it('recordPaymentOnce é idempotente por payment_id', async () => {
    const row = { paymentId: 'pay_1', provider: 'asaas' as const, tenantId: 't1', kind: 'pack' as const, brl: 19.9, credits: 1500, creditValueUsd: 0.00239, creditKind: 'paid' as const, status: 'confirmed', externalGrantId: 'grant-pay_1', rawEvent: {} };
    expect(await store.recordPaymentOnce(row)).toBe(true);
    expect(await store.recordPaymentOnce(row)).toBe(false); // replay
  });

  it('tenantForCustomer resolve o mapeamento', async () => {
    await store.linkCustomer({ tenantId: 't9', provider: 'stripe', customerId: 'cus_x', subscriptionId: 'sub_x' });
    expect(await store.tenantForCustomer('stripe', 'cus_x')).toBe('t9');
  });

  it('paidCreditValuesFor retorna os lotes pagos', async () => {
    const vals = await store.paidCreditValuesFor('t1');
    expect(vals).toContain(0.00239);
  });
});
```

### Step 4: Rodar + commit

Run: `cd media-forge && pnpm vitest run tests/integration/billing/payments-store.int.test.ts` (com embedded-postgres → executa; sem DB → skip)
> Nota: se o media-forge ainda não tem o harness embedded-postgres do F-D, adicionar `tests/global-setup-pg.ts` espelhando `credit-core/tests/global-setup.ts` (mesmo `EmbeddedPostgres`, porta dedicada 54330) e registrar no `vitest.config` SÓ para os `*.int.test.ts` de billing. É parte desta task se ausente.
```bash
set -euo pipefail
cd media-forge
git add migrations/media-forge/002_payments.sql src/billing/payments-store.ts tests/integration/billing/payments-store.int.test.ts
git commit -m "feat(billing): payments + billing_customers store (idempotent grant by payment_id)"
```

---

## Task 5: Plugar o débito na geração — imagem (síncrona) + submit de vídeo (assíncrona)

**Files:** Modify `src/mcp/handlers.ts` (`HandlersDeps`, wrappers de imagem/vídeo), `src/mcp/server.ts`, `src/http/app-internal.ts`, Test `tests/unit/billing/debit-wiring.test.ts`

> **Imagem** = ciclo síncrono: `runWithDebit` em volta da chamada de `generateImage*`; `actualCredits = priceCredits({ costUsd: custoReal, markup: 10, creditValueUsd: 0.01 })`. **Vídeo** = só `reserveForJob` no submit (reservationId = jobId retornado); o capture vem na conclusão (poll/webhook-router) lendo `recordActualCost` e chamando `captureJob`. credit-core é injetado via `HandlersDeps.creditClient` + `HandlersDeps.tenantId` (de `ctx.tenantId` do F-C). Quando `creditClient` é `undefined` (self-host sem billing), o caminho é no-op — billing é opcional por construção.

### Step 1: Estender o contrato (sem quebrar F-A/F-C)

- [ ] Em `src/mcp/handlers.ts`, `HandlersDeps`:
```ts
export interface HandlersDeps {
  client: MediaForgeClient;
  config: MediaForgeConfig;
  outputManager?: OutputManager;
  tier?: import('../http/auth.js').Tier;     // F-C
  tenantId?: string;                          // F-E: de ctx.tenantId
  creditClient?: import('../billing/credit-client.js').CreditClient; // F-E: undefined = billing off
}
```
- [ ] Em `src/mcp/server.ts`, `BuildServerOpts` ganha `tenantId?: string` + `creditClient?` e os repassa a `registerAllTools`. Bump versão `'0.3.0'`.
- [ ] Em `src/http/app-internal.ts`, `handleMcpRequest` passa `ctx.tenantId` + um `CreditClient` construído de `CREDIT_API_URL`/`CREDIT_API_KEY` (uma instância por request é aceitável; stateless) ao `buildServer`.

### Step 2: Helper de débito de imagem (no `handlers.ts`)

```ts
// dentro de handlers.ts — helper local
import { runWithDebit, reserveForJob } from '../billing/debit.js';
import { priceCredits } from '@maxvision/credit-core/pricing'; // ou caminho relativo se não publicado
const IMAGE_MARKUP = 10;
const DEFAULT_CREDIT_VALUE_USD = 0.01;

/** Embrulha uma geração de IMAGEM (síncrona) com reserve→capture. No-op se billing off. */
async function withImageDebit<T extends { actualCostUSD?: number }>(
  deps: HandlersDeps, jobId: string, estimateUsd: number, exec: () => Promise<T>,
): Promise<T> {
  if (!deps.creditClient || !deps.tenantId) return exec(); // self-host / billing off
  const estimateCredits = priceCredits({ costUsd: estimateUsd, markup: IMAGE_MARKUP, creditValueUsd: DEFAULT_CREDIT_VALUE_USD });
  const ttlAt = new Date(Date.now() + 120_000).toISOString(); // imagem: TTL curto (2 min)
  const out = await runWithDebit(
    { client: deps.creditClient, tenantId: deps.tenantId, jobId, estimateCredits, ttlAt },
    async () => {
      const result = await exec();
      const actualUsd = result.actualCostUSD ?? estimateUsd;
      const actualCredits = priceCredits({ costUsd: actualUsd, markup: IMAGE_MARKUP, creditValueUsd: DEFAULT_CREDIT_VALUE_USD });
      return { result, actualCredits };
    },
  );
  return out.result;
}
```

- [ ] Embrulhar os 6 wrappers de imagem em `registerAllTools` com `withImageDebit(deps, jobId, estimate, () => generateImage…)`. `jobId` = id determinístico do OutputManager (já existe; ver `JOB_ID_PATTERN`). `estimate` via `estimateImageCost(...)` (já importado).

### Step 3: Reserva no submit de vídeo

- [ ] Os wrappers de vídeo (`generateVideoT2V`/`I2V`/etc.) retornam um `jobId`/`operationName` ao submeter (assíncrono). ANTES de despachar, chamar `reserveForJob({ client, tenantId, jobId, estimateCredits, ttlAt })` com `estimateCredits = priceCredits({ costUsd: estimateVideoCost(...), markup: 4, creditValueUsd: <conservador, Task 6> })` e `ttlAt = now + 2× tempo-máximo-esperado-do-job` (F1: TTL pra o sweep do credit-core liberar reserva presa). O capture vem na Task 5b.

### Step 4: Capture na conclusão do vídeo (poll / webhook-router)

- [ ] No ponto onde o vídeo conclui e `recordActualCost` é chamado (`handleKlingDownload`, `handleKlingPoll` terminal, e o callback do `webhook-router` / `handleVideoWebhookStatus` path), após registrar o custo real, chamar `captureJob({ client, tenantId, jobId, actualCredits })` com `actualCredits = priceCredits({ costUsd: actualUsd, markup: 4, creditValueUsd })`. Em falha terminal do job, chamar `releaseJob`. **Idempotente** por `external_id = cap-{jobId}` — replay do callback não dobra. O sweep do credit-core (TTL) é a **rede de segurança** pra o caso de o callback nunca chegar, não o caminho primário.

### Step 5: Teste de wiring (mock do creditClient)

```ts
// tests/unit/billing/debit-wiring.test.ts
// Constrói um McpServer via buildServer({ tenantId:'t1', creditClient: mock }), chama
// a tool de imagem com input válido (provider mockado via deps.client), e assere:
//   - reserve foi chamado ANTES da geração (estimativa)
//   - capture foi chamado com o custo REAL (não a estimativa)
//   - sem creditClient → nenhuma chamada de billing (self-host).
// Seguir o padrão de tests/integration/http-mcp.test.ts (F-A) p/ montar o server.
```
> Esqueleto sinalizado: o executor implementa montando `buildServer` com `deps.client` mockado (retorna custo real fixo) e `creditClient` espião. Assere a ordem reserve→capture e o no-op sem client.

### Step 6: Rodar + commit

Run: `cd media-forge && pnpm vitest run tests/unit/billing/debit-wiring.test.ts && pnpm typecheck` → PASS
```bash
set -euo pipefail
cd media-forge
git add src/mcp/handlers.ts src/mcp/server.ts src/http/app-internal.ts tests/unit/billing/debit-wiring.test.ts
git commit -m "feat(billing): wire reserve->capture into image (sync) + video (async submit/complete) generation"
```

---

## Task 6: Cap de Veo por ciclo + recálculo pelo creditValueUsd (regras de ouro #1/#2/#3)

**Files:** Create `src/billing/veo-cap.ts`, Test `tests/unit/billing/veo-cap.test.ts`

> **Regra #2:** `creator` tem 1 Veo incluso por ciclo; além disso, Veo é permitido mas debitado pelo `creditValueUsd` recalculado. Contador Redis `veo:{tenantId}:{cycleId}`. **Regra #3:** o `creditValueUsd` do débito de Veo = **menor lote pago ativo** do tenant (`paidCreditValuesFor`) → conservador → margem garantida. **Regra #1:** Veo NUNCA debita de saldo promo/free; se o saldo pago for insuficiente, bloqueia. Cap rígido opcional via `MEDIA_FORGE_VEO_HARD_CAP`.

### Step 1: Test que falha

```ts
// tests/unit/billing/veo-cap.test.ts
import { describe, it, expect } from 'vitest';
import { effectiveVeoCreditValue, veoAllowance } from '../../../src/billing/veo-cap.js';

describe('veo-cap', () => {
  it('creditValueUsd conservador = menor lote pago ativo', () => {
    expect(effectiveVeoCreditValue([0.0024, 0.00196, 0.005])).toBeCloseTo(0.00196);
  });
  it('sem lote pago → fallback 0.01 (valor-base do crédito)', () => {
    expect(effectiveVeoCreditValue([])).toBe(0.01);
  });

  it('dentro do incluso (count < included) → allowed, includedUse=true', () => {
    const r = veoAllowance({ tier: 'creator', usedThisCycle: 0, included: 1, hardCap: undefined });
    expect(r).toEqual({ allowed: true, includedUse: true });
  });
  it('além do incluso → allowed por débito recalculado, includedUse=false', () => {
    const r = veoAllowance({ tier: 'creator', usedThisCycle: 1, included: 1, hardCap: undefined });
    expect(r).toEqual({ allowed: true, includedUse: false });
  });
  it('hard cap atingido → bloqueado', () => {
    const r = veoAllowance({ tier: 'creator', usedThisCycle: 3, included: 1, hardCap: 3 });
    expect(r.allowed).toBe(false);
  });
  it('free → Veo sempre bloqueado (regra de ouro #1; reforço além do tier-gate F-C)', () => {
    expect(veoAllowance({ tier: 'free', usedThisCycle: 0, included: 0, hardCap: undefined }).allowed).toBe(false);
  });
});
```

### Step 2: Rodar — falha

Run: `cd media-forge && pnpm vitest run tests/unit/billing/veo-cap.test.ts` → FAIL

### Step 3: Implementar (lógica pura; o contador Redis é injetado no caller)

```ts
// src/billing/veo-cap.ts
import type { Tier } from '../http/auth.js';

export const DEFAULT_CREDIT_VALUE_USD = 0.01;

/** Regra de ouro #3: usa o MENOR creditValueUsd entre os lotes pagos ativos
 *  (mais conservador → débito de Veo maior → margem garantida). Sem lote → base. */
export function effectiveVeoCreditValue(paidLotValuesUsd: readonly number[]): number {
  if (paidLotValuesUsd.length === 0) return DEFAULT_CREDIT_VALUE_USD;
  return Math.min(...paidLotValuesUsd);
}

export interface VeoAllowanceArgs {
  tier: Tier; usedThisCycle: number; included: number; hardCap: number | undefined;
}
export interface VeoAllowance { allowed: boolean; includedUse: boolean; }

/** Regras #1/#2: free nunca; creator usa incluso até `included`, depois débito
 *  recalculado até hardCap (se definido). */
export function veoAllowance(a: VeoAllowanceArgs): VeoAllowance {
  if (a.tier === 'free') return { allowed: false, includedUse: false };
  if (a.hardCap !== undefined && a.usedThisCycle >= a.hardCap) return { allowed: false, includedUse: false };
  if (a.usedThisCycle < a.included) return { allowed: true, includedUse: true };
  return { allowed: true, includedUse: false };
}
```

### Step 4: Integrar no submit de vídeo (Task 5 Step 3)

- [ ] Antes de reservar um Veo: ler `usedThisCycle` do Redis (`veo:{tenantId}:{cycleId}`), `paidCreditValuesFor(tenantId)` do `payments-store`, computar `veoAllowance(...)` e `effectiveVeoCreditValue(...)`. Se `!allowed` → retornar erro estruturado (`{ isError:true, note:'veo cap reached / paid balance required' }`) sem reservar. Se `allowed`, reservar com `creditValueUsd` recalculado e `INCR veo:{tenantId}:{cycleId}`. `cycleId` avança no webhook de pagamento confirmado da assinatura (Task 8/9).

### Step 5: Rodar + commit

Run: `cd media-forge && pnpm vitest run tests/unit/billing/veo-cap.test.ts` → PASS
```bash
set -euo pipefail
cd media-forge
git add src/billing/veo-cap.ts tests/unit/billing/veo-cap.test.ts
git commit -m "feat(billing): Veo cycle cap + conservative creditValueUsd recompute (golden rules #1/#2/#3)"
```

---

## Task 7: Webhook Asaas — assinatura recorrente + pack Pix → grant idempotente

**Files:** Create `src/billing/asaas-webhook.ts`, Modify `src/http/app.ts`, Test `tests/unit/billing/asaas-webhook.test.ts`

> NOTA: **CONFIRMAR VIA `asaas-mcp`/sandbox antes de codar os shapes exatos** (context7 não estava disponível nesta sessão): nomes de evento e campos. Conhecimento atual a validar: Asaas autentica o webhook por **token estático** comparado contra o header `asaas-access-token` (não HMAC). Eventos de pagamento: `PAYMENT_CONFIRMED` / `PAYMENT_RECEIVED`. Corpo: `{ event, payment: { id, value, billingType, subscription?, customer } }`. Idempotência por `payment.id`.

### Step 1: Test que falha

```ts
// tests/unit/billing/asaas-webhook.test.ts
import { describe, it, expect, vi } from 'vitest';
import { handleAsaasWebhook } from '../../../src/billing/asaas-webhook.js';

function deps() {
  return {
    store: {
      tenantForCustomer: vi.fn(async () => 't1'),
      recordPaymentOnce: vi.fn(async () => true),
      markGranted: vi.fn(async () => {}),
    },
    credit: { grant: vi.fn(async () => {}) },
    webhookToken: 'secret-token',
  };
}

const packEvent = {
  event: 'PAYMENT_CONFIRMED',
  payment: { id: 'pay_1', value: 19.9, billingType: 'PIX', customer: 'cus_1' },
};

describe('handleAsaasWebhook', () => {
  it('token inválido → 401, sem grant', async () => {
    const d = deps();
    const r = await handleAsaasWebhook({ token: 'wrong', body: packEvent }, d as never);
    expect(r.status).toBe(401);
    expect(d.credit.grant).not.toHaveBeenCalled();
  });

  it('pack confirmado → grant idempotente + markGranted', async () => {
    const d = deps();
    const r = await handleAsaasWebhook({ token: 'secret-token', body: packEvent }, d as never);
    expect(r.status).toBe(200);
    expect(d.credit.grant).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', amount: 1500, externalId: 'grant-asaas-pay_1' }));
    expect(d.store.markGranted).toHaveBeenCalled();
  });

  it('replay do mesmo payment.id → NÃO concede de novo', async () => {
    const d = deps();
    d.store.recordPaymentOnce = vi.fn(async () => false); // já visto
    const r = await handleAsaasWebhook({ token: 'secret-token', body: packEvent }, d as never);
    expect(r.status).toBe(200);
    expect(d.credit.grant).not.toHaveBeenCalled();
  });

  it('evento não-pagamento → 200 ignorado', async () => {
    const d = deps();
    const r = await handleAsaasWebhook({ token: 'secret-token', body: { event: 'PAYMENT_CREATED', payment: { id: 'x', value: 19.9, customer: 'c' } } }, d as never);
    expect(d.credit.grant).not.toHaveBeenCalled();
    expect(r.status).toBe(200);
  });
});
```

### Step 2: Rodar — falha → Step 3 Implementar

```ts
// src/billing/asaas-webhook.ts
// NOTA: Shapes a confirmar via asaas-mcp/sandbox. Asaas autentica por token estático
// no header asaas-access-token (NÃO HMAC). Idempotência por payment.id.
import { packForBrl } from './packs.js';
import type { PaymentsStore } from './payments-store.js';
import type { CreditClient } from './credit-client.js';

const GRANT_EVENTS = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED']);

export interface AsaasWebhookDeps {
  store: PaymentsStore;
  credit: CreditClient;
  webhookToken: string;
}
interface AsaasPayment { id: string; value: number; billingType?: string; subscription?: string; customer: string; }
interface AsaasEvent { event: string; payment: AsaasPayment; }

export async function handleAsaasWebhook(
  req: { token: string | undefined; body: unknown },
  deps: AsaasWebhookDeps,
): Promise<{ status: number; body: unknown }> {
  if (req.token !== deps.webhookToken) return { status: 401, body: { error: 'unauthorized' } };
  const ev = req.body as AsaasEvent;
  if (!ev?.event || !ev.payment?.id) return { status: 400, body: { error: 'bad_request' } };
  if (!GRANT_EVENTS.has(ev.event)) return { status: 200, body: { ignored: ev.event } };

  const tenantId = await deps.store.tenantForCustomer('asaas', ev.payment.customer);
  if (!tenantId) return { status: 202, body: { note: 'unmapped customer; reconcile later' } };

  const pack = packForBrl(ev.payment.value);
  if (!pack) return { status: 422, body: { error: 'unknown amount', value: ev.payment.value } };

  const kind = ev.payment.subscription ? 'subscription' : 'pack';
  const externalGrantId = `grant-asaas-${ev.payment.id}`;
  const fresh = await deps.store.recordPaymentOnce({
    paymentId: ev.payment.id, provider: 'asaas', tenantId, kind, brl: ev.payment.value,
    credits: pack.credits, creditValueUsd: pack.creditValueUsd, creditKind: 'paid', status: 'confirmed',
    externalGrantId, rawEvent: ev,
  });
  if (!fresh) return { status: 200, body: { replay: true } }; // idempotente

  await deps.credit.grant({ tenantId, amount: pack.credits, externalId: externalGrantId });
  await deps.store.markGranted('asaas', ev.payment.id);
  return { status: 200, body: { granted: pack.credits } };
}
```

- [ ] Em `src/http/app.ts`, rota `POST /webhooks/asaas`: lê o header `asaas-access-token`, parseia JSON, chama `handleAsaasWebhook`, retorna `r.status`/`r.body`. **Sem** o middleware de auth Bearer do `/mcp` (webhook tem auth própria por token).

### Step 4: Rodar + commit

Run: `cd media-forge && pnpm vitest run tests/unit/billing/asaas-webhook.test.ts` → PASS
```bash
set -euo pipefail
cd media-forge
git add src/billing/asaas-webhook.ts src/http/app.ts tests/unit/billing/asaas-webhook.test.ts
git commit -m "feat(billing): Asaas webhook (subscription + Pix pack) -> idempotent grant by payment.id"
```

---

## Task 8: Webhook Stripe — Checkout/subscription (intl) → grant idempotente

**Files:** Create `src/billing/stripe-webhook.ts`, Modify `src/http/app.ts`, Test `tests/unit/billing/stripe-webhook.test.ts`

> NOTA: **CONFIRMAR VIA `stripe-mcp`/sandbox**: o SDK oficial `stripe` expõe `stripe.webhooks.constructEvent(rawBody, sigHeader, secret)` que **lança** em assinatura inválida (verificação de autenticidade — substitui o token do Asaas). Eventos relevantes: `checkout.session.completed` (pack/assinatura via Checkout), `invoice.payment_succeeded` (renovação de assinatura → avança o ciclo), `customer.subscription.deleted` (cancelamento). Idempotência por `event.id`. **A rota precisa do raw body** (não o JSON parseado) — o Hono deve ler `c.req.arrayBuffer()`/`text()` ANTES de qualquer parse.

### Step 1: Test que falha (constructEvent injetado p/ não depender de cripto real)

```ts
// tests/unit/billing/stripe-webhook.test.ts
import { describe, it, expect, vi } from 'vitest';
import { handleStripeWebhook } from '../../../src/billing/stripe-webhook.js';

function deps(constructed: unknown, throws = false) {
  return {
    store: { tenantForCustomer: vi.fn(async () => 't1'), recordPaymentOnce: vi.fn(async () => true), markGranted: vi.fn(async () => {}), linkCustomer: vi.fn(async () => {}) },
    credit: { grant: vi.fn(async () => {}) },
    constructEvent: vi.fn(() => { if (throws) throw new Error('bad sig'); return constructed; }),
  };
}

const checkout = {
  id: 'evt_1', type: 'checkout.session.completed',
  data: { object: { id: 'cs_1', amount_total: 1990, currency: 'usd', customer: 'cus_1', metadata: { credits: '1500', creditValueUsd: '0.00239' } } },
};

describe('handleStripeWebhook', () => {
  it('assinatura inválida → 400, sem grant', async () => {
    const d = deps(checkout, true);
    const r = await handleStripeWebhook({ rawBody: '{}', signature: 'x' }, d as never);
    expect(r.status).toBe(400);
    expect(d.credit.grant).not.toHaveBeenCalled();
  });

  it('checkout completo → grant idempotente por event.id', async () => {
    const d = deps(checkout);
    const r = await handleStripeWebhook({ rawBody: '{}', signature: 'sig' }, d as never);
    expect(r.status).toBe(200);
    expect(d.credit.grant).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', amount: 1500, externalId: 'grant-stripe-evt_1' }));
  });

  it('replay do mesmo event.id → não concede', async () => {
    const d = deps(checkout);
    d.store.recordPaymentOnce = vi.fn(async () => false);
    const r = await handleStripeWebhook({ rawBody: '{}', signature: 'sig' }, d as never);
    expect(d.credit.grant).not.toHaveBeenCalled();
    expect(r.status).toBe(200);
  });
});
```

### Step 2: Rodar — falha → Step 3 Implementar

```ts
// src/billing/stripe-webhook.ts
// NOTA: Shapes a confirmar via stripe-mcp/sandbox. constructEvent é injetado (tipo
// (rawBody,sig)=>Event) p/ testar sem cripto real; o caller liga em
// stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET).
// Idempotência por event.id. Créditos/creditValueUsd vêm do metadata do price
// (definido na criação do produto — gate do usuário).
import type { PaymentsStore } from './payments-store.js';
import type { CreditClient } from './credit-client.js';

const GRANT_TYPES = new Set(['checkout.session.completed', 'invoice.payment_succeeded']);

export interface StripeWebhookDeps {
  store: PaymentsStore;
  credit: CreditClient;
  constructEvent: (rawBody: string, signature: string) => { id: string; type: string; data: { object: Record<string, unknown> } };
}

export async function handleStripeWebhook(
  req: { rawBody: string; signature: string | undefined },
  deps: StripeWebhookDeps,
): Promise<{ status: number; body: unknown }> {
  let event;
  try {
    event = deps.constructEvent(req.rawBody, req.signature ?? '');
  } catch {
    return { status: 400, body: { error: 'invalid_signature' } };
  }
  if (!GRANT_TYPES.has(event.type)) return { status: 200, body: { ignored: event.type } };

  const obj = event.data.object as { customer?: string; metadata?: Record<string, string>; amount_total?: number };
  const customerId = obj.customer;
  if (!customerId) return { status: 202, body: { note: 'no customer on event' } };
  const tenantId = await deps.store.tenantForCustomer('stripe', customerId);
  if (!tenantId) return { status: 202, body: { note: 'unmapped customer; reconcile later' } };

  const credits = Number(obj.metadata?.credits);
  const creditValueUsd = Number(obj.metadata?.creditValueUsd);
  if (!Number.isFinite(credits) || credits <= 0 || !Number.isFinite(creditValueUsd)) {
    return { status: 422, body: { error: 'missing credits/creditValueUsd metadata' } };
  }

  const externalGrantId = `grant-stripe-${event.id}`;
  const kind = event.type === 'invoice.payment_succeeded' ? 'subscription' : 'pack';
  const fresh = await deps.store.recordPaymentOnce({
    paymentId: event.id, provider: 'stripe', tenantId, kind, brl: null,
    credits, creditValueUsd, creditKind: 'paid', status: 'confirmed', externalGrantId, rawEvent: event,
  });
  if (!fresh) return { status: 200, body: { replay: true } };

  await deps.credit.grant({ tenantId, amount: credits, externalId: externalGrantId });
  await deps.store.markGranted('stripe', event.id);
  return { status: 200, body: { granted: credits } };
}
```

- [ ] Em `src/http/app.ts`, rota `POST /webhooks/stripe`: lê **raw body** (`await c.req.text()`), header `stripe-signature`, constrói `constructEvent` ligando o SDK `stripe` real, chama `handleStripeWebhook`. Sem auth Bearer do `/mcp`.

### Step 4: Rodar + commit

Run: `cd media-forge && pnpm vitest run tests/unit/billing/stripe-webhook.test.ts` → PASS
```bash
set -euo pipefail
cd media-forge
git add src/billing/stripe-webhook.ts src/http/app.ts tests/unit/billing/stripe-webhook.test.ts
git commit -m "feat(billing): Stripe webhook (checkout/invoice) -> idempotent grant by event.id"
```

---

## Task 9: Reconciliação de pagamentos pendentes (F1 de pagamento)

**Files:** Create `src/billing/reconcile.ts`, Test `tests/integration/billing/reconcile.int.test.ts`

> Distinto do sweep de RESERVA do credit-core (F-D). Aqui: pagamentos marcados `confirmed` mas que falharam no `grant` (ex.: credit-core fora do ar quando o webhook chegou) ou customers não-mapeados. Cron interno periódico: para cada `pendingGrants()`, tenta `grant` de novo (idempotente por `external_grant_id`) e `markGranted`. Idempotente: rodar 2× não duplica.

### Step 1: Implementar

```ts
// src/billing/reconcile.ts
import type { PaymentsStore } from './payments-store.js';
import type { CreditClient } from './credit-client.js';

/** Re-tenta grants de pagamentos confirmados-mas-não-concedidos. Idempotente
 *  (external_grant_id já usado → credit-core faz ON CONFLICT DO NOTHING). */
export async function reconcilePendingGrants(deps: { store: PaymentsStore; credit: CreditClient }): Promise<{ reconciled: string[] }> {
  const pending = await deps.store.pendingGrants();
  const reconciled: string[] = [];
  for (const p of pending) {
    await deps.credit.grant({ tenantId: p.tenantId, amount: p.credits, externalId: p.externalGrantId });
    await deps.store.markGranted(p.provider, p.paymentId);
    reconciled.push(p.paymentId);
  }
  return { reconciled };
}

/** Loop de cron interno (chamado pelo entrypoint HTTP; intervalo via env). */
export function startReconcileLoop(deps: { store: PaymentsStore; credit: CreditClient }, intervalMs = 300_000): () => void {
  const t = setInterval(() => { void reconcilePendingGrants(deps).catch(() => {}); }, intervalMs);
  return () => clearInterval(t);
}
```

### Step 2: Teste de integração

```ts
// tests/integration/billing/reconcile.int.test.ts (gated por DATABASE_URL)
// Inserir um payment status='confirmed' (não granted), credit.grant espião.
// reconcilePendingGrants → grant chamado 1×, status vira 'granted'.
// Rodar 2× → grant NÃO é chamado na 2ª (pendingGrants vazio). Seguir padrão Task 4.
```
> Esqueleto sinalizado — implementar com o mesmo harness do payments-store.int (embedded-postgres) + `credit.grant` espião.

### Step 3: Rodar + commit

Run: `cd media-forge && pnpm vitest run tests/integration/billing/reconcile.int.test.ts` → PASS (ou skip sem DB)
```bash
set -euo pipefail
cd media-forge
git add src/billing/reconcile.ts tests/integration/billing/reconcile.int.test.ts
git commit -m "feat(billing): pending-payment reconciliation sweep (F1) + cron loop"
```

---

## Task 10: Ligar webhooks + reconcile loop no entrypoint HTTP

**Files:** Modify `src/http/server.ts` (ou onde `startHttpServer` monta o app), Test manual

### Step 1: Construir as deps de billing no boot

- [ ] No `startHttpServer`, construir (quando as envs de billing existirem): `Pool` (`DATABASE_URL`), `PaymentsStore`, `CreditClient` (`CREDIT_API_URL`/`CREDIT_API_KEY`), `Stripe` (`STRIPE_SECRET_KEY`), e passar ao `buildHttpApp` para as rotas de webhook. Iniciar `startReconcileLoop`. Se as envs faltarem, logar `billing disabled` e seguir (self-host).

### Step 2: Smoke local (manual, com mocks — sem credenciais reais)

```bash
set -euo pipefail
cd media-forge
pnpm build
# Sobe com billing OFF (sem envs) → webhooks retornam 503/desabilitado, /mcp e /health intactos
MEDIA_FORGE_API_KEYS=key-aaa MEDIA_FORGE_HTTP_PORT=8787 node dist/http/server.js &
sleep 1
curl -s localhost:8787/health            # → {"ok":true}
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:8787/webhooks/asaas   # → 401 (sem token) ou 503 (billing off)
kill %1
```

### Step 3: Commit

```bash
set -euo pipefail
cd media-forge
git add src/http/server.ts
git commit -m "feat(billing): mount Asaas/Stripe webhooks + reconcile loop in HTTP entrypoint (billing optional)"
```

---

## Task 11: Smoke end-to-end em sandbox (GATE DO USUÁRIO — credenciais reais)

> **Bloqueado pelos pré-requisitos.** Não roda em CI; é o teste de aceitação manual após o usuário fornecer chaves sandbox + criar produtos. Documentar o roteiro; não automatizar com segredos.

### Step 1: Roteiro de aceitação (manual)

- [ ] **Compra de pack (Asaas sandbox):** gerar cobrança Pix R$19,90 no sandbox → pagar (sandbox) → webhook `PAYMENT_CONFIRMED` chega → `GET credit-core/balance/:tenantId` mostra +1.500 cr. Reenviar o mesmo webhook → saldo NÃO muda (idempotência).
- [ ] **Assinatura (Asaas):** confirmar R$37,90 → +2.500 cr + ciclo de Veo resetado.
- [ ] **Geração de imagem:** chamar `media_generate_image` autenticado → saldo cai pelo débito real (reserve→capture observável no ledger do credit-core).
- [ ] **Saldo insuficiente:** tenant com saldo < estimativa → geração retorna erro (402 do `/reserve`); saldo intacto.
- [ ] **Veo cap:** 1º Veo do ciclo usa o incluso; 2º debita pelo `creditValueUsd` recalculado; free → bloqueado.
- [ ] **Stripe (intl):** Checkout test-mode → `checkout.session.completed` → grant idempotente por `event.id`.
- [ ] **Reconciliação:** derrubar credit-core, enviar webhook (fica `confirmed` sem grant), subir credit-core → `reconcilePendingGrants` concede no próximo ciclo.

### Step 2: Validação final F-E

Run: `cd media-forge && pnpm typecheck && pnpm lint && pnpm test`
Expected: tudo verde (unit de billing + integração via embedded-postgres; smoke é manual à parte).

```bash
set -euo pipefail
cd media-forge
git add -A
git commit -m "docs(billing): F-E end-to-end sandbox acceptance runbook" --allow-empty
```

**NÃO empurrar tag, NÃO fazer deploy, NÃO commitar segredos.** O smoke sandbox é gate manual do controlador após as credenciais.

---

## Self-Review

**Spec coverage:** F-E cobre §4.1 (débito path-priced via `priceCredits` nas gerações — Task 5), §4.2 (reserve→capture→release: Task 2 + Task 5), §4.3 (números travados R$37,90 + 3 packs: Task 3), §4.4 (3 regras de ouro: #1 Veo nunca de promo/free + #2 cap por ciclo + #3 recálculo conservador pelo `creditValueUsd` — Task 6 + Task 3 margin gate), §4.6 (rails Asaas + Stripe: Tasks 7/8), §4.7 (F1 reconciliação de pagamento: Task 9; F2 idempotência por external_id: determinístico em `debit.ts` Task 2 + por `payment_id`/`event.id` nos webhooks Tasks 4/7/8). Gating `free=só imagem` é F-C (não refeito — anotado).

**Placeholder scan:** Código completo e válido em Tasks 1-4, 6, 7, 8, 9 (client, debit, packs, store, veo-cap, ambos webhooks, reconcile). Esqueletos **explicitamente sinalizados** (não ocultos): Task 5 Step 5 (debit-wiring test — instrução de montar `buildServer` com mocks, padrão do http-mcp.test do F-A), Task 9 Step 2 (reconcile int test — padrão do payments-store.int). Task 5 Steps 2-4 são edições cirúrgicas em `handlers.ts` descritas com o helper `withImageDebit` completo + pontos exatos de inserção. Nenhum TBD silencioso.

**Type consistency:** `CreditClient` (Task 1) consumido por `debit.ts` (2), webhooks (7/8), reconcile (9). `Pack`/`creditValueUsd` (Task 3) flui pra `payments-store` (4) → `veo-cap` (6) → débito (5). `PaymentsStore` assinatura consistente entre Tasks 4/7/8/9. `external_id` determinístico (`res-/cap-/rel-{jobId}`, `grant-{provider}-{paymentId/eventId}`) é a espinha de idempotência ponta-a-ponta. `Tier` reusado do F-C (`auth.js`).

**Known execution-time / riscos abertos:**
1. **context7 indisponível nesta sessão** → shapes de Asaas/Stripe foram escritos do conhecimento estável e marcados `NOTA: CONFIRMAR VIA asaas-mcp/stripe-mcp sandbox` (Tasks 7/8). O executor DEVE validar nomes de evento/campos no sandbox antes de fechar essas tasks. `constructEvent` é injetado nos testes → a lógica de grant é testável sem cripto real.
2. **Contrato anti-double-settle cross-serviço:** o sweep do credit-core (F-D) usa `external_id = sweep-cap-{suffix}`, divergente do `cap-{jobId}` de F-E → risco de capture dobrado. Resolução exigida antes do go-live: unificar o esquema OU credit-core rejeitar settle de reserva já settled. Marcado na tabela de decisões e em Task 2.
3. **`creditValueUsd` não vive no credit-core** (só créditos) → F-E o deriva de `payments.credit_value_usd` (menor lote pago ativo, conservador). Ratificação do usuário pendente (tabela de decisões).
4. **Harness embedded-postgres** pode não existir ainda no media-forge → Task 4 instrui criá-lo espelhando o do credit-core F-D se ausente.
5. **Veo `cycleId`** avança no webhook de assinatura confirmada; definir a fonte do `cycleId` (ex.: `YYYY-MM` do `granted_at` da última assinatura) ao integrar Task 6 Step 4.
