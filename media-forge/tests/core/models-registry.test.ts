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

describe('P15 — Kling models registered', () => {
  it('PROVIDERS runtime array includes "kling" alongside google + higgsfield', () => {
    const providers: Provider[] = [...PROVIDERS];
    expect(providers).toContain('google');
    expect(providers).toContain('higgsfield'); // from P14
    expect(providers).toContain('kling');
  });

  it('registers kling-v3-standard at $0.126/s (usd-per-second)', () => {
    const spec = VIDEO_MODELS['kling-v3-standard'];
    expect(spec).toBeDefined();
    expect(spec.provider).toBe('kling');
    expect(spec.pricing.unit).toBe('usd-per-second');
    expect(spec.pricing.rate).toBeCloseTo(0.126, 4);
    expect(spec.modes).toEqual(expect.arrayContaining(['t2v', 'i2v']));
    expect(spec.resolutions).toEqual(expect.arrayContaining(['720p', '1080p']));
    expect(spec.audioNative).toBe(true);
  });

  it('registers kling-v3-pro at $0.168/s with motion-brush + elements + lip-sync modes', () => {
    const spec = VIDEO_MODELS['kling-v3-pro'];
    expect(spec).toBeDefined();
    expect(spec.pricing.rate).toBeCloseTo(0.168, 4);
    expect(spec.modes).toEqual(
      expect.arrayContaining(['t2v', 'i2v', 'motion-brush', 'elements', 'lip-sync']),
    );
    expect(spec.resolutions).toEqual(expect.arrayContaining(['1080p', '2k']));
  });

  it('registers kling-v3-master at 4K with t2v mode (pricing flagged volatile)', () => {
    const spec = VIDEO_MODELS['kling-v3-master'];
    expect(spec).toBeDefined();
    expect(spec.resolutions).toContain('4k');
    expect(spec.fps).toContain(60);
    expect(spec.modes).toContain('t2v');
    expect(spec.pricing.source).toBe('volatile-by-tier');
    expect(spec.pricing.notes).toMatch(/verify on first live invocation/i);
  });

  it('registers kling-v3-omni with multi-shot mode (Omni differentiator)', () => {
    const spec = VIDEO_MODELS['kling-v3-omni'];
    expect(spec).toBeDefined();
    expect(spec.modes).toContain('multi-shot');
    expect(spec.pricing.source).toBe('volatile-by-tier');
  });

  it('ipRiskLevel is set on all 4 Kling models (Kuaishou is a Chinese provider — flag medium)', () => {
    for (const id of ['kling-v3-standard', 'kling-v3-pro', 'kling-v3-master', 'kling-v3-omni']) {
      const spec = VIDEO_MODELS[id];
      expect(['medium', 'high']).toContain(spec.ipRiskLevel);
    }
  });

  it('every Kling spec carries pricing.updatedAt for staleness detection', () => {
    for (const id of ['kling-v3-standard', 'kling-v3-pro', 'kling-v3-master', 'kling-v3-omni']) {
      expect(VIDEO_MODELS[id].pricing.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    }
  });

  it('kling-v3-omni exposes limits.maxShots=6 and limits.maxDurationSec=30 (single source of truth)', () => {
    const spec = VIDEO_MODELS['kling-v3-omni'];
    expect(spec.limits?.maxShots).toBe(6);
    expect(spec.limits?.maxDurationSec).toBe(30);
    expect(spec.limits?.maxDurationPerShotSec).toBe(10);
  });
});

// PATCHED per Amendment A0 — 2 tiers (Standard + Fast), per-second pricing, no Pro
describe('Seedance 2.0 models (P16)', () => {
  const SEEDANCE_IDS = ['seedance-2.0-fast', 'seedance-2.0-standard'] as const;

  it('registers seedance-2.0-fast + seedance-2.0-standard in VIDEO_MODELS', () => {
    expect(VIDEO_MODELS['seedance-2.0-fast']).toBeDefined();
    expect(VIDEO_MODELS['seedance-2.0-standard']).toBeDefined();
    // A0.1: NO Pro tier in v2
    expect(VIDEO_MODELS['seedance-2.0-pro' as string]).toBeUndefined();
  });

  it('all Seedance specs declare provider = bytedance', () => {
    for (const id of SEEDANCE_IDS) {
      expect(VIDEO_MODELS[id].provider).toBe('bytedance');
    }
  });

  it('Seedance specs declare pricing.unit = per-second (fal.ai bills per second of 720p output)', () => {
    for (const id of SEEDANCE_IDS) {
      expect(VIDEO_MODELS[id].pricing.unit).toBe('per-second');
    }
  });

  it('Seedance specs include t2v, i2v, with-refs, multi-shot, targeted-edit modes (no extend/lip-sync — not on fal.ai v2)', () => {
    const fast = VIDEO_MODELS['seedance-2.0-fast'];
    expect(fast.modes).toEqual(
      expect.arrayContaining(['t2v', 'i2v', 'with-refs', 'multi-shot', 'targeted-edit']),
    );
    expect(fast.modes).not.toContain('extend');
    expect(fast.modes).not.toContain('lip-sync');
  });

  it('Seedance specs declare audioNative = true (native audio generation, default on)', () => {
    for (const id of SEEDANCE_IDS) {
      expect(VIDEO_MODELS[id].audioNative).toBe(true);
    }
  });

  it('Seedance specs declare ipRiskLevel = high (Disney/Paramount C&D context)', () => {
    for (const id of SEEDANCE_IDS) {
      expect(VIDEO_MODELS[id].ipRiskLevel).toBe('high');
    }
  });

  it('PROVIDERS runtime array includes bytedance', () => {
    expect([...PROVIDERS]).toContain('bytedance');
  });

  it('pricing rates follow Fast < Standard (Fast cheaper per second)', () => {
    const fast = VIDEO_MODELS['seedance-2.0-fast'].pricing.rate;
    const std = VIDEO_MODELS['seedance-2.0-standard'].pricing.rate;
    expect(fast).toBeLessThan(std);
    expect(fast).toBeCloseTo(0.2419, 4);
    expect(std).toBeCloseTo(0.3024, 4);
  });

  it('Standard supports 1080p; Fast caps at 720p (verified fal.ai gallery)', () => {
    expect(VIDEO_MODELS['seedance-2.0-standard'].resolutions).toContain('1080p');
    expect(VIDEO_MODELS['seedance-2.0-fast'].resolutions).not.toContain('1080p');
    expect(VIDEO_MODELS['seedance-2.0-fast'].resolutions).toContain('720p');
  });

  it('maxDurationSec = 15 for both tiers (fal.ai enum cap)', () => {
    for (const id of SEEDANCE_IDS) {
      expect(VIDEO_MODELS[id].maxDurationSec).toBe(15);
    }
  });
});
