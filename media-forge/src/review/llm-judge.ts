import Anthropic from '@anthropic-ai/sdk';
import type { ImageBlockParam } from '@anthropic-ai/sdk/resources/messages/messages.js';
import { z } from 'zod';
import { readBase64 } from '../utils/files.js';
import { mimeFromExt, isImageMime } from '../utils/mime.js';
import { ValidationError } from '../core/errors.js';
import { logger } from '../core/logger.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface JudgeInput {
  refinedSpec: Record<string, unknown>;
  assetPath: string;
  traceExcerpt: string;
  jobId: string;
}

export interface JudgeScores {
  adherence: number;
  quality: number;
  alignment: number;
  safety: number;
  overall: number;
}

export interface JudgeError {
  class:
    | 'text_typo'
    | 'brand_violation_color'
    | 'brand_violation_logo'
    | 'brand_violation_font'
    | 'semantic_object_wrong'
    | 'semantic_color_wrong'
    | 'composition_wrong'
    | 'temporal_drift'
    | 'safety_blocked'
    | 'lipsync_miss';
  severity: 'critical' | 'major' | 'minor';
  detail: string;
}

export interface JudgeVerdict {
  verdict: 'pass' | 'fail' | 'partial';
  scores: JudgeScores;
  rootCauseStage:
    | 'prompt-engineer'
    | 'product-photographer'
    | 'cinematic-director'
    | 'character-designer'
    | 'hyperrealistic-artist'
    | 'ad-designer'
    | 'enterprise-corrector'
    | 'scene-composer'
    | 'video-editor'
    | 'image-generator'
    | 'video-generator'
    | 'none';
  errors: JudgeError[];
  raw?: string;
}

export type JudgeMode = 'subagent' | 'sdk';

export interface JudgeDirective {
  mode: 'subagent';
  agentName: 'media-forge:quality-reviewer';
  payload: JudgeInput;
}

export interface LlmJudgeOpts {
  threshold?: number;
  forceMode?: JudgeMode;
  _anthropicClient?: Anthropic;
}

// ---------------------------------------------------------------------------
// Zod schemas for response parsing
// ---------------------------------------------------------------------------

const JudgeScoresSchema = z.object({
  adherence: z.number().min(0).max(10),
  quality: z.number().min(0).max(10),
  alignment: z.number().min(0).max(10),
  safety: z.number().min(0).max(10),
  overall: z.number().min(0).max(10),
});

const JudgeErrorSchema = z.object({
  class: z.enum([
    'text_typo',
    'brand_violation_color',
    'brand_violation_logo',
    'brand_violation_font',
    'semantic_object_wrong',
    'semantic_color_wrong',
    'composition_wrong',
    'temporal_drift',
    'safety_blocked',
    'lipsync_miss',
  ]),
  severity: z.enum(['critical', 'major', 'minor']),
  detail: z.string(),
});

const JudgeVerdictSchema = z.object({
  verdict: z.enum(['pass', 'fail', 'partial']),
  scores: JudgeScoresSchema,
  rootCauseStage: z.enum([
    'prompt-engineer',
    'product-photographer',
    'cinematic-director',
    'character-designer',
    'hyperrealistic-artist',
    'ad-designer',
    'enterprise-corrector',
    'scene-composer',
    'video-editor',
    'image-generator',
    'video-generator',
    'none',
  ]),
  errors: z.array(JudgeErrorSchema),
  raw: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildJudgePrompt(input: JudgeInput): string {
  return `You are a professional media quality reviewer for an AI content generation pipeline.
Your task is to evaluate the generated asset against the refined specification and provide a structured verdict.

## Refined Specification
${JSON.stringify(input.refinedSpec, null, 2)}

## Job ID
${input.jobId}

## Trace Excerpt (last pipeline stages)
${input.traceExcerpt}

## Instructions
Carefully evaluate the asset against the specification. Return ONLY a valid JSON object (no prose, no markdown fences) with this exact shape:

{
  "verdict": "pass" | "fail" | "partial",
  "scores": {
    "adherence": <0-10>,
    "quality": <0-10>,
    "alignment": <0-10>,
    "safety": <0-10>,
    "overall": <0-10>
  },
  "rootCauseStage": "<one of: prompt-engineer | product-photographer | cinematic-director | character-designer | hyperrealistic-artist | ad-designer | enterprise-corrector | scene-composer | video-editor | image-generator | video-generator | none>",
  "errors": [
    {
      "class": "<one of: text_typo | brand_violation_color | brand_violation_logo | brand_violation_font | semantic_object_wrong | semantic_color_wrong | composition_wrong | temporal_drift | safety_blocked | lipsync_miss>",
      "severity": "<critical | major | minor>",
      "detail": "<concise description>"
    }
  ]
}

Use empty array for errors if verdict is "pass".
rootCauseStage should be "none" if verdict is "pass".
overall score should reflect the weighted average of all dimensions.
verdict should be "pass" if overall >= 7.5, "fail" if overall < 6, "partial" otherwise.`;
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

function parseJudgeResponse(text: string): JudgeVerdict {
  // Extract first JSON object from response (handles code fences and prose wrapping)
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new ValidationError('LLM judge response contains no JSON object', {
      preview: text.slice(0, 200),
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch (err) {
    throw new ValidationError(
      `LLM judge response JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
      { preview: match[0].slice(0, 200) },
    );
  }

  try {
    const validated = JudgeVerdictSchema.parse(parsed);
    return { ...validated, raw: text };
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new ValidationError(
        `LLM judge response failed schema validation: ${err.message}`,
        { issues: err.issues },
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Allowed image media types for Anthropic SDK
// ---------------------------------------------------------------------------

type AnthropicImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

const ANTHROPIC_IMAGE_MIMES = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

function toAnthropicImageMediaType(mime: string): AnthropicImageMediaType | null {
  if (ANTHROPIC_IMAGE_MIMES.has(mime)) {
    return mime as AnthropicImageMediaType;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main judge function
// ---------------------------------------------------------------------------

export async function judgeAsset(
  input: JudgeInput,
  opts?: LlmJudgeOpts,
): Promise<JudgeVerdict | JudgeDirective> {
  const threshold =
    opts?.threshold ??
    (process.env['MEDIA_FORGE_REVIEW_THRESHOLD']
      ? parseFloat(process.env['MEDIA_FORGE_REVIEW_THRESHOLD'])
      : 7.5);

  const mode: JudgeMode =
    opts?.forceMode ?? (process.env['CLAUDE_CODE_SESSION_ID'] ? 'subagent' : 'sdk');

  logger.debug('judgeAsset: mode selected', { mode, jobId: input.jobId });

  // Subagent path — return directive for orchestrator to dispatch
  if (mode === 'subagent') {
    return {
      mode: 'subagent',
      agentName: 'media-forge:quality-reviewer',
      payload: input,
    };
  }

  // SDK path — call Claude Opus directly
  const anthropic =
    opts?._anthropicClient ?? new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });

  const promptText = buildJudgePrompt(input);

  // Build image block for vision if asset is an image
  const imageBlocks: ImageBlockParam[] = [];
  try {
    const mime = mimeFromExt(input.assetPath);
    if (isImageMime(mime)) {
      const mediaType = toAnthropicImageMediaType(mime);
      if (mediaType) {
        const data = readBase64(input.assetPath);
        imageBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType,
            data,
          },
        });
      }
    }
  } catch {
    // Unsupported extension or unreadable file — skip vision attachment
    logger.warn('judgeAsset: could not attach asset as image block', {
      assetPath: input.assetPath,
    });
  }

  logger.debug('judgeAsset: calling Anthropic SDK', {
    jobId: input.jobId,
    hasImage: imageBlocks.length > 0,
  });

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 8000,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: promptText },
          ...imageBlocks,
        ],
      },
    ],
  });

  const firstBlock = response.content[0];
  const text = firstBlock?.type === 'text' ? firstBlock.text : '';

  const verdict = parseJudgeResponse(text);

  // Enforce threshold
  if (verdict.scores.overall < threshold && verdict.verdict !== 'fail') {
    verdict.verdict = 'fail';
    logger.info('judgeAsset: verdict downgraded to fail (below threshold)', {
      overall: verdict.scores.overall,
      threshold,
    });
  }

  logger.info('judgeAsset: verdict', {
    jobId: input.jobId,
    verdict: verdict.verdict,
    overall: verdict.scores.overall,
  });

  return verdict;
}
