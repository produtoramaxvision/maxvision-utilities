import { createHmac } from 'node:crypto';

export class KlingAuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KlingAuthConfigError';
  }
}

export interface KlingEnvSubset {
  /**
   * Kling API 2.0 static API key, sent as `Authorization: Bearer <key>`.
   * Preferred scheme — takes precedence over AccessKey/SecretKey when set.
   */
  readonly KLING_API_KEY?: string;
  /** AccessKey — legacy scheme (HS256 JWT signing). */
  readonly KLING_ACCESS_KEY?: string;
  /** SecretKey — legacy scheme (HS256 JWT signing). */
  readonly KLING_SECRET_KEY?: string;
  /** Override JWT cache TTL in seconds. Default 1500 (25min). Max 1800 (Kling's 30-min server window). */
  readonly KLING_JWT_CACHE_TTL_SEC?: string;
}

export interface AuthHeader {
  readonly Authorization: string;
}

const DEFAULT_CACHE_TTL_SEC = 25 * 60; // 25 minutes — leaves 5min safety margin before Kling's 30-min expiry
const MAX_CACHE_TTL_SEC = 30 * 60;

interface CachedToken {
  readonly jwt: string;
  readonly expiresAtMs: number;
}

// Module-level cache: access-key → token. Survives across calls within a single process.
const tokenCache = new Map<string, CachedToken>();

/** Test hook — resets the cache between unit tests. NOT for production use. */
export function __resetKlingJwtCache(): void {
  tokenCache.clear();
}

/**
 * Base64url-encode a Buffer or string per RFC 7515 §2. Strips trailing `=` padding,
 * replaces `+` with `-` and `/` with `_` — matches the standard `base64url` digest
 * encoding that `node:crypto` produces natively when given `.digest('base64url')`.
 */
function b64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

export interface SignOptions {
  /** Override current epoch seconds (for deterministic tests). */
  readonly nowSec?: number;
}

/**
 * Signs a Kling JWT per the spec at https://docs.qingque.cn/d/home/eZQClNhFSCFi1nhCEoaJBaENe
 * (Kling API v3 auth, JWT HS256).
 *
 * Header: {alg: "HS256", typ: "JWT"}
 * Payload: {iss: accessKey, exp: nowSec + 1800, nbf: nowSec - 5}
 *
 * Returns the 3-segment dot-separated JWT string ready for `Authorization: Bearer <jwt>`.
 */
export function signKlingJwt(accessKey: string, secretKey: string, opts: SignOptions = {}): string {
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' } as const;
  const payload = { iss: accessKey, exp: nowSec + 1800, nbf: nowSec - 5 } as const;
  const headerB64 = b64url(JSON.stringify(header));
  const payloadB64 = b64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sigB64 = createHmac('sha256', secretKey).update(signingInput).digest('base64url');
  return `${signingInput}.${sigB64}`;
}

/**
 * Builds the Kling Authorization header. Supports two auth schemes:
 *
 * 1. API 2.0 (preferred): `KLING_API_KEY` set → returns `Bearer <key>` directly.
 *    No JWT signing, no cache involvement.
 * 2. Legacy (AccessKey/SecretKey): `KLING_API_KEY` absent/empty → validates env vars,
 *    signs (or reuses cached) JWT, caches it per access-key for the configured TTL
 *    (default 25min, env-overridable).
 *
 * Security: error messages NEVER include the secret value (only var names). Tests assert.
 *
 * Threading: not thread-safe (Node is single-threaded per worker — fine for our usage).
 */
export function getKlingAuthHeader(env: KlingEnvSubset): AuthHeader {
  const apiKey = env.KLING_API_KEY;
  if (apiKey && apiKey.trim().length > 0) {
    return { Authorization: `Bearer ${apiKey}` };
  }

  const missing: string[] = [];
  const accessKey = env.KLING_ACCESS_KEY;
  const secretKey = env.KLING_SECRET_KEY;
  if (!accessKey || accessKey.length === 0) missing.push('KLING_ACCESS_KEY');
  if (!secretKey || secretKey.length === 0) missing.push('KLING_SECRET_KEY');
  if (missing.length > 0) {
    throw new KlingAuthConfigError(
      'Kling auth not configured. Set KLING_API_KEY (API 2.0, preferred), or both ' +
        `KLING_ACCESS_KEY and KLING_SECRET_KEY (legacy). Missing: ${missing.join(', ')}. ` +
        'Generate keys at https://klingai.com → Console → API Keys.',
    );
  }

  const ttlSec = parseTtl(env.KLING_JWT_CACHE_TTL_SEC);
  const nowMs = Date.now();
  const cached = tokenCache.get(accessKey!);
  if (cached && cached.expiresAtMs > nowMs) {
    return { Authorization: `Bearer ${cached.jwt}` };
  }

  const jwt = signKlingJwt(accessKey!, secretKey!);
  tokenCache.set(accessKey!, { jwt, expiresAtMs: nowMs + ttlSec * 1000 });
  return { Authorization: `Bearer ${jwt}` };
}

function parseTtl(raw: string | undefined): number {
  if (!raw) return DEFAULT_CACHE_TTL_SEC;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_CACHE_TTL_SEC;
  return Math.min(n, MAX_CACHE_TTL_SEC);
}
