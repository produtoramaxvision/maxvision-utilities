import { ApiFieldError } from './errors.js';
import {
  ASPECT_RATIO_NANO_BANANA,
  ASPECT_RATIO_IMAGEN,
  ASPECT_RATIO_VIDEO,
  IMAGE_SIZE,
  THINKING_LEVELS,
  PERSON_GENERATION_IMAGE,
  PERSON_GENERATION_VIDEO,
  VIDEO_RESOLUTION,
  VIDEO_DURATION_SECONDS,
} from './models.js';

export { ApiFieldError };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertEnum<T extends string>(
  value: string,
  allowed: readonly T[],
  field: string,
  label: string,
): void {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new ApiFieldError(field, `${field} '${value}' is not a valid ${label}`);
  }
}

// ---------------------------------------------------------------------------
// validateNanoBananaProInput
// ---------------------------------------------------------------------------

export function validateNanoBananaProInput(input: {
  aspectRatio?: string;
  imageSize?: string;
  thinkingLevel?: string;
  thinkingBudget?: number;
  personGeneration?: string;
  referenceImages?: ReadonlyArray<{ path: string; roleLabel?: string }>;
  useGoogleSearch?: boolean;
}): void {
  if (input.aspectRatio !== undefined) {
    assertEnum(input.aspectRatio, ASPECT_RATIO_NANO_BANANA, 'aspectRatio', 'aspect ratio for Nano Banana Pro');
  }

  if (input.imageSize !== undefined) {
    assertEnum(input.imageSize, IMAGE_SIZE, 'imageSize', 'image size');
  }

  if (input.thinkingLevel !== undefined) {
    assertEnum(input.thinkingLevel, THINKING_LEVELS, 'thinkingLevel', 'thinking level');
  }

  if (input.personGeneration !== undefined) {
    assertEnum(input.personGeneration, PERSON_GENERATION_IMAGE, 'personGeneration', 'person generation');
  }

  if (input.referenceImages !== undefined && input.referenceImages.length > 14) {
    throw new ApiFieldError('referenceImages', 'max 14 references on Nano Banana Pro');
  }

  if (input.thinkingLevel !== undefined && input.thinkingBudget !== undefined) {
    throw new ApiFieldError('thinkingLevel', 'thinkingLevel and thinkingBudget are mutually exclusive');
  }
}

// ---------------------------------------------------------------------------
// validateImagen4UltraInput
// ---------------------------------------------------------------------------

export function validateImagen4UltraInput(input: {
  aspectRatio?: string;
  imageSize?: string;
  numberOfImages?: number;
  personGeneration?: string;
}): void {
  if (input.aspectRatio !== undefined) {
    assertEnum(input.aspectRatio, ASPECT_RATIO_IMAGEN, 'aspectRatio', 'aspect ratio for Imagen 4 Ultra');
  }

  if (input.imageSize !== undefined) {
    // Ultra excludes 4K — only '1K' and '2K' allowed
    const ultraSizes = ['1K', '2K'] as const;
    if (!(ultraSizes as readonly string[]).includes(input.imageSize)) {
      throw new ApiFieldError('imageSize', `imageSize '${input.imageSize}' is not valid for Imagen 4 Ultra (allowed: 1K, 2K)`);
    }
  }

  if (input.numberOfImages !== undefined && input.numberOfImages !== 1) {
    throw new ApiFieldError('numberOfImages', 'Imagen 4 Ultra supports only 1 image per request');
  }

  if (input.personGeneration !== undefined) {
    assertEnum(input.personGeneration, PERSON_GENERATION_IMAGE, 'personGeneration', 'person generation');
  }
}

// ---------------------------------------------------------------------------
// validateVeo31ProInput
// ---------------------------------------------------------------------------

export type VeoMode = 't2v' | 'i2v' | 'interpolate' | 'references' | 'extend';

const RESTRICTED_REGIONS = ['EU', 'UK', 'CH', 'MENA'] as const;

export function validateVeo31ProInput(input: {
  mode: VeoMode;
  aspectRatio?: string;
  durationSeconds?: number;
  resolution?: string;
  numberOfVideos?: number;
  personGeneration?: string;
  referenceImages?: ReadonlyArray<{ referenceType: string }>;
  firstFrameImage?: string;
  lastFrameImage?: string;
  region?: string;
}): void {
  if (input.aspectRatio !== undefined) {
    assertEnum(input.aspectRatio, ASPECT_RATIO_VIDEO, 'aspectRatio', 'aspect ratio for Veo 3.1 Pro');
  }

  if (input.durationSeconds !== undefined) {
    if (!(VIDEO_DURATION_SECONDS as readonly number[]).includes(input.durationSeconds)) {
      throw new ApiFieldError('durationSeconds', `durationSeconds ${input.durationSeconds} is not valid (allowed: 4, 6, 8)`);
    }
  }

  if (input.resolution !== undefined) {
    assertEnum(input.resolution, VIDEO_RESOLUTION, 'resolution', 'video resolution');
  }

  if (input.numberOfVideos !== undefined && input.numberOfVideos !== 1) {
    throw new ApiFieldError('numberOfVideos', 'numberOfVideos must be 1');
  }

  // Resolution/duration cross-constraints
  if (input.resolution === '4k') {
    if (input.durationSeconds !== undefined && input.durationSeconds !== 8) {
      throw new ApiFieldError('durationSeconds', '4k resolution requires durationSeconds=8');
    }
  }

  if (input.resolution === '1080p') {
    if (input.durationSeconds !== undefined && input.durationSeconds !== 8) {
      throw new ApiFieldError('durationSeconds', '1080p resolution requires durationSeconds=8');
    }
  }

  // Reference images validation
  if (input.referenceImages !== undefined) {
    if (input.referenceImages.length > 3) {
      throw new ApiFieldError('referenceImages', 'max 3 reference images on Veo 3.1 Pro');
    }

    for (const ref of input.referenceImages) {
      if (ref.referenceType !== 'ASSET') {
        throw new ApiFieldError(
          'referenceImages[i].referenceType',
          `referenceType '${ref.referenceType}' is not valid (Style references are Veo-2 only; use ASSET)`,
        );
      }
    }
  }

  // firstFrame / referenceImages mutual exclusion
  if (input.firstFrameImage !== undefined && input.referenceImages !== undefined && input.referenceImages.length > 0) {
    throw new ApiFieldError('referenceImages', 'firstFrame and referenceImages are mutually exclusive');
  }

  // lastFrame requires firstFrame
  if (input.lastFrameImage !== undefined && input.firstFrameImage === undefined) {
    throw new ApiFieldError('lastFrameImage', 'lastFrame requires firstFrame');
  }

  // personGeneration matrix
  if (input.personGeneration !== undefined) {
    assertEnum(input.personGeneration, PERSON_GENERATION_VIDEO, 'personGeneration', 'person generation for video');

    const pg = input.personGeneration;
    const mode = input.mode;

    if (mode === 't2v' || mode === 'extend') {
      // accept 'allow_all' or 'allow_adult'; reject others (already handled by assertEnum above)
      // both values are valid for t2v/extend — no further constraint
    } else if (mode === 'i2v' || mode === 'interpolate' || mode === 'references') {
      if (pg !== 'allow_adult') {
        throw new ApiFieldError(
          'personGeneration',
          `personGeneration must be 'allow_adult' for mode '${mode}'`,
        );
      }
    }
  }

  // Restricted region check
  if (
    input.region !== undefined &&
    (RESTRICTED_REGIONS as readonly string[]).includes(input.region) &&
    input.personGeneration === 'allow_all'
  ) {
    throw new ApiFieldError('personGeneration', 'restricted region forces allow_adult');
  }
}

// ---------------------------------------------------------------------------
// validateExtensionHop
// ---------------------------------------------------------------------------

export function validateExtensionHop(input: {
  resolution?: string;
  durationSeconds?: number;
  hopIndex: number;
}): void {
  if (input.resolution !== undefined && input.resolution !== '720p') {
    throw new ApiFieldError('resolution', 'extension hops are 720p only');
  }

  if (input.durationSeconds !== undefined && input.durationSeconds !== 7) {
    throw new ApiFieldError('durationSeconds', 'each extension hop = +7s');
  }

  if (input.hopIndex < 0 || input.hopIndex > 19) {
    throw new ApiFieldError('hopIndex', 'extension allows up to 20 hops (148s total)');
  }
}
