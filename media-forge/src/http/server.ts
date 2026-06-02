import { serve } from '@hono/node-server';
import { join } from 'node:path';
import { buildHttpApp } from './app.js';
import { logger } from '../core/logger.js';
import { loadConfig } from '../core/config.js';
import { outputStorageFromConfig } from '../output/storage.js';
import { createKlingWebhookHandler } from '../video/providers/kling-webhook-handler.js';
import { createHiggsfieldWebhookHandler } from '../video/providers/higgsfield-webhook-handler.js';
import { createBytedanceWebhookHandler } from '../video/providers/bytedance-webhook-handler.js';
import { isSeedanceEnabled } from '../core/feature-flags.js';
import type { WebhookHonoApp } from './webhook-hono.js';

export function startHttpServer(): void {
  const port = Number(process.env['MEDIA_FORGE_HTTP_PORT'] ?? 8787);
  const config = loadConfig(process.env);
  // F-B: storage de artefato. Importado já aqui (Task 4) para evitar uma segunda
  // modificação deste arquivo; injetado nos webhook handlers na Task 7.
  const _storage = outputStorageFromConfig(config) ?? undefined;
  void _storage;
  const app = buildHttpApp();
  const appRec = app as unknown as Record<string, unknown>;

  // Wire provider webhook handlers into the Hono webhook app if it was mounted.
  const webhookApp = appRec['webhookApp'] as WebhookHonoApp | undefined;
  if (webhookApp) {
    const projectDir = process.env['MEDIA_FORGE_PROJECT_DIR'] ?? join(process.cwd(), '.media-forge');
    const dbPath = join(projectDir, 'cost.db');

    // Higgsfield HMAC handler (logging stub — sem buffer; entrega via fallback assetUrls).
    // storage adicionado na Task 7.
    webhookApp.webhookHandlers.set('higgsfield', createHiggsfieldWebhookHandler({ dbPath }));

    // Kling HMAC handler — storage adicionado na Task 7 (upload do asset em state=succeed).
    webhookApp.webhookHandlers.set(
      'kling',
      createKlingWebhookHandler({
        dbPath,
        outputsDir: join(projectDir, 'outputs', 'kling'),
        env: process.env as never,
      }),
    );

    // fal.ai / Bytedance-Seedance — ED25519 auth branch inline em webhook-hono.ts.
    // Drain quando MEDIA_FORGE_SEEDANCE_ENABLED=false para ACK in-flight jobs.
    const seedanceOutputsDir = join(projectDir, 'outputs', 'seedance');
    if (isSeedanceEnabled()) {
      webhookApp.webhookHandlers.set(
        'bytedance',
        createBytedanceWebhookHandler({ dbPath, outputsDir: seedanceOutputsDir }),
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
  logger.info('media-forge MCP HTTP server ready', { port });
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startHttpServer();
}
