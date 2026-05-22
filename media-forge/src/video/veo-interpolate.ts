import { ApiError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import type { MediaForgeClient } from '../core/client.js';
import { readBase64 } from '../utils/files.js';
import { mimeFromExt } from '../utils/mime.js';
import type { GenerateVideoInterpolateInputT } from './video-schemas.js';
import type { GenerateVideoResult } from './veo-t2v.js';

export async function generateVideoInterpolate(
  input: GenerateVideoInterpolateInputT,
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
        lastFrameImage: input.lastFrameImage,
      },
    };
  }

  const firstB64 = readBase64(input.firstFrameImage);
  const lastB64 = readBase64(input.lastFrameImage);

  if (client.mode === 'gemini') {
    logger.debug('Gemini Developer API mode: stripped Vertex-only fields from payload', {
      service: 'veo-interpolate',
      stripped: ['personGeneration', 'generateAudio'],
    });
  }

  const operation = await client.ai.models.generateVideos({
    model: input.model,
    prompt: input.prompt,
    image: { imageBytes: firstB64, mimeType: mimeFromExt(input.firstFrameImage) },
    config: {
      lastFrame: { imageBytes: lastB64, mimeType: mimeFromExt(input.lastFrameImage) },
      aspectRatio: input.aspectRatio,
      durationSeconds: input.durationSeconds,
      resolution: input.resolution,
      numberOfVideos: 1,
      ...(client.mode === 'vertex' ? { personGeneration: input.personGeneration } : {}),
      ...(client.mode === 'vertex' ? { generateAudio: input.generateAudio ?? true } : {}),
    },
  });

  if (!operation.name) {
    throw new ApiError('Veo Interpolate generateVideos returned operation with no name', 'API');
  }

  logger.info('Veo Interpolate: operation initiated', { name: operation.name, model: input.model });

  return {
    operationName: operation.name,
    modelUsed: input.model,
  };
}
