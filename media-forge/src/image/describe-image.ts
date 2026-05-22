import { z } from 'zod';
import type { Part } from '@google/genai';
import type { DescribeImageInputT } from './image-schemas.js';
import type { MediaForgeClient } from '../core/client.js';
import { ApiError, ValidationError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { readBase64 } from '../utils/files.js';
import { mimeFromExt } from '../utils/mime.js';

const DescriptionSchema = z.object({
  subject: z.string(),
  style: z.string(),
  lighting: z.string(),
  composition: z.string(),
  palette_hint: z.string(),
});

export type ImageDescription = z.infer<typeof DescriptionSchema>;

const DESCRIBE_PROMPT = `Analyze this image and return a JSON object with exactly these fields:
{
  "subject": "<main subject or scene>",
  "style": "<visual style, e.g. photorealistic, illustration, watercolor>",
  "lighting": "<lighting description, e.g. soft natural, hard studio, dramatic>",
  "composition": "<composition notes, e.g. rule-of-thirds, centered, portrait>",
  "palette_hint": "<dominant color as hex, e.g. #3A7BCC>"
}
Return only valid JSON, no markdown fences.`;

export async function describeImage(
  input: DescribeImageInputT,
  client: MediaForgeClient,
): Promise<ImageDescription> {
  // Dry-run shortcut
  if (client.dryRun) {
    return {
      subject: 'dry-run',
      style: 'dry-run',
      lighting: 'dry-run',
      composition: 'dry-run',
      palette_hint: '#000000',
    };
  }

  const imageBase64 = readBase64(input.imagePath);
  const mime = mimeFromExt(input.imagePath);

  const detailInstruction =
    input.detailLevel === 'brief'
      ? 'Be concise.'
      : input.detailLevel === 'technical'
        ? 'Include technical photography/design details.'
        : '';

  const contents: Part[] = [
    { text: `${DESCRIBE_PROMPT} ${detailInstruction}`.trim() },
    { inlineData: { mimeType: mime, data: imageBase64 } },
  ];

  logger.debug('describeImage: calling SDK', { model: input.model });

  const response = await client.ai.models.generateContent({
    model: input.model,
    contents,
    config: {
      responseMimeType: 'application/json',
    },
  });

  // Extract text from response
  const candidate = response.candidates?.[0];
  if (!candidate) {
    throw new ApiError('No candidate returned from describeImage', 'API');
  }

  const textPart = candidate.content?.parts?.find(
    (p) => 'text' in p && typeof (p as { text?: string }).text === 'string',
  );
  const rawText =
    (textPart as { text?: string } | undefined)?.text ??
    (response as { text?: string }).text ??
    '';

  if (!rawText) {
    throw new ApiError('No text content in describeImage response', 'API');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new ValidationError('describeImage response is not valid JSON', { raw: rawText });
  }

  const validated = DescriptionSchema.safeParse(parsed);
  if (!validated.success) {
    throw new ValidationError('describeImage JSON does not match expected schema', {
      issues: validated.error.issues,
    });
  }

  logger.info('describeImage: success', { model: input.model });

  return validated.data;
}
