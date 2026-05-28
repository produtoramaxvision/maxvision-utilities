import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HiggsfieldProvider } from '../../../src/video/providers/higgsfield.js';
import { closeDb } from '../../../src/core/db.js';

describe('HiggsfieldProvider — webhook URL is OFF by default (D-2)', () => {
  let tmpDir: string;
  let dbPath: string;
  const ORIG_FETCH = global.fetch;
  let captured: { url: string }[] = [];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-hf-wh-url-'));
    dbPath = join(tmpDir, 'cost.db');
    process.env['HF_API_KEY'] = 'pk';
    process.env['HF_API_SECRET'] = 'sk';
    process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = '0.039';
    captured = [];
    global.fetch = (async (input: RequestInfo | URL) => {
      captured.push({ url: String(input) });
      return new Response(
        JSON.stringify({ request_id: 'r', status_url: 'u', cancel_url: 'c' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = ORIG_FETCH;
    // Close the SQLite handle before rmSync — better-sqlite3 / node:sqlite hold
    // the file open on Windows, causing EPERM on tempdir removal otherwise.
    closeDb(dbPath);
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* tempdir may already be gone on a retry; ignore Windows EPERM stragglers */
    }
    delete process.env['MEDIA_FORGE_HF_WEBHOOK_ENABLE'];
    delete process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
  });

  it('does NOT append hf_webhook param when MEDIA_FORGE_HF_WEBHOOK_ENABLE is unset', async () => {
    const provider = new HiggsfieldProvider({
      dbPath,
      publicWebhookBaseUrl: 'https://app.example.com',
    });
    await provider.generate({
      modelId: 'higgsfield-soul-standard',
      mode: 't2v',
      prompt: 'x',
      durationSec: 4,
      resolution: '720p',
    });
    expect(captured[0]!.url).not.toContain('hf_webhook=');
  });

  it('does NOT append hf_webhook param when publicWebhookBaseUrl is unset (even if flag is on)', async () => {
    process.env['MEDIA_FORGE_HF_WEBHOOK_ENABLE'] = 'true';
    const provider = new HiggsfieldProvider({ dbPath }); // no publicWebhookBaseUrl
    await provider.generate({
      modelId: 'higgsfield-soul-standard',
      mode: 't2v',
      prompt: 'x',
      durationSec: 4,
      resolution: '720p',
    });
    expect(captured[0]!.url).not.toContain('hf_webhook=');
  });

  it('DOES append hf_webhook when BOTH flag and base URL are set (P14.1 dry-run)', async () => {
    process.env['MEDIA_FORGE_HF_WEBHOOK_ENABLE'] = 'true';
    const provider = new HiggsfieldProvider({
      dbPath,
      publicWebhookBaseUrl: 'https://app.example.com',
    });
    await provider.generate({
      modelId: 'higgsfield-soul-standard',
      mode: 't2v',
      prompt: 'x',
      durationSec: 4,
      resolution: '720p',
    });
    expect(captured[0]!.url).toContain('hf_webhook=https%3A%2F%2Fapp.example.com%2Fwebhooks%2Fhiggsfield%2F');
  });
});

describe('MCP server boot — Higgsfield webhook handler IS registered (Codex P2 round 6)', () => {
  // FIX (CodeRabbit round 9, PR#10): the original test asserted the opposite
  // — `not.toContain('higgsfield')` — and also early-returned without any
  // assertion when introspection was unavailable, so it could silently
  // false-pass. Round 6 explicitly added `createHiggsfieldWebhookHandler` +
  // its `registerWebhookHandler('higgsfield', ...)` call to close the
  // round 6 P2 404 finding. The contract now is: when the router boots
  // (operator set MEDIA_FORGE_WEBHOOK_SECRET), the higgsfield handler MUST
  // be present, otherwise opt-in webhook URL emission would 404 again.
  it('startStdioServer registers a higgsfield webhook handler when the router is enabled', async () => {
    // Set the secret so maybeStartWebhookRouter does not short-circuit.
    const prev = process.env['MEDIA_FORGE_WEBHOOK_SECRET'];
    process.env['MEDIA_FORGE_WEBHOOK_SECRET'] = 'test-secret-coverage-only';
    try {
      const router = await import('../../../src/video/providers/webhook-router.js');
      // The router exposes its handler map directly via the WebhookRouter type.
      // We construct a fresh router + handler explicitly here rather than booting
      // the full MCP stdio server (which would bind sockets in CI).
      const r = await router.startWebhookRouter({
        host: '127.0.0.1',
        port: 0,
        secret: 'test-secret-coverage-only',
      });
      try {
        const { createHiggsfieldWebhookHandler } = await import(
          '../../../src/video/providers/higgsfield-webhook-handler.js'
        );
        const { mkdtempSync } = await import('node:fs');
        const { tmpdir } = await import('node:os');
        const { join } = await import('node:path');
        const tmpDir = mkdtempSync(join(tmpdir(), 'mf-hf-wh-reg-'));
        const handlerDbPath = join(tmpDir, 'cost.db');
        router.registerWebhookHandler(
          r,
          'higgsfield',
          createHiggsfieldWebhookHandler({ dbPath: handlerDbPath }),
        );
        expect(r.handlers.has('higgsfield')).toBe(true);
      } finally {
        await router.stopWebhookRouter(r);
      }
    } finally {
      if (prev === undefined) delete process.env['MEDIA_FORGE_WEBHOOK_SECRET'];
      else process.env['MEDIA_FORGE_WEBHOOK_SECRET'] = prev;
    }
  });
});
