import type { GenerateImagesConfig, PersonGeneration, SafetyFilterLevel } from '@google/genai';
import type { Imagen4UltraInputT } from './image-schemas.js';
import type { MediaForgeClient } from '../core/client.js';
import type { GenerateImageResult } from './nano-banana-pro.js';
import { ApiError, SafetyBlockError } from '../core/errors.js';
import { logger } from '../core/logger.js';

// DEBT-006 (RESOLVED): @google/genai 2.6.0 public types.d.ts (line 4930+) does
// not expose `imageSize` on GenerateImagesConfig, but the SDK runtime DOES
// process it — it maps `imageSize` → `parameters.sampleImageSize` (the actual
// Imagen API parameter name) at dist/cjs/server/...:10597-10599 (Gemini API
// path) and :10686-10688 (Vertex path). This local intersection type lets us
// forward the field with type safety; remove when upstream types catch up.
// Imagen 4 Ultra's maximum is 2K (2048×2048 native) BY DESIGN; for 4K, the
// caller should route to Nano Banana Pro (gemini-3-pro-image-preview).
type ImagenConfigWithSize = GenerateImagesConfig & { imageSize?: '1K' | '2K' };

export async function generateImageImagen4Ultra(
  input: Imagen4UltraInputT,
  client: MediaForgeClient,
): Promise<GenerateImageResult> {
  // Map PERSON_GENERATION_IMAGE 'ALLOW_NONE' → SDK enum 'DONT_ALLOW' (Vertex only).
  const sdkPersonGeneration =
    input.personGeneration === 'ALLOW_NONE' ? 'DONT_ALLOW' : input.personGeneration;

  // Assemble the full generateImages config before the dry-run guard so the
  // dry-run rawPayload mirrors the production request shape exactly.
  const config: ImagenConfigWithSize = {
    numberOfImages: 1,
    aspectRatio: input.aspectRatio,
    imageSize: input.imageSize,
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
    ...(input.negativePrompt ? { negativePrompt: input.negativePrompt } : {}),
    ...(client.mode === 'vertex' ? { personGeneration: sdkPersonGeneration as PersonGeneration } : {}),
    safetyFilterLevel: 'BLOCK_MEDIUM_AND_ABOVE' as SafetyFilterLevel,
    outputMimeType: 'image/png',
    includeRaiReason: true,
  };

  if (client.mode === 'gemini') {
    logger.debug('Gemini Developer API mode: stripped Vertex-only fields from payload', {
      service: 'imagen-4-ultra',
      stripped: ['personGeneration'],
    });
  }

  if (client.dryRun) {
    return {
      base64: '',
      mimeType: 'image/png',
      modelUsed: input.model,
      finishReason: 'DRY_RUN',
      dryRun: true,
      rawPayload: { model: input.model, prompt: input.prompt, config },
    };
  }

  const response = await client.ai.models.generateImages({
    model: input.model,
    prompt: input.prompt,
    config,
  });

  const img = response.generatedImages?.[0];
  if (!img) {
    throw new ApiError('No generated images returned by Imagen 4 Ultra', 'API');
  }

  if ((img as { raiFilteredReason?: string }).raiFilteredReason) {
    const reason = (img as { raiFilteredReason: string }).raiFilteredReason;
    throw new SafetyBlockError(`Imagen filtered: ${reason}`, {
      suggested_rephrasing: true,
      blockReason: reason,
    });
  }

  const imageData = (img as { image?: { imageBytes?: string; mimeType?: string } }).image;
  const bytes = imageData?.imageBytes;
  if (!bytes) {
    throw new ApiError('Imagen response had no imageBytes', 'API');
  }

  logger.info('generateImageImagen4Ultra: success', { model: input.model });

  return {
    base64: bytes,
    mimeType: imageData?.mimeType ?? 'image/png',
    modelUsed: input.model,
    finishReason: undefined,
  };
}
