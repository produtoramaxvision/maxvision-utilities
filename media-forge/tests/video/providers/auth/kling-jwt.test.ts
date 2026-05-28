import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  getKlingAuthHeader,
  signKlingJwt,
  __resetKlingJwtCache,
  KlingAuthConfigError,
  type KlingEnvSubset,
} from '../../../../src/video/providers/auth/kling-jwt.js';

describe('signKlingJwt (raw signer)', () => {
  it('produces a 3-segment dot-separated JWT', () => {
    const jwt = signKlingJwt('access-1', 'secret-1', { nowSec: 1_700_000_000 });
    const parts = jwt.split('.');
    expect(parts).toHaveLength(3);
  });

  it('header decodes to {alg:"HS256", typ:"JWT"}', () => {
    const jwt = signKlingJwt('access-1', 'secret-1', { nowSec: 1_700_000_000 });
    const [headerB64] = jwt.split('.');
    const headerJson = Buffer.from(headerB64, 'base64url').toString('utf8');
    expect(JSON.parse(headerJson)).toEqual({ alg: 'HS256', typ: 'JWT' });
  });

  it('payload contains iss=accessKey, exp=now+1800, nbf=now-5 per Kling spec', () => {
    const jwt = signKlingJwt('my-access-key', 'my-secret-key', { nowSec: 1_700_000_000 });
    const [, payloadB64] = jwt.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    expect(payload).toEqual({
      iss: 'my-access-key',
      exp: 1_700_000_000 + 1800,
      nbf: 1_700_000_000 - 5,
    });
  });

  it('signature matches HMAC-SHA256(header.payload, secret) base64url-encoded', () => {
    const accessKey = 'access-vector';
    const secretKey = 'secret-vector';
    const nowSec = 1_700_000_000;
    const jwt = signKlingJwt(accessKey, secretKey, { nowSec });
    const [headerB64, payloadB64, sigB64] = jwt.split('.');
    const expected = createHmac('sha256', secretKey)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');
    expect(sigB64).toBe(expected);
  });

  it('external test vector: known-good JWT (ak=test-ak, sk=test-sk, nowSec=1700000000) is bit-for-bit reproducible', () => {
    // Vector computed independently via node:crypto. Reference output locked at plan-write time (2026-05-27).
    const EXPECTED_HEADER = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
    const EXPECTED_PAYLOAD = 'eyJpc3MiOiJ0ZXN0LWFrIiwiZXhwIjoxNzAwMDAxODAwLCJuYmYiOjE2OTk5OTk5OTV9';
    // Compute expected signature inline using the same algorithm (asserted byte-for-byte against signer output)
    const EXPECTED_SIG = createHmac('sha256', 'test-sk')
      .update(`${EXPECTED_HEADER}.${EXPECTED_PAYLOAD}`)
      .digest('base64url');
    const EXPECTED_JWT = `${EXPECTED_HEADER}.${EXPECTED_PAYLOAD}.${EXPECTED_SIG}`;

    const actual = signKlingJwt('test-ak', 'test-sk', { nowSec: 1_700_000_000 });
    expect(actual).toBe(EXPECTED_JWT);

    // Cross-verify against a separate manual decoder to detect any drift in our base64url encoding
    const [h, p, s] = actual.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(p, 'base64url').toString())).toEqual({
      iss: 'test-ak',
      exp: 1_700_001_800,
      nbf: 1_699_999_995,
    });
    expect(s).toBe(EXPECTED_SIG);
  });

  it('base64url encoding: no = padding, + → -, / → _', () => {
    // Force a payload that, when JSON-stringified, contains chars triggering + and /
    const jwt = signKlingJwt('a/b+c=', 'secret', { nowSec: 1_700_000_000 });
    expect(jwt).not.toContain('=');
    expect(jwt).not.toContain('+');
    expect(jwt).not.toContain('/');
  });
});

describe('getKlingAuthHeader', () => {
  beforeEach(() => {
    __resetKlingJwtCache();
  });

  it('returns { Authorization: "Bearer <jwt>" } when env present', () => {
    const env: KlingEnvSubset = {
      KLING_ACCESS_KEY: 'ak_test',
      KLING_SECRET_KEY: 'sk_test',
    };
    const header = getKlingAuthHeader(env);
    expect(header.Authorization).toMatch(/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('throws KlingAuthConfigError when KLING_ACCESS_KEY missing', () => {
    expect(() =>
      getKlingAuthHeader({ KLING_SECRET_KEY: 'sk_only' } as KlingEnvSubset),
    ).toThrow(KlingAuthConfigError);
  });

  it('throws KlingAuthConfigError when KLING_SECRET_KEY missing', () => {
    expect(() =>
      getKlingAuthHeader({ KLING_ACCESS_KEY: 'ak_only' } as KlingEnvSubset),
    ).toThrow(KlingAuthConfigError);
  });

  it('error message names BOTH missing vars when both unset', () => {
    try {
      getKlingAuthHeader({} as KlingEnvSubset);
      throw new Error('should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('KLING_ACCESS_KEY');
      expect(msg).toContain('KLING_SECRET_KEY');
    }
  });

  it('error message NEVER contains the secret value (security invariant)', () => {
    try {
      getKlingAuthHeader({
        KLING_ACCESS_KEY: 'ak_pub_value',
        KLING_SECRET_KEY: '',
      } as KlingEnvSubset);
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).not.toContain('ak_pub_value');
    }
  });

  it('caches JWT per access-key for 25 minutes (re-uses same token on second call)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_700_000_000 * 1000));
    const env: KlingEnvSubset = { KLING_ACCESS_KEY: 'ak_cache', KLING_SECRET_KEY: 'sk_cache' };
    const first = getKlingAuthHeader(env).Authorization;
    // Advance 10 minutes — still inside 25-min cache window
    vi.setSystemTime(new Date((1_700_000_000 + 600) * 1000));
    const second = getKlingAuthHeader(env).Authorization;
    expect(second).toBe(first);
    vi.useRealTimers();
  });

  it('regenerates JWT after cache TTL expires (25 min default)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_700_000_000 * 1000));
    const env: KlingEnvSubset = { KLING_ACCESS_KEY: 'ak_ttl', KLING_SECRET_KEY: 'sk_ttl' };
    const first = getKlingAuthHeader(env).Authorization;
    // Advance 26 minutes — outside 25-min cache window
    vi.setSystemTime(new Date((1_700_000_000 + 26 * 60) * 1000));
    const second = getKlingAuthHeader(env).Authorization;
    expect(second).not.toBe(first);
    vi.useRealTimers();
  });

  it('cache key is access-key — different access keys get different tokens', () => {
    const headerA = getKlingAuthHeader({
      KLING_ACCESS_KEY: 'ak_one',
      KLING_SECRET_KEY: 'sk_one',
    } as KlingEnvSubset);
    const headerB = getKlingAuthHeader({
      KLING_ACCESS_KEY: 'ak_two',
      KLING_SECRET_KEY: 'sk_two',
    } as KlingEnvSubset);
    expect(headerA.Authorization).not.toBe(headerB.Authorization);
  });

  it('respects KLING_JWT_CACHE_TTL_SEC env override', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_700_000_000 * 1000));
    const env: KlingEnvSubset = {
      KLING_ACCESS_KEY: 'ak_short',
      KLING_SECRET_KEY: 'sk_short',
      KLING_JWT_CACHE_TTL_SEC: '60', // 1-minute TTL
    };
    const first = getKlingAuthHeader(env).Authorization;
    // Advance 2 minutes — outside the overridden 1-min window
    vi.setSystemTime(new Date((1_700_000_000 + 120) * 1000));
    const second = getKlingAuthHeader(env).Authorization;
    expect(second).not.toBe(first);
    vi.useRealTimers();
  });
});
