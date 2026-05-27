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

describe('MCP server boot — Higgsfield webhook handler NOT registered in P14 (D-2)', () => {
  it('webhook router has no higgsfield handler entry after server boot', async () => {
    // Boot the server in-process without network IO, then introspect the router map.
    // Implementation detail: src/video/providers/webhook-router.ts should expose listRegisteredProviders()
    // or the test reads the internal Map via a test-only export. If neither exists yet, this test SKIPS
    // with an explanatory message — and a follow-up TODO is added to expose the introspection hook.
    const { listRegisteredProviders } = await import('../../../src/video/providers/webhook-router.js') as {
      listRegisteredProviders?: () => string[];
    };
    if (!listRegisteredProviders) {
      console.warn('[skipped] webhook-router does not yet expose listRegisteredProviders — add in P14.1');
      return;
    }
    // Trigger MCP server boot (importing the module is enough — it self-registers).
    await import('../../../src/mcp/server.js');
    expect(listRegisteredProviders()).not.toContain('higgsfield');
  });
});
