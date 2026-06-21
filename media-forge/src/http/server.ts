import { serve } from '@hono/node-server';
import { join } from 'node:path';
import pg from 'pg';
import { buildHttpApp } from './app.js';
import { KeyStore, FlatKeyStore } from './key-store.js';
import type { IKeyStore } from './key-store.js';
import { createRateLimiter } from './rate-limiter.js';
import { logger } from '../core/logger.js';
import { loadConfig } from '../core/config.js';
import { outputStorageFromConfig } from '../output/storage.js';
import { createKlingWebhookHandler } from '../video/providers/kling-webhook-handler.js';
import { createHiggsfieldWebhookHandler } from '../video/providers/higgsfield-webhook-handler.js';
import { createBytedanceWebhookHandler } from '../video/providers/bytedance-webhook-handler.js';
import { isSeedanceEnabled } from '../core/feature-flags.js';
import type { WebhookHonoApp } from './webhook-hono.js';
import { GalleryStore } from '../gallery/gallery-store.js';
import { startMarginCron } from '../gallery/margin-cron.js';
import { createTelegramNotifier } from '../gallery/gallery-notifier.js';
import Stripe from 'stripe';
import type { BillingWebhookDeps } from './app.js';
import { PaymentsStore } from '../billing/payments-store.js';
import { CreditClient } from '../billing/credit-client.js';
import { startReconcileLoop } from '../billing/reconcile.js';

const { Pool } = pg;

export async function startHttpServer(): Promise<void> {
  const port = Number(process.env['MEDIA_FORGE_HTTP_PORT'] ?? 8787);
  const env = process.env;
  const config = loadConfig(env);

  // F-B: storage de artefato. Injetado nos webhook handlers de provider abaixo.
  const storage = outputStorageFromConfig(config) ?? undefined;

  // F-C: escolha do store: KeyStore (Postgres) se DATABASE_URL presente, FlatKeyStore caso contrario.
  // Graceful degradation: self-host sem Postgres usa MEDIA_FORGE_API_KEYS plana.
  let store: IKeyStore;
  let galleryStore: GalleryStore | undefined;
  let billing: BillingWebhookDeps | undefined;
  const databaseUrl = env['DATABASE_URL'];
  if (databaseUrl) {
    const pepper = env['MEDIA_FORGE_KEY_PEPPER'];
    if (!pepper) {
      logger.error('MEDIA_FORGE_KEY_PEPPER must be set when DATABASE_URL is configured');
      process.exit(1);
    }
    // F-I: reuse the same pool for GalleryStore — single connection pool per Postgres.
    const pool = new Pool({ connectionString: databaseUrl });
    // OPS3: apply pending pg migrations before any store reads tenants/api_keys.
    const { runPgMigrations } = await import('../core/pg-migrate.js');
    const pgApplied = await runPgMigrations(pool);
    if (pgApplied.length) logger.info('pg migrations applied', { applied: pgApplied });
    store = new KeyStore(pool, pepper);
    galleryStore = new GalleryStore(pool);
    logger.info('media-forge: using Postgres KeyStore (F-C tenancy) + GalleryStore (F-I)');

    // F-I: margin alert cron — evaluates margin every GALLERY_ALERT_INTERVAL_MINUTES (default 60).
    const thresholdPct = Number(env['GALLERY_ALERT_MARGIN_THRESHOLD_PCT'] ?? 30);
    const intervalMs = Number(env['GALLERY_ALERT_INTERVAL_MINUTES'] ?? 60) * 60 * 1000;
    const notifier = createTelegramNotifier(env);
    const stopCron = startMarginCron({ store: galleryStore, notifier, thresholdPct, intervalMs });
    process.once('SIGTERM', stopCron);
    process.once('SIGINT', stopCron);

    // F-E: billing (pagamentos -> carteira credit-core). Reusa o mesmo Pool.
    // Requer CREDIT_API_URL + CREDIT_API_KEY (grant + reconcile). Cada rota de
    // webhook é montada só com sua config (Asaas token / Stripe secret+whsec).
    // Ausente => billing OFF (hosted sem envs): rotas não montam, débito é no-op.
    const creditApiUrl = env['CREDIT_API_URL'];
    const creditApiKey = env['CREDIT_API_KEY'];
    if (creditApiUrl && creditApiKey) {
      const paymentsStore = new PaymentsStore(pool);
      const credit = new CreditClient({ baseUrl: creditApiUrl, apiKey: creditApiKey });
      const asaasWebhookToken = env['ASAAS_WEBHOOK_TOKEN'];
      const stripeSecret = env['STRIPE_SECRET_KEY'];
      const stripeWebhookSecret = env['STRIPE_WEBHOOK_SECRET'];
      let stripeConstructEvent: BillingWebhookDeps['stripeConstructEvent'];
      if (stripeSecret && stripeWebhookSecret) {
        const stripe = new Stripe(stripeSecret);
        stripeConstructEvent = (rawBody, signature) =>
          stripe.webhooks.constructEvent(rawBody, signature, stripeWebhookSecret) as unknown as ReturnType<
            NonNullable<BillingWebhookDeps['stripeConstructEvent']>
          >;
      }
      billing = {
        store: paymentsStore,
        credit,
        ...(asaasWebhookToken ? { asaasWebhookToken } : {}),
        ...(stripeConstructEvent ? { stripeConstructEvent } : {}),
      };
      const stopReconcile = startReconcileLoop({ store: paymentsStore, credit, logger });
      process.once('SIGTERM', stopReconcile);
      process.once('SIGINT', stopReconcile);
      logger.info('billing enabled (F-E)', {
        asaas: Boolean(asaasWebhookToken),
        stripe: Boolean(stripeConstructEvent),
      });
    } else {
      logger.info('billing disabled (CREDIT_API_URL/CREDIT_API_KEY unset)');
    }
  } else {
    const flatKeys = env['MEDIA_FORGE_API_KEYS'] ?? '';
    if (!flatKeys) {
      logger.error('Either DATABASE_URL or MEDIA_FORGE_API_KEYS must be set');
      process.exit(1);
    }
    store = new FlatKeyStore(flatKeys);
    logger.warn(
      'DATABASE_URL unset — gallery disabled; list_my_generations returns gallery_not_configured',
    );
    logger.info('media-forge: using flat KeyStore (F-A compat, no tenancy)');
  }

  // F-C: rate-limiter real (Redis) ou no-op (sem REDIS_URL)
  const limiter = createRateLimiter(env);

  const app = buildHttpApp({
    store,
    limiter,
    galleryStore,
    ...(billing ? { billing } : {}),
  });
  const appRec = app as unknown as Record<string, unknown>;

  // Wire provider webhook handlers into the Hono webhook app if it was mounted.
  const webhookApp = appRec['webhookApp'] as WebhookHonoApp | undefined;
  if (webhookApp) {
    const projectDir = env['MEDIA_FORGE_PROJECT_DIR'] ?? join(process.cwd(), '.media-forge');
    const dbPath = join(projectDir, 'cost.db');

    // Higgsfield HMAC handler (logging stub — sem buffer; entrega via fallback assetUrls).
    webhookApp.webhookHandlers.set(
      'higgsfield',
      createHiggsfieldWebhookHandler({ dbPath, storage }),
    );

    // Kling HMAC handler — upload do asset para MinIO quando state=succeed.
    webhookApp.webhookHandlers.set(
      'kling',
      createKlingWebhookHandler({
        dbPath,
        outputsDir: join(projectDir, 'outputs', 'kling'),
        env: env as never,
        storage,
      }),
    );

    // fal.ai / Bytedance-Seedance — ED25519 auth branch inline em webhook-hono.ts.
    // Drain quando MEDIA_FORGE_SEEDANCE_ENABLED=false para ACK in-flight jobs.
    const seedanceOutputsDir = join(projectDir, 'outputs', 'seedance');
    if (isSeedanceEnabled()) {
      webhookApp.webhookHandlers.set(
        'bytedance',
        createBytedanceWebhookHandler({ dbPath, outputsDir: seedanceOutputsDir, storage }),
      );
    } else {
      webhookApp.webhookHandlers.set('bytedance', async (ctx) => {
        process.stderr.write(
          `[bytedance-webhook] drained (MEDIA_FORGE_SEEDANCE_ENABLED=false). jobId='${ctx.jobId}'.\n`,
        );
      });
    }

    logger.info('webhook Hono endpoint active', {
      path: '/webhooks/:provider/:jobId',
      handlers: Array.from(webhookApp.webhookHandlers.keys()),
    });
  } else {
    logger.warn('webhook endpoint disabled (MEDIA_FORGE_WEBHOOK_SECRET unset)');
  }

  const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });
  logger.info('media-forge MCP HTTP server ready', { port, tenancy: !!databaseUrl });

  const shutdown = (): void => {
    server.close();
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void startHttpServer();
}
