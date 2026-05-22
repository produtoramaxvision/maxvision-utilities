import sharp from 'sharp';
import type { ImageConfig, GenerateContentConfig, Part, ThinkingConfig, ThinkingLevel } from '@google/genai';
import type { ComposeSceneInputT } from './image-schemas.js';
import type { MediaForgeClient } from '../core/client.js';
import type { GenerateImageResult } from './nano-banana-pro.js';
import { ApiError, SafetyBlockError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { fileSize } from '../utils/files.js';
import { mimeFromExt } from '../utils/mime.js';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_LONGEST_SIDE = 1920;
const MIN_SHORTEST_SIDE = 1024;

/** Lazily preprocess a reference image — resize/upscale/convert to sRGB only when needed. */
async function preprocessRef(refPath: string): Promise<Buffer> {
  const size = fileSize(refPath);
  const img = sharp(refPath);
  const meta = await img.metadata();

  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const isLarge = size > MAX_BYTES;
  const longestSide = Math.max(width, height);
  const shortestSide = Math.min(width, height);
  const needsResize = isLarge || longestSide > MAX_LONGEST_SIDE;
  const needsUpscale = shortestSide > 0 && shortestSide < MIN_SHORTEST_SIDE;
  const needsColorspace = meta.space !== 'srgb' && meta.space !== undefined;

  if (!needsResize && !needsUpscale && !needsColorspace) {
    // No processing needed — read raw bytes
    const fs = await import('node:fs');
    return fs.readFileSync(refPath);
  }

  let pipeline = sharp(refPath);
  if (needsResize) {
    pipeline = pipeline.resize(MAX_LONGEST_SIDE, MAX_LONGEST_SIDE, { fit: 'inside', withoutEnlargement: true });
  } else if (needsUpscale) {
    pipeline = pipeline.resize(MIN_SHORTEST_SIDE, MIN_SHORTEST_SIDE, { fit: 'outside', withoutEnlargement: false });
  }
  if (needsColorspace) {
    pipeline = pipeline.toColorspace('srgb');
  }
  return pipeline.toBuffer();
}

export async function composeScene(
  input: ComposeSceneInputT,
  client: MediaForgeClient,
): Promise<GenerateImageResult> {
  // Dry-run shortcut — do NOT call the SDK
  if (client.dryRun) {
    return {
      base64: '',
      mimeType: 'image/png',
      modelUsed: input.model,
      finishReason: 'DRY_RUN',
      dryRun: true,
      rawPayload: { model: input.model, prompt: input.prompt },
    };
  }

  // Build role-labeled prompt header
  const roleLines = input.referenceImages
    .map((ref, i) => `- [${i + 1}] ${ref.roleLabel ?? `reference ${i + 1}`}`)
    .join('\n');
  const promptText =
    `Compose a scene using the following reference images:\n${roleLines}\n\nComposition prompt: ${input.prompt}`;

  // Preprocess and encode reference images
  const refParts: Part[] = await Promise.all(
    input.referenceImages.map(async (ref) => {
      const bytes = await preprocessRef(ref.path);
      const mime = mimeFromExt(ref.path);
      return { inlineData: { mimeType: mime, data: bytes.toString('base64') } };
    }),
  );

  const contents: Part[] = [{ text: promptText }, ...refParts];

  const imageConfig: ImageConfig = {
    aspectRatio: input.aspectRatio,
    imageSize: input.imageSize,
    personGeneration: input.personGeneration,
  };

  const thinkingConfig: ThinkingConfig = {
    thinkingLevel: input.thinkingLevel as ThinkingLevel,
  };

  const config: GenerateContentConfig & { imageConfig?: ImageConfig } = {
    imageConfig,
    thinkingConfig,
  };

  logger.debug('composeScene: calling SDK', {
    model: input.model,
    refCount: refParts.length,
  });

  const response = await client.ai.models.generateContent({
    model: input.model,
    contents,
    config,
  });

  // Prompt-level block
  if (response.promptFeedback?.blockReason) {
    throw new SafetyBlockError(
      `Prompt blocked: ${String(response.promptFeedback.blockReason)}`,
      {
        suggested_rephrasing: true,
        blockReason: String(response.promptFeedback.blockReason),
      },
    );
  }

  const candidate = response.candidates?.[0];
  if (!candidate) {
    throw new ApiError('No candidate returned from composeScene', 'API');
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

  const inlinePart = candidate.content?.parts?.find(
    (p) => 'inlineData' in p && (p as { inlineData?: { data?: string } }).inlineData?.data,
  );
  if (
    !inlinePart ||
    !('inlineData' in inlinePart) ||
    !(inlinePart as { inlineData?: { data?: string } }).inlineData?.data
  ) {
    throw new ApiError('No image in composeScene response', 'API');
  }

  const inlineData = (inlinePart as { inlineData: { data: string; mimeType?: string } }).inlineData;

  logger.info('composeScene: success', { model: input.model, refCount: refParts.length });

  return {
    base64: inlineData.data,
    mimeType: inlineData.mimeType ?? 'image/png',
    modelUsed: input.model,
    finishReason: fr,
  };
}
