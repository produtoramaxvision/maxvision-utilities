import { describe, it, expect, vi } from 'vitest';
import { buildWebhookApp } from '../../../src/http/webhook-hono.js';
import { createHmac } from 'node:crypto';

const SECRET = 'test-secret-12345678';

function signBody(body: string, timestamp: string): string {
  return (
    'sha256=' +
    createHmac('sha256', SECRET)
      .update(`${timestamp}.${body}`)
      .digest('hex')
  );
}

// NOTA: rotas relativas — sem prefixo /webhooks (esse vem do app.route() em app.ts).
describe('buildWebhookApp (sub-app, rotas relativas)', () => {
  it('GET / retorna status + handlers', async () => {
    const app = buildWebhookApp({ secret: SECRET });
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string; handlers: string[] };
    expect(json.status).toBe('ok');
    expect(Array.isArray(json.handlers)).toBe(true);
  });

  it('POST /:provider/:jobId sem content-type json → 415', async () => {
    const app = buildWebhookApp({ secret: SECRET });
    const res = await app.request('/kling/job123', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    });
    expect(res.status).toBe(415);
  });

  it('POST com Origin header → 403', async () => {
    const app = buildWebhookApp({ secret: SECRET });
    const res = await app.request('/kling/job123', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example.com' },
      body: '{}',
    });
    expect(res.status).toBe(403);
  });

  it('POST com assinatura HMAC invalida → 401', async () => {
    const app = buildWebhookApp({ secret: SECRET });
    const ts = String(Date.now());
    const res = await app.request('/kling/job123', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-timestamp': ts,
        'x-webhook-signature': 'sha256=invalidsig',
      },
      body: '{"status":"completed"}',
    });
    expect(res.status).toBe(401);
  });

  it('POST com HMAC valido e handler registrado → 200', async () => {
    const app = buildWebhookApp({ secret: SECRET });
    const handler = vi.fn().mockResolvedValue(undefined);
    app.webhookHandlers.set('kling', handler);

    const body = '{"status":"completed","output":{"video_url":"https://cdn.example.com/v.mp4"}}';
    const ts = String(Date.now());
    const sig = signBody(body, ts);

    const res = await app.request('/kling/job-abc', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-timestamp': ts,
        'x-webhook-signature': sig,
      },
      body,
    });
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'kling', jobId: 'job-abc' }),
    );
  });

  it('POST sem handler registrado → 404', async () => {
    const app = buildWebhookApp({ secret: SECRET });
    const body = '{}';
    const ts = String(Date.now());
    const sig = signBody(body, ts);
    const res = await app.request('/google/job-xyz', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-timestamp': ts,
        'x-webhook-signature': sig,
      },
      body,
    });
    expect(res.status).toBe(404);
  });
});
