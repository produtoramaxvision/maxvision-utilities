import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  startWebhookRouter,
  stopWebhookRouter,
  registerWebhookHandler,
  registerAuthValidator,
  type WebhookRouter,
} from '../../../src/video/providers/webhook-router.js';

describe('WebhookRouter', () => {
  let router: WebhookRouter;
  const secret = 'test-secret-please-change';

  beforeEach(async () => {
    router = await startWebhookRouter({ port: 0, host: '127.0.0.1', secret });
  });

  afterEach(async () => {
    await stopWebhookRouter(router);
  });

  it('binds to 127.0.0.1 by default (not 0.0.0.0)', () => {
    expect(router.address.address).toBe('127.0.0.1');
  });

  it('listens on the assigned port', () => {
    expect(router.address.port).toBeGreaterThan(0);
  });

  it('healthcheck GET / returns 200', async () => {
    const res = await fetch(`http://127.0.0.1:${router.address.port}/`);
    expect(res.status).toBe(200);
  });

  function signedHeaders(body: string): Record<string, string> {
    const ts = Date.now().toString();
    const sig = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    return {
      'content-type': 'application/json',
      'x-webhook-timestamp': ts,
      'x-webhook-signature': `sha256=${sig}`,
    };
  }

  it('rejects POST without HMAC signature header', async () => {
    const res = await fetch(
      `http://127.0.0.1:${router.address.port}/webhooks/higgsfield/job-1`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-webhook-timestamp': Date.now().toString() },
        body: JSON.stringify({ status: 'completed' }),
      },
    );
    expect(res.status).toBe(401);
  });

  it('rejects POST with invalid HMAC signature', async () => {
    const body = JSON.stringify({ status: 'completed' });
    const ts = Date.now().toString();
    const res = await fetch(
      `http://127.0.0.1:${router.address.port}/webhooks/higgsfield/job-1`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-webhook-timestamp': ts,
          'x-webhook-signature': 'sha256=bogus',
        },
        body,
      },
    );
    expect(res.status).toBe(401);
  });

  it('rejects POST with stale timestamp (>5min)', async () => {
    const body = JSON.stringify({ status: 'completed' });
    const ts = (Date.now() - 10 * 60 * 1000).toString(); // 10 min old
    const sig = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    const res = await fetch(
      `http://127.0.0.1:${router.address.port}/webhooks/higgsfield/job-1`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-webhook-timestamp': ts,
          'x-webhook-signature': `sha256=${sig}`,
        },
        body,
      },
    );
    expect(res.status).toBe(401);
  });

  it('rejects POST with missing timestamp header', async () => {
    const body = JSON.stringify({ status: 'completed' });
    const sig = createHmac('sha256', secret).update(`${Date.now()}.${body}`).digest('hex');
    const res = await fetch(
      `http://127.0.0.1:${router.address.port}/webhooks/higgsfield/job-1`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': `sha256=${sig}`,
        },
        body,
      },
    );
    expect(res.status).toBe(401);
  });

  it('rejects POST with Origin header set (browser-pivot defense)', async () => {
    const body = JSON.stringify({ status: 'completed' });
    const res = await fetch(
      `http://127.0.0.1:${router.address.port}/webhooks/higgsfield/job-1`,
      {
        method: 'POST',
        headers: { ...signedHeaders(body), origin: 'http://evil.local' },
        body,
      },
    );
    expect(res.status).toBe(403);
  });

  it('rejects POST with non-JSON content-type', async () => {
    const body = 'not-json';
    const ts = Date.now().toString();
    const sig = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    const res = await fetch(
      `http://127.0.0.1:${router.address.port}/webhooks/higgsfield/job-1`,
      {
        method: 'POST',
        headers: {
          'content-type': 'text/plain',
          'x-webhook-timestamp': ts,
          'x-webhook-signature': `sha256=${sig}`,
        },
        body,
      },
    );
    expect(res.status).toBe(415);
  });

  it('rejects POST with body larger than cap (413)', async () => {
    const big = JSON.stringify({ x: 'a'.repeat(300_000) });
    const res = await fetch(
      `http://127.0.0.1:${router.address.port}/webhooks/higgsfield/job-1`,
      { method: 'POST', headers: signedHeaders(big), body: big },
    );
    expect(res.status).toBe(413);
  });

  it('accepts POST with valid HMAC + timestamp and routes to registered handler', async () => {
    let received: { provider: string; jobId: string; payload: unknown } | undefined;
    registerWebhookHandler(router, 'higgsfield', async (ctx) => {
      received = { provider: ctx.provider, jobId: ctx.jobId, payload: ctx.payload };
    });
    const body = JSON.stringify({ status: 'completed', url: 'https://cdn/foo.mp4' });
    const res = await fetch(
      `http://127.0.0.1:${router.address.port}/webhooks/higgsfield/job-1`,
      { method: 'POST', headers: signedHeaders(body), body },
    );
    expect(res.status).toBe(200);
    expect(received?.provider).toBe('higgsfield');
    expect(received?.jobId).toBe('job-1');
  });

  it('returns 404 for unknown provider with no handler', async () => {
    const body = JSON.stringify({ status: 'completed' });
    const res = await fetch(
      `http://127.0.0.1:${router.address.port}/webhooks/unknown/job-1`,
      { method: 'POST', headers: signedHeaders(body), body },
    );
    expect(res.status).toBe(404);
  });

  // P16.W FASE 2 (PR#12) — multi-scheme auth tests
  it('custom auth validator overrides default HMAC for that provider', async () => {
    let handlerCalled = false;
    registerWebhookHandler(router, 'bytedance', async () => {
      handlerCalled = true;
    });
    // Custom validator accepts anything (simulates ED25519+JWKS pass)
    registerAuthValidator(router, 'bytedance', async () => ({ valid: true }));

    const body = JSON.stringify({ request_id: 'r1', status: 'OK' });
    const res = await fetch(
      `http://127.0.0.1:${router.address.port}/webhooks/bytedance/job-1`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' }, // no HMAC headers
        body,
      },
    );
    expect(res.status).toBe(200);
    expect(handlerCalled).toBe(true);
  });

  it('custom auth validator can reject — returns 401, handler NOT called', async () => {
    let handlerCalled = false;
    registerWebhookHandler(router, 'bytedance', async () => {
      handlerCalled = true;
    });
    registerAuthValidator(router, 'bytedance', async () => ({
      valid: false,
      reason: 'forced reject',
    }));

    const body = JSON.stringify({ request_id: 'r1' });
    const res = await fetch(
      `http://127.0.0.1:${router.address.port}/webhooks/bytedance/job-1`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      },
    );
    expect(res.status).toBe(401);
    expect(handlerCalled).toBe(false);
  });

  it('provider WITHOUT custom validator still uses default HMAC (back-compat)', async () => {
    let handlerCalled = false;
    registerWebhookHandler(router, 'kling', async () => {
      handlerCalled = true;
    });
    // No registerAuthValidator for 'kling' — must fall back to HMAC default.

    // Without HMAC headers → 401
    const body = JSON.stringify({ task_id: 't1' });
    const resNoHmac = await fetch(
      `http://127.0.0.1:${router.address.port}/webhooks/kling/job-1`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      },
    );
    expect(resNoHmac.status).toBe(401);
    expect(handlerCalled).toBe(false);

    // With valid HMAC headers → 200
    const resWithHmac = await fetch(
      `http://127.0.0.1:${router.address.port}/webhooks/kling/job-1`,
      { method: 'POST', headers: signedHeaders(body), body },
    );
    expect(resWithHmac.status).toBe(200);
    expect(handlerCalled).toBe(true);
  });

  it('custom validator throwing → 500 (not 200/401 — surfaces bug loudly)', async () => {
    registerWebhookHandler(router, 'bytedance', async () => {
      /* would-be handler */
    });
    registerAuthValidator(router, 'bytedance', async () => {
      throw new Error('validator boom');
    });

    const body = JSON.stringify({});
    const res = await fetch(
      `http://127.0.0.1:${router.address.port}/webhooks/bytedance/job-1`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      },
    );
    expect(res.status).toBe(500);
  });
});
