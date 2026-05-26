import { describe, it, expect } from 'vitest';
import { handleVideoCostEstimate } from '../../src/mcp/handlers.js';

describe('media_video_cost_estimate handler', () => {
  it('returns USD estimate for a Veo 3.1 t2v 4s @ 720p request', async () => {
    const result = await handleVideoCostEstimate({
      modelId: 'veo-3.1-generate-preview',
      mode: 't2v',
      prompt: 'test scene',
      durationSec: 4,
      resolution: '720p',
    });
    expect(result.estimatedCostUSD).toBeCloseTo(2.0, 2);
    expect(result.provider).toBe('google');
    expect(result.modelId).toBe('veo-3.1-generate-preview');
  });

  it('throws on unknown modelId', async () => {
    await expect(
      handleVideoCostEstimate({
        modelId: 'made-up-model',
        mode: 't2v',
        prompt: 'x',
        durationSec: 4,
        resolution: '720p',
      }),
    ).rejects.toThrow(/unknown model/i);
  });
});
