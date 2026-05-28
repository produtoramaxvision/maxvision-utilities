/**
 * P16 Task 7 — media_seedance_text_to_video handler tests.
 *
 * Mocks BytedanceSeedanceProvider at module boundary because Seedance uses the
 * `@fal-ai/client` SDK whose internal HTTP cannot be intercepted via fetchImpl
 * injection (Kling pattern doesn't apply). The mock exports the singleton getter
 * AND the class — handlers.ts calls getBytedanceSeedanceProvider().
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

import { handleSeedanceTextToVideo } from '../../src/mcp/handlers.js';

describe('media_seedance_text_to_video handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generate.mockResolvedValue({
      jobId: 'seedance-t2v-1',
      provider: 'bytedance',
      model: 'seedance-2.0-standard',
      mode: 't2v',
      createdAt: '2026-05-27T00:00:00.000Z',
      providerNativeId: 'fal-req-abc',
    });
    estimateCostUSD.mockReturnValue(1.512);
  });

  it('routes Standard tier T2V with prompt + resolution + duration to provider.generate', async () => {
    const result = await handleSeedanceTextToVideo({
      prompt: 'a quiet lake at sunrise',
      modelTier: 'standard',
      resolution: '1080p',
      durationSec: 5,
      aspectRatio: '16:9',
    });
    expect(result.jobId).toBe('seedance-t2v-1');
    expect(result.provider).toBe('bytedance');
    expect(result.model).toBe('seedance-2.0-standard');
    expect(result.mode).toBe('t2v');
    expect(result.providerNativeId).toBe('fal-req-abc');
    expect(result.estimatedCostUSD).toBeCloseTo(1.512, 4);
    expect(generate).toHaveBeenCalledTimes(1);
    const req = generate.mock.calls[0]![0];
    expect(req.modelId).toBe('seedance-2.0-standard');
    expect(req.mode).toBe('t2v');
    expect(req.prompt).toBe('a quiet lake at sunrise');
    expect(req.resolution).toBe('1080p');
    expect(req.durationSec).toBe(5);
    expect(req.aspectRatio).toBe('16:9');
    expect(req.extras.providerKind).toBe('bytedance');
  });

  it('maps modelTier="fast" to seedance-2.0-fast', async () => {
    await handleSeedanceTextToVideo({
      prompt: 'fast clip',
      modelTier: 'fast',
      resolution: '720p',
    });
    const req = generate.mock.calls[0]![0];
    expect(req.modelId).toBe('seedance-2.0-fast');
  });

  it('rejects when resolution=1080p with modelTier=fast (A0.1 — Fast caps at 720p)', async () => {
    await expect(
      handleSeedanceTextToVideo({
        prompt: 'x',
        modelTier: 'fast',
        resolution: '1080p',
      }),
    ).rejects.toThrow(/1080p resolution requires modelTier=.*standard/);
  });

  it('rejects empty prompt', async () => {
    await expect(handleSeedanceTextToVideo({ prompt: '' })).rejects.toThrow();
  });

  it('rejects durationSec out of range (< 4 or > 15)', async () => {
    await expect(
      handleSeedanceTextToVideo({ prompt: 'x', durationSec: 3 }),
    ).rejects.toThrow();
    await expect(
      handleSeedanceTextToVideo({ prompt: 'x', durationSec: 16 }),
    ).rejects.toThrow();
  });

  it('omits aspectRatio from generate request when default (auto)', async () => {
    await handleSeedanceTextToVideo({ prompt: 'no aspect' });
    const req = generate.mock.calls[0]![0];
    expect(req.aspectRatio).toBeUndefined();
  });

  it('passes seed through to extras when provided', async () => {
    await handleSeedanceTextToVideo({ prompt: 'reproducible', seed: 42 });
    const req = generate.mock.calls[0]![0];
    expect(req.extras.seed).toBe(42);
  });

  it('sets extras.durationAutoMode when caller omits durationSec (Codex P2 round 13, PR#12)', async () => {
    await handleSeedanceTextToVideo({ prompt: 'fal picks duration' });
    const req = generate.mock.calls[0]![0];
    expect(req.extras.durationAutoMode).toBe(true);
    // Preview falls back to 5s for cost estimate; fal will pick the actual length.
    expect(req.durationSec).toBe(5);
  });

  it('does NOT set extras.durationAutoMode when caller provides durationSec', async () => {
    await handleSeedanceTextToVideo({ prompt: 'fixed', durationSec: 8 });
    const req = generate.mock.calls[0]![0];
    expect(req.extras.durationAutoMode).toBeUndefined();
    expect(req.durationSec).toBe(8);
  });
});
