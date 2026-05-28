// src/video/providers/webhook-router.ts
// HTTP listener scaffold for P14+ provider callbacks (Higgsfield, Kling, Seedance).
// Binds 127.0.0.1 by default; per-provider pluggable auth (HMAC default for our
// own-signed providers; ED25519+JWKS for fal.ai). Body cap + origin guard +
// content-type check + per-IP rate limit are always applied before auth.
//
// SECURITY MODEL:
//   * Bind 127.0.0.1 default. Operator must explicitly opt into wider binding.
//   * Strict `application/json` content-type (415 otherwise).
//   * 256 KB body cap -- early via content-length, also enforced during streaming.
//   * Per-IP sliding-window rate limit: 120 req/min, 429 over limit.
//   * Origin guard: any non-empty `Origin` header -> 403.
//   * Auth: pluggable per-provider validator (registerAuthValidator). Default is
//     HMAC SHA-256 of timestamp+"."+body (binds timestamp into signature to
//     defeat replay) -- used by Higgsfield + Kling (we control signing on
//     submit). fal.ai (Bytedance/Seedance) uses ED25519+JWKS via the dedicated
//     module in ./auth/fal-ed25519.ts.
//   * `timingSafeEqual` for HMAC signature comparison (constant time).
//
// P16.W FASE 2 (PR#12): extracted HMAC into the default validator and added
// pluggable per-provider validators. fal.ai webhooks now have a path to pass
// the router's signature gate; previously they always 401'd because the
// router was HMAC-only.
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Provider } from '../../core/models.js';

export interface WebhookContext {
  readonly provider: Provider;
  readonly jobId: string;
  readonly payload: unknown;
  readonly headers: Record<string, string | string[] | undefined>;
}

export type WebhookHandler = (ctx: WebhookContext) => Promise<void>;

/**
 * Per-provider auth validator. Receives the raw request + body (after the
 * router has applied rate limit, content-type, body cap, and origin guard).
 * Returns {valid:true} on success or {valid:false, reason} on any failure.
 *
 * Default validator (HMAC of `${timestamp}.${body}`) is applied to providers
 * that have no custom override. fal.ai/Seedance gets a custom ED25519+JWKS
 * validator via registerAuthValidator(router, 'bytedance', ...).
 */
export type AuthValidator = (
  req: IncomingMessage,
  body: Buffer,
) => Promise<{ valid: boolean; reason?: string }>;

export interface WebhookRouter {
  readonly server: Server;
  readonly address: { address: string; port: number };
  readonly handlers: Map<Provider, WebhookHandler>;
  readonly authValidators: Map<Provider, AuthValidator>;
  readonly secret: string;
}

export interface StartWebhookRouterOptions {
  readonly port?: number;
  readonly host?: string;
  readonly secret: string;
}

const MAX_BODY_BYTES = 256 * 1024;
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 120;

const rateLimiter = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = rateLimiter.get(ip) ?? [];
  const recent = arr.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  rateLimiter.set(ip, recent);
  return recent.length > RATE_LIMIT_MAX_REQUESTS;
}

/**
 * Default HMAC validator — used by providers without a custom override.
 * Validates x-webhook-timestamp (±5min) + x-webhook-signature (sha256=<hex>
 * of `${timestamp}.${body}`). Timestamp is bound into the signature to
 * defeat captured-request replay with a fresh timestamp.
 */
export function createHmacValidator(secret: string): AuthValidator {
  return async (req, body) => {
    const tsHeader = req.headers['x-webhook-timestamp'];
    if (typeof tsHeader !== 'string') {
      return { valid: false, reason: 'missing x-webhook-timestamp' };
    }
    const ts = parseInt(tsHeader, 10);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > TIMESTAMP_TOLERANCE_MS) {
      return { valid: false, reason: 'timestamp outside ±5min window' };
    }

    const sigHeader = req.headers['x-webhook-signature'];
    if (typeof sigHeader !== 'string' || !sigHeader.startsWith('sha256=')) {
      return { valid: false, reason: 'missing or malformed x-webhook-signature' };
    }
    const signedPayload = `${tsHeader}.${body.toString('utf8')}`;
    const expected = createHmac('sha256', secret).update(signedPayload).digest('hex');
    const provided = sigHeader.slice('sha256='.length);
    const expectedBuf = Buffer.from(expected, 'hex');
    const providedBuf = Buffer.from(provided, 'hex');
    if (
      expectedBuf.length !== providedBuf.length ||
      !timingSafeEqual(expectedBuf, providedBuf)
    ) {
      return { valid: false, reason: 'HMAC signature mismatch' };
    }
    return { valid: true };
  };
}

export async function startWebhookRouter(opts: StartWebhookRouterOptions): Promise<WebhookRouter> {
  const host = opts.host ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== 'localhost') {
    process.stderr.write(
      `[webhook-router] WARNING: binding to ${host} exposes endpoint beyond localhost. Ensure reverse proxy + TLS + IP allowlist before production use.\n`,
    );
  }

  const handlers = new Map<Provider, WebhookHandler>();
  const authValidators = new Map<Provider, AuthValidator>();
  const secret = opts.secret;
  const defaultValidator = createHmacValidator(secret);

  const server = createServer((req, res) => {
    handleRequest(req, res, handlers, authValidators, defaultValidator);
  });

  await new Promise<void>((resolve) => {
    server.listen(opts.port ?? 7733, host, () => {
      resolve();
    });
  });

  const addr = server.address() as AddressInfo;
  return {
    server,
    address: { address: addr.address, port: addr.port },
    handlers,
    authValidators,
    secret,
  };
}

export async function stopWebhookRouter(router: WebhookRouter): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    router.server.close((err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

export function registerWebhookHandler(
  router: WebhookRouter,
  provider: Provider,
  handler: WebhookHandler,
): void {
  router.handlers.set(provider, handler);
}

/**
 * Register a per-provider auth validator (overrides the default HMAC for
 * that provider). Used by fal.ai/Seedance to install ED25519+JWKS instead
 * of HMAC, since fal.ai signs with asymmetric keys and never shares an HMAC
 * secret. Other providers (Higgsfield, Kling) use the default HMAC and do
 * not need to register here.
 */
export function registerAuthValidator(
  router: WebhookRouter,
  provider: Provider,
  validator: AuthValidator,
): void {
  router.authValidators.set(provider, validator);
}

function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  handlers: Map<Provider, WebhookHandler>,
  authValidators: Map<Provider, AuthValidator>,
  defaultValidator: AuthValidator,
): void {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', handlers: Array.from(handlers.keys()) }));
    return;
  }

  const PATH_RE = /^\/webhooks\/([^/]+)\/([^/?#]+)/;
  const match = PATH_RE.exec(req.url ?? '');
  if (!match || req.method !== 'POST') {
    res.writeHead(404).end();
    return;
  }
  const providerRaw = match[1];
  const jobIdRaw = match[2];
  if (providerRaw === undefined || jobIdRaw === undefined) {
    res.writeHead(404).end();
    return;
  }
  const provider = providerRaw as Provider;
  const jobId = jobIdRaw;
  const remoteIp = req.socket.remoteAddress ?? 'unknown';

  if (isRateLimited(remoteIp)) {
    res.writeHead(429).end();
    return;
  }

  const contentType = req.headers['content-type'];
  if (typeof contentType !== 'string' || !contentType.startsWith('application/json')) {
    res.writeHead(415).end();
    return;
  }

  if (typeof req.headers.origin === 'string' && req.headers.origin.length > 0) {
    res.writeHead(403).end();
    return;
  }

  const lenHeader = req.headers['content-length'];
  if (lenHeader && parseInt(lenHeader, 10) > MAX_BODY_BYTES) {
    res.writeHead(413).end();
    return;
  }

  const chunks: Buffer[] = [];
  let received = 0;
  let aborted = false;
  req.on('data', (c: Buffer) => {
    if (aborted) return;
    received += c.length;
    if (received > MAX_BODY_BYTES) {
      aborted = true;
      res.writeHead(413).end();
      req.destroy();
      return;
    }
    chunks.push(c);
  });

  req.on('end', () => {
    if (aborted) return;
    const body = Buffer.concat(chunks);

    // Per-provider auth dispatch. fal.ai/Seedance registers ED25519+JWKS;
    // everyone else uses default HMAC.
    const validator = authValidators.get(provider) ?? defaultValidator;
    validator(req, body)
      .then((authResult) => {
        if (!authResult.valid) {
          res.writeHead(401).end();
          return;
        }

        const handler = handlers.get(provider);
        if (!handler) {
          res.writeHead(404).end();
          return;
        }

        let payload: unknown;
        try {
          payload = body.length > 0 ? JSON.parse(body.toString('utf8')) : {};
        } catch {
          res.writeHead(400).end();
          return;
        }

        handler({ provider, jobId, payload, headers: req.headers })
          .then(() => {
            res.writeHead(200).end();
          })
          .catch((err: unknown) => {
            process.stderr.write(
              `[webhook-router] handler error for ${provider}/${jobId}: ${(err as Error).message}\n`,
            );
            res.writeHead(500).end();
          });
      })
      .catch((err: unknown) => {
        process.stderr.write(
          `[webhook-router] auth validator error for ${provider}/${jobId}: ${(err as Error).message}\n`,
        );
        res.writeHead(500).end();
      });
  });
}
