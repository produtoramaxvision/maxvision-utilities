import type { ImageConfig, ThinkingConfig, GenerateContentConfig, ThinkingLevel } from '@google/genai';
import type { NanoBananaProInputT } from './image-schemas.js';
import type { MediaForgeClient } from '../core/client.js';
import { ApiError, SafetyBlockError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { readBase64 } from '../utils/files.js';
import { mimeFromExt } from '../utils/mime.js';

export interface GenerateImageResult {
  base64: string;
  mimeType: string;
  modelUsed: string;
  finishReason: string | undefined;
  thoughtSummary?: string;
  dryRun?: boolean;
  rawPayload?: unknown;
}

export async function generateImageNanoBananaPro(
  input: NanoBananaProInputT,
  client: MediaForgeClient,
): Promise<GenerateImageResult> {
  // Always assemble the real payload first so dry-run mirrors production.
  const refParts = client.dryRun
    ? input.referenceImages.map((ref) => ({
        inlineData: { mimeType: mimeFromExt(ref.path), data: '<base64-elided-dryrun>' },
      }))
    : await Promise.all(
        input.referenceImages.map(async (ref) => ({
          inlineData: {
            mimeType: mimeFromExt(ref.path),
            data: await readBase64(ref.path),
          },
        })),
      );

  const contents = [{ text: input.prompt }, ...refParts];

  const imageConfig: ImageConfig = {
    aspectRatio: input.aspectRatio,
    imageSize: input.imageSize,
    ...(client.mode === 'vertex' ? { personGeneration: input.personGeneration } : {}),
  };

  if (client.mode === 'gemini') {
    logger.debug('Gemini Developer API mode: stripped Vertex-only fields from payload', {
      service: 'nano-banana-pro',
      stripped: ['personGeneration'],
    });
  }

  const thinkingConfig: ThinkingConfig = {
    ...(input.thinkingLevel !== undefined
      ? { thinkingLevel: input.thinkingLevel as ThinkingLevel }
      : {}),
    ...(input.thinkingBudget !== undefined ? { thinkingBudget: input.thinkingBudget } : {}),
  };

  const config: GenerateContentConfig & { imageConfig?: ImageConfig } = {
    imageConfig,
    thinkingConfig,
    ...(input.useGoogleSearch ? { tools: [{ googleSearch: {} }] } : {}),
  };

  if (client.dryRun) {
    return {
      base64: '',
      mimeType: 'image/png',
      modelUsed: input.model,
      finishReason: 'DRY_RUN',
      dryRun: true,
      rawPayload: { model: input.model, contents, config },
    };
  }

  logger.debug('generateImageNanoBananaPro: calling SDK', {
    model: input.model,
    refCount: refParts.length,
  });

  const response = await client.ai.models.generateContent({
    model: input.model,
    contents,
    config,
  });

  // 1. Prompt-level block
  if (response.promptFeedback?.blockReason) {
    throw new SafetyBlockError(
      `Prompt blocked: ${String(response.promptFeedback.blockReason)}`,
      {
        suggested_rephrasing: true,
        blockReason: String(response.promptFeedback.blockReason),
      },
    );
  }

  // 2. Candidate-level safety
  const candidate = response.candidates?.[0];
  if (!candidate) {
    throw new ApiError('No candidate returned from Nano Banana Pro', 'API');
  }

  const fr = candidate.finishReason ? String(candidate.finishReason) : undefined;
  if (fr && fr !== 'STOP' && fr !== 'FINISH_REASON_UNSPECIFIED') {
    if (['SAFETY', 'IMAGE_SAFETY', 'PROHIBITED_CONTENT'].includes(fr)) {
      throw new SafetyBlockError(`Generation stopped: ${fr}`, {
        suggested_rephrasing: true,
        finishReason: fr,
      });
    }
    throw new ApiError(`Generation stopped: ${fr}`, 'API');
  }

  // 3. Image extraction
  const inlinePart = candidate.content?.parts?.find(
    (p) => 'inlineData' in p && (p as { inlineData?: { data?: string } }).inlineData?.data,
  );
  if (
    !inlinePart ||
    !('inlineData' in inlinePart) ||
    !(inlinePart as { inlineData?: { data?: string } }).inlineData?.data
  ) {
    throw new ApiError('No image in Nano Banana Pro response', 'API');
  }

  const inlineData = (inlinePart as { inlineData: { data: string; mimeType?: string } }).inlineData;

  const hasThought = candidate.content?.parts?.some(
    (p) => 'thought' in p && (p as { thought?: boolean }).thought,
  );

  logger.info('generateImageNanoBananaPro: success', { model: input.model, finishReason: fr });

  return {
    base64: inlineData.data,
    mimeType: inlineData.mimeType ?? 'image/png',
    modelUsed: input.model,
    finishReason: fr,
    ...(hasThought ? { thoughtSummary: '...' } : {}),
  };
}
