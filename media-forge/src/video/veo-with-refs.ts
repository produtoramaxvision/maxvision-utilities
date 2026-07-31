import { VideoGenerationReferenceType } from '@google/genai';
import { ApiError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import type { MediaForgeClient } from '../core/client.js';
import { readBase64 } from '../utils/files.js';
import { mimeFromExt } from '../utils/mime.js';
import type { GenerateVideoWithRefsInputT } from './video-schemas.js';
import type { GenerateVideoResult } from './veo-t2v.js';
import { assertPromptWithinBudget, VEO_ENHANCE_PROMPT_DEFAULT } from '../core/prompt-budget.js';

export async function generateVideoWithRefs(
  input: GenerateVideoWithRefsInputT,
  client: MediaForgeClient,
): Promise<GenerateVideoResult> {
  assertPromptWithinBudget({ provider: 'google', prompt: input.prompt, field: 'prompt' });
  if (input.negativePrompt) {
    assertPromptWithinBudget({
      provider: 'google',
      prompt: input.negativePrompt,
      kind: 'negativePrompt',
      field: 'negativePrompt',
    });
  }
  if (client.dryRun) {
    return {
      operationName: 'dry-run-op',
      modelUsed: input.model,
      dryRun: true,
      rawPayload: {
        model: input.model,
        prompt: input.prompt,
        referenceImages: input.referenceImages.map((r) => r.path),
      },
    };
  }

  const refs = await Promise.all(
    input.referenceImages.map(async (ref) => ({
      image: { imageBytes: readBase64(ref.path), mimeType: mimeFromExt(ref.path) },
      referenceType: VideoGenerationReferenceType.ASSET,
    })),
  );

  if (client.mode === 'gemini') {
    logger.debug('Gemini Developer API mode: stripped Vertex-only fields from payload', {
      service: 'veo-with-refs',
      stripped: ['personGeneration', 'generateAudio'],
    });
  }

  const operation = await client.ai.models.generateVideos({
    model: input.model,
    prompt: input.prompt,
    config: {
      referenceImages: refs,
      aspectRatio: input.aspectRatio,
      durationSeconds: input.durationSeconds,
      resolution: input.resolution,
      numberOfVideos: 1,
      enhancePrompt: VEO_ENHANCE_PROMPT_DEFAULT,
      ...(client.mode === 'vertex' ? { personGeneration: input.personGeneration } : {}),
      ...(client.mode === 'vertex' ? { generateAudio: input.generateAudio ?? true } : {}),
      ...(input.negativePrompt ? { negativePrompt: input.negativePrompt } : {}),
    },
  });

  if (!operation.name) {
    throw new ApiError('Veo WithRefs generateVideos returned operation with no name', 'API');
  }

  logger.info('Veo WithRefs: operation initiated', { name: operation.name, model: input.model });

  return {
    operationName: operation.name,
    modelUsed: input.model,
  };
}
