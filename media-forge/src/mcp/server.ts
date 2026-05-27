// src/mcp/server.ts
// MCP stdio server entry point.
// CRITICAL: stdout is exclusively reserved for JSON-RPC messages.
// All logging goes through logger (which writes to stderr only).
// Never use console.log here or in any code path reachable from this file.
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { logger } from '../core/logger.js';
import { loadConfig } from '../core/config.js';
import { createClient } from '../core/client.js';
import { loadPricingOverridesFromEnv } from '../core/pricing.js';
import { validateHiggsfieldPricingAtBoot } from '../core/higgsfield-pricing.js';
import { registerAllTools, setWebhookRouter } from './handlers.js';
import {
  startWebhookRouter,
  stopWebhookRouter,
  registerWebhookHandler,
  type WebhookRouter,
} from '../video/providers/webhook-router.js';
import { createKlingWebhookHandler } from '../video/providers/kling-webhook-handler.js';
import { join } from 'node:path';

export interface BuildServerOpts {
  // Injection point for tests — config + client come from outside in tests
  config?: ReturnType<typeof loadConfig>;
  client?: ReturnType<typeof createClient>;
}

export function buildServer(opts: BuildServerOpts = {}): McpServer {
  const config = opts.config ?? loadConfig(process.env as Record<string, string | undefined>);
  const client = opts.client ?? createClient({ config });
  // D-6: validate MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT before any handler fires.
  // Fail fast — server cannot price Higgsfield jobs without the validated constant.
  //
  // FIX (Codex P1, PR#10): only validate when Higgsfield is actually configured.
  // P13 Google-only installs upgrading to v0.3.0-p14 must boot without setting
  // MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT. Heuristic: validate iff at least one
  // Higgsfield auth env var is set (HF_API_KEY or HIGGSFIELD_API_KEY).
  const hasHiggsfieldAuth =
    Boolean(process.env['HF_API_KEY']?.trim()) ||
    Boolean(process.env['HIGGSFIELD_API_KEY']?.trim());
  if (hasHiggsfieldAuth) {
    try {
      validateHiggsfieldPricingAtBoot();
    } catch (err) {
      process.stderr.write(`[boot-error] ${(err as Error).message}\n`);
      process.exit(2);
    }
  }
  // Honor MEDIA_FORGE_PRICING_OVERRIDES (enterprise/contract rates) BEFORE
  // registerAllTools — otherwise media_video_route + media_video_cost_estimate
  // silently report compiled-in public rates and the override env var is a no-op.
  loadPricingOverridesFromEnv(process.env);
  const server = new McpServer({ name: 'media-forge', version: '0.1.0' });
  registerAllTools(server, { client, config });
  return server;
}

/**
 * Start the local webhook router (P14+ provider callback endpoint) when the
 * operator has configured a shared secret. Kept OUT of `buildServer()` so the
 * test suite (which exercises buildServer directly) does not bind a TCP port.
 *
 * Graceful degradation: if MEDIA_FORGE_WEBHOOK_SECRET is unset, the router
 * stays off and `media_video_webhook_status` reports `running: false`. Veo
 * polls GCS for results so the P13 happy path is unaffected. P14+ providers
 * (Higgsfield, Kling, Seedance) need this active to receive completion
 * callbacks; the wizard in commands/setup.md walks users through generating a
 * secret on first install.
 */
async function maybeStartWebhookRouter(): Promise<WebhookRouter | undefined> {
  const secret = process.env['MEDIA_FORGE_WEBHOOK_SECRET'];
  if (!secret || secret.length === 0) {
    logger.warn(
      'webhook router disabled (MEDIA_FORGE_WEBHOOK_SECRET unset); P14+ providers will fall back to polling',
    );
    return undefined;
  }
  const portRaw = process.env['MEDIA_FORGE_WEBHOOK_PORT'];
  const portParsed = portRaw ? parseInt(portRaw, 10) : NaN;
  const port = Number.isFinite(portParsed) && portParsed > 0 && portParsed <= 65535 ? portParsed : 7733;
  try {
    const router = await startWebhookRouter({ port, host: '127.0.0.1', secret });
    logger.info('webhook router listening', {
      address: router.address.address,
      port: router.address.port,
    });
    return router;
  } catch (err) {
    logger.error('webhook router failed to start', {
      error: err instanceof Error ? err.message : String(err),
      port,
    });
    return undefined;
  }
}

export async function startStdioServer(): Promise<void> {
  const server = buildServer();
  const router = await maybeStartWebhookRouter();
  if (router) {
    setWebhookRouter(router);

    // Register provider-specific webhook handlers
    const projectDir = process.env['MEDIA_FORGE_PROJECT_DIR'] ?? join(process.cwd(), '.media-forge');
    const dbPath = join(projectDir, 'cost.db');
    const outputsDir = join(projectDir, 'outputs', 'kling');
    // FIX (Codex P2, PR#11): pass env so the handler's expired-CDN refresh path
     // (re-poll with native_task_id on 403/404) can rebuild Kling JWT auth.
     // Without env, that fallback throws — only unit tests with constructed
     // env saw the working path.
    registerWebhookHandler(
      router,
      'kling',
      createKlingWebhookHandler({
        dbPath,
        outputsDir,
        env: process.env as unknown as Parameters<typeof createKlingWebhookHandler>[0]['env'],
      }),
    );

    // Wire SIGTERM/SIGINT shutdown — close the router before exiting so the
    // OS port + handler map are released cleanly. Errors during close are
    // logged but do not block exit (the process is going down regardless).
    const shutdown = (signal: NodeJS.Signals): void => {
      logger.info('shutting down', { signal });
      stopWebhookRouter(router)
        .catch((err: unknown) => {
          logger.error('webhook router close failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        })
        .finally(() => {
          setWebhookRouter(undefined);
          process.exit(0);
        });
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('media-forge MCP server ready on stdio');
}

// Entry point when executed directly
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  startStdioServer().catch((err) => {
    logger.error('media-forge MCP server fatal', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
}
