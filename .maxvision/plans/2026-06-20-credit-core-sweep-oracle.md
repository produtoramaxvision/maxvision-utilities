# Credit-Core Sweep Caller + Cross-Service Job-Status Oracle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use maxvision:subagent-driven-development (recommended) or maxvision:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire credit-core's tested-but-uncalled `runSweep` into production as a multi-replica-safe periodic caller that settles expired reservations via a generic cross-service job-status oracle, and fix the cross-kind double-settle overdraft bug the sweep would otherwise trigger.

**Architecture:** credit-core (Hono+pg ledger) gains a foundational anti-overdraft DB guarantee (partial unique index → ≤1 settle per reservation), a generic HTTP status probe (each reservation carries a `status_url`), a multi-tenant sweep orchestrator, and a Redis-locked scheduler with graceful shutdown. media-forge exposes an internal `/job-status/:jobId` endpoint (sourced from the `video_jobs` SQLite table via `getJobRecord`) and registers each reservation's `status_url` pointing back at itself. Sweep maps completed→capture(real cost), failed/unknown/unreachable→release (safe fallback).

**Tech Stack:** TypeScript (Node 22, ESM), Hono, `@hono/node-server`, pg (Postgres), ioredis (Redis lock), zod, vitest + embedded-postgres. media-forge: better-sqlite3 (`video_jobs`), Hono internal app.

---

## Money-safety invariants (must hold after every task)

1. **At most one settle per reservation** (capture XOR release) — enforced at the DB level, not by app logic.
2. **No charge on uncertainty** — sweep captures ONLY on an authoritative `completed` from the oracle; every other path (failed, unknown, missing status_url, probe timeout/error/non-2xx) releases.
3. **Idempotent replay** — same settle replayed = no-op (existing `ON CONFLICT (kind, external_id)`); cross-kind second settle = no-op (new partial index, caught as 23505).
4. **Sweep failure never crashes the service** and never partially settles a tenant inconsistently (each reservation is its own append; aggregation is best-effort per-tenant).

---

## File Structure

**credit-core (`credit-core/`):**
- Create: `migrations/002_sweep_oracle.sql` — dedupe existing duplicate settles, partial unique index on settles, `status_url` column.
- Modify: `src/store.ts` — settle 23505 no-op handling in `append`; `persist status_url` on reserve; add `tenantsWithExpiredReservations`, `statusUrlFor`.
- Modify: `src/http.ts` — `/reserve` accepts optional `statusUrl`; wire scheduler + graceful shutdown + admin `POST /sweep`.
- Create: `src/probe.ts` — `httpStatusProbe` (generic HTTP oracle client with auth + timeout + safe fallback) and `buildReserveMeta`.
- Modify: `src/sweep.ts` — add `runSweepAllTenants`.
- Create: `src/scheduler.ts` — `startSweepScheduler` with Redis `SET NX EX` lock, anti-overlap, error isolation, `stop()`.
- Create: `src/redis-lock.ts` — `withRedisLock` helper.
- Test: `tests/store.int.test.ts` (extend), `tests/probe.test.ts`, `tests/scheduler.test.ts`, `tests/sweep.int.test.ts` (extend), `tests/http.test.ts` (extend).
- Modify: `package.json` (version 0.1.1→0.1.2), `CHANGELOG.md`.

**media-forge (`media-forge/`):**
- Create: `src/http/job-status.ts` — `buildJobStatusRoute(deps)` returning a Hono sub-app; maps `video_jobs.status`+`actual_usd`→`{status, actualCredits}`, shared-secret auth.
- Modify: `src/http/app-internal.ts` — mount `/job-status/:jobId`.
- Modify: `src/billing/debit.ts` — `reserveForJob` accepts + forwards `statusUrl`.
- Test: `tests/http/job-status.test.ts`, extend `tests/billing/debit.test.ts`.

---

## credit-core Tasks

### Task 1: Foundational — settle first-wins (anti-overdraft)

**Files:**
- Create: `credit-core/migrations/002_sweep_oracle.sql`
- Modify: `credit-core/src/store.ts` (`append`)
- Test: `credit-core/tests/store.int.test.ts`

- [ ] **Step 1: Write the failing cross-kind race test**

Append to `tests/store.int.test.ts` (inside the DATABASE_URL-gated describe; load both migrations in `beforeAll`):

```ts
it('cross-kind: release then late capture stays RELEASED (no overdraft)', async () => {
  await svc.grant({ tenantId: 'x1', amount: 100, externalId: 'g-x1' });
  await svc.reserve({ tenantId: 'x1', amount: 30, reservationId: 'K1', ttlAt: '2026-06-02T00:00:00Z', externalId: 'res-K1' });
  await svc.release({ tenantId: 'x1', reservationId: 'K1', amount: 30, externalId: 'rel-K1' });
  expect(await svc.balance('x1')).toBe(100);              // refunded
  await svc.capture({ tenantId: 'x1', reservationId: 'K1', amount: 30, externalId: 'cap-K1' }); // late live capture
  expect(await svc.balance('x1')).toBe(100);              // STILL refunded — capture was a no-op
});

it('cross-kind: capture then late release stays CAPTURED', async () => {
  await svc.grant({ tenantId: 'x2', amount: 100, externalId: 'g-x2' });
  await svc.reserve({ tenantId: 'x2', amount: 30, reservationId: 'K2', ttlAt: '2026-06-02T00:00:00Z', externalId: 'res-K2' });
  await svc.capture({ tenantId: 'x2', reservationId: 'K2', amount: 30, externalId: 'cap-K2' });
  expect(await svc.balance('x2')).toBe(70);
  await svc.release({ tenantId: 'x2', reservationId: 'K2', amount: 30, externalId: 'rel-K2' });
  expect(await svc.balance('x2')).toBe(70);               // STILL captured — release was a no-op
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd credit-core && pnpm test -- store.int`
Expected: FAIL — second test path drops balance to 70 then a `release` inserts; first test drops to 70 after late capture (overdraft path). (Exact failing assertion: `balance('x1')` returns 70, expected 100.)

- [ ] **Step 3: Write the migration**

Create `credit-core/migrations/002_sweep_oracle.sql`:

```sql
-- 002_sweep_oracle.sql — settle first-wins + status_url for the sweep oracle.

-- (a) DATA REPAIR: collapse any pre-existing duplicate settles (latent cross-kind
--     bug). Keep the EARLIEST settle (lowest id) per reservation; delete the rest.
--     Append-only invariant is intentionally broken here ONCE to repair bug rows.
DELETE FROM ledger_entries le
USING (
  SELECT id,
         row_number() OVER (PARTITION BY reservation_id ORDER BY id) AS rn
  FROM ledger_entries
  WHERE kind IN ('capture','release') AND reservation_id IS NOT NULL
) dup
WHERE le.id = dup.id AND dup.rn > 1;

-- (b) GUARANTEE: at most one settle (capture XOR release) per reservation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_settle_per_reservation
  ON ledger_entries (reservation_id)
  WHERE kind IN ('capture','release');

-- (c) Oracle: each reservation may carry the URL credit-core probes for job status.
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS status_url text;
```

- [ ] **Step 4: Make `append` treat a partial-index violation as a no-op**

In `credit-core/src/store.ts`, replace the body of `append` so settle inserts swallow SQLSTATE 23505 (unique_violation) from the partial index (the existing `ON CONFLICT (kind, external_id)` already covers same-settle replay; the partial index covers cross-kind):

```ts
async append(e: { tenantId: string; kind: LedgerEntry['kind']; amount: number; reservationId?: string | null; ttlAt?: string | null; statusUrl?: string | null; externalId: string }): Promise<void> {
  try {
    await this.pool.query(
      `INSERT INTO ledger_entries (tenant_id, kind, amount, reservation_id, ttl_at, status_url, external_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (kind, external_id) DO NOTHING`,
      [e.tenantId, e.kind, e.amount, e.reservationId ?? null, e.ttlAt ?? null, e.statusUrl ?? null, e.externalId],
    );
  } catch (err) {
    // Partial unique index uq_ledger_settle_per_reservation: a SECOND settle of a
    // different kind for an already-settled reservation. First-settle-wins → no-op.
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505') return;
    throw err;
  }
}
```

- [ ] **Step 5: Run to verify both tests pass**

Run: `cd credit-core && pnpm test -- store.int`
Expected: PASS (both cross-kind tests).

- [ ] **Step 6: Run the full suite (no regressions)**

Run: `cd credit-core && pnpm typecheck && pnpm test`
Expected: PASS — existing EXT1 same-kind idempotency test (`sweep.int`) still green.

- [ ] **Step 7: Commit**

```bash
set -euo pipefail
git add credit-core/migrations/002_sweep_oracle.sql credit-core/src/store.ts credit-core/tests/store.int.test.ts
git commit -m "fix(credit-core): settle first-wins via partial unique index (anti cross-kind overdraft)"
```

---

### Task 2: Persist `status_url` on reserve + accept it on `/reserve`

**Files:**
- Modify: `credit-core/src/store.ts` (`reserveAtomic`/`runReserveTxn`), `src/service.ts` (`reserve`), `src/http.ts` (reserveSchema)
- Test: `credit-core/tests/store.int.test.ts`, `tests/http.test.ts`

- [ ] **Step 1: Write the failing test (status_url persisted + retrievable)**

Append to `tests/store.int.test.ts`:

```ts
it('reserve persists status_url; statusUrlFor returns it', async () => {
  await svc.grant({ tenantId: 's1', amount: 100, externalId: 'g-s1' });
  await store.reserveAtomic({ tenantId: 's1', amount: 10, reservationId: 'U1', ttlAt: '2030-01-01T00:00:00Z', externalId: 'res-U1', statusUrl: 'http://media-forge:8081/job-status/U1' });
  expect(await store.statusUrlFor('s1', 'U1')).toBe('http://media-forge:8081/job-status/U1');
  expect(await store.statusUrlFor('s1', 'NOPE')).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd credit-core && pnpm test -- store.int`
Expected: FAIL — `reserveAtomic` has no `statusUrl` param; `statusUrlFor` undefined.

- [ ] **Step 3: Thread `statusUrl` through reserve + add `statusUrlFor`**

In `src/store.ts`, update both `reserveAtomic` and `runReserveTxn` signatures to accept `statusUrl?: string | null` and write it into the reserve INSERT (`status_url` column), then add:

```ts
async statusUrlFor(tenantId: string, reservationId: string): Promise<string | null> {
  const r = await this.pool.query(
    `SELECT status_url FROM ledger_entries WHERE tenant_id=$1 AND reservation_id=$2 AND kind='reserve' LIMIT 1`,
    [tenantId, reservationId],
  );
  return r.rows[0]?.status_url ?? null;
}
```

The reserve INSERT in `runReserveTxn` becomes:

```ts
await c.query(
  `INSERT INTO ledger_entries (tenant_id, kind, amount, reservation_id, ttl_at, status_url, external_id)
   VALUES ($1,'reserve',$2,$3,$4,$5,$6) ON CONFLICT (kind, external_id) DO NOTHING`,
  [args.tenantId, args.amount, args.reservationId, args.ttlAt, args.statusUrl ?? null, args.externalId],
);
```

In `src/service.ts`, `reserve` forwards `statusUrl`:

```ts
async reserve(a: { tenantId: string; amount: number; reservationId: string; ttlAt: string; externalId: string; statusUrl?: string | null }): Promise<void> {
  await this.store.reserveAtomic(a);
}
```

In `src/http.ts`, extend `reserveSchema`:

```ts
const reserveSchema = z.object({ tenantId: z.string(), amount: z.number().int().positive(), reservationId: z.string(), ttlAt: z.string(), externalId: z.string(), statusUrl: z.string().url().optional() });
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd credit-core && pnpm test -- store.int && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
set -euo pipefail
git add credit-core/src/store.ts credit-core/src/service.ts credit-core/src/http.ts credit-core/tests/store.int.test.ts
git commit -m "feat(credit-core): persist reservation status_url for the sweep oracle"
```

---

### Task 3: `store.tenantsWithExpiredReservations(nowIso)`

**Files:** Modify `credit-core/src/store.ts`; Test `tests/store.int.test.ts`

- [ ] **Step 1: Failing test**

```ts
it('tenantsWithExpiredReservations returns only tenants with an unsettled expired reserve', async () => {
  await svc.grant({ tenantId: 't-exp', amount: 100, externalId: 'g-te' });
  await svc.reserve({ tenantId: 't-exp', amount: 10, reservationId: 'E1', ttlAt: '2026-06-02T00:00:00Z', externalId: 'res-E1' });
  await svc.grant({ tenantId: 't-valid', amount: 100, externalId: 'g-tv' });
  await svc.reserve({ tenantId: 't-valid', amount: 10, reservationId: 'V1', ttlAt: '2030-01-01T00:00:00Z', externalId: 'res-V1' });
  await svc.grant({ tenantId: 't-settled', amount: 100, externalId: 'g-ts' });
  await svc.reserve({ tenantId: 't-settled', amount: 10, reservationId: 'S1', ttlAt: '2026-06-02T00:00:00Z', externalId: 'res-S1' });
  await svc.release({ tenantId: 't-settled', reservationId: 'S1', amount: 10, externalId: 'rel-S1' });
  const tenants = await store.tenantsWithExpiredReservations('2026-06-02T01:00:00Z');
  expect(tenants).toContain('t-exp');
  expect(tenants).not.toContain('t-valid');
  expect(tenants).not.toContain('t-settled');
});
```

- [ ] **Step 2: Run — Expected FAIL** (`tenantsWithExpiredReservations` undefined). `cd credit-core && pnpm test -- store.int`

- [ ] **Step 3: Implement**

```ts
async tenantsWithExpiredReservations(nowIso: string): Promise<string[]> {
  const r = await this.pool.query(
    `SELECT DISTINCT res.tenant_id
       FROM ledger_entries res
      WHERE res.kind='reserve' AND res.reservation_id IS NOT NULL
        AND res.ttl_at IS NOT NULL AND res.ttl_at < $1
        AND NOT EXISTS (
          SELECT 1 FROM ledger_entries s
           WHERE s.reservation_id = res.reservation_id
             AND s.kind IN ('capture','release'))`,
    [nowIso],
  );
  return r.rows.map((x) => x.tenant_id as string);
}
```

- [ ] **Step 4: Run — Expected PASS.** `cd credit-core && pnpm test -- store.int && pnpm typecheck`

- [ ] **Step 5: Commit**

```bash
set -euo pipefail
git add credit-core/src/store.ts credit-core/tests/store.int.test.ts
git commit -m "feat(credit-core): tenantsWithExpiredReservations query for multi-tenant sweep"
```

---

### Task 4: Generic HTTP status probe (`src/probe.ts`)

**Files:** Create `credit-core/src/probe.ts`; Test `credit-core/tests/probe.test.ts`

- [ ] **Step 1: Failing test (pure, fetch injected — no network)**

Create `tests/probe.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { httpStatusProbe } from '../src/probe.js';

const mkFetch = (status: number, body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('httpStatusProbe', () => {
  const base = { statusUrlFor: async () => 'http://mf/job-status/J', secret: 's', timeoutMs: 500 };

  it('completed → completed + actualCredits', async () => {
    const probe = httpStatusProbe({ ...base, fetchImpl: mkFetch(200, { status: 'completed', actualCredits: 12 }) });
    expect(await probe('t', 'J')).toEqual({ status: 'completed', actualCredits: 12 });
  });
  it('failed → failed', async () => {
    const probe = httpStatusProbe({ ...base, fetchImpl: mkFetch(200, { status: 'failed' }) });
    expect((await probe('t', 'J')).status).toBe('failed');
  });
  it('non-2xx → unknown (safe fallback → release)', async () => {
    const probe = httpStatusProbe({ ...base, fetchImpl: mkFetch(500, {}) });
    expect((await probe('t', 'J')).status).toBe('unknown');
  });
  it('no status_url → unknown', async () => {
    const probe = httpStatusProbe({ ...base, statusUrlFor: async () => null, fetchImpl: mkFetch(200, { status: 'completed' }) });
    expect((await probe('t', 'J')).status).toBe('unknown');
  });
  it('fetch throws → unknown', async () => {
    const probe = httpStatusProbe({ ...base, fetchImpl: (async () => { throw new Error('net'); }) as unknown as typeof fetch });
    expect((await probe('t', 'J')).status).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run — Expected FAIL** (`src/probe.ts` missing). `cd credit-core && pnpm test -- probe`

- [ ] **Step 3: Implement `src/probe.ts`**

```ts
// credit-core/src/probe.ts
import type { JobStatus } from './sweep.js';

export interface ProbeResult { status: JobStatus; actualCredits?: number }
export type TenantAwareProbe = (tenantId: string, reservationId: string) => Promise<ProbeResult>;

export interface HttpProbeOpts {
  statusUrlFor: (tenantId: string, reservationId: string) => Promise<string | null>;
  secret: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/** Generic oracle: GET {status_url} with shared-secret. ANY non-completed/failed
 *  outcome (missing url, timeout, network error, non-2xx, malformed body) →
 *  'unknown' so the sweep RELEASES (never charges on uncertainty). */
export function httpStatusProbe(opts: HttpProbeOpts): TenantAwareProbe {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return async (tenantId, reservationId) => {
    const url = await opts.statusUrlFor(tenantId, reservationId);
    if (!url) return { status: 'unknown' };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
    try {
      const res = await fetchImpl(url, { headers: { 'x-mf-status-secret': opts.secret }, signal: ctrl.signal });
      if (!res.ok) return { status: 'unknown' };
      const j = (await res.json()) as { status?: string; actualCredits?: number };
      if (j.status === 'completed') return { status: 'completed', actualCredits: j.actualCredits };
      if (j.status === 'failed') return { status: 'failed' };
      return { status: 'unknown' };
    } catch {
      return { status: 'unknown' };
    } finally {
      clearTimeout(timer);
    }
  };
}
```

- [ ] **Step 4: Run — Expected PASS.** `cd credit-core && pnpm test -- probe && pnpm typecheck`

- [ ] **Step 5: Commit**

```bash
set -euo pipefail
git add credit-core/src/probe.ts credit-core/tests/probe.test.ts
git commit -m "feat(credit-core): generic HTTP job-status probe with safe release fallback"
```

---

### Task 5: `runSweepAllTenants` (multi-tenant orchestrator)

**Files:** Modify `credit-core/src/sweep.ts`; Test `credit-core/tests/sweep.int.test.ts`

> `runSweep`'s `probe` is `(reservationId)=>Promise<JobStatus>` and `reserveMeta` is `(rid)=>{amount}`. `runSweepAllTenants` adapts the tenant-aware `TenantAwareProbe` and builds `reserveMeta` from the ledger rows, and uses the probe's `actualCredits` for the capture amount when present.

- [ ] **Step 1: Failing test**

```ts
import { runSweepAllTenants } from '../src/sweep.js';

it('runSweepAllTenants: completed→capture(actualCredits), failed→release, across tenants', async () => {
  await svc.grant({ tenantId: 'm1', amount: 100, externalId: 'g-m1' });
  await svc.reserve({ tenantId: 'm1', amount: 30, reservationId: 'A', ttlAt: PAST_TTL, externalId: 'res-A' });   // completed, real 25
  await svc.grant({ tenantId: 'm2', amount: 100, externalId: 'g-m2' });
  await svc.reserve({ tenantId: 'm2', amount: 40, reservationId: 'B', ttlAt: PAST_TTL, externalId: 'res-B' });   // failed
  const probe = async (_t: string, rid: string) => rid === 'A' ? { status: 'completed' as const, actualCredits: 25 } : { status: 'failed' as const };
  const out = await runSweepAllTenants({ store, service: svc, nowIso: NOW, probe });
  expect(out.captured).toContain('A');
  expect(out.released).toContain('B');
  expect(await svc.balance('m1')).toBe(75);   // 100 − 25 (real cost, not the 30 estimate)
  expect(await svc.balance('m2')).toBe(100);  // released
});
```

- [ ] **Step 2: Run — Expected FAIL** (`runSweepAllTenants` undefined). `cd credit-core && pnpm test -- sweep.int`

- [ ] **Step 3: Implement in `src/sweep.ts`**

```ts
import type { TenantAwareProbe } from './probe.js';

export async function runSweepAllTenants(opts: {
  store: Store; service: CreditService; nowIso: string; probe: TenantAwareProbe;
}): Promise<{ captured: string[]; released: string[] }> {
  const tenants = await opts.store.tenantsWithExpiredReservations(opts.nowIso);
  const captured: string[] = []; const released: string[] = [];
  for (const tenantId of tenants) {
    const rows = await opts.store.entriesForWithTtl(tenantId);
    const amountByRid = new Map<string, number>();
    for (const e of rows) if (e.kind === 'reserve' && e.reservationId) amountByRid.set(e.reservationId, e.amount);
    const r = await runSweep({
      store: opts.store, service: opts.service, tenantId, nowIso: opts.nowIso,
      probe: async (rid) => (await opts.probe(tenantId, rid)).status,
      reserveMeta: (rid) => ({ amount: amountByRid.get(rid) ?? 0 }),
      captureAmount: async (rid) => {
        const p = await opts.probe(tenantId, rid);
        return p.status === 'completed' && typeof p.actualCredits === 'number' ? p.actualCredits : (amountByRid.get(rid) ?? 0);
      },
    });
    captured.push(...r.captured); released.push(...r.released);
  }
  return { captured, released };
}
```

And extend `runSweep`'s opts with an optional `captureAmount?: (rid: string)=>Promise<number>`; in the `completed` branch use `const amount = opts.captureAmount ? await opts.captureAmount(rid) : opts.reserveMeta(rid).amount;` for the capture call (release still uses `reserveMeta`). This preserves the existing single-tenant test contract (no `captureAmount` → estimate).

> NOTE: calling `probe` twice per completed reservation (once for status, once for amount) is acceptable (probe is idempotent GET). If avoiding the double call, refactor `runSweep` to accept a single `(rid)=>Promise<{status,amount}>` — out of scope; keep the minimal extension.

- [ ] **Step 4: Run — Expected PASS** (new + existing single-tenant tests). `cd credit-core && pnpm test -- sweep.int && pnpm typecheck`

- [ ] **Step 5: Commit**

```bash
set -euo pipefail
git add credit-core/src/sweep.ts credit-core/tests/sweep.int.test.ts
git commit -m "feat(credit-core): runSweepAllTenants — multi-tenant oracle sweep with real-cost capture"
```

---

### Task 6: Redis lock + scheduler

**Files:** Create `credit-core/src/redis-lock.ts`, `src/scheduler.ts`; Test `tests/scheduler.test.ts`

- [ ] **Step 1: Failing test (fake timers + injected lock/runner)**

Create `tests/scheduler.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startSweepScheduler } from '../src/scheduler.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const okLock = async <T>(_k: string, _ttl: number, fn: () => Promise<T>) => fn();

it('runs on interval; anti-overlap skips while a run is in flight', async () => {
  let active = 0; let maxActive = 0; let runs = 0;
  const run = async () => { active++; maxActive = Math.max(maxActive, active); runs++; await new Promise((r) => setTimeout(r, 50)); active--; };
  const h = startSweepScheduler({ intervalMs: 10, run, withLock: okLock, logger: () => {} });
  await vi.advanceTimersByTimeAsync(35);   // 3 ticks fire but each run takes 50ms
  expect(maxActive).toBe(1);               // never overlaps
  h.stop();
});

it('a throwing run does not stop the scheduler', async () => {
  let runs = 0;
  const run = async () => { runs++; throw new Error('boom'); };
  const h = startSweepScheduler({ intervalMs: 10, run, withLock: okLock, logger: () => {} });
  await vi.advanceTimersByTimeAsync(35);
  expect(runs).toBeGreaterThanOrEqual(3);  // kept firing despite throws
  h.stop();
});

it('stop() halts further runs', async () => {
  let runs = 0;
  const h = startSweepScheduler({ intervalMs: 10, run: async () => { runs++; }, withLock: okLock, logger: () => {} });
  await vi.advanceTimersByTimeAsync(15);
  const after = runs; h.stop();
  await vi.advanceTimersByTimeAsync(50);
  expect(runs).toBe(after);
});

it('lock contention: withLock returning skip prevents the run', async () => {
  let runs = 0;
  const skipLock = async () => undefined; // simulates "lock held by another replica"
  const h = startSweepScheduler({ intervalMs: 10, run: async () => { runs++; }, withLock: skipLock as never, logger: () => {} });
  await vi.advanceTimersByTimeAsync(35);
  expect(runs).toBe(0);
  h.stop();
});
```

- [ ] **Step 2: Run — Expected FAIL** (`src/scheduler.ts` missing). `cd credit-core && pnpm test -- scheduler`

- [ ] **Step 3: Implement `src/redis-lock.ts`**

```ts
// credit-core/src/redis-lock.ts
import type Redis from 'ioredis';

/** SET NX EX mutual exclusion. Runs fn only if THIS instance acquired the lock;
 *  returns undefined (skipped) otherwise. Releases via a check-and-del Lua script
 *  so we never delete a lock a different replica acquired after our TTL expired. */
const RELEASE = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export function makeRedisLock(redis: Redis) {
  return async function withRedisLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | undefined> {
    const token = `${process.pid}-${process.hrtime.bigint()}`;
    const got = await redis.set(key, token, 'PX', ttlMs, 'NX');
    if (got !== 'OK') return undefined;
    try { return await fn(); }
    finally { await redis.eval(RELEASE, 1, key, token).catch(() => {}); }
  };
}
```

- [ ] **Step 4: Implement `src/scheduler.ts`**

```ts
// credit-core/src/scheduler.ts
export interface SchedulerOpts {
  intervalMs: number;
  run: () => Promise<void>;
  withLock: <T>(key: string, ttlMs: number, fn: () => Promise<T>) => Promise<T | undefined>;
  lockKey?: string;
  lockTtlMs?: number;
  logger?: (msg: string) => void;
}
export interface SchedulerHandle { stop: () => void }

/** Periodic caller. Anti-overlap (a tick is skipped while the previous run is in
 *  flight), error-isolated (a throwing run never stops the interval), and
 *  multi-replica-safe (run wrapped in a Redis lock so only one replica sweeps). */
export function startSweepScheduler(opts: SchedulerOpts): SchedulerHandle {
  const log = opts.logger ?? (() => {});
  const lockKey = opts.lockKey ?? 'credit-core:sweep:lock';
  const lockTtlMs = opts.lockTtlMs ?? Math.max(opts.intervalMs * 5, 30_000);
  let inFlight = false;
  const tick = async () => {
    if (inFlight) { log('sweep: previous run still in flight, skipping tick'); return; }
    inFlight = true;
    try {
      const r = await opts.withLock(lockKey, lockTtlMs, opts.run);
      if (r === undefined) log('sweep: lock held by another replica, skipped');
    } catch (err) {
      log(`sweep: run failed (isolated): ${(err as Error).message}`);
    } finally {
      inFlight = false;
    }
  };
  const handle = setInterval(() => { void tick(); }, opts.intervalMs);
  return { stop: () => clearInterval(handle) };
}
```

- [ ] **Step 5: Run — Expected PASS.** `cd credit-core && pnpm test -- scheduler && pnpm typecheck`

- [ ] **Step 6: Commit**

```bash
set -euo pipefail
git add credit-core/src/redis-lock.ts credit-core/src/scheduler.ts credit-core/tests/scheduler.test.ts
git commit -m "feat(credit-core): Redis-locked anti-overlap sweep scheduler"
```

---

### Task 7: Wire scheduler + graceful shutdown + admin `POST /sweep` into `http.ts`

**Files:** Modify `credit-core/src/http.ts`; Test `tests/http.test.ts`

- [ ] **Step 1: Failing test — admin POST /sweep returns aggregate counts**

Add to `tests/http.test.ts` (the http app test builds `buildCreditApp` with a stub service; add a sweep route that takes an injected sweep runner):

```ts
it('POST /sweep (authed) returns {captured,released}', async () => {
  const app = buildCreditApp(stubSvc, { apiKeys: ['k'], runSweepNow: async () => ({ captured: ['A'], released: ['B'] }) });
  const res = await app.request('/sweep', { method: 'POST', headers: { Authorization: 'Bearer k' } });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ captured: ['A'], released: ['B'] });
});
it('POST /sweep without auth → 401', async () => {
  const app = buildCreditApp(stubSvc, { apiKeys: ['k'], runSweepNow: async () => ({ captured: [], released: [] }) });
  expect((await app.request('/sweep', { method: 'POST' })).status).toBe(401);
});
```

- [ ] **Step 2: Run — Expected FAIL** (`runSweepNow` opt + route missing). `cd credit-core && pnpm test -- http`

- [ ] **Step 3: Add the route to `buildCreditApp`**

Extend the opts type to `{ apiKeys: string[]; runSweepNow?: () => Promise<{ captured: string[]; released: string[] }> }` and register (after auth middleware):

```ts
app.post('/sweep', async (c) => {
  if (!opts.runSweepNow) return c.json({ error: 'sweep_disabled' }, 503);
  return c.json(await opts.runSweepNow());
});
```

- [ ] **Step 4: Wire the scheduler + shutdown in `main()`**

Replace `main()` in `src/http.ts` to build Redis, probe, scheduler, the `runSweepNow` closure, and register signal handlers (per context7 graceful-shutdown pattern). Full `main()`:

```ts
async function main(): Promise<void> {
  const { serve } = await import('@hono/node-server');
  const { Pool } = await import('pg');
  const { Store } = await import('./store.js');
  const { default: Redis } = await import('ioredis');
  const { makeRedisLock } = await import('./redis-lock.js');
  const { httpStatusProbe } = await import('./probe.js');
  const { startSweepScheduler } = await import('./scheduler.js');
  const { runSweepAllTenants } = await import('./sweep.js');

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const apiKeys = (process.env.CREDIT_API_KEYS ?? '').split(',').map((k) => k.trim()).filter(Boolean);
  if (apiKeys.length === 0) throw new Error('CREDIT_API_KEYS is required (comma-separated)');

  const pool = new Pool({ connectionString });
  const { runMigrations } = await import('./migrate.js');
  const applied = await runMigrations(pool);
  if (applied.length) console.log(`migrations applied: ${applied.join(', ')}`); // eslint-disable-line no-console
  const store = new Store(pool);
  const svc = new CreditService(store);

  const probe = httpStatusProbe({
    statusUrlFor: (t, r) => store.statusUrlFor(t, r),
    secret: process.env.MEDIA_FORGE_STATUS_SECRET ?? '',
    timeoutMs: Number(process.env.SWEEP_PROBE_TIMEOUT_MS ?? 4000),
  });
  const runSweepNow = () => runSweepAllTenants({ store, service: svc, nowIso: new Date().toISOString(), probe });

  const app = buildCreditApp(svc, { apiKeys, runSweepNow });
  const port = Number(process.env.PORT ?? 8080);
  const server = serve({ fetch: app.fetch, port });
  console.log(`credit-core listening on :${port}`); // eslint-disable-line no-console

  let scheduler: { stop: () => void } | undefined;
  let redis: InstanceType<typeof Redis> | undefined;
  if ((process.env.SWEEP_ENABLED ?? 'true') !== 'false') {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });
    const withLock = makeRedisLock(redis);
    scheduler = startSweepScheduler({
      intervalMs: Number(process.env.SWEEP_INTERVAL_MS ?? 60_000),
      lockTtlMs: Number(process.env.SWEEP_LOCK_TTL_MS ?? 300_000),
      run: async () => { const r = await runSweepNow(); if (r.captured.length || r.released.length) console.log(`sweep: captured=${r.captured.length} released=${r.released.length}`); }, // eslint-disable-line no-console
      withLock,
      logger: (m) => console.log(`[sweep] ${m}`), // eslint-disable-line no-console
    });
  }

  const shutdown = (sig: string) => {
    console.log(`${sig} received, shutting down`); // eslint-disable-line no-console
    scheduler?.stop();
    server.close(async () => { await redis?.quit().catch(() => {}); await pool.end().catch(() => {}); process.exit(0); });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
```

- [ ] **Step 5: Run — Expected PASS + full suite green.** `cd credit-core && pnpm test -- http && pnpm typecheck && pnpm test`

- [ ] **Step 6: Commit**

```bash
set -euo pipefail
git add credit-core/src/http.ts credit-core/tests/http.test.ts
git commit -m "feat(credit-core): wire scheduler, probe, graceful shutdown, admin POST /sweep"
```

---

### Task 8: Version bump + changelog

**Files:** Modify `credit-core/package.json`, `credit-core/CHANGELOG.md`

- [ ] **Step 1: Bump version 0.1.1 → 0.1.2 in `package.json`.**
- [ ] **Step 2: Add a `## [0.1.2]` CHANGELOG entry** summarizing: settle first-wins (anti-overdraft), generic status oracle probe, multi-tenant Redis-locked sweep scheduler, admin `/sweep`, graceful shutdown.
- [ ] **Step 3: Commit**

```bash
set -euo pipefail
git add credit-core/package.json credit-core/CHANGELOG.md
git commit -m "chore(credit-core): v0.1.2 — sweep caller + status oracle"
```

---

## media-forge Tasks (force-move tag v0.2.0 — no version bump per single-version policy)

### Task 8.5: Persist `actual_credits` in `video_jobs` (GAP-A / A3)

**Files:** Modify `media-forge/src/core/cost-tracker.ts` (`RecordActualInput`, `recordActualCost`, `JobRecord`, `getJobRecord`), the `video_jobs` migration (add column), and the live-capture call sites in `src/mcp/handlers.ts` that already compute `actualCredits`; Test `tests/core/cost-tracker.test.ts`.

> The credits are ALREADY computed at capture time (`handlers.ts:1692/1733` via `priceCredits`). This task persists that number so the oracle can return real cost without re-deriving `creditValueUsd`.

- [ ] **Step 1: Failing test** — `recordActualCost({..., actualCredits: 22})` then `getJobRecord` returns `actualCredits: 22`.

```ts
it('persists and returns actualCredits', () => {
  recordJob({ dbPath, jobId: 'JC', provider: 'kling', model: 'm', mode: 'std', paramsHash: 'h', estUsd: 0.3 });
  recordActualCost({ dbPath, jobId: 'JC', actualUsd: 0.22, actualCredits: 22 });
  expect(getJobRecord({ dbPath, jobId: 'JC' })?.actualCredits).toBe(22);
});
```

- [ ] **Step 2: Run — Expected FAIL** (`actualCredits` not on type/record). `cd media-forge && pnpm test -- cost-tracker`

- [ ] **Step 3: Add the column to the `video_jobs` migration** (the SQL that `runMigrations` in `core/db.ts` applies): `ALTER TABLE video_jobs ADD COLUMN actual_credits INTEGER;` (better-sqlite3: add via a new migration step or `ADD COLUMN IF NOT EXISTS` pattern used in `db.ts`). Confirm the migration mechanism in `core/db.ts` before editing.

- [ ] **Step 4: Thread `actualCredits` through** — add `readonly actualCredits?: number` to `RecordActualInput`; in `recordActualCost` set `actual_credits = ?`; add `actualCredits: number | null` to `JobRecord` and select `actual_credits` in `getJobRecord`. At the two `handlers.ts` live-capture sites, pass `actualCredits` (already in scope) into `recordActualCost`.

- [ ] **Step 5: Run — Expected PASS + suite.** `cd media-forge && pnpm test -- cost-tracker && pnpm typecheck`

- [ ] **Step 6: fallow + commit**

```bash
set -euo pipefail
cd media-forge && pnpm exec fallow audit --format json --quiet
cd .. && git add media-forge/src/core/cost-tracker.ts media-forge/src/core/db.ts media-forge/src/mcp/handlers.ts media-forge/tests/core/cost-tracker.test.ts
git commit -m "feat(media-forge): persist actual_credits in video_jobs for the job-status oracle"
```

---

### Task 9: Internal `/job-status/:jobId` endpoint

**Files:** Create `media-forge/src/http/job-status.ts`; Modify `src/http/app.ts` (mount — NOT app-internal.ts); Test `tests/http/job-status.test.ts`

> Source of truth: `getJobRecord({dbPath, jobId})` → `{ status, actualCredits, ... }` (Task 8.5 added `actualCredits`). Map: `status === 'completed'` → `{status:'completed', actualCredits}` (read the column directly, NO usd→credits conversion in the endpoint); `'failed'`/terminal-error → `failed`; pending/unknown/missing → `unknown`. Auth via `x-mf-status-secret` matching `MEDIA_FORGE_STATUS_SECRET`.

- [ ] **Step 1: Failing test**

Create `tests/http/job-status.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildJobStatusRoute } from '../../src/http/job-status.js';

const route = (rec: { status: string; actualUsd: number | null } | null) => buildJobStatusRoute({
  secret: 's',
  getJobRecord: () => (rec as never),
  usdToCredits: (usd) => Math.round(usd * 100),
});

describe('/job-status/:jobId', () => {
  it('completed → {status:completed, actualCredits}', async () => {
    const res = await route({ status: 'completed', actualUsd: 0.25 }).request('/J', { headers: { 'x-mf-status-secret': 's' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'completed', actualCredits: 25 });
  });
  it('failed → {status:failed}', async () => {
    const res = await route({ status: 'failed', actualUsd: null }).request('/J', { headers: { 'x-mf-status-secret': 's' } });
    expect(await res.json()).toEqual({ status: 'failed' });
  });
  it('pending → {status:unknown}', async () => {
    const res = await route({ status: 'pending', actualUsd: null }).request('/J', { headers: { 'x-mf-status-secret': 's' } });
    expect(await res.json()).toEqual({ status: 'unknown' });
  });
  it('missing record → {status:unknown}', async () => {
    const res = await route(null).request('/MISSING', { headers: { 'x-mf-status-secret': 's' } });
    expect(await res.json()).toEqual({ status: 'unknown' });
  });
  it('bad secret → 401', async () => {
    const res = await route({ status: 'completed', actualUsd: 0.25 }).request('/J', { headers: { 'x-mf-status-secret': 'wrong' } });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run — Expected FAIL** (`buildJobStatusRoute` missing). `cd media-forge && pnpm test -- job-status`

- [ ] **Step 3: Implement `src/http/job-status.ts`**

```ts
// src/http/job-status.ts
import { Hono } from 'hono';
import type { JobRecord } from '../core/cost-tracker.js';

export interface JobStatusDeps {
  secret: string;
  getJobRecord: (jobId: string) => JobRecord | null;
}

/** Internal oracle for credit-core's sweep. Maps the video_jobs record to a
 *  capture/release decision input. Conservative: only an explicit 'completed'
 *  becomes 'completed' (carrying the persisted actualCredits — Task 8.5);
 *  everything else is 'failed' (terminal) or 'unknown'. */
export function buildJobStatusRoute(deps: JobStatusDeps) {
  const app = new Hono();
  app.get('/:jobId', (c) => {
    if (c.req.header('x-mf-status-secret') !== deps.secret) return c.json({ error: 'unauthorized' }, 401);
    const rec = deps.getJobRecord(c.req.param('jobId'));
    if (!rec) return c.json({ status: 'unknown' });
    if (rec.status === 'completed') {
      return c.json(rec.actualCredits != null ? { status: 'completed', actualCredits: rec.actualCredits } : { status: 'completed' });
    }
    if (rec.status === 'failed') return c.json({ status: 'failed' });
    return c.json({ status: 'unknown' });
  });
  return app;
}
```

> Update the Task 9 Step 1 test factory to drop `usdToCredits` and pass a record with `actualCredits` directly: `route({ status: 'completed', actualCredits: 25 })` → expects `{ status: 'completed', actualCredits: 25 }`.

- [ ] **Step 4: Mount in `src/http/app.ts`** (the real Hono app served on :3000, NOT app-internal.ts)

Import `buildJobStatusRoute` + `getJobRecord` and mount on the app, secret-gated, outside the MCP/tenant auth: `app.route('/job-status', buildJobStatusRoute({ secret: process.env.MEDIA_FORGE_STATUS_SECRET ?? '', getJobRecord: (jobId) => getJobRecord({ dbPath, jobId }) }))`. Confirm the `dbPath` value used elsewhere in `app.ts`/`server.ts` and reuse it.

- [ ] **Step 5: Run — Expected PASS.** `cd media-forge && pnpm test -- job-status && pnpm typecheck`

- [ ] **Step 6: fallow gate + commit**

```bash
set -euo pipefail
cd media-forge && pnpm exec fallow audit --format json --quiet
cd .. && git add media-forge/src/http/job-status.ts media-forge/src/http/app-internal.ts media-forge/tests/http/job-status.test.ts
git commit -m "feat(media-forge): internal /job-status oracle endpoint for credit-core sweep"
```

---

### Task 10: `reserveForJob` registers `statusUrl`

**Files:** Modify `media-forge/src/billing/debit.ts` + its callers; Test `tests/billing/debit.test.ts`

- [ ] **Step 1: Failing test**

```ts
it('reserveForJob forwards statusUrl to the credit client', async () => {
  const calls: any[] = [];
  const client = { reserve: async (a: unknown) => { calls.push(a); } } as never;
  await reserveForJob({ client, tenantId: 't', jobId: 'J', estimateCredits: 10, ttlAt: '2030-01-01T00:00:00Z', statusUrl: 'http://mf:8081/job-status/J' });
  expect(calls[0].statusUrl).toBe('http://mf:8081/job-status/J');
  expect(calls[0].externalId).toBe('res-J');
});
```

- [ ] **Step 2: Run — Expected FAIL.** `cd media-forge && pnpm test -- debit`

- [ ] **Step 3: Add `statusUrl` to `ReserveForJobArgs` + forward it** (and update `CreditClient.reserve`/`ReserveArgs` in `credit-client.ts` to carry `statusUrl?: string`):

```ts
export interface ReserveForJobArgs {
  client: CreditClient; tenantId: string; jobId: string; estimateCredits: number; ttlAt: string; statusUrl?: string;
}
export async function reserveForJob(a: ReserveForJobArgs): Promise<void> {
  await a.client.reserve({
    tenantId: a.tenantId, amount: a.estimateCredits, reservationId: a.jobId,
    ttlAt: a.ttlAt, externalId: `res-${a.jobId}`, statusUrl: a.statusUrl,
  });
}
```

At the call sites (where `reserveForJob`/`runWithDebit` are invoked for async Kling jobs), pass `statusUrl: \`${process.env.MEDIA_FORGE_INTERNAL_URL}/job-status/${jobId}\`` when `MEDIA_FORGE_INTERNAL_URL` is set (omit otherwise → credit-core falls back to release).

- [ ] **Step 4: Run — Expected PASS + suite.** `cd media-forge && pnpm test -- debit && pnpm typecheck`

- [ ] **Step 5: fallow + commit**

```bash
set -euo pipefail
cd media-forge && pnpm exec fallow audit --format json --quiet
cd .. && git add media-forge/src/billing/debit.ts media-forge/src/billing/credit-client.ts media-forge/tests/billing/debit.test.ts
git commit -m "feat(media-forge): register reservation statusUrl pointing at /job-status oracle"
```

---

## Deploy + Validation Task

### Task 11: Ship credit-core 0.1.2 + media-forge (force-move) and validate on the VPS

> Portainer API: `https://portainer.meuagente.api.br`, header `X-API-Key: <token>`, Swarm endpoint id `1`, service `credit-core_credit-core`. Token MUST be rotated after (see S6). New envs to set in Portainer before/with the update: `MEDIA_FORGE_STATUS_SECRET` (shared secret, BOTH stacks — generate `openssl rand -hex 32`), `SWEEP_ENABLED=true`, `SWEEP_INTERVAL_MS=60000`. media-forge stack (`mcp-server` service): `MEDIA_FORGE_INTERNAL_URL=http://mcp-server:3000` + `MEDIA_FORGE_STATUS_SECRET`. credit-core gate is `pnpm typecheck && pnpm test` (no lint script). Reachability: both services share the external `net` overlay, so `mcp-server:3000` resolves from credit-core.

- [ ] **Step 1: Full green both services**

Run: `cd credit-core && pnpm typecheck && pnpm lint && pnpm test` then `cd ../media-forge && pnpm typecheck && pnpm lint && pnpm test && pnpm exec fallow audit --format json --quiet`
Expected: all PASS, fallow verdict `pass`.

- [ ] **Step 2: Push branch + let CI build/push images**

```bash
set -euo pipefail
git push origin homolog
```
Confirm the credit-core image CI run publishes `ghcr.io/produtoramaxvision/credit-core:0.1.2` (+ `:latest`) and the media-forge force-moved `:0.2.0`. (Inspect: `gh run list --branch homolog --limit 5`.)

- [ ] **Step 3: Set new env vars on both Swarm services (Portainer API)**

Update each service spec's `Env` with `MEDIA_FORGE_STATUS_SECRET`, `SWEEP_*` (credit-core) / `MEDIA_FORGE_INTERNAL_URL`+secret (media-forge) via `POST /api/endpoints/1/docker/services/{id}/update?version={Version}` carrying the full updated spec. (Read current spec first with `GET .../services/{id}`.)

- [ ] **Step 4: Force service update to pull new image**

Re-deploy `credit-core_credit-core` (and media-forge) by POSTing the service update with the new image tag/digest. Confirm `1/1` and tasks healthy.

- [ ] **Step 5: Validate `/health` + migrations applied**

```bash
# credit-core has no public Traefik route — exec inside the network via Portainer or VPS:
# verify /health from a sibling container, and confirm migration 002 ran in logs.
```
Expected: `/health` → `{ok:true}`; logs show `migrations applied: 002_sweep_oracle` (first boot only).

- [ ] **Step 6: Functional validation — capture-via-oracle path**

Seed a tenant via API: grant 100, reserve 30 with `reservationId=VALIDATE-CAP`, `ttlAt` in the past, `statusUrl` pointing at a media-forge job that is `completed` (actualUsd known). Trigger `POST /sweep` (authed). Expect response includes `VALIDATE-CAP` in `captured`; `GET /balance/<tenant>` reflects `100 − actualCredits`.

- [ ] **Step 7: Functional validation — release-fallback path**

Grant 100, reserve 20 with `reservationId=VALIDATE-REL`, past `ttlAt`, NO `statusUrl` (or a failed/unknown job). `POST /sweep`. Expect `VALIDATE-REL` in `released`; balance back to 100.

- [ ] **Step 8: Idempotency + cross-kind on prod**

Re-run `POST /sweep` → no balance change (idempotent). For the released reservation, POST a late `/capture` with `cap-VALIDATE-REL` → balance UNCHANGED (partial index blocks; no overdraft).

- [ ] **Step 9: Periodic + lock evidence**

Wait one `SWEEP_INTERVAL_MS`; confirm logs show a scheduled sweep tick. Confirm only one sweep executes per tick (single replica today; lock key present in Redis: `GET credit-core:sweep:lock` shows a held/expiring token during a run).

- [ ] **Step 10: Record results + update PENDING.md**

Mark the F1 gap RESOLVED in `.maxvision/PENDING.md` with the validation evidence (captured/released counts, idempotency proof). Add **S6: rotate the Portainer API token + admin password** (leaked in chat this session) to the security section. Commit:

```bash
set -euo pipefail
git add .maxvision/PENDING.md
git commit -m "docs(pending): F1 sweep RESOLVED — oracle sweep live + validated; add S6 portainer rotation"
git push origin homolog
```

---

## Self-Review

**Spec coverage:** (1) settle first-wins → Task 1. (2) generic probe + status_url → Tasks 2,4. (3) runSweepAllTenants + tenants query + scheduler + Redis lock + graceful shutdown + POST /sweep + envs → Tasks 3,5,6,7. (4) media-forge /job-status → Task 9. (5) reserveForJob statusUrl → Task 10. (6) deploy+validate → Task 11. All covered.

**Confirmations RESOLVED (2026-06-20):**
- ✅ credit-core `migrate.ts` runs all `migrations/*.sql` in lexical order, tracked in `schema_migrations`, exactly-once, each in its own txn. `002_sweep_oracle.sql` auto-applies. The migration must NOT use `CREATE INDEX CONCURRENTLY` (can't run in a txn) — the plan uses plain `CREATE UNIQUE INDEX` ✓.
- ✅ credit-core has NO `lint` script — gate = `pnpm typecheck && pnpm test` only. Drop `pnpm lint` from Tasks 7/11 for credit-core. media-forge gate = `pnpm exec fallow audit` (+ typecheck + test).

**Two GAPS — RESOLVED by eng-review (2026-06-20):**
- ✅ **GAP-A → A3 (real cost via persisted column).** `priceCredits({costUsd, markup, creditValueUsd})` is computed in `handlers.ts` at live capture; `creditValueUsd` is tenant-specific and NOT in `video_jobs`. Decision: media-forge persists the already-computed `actualCredits` into a NEW `video_jobs.actual_credits` column at `recordActualCost` time; `/job-status` returns `{status, actualCredits}` straight from that column. Sweep captures REAL cost. → NEW Task 8.5 (media-forge schema + recordActualCost wiring); Task 9 returns `actualCredits` from the column (no usd→credits conversion in the endpoint).
- ✅ **GAP-B → mount in `app.ts`, internal Swarm DNS.** media-forge HTTP is `src/http/server.ts` (Hono `serve()` on `MEDIA_FORGE_HTTP_PORT=3000`), main app `app.ts`. Mount `/job-status` in `app.ts` (NOT `app-internal.ts`, which is the MCP handler), secret-gated. Swarm service `mcp-server` attaches the external `net` network → credit-core (also on `net`) reaches it at `http://mcp-server:3000`. So `MEDIA_FORGE_INTERNAL_URL=http://mcp-server:3000`, no public exposure.

**Plan adjustments from eng-review:**
- credit-core gate = `pnpm typecheck && pnpm test` (NO `pnpm lint` — script absent). media-forge gate adds `pnpm exec fallow audit`.
- Task 9 `usdToCredits` dep REMOVED; `/job-status` reads `actual_credits` column. Task 5 `captureAmount` uses the probe's `actualCredits` (from the column) when `completed`, else estimate.
- NEW Task 8.5 (media-forge `video_jobs.actual_credits` column + `recordActualCost`/`RecordActualInput` gains `actualCredits`; the live capture call sites pass it).

**Money invariants re-checked:** capture fires only on authoritative `completed` and uses the REAL `actualCredits` persisted at live-capture time; all else releases; partial index + 23505-swallow guarantees ≤1 settle; replay idempotent. ✓

---

## Worktree parallelization strategy

Two lanes; one ordering constraint (the shared `CreditClient.ReserveArgs.statusUrl` type touched by credit-core Task 2 and media-forge Task 10).

| Lane | Tasks | Modules | Depends on |
|---|---|---|---|
| A (credit-core) | 1→2→3→4→5→6→7→8 | `credit-core/src`, `migrations` | — (sequential within; shared `store.ts`/`http.ts`) |
| B (media-forge) | 8.5→9→10 | `media-forge/src/core`, `src/http`, `src/billing` | Task 10 must match credit-core `/reserve` `statusUrl` field name (set in Task 2) |
| C (deploy) | 11 | both + Portainer | A + B complete |

Lanes A and B touch disjoint repos/dirs → parallelizable in separate worktrees. Sync point: the `statusUrl` field name on the reserve payload must match across `credit-core/src/http.ts` (Task 2) and `media-forge/src/billing/credit-client.ts` (Task 10) — both use literal `statusUrl`. Lane C is strictly last.

## NOT in scope (deferred, with rationale)

- **Veo/Higgsfield/Seedance sweep capture** — only Kling persists `actualCredits` cleanly; other providers' real-cost capture deferred (matches existing SE3/F-E seams). Their reservations still get the safe RELEASE fallback.
- **credit-core ledger backup (OPS2)** — separate ops task; the sweep doesn't change backup needs.
- **Removing the reserved-estimate path entirely** — kept as the fallback when the oracle is unreachable; not replaced.
- **media-forge version bump** — single-version policy: force-move v0.2.0 tag.

## What already exists (reused, not rebuilt)

- `runSweep` (tested) — reused as-is; `runSweepAllTenants` wraps it.
- `priceCredits` + `recordActualCost` — credits already computed at live capture; Task 8.5 only persists the existing number.
- `CreditClient`/`debit.ts` — extended (statusUrl), not replaced.
- `migrate.ts` runner + `schema_migrations` — reused for `002_*`.
- `getJobRecord`/`video_jobs` — the oracle's source of truth; +1 column.
- `ioredis` — already a dependency; reused for the lock.

## Critical failure modes (each has a test + handling)

| Failure | Covered by | Behavior |
|---|---|---|
| Cross-kind double-settle (rel→cap) | Task 1 tests + partial index | Second settle no-op; no overdraft |
| Oracle unreachable / timeout / 5xx | Task 4 probe tests | → `unknown` → RELEASE (no wrong charge) |
| Two replicas sweep simultaneously | Task 6 lock test | Redis `SET NX EX` → one replica only |
| Sweep run throws | Task 6 error-isolation test | Logged, interval continues, server stays up |
| Late live capture after sweep | Task 1 + EXT1 (existing) | first-settle-wins; idempotent |

## MAXVISION ORCHESTRATION REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 2 architecture gaps resolved (GAP-A→A3 real-cost column; GAP-B→app.ts internal DNS); 1 P0 money bug found pre-code (cross-kind overdraft) → Task 1 foundational fix; lint/migration/network confirmations resolved |

- **UNRESOLVED:** 0
- **Critical gaps (no test + no handling + silent):** 0 — every failure mode above has a test and explicit handling.
- **Key decisions locked:** settle first-wins via partial unique index (anti cross-kind overdraft); generic HTTP probe with RELEASE-on-any-uncertainty; real-cost capture via persisted `video_jobs.actual_credits` (A3); Redis `SET NX EX` lock for multi-replica; internal Swarm DNS `mcp-server:3000` (no public exposure); graceful shutdown per context7.
- **VERDICT:** ENG CLEARED — execution plan locked for subagent-driven implementation. Lane A (credit-core) and Lane B (media-forge) parallelizable; Lane C (deploy+validate) last. S6 (rotate Portainer token/password) flagged for post-deploy.

**Money invariants re-checked:** capture fires only on authoritative `completed`; all else releases; partial index + 23505-swallow guarantees ≤1 settle; replay idempotent. ✓
