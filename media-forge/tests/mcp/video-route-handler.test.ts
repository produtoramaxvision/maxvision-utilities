import { describe, it, expect } from 'vitest';
import { handleVideoRoute } from '../../src/mcp/handlers.js';

describe('media_video_route handler', () => {
  it('routes t2v to Veo 3.1 / google in P13 (Veo-only)', async () => {
    const result = await handleVideoRoute({
      mode: 't2v',
      prompt: 'cinematic dolly in on a coastal cliff at sunset',
      durationSec: 8,
      resolution: '1080p',
    });
    expect(result.provider).toBe('google');
    expect(result.modelId).toBe('veo-3.1-generate-preview');
    expect(result.mode).toBe('t2v');
    expect(result.estimatedCostUSD).toBeCloseTo(4.0, 2);
    expect(typeof result.rationale).toBe('string');
  });

  it('rejects modes Veo does not support (e.g. motion-brush)', async () => {
    await expect(
      handleVideoRoute({
        mode: 'motion-brush',
        prompt: 'x',
        durationSec: 4,
        resolution: '720p',
      }),
    ).rejects.toThrow(/no provider supports mode='?motion-brush/i);
  });
});
