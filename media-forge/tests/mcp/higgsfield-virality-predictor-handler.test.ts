import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleHiggsfieldViralityPredictor } from '../../src/mcp/handlers.js';

const ORIG_FETCH = global.fetch;

describe('media_higgsfield_virality_predictor handler', () => {
  let tmpDir: string;
  let prev: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-hf-vir-'));
    prev = process.env['MEDIA_FORGE_PROJECT_DIR'];
    process.env['MEDIA_FORGE_PROJECT_DIR'] = tmpDir;
    process.env['HF_API_KEY'] = 'pk';
    process.env['HF_API_SECRET'] = 'sk';
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (prev === undefined) delete process.env['MEDIA_FORGE_PROJECT_DIR'];
    else process.env['MEDIA_FORGE_PROJECT_DIR'] = prev;
    global.fetch = ORIG_FETCH;
  });

  it('POSTs to /higgsfield-ai/virality-predictor with the asset URL', async () => {
    let capturedUrl = '';
    let capturedBody = '';
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedBody = (init?.body as string) ?? '';
      return new Response(
        JSON.stringify({ virality_score: 0.78, audience_fit: 0.91, hook_strength: 0.6 }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const result = await handleHiggsfieldViralityPredictor({
      assetUrl: 'https://cdn.example/video.mp4',
      platform: 'tiktok',
    });

    expect(capturedUrl).toContain('/higgsfield-ai/virality-predictor');
    expect(JSON.parse(capturedBody)).toEqual({
      asset_url: 'https://cdn.example/video.mp4',
      platform: 'tiktok',
    });
    expect(result.viralityScore).toBeCloseTo(0.78, 2);
    expect(result.audienceFit).toBeCloseTo(0.91, 2);
    expect(result.hookStrength).toBeCloseTo(0.6, 2);
  });

  it('defaults platform to "general" when not specified', async () => {
    let capturedBody = '';
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = (init?.body as string) ?? '';
      return new Response(JSON.stringify({ virality_score: 0.5 }), { status: 200 });
    }) as unknown as typeof fetch;

    await handleHiggsfieldViralityPredictor({ assetUrl: 'https://cdn/x.mp4' });
    expect(JSON.parse(capturedBody)).toMatchObject({ platform: 'general' });
  });

  it('rejects invalid assetUrl', async () => {
    await expect(
      handleHiggsfieldViralityPredictor({ assetUrl: 'not-a-url' }),
    ).rejects.toThrow();
  });
});
