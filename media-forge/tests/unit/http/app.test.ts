import { describe, it, expect } from 'vitest';
import { buildHttpApp } from '../../../src/http/app.js';

const env = { MEDIA_FORGE_API_KEYS: 'key-aaa' } as NodeJS.ProcessEnv;

describe('buildHttpApp', () => {
  it('GET /health → 200 {ok:true}', async () => {
    const app = buildHttpApp({ env });
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('POST /mcp sem auth → 401', async () => {
    const app = buildHttpApp({ env });
    const res = await app.request('/mcp', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
  });

  it('GET /metrics → 200 text', async () => {
    const app = buildHttpApp({ env });
    const res = await app.request('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
  });
});
