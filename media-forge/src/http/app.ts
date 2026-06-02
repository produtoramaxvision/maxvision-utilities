// media-forge/src/http/app.ts
// Hono app do transporte HTTP. F-C: resolveAuth async + rate-limit + store/limiter injetaveis.
// /webhooks/:provider/:jobId monta o webhook Hono sub-app quando o secret esta presente (F-B).
// F-I: galleryStore injetado para list_my_generations + /metrics margin gauges.
import { Hono } from 'hono';
import { resolveAuth } from './auth.js';
import { handleMcpRequest } from './app-internal.js';
import { buildWebhookApp } from './webhook-hono.js';
import type { IKeyStore } from './key-store.js';
import { FlatKeyStore } from './key-store.js';
import type { RateLimiter } from './rate-limiter.js';
import { NullRateLimiter } from './rate-limiter.js';
import type { GalleryStore } from '../gallery/gallery-store.js';
import { computeMargin } from '../gallery/margin.js';

export interface HttpAppOpts {
  env?: NodeJS.ProcessEnv;
  store?: IKeyStore;
  limiter?: RateLimiter;
  /** F-I: gallery store for list_my_generations + /metrics margin gauges. */
  galleryStore?: GalleryStore;
}

export function buildHttpApp(opts: HttpAppOpts = {}) {
  const env = opts.env ?? process.env;
  const store: IKeyStore =
    opts.store ?? new FlatKeyStore(env['MEDIA_FORGE_API_KEYS'] ?? '');
  const limiter: RateLimiter = opts.limiter ?? new NullRateLimiter();
  const galleryStore = opts.galleryStore;
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true }));

  // F-I: /metrics — Prometheus gauges including margin observability (24h window).
  app.get('/metrics', async (c) => {
    const lines: string[] = [
      '# HELP media_forge_up Server up',
      '# TYPE media_forge_up gauge',
      'media_forge_up 1',
    ];

    if (galleryStore) {
      try {
        const now = new Date();
        const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
        const rows = await galleryStore.generationsInPeriod({ since, until: now.toISOString() });
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

    // 3. Handle MCP (propaga ctx com tenantId+tier+scopes + galleryStore F-I)
    return handleMcpRequest(c.req.raw, auth.ctx, env, { galleryStore });
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
