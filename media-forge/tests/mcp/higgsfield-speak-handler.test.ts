import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, closeDb } from '../../src/core/db.js';
import { handleHiggsfieldSpeak, _resetHiggsfieldProviderForTests } from '../../src/mcp/handlers.js';

const ORIG_FETCH = global.fetch;

describe('media_higgsfield_speak handler', () => {
  let tmpDir: string;
  let dbPath: string;
  let prev: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-hf-speak-'));
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
    delete process.env['MEDIA_FORGE_HF_SPEAK_AUDIO_MODE'];
  });

  it('dispatches Speak lip-sync with photo + audio', async () => {
    let captured!: { url: string; init: RequestInit };
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = { url: String(input), init: init ?? {} };
      return new Response(
        JSON.stringify({ request_id: 'r', status_url: 'u', cancel_url: 'c' }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const result = await handleHiggsfieldSpeak({
      modelId: 'higgsfield-speak',
      portraitImagePath: '/tmp/face.png',
      audioPath: '/tmp/voice.wav',
      prompt: 'confident newsreader',
      durationSec: 15,
      resolution: '720p',
    });

    expect(result.provider).toBe('higgsfield');
    expect(captured.url).toContain('/higgsfield-ai/speak/standard');
    const body = JSON.parse(captured.init.body as string) as Record<string, unknown>;
    expect(body['audio_url']).toBe('/tmp/voice.wav');
    expect(body['first_frame_url']).toBe('/tmp/face.png');
  });

  it('routes Speak 2.0 to its endpoint when modelId is higgsfield-speak2', async () => {
    let capturedUrl = '';
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ request_id: 'r', status_url: 'u', cancel_url: 'c' }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    await handleHiggsfieldSpeak({
      modelId: 'higgsfield-speak2',
      portraitImagePath: '/tmp/face.png',
      audioPath: '/tmp/v.wav',
      prompt: 'x',
      durationSec: 30,
      resolution: '1080p',
    });
    expect(capturedUrl).toContain('/higgsfield-ai/speak2/standard');
  });

  it('rejects when audioPath is missing', async () => {
    await expect(
      handleHiggsfieldSpeak({
        modelId: 'higgsfield-speak',
        portraitImagePath: '/tmp/face.png',
        prompt: 'x',
        durationSec: 10,
        resolution: '720p',
      } as unknown),
    ).rejects.toThrow();
  });
});
