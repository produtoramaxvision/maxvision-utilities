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
});
