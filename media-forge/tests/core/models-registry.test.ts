import { describe, it, expect } from 'vitest';
import {
  VIDEO_MODEL_VEO_3_1_PRO,
  VIDEO_MODELS,
  PROVIDERS,
  type Provider,
  type VideoModelSpec,
} from '../../src/core/models.js';

describe('multi-provider registry', () => {
  it('keeps legacy Veo constant exported and unchanged', () => {
    expect(VIDEO_MODEL_VEO_3_1_PRO).toBe('veo-3.1-generate-preview');
  });

  it('PROVIDERS runtime array contains only providers with shipped adapters (P13: google only)', () => {
    const providers: Provider[] = [...PROVIDERS];
    expect(providers).toEqual(['google']);
  });

  it('Provider type union still permits future provider names at compile time', () => {
    // This is a compile-time assertion — if it builds, the type is correct.
    const futureProvider: Provider = 'higgsfield';
    expect(typeof futureProvider).toBe('string');
  });

  it('registers the Veo 3.1 model in VIDEO_MODELS keyed by model id', () => {
    const spec = VIDEO_MODELS[VIDEO_MODEL_VEO_3_1_PRO];
    expect(spec).toBeDefined();
    expect(spec.provider).toBe('google');
    expect(spec.modes).toEqual(
      expect.arrayContaining(['t2v', 'i2v', 'interpolate', 'extend', 'with-refs']),
    );
    expect(spec.audioNative).toBe(true);
    expect(spec.ipRiskLevel).toBe('low');
  });

  it('VideoModelSpec.pricing has unit + rate + source + updatedAt fields', () => {
    const spec: VideoModelSpec = VIDEO_MODELS[VIDEO_MODEL_VEO_3_1_PRO];
    expect(['usd-per-second', 'usd-per-video', 'credits-per-video']).toContain(spec.pricing.unit);
    expect(typeof spec.pricing.rate).toBe('number');
    expect(['fixed-public-rate', 'volatile-by-tier', 'user-override']).toContain(spec.pricing.source);
    expect(spec.pricing.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
});
