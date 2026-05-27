import { describe, it, expect } from 'vitest';
import { handleVideoRoute, handleVideoCostEstimate } from '../../src/mcp/handlers.js';

describe('P13 regression — Veo still wired end-to-end', () => {
  it('media_video_route picks Veo for t2v when preferProvider is forced', async () => {
    // P15 Option A removed google-default tiebreaker; Kling wins on cost for plain t2v.
    // preferProvider: 'google' preserves the P13 regression intent: Veo remains wired.
    const r = await handleVideoRoute({
      mode: 't2v',
      prompt: 'a quiet lake at sunrise',
      durationSec: 4,
      resolution: '720p',
      preferProvider: 'google',
    });
    expect(r.provider).toBe('google');
    expect(r.modelId).toBe('veo-3.1-generate-preview');
  });

  it('media_video_cost_estimate matches the per-second Veo rate', async () => {
    const r = await handleVideoCostEstimate({
      modelId: 'veo-3.1-generate-preview',
      mode: 't2v',
      prompt: 'a quiet lake at sunrise',
      durationSec: 8,
      resolution: '1080p',
    });
    expect(r.estimatedCostUSD).toBeCloseTo(4.0, 2);
  });
});
