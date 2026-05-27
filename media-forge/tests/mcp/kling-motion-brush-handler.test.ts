import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, closeDb } from '../../src/core/db.js';
import { handleKlingMotionBrush } from '../../src/mcp/handlers.js';

describe('media_kling_motion_brush handler', () => {
  let tmpDir: string;
  let dbPath: string;
  let prev: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-kling-mb-'));
    dbPath = join(tmpDir, 'cost.db');
    prev = process.env['MEDIA_FORGE_PROJECT_DIR'];
    process.env['MEDIA_FORGE_PROJECT_DIR'] = tmpDir;
    process.env['KLING_ACCESS_KEY'] = 'ak_test';
    process.env['KLING_SECRET_KEY'] = 'sk_test';
    const db = openDb(dbPath);
    runMigrations(db);
  });

  afterEach(() => {
    closeDb(dbPath);
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // EPERM on Windows — ignore
    }
    if (prev === undefined) delete process.env['MEDIA_FORGE_PROJECT_DIR'];
    else process.env['MEDIA_FORGE_PROJECT_DIR'] = prev;
    delete process.env['KLING_ACCESS_KEY'];
    delete process.env['KLING_SECRET_KEY'];
    vi.restoreAllMocks();
  });

  it('routes through KlingProvider with motion-brush mode + regions', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { task_id: 'kling-mb-1' } }),
    });
    const result = await handleKlingMotionBrush(
      {
        prompt: 'wave the flag in the upper-left region',
        imageUrl: 'https://example/scene.png',
        regions: [
          {
            id: 'flag',
            polygon: [[0, 0], [200, 0], [200, 100], [0, 100]],
            motionVector: [30, -10],
          },
        ],
        durationSec: 5,
      },
      { fetchImpl: fetchImpl as never },
    );
    expect(result.jobId).toMatch(/^kling-/);
    expect(result.provider).toBe('kling');
    expect(result.modelId).toBe('kling-v3-pro');
    const [url, init] = fetchImpl.mock.calls[0];
    // A8 amendment: motion-brush endpoint is /v1/motion/generate (NOT /v1/videos/motion/generate)
    expect(url).toBe('https://api-singapore.klingai.com/v1/motion/generate');
    const body = JSON.parse(init.body as string);
    expect(body.prompt).toBe('wave the flag in the upper-left region');
    expect(body.image_url).toBe('https://example/scene.png');
  });

  it('rejects when no regions provided (motion-brush requires at least 1)', async () => {
    await expect(
      handleKlingMotionBrush({
        prompt: 'x',
        imageUrl: 'https://example/scene.png',
        regions: [],
        durationSec: 5,
      }),
    ).rejects.toThrow(/at least 1 motion-brush region/i);
  });

  it('rejects when imageUrl is invalid', async () => {
    await expect(
      handleKlingMotionBrush({
        prompt: 'x',
        imageUrl: 'not-a-url',
        regions: [{ id: 'r1', polygon: [[0, 0], [1, 0], [1, 1]], motionVector: [1, 0] }],
        durationSec: 5,
      }),
    ).rejects.toThrow();
  });
});
