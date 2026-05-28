import { describe, it, expect } from 'vitest';
import { normalizeCostUSD } from '../../src/core/pricing.js';
import type { VideoModelSpec } from '../../src/core/models.js';

const pricingMeta = { source: 'fixed-public-rate' as const, updatedAt: '2026-05-26' };

const veoSpec: VideoModelSpec = {
  id: 'veo-3.1-generate-preview',
  provider: 'google',
  modes: ['t2v'],
  maxDurationSec: 148,
  resolutions: ['720p'],
  fps: [24],
  audioNative: true,
  pricing: { unit: 'usd-per-second', rate: 0.5, ...pricingMeta },
  ipRiskLevel: 'low',
};

const seedanceProSpec: VideoModelSpec = {
  id: 'seedance-2.0-pro',
  provider: 'bytedance',
  modes: ['t2v'],
  maxDurationSec: 15,
  resolutions: ['1080p'],
  fps: [24],
  audioNative: true,
  pricing: { unit: 'usd-per-video', rate: 0.74, ...pricingMeta },
  ipRiskLevel: 'high',
};

const higgsfieldPlusSpec: VideoModelSpec = {
  id: 'higgsfield-veo-3-fast',
  provider: 'higgsfield',
  modes: ['t2v'],
  maxDurationSec: 8,
  resolutions: ['720p'],
  fps: [24],
  audioNative: true,
  pricing: { unit: 'credits-per-video', rate: 100, ...pricingMeta },
  ipRiskLevel: 'low',
};

describe('normalizeCostUSD', () => {
  it('usd-per-second: rate * durationSec', () => {
    expect(normalizeCostUSD(veoSpec, { durationSec: 4 })).toBeCloseTo(2.0, 2);
    expect(normalizeCostUSD(veoSpec, { durationSec: 8 })).toBeCloseTo(4.0, 2);
  });

  it('usd-per-video: rate (flat, duration-independent)', () => {
    expect(normalizeCostUSD(seedanceProSpec, { durationSec: 5 })).toBeCloseTo(0.74, 2);
    expect(normalizeCostUSD(seedanceProSpec, { durationSec: 10 })).toBeCloseTo(0.74, 2);
  });

  it('credits-per-video: requires usdPerCredit hint, throws otherwise', () => {
    expect(() => normalizeCostUSD(higgsfieldPlusSpec, { durationSec: 8 })).toThrow(
      /usdPerCredit required for credits-per-video/i,
    );
    expect(
      normalizeCostUSD(higgsfieldPlusSpec, { durationSec: 8, usdPerCredit: 0.039 }),
    ).toBeCloseTo(3.9, 2);
  });

  it('returns Infinity on unknown unit (defensive)', () => {
    const broken: VideoModelSpec = {
      ...veoSpec,
      pricing: { unit: 'usd-per-second', rate: 0.5 },
    };
    expect(Number.isFinite(normalizeCostUSD(broken, { durationSec: 4 }))).toBe(true);
  });

  it('per-second + resolutionMultipliers: scales by output resolution (Codex P2 round 16, PR#12)', () => {
    const seedanceLikeSpec: VideoModelSpec = {
      id: 'seedance-2.0-standard-test',
      provider: 'bytedance',
      modes: ['t2v'],
      maxDurationSec: 15,
      resolutions: ['480p', '720p', '1080p'],
      fps: [24],
      audioNative: true,
      pricing: {
        unit: 'per-second',
        rate: 0.3024,
        ...pricingMeta,
        resolutionMultipliers: { '480p': 0.4448, '720p': 1.0, '1080p': 2.25 },
      },
      ipRiskLevel: 'high',
    };

    // 720p baseline — no multiplier change.
    expect(
      normalizeCostUSD(seedanceLikeSpec, { durationSec: 5, resolution: '720p' }),
    ).toBeCloseTo(0.3024 * 5, 4);
    // 1080p — 2.25× the 720p rate.
    expect(
      normalizeCostUSD(seedanceLikeSpec, { durationSec: 5, resolution: '1080p' }),
    ).toBeCloseTo(0.3024 * 2.25 * 5, 4);
    // 480p — 0.4448× the 720p rate.
    expect(
      normalizeCostUSD(seedanceLikeSpec, { durationSec: 5, resolution: '480p' }),
    ).toBeCloseTo(0.3024 * 0.4448 * 5, 4);
    // resolution omitted — falls back to 1.0 (caller hadn't specified, e.g. legacy callers).
    expect(normalizeCostUSD(seedanceLikeSpec, { durationSec: 5 })).toBeCloseTo(0.3024 * 5, 4);
  });
});
