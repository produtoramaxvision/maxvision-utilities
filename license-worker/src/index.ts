// license-worker/src/index.ts
import { Hono } from 'hono';
import { KVStore, type LicenseRecord } from './store.js';

interface Env {
  LICENSES: KVNamespace;
  LICENSE_ADMIN_SECRET: string;
}

const app = new Hono<{ Bindings: Env }>();

function genKey(): string {
  // MFK- + 40 hex chars
  const a = crypto.randomUUID().replace(/-/g, '');
  const b = crypto.randomUUID().replace(/-/g, '');
  return `MFK-${(a + b).slice(0, 40)}`;
}

function isExpired(rec: LicenseRecord): boolean {
  return rec.expiresAt !== undefined && Date.parse(rec.expiresAt) < Date.now();
}

// ---- public ----
app.post('/validate', async (c) => {
  const { licenseKey, instanceId } = await c.req.json<{ licenseKey?: string; instanceId?: string }>();
  if (!licenseKey || !instanceId) {
    return c.json({ valid: false, revoked: false, reason: 'missing licenseKey/instanceId' }, 400);
  }
  const store = new KVStore(c.env.LICENSES);
  const rec = await store.get(licenseKey);
  if (!rec) return c.json({ valid: false, revoked: false, reason: 'unknown key' });
  if (rec.revoked) return c.json({ valid: false, revoked: true, tier: rec.tier });
  if (isExpired(rec)) return c.json({ valid: false, revoked: false, tier: rec.tier, expiresAt: rec.expiresAt });

  // bind anti-compartilhamento
  if (!rec.boundInstanceId) {
    rec.boundInstanceId = instanceId;
    await store.put(rec);
  } else if (rec.boundInstanceId !== instanceId) {
    return c.json({ valid: false, revoked: false, reason: 'bound to another instance' });
  }
  return c.json({ valid: true, revoked: false, tier: rec.tier, expiresAt: rec.expiresAt ?? null });
});

// ---- admin (Bearer LICENSE_ADMIN_SECRET) ----
app.use('/admin/*', async (c, next) => {
  const auth = c.req.header('Authorization');
  if (auth !== `Bearer ${c.env.LICENSE_ADMIN_SECRET}`) return c.json({ error: 'unauthorized' }, 401);
  await next();
});

app.post('/admin/issue', async (c) => {
  const { tier, expiresAt } = await c.req.json<{ tier?: LicenseRecord['tier']; expiresAt?: string }>();
  const rec: LicenseRecord = {
    licenseKey: genKey(),
    tier: tier ?? 'agency',
    revoked: false,
    issuedAt: new Date().toISOString(),
    ...(expiresAt ? { expiresAt } : {}),
  };
  await new KVStore(c.env.LICENSES).put(rec);
  return c.json({ licenseKey: rec.licenseKey, tier: rec.tier });
});

app.post('/admin/revoke', async (c) => {
  const { licenseKey } = await c.req.json<{ licenseKey?: string }>();
  if (!licenseKey) return c.json({ error: 'missing licenseKey' }, 400);
  const store = new KVStore(c.env.LICENSES);
  const rec = await store.get(licenseKey);
  if (!rec) return c.json({ error: 'unknown key' }, 404);
  rec.revoked = true;
  await store.put(rec);
  return c.json({ ok: true });
});

export default app;
