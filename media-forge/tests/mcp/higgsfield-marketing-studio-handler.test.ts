import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, closeDb } from '../../src/core/db.js';
import { handleHiggsfieldMarketingStudio, _resetHiggsfieldProviderForTests } from '../../src/mcp/handlers.js';

const ORIG_FETCH = global.fetch;

describe('media_higgsfield_marketing_studio handler', () => {
  let tmpDir: string;
  let dbPath: string;
  let prev: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-hf-mkt-'));
    dbPath = join(tmpDir, 'cost.db');
    prev = process.env['MEDIA_FORGE_PROJECT_DIR'];
    process.env['MEDIA_FORGE_PROJECT_DIR'] = tmpDir;
    process.env['HF_API_KEY'] = 'pk';
    process.env['HF_API_SECRET'] = 'sk';
    process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = '0.039';
    const db = openDb(dbPath);
    runMigrations(db);
    _resetHiggsfieldProviderForTests();
  });

  afterEach(() => {
    closeDb(dbPath);
    rmSync(tmpDir, { recursive: true, force: true });
    if (prev === undefined) delete process.env['MEDIA_FORGE_PROJECT_DIR'];
    else process.env['MEDIA_FORGE_PROJECT_DIR'] = prev;
    global.fetch = ORIG_FETCH;
    delete process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
  });

  it('dispatches Marketing Studio with template + product URL', async () => {
    let captured!: RequestInit;
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = init ?? {};
      return new Response(
        JSON.stringify({ request_id: 'r', status_url: 'u', cancel_url: 'c' }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const result = await handleHiggsfieldMarketingStudio({
      template: 'unboxing',
      productUrl: 'https://shop.example/product/42',
      prompt: 'show the box opening with the gadget revealed',
      durationSec: 12,
      resolution: '1080p',
    });

    expect(result.provider).toBe('higgsfield');
    const body = JSON.parse(captured.body as string) as Record<string, unknown>;
    expect(body['template']).toBe('unboxing');
    expect(body['product_url']).toBe('https://shop.example/product/42');
  });

  it('rejects invalid template names', async () => {
    await expect(
      handleHiggsfieldMarketingStudio({
        template: 'tiktok-dance',
        productUrl: 'https://shop.example/p',
        prompt: 'x',
        durationSec: 10,
        resolution: '720p',
      } as unknown),
    ).rejects.toThrow();
  });

  it('rejects productUrl without https scheme', async () => {
    await expect(
      handleHiggsfieldMarketingStudio({
        template: 'ugc',
        productUrl: 'not-a-url',
        prompt: 'x',
        durationSec: 10,
        resolution: '720p',
      }),
    ).rejects.toThrow();
  });
});
