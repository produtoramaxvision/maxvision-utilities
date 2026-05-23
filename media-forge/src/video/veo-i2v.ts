import { ApiError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import type { MediaForgeClient } from '../core/client.js';
import { readBase64 } from '../utils/files.js';
import { mimeFromExt } from '../utils/mime.js';
import type { GenerateVideoI2VInputT } from './video-schemas.js';
import type { GenerateVideoResult } from './veo-t2v.js';

export async function generateVideoI2V(
  input: GenerateVideoI2VInputT,
  client: MediaForgeClient,
): Promise<GenerateVideoResult> {
  if (client.dryRun) {
    return {
      operationName: 'dry-run-op',
      modelUsed: input.model,
      dryRun: true,
      rawPayload: {
        model: input.model,
        prompt: input.prompt,
        firstFrameImage: input.firstFrameImage,
      },
    };
  }

  const firstFrameB64 = readBase64(input.firstFrameImage);
  const firstFrameMime = mimeFromExt(input.firstFrameImage);

  if (client.mode === 'gemini') {
    logger.debug('Gemini Developer API mode: stripped Vertex-only fields from payload', {
      service: 'veo-i2v',
      stripped: ['personGeneration', 'generateAudio'],
    });
  }

  const operation = await client.ai.models.generateVideos({
    model: input.model,
    prompt: input.prompt,
    image: { imageBytes: firstFrameB64, mimeType: firstFrameMime },
    config: {
      aspectRatio: input.aspectRatio,
      durationSeconds: input.durationSeconds,
      resolution: input.resolution,
      numberOfVideos: 1,
      ...(client.mode === 'vertex' ? { personGeneration: input.personGeneration } : {}),
      ...(client.mode === 'vertex' ? { generateAudio: input.generateAudio ?? true } : {}),
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
      ...(input.negativePrompt ? { negativePrompt: input.negativePrompt } : {}),
    },
  });

  if (!operation.name) {
    throw new ApiError('Veo I2V generateVideos returned operation with no name', 'API');
  }

  logger.info('Veo I2V: operation initiated', { name: operation.name, model: input.model });

  return {
    operationName: operation.name,
    modelUsed: input.model,
  };
}
