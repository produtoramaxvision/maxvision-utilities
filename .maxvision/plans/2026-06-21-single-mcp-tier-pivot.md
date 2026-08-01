# Single Hosted MCP — Tier Pivot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use maxvision:subagent-driven-development (recommended) or maxvision:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pivot media-forge to a single private hosted multi-tenant MCP whose access is gated by subscription tier (free / creator / pro), removing the self-host distribution path entirely.

**Architecture (two phases):**
- **Phase 1 (this plan, ship-now):** revert the AGPL+EULA relicense back to MIT (repo going private), delete the dead self-host license layer, and wire the billing webhooks so a subscription sets `tenants.tier` and a cancellation drops it to `free` — with an audit log of every tier change and a reconcile pass that re-derives `tenants.tier` from the local subscription source of truth (heals partial-write drift).
- **Phase 2 (separate project, design first):** make media-forge an OAuth 2.1 Resource Server using the existing **Supabase** project as the Authorization Server (Supabase OAuth Server is GA-beta since Nov 2025: DCR + PKCE + JWKS + `/.well-known/oauth-authorization-server`). Plus self-serve signup + Stripe checkout on the site. Outlined here, NOT built here.

**Tech Stack:** Node 22 ESM, Hono, pg (Postgres), vitest + embedded-postgres, TypeScript strict.

**User decisions (2026-06-21):**
- Keep 3 tiers (free/creator/pro).
- Revert license to MIT (repo going private; self-host dropped).
- Tier-flip approach **B**: webhook→tier + reconcile + audit log.
- Auth model = **OAuth 2.1 via Supabase** (reuse existing Supabase Auth as the AS; no new vendor) — Phase 2.
- Sequencing = 2 phases (Phase 1 ships independently of Phase 2).

**Pre-state:** `origin/homolog=23cfc38`, `origin/main=be154a1`. The AGPL relicense (commit `49ebb10`) and webhook seam (`edfc246`) are already on both branches.

---

# PHASE 1 — Pivot mechanics (this plan)

## File Structure

**Workstream 1 — License revert (undo D2):**
- Modify: `media-forge/LICENSE` (AGPL-3.0 text → MIT text)
- Modify: `media-forge/package.json` (`"AGPL-3.0-or-later"` → `"MIT"`)
- Modify: `media-forge/.claude-plugin/plugin.json` + `media-forge/plugins/media-forge-hosted/.claude-plugin/plugin.json` (→ `"MIT"`)
- Modify: `media-forge/README.md` (badge → MIT; remove dual-license section)

**Workstream 2 — Self-host deprecation (delete dead code):**
- Delete: `media-forge/src/license/` (cache.ts, client.ts, middleware.ts, types.ts)
- Delete: `media-forge/LICENSE-COMMERCIAL/EULA.md` (+ dir)
- Delete: `license-worker/` (standalone package; NOT in pnpm-workspace)
- Modify: `media-forge/src/http/app.ts` (remove `LicenseState` import + `licenseState?` field + gate block)
- Modify: `media-forge/src/http/server.ts` (remove `LicenseCache` import + bootstrap + wiring + shutdown hook)
- Modify: `media-forge/src/core/config.ts` (remove 6 license fields + loaders)
- Modify: `.maxvision/deploy/media-forge-mcp.stack.yml` (remove the license C1 env block)

**Workstream 3 — Subscription → tier wiring + audit + reconcile (TDD, approach B):**
- Create: `media-forge/migrations/004_tier_changes.sql` (audit table) and `media-forge/migrations/005_subscriptions.sql` (source of truth). **`003_payments.sql` already exists — do NOT reuse 003.**
- Modify: `media-forge/src/billing/payments-store.ts` (`setTenantTier` writes tenants.tier + audit row in one tx; add `upsertSubscriptionTier` + `reconcileTiers`)

> **PROD MIGRATION GAP (reviewer finding — must handle):** media-forge has NO automatic pg migration runner. `src/core/db.ts` migrates only `migrations/sqlite/`; the pg schema (`001_tenants_keys.sql`) is applied solely by `scripts/create-key.mts`, and `002`/`003` were applied MANUALLY in prod (PENDING OPS3). So `004`/`005` will NOT exist in prod unless applied. Task 12b handles this. Without it, `setTenantTier` crashes on a missing table → webhook 5xx.
- Modify: `media-forge/src/billing/stripe-webhook.ts` (subscription grant → setTenantTier from metadata.tier; `customer.subscription.deleted` → free)
- Modify: `media-forge/src/billing/asaas-webhook.ts` (subscription grant → setTenantTier('creator'); cancellation → free)
- Test: `media-forge/tests/integration/billing/tier-binding.int.test.ts` (DB-backed — setTenantTier, audit row, reconcile)
- Test (extend): `media-forge/tests/unit/billing/stripe-webhook.test.ts`, `media-forge/tests/unit/billing/asaas-webhook.test.ts`

> **CORRECTED PATHS (audit finding):** billing tests live in `tests/unit/billing/` (stripe-webhook.test.ts, asaas-webhook.test.ts already exist) and `tests/integration/billing/` (payments-store.int.test.ts — DB-backed via embedded-postgres global-setup). The DB-backed `setTenantTier`/`reconcileTiers` test goes in `tests/integration/billing/`, NOT `tests/billing/` (which does not exist).

---

## Task 1: Revert LICENSE + manifests to MIT

**Files:** `media-forge/LICENSE`, `media-forge/package.json`, `media-forge/.claude-plugin/plugin.json`, `media-forge/plugins/media-forge-hosted/.claude-plugin/plugin.json`

- [ ] **Step 1: Restore the MIT LICENSE text** — overwrite `media-forge/LICENSE` with:

```
MIT License

Copyright (c) 2026 Produtora MaxVision

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Set `license` to `"MIT"` in all 3 manifests.**
- [ ] **Step 3: Verify JSON parses** — `cd media-forge && for f in package.json .claude-plugin/plugin.json plugins/media-forge-hosted/.claude-plugin/plugin.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "OK $f"; done`. Expected: 3x OK.
- [ ] **Step 4: Commit** — `git add` the 4 files; `git commit -m "revert(media-forge): AGPL-3.0 -> MIT (repo going private, self-host dropped)"`

## Task 2: Revert README license section + badge

**Files:** `media-forge/README.md`

- [ ] **Step 1:** badge → `![license](https://img.shields.io/badge/license-MIT-green)`.
- [ ] **Step 2:** delete the `---` + `## License` dual-license block appended in `49ebb10` (ends at the Legal Note paragraph).
- [ ] **Step 3:** verify — `cd media-forge && grep -ni "agpl\|dual-licens\|LICENSE-COMMERCIAL\|EULA" README.md || echo CLEAN`. Expected: CLEAN.
- [ ] **Step 4: Commit** — `git commit -m "revert(media-forge): drop dual-license/self-host narrative from README"`

## Task 3: Delete the self-host license layer

**Files:** delete `media-forge/src/license/`, `media-forge/LICENSE-COMMERCIAL/`, `license-worker/`

- [ ] **Step 1:** `git rm -r media-forge/src/license media-forge/LICENSE-COMMERCIAL license-worker` AND `git rm media-forge/tests/integration/license-gate.test.ts` (this test imports `../../src/license/types.js` + passes `licenseState` to `buildHttpApp` — it WILL break `pnpm test` if left).
- [ ] **Step 2:** confirm consumers across BOTH src AND tests — `cd media-forge && grep -rln "/license/\|licenseState\|LicenseCache\|licenseCheckEnabled" src tests --include=*.ts || echo NONE`. Expected: only `src/core/config.ts`, `src/http/app.ts`, `src/http/server.ts` (fixed in Tasks 4-6). Any OTHER file → stop, add to plan.
- [ ] **Step 3: Commit** — `git commit -m "refactor(media-forge): delete self-host license layer"` (will not typecheck until Tasks 4-6)

## Task 4: Unwire license gate from app.ts

**Files:** `media-forge/src/http/app.ts` (reviewer-confirmed anchors: import :17, option field :42-43, local binding :54, gate block :130-132)

- [ ] **Step 1:** delete `import type { LicenseState } from '../license/types.js';`
- [ ] **Step 2:** delete the `licenseState?: () => LicenseState;` option field + its JSDoc.
- [ ] **Step 3:** delete `const licenseState = opts.licenseState;`.
- [ ] **Step 4:** delete the license gate block (`// 2. Gate de licença...` + `if (licenseState) { ... 403 ... }`), so auth flows straight into rate-limit.
- [ ] **Step 5:** verify — `grep -ni license src/http/app.ts || echo CLEAN`. Expected CLEAN.
- [ ] **Step 6: Commit** — `git commit -m "refactor(media-forge): remove license gate from http app"`

## Task 5: Unwire LicenseCache from server.ts

**Files:** `media-forge/src/http/server.ts` (reviewer-confirmed anchors: import :20, bootstrap block :36-49, buildServer spread :139, ready-log field :191, shutdown stop :194)

- [ ] **Step 1:** delete `import { LicenseCache } from '../license/cache.js';`
- [ ] **Step 2:** delete the `let licenseCache...` declaration + the whole `if (config.licenseCheckEnabled) { ... }` bootstrap block.
- [ ] **Step 3:** delete the `...(licenseCache ? { licenseState: ... } : {})` spread in the `buildServer(...)` call.
- [ ] **Step 4:** drop `licenseGated: Boolean(licenseCache)` from the ready-log object; delete `licenseCache?.stop();` in shutdown.
- [ ] **Step 5:** verify — `grep -ni license src/http/server.ts || echo CLEAN`. Expected CLEAN.
- [ ] **Step 6: Commit** — `git commit -m "refactor(media-forge): remove LicenseCache bootstrap from server"`

## Task 6: Remove license config fields

**Files:** `media-forge/src/core/config.ts` (reviewer-confirmed anchors: interface fields :100-107, loaders :221-227)

- [ ] **Step 1:** delete the 6 `license*` interface fields + comment.
- [ ] **Step 2:** delete the 6 loader lines + comment.
- [ ] **Step 3:** typecheck the package — `cd media-forge && pnpm typecheck`. Expected exit 0 (self-host removal complete, no dangling refs).
- [ ] **Step 4: Commit** — `git commit -m "refactor(media-forge): drop license C1 config fields"`

## Task 7: Remove license envs from the deploy stack

**Files:** `.maxvision/deploy/media-forge-mcp.stack.yml` — **exists on `origin/homolog`** (edited this session, commit `8775418`); a reviewer reading `feat/n8n-mcp-alignment` won't see it. Execute Phase 1 from a homolog worktree where it exists; if `ls .maxvision/deploy/` is empty, you are on the wrong branch.

- [ ] **Step 1:** delete the `--- Licenca C1 self-host (F-F) ---` comment block + the 4 `LICENSE_CHECK_ENABLED`/`MAXVISION_LICENSE_SERVER_URL`/`MEDIA_FORGE_LICENSE_KEY`/`MEDIA_FORGE_LICENSE_INSTANCE_ID` env lines from `mcp-server`.
- [ ] **Step 2:** validate YAML — `python -c "import yaml; yaml.safe_load(open('.maxvision/deploy/media-forge-mcp.stack.yml',encoding='utf-8')); print('OK')"`. Expected OK.
- [ ] **Step 3: Commit** — `git commit -m "chore(deploy): drop self-host license envs from media-forge stack"`

## Task 8: Audit + subscriptions migrations

**Files:** `media-forge/migrations/004_tier_changes.sql`, `media-forge/migrations/005_subscriptions.sql` (003 is taken by `003_payments.sql`).

- [ ] **Step 1: Write `004_tier_changes.sql`** (mirror the existing `migrations/001_tenants_keys.sql` style):

```sql
-- 004_tier_changes.sql — audit trail for every tenant tier change (money/auth).
CREATE TABLE IF NOT EXISTS tier_changes (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  from_tier   TEXT NOT NULL,
  to_tier     TEXT NOT NULL CHECK (to_tier IN ('free','creator','pro')),
  reason      TEXT NOT NULL,            -- e.g. 'stripe:invoice.payment_succeeded', 'reconcile', 'stripe:subscription.deleted'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tier_changes_tenant ON tier_changes (tenant_id, created_at DESC);
```

- [ ] **Step 2: Write `005_subscriptions.sql`** (the reconcile source of truth — webhooks write it, reconcile reads it):

```sql
-- 005_subscriptions.sql — local subscription source of truth for tier reconcile.
CREATE TABLE IF NOT EXISTS subscriptions (
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  provider    TEXT NOT NULL,
  sub_id      TEXT NOT NULL,
  status      TEXT NOT NULL,            -- 'active' | 'canceled'
  tier        TEXT NOT NULL CHECK (tier IN ('creator','pro')),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, sub_id)
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON subscriptions (tenant_id, status);
```

- [ ] **Step 3:** these are NOT auto-applied (no pg runner — see PROD MIGRATION GAP). Task 12b applies them. Do not assume they exist at runtime without Task 12b.
- [ ] **Step 4: Commit** — `git add media-forge/migrations/004_tier_changes.sql media-forge/migrations/005_subscriptions.sql; git commit -m "feat(billing): tier_changes audit + subscriptions source-of-truth migrations"`

## Task 9: setTenantTier (audited) + reconcileTiers (TDD)

**Files:** `media-forge/src/billing/payments-store.ts`; Test: `media-forge/tests/integration/billing/tier-binding.int.test.ts`

- [ ] **Step 1: Write the failing DB-backed test** in `tests/integration/billing/tier-binding.int.test.ts`. **CRITICAL: mirror the schema-bootstrap pattern of `payments-store.int.test.ts` / `reconcile.int.test.ts`** — each int test does `CREATE SCHEMA <ns>` + `SET search_path` + `readFileSync` each needed migration (`001_tenants_keys.sql`, `004_tier_changes.sql`, `005_subscriptions.sql`) into that isolated schema. Do NOT assume the tables exist in the default schema (they don't — no auto-runner) and do NOT share a schema across parallel forks. `tenants` has columns `(id, tier, created_at, meta)` — **no `name` column**. Cover: (a) `setTenantTier` changes tier + inserts one `tier_changes` row; (b) no-op when unchanged (no audit row); (c) invalid tier rejected; (d) `reconcileTiers` re-derives from the active subscription and audits reason `'reconcile'`; **(e) eng E5 — atomicity: simulate a failure between the tenants UPDATE and the audit INSERT (e.g. stub the audit insert to throw) and assert `tenants.tier` is rolled back (unchanged), proving the tx is atomic; (f) eng E5 — ordering: seed TWO active subscriptions for one tenant (`creator` + `pro`), run `reconcileTiers`, assert the tenant lands on `pro` (highest active tier wins), proving the `CASE pro>creator` ordering, not just claiming it.**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { PaymentsStore } from '../../../src/billing/payments-store.js';

const url = process.env.DATABASE_URL ?? process.env.GALLERY_DATABASE_URL;
const d = url ? describe : describe.skip;

d('tier binding + audit + reconcile', () => {
  let pool: Pool; let store: PaymentsStore;
  const NS = 'tier_binding_test';
  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await pool.query(`DROP SCHEMA IF EXISTS ${NS} CASCADE; CREATE SCHEMA ${NS}; SET search_path TO ${NS}`);
    for (const m of ['001_tenants_keys.sql', '004_tier_changes.sql', '005_subscriptions.sql']) {
      await pool.query(`SET search_path TO ${NS}`);
      await pool.query(readFileSync(new URL(`../../../migrations/${m}`, import.meta.url), 'utf8'));
    }
    store = new PaymentsStore(pool); // NOTE: store must run on the same search_path (see reconcile.int.test.ts for the established pattern)
  });
  afterAll(async () => { await pool.query(`DROP SCHEMA IF EXISTS ${NS} CASCADE`); await pool.end(); });
  beforeEach(async () => {
    await pool.query(`SET search_path TO ${NS}`);
    await pool.query(`DELETE FROM tier_changes WHERE tenant_id='t-1'`);
    await pool.query(`DELETE FROM subscriptions WHERE tenant_id='t-1'`);
    await pool.query(`INSERT INTO tenants (id,tier) VALUES ('t-1','free')
                      ON CONFLICT (id) DO UPDATE SET tier='free'`);
  });

  it('setTenantTier updates tier and writes one audit row', async () => {
    await store.setTenantTier('t-1', 'creator', 'stripe:invoice.payment_succeeded');
    const t = await pool.query(`SELECT tier FROM tenants WHERE id='t-1'`);
    expect(t.rows[0].tier).toBe('creator');
    const a = await pool.query(`SELECT from_tier,to_tier,reason FROM tier_changes WHERE tenant_id='t-1'`);
    expect(a.rows).toEqual([{ from_tier: 'free', to_tier: 'creator', reason: 'stripe:invoice.payment_succeeded' }]);
  });

  it('setTenantTier is a no-op when already at target (no audit row)', async () => {
    await store.setTenantTier('t-1', 'free', 'noop');
    const a = await pool.query(`SELECT count(*)::int n FROM tier_changes WHERE tenant_id='t-1'`);
    expect(a.rows[0].n).toBe(0);
  });

  it('rejects invalid tier', async () => {
    await expect(store.setTenantTier('t-1', 'enterprise' as never, 'x')).rejects.toThrow();
  });

  it('reconcileTiers corrects drift from the subscription source of truth', async () => {
    // seed an active creator subscription but leave tenants.tier wrong (drift)
    await store.upsertSubscriptionTier('t-1', 'stripe', 'sub_1', 'active', 'creator');
    await pool.query(`UPDATE tenants SET tier='free' WHERE id='t-1'`); // simulate missed tenants write
    const fixed = await store.reconcileTiers();
    const t = await pool.query(`SELECT tier FROM tenants WHERE id='t-1'`);
    expect(t.rows[0].tier).toBe('creator');
    expect(fixed).toBeGreaterThanOrEqual(1);
    const a = await pool.query(`SELECT reason FROM tier_changes WHERE tenant_id='t-1' AND reason='reconcile'`);
    expect(a.rows.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd media-forge && pnpm exec vitest run tests/integration/billing/tier-binding.int.test.ts --config vitest.integration.config.ts`. Expected: FAIL (methods/table missing).

- [ ] **Step 3: Implement** in `payments-store.ts` (the `subscriptions` + `tier_changes` tables come from migrations 004/005, Task 8). Add the three methods:

```ts
import type { Tier } from '../http/auth.js';
const VALID: ReadonlySet<string> = new Set(['free','creator','pro']);

// in class PaymentsStore:
  /** Sets tier + writes an audit row, atomically. No-op (no audit) if unchanged. */
  async setTenantTier(tenantId: string, tier: Tier, reason: string): Promise<void> {
    if (!VALID.has(tier)) throw new Error(`invalid tier: ${tier}`);
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const cur = await c.query(`SELECT tier FROM tenants WHERE id=$1 FOR UPDATE`, [tenantId]);
      const from = cur.rows[0]?.tier as string | undefined;
      if (from === undefined) { await c.query('ROLLBACK'); throw new Error(`unknown tenant: ${tenantId}`); }
      if (from === tier) { await c.query('COMMIT'); return; } // no-op
      await c.query(`UPDATE tenants SET tier=$1 WHERE id=$2`, [tier, tenantId]);
      await c.query(`INSERT INTO tier_changes (tenant_id,from_tier,to_tier,reason) VALUES ($1,$2,$3,$4)`,
        [tenantId, from, tier, reason]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
    finally { c.release(); }
  }

  async upsertSubscriptionTier(tenantId: string, provider: string, subId: string, status: 'active'|'canceled', tier: 'creator'|'pro'): Promise<void> {
    await this.pool.query(
      `INSERT INTO subscriptions (tenant_id,provider,sub_id,status,tier) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (provider,sub_id) DO UPDATE SET status=EXCLUDED.status, tier=EXCLUDED.tier, updated_at=now()`,
      [tenantId, provider, subId, status, tier]);
  }

  /** Re-derive tenants.tier from the local subscription source of truth. Heals
   *  partial-write drift (a tenants update missed after a subscription write).
   *  Returns the number of tenants corrected. NOTE: this does NOT recover a fully
   *  missed webhook — that needs provider polling (Phase 2). */
  async reconcileTiers(): Promise<number> {
    const rows = (await this.pool.query(`
      SELECT t.id, t.tier AS current,
        COALESCE((SELECT s.tier FROM subscriptions s
                   WHERE s.tenant_id=t.id AND s.status='active'
                   ORDER BY CASE s.tier WHEN 'pro' THEN 2 ELSE 1 END DESC LIMIT 1), 'free') AS derived
      FROM tenants t`)).rows as Array<{ id: string; current: string; derived: string }>;
    let fixed = 0;
    for (const r of rows) {
      if (r.current !== r.derived) { await this.setTenantTier(r.id, r.derived as Tier, 'reconcile'); fixed++; }
    }
    return fixed;
  }
```

- [ ] **Step 4: Run to verify pass** — same command. Expected PASS.
- [ ] **Step 5: Commit** — `git add media-forge/src/billing/payments-store.ts media-forge/migrations/00*.sql media-forge/tests/integration/billing/tier-binding.int.test.ts; git commit -m "feat(billing): audited setTenantTier + reconcileTiers (subscription source of truth)"`

## Task 10: Stripe webhook drives tier (TDD)

**Files:** `media-forge/src/billing/stripe-webhook.ts`; Test: `media-forge/tests/unit/billing/stripe-webhook.test.ts`

- [ ] **Step 1: Write failing tests** (extend the existing unit test; reuse its fake `constructEvent`; fake store exposes `tenantForCustomer`, `recordPaymentOnce`→true, `markGranted`, `upsertSubscriptionTier`, `setTenantTier` spies):
  - `invoice.payment_succeeded` + `subscription_details.metadata.tier='creator'` → `upsertSubscriptionTier(tenant,'stripe',sub,'active','creator')` then `setTenantTier(tenant,'creator','stripe:invoice.payment_succeeded')`.
  - `invoice.payment_succeeded` + `subscription_details.metadata.tier='pro'` → tier resolves to `'pro'` (proves `pro` is reachable, not collapsed to the creator default).
  - `customer.subscription.deleted` → `upsertSubscriptionTier(...,'canceled',...)` + `setTenantTier(tenant,'free','stripe:customer.subscription.deleted')`, no `credit.grant`.
  - **eng E5 — cancel-before-active (DB-backed, add to `tests/integration/billing/tier-binding.int.test.ts`):** apply ONLY a `customer.subscription.deleted` (no prior `active` row) for a tenant currently at `creator`, then run `reconcileTiers`. Assert the tenant ends at `free` (the cancel path must `setTenantTier(...,'free')` directly AND `reconcileTiers` must derive `free` when no active sub exists — proving a stray cancel never leaves a paid tenant stuck).
- [ ] **Step 2: Run to verify failure** — `pnpm exec vitest run tests/unit/billing/stripe-webhook.test.ts`. Expected FAIL.
- [ ] **Step 3: Implement** — reviewer-driven corrections:
  - **Single sub-id resolver** shared by grant + cancel, so the `subscriptions` PK `(provider, sub_id)` matches across both (else cancel's `'canceled'` upsert misses the `'active'` row and reconcile never demotes): `function stripeSubId(obj): string | undefined { return obj.subscription ?? (obj.id?.startsWith('sub_') ? obj.id : undefined); }`. On the invoice (`invoice.payment_succeeded`) the subscription id is `obj.subscription`; on `customer.subscription.deleted` it is `obj.id`. **Never** fall back to `event.id` for the `subscriptions` row.
  - **Tier metadata location:** on `invoice.payment_succeeded` the subscription/price metadata is `obj.subscription_details?.metadata`, NOT top-level `obj.metadata` (which is invoice metadata). Read `const tier = sub_meta?.tier === 'pro' ? 'pro' : 'creator';` from `obj.subscription_details?.metadata`. `pro` is reachable ONLY if the pro price's metadata sets `tier:'pro'` (document this; it ties to the D3 provisioning that is currently blocked on the Stripe account).
  - **422-guard interaction:** the existing handler returns 422 when `credits`/`creditValueUsd` metadata is absent (`stripe-webhook.ts:38-39`). A subscription invoice carries credits too (the R$37.90 sub grants 2500 credits), so a real subscription event passes the guard and reaches the tier code. A tier-change-only event with no credits is (correctly) out of scope here.
  - After the existing subscription grant + `markGranted`: `if (kind === 'subscription') { const sid = stripeSubId(obj); if (sid) await deps.store.upsertSubscriptionTier(tenantId,'stripe',sid,'active',tier); await deps.store.setTenantTier(tenantId, tier, 'stripe:invoice.payment_succeeded'); }`.
  - Add a `customer.subscription.deleted` branch BEFORE `GRANT_TYPES`: resolve tenant from `obj.customer`, `const sid = stripeSubId(obj);` (here `obj.id`), `if (sid) await deps.store.upsertSubscriptionTier(tenantId,'stripe',sid,'canceled',<lastTier or 'creator'>)`, then `await deps.store.setTenantTier(tenantId,'free','stripe:customer.subscription.deleted')`. No `credit.grant`.
- [ ] **Step 4: Run to verify pass.** Expected PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(billing): Stripe subscription grants/cancels drive audited tenant tier"`

## Task 11: Asaas webhook drives tier (TDD)

**Files:** `media-forge/src/billing/asaas-webhook.ts`; Test: `media-forge/tests/unit/billing/asaas-webhook.test.ts`

> **Confirm Asaas event literals before hardcoding:** grants today are `GRANT_EVENTS = {PAYMENT_CONFIRMED, PAYMENT_RECEIVED}`. For cancellation use the real Asaas subscription/payment events — likely `SUBSCRIPTION_DELETED` (sub cancelled) and `PAYMENT_OVERDUE` (lapsed). Verify in the Asaas webhook docs / current `asaas-webhook.ts` constants before finalizing.

- [ ] **Step 1: Write failing tests:** confirmed subscription payment (R$37.90, `payment.subscription` set) → `upsertSubscriptionTier(...,'active','creator')` + `setTenantTier(tenant,'creator','asaas:<event>')`; cancellation event → `upsertSubscriptionTier(...,'canceled',...)` + `setTenantTier(tenant,'free','asaas:<event>')`.
- [ ] **Step 2: Run to verify failure.** Expected FAIL.
- [ ] **Step 3: Implement:** after the subscription grant set tier to `'creator'` (Asaas has no per-price tier metadata; the R$37.90 sub = creator). Add a `CANCEL_EVENTS` branch (confirmed literals) → `upsertSubscriptionTier('canceled')` + `setTenantTier('free')`.
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(billing): Asaas subscription grants/cancels drive audited tenant tier"`

## Task 12: Harden the reconcile loop + wire tier reconcile (eng E1+E2)

**Files:** `media-forge/src/billing/reconcile.ts` (loop exists — `startReconcileLoop`, wired at `src/http/server.ts:108`). Do NOT add a new `setInterval`.

> **Eng finding E1 (silent failure):** the loop currently does `void reconcilePendingGrants(deps).catch(() => {})` — swallows ALL errors. Hanging the money/auth tier reconcile on a black-hole catch hides failures. **E2 (overlap):** no anti-overlap guard; `reconcileTiers` is a full-table scan and can overrun the interval. Fix both, mirroring the credit-core sweep.

- [ ] **Step 1: Write a failing test** for the hardened loop in `tests/unit/billing/reconcile-loop.test.ts` (fake store/credit; fake timers via `vi.useFakeTimers()`): (a) a throwing tick is logged, not swallowed; (b) an overlapping tick (slow body) is skipped while the prior is still running.
- [ ] **Step 2:** harden `startReconcileLoop`: add a `running` guard + a `logger` dep; on error log structured context instead of `.catch(() => {})`:

```ts
export function startReconcileLoop(
  deps: { store: PaymentsStore; credit: CreditClient; logger: { warn: (m: string, x?: unknown) => void; error: (m: string, x?: unknown) => void } },
  intervalMs = 300_000,
): () => void {
  let running = false;
  const tick = async () => {
    if (running) { deps.logger.warn('reconcile tick skipped (previous still running)'); return; }
    running = true;
    try {
      await reconcilePendingGrants(deps);
      const fixed = await deps.store.reconcileTiers();
      if (fixed > 0) deps.logger.warn('tier reconcile corrected drift', { fixed }); // observability of the accepted missed-webhook gap
    } catch (err) {
      deps.logger.error('reconcile loop tick failed', { err: err instanceof Error ? err.message : String(err) });
    } finally { running = false; }
  };
  const t = setInterval(() => { void tick(); }, intervalMs);
  return () => clearInterval(t);
}
```

- [ ] **Step 3:** thread the `logger` from the caller at `src/http/server.ts:108` (the server already has a `logger`). Run the test — expected PASS.
- [ ] **Step 4:** typecheck — `pnpm typecheck`. Expected exit 0.
- [ ] **Step 5: Commit** — `git commit -m "feat(billing): harden reconcile loop (log + anti-overlap) + wire tier reconcile"`

## Task 12b: Apply the new pg migrations to prod (PROD MIGRATION GAP)

**Files:** deploy/runbook (no auto pg runner exists — see PROD MIGRATION GAP).

- [ ] **Step 1:** apply `004_tier_changes.sql` + `005_subscriptions.sql` to the prod `mcp-postgres` (manual, consistent with how `001`-`003` were applied per OPS3). Document the exact apply command in the release notes (e.g. `psql $DATABASE_URL -f migrations/004_tier_changes.sql` run against the Swarm pg service). Without this, `setTenantTier`/`upsertSubscriptionTier` throw on a missing table → webhook 5xx for every subscription event.
- [ ] **Step 2 (recommended, OPS3):** add a real ordered pg boot-migration runner (mirror credit-core's `scripts/migrate.mjs` + boot-migration) so future migrations apply automatically. If deferred, this stays a manual deploy step and a documented OPS3 follow-up. Flag explicitly in the release notes which path was taken.
- [ ] **Step 3:** verify post-apply — `psql $DATABASE_URL -c "\\d tier_changes" -c "\\d subscriptions"`. Expected: both tables present.

## Task 13: Full local validation + release

- [ ] **Step 1:** `cd media-forge && pnpm typecheck && pnpm lint && pnpm test && pnpm exec tsup`. Expected: typecheck/lint exit 0; tests pass (license tests gone with `src/license/` → suite count drops, NO FAILs); build success.
- [ ] **Step 2:** `cd credit-core && pnpm typecheck && pnpm test`. Expected exit 0 (untouched).
- [ ] **Step 3:** push the branch → homolog (linear FF from origin/homolog), in a clean worktree.
- [ ] **Step 4:** release homolog → main (`git merge --no-ff`, no force) from a worktree off origin/main.
- [ ] **Step 5:** update `.maxvision/PENDING.md`: D1 RESOLVED (self-host killed), D2 REVERSED (MIT, private), F-F section obsolete; tier-flip wired + audited + reconciled but inert until Phase 2 checkout. Commit + push to homolog.

---

# PHASE 2 — OAuth via Supabase (separate project — design first, NOT built here)

**Decision locked (2026-06-21):** auth = OAuth 2.1 with the **existing Supabase project as the Authorization Server**. No new vendor (Supabase OAuth Server is public-beta since Nov 2025: DCR + PKCE + JWKS + `/.well-known/oauth-authorization-server`, with a dedicated MCP-authentication docs page). media-forge becomes the OAuth 2.1 **Resource Server**.

**Scope outline (needs its own plan / office-hours before building):**
1. Enable Supabase OAuth Server + Dynamic Client Registration in the Supabase dashboard.
2. media-forge resource-server bits:
   - `/.well-known/oauth-protected-resource` (RFC 9728) pointing at the Supabase AS.
   - On unauthenticated MCP requests: `401` + `WWW-Authenticate` referencing the metadata.
   - Validate the incoming Supabase JWT against the Supabase JWKS endpoint (RS256/ES256); extract `user_id`.
   - Map `user_id` → tenant → tier. Either a Supabase **Custom Access Token Hook** injects the `tier` claim into the JWT (no DB lookup at validation), OR media-forge reads `tenants.tier` by user_id.
3. Keep the Bearer API-key `FlatKeyStore`/`KeyStore` path during migration (dual-auth) so existing keys keep working; cut over once OAuth is validated.
4. Self-serve signup + Stripe checkout on the site (the existing PENDING gate 3) — issues the Supabase identity + writes tier; Phase 1's webhook→tier wiring then keeps tier in sync.

**Phase 2 risks to resolve in its own design:** Supabase OAuth Server is BETA (validate in staging; CIMD support still pending per a Supabase GitHub discussion); resource-indicator (RFC 8707) token binding so a token for media-forge isn't replayable elsewhere; the dual-auth cutover window.

---

## NOT in scope (Phase 1)

- OAuth resource-server / Supabase AS wiring (Phase 2).
- Self-serve signup + Stripe checkout flow (Phase 2 / PENDING gate 3).
- Provider-polling reconcile (recovering a fully-missed webhook by querying Stripe/Asaas) — Phase 1 reconcile only heals local partial-write drift.
- `pro`-tier Asaas mapping (Asaas path maps subscription → creator; multi-tier Asaas needs per-plan amounts — defer).

## What already exists (reused, not rebuilt)

- `tenants.tier` (CHECK free/creator/pro) + `tier-gates.ts` (tier → tool set) + `key-store.ts` (KeyStore resolves key → tenant.tier). The whole gating mechanism — reused as-is.
- `stripe-webhook.ts` / `asaas-webhook.ts` already grant credits + distinguish `kind: subscription|pack`. Phase 1 adds the tier side-effect; does not rebuild the webhook.
- `payments-store.ts` `billing_customers`/`payments` + idempotency. `setTenantTier`/`reconcileTiers`/`subscriptions` extend it.
- Supabase Auth (the site's existing login) becomes the Phase 2 AS — no new identity system.

## Dream-state delta

12-month ideal: a stranger discovers media-forge, runs one `claude mcp add`, logs in via the browser (Supabase), lands on `free` with trial credits, hits a paywall on video, subscribes, and is instantly `creator` — all self-serve, audited, self-healing. Phase 1 lands the tier engine + audit + reconcile (the spine). Phase 2 lands the OAuth front door + self-serve signup/checkout (the limbs). After both: the ideal is reached.

## Failure Modes Registry (Phase 1)

```
 CODEPATH                          | FAILURE MODE                  | RESCUED? | TEST? | USER SEES        | LOGGED?
 ----------------------------------|-------------------------------|----------|-------|------------------|--------
 setTenantTier (tx)                | unknown tenant                | Y (throw)| Y     | webhook 5xx→retry| Y
 setTenantTier (tx)                | invalid tier value            | Y (throw)| Y     | webhook 5xx→retry| Y
 setTenantTier (tx)                | partial write (crash mid-tx)  | Y (tx rollback) | partial | none (atomic) | Y
 stripe-webhook subscription.tier  | metadata.tier missing/garbage | Y (default creator) | Y | nothing (safe default) | Y
 stripe-webhook subscription.del   | unmapped customer             | Y (202 note) | Y  | nothing          | Y
 reconcileTiers                    | a fully-missed webhook        | N (by design — Phase 2 polling) | N | wrong tier until next event | should-log gap
 asaas cancellation                | wrong event literal hardcoded | mitigated by Task 11 confirm step | Y | stale tier | Y
```

> The one accepted gap: `reconcileTiers` does NOT recover a fully-missed webhook (only local drift). This is the Phase 1/Phase 2 line — provider-polling reconcile is Phase 2. Log when reconcile finds drift so missed-webhook frequency is observable.

## Self-Review

- Spec coverage: license revert (T1-2), self-host delete (T3-7), audit table (T8), audited setTenantTier + reconcile (T9), Stripe tier (T10), Asaas tier (T11), reconcile wiring (T12), validate+release (T13). Phase 2 outlined. ✓
- Placeholder scan: two confirm-before-finalize spots, both correctness-driven (Asaas event literals T11; the subscription-id source on the Stripe invoice object T10) — flagged with verification steps, not lazy TODOs.
- Type consistency: `Tier` from `../http/auth.js`; `setTenantTier(tenantId, tier, reason)` signature identical across store + both webhooks + reconcile; `tier_changes.to_tier` + `subscriptions.tier` CHECK match `VALID`.
- Test paths corrected to `tests/unit/billing/` + `tests/integration/billing/` (audit finding).

### Reviewer fixes applied (adversarial spec review, 2026-06-21)

Round 1 score 4/10 → addressed: undeleted `license-gate.test.ts` (Task 3); migration number collision 003→004/005 (Task 8); no prod pg runner → Task 12b + PROD MIGRATION GAP note; `tenants.name` removed from test + schema-bootstrap added (Task 9); single shared `stripeSubId` resolver so reconcile can demote (Task 10); Stripe tier read from `subscription_details.metadata` + `pro` reachability + 422-guard interaction documented (Task 10); Task 12 points at the existing `reconcile.ts` loop instead of a dead "add setInterval" branch; line anchors added to Tasks 4-6; deploy-stack path clarified as homolog-only (reviewer was on `feat/n8n-mcp-alignment`).

### Eng review applied (2026-06-21)

- **E1 (silent failure) + E2 (no anti-overlap):** Task 12 rewritten to harden `startReconcileLoop` — replace `.catch(() => {})` with structured error logging + a `running` guard, plus a fake-timers test. Tier-correction failures are now visible; concurrent corrections prevented.
- **E5 (test gaps):** added 3 shadow-path tests — setTenantTier mid-tx rollback (atomicity), reconcile `pro>creator` ordering with two active subs, and cancel-before-active (a stray cancel never leaves a paid tenant stuck).
- **E3 (perf at scale — NOT fixed, flagged):** `reconcileTiers` full-table-scans all tenants every tick. Fine for the current base; at 10k+ tenants make it incremental (only tenants with a subscription event since last run). Deferred to TODOS / Phase 2 scale work.
- **E4 (DRY — minor):** the tier default (`creator`, `pro` only on explicit metadata) + `reason` strings will duplicate across stripe/asaas webhooks. Extract a small `resolveSubTier`/`reason` helper in `billing/` if it reads cleanly during implementation; not a blocker.

---

## MAXVISION ORCHESTRATION REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | issues_addressed | SELECTIVE EXPANSION; approach B; 2-phase rescope; OAuth-via-Supabase accepted to Phase 2 |
| Spec/Outside Voice | adversarial subagent | Independent challenge | 1 | issues_found→fixed | 4/10 round 1; 9 execution-blocking issues, all addressed in-plan |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_addressed | E1 silent-failure + E2 overlap (loop hardened); E5 +3 shadow tests; E3 perf flagged; E4 DRY noted |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | n/a | no UI scope (backend pivot) |
| DX Review | `/plan-devex-review` | Developer experience | 0 | — | not run |

- **OUTSIDE VOICE:** maxvision-plan-checker verified findings against the repo (not just the doc) — caught the no-prod-migration-runner gap, the 003 collision, the undeleted license test, and the false Stripe `metadata.tier` assumption. High-signal.
- **CROSS-MODEL:** n/a (single reviewer).
- **UNRESOLVED:** Phase 2 (OAuth via Supabase) needs its own design before build (Supabase OAuth Server is beta; CIMD pending; RFC 8707 token binding). D3 Stripe provisioning still blocked on the `acct_1SWXI9` connection — `pro`-tier metadata depends on it.
- **VERDICT:** CEO + ENG review COMPLETE. Plan rescoped to 2 phases, hardened against the adversarial pass (9 fixes) and the eng pass (loop hardening + 3 shadow tests). Phase 1 is execution-ready. Two execution-time gates remain non-negotiable before merge: Task 12b (apply migrations `004`/`005` to prod pg — no auto-runner) and `pro`-tier metadata depends on the still-blocked D3 Stripe account. Phase 2 (OAuth via Supabase) needs its own design.
