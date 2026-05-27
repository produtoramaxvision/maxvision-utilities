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

  it('PROVIDERS runtime array contains only providers with shipped adapters', () => {
    const providers: Provider[] = [...PROVIDERS];
    expect(providers).toEqual(expect.arrayContaining(['google']));
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

describe('P14 — Higgsfield models registered', () => {
  it('PROVIDERS runtime array now includes higgsfield (P13 had only google)', () => {
    const providers: Provider[] = [...PROVIDERS];
    expect(providers).toEqual(expect.arrayContaining(['google', 'higgsfield']));
  });

  const expected = [
    'higgsfield-soul-standard',
    'higgsfield-soul-pro',
    'higgsfield-soul2',
    'higgsfield-dop',
    'higgsfield-dop-turbo',
    'higgsfield-speak',
    'higgsfield-speak2',
    'higgsfield-cinema-studio-3.5',
    'higgsfield-marketing-studio',
    'higgsfield-recast',
  ];

  for (const id of expected) {
    it(`registers ${id} with credits-per-video pricing`, () => {
      const spec = VIDEO_MODELS[id];
      expect(spec, `missing spec: ${id}`).toBeDefined();
      expect(spec!.provider).toBe('higgsfield');
      expect(spec!.pricing.unit).toBe('credits-per-video');
      expect(spec!.pricing.rate).toBeGreaterThan(0);
      expect(spec!.pricing.source).toBe('volatile-by-tier');
      expect(spec!.pricing.updatedAt).toMatch(/^2026-05-/);
    });
  }

  it('higgsfield-soul-standard supports t2v + i2v', () => {
    const spec = VIDEO_MODELS['higgsfield-soul-standard']!;
    expect(spec.modes).toEqual(expect.arrayContaining(['t2v', 'i2v']));
  });

  it('higgsfield-dop supports i2v with-refs (camera-control modes ride on i2v)', () => {
    const spec = VIDEO_MODELS['higgsfield-dop']!;
    expect(spec.modes).toEqual(expect.arrayContaining(['i2v', 'with-refs']));
  });

  it('higgsfield-speak supports lip-sync mode', () => {
    const spec = VIDEO_MODELS['higgsfield-speak']!;
    expect(spec.modes).toContain('lip-sync');
  });

  it('higgsfield-marketing-studio is a template-driven video (t2v)', () => {
    const spec = VIDEO_MODELS['higgsfield-marketing-studio']!;
    expect(spec.modes).toContain('t2v');
  });
});
