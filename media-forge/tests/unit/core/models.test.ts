import { describe, it, expect } from 'vitest';
import {
  IMAGE_MODEL_NANO_BANANA_PRO,
  IMAGE_MODEL_IMAGEN_4_ULTRA,
  VIDEO_MODEL_VEO_3_1_PRO,
  ALL_IMAGE_MODELS,
  ALL_VIDEO_MODELS,
  PERSON_GENERATION_IMAGE,
  PERSON_GENERATION_VIDEO,
  IMAGE_SIZE,
  VIDEO_RESOLUTION,
  ASPECT_RATIO_NANO_BANANA,
  ASPECT_RATIO_IMAGEN,
  ASPECT_RATIO_VIDEO,
  THINKING_LEVELS,
  VIDEO_DURATION_SECONDS,
  REFERENCE_TYPE_VIDEO,
} from '../../../src/core/models.js';

describe('model IDs — regression guard against typos', () => {
  it('IMAGE_MODEL_NANO_BANANA_PRO is exact', () => {
    expect(IMAGE_MODEL_NANO_BANANA_PRO).toBe('gemini-3-pro-image-preview');
  });

  it('IMAGE_MODEL_IMAGEN_4_ULTRA is exact', () => {
    expect(IMAGE_MODEL_IMAGEN_4_ULTRA).toBe('imagen-4.0-ultra-generate-001');
  });

  it('VIDEO_MODEL_VEO_3_1_PRO is exact', () => {
    expect(VIDEO_MODEL_VEO_3_1_PRO).toBe('veo-3.1-generate-preview');
  });
});

describe('ALL_IMAGE_MODELS', () => {
  it('has length 2', () => {
    expect(ALL_IMAGE_MODELS.length).toBe(2);
  });

  it('contains IMAGE_MODEL_NANO_BANANA_PRO', () => {
    expect(ALL_IMAGE_MODELS).toContain(IMAGE_MODEL_NANO_BANANA_PRO);
  });

  it('contains IMAGE_MODEL_IMAGEN_4_ULTRA', () => {
    expect(ALL_IMAGE_MODELS).toContain(IMAGE_MODEL_IMAGEN_4_ULTRA);
  });
});

describe('ALL_VIDEO_MODELS', () => {
  it('has length 1', () => {
    expect(ALL_VIDEO_MODELS.length).toBe(1);
  });

  it('contains VIDEO_MODEL_VEO_3_1_PRO', () => {
    expect(ALL_VIDEO_MODELS).toContain(VIDEO_MODEL_VEO_3_1_PRO);
  });
});

describe('PERSON_GENERATION casing distinction', () => {
  it('PERSON_GENERATION_IMAGE[0] is ALLOW_ALL (UPPERCASE)', () => {
    expect(PERSON_GENERATION_IMAGE[0]).toBe('ALLOW_ALL');
  });

  it('PERSON_GENERATION_IMAGE contains ALLOW_ADULT and ALLOW_NONE', () => {
    expect(PERSON_GENERATION_IMAGE).toContain('ALLOW_ADULT');
    expect(PERSON_GENERATION_IMAGE).toContain('ALLOW_NONE');
  });

  it('PERSON_GENERATION_VIDEO[0] is allow_all (lowercase)', () => {
    expect(PERSON_GENERATION_VIDEO[0]).toBe('allow_all');
  });

  it('PERSON_GENERATION_VIDEO contains allow_adult (lowercase)', () => {
    expect(PERSON_GENERATION_VIDEO).toContain('allow_adult');
  });

  it('IMAGE and VIDEO person generation are distinct (UPPERCASE vs lowercase)', () => {
    expect(PERSON_GENERATION_IMAGE[0]).not.toBe(PERSON_GENERATION_VIDEO[0]);
  });
});

describe('IMAGE_SIZE vs VIDEO_RESOLUTION casing distinction', () => {
  it('IMAGE_SIZE[2] is 4K (UPPERCASE K)', () => {
    expect(IMAGE_SIZE[2]).toBe('4K');
  });

  it('VIDEO_RESOLUTION[2] is 4k (lowercase k)', () => {
    expect(VIDEO_RESOLUTION[2]).toBe('4k');
  });

  it('IMAGE_SIZE contains 1K, 2K, 4K', () => {
    expect(IMAGE_SIZE).toContain('1K');
    expect(IMAGE_SIZE).toContain('2K');
    expect(IMAGE_SIZE).toContain('4K');
  });

  it('VIDEO_RESOLUTION contains 720p, 1080p, 4k', () => {
    expect(VIDEO_RESOLUTION).toContain('720p');
    expect(VIDEO_RESOLUTION).toContain('1080p');
    expect(VIDEO_RESOLUTION).toContain('4k');
  });
});

describe('aspect ratio array lengths', () => {
  it('ASPECT_RATIO_NANO_BANANA has length 10', () => {
    expect(ASPECT_RATIO_NANO_BANANA.length).toBe(10);
  });

  it('ASPECT_RATIO_IMAGEN has length 5', () => {
    expect(ASPECT_RATIO_IMAGEN.length).toBe(5);
  });

  it('ASPECT_RATIO_VIDEO has length 2', () => {
    expect(ASPECT_RATIO_VIDEO.length).toBe(2);
  });
});

describe('THINKING_LEVELS', () => {
  it('are all UPPERCASE', () => {
    for (const level of THINKING_LEVELS) {
      expect(level).toBe(level.toUpperCase());
    }
  });

  it('contains MINIMAL, LOW, MEDIUM, HIGH', () => {
    expect(THINKING_LEVELS).toContain('MINIMAL');
    expect(THINKING_LEVELS).toContain('LOW');
    expect(THINKING_LEVELS).toContain('MEDIUM');
    expect(THINKING_LEVELS).toContain('HIGH');
  });
});

describe('VIDEO_DURATION_SECONDS', () => {
  it('contains numeric values 4, 6, 8', () => {
    expect(VIDEO_DURATION_SECONDS).toContain(4);
    expect(VIDEO_DURATION_SECONDS).toContain(6);
    expect(VIDEO_DURATION_SECONDS).toContain(8);
  });

  it('has length 3', () => {
    expect(VIDEO_DURATION_SECONDS.length).toBe(3);
  });
});

describe('REFERENCE_TYPE_VIDEO', () => {
  it('contains only ASSET', () => {
    expect(REFERENCE_TYPE_VIDEO).toContain('ASSET');
    expect(REFERENCE_TYPE_VIDEO.length).toBe(1);
  });
});
