import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, closeDb } from '../../src/core/db.js';
import { handleKlingLipSync } from '../../src/mcp/handlers.js';

describe('media_kling_lip_sync handler', () => {
  let tmpDir: string;
  let dbPath: string;
  let prev: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-kling-ls-'));
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

  it('text-driven lip-sync with emotion picker (happy)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { task_id: 'kling-ls-1' } }),
    });
    const result = await handleKlingLipSync(
      {
        videoUrl: 'https://example/source.mp4',
        text: 'hello world, this is a test',
        emotion: 'happy',
      },
      { fetchImpl: fetchImpl as never },
    );
    expect(result.provider).toBe('kling');
    expect(result.modelId).toBe('kling-v3-pro');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api-singapore.klingai.com/v1/videos/advanced-lip-sync');
    const body = JSON.parse(init.body as string);
    expect(body.prompt).toBeDefined();
  });

  it('audio-driven lip-sync (audioUrl, no emotion)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { task_id: 'kling-ls-audio' } }),
    });
    const result = await handleKlingLipSync(
      { videoUrl: 'https://example/v.mp4', audioUrl: 'https://example/voice.mp3' },
      { fetchImpl: fetchImpl as never },
    );
    expect(result.provider).toBe('kling');
  });

  it('rejects when neither text nor audioUrl provided', async () => {
    await expect(
      handleKlingLipSync({ videoUrl: 'https://example/v.mp4' }),
    ).rejects.toThrow(/either text or audioUrl required/i);
  });

  it('rejects when both text AND audioUrl provided (ambiguous)', async () => {
    await expect(
      handleKlingLipSync({
        videoUrl: 'https://example/v.mp4',
        text: 'hi',
        audioUrl: 'https://example/voice.mp3',
      }),
    ).rejects.toThrow(/exactly one of text or audioUrl/i);
  });

  it('rejects unknown emotion value', async () => {
    await expect(
      handleKlingLipSync({
        videoUrl: 'https://example/v.mp4',
        text: 'hi',
        emotion: 'excited' as never,
      }),
    ).rejects.toThrow();
  });
});
