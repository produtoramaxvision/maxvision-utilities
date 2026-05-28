import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, closeDb } from '../../src/core/db.js';
import { handleKlingVideoExtend } from '../../src/mcp/handlers.js';

describe('media_kling_video_extend handler', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-kling-ext-'));
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

  it('extends a source video by ~4.5s per hop', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { task_id: 'kling-ext-1' } }),
    });
    const result = await handleKlingVideoExtend(
      {
        videoUrl: 'https://example/source.mp4',
        prompt: 'continue the motion outward',
        hops: 1,
      },
      { fetchImpl: fetchImpl as never },
    );
    expect(result.provider).toBe('kling');
    expect(result.modelId).toBe('kling-v3-pro');
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api-singapore.klingai.com/v1/videos/video-extend');
  });

  it('chains multiple hops (each ~4.5s extension) — returns first hop jobId + hopsRemaining', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { task_id: 'kling-ext-multi' } }),
    });
    const result = await handleKlingVideoExtend(
      {
        videoUrl: 'https://example/source.mp4',
        prompt: 'continue',
        hops: 3,
      },
      { fetchImpl: fetchImpl as never },
    );
    expect(result.jobId).toBeDefined();
    expect(result.hopsRemaining).toBe(2);
  });

  it('rejects hops > 4 (avoid runaway cost — 4 hops ~ 18s extension is sanity limit)', async () => {
    await expect(
      handleKlingVideoExtend({
        videoUrl: 'https://example/v.mp4',
        prompt: 'x',
        hops: 5,
      }),
    ).rejects.toThrow(/max 4 hops/i);
  });

  it('rejects hops < 1', async () => {
    await expect(
      handleKlingVideoExtend({
        videoUrl: 'https://example/v.mp4',
        prompt: 'x',
        hops: 0,
      }),
    ).rejects.toThrow();
  });

  it('estimatedCostUSD reflects only the single hop submitted, regardless of hops (Codex P2 round 13, PR#11)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { task_id: 'kling-ext-cost' } }),
    });
    const r1 = await handleKlingVideoExtend(
      { videoUrl: 'https://example/v.mp4', prompt: 'x', hops: 1 },
      { fetchImpl: fetchImpl as never },
    );
    const r3 = await handleKlingVideoExtend(
      { videoUrl: 'https://example/v.mp4', prompt: 'x', hops: 3 },
      { fetchImpl: fetchImpl as never },
    );
    // Each call submits one ~4.5s hop. The estimate must NOT scale with input.hops
    // (would over-report on call 1 and break per-call ledger reconciliation).
    expect(r1.estimatedCostUSD).toBe(r3.estimatedCostUSD);
    expect(r1.estimatedCostUSD).toBeGreaterThan(0);
  });
});
