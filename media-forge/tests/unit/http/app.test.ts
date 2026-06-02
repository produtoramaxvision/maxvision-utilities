import { describe, it, expect } from 'vitest';
import { buildHttpApp } from '../../../src/http/app.js';
import { FlatKeyStore } from '../../../src/http/key-store.js';
import { NullRateLimiter } from '../../../src/http/rate-limiter.js';

const store = new FlatKeyStore('key-aaa');
const limiter = new NullRateLimiter();
const env = { MEDIA_FORGE_API_KEYS: 'key-aaa' } as NodeJS.ProcessEnv;

describe('buildHttpApp', () => {
  it('GET /health → 200 {ok:true}', async () => {
    const app = buildHttpApp({ env, store, limiter });
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('POST /mcp sem auth → 401', async () => {
    const app = buildHttpApp({ env, store, limiter });
    const res = await app.request('/mcp', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
  });

  it('GET /metrics → 200 text', async () => {
    const app = buildHttpApp({ env, store, limiter });
    const res = await app.request('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
  });
});

describe('rate-limit 429', () => {
  it('limiter bloqueando → 429 + Retry-After', async () => {
    // Limiter que sempre bloqueia
    const blockingLimiter = {
      async check() {
        return { allowed: false, retryAfterSec: 30 };
      },
    };
    const app = buildHttpApp({ env, store, limiter: blockingLimiter });
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { Authorization: 'Bearer key-aaa', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('30');
  });
});
