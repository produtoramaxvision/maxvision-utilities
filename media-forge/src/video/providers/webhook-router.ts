// src/video/providers/webhook-router.ts
// HTTP listener scaffold for P14+ provider callbacks (Higgsfield, Kling, Seedance).
// Binds 127.0.0.1 by default; HMAC validation with replay protection + origin
// guard + body cap + per-IP rate limit. P13 ships zero handlers (Veo polls GCS);
// P14+ directors plug handlers via `registerWebhookHandler`.
//
// SECURITY MODEL:
//   * Bind 127.0.0.1 default. Operator must explicitly opt into wider binding.
//   * HMAC SHA-256 of timestamp+"."+body (timestamp bound into signature so
//     a captured request cannot be replayed with a fresh timestamp).
//   * +/-5min timestamp tolerance window -- rejects stale callbacks.
//   * Origin guard: any non-empty `Origin` header -> 403 (browsers send Origin;
//     server-to-server callbacks do not -- defeats CSRF pivot from XSS in a
//     paired dashboard).
//   * Strict `application/json` content-type (415 otherwise).
//   * 256 KB body cap -- early via content-length, also enforced during streaming.
//   * Per-IP sliding-window rate limit: 120 req/min, 429 over limit.
//   * `timingSafeEqual` for signature comparison (constant time).
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

export interface WebhookRouter {
  readonly server: Server;
  readonly address: { address: string; port: number };
  readonly handlers: Map<Provider, WebhookHandler>;
  readonly secret: string;
}

export interface StartWebhookRouterOptions {
  readonly port?: number;
  readonly host?: string;
  readonly secret: string;
}

const MAX_BODY_BYTES = 256 * 1024; // 256 KB -- generous for webhook payloads, blocks DoS
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000; // 5 min replay window
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 120; // per IP per minute

// Per-IP sliding-window rate limiter. Module-scoped on purpose -- survives
// router restarts within a single process so an attacker cannot reset the
// window by triggering a re-bind. Memory growth is bounded in practice by
// the 127.0.0.1 default + small operator deployments; if this ever needs
// LRU eviction add it in P14+.
const rateLimiter = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = rateLimiter.get(ip) ?? [];
  const recent = arr.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  rateLimiter.set(ip, recent);
  return recent.length > RATE_LIMIT_MAX_REQUESTS;
}

export async function startWebhookRouter(opts: StartWebhookRouterOptions): Promise<WebhookRouter> {
  const host = opts.host ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== 'localhost') {
    process.stderr.write(
      `[webhook-router] WARNING: binding to ${host} exposes endpoint beyond localhost. Ensure reverse proxy + TLS + IP allowlist before production use.\n`,
    );
  }

  const handlers = new Map<Provider, WebhookHandler>();
  const secret = opts.secret;

  const server = createServer((req, res) => {
    handleRequest(req, res, handlers, secret);
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

function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  handlers: Map<Provider, WebhookHandler>,
  secret: string,
): void {
  // Healthcheck -- used by load balancers + the `media_video_webhook_status` tool.
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
  // Non-null guards -- regex captured 2 groups so both indices are defined,
  // but noUncheckedIndexedAccess marks them `string | undefined`.
  const providerRaw = match[1];
  const jobIdRaw = match[2];
  if (providerRaw === undefined || jobIdRaw === undefined) {
    res.writeHead(404).end();
    return;
  }
  const provider = providerRaw as Provider;
  const jobId = jobIdRaw;
  const remoteIp = req.socket.remoteAddress ?? 'unknown';

  // Rate limit per IP -- applied before any expensive crypto so a flood
  // attacker cannot consume HMAC CPU even with valid signatures.
  if (isRateLimited(remoteIp)) {
    res.writeHead(429).end();
    return;
  }

  // Strict content-type -- providers all send application/json. text/plain or
  // form-encoded would imply a misconfigured caller or pivot attempt.
  const contentType = req.headers['content-type'];
  if (typeof contentType !== 'string' || !contentType.startsWith('application/json')) {
    res.writeHead(415).end();
    return;
  }

  // Origin guard -- server-to-server callbacks do NOT set Origin; browsers do.
  // A non-empty Origin implies the request was launched from a browser context,
  // which provider webhooks never do. Reject to block XSS-pivot from a paired
  // dashboard tab even if HMAC secret leaks via JS exfil.
  if (typeof req.headers.origin === 'string' && req.headers.origin.length > 0) {
    res.writeHead(403).end();
    return;
  }

  // Body size cap -- early reject via content-length.
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
    // Defense in depth: a malicious client can omit content-length or lie about
    // it (chunked encoding). Enforce the cap during streaming too.
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

    // Replay protection: require X-Webhook-Timestamp, reject if outside +/-5min,
    // and bind it into the HMAC so the signature cannot be reused with a fresh
    // timestamp.
    const tsHeader = req.headers['x-webhook-timestamp'];
    if (typeof tsHeader !== 'string') {
      res.writeHead(401).end();
      return;
    }
    const ts = parseInt(tsHeader, 10);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > TIMESTAMP_TOLERANCE_MS) {
      res.writeHead(401).end();
      return;
    }

    const sigHeader = req.headers['x-webhook-signature'];
    if (typeof sigHeader !== 'string' || !sigHeader.startsWith('sha256=')) {
      res.writeHead(401).end();
      return;
    }
    const signedPayload = `${tsHeader}.${body.toString('utf8')}`;
    const expected = createHmac('sha256', secret).update(signedPayload).digest('hex');
    const provided = sigHeader.slice('sha256='.length);
    const expectedBuf = Buffer.from(expected, 'hex');
    const providedBuf = Buffer.from(provided, 'hex');
    // Length check FIRST -- timingSafeEqual throws on length mismatch, leaking
    // the comparison failure as an exception. Convert to a quiet 401 instead.
    if (
      expectedBuf.length !== providedBuf.length ||
      !timingSafeEqual(expectedBuf, providedBuf)
    ) {
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

    // Fire-and-respond: kick off handler, return 200 on success, 500 on throw.
    // `.catch()` consumes the rejection so this satisfies no-floating-promises
    // without `await` (which would serialize all webhook deliveries).
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
  });
}
