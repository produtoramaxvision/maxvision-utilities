import { ApiError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import type { MediaForgeClient } from '../core/client.js';
import type { GenerateVideoT2VInputT } from './video-schemas.js';

export interface GenerateVideoResult {
  operationName: string;
  modelUsed: string;
  dryRun?: boolean;
  rawPayload?: unknown;
}

export async function generateVideoT2V(
  input: GenerateVideoT2VInputT,
  client: MediaForgeClient,
): Promise<GenerateVideoResult> {
  const config = {
    aspectRatio: input.aspectRatio,
    durationSeconds: input.durationSeconds,
    resolution: input.resolution,
    numberOfVideos: 1,
    ...(client.mode === 'vertex' ? { personGeneration: input.personGeneration } : {}),
    ...(client.mode === 'vertex' ? { generateAudio: input.generateAudio ?? true } : {}),
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
    ...(input.negativePrompt ? { negativePrompt: input.negativePrompt } : {}),
  };

  if (client.mode === 'gemini') {
    logger.debug('Gemini Developer API mode: stripped Vertex-only fields from payload', {
      service: 'veo-t2v',
      stripped: ['personGeneration', 'generateAudio'],
    });
  }

  if (client.dryRun) {
    return {
      operationName: 'dry-run-op',
      modelUsed: input.model,
      dryRun: true,
      rawPayload: { model: input.model, prompt: input.prompt, config },
    };
  }

  const operation = await client.ai.models.generateVideos({
    model: input.model,
    prompt: input.prompt,
    config,
  });

  if (!operation.name) {
    throw new ApiError('Veo generateVideos returned operation with no name', 'API');
  }

  logger.info('Veo T2V: operation initiated', { name: operation.name, model: input.model });

  return {
    operationName: operation.name,
    modelUsed: input.model,
  };
}
