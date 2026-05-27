import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, closeDb } from '../../src/core/db.js';
import { handleHiggsfieldCinemaStudio, _resetHiggsfieldProviderForTests } from '../../src/mcp/handlers.js';

const ORIG_FETCH = global.fetch;

describe('media_higgsfield_cinema_studio handler', () => {
  let tmpDir: string;
  let dbPath: string;
  let prev: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-hf-cs-'));
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

  it('dispatches Cinema Studio request with full lens dictionary', async () => {
    let captured!: RequestInit;
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = init ?? {};
      return new Response(
        JSON.stringify({ request_id: 'r', status_url: 'u', cancel_url: 'c' }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const result = await handleHiggsfieldCinemaStudio({
      prompt: 'noir interrogation',
      firstFrameImagePath: '/tmp/scene.png',
      durationSec: 8,
      resolution: '1080p',
      focalLengthMm: 50,
      apertureFStop: 2.0,
      sensorSize: 'super35',
      colorGrading: 'noir',
      lensId: 'arri-master-prime-50mm',
    });

    expect(result.provider).toBe('higgsfield');
    const body = JSON.parse(captured.body as string) as Record<string, unknown>;
    expect(body['focal_length_mm']).toBe(50);
    expect(body['aperture_fstop']).toBe(2.0);
    expect(body['sensor_size']).toBe('super35');
    expect(body['color_grading']).toBe('noir');
    expect(body['lens_id']).toBe('arri-master-prime-50mm');
  });

  it('accepts free-form colorGrading strings beyond preset list', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ request_id: 'r', status_url: 'u', cancel_url: 'c' }), {
        status: 200,
      }),
    ) as unknown as typeof fetch;

    const result = await handleHiggsfieldCinemaStudio({
      prompt: 'x',
      firstFrameImagePath: '/tmp/x.png',
      durationSec: 4,
      resolution: '720p',
      colorGrading: 'kodak-portra-emulation',
    });
    expect(result.jobId).toMatch(/^hf-/);
  });

  it('rejects invalid focal length (negative)', async () => {
    await expect(
      handleHiggsfieldCinemaStudio({
        prompt: 'x',
        firstFrameImagePath: '/tmp/x.png',
        durationSec: 4,
        resolution: '720p',
        focalLengthMm: -50,
      }),
    ).rejects.toThrow();
  });
});
