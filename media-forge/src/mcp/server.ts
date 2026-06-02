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
import type { Tier } from '../http/auth.js';
import {
  startWebhookRouter,
  stopWebhookRouter,
  registerWebhookHandler,
  registerAuthValidator,
  type WebhookRouter,
} from '../video/providers/webhook-router.js';
import { createKlingWebhookHandler } from '../video/providers/kling-webhook-handler.js';
import { createHiggsfieldWebhookHandler } from '../video/providers/higgsfield-webhook-handler.js';
import { createBytedanceWebhookHandler } from '../video/providers/bytedance-webhook-handler.js';
import { verifyFalWebhookSignature } from '../video/providers/auth/fal-ed25519.js';
import { isSeedanceEnabled } from '../core/feature-flags.js';
import { join } from 'node:path';
import type { OutputStorageClient } from '../output/storage.js';
import type { GalleryStore } from '../gallery/gallery-store.js';

export interface BuildServerOpts {
  // Injection point for tests — config + client come from outside in tests
  config?: ReturnType<typeof loadConfig>;
  client?: ReturnType<typeof createClient>;
  /** F-B: artifact storage client. When undefined, handlers write to local disk (graceful degradation). */
  storage?: OutputStorageClient;
  /** F-C: tier do tenant — controla quais tools sao registradas. Default 'pro' (todos). */
  tier?: Tier;
  /** F-I: gallery store for list_my_generations. undefined = gallery disabled (self-host). */
  galleryStore?: GalleryStore;
  /** F-I: tenantId from AuthContext (F-C). undefined = 'default' (stdio / self-host). */
  tenantId?: string;
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
  const server = new McpServer({ name: 'media-forge', version: '0.2.0' });
  registerAllTools(server, {
    client,
    config,
    storage: opts.storage,
    tier: opts.tier,
    galleryStore: opts.galleryStore,
    tenantId: opts.tenantId,
  });
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

    // FIX (Codex P2 round 6, PR#10): register the Higgsfield handler so opt-in
    // webhook URL emission (MEDIA_FORGE_HF_WEBHOOK_ENABLE=true) does not 404.
    registerWebhookHandler(router, 'higgsfield', createHiggsfieldWebhookHandler({ dbPath }));

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

    // P16.W FASE 4 (PR#12): fal.ai/Seedance webhook wiring with native
    // ED25519+JWKS signature verification.
    //
    // (1) ED25519 validator — ALWAYS registered (independent of feature flag).
    //     The validator dispatches per-provider in webhook-router.ts; without
    //     this override, default HMAC would reject every fal.ai callback 401
    //     because fal.ai never sends our x-webhook-* headers (it sends
    //     x-fal-webhook-*). Registering the validator unconditionally lets the
    //     router authenticate fal.ai callbacks even when MEDIA_FORGE_SEEDANCE_
    //     ENABLED=false (jobs submitted before flag toggle still get acked).
    registerAuthValidator(router, 'bytedance', async (req, body) =>
      verifyFalWebhookSignature({ headers: req.headers, body }),
    );

    // (2) Handler — ALWAYS registered (drain or real). Without a handler, the
    //     router returns 404 even after auth passes; fal.ai treats that as
    //     delivery failure and retries 10× over 2h. A no-op drain returns 200
    //     immediately to short-circuit the retry storm when Seedance is
    //     disabled mid-flight.
    const seedanceOutputsDir = join(projectDir, 'outputs', 'seedance');
    if (isSeedanceEnabled()) {
      registerWebhookHandler(
        router,
        'bytedance',
        createBytedanceWebhookHandler({ dbPath, outputsDir: seedanceOutputsDir }),
      );
    } else {
      // Drain handler — flag disabled but callbacks for in-flight jobs still
      // need a 200 ACK to stop fal.ai's 10×/2h retry policy.
      registerWebhookHandler(router, 'bytedance', async (ctx) => {
        process.stderr.write(
          `[bytedance-webhook] drained: MEDIA_FORGE_SEEDANCE_ENABLED=false. ` +
            `jobId='${ctx.jobId}'. Set flag + restart to re-enable real ingestion.\n`,
        );
      });
    }

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
