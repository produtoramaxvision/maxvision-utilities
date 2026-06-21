// tests/integration/billing/tier-binding.int.test.ts
// F-pivot: subscription → tenants.tier binding, audit trail, and reconcile.
// Mirrors the schema-isolation pattern of reconcile.int.test.ts: a per-file
// schema bound at the connection level (options: -c search_path) so the store
// runs on the same search_path. Boots on the embedded-postgres instance from
// tests/global-setup.ts (DATABASE_URL); skips when no DB is available.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { PaymentsStore } from '../../../src/billing/payments-store.js';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;
const SCHEMA = 'tier_binding_it';

d('tier binding + audit + reconcile', () => {
  let pool: Pool;
  let store: PaymentsStore;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: url });
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`);
    await admin.end();
    pool = new Pool({ connectionString: url, options: `-c search_path=${SCHEMA}` });
    // tenants (001) + tier_changes audit (004) + subscriptions source-of-truth (005)
    for (const m of ['001_tenants_keys.sql', '004_tier_changes.sql', '005_subscriptions.sql']) {
      await pool.query(readFileSync(`migrations/${m}`, 'utf8'));
    }
    store = new PaymentsStore(pool);
  });
  afterAll(async () => { await pool.end(); });

  beforeEach(async () => {
    await pool.query(`DELETE FROM tier_changes WHERE tenant_id='t-1'`);
    await pool.query(`DELETE FROM subscriptions WHERE tenant_id='t-1'`);
    await pool.query(`INSERT INTO tenants (id, tier) VALUES ('t-1','free')
                      ON CONFLICT (id) DO UPDATE SET tier='free'`);
  });

  it('setTenantTier updates tier and writes exactly one audit row', async () => {
    await store.setTenantTier('t-1', 'creator', 'stripe:invoice.payment_succeeded');
    const t = await pool.query(`SELECT tier FROM tenants WHERE id='t-1'`);
    expect(t.rows[0].tier).toBe('creator');
    const a = await pool.query(
      `SELECT from_tier, to_tier, reason FROM tier_changes WHERE tenant_id='t-1'`,
    );
    expect(a.rows).toEqual([
      { from_tier: 'free', to_tier: 'creator', reason: 'stripe:invoice.payment_succeeded' },
    ]);
  });

  it('setTenantTier is a no-op when already at target (no audit row)', async () => {
    await store.setTenantTier('t-1', 'free', 'noop');
    const a = await pool.query(`SELECT count(*)::int n FROM tier_changes WHERE tenant_id='t-1'`);
    expect(a.rows[0].n).toBe(0);
  });

  it('rejects an invalid tier', async () => {
    await expect(store.setTenantTier('t-1', 'enterprise' as never, 'x')).rejects.toThrow();
    const t = await pool.query(`SELECT tier FROM tenants WHERE id='t-1'`);
    expect(t.rows[0].tier).toBe('free'); // unchanged
  });

  it('throws on unknown tenant (no tenant row touched)', async () => {
    await expect(store.setTenantTier('t-nope', 'creator', 'x')).rejects.toThrow();
  });

  // eng E5 — atomicity: a failure between the tenants UPDATE and the audit INSERT
  // must roll the whole tx back. Poison the audit INSERT with a temporary CHECK so
  // the UPDATE lands first, then the INSERT violates and the tx aborts.
  it('rolls back the tenants UPDATE when the audit INSERT fails (atomic tx)', async () => {
    await pool.query(`ALTER TABLE tier_changes ADD CONSTRAINT tmp_poison CHECK (reason <> 'POISON')`);
    try {
      await expect(store.setTenantTier('t-1', 'creator', 'POISON')).rejects.toThrow();
      const t = await pool.query(`SELECT tier FROM tenants WHERE id='t-1'`);
      expect(t.rows[0].tier).toBe('free'); // rolled back, NOT 'creator'
      const a = await pool.query(`SELECT count(*)::int n FROM tier_changes WHERE tenant_id='t-1'`);
      expect(a.rows[0].n).toBe(0);
    } finally {
      await pool.query(`ALTER TABLE tier_changes DROP CONSTRAINT tmp_poison`);
    }
  });

  it('reconcileTiers corrects drift from the subscription source of truth', async () => {
    await store.upsertSubscriptionTier('t-1', 'stripe', 'sub_1', 'active', 'creator');
    await pool.query(`UPDATE tenants SET tier='free' WHERE id='t-1'`); // simulate missed tenants write
    const fixed = await store.reconcileTiers();
    expect(fixed).toBeGreaterThanOrEqual(1);
    const t = await pool.query(`SELECT tier FROM tenants WHERE id='t-1'`);
    expect(t.rows[0].tier).toBe('creator');
    const a = await pool.query(
      `SELECT count(*)::int n FROM tier_changes WHERE tenant_id='t-1' AND reason='reconcile'`,
    );
    expect(a.rows[0].n).toBe(1);
  });

  // eng E5 — ordering: two active subs (creator + pro) → highest active tier wins.
  it('reconcileTiers picks the highest active tier (pro > creator)', async () => {
    await store.upsertSubscriptionTier('t-1', 'stripe', 'sub_creator', 'active', 'creator');
    await store.upsertSubscriptionTier('t-1', 'stripe', 'sub_pro', 'active', 'pro');
    await pool.query(`UPDATE tenants SET tier='free' WHERE id='t-1'`);
    await store.reconcileTiers();
    const t = await pool.query(`SELECT tier FROM tenants WHERE id='t-1'`);
    expect(t.rows[0].tier).toBe('pro');
  });

  // eng E5 — cancel-before-active: a tenant at creator whose only sub row is
  // 'canceled' must reconcile down to free (no active sub → derived free).
  it('reconcileTiers demotes to free when the only subscription is canceled', async () => {
    await store.upsertSubscriptionTier('t-1', 'stripe', 'sub_x', 'canceled', 'creator');
    await pool.query(`UPDATE tenants SET tier='creator' WHERE id='t-1'`);
    await store.reconcileTiers();
    const t = await pool.query(`SELECT tier FROM tenants WHERE id='t-1'`);
    expect(t.rows[0].tier).toBe('free');
  });
});
