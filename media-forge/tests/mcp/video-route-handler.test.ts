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
    // A8 (2026-07-30): the winner changed, and the change is correct rather than a
    // regression. This used to expect kling-v3-standard at a flat $0.126/s. Two
    // corrections moved it:
    //   1. Standard's $0.126 is the official 720P rate; 1080P is $0.168. It now
    //      carries resolutionMultipliers, so its real 1080p cost is $1.68/10s.
    //   2. Omni's rate was a PLACEHOLDER of 0.168 and is really $0.14/s for this
    //      entry's condition, so $1.40/10s.
    // The router's documented rule is a pure cheapest-USD sort, and $1.40 < $1.68,
    // so Omni legitimately wins at 1080p once both rates are right. Both models
    // support plain t2v, so nothing is being routed to an incapable model.
    expect(result.modelId).toBe('kling-v3-omni');
    expect(result.estimatedCostUSD).toBeCloseTo(0.14 * 10, 4);
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
