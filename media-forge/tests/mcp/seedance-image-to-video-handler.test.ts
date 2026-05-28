/**
 * P16 Task 7 — media_seedance_image_to_video handler tests.
 *
 * The image_to_video tool absorbs the original `targeted_edit` semantic via
 * the optional endImageUrl parameter (A0.5) — start frame + end frame anchors
 * the generation as a frame-anchored transition.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const generate = vi.fn();
const estimateCostUSD = vi.fn();
const mockInstance = {
  generate,
  estimateCostUSD,
  pollStatus: vi.fn(),
  download: vi.fn(),
  recordActualCostUSD: vi.fn(),
  models: [],
  name: 'bytedance' as const,
};

vi.mock('../../src/video/providers/bytedance-seedance.js', () => ({
  BytedanceSeedanceProvider: vi.fn(() => mockInstance),
  getBytedanceSeedanceProvider: vi.fn(() => mockInstance),
  __resetBytedanceSeedanceSingleton: vi.fn(),
}));

import { handleSeedanceImageToVideo } from '../../src/mcp/handlers.js';

describe('media_seedance_image_to_video handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generate.mockResolvedValue({
      jobId: 'seedance-i2v-1',
      provider: 'bytedance',
      model: 'seedance-2.0-standard',
      mode: 'i2v',
      createdAt: '2026-05-27T00:00:00.000Z',
      providerNativeId: 'fal-req-i2v',
    });
    estimateCostUSD.mockReturnValue(1.512);
  });

  it('routes i2v with imageUrl to provider via firstFrameImagePath', async () => {
    const result = await handleSeedanceImageToVideo({
      prompt: 'animate the still',
      modelTier: 'standard',
      resolution: '1080p',
      durationSec: 5,
      imageUrl: 'https://cdn.example/start.jpg',
    });
    expect(result.jobId).toBe('seedance-i2v-1');
    expect(result.mode).toBe('i2v');
    const req = generate.mock.calls[0]![0];
    expect(req.mode).toBe('i2v');
    expect(req.firstFrameImagePath).toBe('https://cdn.example/start.jpg');
    expect(req.lastFrameImagePath).toBeUndefined();
  });

  it('passes endImageUrl to provider as lastFrameImagePath (absorbs targeted_edit semantic)', async () => {
    await handleSeedanceImageToVideo({
      prompt: 'morph from A to B',
      imageUrl: 'https://cdn.example/start.jpg',
      endImageUrl: 'https://cdn.example/end.jpg',
      durationSec: 6,
    });
    const req = generate.mock.calls[0]![0];
    expect(req.firstFrameImagePath).toBe('https://cdn.example/start.jpg');
    expect(req.lastFrameImagePath).toBe('https://cdn.example/end.jpg');
  });

  it('rejects missing imageUrl', async () => {
    await expect(
      handleSeedanceImageToVideo({ prompt: 'x' }),
    ).rejects.toThrow();
  });

  it('rejects invalid imageUrl (not a URL)', async () => {
    await expect(
      handleSeedanceImageToVideo({ prompt: 'x', imageUrl: 'not-a-url' }),
    ).rejects.toThrow();
  });

  it('rejects invalid endImageUrl (not a URL)', async () => {
    await expect(
      handleSeedanceImageToVideo({
        prompt: 'x',
        imageUrl: 'https://cdn.example/a.jpg',
        endImageUrl: 'not-a-url',
      }),
    ).rejects.toThrow();
  });

  it('rejects 1080p resolution with modelTier=fast (A0.1)', async () => {
    await expect(
      handleSeedanceImageToVideo({
        prompt: 'x',
        modelTier: 'fast',
        resolution: '1080p',
        imageUrl: 'https://cdn.example/a.jpg',
      }),
    ).rejects.toThrow(/1080p resolution requires modelTier=.*standard/);
  });

  it('default modelTier is standard', async () => {
    await handleSeedanceImageToVideo({
      prompt: 'default tier',
      imageUrl: 'https://cdn.example/a.jpg',
    });
    const req = generate.mock.calls[0]![0];
    expect(req.modelId).toBe('seedance-2.0-standard');
  });
});
