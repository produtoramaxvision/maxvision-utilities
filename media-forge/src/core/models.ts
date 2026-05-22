// LOCKED — top-tier only. No mid/low tier exposed.
export const IMAGE_MODEL_NANO_BANANA_PRO = 'gemini-3-pro-image-preview' as const;
export const IMAGE_MODEL_IMAGEN_4_ULTRA = 'imagen-4.0-ultra-generate-001' as const;
export const VIDEO_MODEL_VEO_3_1_PRO = 'veo-3.1-generate-preview' as const;

export const ALL_IMAGE_MODELS = [IMAGE_MODEL_NANO_BANANA_PRO, IMAGE_MODEL_IMAGEN_4_ULTRA] as const;
export const ALL_VIDEO_MODELS = [VIDEO_MODEL_VEO_3_1_PRO] as const;

export type ImageModel = (typeof ALL_IMAGE_MODELS)[number];
export type VideoModel = (typeof ALL_VIDEO_MODELS)[number];
export type AnyModel = ImageModel | VideoModel;

export const THINKING_LEVELS = ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'] as const; // UPPERCASE
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export const PERSON_GENERATION_IMAGE = ['ALLOW_ALL', 'ALLOW_ADULT', 'ALLOW_NONE'] as const; // UPPERCASE
export type PersonGenerationImage = (typeof PERSON_GENERATION_IMAGE)[number];

export const PERSON_GENERATION_VIDEO = ['allow_all', 'allow_adult'] as const; // lowercase
export type PersonGenerationVideo = (typeof PERSON_GENERATION_VIDEO)[number];

export const REFERENCE_TYPE_VIDEO = ['ASSET'] as const;
export type ReferenceTypeVideo = (typeof REFERENCE_TYPE_VIDEO)[number];

export const VIDEO_RESOLUTION = ['720p', '1080p', '4k'] as const; // '4k' lowercase
export type VideoResolution = (typeof VIDEO_RESOLUTION)[number];

export const IMAGE_SIZE = ['1K', '2K', '4K'] as const; // 'K' UPPERCASE
export type ImageSize = (typeof IMAGE_SIZE)[number];

export const ASPECT_RATIO_NANO_BANANA = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
] as const;
export type AspectRatioNanoBanana = (typeof ASPECT_RATIO_NANO_BANANA)[number];

export const ASPECT_RATIO_IMAGEN = ['1:1', '3:4', '4:3', '9:16', '16:9'] as const;
export type AspectRatioImagen = (typeof ASPECT_RATIO_IMAGEN)[number];

export const ASPECT_RATIO_VIDEO = ['16:9', '9:16'] as const;
export type AspectRatioVideo = (typeof ASPECT_RATIO_VIDEO)[number];

export const VIDEO_DURATION_SECONDS = [4, 6, 8] as const;
export type VideoDurationSeconds = (typeof VIDEO_DURATION_SECONDS)[number];
