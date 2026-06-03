// media-forge/src/http/app.ts
// Hono app do transporte HTTP. F-C: resolveAuth async + rate-limit + store/limiter injetaveis.
// /webhooks/:provider/:jobId monta o webhook Hono sub-app quando o secret esta presente (F-B).
// F-I: galleryStore injetado para list_my_generations + /metrics margin gauges.
// F-F: licenseState injetado para gate de licença C1 self-host (403 quando revogada).
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
import type { LicenseState } from '../license/types.js';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { handleAsaasWebhook } from '../billing/asaas-webhook.js';
import { handleStripeWebhook } from '../billing/stripe-webhook.js';
import type { StripeWebhookDeps } from '../billing/stripe-webhook.js';
import type { PaymentsStore } from '../billing/payments-store.js';
import type { CreditClient } from '../billing/credit-client.js';

/** F-E: deps de billing pra rotas de webhook de pagamento. Cada rota é montada
 *  só quando sua config existe — um deploy pode usar só Asaas, só Stripe, ou ambos. */
export interface BillingWebhookDeps {
  store: PaymentsStore;
  credit: CreditClient;
  asaasWebhookToken?: string;
  stripeConstructEvent?: StripeWebhookDeps['constructEvent'];
}

export interface HttpAppOpts {
  env?: NodeJS.ProcessEnv;
  store?: IKeyStore;
  limiter?: RateLimiter;
  /** F-I: gallery store for list_my_generations + /metrics margin gauges. */
  galleryStore?: GalleryStore;
  /** F-F: presente só quando LICENSE_CHECK_ENABLED=true (self-host C1). No-op quando ausente. */
  licenseState?: () => LicenseState;
  /** F-E: webhooks de pagamento (Asaas/Stripe). Ausente = billing off (hosted sem envs). */
  billing?: BillingWebhookDeps;
}

export function buildHttpApp(opts: HttpAppOpts = {}) {
  const env = opts.env ?? process.env;
  const store: IKeyStore =
    opts.store ?? new FlatKeyStore(env['MEDIA_FORGE_API_KEYS'] ?? '');
  const limiter: RateLimiter = opts.limiter ?? new NullRateLimiter();
  const galleryStore = opts.galleryStore;
  const licenseState = opts.licenseState;
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
    // 1. Autenticacao (401)
    const auth = await resolveAuth(c.req.header('Authorization'), store);
    if (!auth.ok) return c.json({ error: 'unauthorized', reason: auth.reason }, 401);

    // 2. Gate de licença (F-F self-host C1): 403 quando revogada. No-op no modo hosted.
    // Auth (401) roda ANTES do gate de licença (403) para não vazar estado a anônimos.
    if (licenseState) {
      const state = licenseState();
      if (!state.allowed) return c.json({ error: 'license_invalid', reason: state.reason }, 403);
    }

    // 3. Rate-limit por tenant
    const rl = await limiter.check(auth.ctx.tenantId, auth.ctx.tier);
    if (!rl.allowed) {
      return c.json(
        { error: 'rate_limit_exceeded' },
        429,
        { 'Retry-After': String(rl.retryAfterSec ?? 60) },
      );
    }

    // 4. Handle MCP (propaga ctx com tenantId+tier+scopes + galleryStore F-I)
    return handleMcpRequest(c.req.raw, auth.ctx, env, { galleryStore });
  });

  // F-E: webhooks de pagamento (auth própria por provider — NÃO usam o Bearer do /mcp).
  // Registrados ANTES do mount F-B '/webhooks' pra não serem sombreados (belt: /webhooks/asaas
  // tem 1 segmento, não casa com '/:provider/:jobId' do F-B de qualquer forma).
  const billing = opts.billing;
  if (billing?.asaasWebhookToken) {
    const token = billing.asaasWebhookToken;
    app.post('/webhooks/asaas', async (c) => {
      const body = await c.req.json().catch(() => null);
      const r = await handleAsaasWebhook(
        { token: c.req.header('asaas-access-token'), body },
        { store: billing.store, credit: billing.credit, webhookToken: token },
      );
      return c.json(r.body as Record<string, unknown>, r.status as ContentfulStatusCode);
    });
  }
  if (billing?.stripeConstructEvent) {
    const constructEvent = billing.stripeConstructEvent;
    app.post('/webhooks/stripe', async (c) => {
      // Stripe exige o RAW body pra verificar a assinatura — ler texto ANTES de qualquer parse.
      const rawBody = await c.req.text();
      const r = await handleStripeWebhook(
        { rawBody, signature: c.req.header('stripe-signature') },
        { store: billing.store, credit: billing.credit, constructEvent },
      );
      return c.json(r.body as Record<string, unknown>, r.status as ContentfulStatusCode);
    });
  }

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
