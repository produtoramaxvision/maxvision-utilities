import { ApiError, ValidationError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import type { MediaForgeClient } from '../core/client.js';
import { VIDEO_MODEL_VEO_3_1_PRO } from '../core/models.js';
import type { GenerateVideoResult } from './veo-t2v.js';

export interface ExtendResult extends GenerateVideoResult {
  hopIndex: number;
  forcedResolution: '720p';
}

export interface ExtendOpts {
  client: MediaForgeClient;
  sourceVideoUri: string;
  sourceMimeType: string;
  originalPrompt: string;
  extensionDirective: string;
  hopIndex: number;
}

export function buildExtensionPrompt(original: string, directive: string): string {
  return `${original}\n\nContinuation: ${directive}\nKeep the same color palette, subject, and tone.`;
}

export async function extendVideo(opts: ExtendOpts): Promise<ExtendResult> {
  if (opts.hopIndex < 0 || opts.hopIndex > 19) {
    throw new ValidationError('Veo extension max 20 hops (hopIndex 0..19)');
  }

  const prompt = buildExtensionPrompt(opts.originalPrompt, opts.extensionDirective);

  if (opts.client.dryRun) {
    return {
      operationName: 'dry-run-op',
      modelUsed: VIDEO_MODEL_VEO_3_1_PRO,
      dryRun: true,
      rawPayload: {
        model: VIDEO_MODEL_VEO_3_1_PRO,
        prompt,
        sourceVideoUri: opts.sourceVideoUri,
        hopIndex: opts.hopIndex,
      },
      hopIndex: opts.hopIndex,
      forcedResolution: '720p',
    };
  }

  const operation = await opts.client.ai.models.generateVideos({
    model: VIDEO_MODEL_VEO_3_1_PRO,
    prompt,
    video: { uri: opts.sourceVideoUri, mimeType: opts.sourceMimeType } as never,
    config: {
      resolution: '720p',
      durationSeconds: 7,
      numberOfVideos: 1,
    },
  });

  if (!operation.name) {
    throw new ApiError('Veo extension generateVideos returned operation with no name', 'API');
  }

  logger.info('Veo Extend: operation initiated', {
    name: operation.name,
    hopIndex: opts.hopIndex,
  });

  return {
    operationName: operation.name,
    modelUsed: VIDEO_MODEL_VEO_3_1_PRO,
    hopIndex: opts.hopIndex,
    forcedResolution: '720p',
  };
}
