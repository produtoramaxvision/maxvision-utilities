import { describe, it, expect } from 'vitest';
import { handleVideoRoute } from '../../src/mcp/handlers.js';

describe('media_video_route handler', () => {
  it('routes t2v to Veo 3.1 / google in P13 (Veo-only, preferProvider forced)', async () => {
    // P15 Option A removed google-default tiebreaker; Kling now wins on cost for plain t2v.
    // Use preferProvider: 'google' to preserve the P13 intent: Veo is still wired and works.
    const result = await handleVideoRoute({
      mode: 't2v',
      prompt: 'cinematic dolly in on a coastal cliff at sunset',
      durationSec: 8,
      resolution: '1080p',
      preferProvider: 'google',
    });
    expect(result.provider).toBe('google');
    expect(result.modelId).toBe('veo-3.1-generate-preview');
    expect(result.mode).toBe('t2v');
    expect(result.estimatedCostUSD).toBeCloseTo(4.0, 2);
    expect(typeof result.rationale).toBe('string');
  });

  it('motion-brush routes to kling-v3-pro in P15 (Veo does not support it; Kling does)', async () => {
    // P13 this test expected a throw (Veo-only registry). P15 Kling joins ADAPTED_PROVIDERS
    // and kling-v3-pro supports motion-brush — explicit-tier override applies.
    const result = await handleVideoRoute({
      mode: 'motion-brush',
      prompt: 'wave the flag',
      durationSec: 5,
      resolution: '1080p',
    });
    expect(result.provider).toBe('kling');
    expect(result.modelId).toBe('kling-v3-pro');
  });
});

describe('P15 — video-router prefers Kling for specific cases', () => {
  it('routes mode=multi-shot → kling-v3-omni', async () => {
    const result = await handleVideoRoute({
      mode: 'multi-shot',
      prompt: 'sequence',
      durationSec: 20,
      resolution: '1080p',
    });
    expect(result.provider).toBe('kling');
    expect(result.modelId).toBe('kling-v3-omni');
  });

  it('routes mode=motion-brush → kling-v3-pro', async () => {
    const result = await handleVideoRoute({
      mode: 'motion-brush',
      prompt: 'wave the flag',
      durationSec: 5,
      resolution: '1080p',
    });
    expect(result.provider).toBe('kling');
    expect(result.modelId).toBe('kling-v3-pro');
  });

  it('routes mode=elements → kling-v3-pro', async () => {
    const result = await handleVideoRoute({
      mode: 'elements',
      prompt: 'four characters',
      durationSec: 5,
      resolution: '1080p',
    });
    expect(result.provider).toBe('kling');
    expect(result.modelId).toBe('kling-v3-pro');
  });

  it('routes mode=lip-sync (with emotion request) → kling-v3-pro', async () => {
    const result = await handleVideoRoute({
      mode: 'lip-sync',
      prompt: 'emotional voiceover',
      durationSec: 5,
      resolution: '1080p',
    });
    expect(result.provider).toBe('kling');
  });

  it('routes resolution=4k → kling-v3-master', async () => {
    const result = await handleVideoRoute({
      mode: 't2v',
      prompt: 'hero shot',
      durationSec: 5,
      resolution: '4k',
    });
    expect(result.provider).toBe('kling');
    expect(result.modelId).toBe('kling-v3-master');
  });

  it('routes t2v 1080p with no special signals → cheapest USD-per-second wins (Kling V2.6 if registered, else V3 Standard)', async () => {
    const result = await handleVideoRoute({
      mode: 't2v',
      prompt: 'volume work',
      durationSec: 10,
      resolution: '1080p',
    });
    // After P15 with only V3 tiers registered, V3 Standard at $0.126/s vs Veo at $0.50/s wins
    expect(result.modelId).toBe('kling-v3-standard');
    expect(result.estimatedCostUSD).toBeCloseTo(0.126 * 10, 4);
  });

  it('honors preferProvider: "google" override even when Kling would win on cost', async () => {
    const result = await handleVideoRoute({
      mode: 't2v',
      prompt: 'must use veo for audio',
      durationSec: 5,
      resolution: '1080p',
      preferProvider: 'google',
    });
    expect(result.provider).toBe('google');
  });

  it('accepts 480p resolution and routes Seedance-eligible candidates (Codex P2 round 6)', async () => {
    // Regression: VideoRouteInput.resolution was ['720p','1080p','2k','4k'], so
    // every 480p request 400'd before the router could consider any model.
    // Seedance specs advertise 480p; with this fix the router now sees them.
    const result = await handleVideoRoute({
      mode: 't2v',
      prompt: 'budget render at 480p',
      durationSec: 5,
      resolution: '480p',
      preferProvider: 'bytedance',
    });
    expect(result.provider).toBe('bytedance');
  });
});
