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
    // No tier segment, and the image field is `image_url`. Both were wrong until
    // 2026-08-01, and both were pinned as correct by this assertion:
    //   POST /higgsfield-ai/speak/standard -> 404 model_not_found
    //   POST /higgsfield-ai/speak {}       -> 422 image_url, audio_url, prompt required
    // Verified against the live API — see higgsfield-endpoints-live.test.ts.
    expect(captured.url).toContain('/higgsfield-ai/speak');
    expect(captured.url).not.toContain('/speak/standard');
    const body = JSON.parse(captured.init.body as string) as Record<string, unknown>;
    expect(body['audio_url']).toBe('/tmp/voice.wav');
    expect(body['image_url']).toBe('/tmp/face.png');
    expect(body['first_frame_url'], 'the platform has no such field').toBeUndefined();
    // `duration`, not `duration_seconds` — the platform validates the former
    // (`Input should be 5, 10 or 15`) and silently ignores the latter.
    expect(body['duration']).toBe(15);
    expect(body['duration_seconds']).toBeUndefined();
  });

  // REMOVED — 'routes Speak 2.0 to its endpoint when modelId is higgsfield-speak2'.
  //
  // There is no Speak 2.0 endpoint. /higgsfield-ai/speak2/standard answers 404
  // with and without the tier segment, and speak2 is not a job type or workflow
  // on the CLI either. The test passed because it asserted against a mocked
  // fetch, which will confirm any URL you build.


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
