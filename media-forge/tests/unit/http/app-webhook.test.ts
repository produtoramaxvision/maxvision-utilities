import { describe, it, expect } from 'vitest';
import { buildHttpApp } from '../../../src/http/app.js';

describe('buildHttpApp com webhook secret', () => {
  const env = {
    MEDIA_FORGE_API_KEYS: 'key-test',
    MEDIA_FORGE_WEBHOOK_SECRET: 'webhook-secret-test',
    GOOGLE_API_KEY: 'test',
  } as NodeJS.ProcessEnv;

  it('GET /webhooks/ → 200 (status do webhook app)', async () => {
    const app = buildHttpApp({ env });
    const res = await app.request('/webhooks/');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe('ok');
  });

  it('POST /webhooks/kling/job1 sem assinatura → 401', async () => {
    const app = buildHttpApp({ env });
    const res = await app.request('/webhooks/kling/job1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(401);
  });
});

describe('buildHttpApp sem webhook secret', () => {
  const env = { MEDIA_FORGE_API_KEYS: 'key-test', GOOGLE_API_KEY: 'test' } as NodeJS.ProcessEnv;

  it('GET /webhooks/ → 404 (webhook desabilitado)', async () => {
    const app = buildHttpApp({ env });
    const res = await app.request('/webhooks/');
    expect(res.status).toBe(404);
  });
});
