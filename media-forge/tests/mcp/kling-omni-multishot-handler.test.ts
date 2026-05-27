import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, closeDb } from '../../src/core/db.js';
import { handleKlingOmniMultiShot } from '../../src/mcp/handlers.js';

describe('media_kling_omni_multishot handler', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-kling-omni-'));
    process.env['MEDIA_FORGE_PROJECT_DIR'] = tmpDir;
    process.env['KLING_ACCESS_KEY'] = 'ak_test';
    process.env['KLING_SECRET_KEY'] = 'sk_test';
    const db = openDb(join(tmpDir, 'cost.db'));
    runMigrations(db);
    closeDb(join(tmpDir, 'cost.db'));
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // EPERM on Windows — ignore, OS will clean up temp dir
    }
    delete process.env['MEDIA_FORGE_PROJECT_DIR'];
    delete process.env['KLING_ACCESS_KEY'];
    delete process.env['KLING_SECRET_KEY'];
    vi.restoreAllMocks();
  });

  it('dispatches up to 6 shots via /v1/videos/omni-video/', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { task_id: 'kling-omni-1' } }),
    });
    const result = await handleKlingOmniMultiShot(
      {
        shots: [
          { index: 1, prompt: 'wide establishing shot of city skyline at dawn', duration: 5 },
          { index: 2, prompt: 'medium shot of protagonist on rooftop', duration: 5 },
          { index: 3, prompt: 'close-up reaction shot', duration: 5 },
          { index: 4, prompt: 'pull-back reveal of crowd below', duration: 5 },
        ],
        imageRefs: [
          { imageUrl: 'https://example.com/protag.png' },
          { imageUrl: 'https://example.com/city.png' },
        ],
        aspectRatio: '16:9',
      },
      { fetchImpl: fetchImpl as never },
    );
    expect(result.modelId).toBe('kling-v3-omni');
    expect(result.estimatedCostUSD).toBeCloseTo(0.168 * 20, 4);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api-singapore.klingai.com/v1/videos/omni-video/');
    const body = JSON.parse(init.body as string);
    expect(body.model_name).toBe('kling-v3-omni');
    expect(body.multi_shot).toBe(true);
    expect(body.multi_prompt).toHaveLength(4);
  });

  it('rejects > 6 shots (Kling Omni hard cap)', async () => {
    const shots = Array.from({ length: 7 }, (_, i) => ({ index: i + 1, prompt: `shot ${i + 1}`, duration: 4 }));
    await expect(
      handleKlingOmniMultiShot({
        shots,
        imageRefs: [{ imageUrl: 'https://example.com/r.png' }],
      }),
    ).rejects.toThrow(/max 6 shots/i);
  });

  it('rejects 0 shots', async () => {
    await expect(
      handleKlingOmniMultiShot({ shots: [], imageRefs: [{ imageUrl: 'https://example.com/r.png' }] }),
    ).rejects.toThrow();
  });

  it('rejects when shot indices have gaps or duplicates', async () => {
    await expect(
      handleKlingOmniMultiShot({
        shots: [
          { index: 1, prompt: 'a', duration: 5 },
          { index: 1, prompt: 'b', duration: 5 },
        ],
        imageRefs: [{ imageUrl: 'https://example.com/r.png' }],
      }),
    ).rejects.toThrow(/contiguous|duplicate/i);
  });

  it('rejects when no imageRefs provided (Omni needs at least 1 visual anchor)', async () => {
    await expect(
      handleKlingOmniMultiShot({
        shots: [{ index: 1, prompt: 'a', duration: 5 }],
        imageRefs: [],
      }),
    ).rejects.toThrow();
  });

  it('rejects when total shot duration > 30s (single source of truth: VIDEO_MODELS.kling-v3-omni.limits.maxDurationSec)', async () => {
    await expect(
      handleKlingOmniMultiShot({
        shots: [
          { index: 1, prompt: 'a', duration: 10 },
          { index: 2, prompt: 'b', duration: 10 },
          { index: 3, prompt: 'c', duration: 10 },
          { index: 4, prompt: 'd', duration: 1 }, // 31s total
        ],
        imageRefs: [{ imageUrl: 'https://example.com/r.png' }],
      }),
    ).rejects.toThrow(/total duration must.*30s|<= 30s|Omni multi-shot total/i);
  });

  it('accepts exactly 30s total (boundary)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { task_id: 'kling-omni-30s' } }),
    });
    const result = await handleKlingOmniMultiShot(
      {
        shots: [
          { index: 1, prompt: 'a', duration: 10 },
          { index: 2, prompt: 'b', duration: 10 },
          { index: 3, prompt: 'c', duration: 10 },
        ],
        imageRefs: [{ imageUrl: 'https://example.com/r.png' }],
      },
      { fetchImpl: fetchImpl as never },
    );
    expect(result.provider).toBe('kling');
  });
});
