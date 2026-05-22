import type { ImageConfig, GenerateContentConfig, Part } from '@google/genai';
import type { EditImageInputT } from './image-schemas.js';
import type { MediaForgeClient } from '../core/client.js';
import type { GenerateImageResult } from './nano-banana-pro.js';
import { ApiError, SafetyBlockError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { readBase64 } from '../utils/files.js';
import { mimeFromExt } from '../utils/mime.js';

export async function editImage(
  input: EditImageInputT,
  client: MediaForgeClient,
): Promise<GenerateImageResult> {
  // Build a mode-specific prompt prefix
  let promptText = input.prompt;
  if (input.editMode === 'outpaint') {
    promptText = `Outpaint/extend the image while maintaining continuity with the original. ${input.prompt}`;
  } else if (input.editMode === 'remove') {
    promptText = `Remove the specified element from the image. ${input.prompt}`;
  } else if (input.editMode === 'replace') {
    promptText = `Replace the specified element in the image. ${input.prompt}`;
  } else if (input.editMode === 'inpaint' && input.maskImage) {
    promptText = `${input.prompt} (mask shown in second image: white = edit region, black = preserve)`;
  }

  // Assemble the full generateContent payload before the dry-run guard so that
  // the dry-run rawPayload mirrors the production request shape exactly.
  // Under dry-run, skip fs I/O and use a placeholder instead.
  const sourceBase64 = client.dryRun ? '<base64-elided-dryrun>' : readBase64(input.sourceImage);
  const sourceMime = mimeFromExt(input.sourceImage);

  const contents: Part[] = [
    { text: promptText },
    { inlineData: { mimeType: sourceMime, data: sourceBase64 } },
  ];

  // Add mask for inpaint mode
  if (input.editMode === 'inpaint' && input.maskImage) {
    const maskBase64 = client.dryRun ? '<base64-elided-dryrun>' : readBase64(input.maskImage);
    const maskMime = mimeFromExt(input.maskImage);
    contents.push({ inlineData: { mimeType: maskMime, data: maskBase64 } });
  }

  const imageConfig: ImageConfig = {
    ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
    personGeneration: input.personGeneration,
  };

  const config: GenerateContentConfig & { imageConfig?: ImageConfig } = { imageConfig };

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

  logger.debug('editImage: calling SDK', { model: input.model, editMode: input.editMode });

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
    throw new ApiError('No candidate returned from editImage', 'API');
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
    throw new ApiError('No image in editImage response', 'API');
  }

  const inlineData = (inlinePart as { inlineData: { data: string; mimeType?: string } }).inlineData;

  logger.info('editImage: success', { model: input.model, editMode: input.editMode });

  return {
    base64: inlineData.data,
    mimeType: inlineData.mimeType ?? 'image/png',
    modelUsed: input.model,
    finishReason: fr,
  };
}
