// src/video/providers/auth/fal-ed25519.ts
// fal.ai webhook signature verifier — ED25519 with JWKS public-key rotation.
//
// Spec (verified via context7 → https://fal.ai/docs/documentation/model-apis/inference/webhooks):
//   * Headers: x-fal-webhook-{request-id,user-id,timestamp,signature}
//   * Message: requestId + "\n" + userId + "\n" + timestamp + "\n" + sha256(body, hex)
//   * Signature: ED25519 (64 bytes), hex-encoded
//   * JWKS endpoint: https://rest.fal.ai/.well-known/jwks.json (24h cache)
//   * Timestamp tolerance: ±5 minutes (300s, matches our HMAC router window)
//
// Node 16+ has native ED25519 in `crypto.verify(null, ...)` and JWK import
// via `createPublicKey({key, format: 'jwk'})`. Zero new dependencies.
//
// Cache strategy: module-scoped Map keyed by jwksUrl. Test seam exposes
// `__resetJwksCache()` for deterministic tests.
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';

const DEFAULT_JWKS_URL = 'https://rest.fal.ai/.well-known/jwks.json';
const JWKS_TTL_MS = 24 * 60 * 60 * 1000;
const TIMESTAMP_TOLERANCE_SEC = 300;
const ED25519_SIG_BYTES = 64;

interface JWK {
  readonly kty: string;
  readonly crv: string;
  readonly x: string;
  readonly kid?: string;
}

interface JWKSResponse {
  readonly keys: ReadonlyArray<JWK>;
}

interface JwksCacheEntry {
  readonly keys: ReadonlyArray<JWK>;
  readonly fetchedAt: number;
}

const jwksCache = new Map<string, JwksCacheEntry>();

export interface VerifyFalWebhookOpts {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: Buffer;
  readonly fetchImpl?: typeof fetch;
  readonly jwksUrl?: string;
  readonly now?: () => number;
}

export interface VerifyResult {
  readonly valid: boolean;
  readonly reason?: string;
}

/**
 * Verify a fal.ai webhook signature. Returns {valid:true} on success;
 * {valid:false, reason} on any failure (missing header, stale timestamp,
 * malformed signature, JWKS fetch error, signature mismatch).
 *
 * Caller must already have enforced the body cap + content-type + origin
 * guard via the router; this validator focuses exclusively on the
 * cryptographic + temporal layer of the fal.ai contract.
 */
export async function verifyFalWebhookSignature(
  opts: VerifyFalWebhookOpts,
): Promise<VerifyResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const jwksUrl = opts.jwksUrl ?? DEFAULT_JWKS_URL;
  const now = opts.now ?? Date.now;

  const requestId = readHeader(opts.headers, 'x-fal-webhook-request-id');
  const userId = readHeader(opts.headers, 'x-fal-webhook-user-id');
  const timestamp = readHeader(opts.headers, 'x-fal-webhook-timestamp');
  const sigHex = readHeader(opts.headers, 'x-fal-webhook-signature');

  if (!requestId || !userId || !timestamp || !sigHex) {
    return { valid: false, reason: 'missing required x-fal-webhook-* header' };
  }

  const tsSec = parseInt(timestamp, 10);
  if (!Number.isFinite(tsSec)) {
    return { valid: false, reason: 'x-fal-webhook-timestamp not a finite integer' };
  }
  const nowSec = Math.floor(now() / 1000);
  if (Math.abs(nowSec - tsSec) > TIMESTAMP_TOLERANCE_SEC) {
    return { valid: false, reason: `timestamp outside ±${TIMESTAMP_TOLERANCE_SEC}s window` };
  }

  // Hex decode + length sanity. Buffer.from(_, 'hex') silently truncates on
  // odd-length or non-hex chars, so verify the round-trip + final byte count.
  if (!/^[0-9a-f]+$/i.test(sigHex)) {
    return { valid: false, reason: 'signature header contains non-hex chars' };
  }
  const signatureBytes = Buffer.from(sigHex, 'hex');
  if (signatureBytes.length !== ED25519_SIG_BYTES) {
    return {
      valid: false,
      reason: `signature wrong length (got ${signatureBytes.length}, expected ${ED25519_SIG_BYTES})`,
    };
  }

  // Message format per fal.ai docs:
  //   requestId\nuserId\ntimestamp\nsha256(body, hex)
  const bodySha = createHash('sha256').update(opts.body).digest('hex');
  const message = Buffer.from(`${requestId}\n${userId}\n${timestamp}\n${bodySha}`, 'utf8');

  let keys: ReadonlyArray<JWK>;
  try {
    keys = await getJwks(fetchImpl, jwksUrl, now);
  } catch (err) {
    return {
      valid: false,
      reason: `JWKS fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (keys.length === 0) {
    return { valid: false, reason: 'JWKS endpoint returned empty key set' };
  }

  // Try each key. ED25519 has only one valid signature per (key, message)
  // so iterating is a key-rotation accommodation, not a brute-force vector.
  for (const jwk of keys) {
    if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519') continue;
    try {
      const publicKey = createPublicKey({
        key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x },
        format: 'jwk',
      });
      // For ED25519, Node's verify() takes `null` as the algorithm arg
      // (the curve implies the hash).
      if (cryptoVerify(null, message, publicKey, signatureBytes)) {
        return { valid: true };
      }
    } catch {
      // Malformed JWK or import failure on this key — try the next.
      continue;
    }
  }

  return { valid: false, reason: 'signature did not match any JWKS public key' };
}

async function getJwks(
  fetchImpl: typeof fetch,
  url: string,
  now: () => number,
): Promise<ReadonlyArray<JWK>> {
  const cached = jwksCache.get(url);
  if (cached && now() - cached.fetchedAt < JWKS_TTL_MS) {
    return cached.keys;
  }
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const parsed = (await res.json()) as JWKSResponse;
  if (!parsed || !Array.isArray(parsed.keys)) {
    throw new Error('JWKS response missing keys[]');
  }
  jwksCache.set(url, { keys: parsed.keys, fetchedAt: now() });
  return parsed.keys;
}

function readHeader(
  h: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = h[name];
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return undefined;
}

/** Test seam — clears all JWKS cache entries. Production code must not call. */
export function __resetJwksCacheForTests(): void {
  jwksCache.clear();
}
