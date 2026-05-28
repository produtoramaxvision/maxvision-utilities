import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, closeDb } from '../../src/core/db.js';
import { handleHiggsfieldDop, _resetHiggsfieldProviderForTests } from '../../src/mcp/handlers.js';

const ORIG_FETCH = global.fetch;

describe('media_higgsfield_dop handler', () => {
  let tmpDir: string;
  let dbPath: string;
  let prev: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-hf-dop-h-'));
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

  it('dispatches DoP generation with camera verbs', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url: String(input), init: init ?? {} });
      return new Response(
        JSON.stringify({ request_id: 'req-dop', status_url: 'u', cancel_url: 'c' }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const result = await handleHiggsfieldDop({
      modelId: 'higgsfield-dop',
      firstFrameImagePath: '/tmp/scene.png',
      prompt: 'reveal the city skyline',
      cameraVerbs: ['crane_up', 'dolly_in'],
      durationSec: 6,
      resolution: '1080p',
      aspectRatio: '16:9',
    });

    expect(result.provider).toBe('higgsfield');
    expect(result.jobId).toMatch(/^hf-/);
    expect(captured[0]!.url).toContain('/higgsfield-ai/dop/standard');
    const body = JSON.parse(captured[0]!.init.body as string) as Record<string, unknown>;
    expect(String(body['prompt'])).toMatch(/crane_up dolly_in/);
  });

  it('routes turbo variant when modelId requests it', async () => {
    const captured: { url: string }[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      captured.push({ url: String(input) });
      return new Response(
        JSON.stringify({ request_id: 'r', status_url: 'u', cancel_url: 'c' }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await handleHiggsfieldDop({
      modelId: 'higgsfield-dop-turbo',
      firstFrameImagePath: '/tmp/x.png',
      prompt: 'x',
      cameraVerbs: ['orbit'],
      durationSec: 4,
      resolution: '720p',
    });

    expect(captured[0]!.url).toContain('/higgsfield-ai/dop/turbo');
  });

  it('rejects unknown verbs via Zod', async () => {
    await expect(
      handleHiggsfieldDop({
        modelId: 'higgsfield-dop',
        firstFrameImagePath: '/tmp/x.png',
        prompt: 'x',
        cameraVerbs: ['transmogrify'],
        durationSec: 4,
        resolution: '720p',
      } as unknown),
    ).rejects.toThrow();
  });
});
