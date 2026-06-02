// media-forge/src/http/app.ts
// Hono app do transporte HTTP. F-C: resolveAuth async + rate-limit + store/limiter injetaveis.
// /webhooks/:provider/:jobId monta o webhook Hono sub-app quando o secret esta presente (F-B).
import { Hono } from 'hono';
import { resolveAuth } from './auth.js';
import { handleMcpRequest } from './app-internal.js';
import { buildWebhookApp } from './webhook-hono.js';
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
    opts.store ?? new FlatKeyStore(env['MEDIA_FORGE_API_KEYS'] ?? '');
  const limiter: RateLimiter = opts.limiter ?? new NullRateLimiter();
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true }));
  app.get('/metrics', (c) =>
    c.text('# media-forge metrics\n', 200, { 'content-type': 'text/plain; version=0.0.4' }),
  );

  app.post('/mcp', async (c) => {
    // 1. Autenticacao
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

  // F-B: monta o webhook app quando o secret esta configurado. Sem secret = endpoint desabilitado.
  const secret = env['MEDIA_FORGE_WEBHOOK_SECRET'];
  if (secret && secret.length > 0) {
    const webhookApp = buildWebhookApp({ secret });
    // Guarda o sub-app no Hono app para injecao de handlers por startHttpServer / testes.
    (app as unknown as Record<string, unknown>).webhookApp = webhookApp;
    // Status com trailing slash: Hono mapeia o GET '/' do sub-app para '/webhooks'
    // (sem barra). Registramos '/webhooks/' explicitamente para que ambos os
    // formatos respondam 200 com a mesma lista de handlers (source: o proprio map).
    app.get('/webhooks/', (c) =>
      c.json({ status: 'ok', handlers: Array.from(webhookApp.webhookHandlers.keys()) }),
    );
    app.route('/webhooks', webhookApp as unknown as Hono);
  }

  return app;
}
