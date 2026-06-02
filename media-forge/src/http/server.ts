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

const { Pool } = pg;

export function startHttpServer(): void {
  const port = Number(process.env['MEDIA_FORGE_HTTP_PORT'] ?? 8787);
  const env = process.env;
  const config = loadConfig(env);
  // F-B: storage de artefato. Injetado nos webhook handlers de provider abaixo.
  const storage = outputStorageFromConfig(config) ?? undefined;

  // F-C: escolha do store: KeyStore (Postgres) se DATABASE_URL presente, FlatKeyStore caso contrario.
  // Graceful degradation: self-host sem Postgres usa MEDIA_FORGE_API_KEYS plana.
  let store: IKeyStore;
  const databaseUrl = env['DATABASE_URL'];
  if (databaseUrl) {
    const pepper = env['MEDIA_FORGE_KEY_PEPPER'];
    if (!pepper) {
      logger.error('MEDIA_FORGE_KEY_PEPPER must be set when DATABASE_URL is configured');
      process.exit(1);
    }
    const pool = new Pool({ connectionString: databaseUrl });
    store = new KeyStore(pool, pepper);
    logger.info('media-forge: using Postgres KeyStore (F-C tenancy)');
  } else {
    const flatKeys = env['MEDIA_FORGE_API_KEYS'] ?? '';
    if (!flatKeys) {
      logger.error('Either DATABASE_URL or MEDIA_FORGE_API_KEYS must be set');
      process.exit(1);
    }
    store = new FlatKeyStore(flatKeys);
    logger.info('media-forge: using flat KeyStore (F-A compat, no tenancy)');
  }

  // F-C: rate-limiter real (Redis) ou no-op (sem REDIS_URL)
  const limiter = createRateLimiter(env);

  const app = buildHttpApp({ store, limiter });
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

  serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });
  logger.info('media-forge MCP HTTP server ready', { port, tenancy: !!databaseUrl });
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startHttpServer();
}
