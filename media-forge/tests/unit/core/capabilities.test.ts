import { describe, it, expect } from 'vitest';
import { ApiFieldError } from '../../../src/core/capabilities.js';
import {
  validateNanoBananaProInput,
  validateImagen4UltraInput,
  validateVeo31ProInput,
  validateExtensionHop,
} from '../../../src/core/capabilities.js';
import { CapabilityError } from '../../../src/core/errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getFieldError(fn: () => void): ApiFieldError {
  try {
    fn();
    throw new Error('Expected function to throw but it did not');
  } catch (e) {
    expect(e).toBeInstanceOf(ApiFieldError);
    return e as ApiFieldError;
  }
}

// ---------------------------------------------------------------------------
// ApiFieldError class
// ---------------------------------------------------------------------------
describe('ApiFieldError', () => {
  it('extends CapabilityError and MediaForgeError', () => {
    const e = new ApiFieldError('myField', 'bad input');
    expect(e).toBeInstanceOf(ApiFieldError);
    expect(e).toBeInstanceOf(CapabilityError);
    expect(e instanceof Error).toBe(true);
  });

  it('exposes field as own property', () => {
    const e = new ApiFieldError('aspectRatio', 'invalid');
    expect(e.field).toBe('aspectRatio');
  });

  it('carries the message', () => {
    const e = new ApiFieldError('foo', 'something wrong');
    expect(e.message).toBe('something wrong');
  });
});

// ---------------------------------------------------------------------------
// validateNanoBananaProInput
// ---------------------------------------------------------------------------
describe('validateNanoBananaProInput', () => {
  it('passes with empty input', () => {
    expect(() => validateNanoBananaProInput({})).not.toThrow();
  });

  it('passes with valid aspectRatio', () => {
    expect(() => validateNanoBananaProInput({ aspectRatio: '16:9' })).not.toThrow();
  });

  it('rejects invalid aspectRatio — throws ApiFieldError with field=aspectRatio', () => {
    expect(() => validateNanoBananaProInput({ aspectRatio: '7:7' })).toThrowError(ApiFieldError);
    const err = getFieldError(() => validateNanoBananaProInput({ aspectRatio: '7:7' }));
    expect(err.field).toBe('aspectRatio');
  });

  it('passes all valid ASPECT_RATIO_NANO_BANANA values', () => {
    const valid = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
    for (const ar of valid) {
      expect(() => validateNanoBananaProInput({ aspectRatio: ar })).not.toThrow();
    }
  });

  it('passes with valid imageSize 4K', () => {
    expect(() => validateNanoBananaProInput({ imageSize: '4K' })).not.toThrow();
  });

  it('rejects invalid imageSize — field=imageSize', () => {
    const err = getFieldError(() => validateNanoBananaProInput({ imageSize: '8K' }));
    expect(err.field).toBe('imageSize');
  });

  it('passes with valid thinkingLevel MEDIUM', () => {
    expect(() => validateNanoBananaProInput({ thinkingLevel: 'MEDIUM' })).not.toThrow();
  });

  it('rejects invalid thinkingLevel — field=thinkingLevel', () => {
    const err = getFieldError(() => validateNanoBananaProInput({ thinkingLevel: 'ULTRA' }));
    expect(err.field).toBe('thinkingLevel');
  });

  it('passes with valid personGeneration ALLOW_NONE', () => {
    expect(() => validateNanoBananaProInput({ personGeneration: 'ALLOW_NONE' })).not.toThrow();
  });

  it('rejects lowercase personGeneration — field=personGeneration', () => {
    // PERSON_GENERATION_IMAGE is UPPERCASE; 'allow_all' is invalid here
    const err = getFieldError(() => validateNanoBananaProInput({ personGeneration: 'allow_all' }));
    expect(err.field).toBe('personGeneration');
  });

  it('passes with 14 referenceImages (at boundary)', () => {
    const refs = Array.from({ length: 14 }, (_, i) => ({ path: `/img${i}.png` }));
    expect(() => validateNanoBananaProInput({ referenceImages: refs })).not.toThrow();
  });

  it('rejects 15 referenceImages — field=referenceImages', () => {
    const refs = Array.from({ length: 15 }, (_, i) => ({ path: `/img${i}.png` }));
    const err = getFieldError(() => validateNanoBananaProInput({ referenceImages: refs }));
    expect(err.field).toBe('referenceImages');
  });

  it('rejects thinkingLevel + thinkingBudget combined — field=thinkingLevel', () => {
    const err = getFieldError(() =>
      validateNanoBananaProInput({ thinkingLevel: 'HIGH', thinkingBudget: 2048 }),
    );
    expect(err.field).toBe('thinkingLevel');
    expect(err.message).toContain('mutually exclusive');
  });

  it('passes thinkingLevel alone (no thinkingBudget)', () => {
    expect(() => validateNanoBananaProInput({ thinkingLevel: 'LOW' })).not.toThrow();
  });

  it('passes thinkingBudget alone (no thinkingLevel)', () => {
    expect(() => validateNanoBananaProInput({ thinkingBudget: 1024 })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// validateImagen4UltraInput
// ---------------------------------------------------------------------------
describe('validateImagen4UltraInput', () => {
  it('passes with empty input', () => {
    expect(() => validateImagen4UltraInput({})).not.toThrow();
  });

  it('passes valid aspectRatio 9:16', () => {
    expect(() => validateImagen4UltraInput({ aspectRatio: '9:16' })).not.toThrow();
  });

  it('rejects aspectRatio not in ASPECT_RATIO_IMAGEN — field=aspectRatio', () => {
    const err = getFieldError(() => validateImagen4UltraInput({ aspectRatio: '21:9' }));
    expect(err.field).toBe('aspectRatio');
  });

  it('passes imageSize 1K', () => {
    expect(() => validateImagen4UltraInput({ imageSize: '1K' })).not.toThrow();
  });

  it('passes imageSize 2K', () => {
    expect(() => validateImagen4UltraInput({ imageSize: '2K' })).not.toThrow();
  });

  it('rejects imageSize 4K (Ultra excludes 4K) — field=imageSize', () => {
    const err = getFieldError(() => validateImagen4UltraInput({ imageSize: '4K' }));
    expect(err.field).toBe('imageSize');
  });

  it('passes numberOfImages=1', () => {
    expect(() => validateImagen4UltraInput({ numberOfImages: 1 })).not.toThrow();
  });

  it('rejects numberOfImages=2 — field=numberOfImages', () => {
    const err = getFieldError(() => validateImagen4UltraInput({ numberOfImages: 2 }));
    expect(err.field).toBe('numberOfImages');
    expect(err.message).toContain('only 1 image');
  });

  it('passes valid personGeneration ALLOW_ADULT', () => {
    expect(() => validateImagen4UltraInput({ personGeneration: 'ALLOW_ADULT' })).not.toThrow();
  });

  it('rejects invalid personGeneration — field=personGeneration', () => {
    const err = getFieldError(() => validateImagen4UltraInput({ personGeneration: 'ALLOW_EVERYONE' }));
    expect(err.field).toBe('personGeneration');
  });
});

// ---------------------------------------------------------------------------
// validateVeo31ProInput
// ---------------------------------------------------------------------------
describe('validateVeo31ProInput', () => {
  it('passes minimal valid t2v input', () => {
    expect(() => validateVeo31ProInput({ mode: 't2v' })).not.toThrow();
  });

  it('passes valid aspectRatio 16:9', () => {
    expect(() => validateVeo31ProInput({ mode: 't2v', aspectRatio: '16:9' })).not.toThrow();
  });

  it('rejects invalid aspectRatio — field=aspectRatio', () => {
    const err = getFieldError(() => validateVeo31ProInput({ mode: 't2v', aspectRatio: '4:3' }));
    expect(err.field).toBe('aspectRatio');
  });

  it('passes valid durationSeconds 6', () => {
    expect(() => validateVeo31ProInput({ mode: 't2v', durationSeconds: 6 })).not.toThrow();
  });

  it('rejects invalid durationSeconds 5 — field=durationSeconds', () => {
    const err = getFieldError(() => validateVeo31ProInput({ mode: 't2v', durationSeconds: 5 }));
    expect(err.field).toBe('durationSeconds');
  });

  it('passes valid resolution 720p', () => {
    expect(() => validateVeo31ProInput({ mode: 't2v', resolution: '720p' })).not.toThrow();
  });

  it('rejects invalid resolution — field=resolution', () => {
    const err = getFieldError(() => validateVeo31ProInput({ mode: 't2v', resolution: '480p' }));
    expect(err.field).toBe('resolution');
  });

  it('rejects numberOfVideos=2 — field=numberOfVideos', () => {
    const err = getFieldError(() => validateVeo31ProInput({ mode: 't2v', numberOfVideos: 2 }));
    expect(err.field).toBe('numberOfVideos');
  });

  it('passes numberOfVideos=1', () => {
    expect(() => validateVeo31ProInput({ mode: 't2v', numberOfVideos: 1 })).not.toThrow();
  });

  it('rejects 4k resolution with durationSeconds=4 — field=durationSeconds', () => {
    const err = getFieldError(() =>
      validateVeo31ProInput({ mode: 't2v', resolution: '4k', durationSeconds: 4 }),
    );
    expect(err.field).toBe('durationSeconds');
    expect(err.message).toContain('4k resolution requires durationSeconds=8');
  });

  it('passes 4k resolution with durationSeconds=8', () => {
    expect(() =>
      validateVeo31ProInput({ mode: 't2v', resolution: '4k', durationSeconds: 8 }),
    ).not.toThrow();
  });

  it('rejects 1080p resolution with durationSeconds=6 — field=durationSeconds', () => {
    const err = getFieldError(() =>
      validateVeo31ProInput({ mode: 't2v', resolution: '1080p', durationSeconds: 6 }),
    );
    expect(err.field).toBe('durationSeconds');
    expect(err.message).toContain('1080p resolution requires durationSeconds=8');
  });

  it('passes 1080p resolution with durationSeconds=8', () => {
    expect(() =>
      validateVeo31ProInput({ mode: 't2v', resolution: '1080p', durationSeconds: 8 }),
    ).not.toThrow();
  });

  it('passes 3 referenceImages with valid ASSET type', () => {
    const refs = [
      { referenceType: 'ASSET' },
      { referenceType: 'ASSET' },
      { referenceType: 'ASSET' },
    ];
    expect(() => validateVeo31ProInput({ mode: 'references', referenceImages: refs })).not.toThrow();
  });

  it('rejects 4 referenceImages — field=referenceImages', () => {
    const refs = Array.from({ length: 4 }, () => ({ referenceType: 'ASSET' }));
    const err = getFieldError(() => validateVeo31ProInput({ mode: 'references', referenceImages: refs }));
    expect(err.field).toBe('referenceImages');
  });

  it('rejects referenceType !== ASSET — field contains referenceType', () => {
    const refs = [{ referenceType: 'STYLE' }];
    const err = getFieldError(() => validateVeo31ProInput({ mode: 'references', referenceImages: refs }));
    expect(err.field).toContain('referenceType');
    expect(err.message).toContain('Veo-2 only');
  });

  it('rejects firstFrameImage + referenceImages combined — field=referenceImages', () => {
    const err = getFieldError(() =>
      validateVeo31ProInput({
        mode: 'i2v',
        firstFrameImage: '/frame.jpg',
        referenceImages: [{ referenceType: 'ASSET' }],
      }),
    );
    expect(err.field).toBe('referenceImages');
    expect(err.message).toContain('mutually exclusive');
  });

  it('passes firstFrameImage with empty referenceImages', () => {
    expect(() =>
      validateVeo31ProInput({ mode: 'i2v', firstFrameImage: '/frame.jpg', referenceImages: [] }),
    ).not.toThrow();
  });

  it('rejects lastFrameImage without firstFrameImage — field=lastFrameImage', () => {
    const err = getFieldError(() =>
      validateVeo31ProInput({ mode: 'interpolate', lastFrameImage: '/last.jpg' }),
    );
    expect(err.field).toBe('lastFrameImage');
    expect(err.message).toContain('lastFrame requires firstFrame');
  });

  it('passes lastFrameImage with firstFrameImage', () => {
    expect(() =>
      validateVeo31ProInput({
        mode: 'interpolate',
        firstFrameImage: '/first.jpg',
        lastFrameImage: '/last.jpg',
      }),
    ).not.toThrow();
  });

  // personGeneration matrix
  it('passes personGeneration allow_all for mode t2v', () => {
    expect(() => validateVeo31ProInput({ mode: 't2v', personGeneration: 'allow_all' })).not.toThrow();
  });

  it('passes personGeneration allow_adult for mode t2v (spec allows it)', () => {
    expect(() =>
      validateVeo31ProInput({ mode: 't2v', personGeneration: 'allow_adult' }),
    ).not.toThrow();
  });

  it('passes personGeneration allow_all for mode extend', () => {
    expect(() =>
      validateVeo31ProInput({ mode: 'extend', personGeneration: 'allow_all' }),
    ).not.toThrow();
  });

  it('passes personGeneration allow_adult for mode i2v', () => {
    expect(() =>
      validateVeo31ProInput({ mode: 'i2v', personGeneration: 'allow_adult' }),
    ).not.toThrow();
  });

  it('rejects personGeneration allow_all for mode i2v — field=personGeneration', () => {
    const err = getFieldError(() =>
      validateVeo31ProInput({ mode: 'i2v', personGeneration: 'allow_all' }),
    );
    expect(err.field).toBe('personGeneration');
    expect(err.message).toContain("allow_adult");
  });

  it('rejects personGeneration allow_all for mode interpolate — field=personGeneration', () => {
    const err = getFieldError(() =>
      validateVeo31ProInput({ mode: 'interpolate', personGeneration: 'allow_all' }),
    );
    expect(err.field).toBe('personGeneration');
  });

  it('rejects personGeneration allow_all for mode references — field=personGeneration', () => {
    const err = getFieldError(() =>
      validateVeo31ProInput({ mode: 'references', personGeneration: 'allow_all' }),
    );
    expect(err.field).toBe('personGeneration');
  });

  it('rejects allow_all in restricted EU region — field=personGeneration', () => {
    const err = getFieldError(() =>
      validateVeo31ProInput({ mode: 't2v', region: 'EU', personGeneration: 'allow_all' }),
    );
    expect(err.field).toBe('personGeneration');
    expect(err.message).toContain('restricted region');
  });

  it('passes allow_adult in restricted EU region', () => {
    expect(() =>
      validateVeo31ProInput({ mode: 't2v', region: 'EU', personGeneration: 'allow_adult' }),
    ).not.toThrow();
  });

  it('passes allow_all in non-restricted region US', () => {
    expect(() =>
      validateVeo31ProInput({ mode: 't2v', region: 'US', personGeneration: 'allow_all' }),
    ).not.toThrow();
  });

  it('skips personGeneration matrix when personGeneration is not provided', () => {
    // i2v without personGeneration — no error
    expect(() => validateVeo31ProInput({ mode: 'i2v' })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// validateExtensionHop
// ---------------------------------------------------------------------------
describe('validateExtensionHop', () => {
  it('passes valid hop at index 0 with no optional fields', () => {
    expect(() => validateExtensionHop({ hopIndex: 0 })).not.toThrow();
  });

  it('passes valid hop at index 19 (boundary)', () => {
    expect(() => validateExtensionHop({ hopIndex: 19 })).not.toThrow();
  });

  it('rejects hopIndex 20 — field=hopIndex', () => {
    const err = getFieldError(() => validateExtensionHop({ hopIndex: 20 }));
    expect(err.field).toBe('hopIndex');
    expect(err.message).toContain('20 hops');
  });

  it('rejects negative hopIndex — field=hopIndex', () => {
    const err = getFieldError(() => validateExtensionHop({ hopIndex: -1 }));
    expect(err.field).toBe('hopIndex');
  });

  it('passes resolution 720p', () => {
    expect(() => validateExtensionHop({ hopIndex: 0, resolution: '720p' })).not.toThrow();
  });

  it('rejects resolution 1080p — field=resolution', () => {
    const err = getFieldError(() => validateExtensionHop({ hopIndex: 0, resolution: '1080p' }));
    expect(err.field).toBe('resolution');
    expect(err.message).toContain('720p only');
  });

  it('passes durationSeconds 7', () => {
    expect(() => validateExtensionHop({ hopIndex: 0, durationSeconds: 7 })).not.toThrow();
  });

  it('rejects durationSeconds 8 — field=durationSeconds', () => {
    const err = getFieldError(() => validateExtensionHop({ hopIndex: 0, durationSeconds: 8 }));
    expect(err.field).toBe('durationSeconds');
    expect(err.message).toContain('+7s');
  });

  it('all three fields valid passes', () => {
    expect(() =>
      validateExtensionHop({ hopIndex: 10, resolution: '720p', durationSeconds: 7 }),
    ).not.toThrow();
  });
});
