// credit-core/src/http.ts
import { Hono } from 'hono';
import { z } from 'zod';
import { CreditService } from './service.js';
import { InsufficientBalanceError } from './store.js';

const grantSchema = z.object({ tenantId: z.string(), amount: z.number().int().positive(), externalId: z.string() });
const reserveSchema = z.object({ tenantId: z.string(), amount: z.number().int().positive(), reservationId: z.string(), ttlAt: z.string(), externalId: z.string(), statusUrl: z.string().url().optional() });
const captureSchema = z.object({ tenantId: z.string(), reservationId: z.string(), amount: z.number().int().positive(), externalId: z.string() });
const releaseSchema = captureSchema;

export function buildCreditApp(svc: CreditService, opts: { apiKeys: string[]; runSweepNow?: () => Promise<{ captured: string[]; released: string[] }> }) {
  const app = new Hono();

  // Health check (sem auth — usado pelo HEALTHCHECK do Docker). Registrar ANTES do middleware.
  app.get('/health', (c) => c.json({ ok: true }));

  app.use('*', async (c, next) => {
    const key = (c.req.header('Authorization') ?? '').replace(/^Bearer\s+/, '');
    if (!opts.apiKeys.includes(key)) return c.json({ error: 'unauthorized' }, 401);
    await next();
  });

  app.get('/balance/:tenantId', async (c) => c.json({ balance: await svc.balance(c.req.param('tenantId')) }));

  app.post('/grant', async (c) => {
    const p = grantSchema.safeParse(await c.req.json());
    if (!p.success) return c.json({ error: 'bad_request', issues: p.error.issues }, 400);
    await svc.grant(p.data);
    return c.json({ ok: true });
  });

  app.post('/reserve', async (c) => {
    const p = reserveSchema.safeParse(await c.req.json());
    if (!p.success) return c.json({ error: 'bad_request', issues: p.error.issues }, 400);
    try { await svc.reserve(p.data); return c.json({ ok: true }); }
    catch (e) {
      if (e instanceof InsufficientBalanceError) return c.json({ error: 'insufficient_balance' }, 402);
      throw e;
    }
  });

  app.post('/capture', async (c) => {
    const p = captureSchema.safeParse(await c.req.json());
    if (!p.success) return c.json({ error: 'bad_request', issues: p.error.issues }, 400);
    await svc.capture(p.data);
    return c.json({ ok: true });
  });

  app.post('/release', async (c) => {
    const p = releaseSchema.safeParse(await c.req.json());
    if (!p.success) return c.json({ error: 'bad_request', issues: p.error.issues }, 400);
    await svc.release(p.data);
    return c.json({ ok: true });
  });

  app.post('/sweep', async (c) => {
    if (!opts.runSweepNow) return c.json({ error: 'sweep_disabled' }, 503);
    return c.json(await opts.runSweepNow());
  });

  return app;
}

/**
 * Bootstrap do servidor: lê DATABASE_URL + CREDIT_API_KEYS do ambiente e sobe o
 * @hono/node-server na PORT (default 8080). Só roda quando o módulo é o entrypoint
 * (node dist/http.js) — importar buildCreditApp em testes não dispara isto.
 */
async function main(): Promise<void> {
  const { serve } = await import('@hono/node-server');
  const { Pool } = await import('pg');
  const { Store } = await import('./store.js');
  const { Redis } = await import('ioredis');
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
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2 });
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

// import.meta.url === entrypoint → executar main (Node ESM idiom)
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('http.js')) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
