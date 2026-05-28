// tests/video/providers/auth/fal-ed25519.test.ts
// Verify fal.ai webhook signature module (ED25519 + JWKS) against locally
// generated keypairs (Node native crypto.generateKeyPairSync('ed25519')).
import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateKeyPairSync,
  createHash,
  sign as cryptoSign,
  type KeyObject,
} from 'node:crypto';
import {
  verifyFalWebhookSignature,
  __resetJwksCacheForTests,
} from '../../../../src/video/providers/auth/fal-ed25519.js';

interface FakeJWK {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
}

function exportJwk(publicKey: KeyObject): FakeJWK {
  const jwk = publicKey.export({ format: 'jwk' }) as unknown as FakeJWK;
  return { kty: 'OKP', crv: 'Ed25519', x: jwk.x };
}

function makeFakeJwksFetch(jwks: { keys: FakeJWK[] }, status = 200): typeof fetch {
  return (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      async json() {
        return jwks;
      },
    }) as unknown as Response) as typeof fetch;
}

function signFalMessage(
  privateKey: KeyObject,
  requestId: string,
  userId: string,
  timestamp: string,
  body: Buffer,
): string {
  const bodySha = createHash('sha256').update(body).digest('hex');
  const message = Buffer.from(`${requestId}\n${userId}\n${timestamp}\n${bodySha}`, 'utf8');
  return cryptoSign(null, message, privateKey).toString('hex');
}

describe('verifyFalWebhookSignature', () => {
  beforeEach(() => {
    __resetJwksCacheForTests();
  });

  it('valid signature + fresh timestamp + JWKS match → {valid:true}', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const jwk = exportJwk(publicKey);
    const body = Buffer.from(JSON.stringify({ request_id: 'r1', status: 'OK' }));
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = signFalMessage(privateKey, 'r1', 'u1', ts, body);

    const res = await verifyFalWebhookSignature({
      headers: {
        'x-fal-webhook-request-id': 'r1',
        'x-fal-webhook-user-id': 'u1',
        'x-fal-webhook-timestamp': ts,
        'x-fal-webhook-signature': sig,
      },
      body,
      fetchImpl: makeFakeJwksFetch({ keys: [jwk] }),
      jwksUrl: 'https://fake/jwks-1',
    });
    expect(res).toEqual({ valid: true });
  });

  it('missing header → {valid:false, reason:"missing"}', async () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const res = await verifyFalWebhookSignature({
      headers: { 'x-fal-webhook-request-id': 'r1' },
      body: Buffer.from(''),
      fetchImpl: makeFakeJwksFetch({ keys: [exportJwk(publicKey)] }),
      jwksUrl: 'https://fake/jwks-2',
    });
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/missing required/i);
  });

  it('stale timestamp (6 minutes old) → {valid:false}', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const jwk = exportJwk(publicKey);
    const body = Buffer.from('{}');
    const ts = String(Math.floor(Date.now() / 1000) - 6 * 60);
    const sig = signFalMessage(privateKey, 'r1', 'u1', ts, body);

    const res = await verifyFalWebhookSignature({
      headers: {
        'x-fal-webhook-request-id': 'r1',
        'x-fal-webhook-user-id': 'u1',
        'x-fal-webhook-timestamp': ts,
        'x-fal-webhook-signature': sig,
      },
      body,
      fetchImpl: makeFakeJwksFetch({ keys: [jwk] }),
      jwksUrl: 'https://fake/jwks-3',
    });
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/timestamp outside/i);
  });

  it('non-hex signature header → {valid:false}', async () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const res = await verifyFalWebhookSignature({
      headers: {
        'x-fal-webhook-request-id': 'r1',
        'x-fal-webhook-user-id': 'u1',
        'x-fal-webhook-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-fal-webhook-signature': 'NOTHEX!!',
      },
      body: Buffer.from('{}'),
      fetchImpl: makeFakeJwksFetch({ keys: [exportJwk(publicKey)] }),
      jwksUrl: 'https://fake/jwks-4',
    });
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/non-hex/i);
  });

  it('signature wrong length (32 bytes hex instead of 64) → {valid:false}', async () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const res = await verifyFalWebhookSignature({
      headers: {
        'x-fal-webhook-request-id': 'r1',
        'x-fal-webhook-user-id': 'u1',
        'x-fal-webhook-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-fal-webhook-signature': 'aa'.repeat(32),
      },
      body: Buffer.from('{}'),
      fetchImpl: makeFakeJwksFetch({ keys: [exportJwk(publicKey)] }),
      jwksUrl: 'https://fake/jwks-5',
    });
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/wrong length/i);
  });

  it('signature signed with wrong key → {valid:false}', async () => {
    const { publicKey: pubA } = generateKeyPairSync('ed25519');
    const { privateKey: privB } = generateKeyPairSync('ed25519');
    const body = Buffer.from('{}');
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = signFalMessage(privB, 'r1', 'u1', ts, body);

    const res = await verifyFalWebhookSignature({
      headers: {
        'x-fal-webhook-request-id': 'r1',
        'x-fal-webhook-user-id': 'u1',
        'x-fal-webhook-timestamp': ts,
        'x-fal-webhook-signature': sig,
      },
      body,
      fetchImpl: makeFakeJwksFetch({ keys: [exportJwk(pubA)] }),
      jwksUrl: 'https://fake/jwks-6',
    });
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/did not match/i);
  });

  it('body tampered after signing → {valid:false}', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const jwk = exportJwk(publicKey);
    const originalBody = Buffer.from('{"x":1}');
    const tamperedBody = Buffer.from('{"x":2}');
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = signFalMessage(privateKey, 'r1', 'u1', ts, originalBody);

    const res = await verifyFalWebhookSignature({
      headers: {
        'x-fal-webhook-request-id': 'r1',
        'x-fal-webhook-user-id': 'u1',
        'x-fal-webhook-timestamp': ts,
        'x-fal-webhook-signature': sig,
      },
      body: tamperedBody,
      fetchImpl: makeFakeJwksFetch({ keys: [jwk] }),
      jwksUrl: 'https://fake/jwks-7',
    });
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/did not match/i);
  });

  it('JWKS endpoint returns 500 → {valid:false, reason:"JWKS fetch failed"}', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    void publicKey;
    const body = Buffer.from('{}');
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = signFalMessage(privateKey, 'r1', 'u1', ts, body);

    const res = await verifyFalWebhookSignature({
      headers: {
        'x-fal-webhook-request-id': 'r1',
        'x-fal-webhook-user-id': 'u1',
        'x-fal-webhook-timestamp': ts,
        'x-fal-webhook-signature': sig,
      },
      body,
      fetchImpl: makeFakeJwksFetch({ keys: [] }, 500),
      jwksUrl: 'https://fake/jwks-8',
    });
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/JWKS fetch failed/i);
  });

  it('JWKS endpoint returns empty keys[] → {valid:false}', async () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const body = Buffer.from('{}');
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = signFalMessage(privateKey, 'r1', 'u1', ts, body);

    const res = await verifyFalWebhookSignature({
      headers: {
        'x-fal-webhook-request-id': 'r1',
        'x-fal-webhook-user-id': 'u1',
        'x-fal-webhook-timestamp': ts,
        'x-fal-webhook-signature': sig,
      },
      body,
      fetchImpl: makeFakeJwksFetch({ keys: [] }),
      jwksUrl: 'https://fake/jwks-9',
    });
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/empty key set/i);
  });

  it('multi-key JWKS — verifies against the correct one (key rotation)', async () => {
    const { publicKey: pubOld } = generateKeyPairSync('ed25519');
    const { publicKey: pubNew, privateKey: privNew } = generateKeyPairSync('ed25519');
    const body = Buffer.from('{"new":"key"}');
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = signFalMessage(privNew, 'r1', 'u1', ts, body);

    const res = await verifyFalWebhookSignature({
      headers: {
        'x-fal-webhook-request-id': 'r1',
        'x-fal-webhook-user-id': 'u1',
        'x-fal-webhook-timestamp': ts,
        'x-fal-webhook-signature': sig,
      },
      body,
      fetchImpl: makeFakeJwksFetch({ keys: [exportJwk(pubOld), exportJwk(pubNew)] }),
      jwksUrl: 'https://fake/jwks-10',
    });
    expect(res).toEqual({ valid: true });
  });

  it('JWKS cache — second call within TTL uses cached keys (no second fetch)', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const jwk = exportJwk(publicKey);
    const body = Buffer.from('{}');
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = signFalMessage(privateKey, 'r1', 'u1', ts, body);

    let fetchCalls = 0;
    const trackedFetch = (async () => {
      fetchCalls++;
      return {
        ok: true,
        status: 200,
        async json() {
          return { keys: [jwk] };
        },
      } as unknown as Response;
    }) as typeof fetch;

    const opts = {
      headers: {
        'x-fal-webhook-request-id': 'r1',
        'x-fal-webhook-user-id': 'u1',
        'x-fal-webhook-timestamp': ts,
        'x-fal-webhook-signature': sig,
      },
      body,
      fetchImpl: trackedFetch,
      jwksUrl: 'https://fake/jwks-cache-test',
    };
    const r1 = await verifyFalWebhookSignature(opts);
    const r2 = await verifyFalWebhookSignature(opts);
    expect(r1.valid).toBe(true);
    expect(r2.valid).toBe(true);
    expect(fetchCalls).toBe(1);
  });
});
