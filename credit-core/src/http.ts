// credit-core/src/http.ts
import { Hono } from 'hono';
import { z } from 'zod';
import { CreditService } from './service.js';
import { InsufficientBalanceError } from './store.js';

const grantSchema = z.object({ tenantId: z.string(), amount: z.number().int().positive(), externalId: z.string() });
const reserveSchema = z.object({ tenantId: z.string(), amount: z.number().int().positive(), reservationId: z.string(), ttlAt: z.string(), externalId: z.string() });
const captureSchema = z.object({ tenantId: z.string(), reservationId: z.string(), amount: z.number().int().positive(), externalId: z.string() });
const releaseSchema = captureSchema;

export function buildCreditApp(svc: CreditService, opts: { apiKeys: string[] }) {
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

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const apiKeys = (process.env.CREDIT_API_KEYS ?? '').split(',').map((k) => k.trim()).filter(Boolean);
  if (apiKeys.length === 0) throw new Error('CREDIT_API_KEYS is required (comma-separated)');

  const pool = new Pool({ connectionString });
  const svc = new CreditService(new Store(pool));
  const app = buildCreditApp(svc, { apiKeys });
  const port = Number(process.env.PORT ?? 8080);
  serve({ fetch: app.fetch, port });
  // eslint-disable-next-line no-console
  console.log(`credit-core listening on :${port}`);
}

// import.meta.url === entrypoint → executar main (Node ESM idiom)
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('http.js')) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
