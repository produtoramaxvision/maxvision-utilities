// src/http/webhook-hono.ts
// Webhook endpoint público como Hono app — opção A: mesma porta 3000 do /mcp.
// Montado em app.route('/webhooks', webhookApp) em app.ts — as rotas aqui são
// RELATIVAS ao ponto de montagem (sem prefixo /webhooks).
// Reutiliza os validators criptográficos existentes:
//   - HMAC (Higgsfield, Kling) — mesmo esquema de webhook-router.ts
//     (createHmacValidator): sha256 de `${timestamp}.${body}` + tolerância ±5min.
//   - verifyFalWebhookSignature (fal.ai/Bytedance) de auth/fal-ed25519.ts
// Body-cap, origin-guard e rate-limit reimplementados como Hono middleware.
import { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Provider } from '../core/models.js';
import type { WebhookContext, WebhookHandler } from '../video/providers/webhook-router.js';
import { verifyFalWebhookSignature } from '../video/providers/auth/fal-ed25519.js';

const MAX_BODY_BYTES = 256 * 1024; // 256 KB
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000; // ±5 min
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 120;

// Per-IP rate limit (in-process; single replica).
// NOTE: atrás do Traefik req remoteAddress = IP do proxy. Usa X-Forwarded-For
// quando disponível. Rate-limit cross-replica → F-C (Redis).
const rateMap = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = rateMap.get(ip) ?? [];
  const recent = arr.filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  rateMap.set(ip, recent);
  return recent.length > RATE_MAX;
}

function verifyHmac(secret: string, timestamp: string, body: string, sigHeader: string): boolean {
  if (!sigHeader.startsWith('sha256=')) return false;
  const signedPayload = `${timestamp}.${body}`;
  const expected = createHmac('sha256', secret).update(signedPayload).digest('hex');
  const provided = sigHeader.slice('sha256='.length);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(provided, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// Intersection type (não interface extends ReturnType<...> que não compila).
export type WebhookHonoApp = Hono & {
  /** Mutable map: provider -> handler. Injetado por startHttpServer. */
  readonly webhookHandlers: Map<Provider, WebhookHandler>;
  /** Per-provider auth override (extensibilidade; fal.ai usa branch inline). */
  readonly authOverrides: Map<
    Provider,
    (headers: Record<string, string>, body: string) => Promise<boolean>
  >;
};

export interface BuildWebhookAppOpts {
  secret: string;
}

export function buildWebhookApp(opts: BuildWebhookAppOpts): WebhookHonoApp {
  const { secret } = opts;
  const honoApp = new Hono();
  const webhookHandlers = new Map<Provider, WebhookHandler>();
  const authOverrides = new Map<
    Provider,
    (headers: Record<string, string>, body: string) => Promise<boolean>
  >();

  // Cast to intersection type after attaching the extra maps.
  const app = honoApp as unknown as WebhookHonoApp;
  (app as unknown as Record<string, unknown>).webhookHandlers = webhookHandlers;
  (app as unknown as Record<string, unknown>).authOverrides = authOverrides;

  // Status endpoint (rota relativa — será acessível em GET /webhooks/ após mount)
  honoApp.get('/', (c) =>
    c.json({ status: 'ok', handlers: Array.from(webhookHandlers.keys()) }),
  );

  // Webhook dispatch (rota relativa — será POST /webhooks/:provider/:jobId após mount)
  honoApp.post('/:provider/:jobId', async (c) => {
    const provider = c.req.param('provider') as Provider;
    const jobId = c.req.param('jobId');

    // Origin guard (block browser CORS requests)
    if (c.req.header('origin')) return c.body(null, 403);

    // Content-type guard
    const ct = c.req.header('content-type') ?? '';
    if (!ct.startsWith('application/json')) return c.body(null, 415);

    // Rate limit (keyed on X-Forwarded-For first hop, else 'unknown')
    const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    if (isRateLimited(clientIp)) return c.body(null, 429);

    // Read body with cap
    const raw = await c.req.raw.arrayBuffer();
    if (raw.byteLength > MAX_BODY_BYTES) return c.body(null, 413);
    const bodyStr = Buffer.from(raw).toString('utf8');

    // Auth dispatch: fal.ai/bytedance → ED25519; everyone else → HMAC
    const isFalProvider = provider === 'bytedance';
    let authOk = false;

    if (isFalProvider) {
      const headers: Record<string, string> = {};
      c.req.raw.headers.forEach((v, k) => {
        headers[k] = v;
      });
      try {
        const result = await verifyFalWebhookSignature({
          headers,
          body: Buffer.from(raw),
        });
        authOk = result.valid;
      } catch {
        authOk = false;
      }
    } else {
      // Check custom override first (extensibility), then HMAC default
      const override = authOverrides.get(provider);
      if (override) {
        const headers: Record<string, string> = {};
        c.req.raw.headers.forEach((v, k) => {
          headers[k] = v;
        });
        authOk = await override(headers, bodyStr).catch(() => false);
      } else {
        const ts = c.req.header('x-webhook-timestamp');
        const sig = c.req.header('x-webhook-signature');
        if (
          ts &&
          sig &&
          Number.isFinite(Number(ts)) &&
          Math.abs(Date.now() - Number(ts)) <= TIMESTAMP_TOLERANCE_MS
        ) {
          authOk = verifyHmac(secret, ts, bodyStr, sig);
        }
      }
    }

    if (!authOk) return c.body(null, 401);

    const handler = webhookHandlers.get(provider);
    if (!handler) return c.body(null, 404);

    let payload: unknown;
    try {
      payload = bodyStr.length > 0 ? JSON.parse(bodyStr) : {};
    } catch {
      return c.body(null, 400);
    }

    const headers: Record<string, string | string[] | undefined> = {};
    c.req.raw.headers.forEach((v, k) => {
      headers[k] = v;
    });

    const ctx: WebhookContext = { provider, jobId, payload, headers };
    try {
      await handler(ctx);
      return c.body(null, 200);
    } catch (err) {
      process.stderr.write(
        `[webhook-hono] handler error for ${provider}/${jobId}: ${(err as Error).message}\n`,
      );
      return c.body(null, 500);
    }
  });

  return app;
}
