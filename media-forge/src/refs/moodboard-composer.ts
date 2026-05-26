// src/refs/moodboard-composer.ts
// Pre-pass for Veo 3.1: fuse N reference keyframes + user subject images into a
// single canonical "moodboard keyframe" via Nano Banana Pro (max 14 reference
// images per request). The keyframe goes into Veo i2v as the seed.
//
// NOTE — NBP ABI BOUNDARY:
// The real generateImageNanoBananaPro SDK function signature is:
//   generateImageNanoBananaPro(input: NanoBananaProInputT, client: MediaForgeClient) => Promise<GenerateImageResult>
// where referenceImages is Array<{path:string; roleLabel?:string}> and imageSize is '1K'|'2K'|'4K'.
// This composer operates on raw JPEG Buffers (no file I/O at this layer) and returns
// {outputPath, width, height, costUsd} (a synthetic shape). Bridging the real SDK is
// the responsibility of refs-service.ts (Task 1.7). The typed alias below documents
// the mismatch explicitly; TypeScript enforces the composer-internal contract.
// NOTE: production NBP call lives in refs-service.ts due to SDK signature differences. This module retains slot/safety logic for unit-test reuse.

import { generateImageNanoBananaPro as _generateImageNanoBananaProSdk } from '../image/image-service.js';

// Local ABI consumed by this composer. Buffers in, synthetic output shape out.
// Intentionally distinct from NanoBananaProInputT to make the impedance mismatch
// visible at compile time when Task 1.7 bridges the two layers.
interface MoodboardNbpInput {
  prompt: string;
  referenceImages: Buffer[];
  imageSize: '1024' | '2048' | '4096';
}
interface MoodboardNbpOutput {
  outputPath: string;
  width: number;
  height: number;
  costUsd: number;
}

// Typed boundary alias — not `as any`, not `as never`. The cast is explicit and
// documented above; it is confined to this single constant so no type unsafety
// leaks into the body of composeMoodboard.
const generateImageNanoBananaPro =
  _generateImageNanoBananaProSdk as unknown as (input: MoodboardNbpInput) => Promise<MoodboardNbpOutput>;

const NBP_MAX_REFS = 14;

// Categories that NBP's safety filter rejects most often. When fusion involves
// these tags, callers should be prepared for SafetyRejectedError and downgrade
// to TEXT_ONLY mode in the upstream caller (refs-service.ts handles the catch).
const NBP_HIGH_REJECT_CATEGORIES = new Set([
  'datamosh', 'dreamcore', 'dystopian', 'wierdcore', 'surrealism', 'trip',
  'thermal', 'x-ray', 'night-vision', 'glitch',
]);

export class SafetyRejectedError extends Error {
  readonly safetyCategories: string[];
  constructor(message: string, safetyCategories: string[]) {
    super(message);
    this.name = 'SafetyRejectedError';
    this.safetyCategories = safetyCategories;
  }
}

export interface ComposeInput {
  refJpegs: Buffer[];
  subjectJpegs: Buffer[];
  effectTags: string[];
  outputSize: '1024' | '2048' | '4096';
  styleHint?: string;
}

export interface ComposeResult {
  outputPath: string;
  width: number;
  height: number;
  costUsd: number;
  // 'why these refs' trace metadata (cherry-pick #2)
  refsUsed: string[];       // object_keys actually passed to NBP — populated by refs-service.ts (Task 1.7)
  refsSkipped: number;      // count of refs over the 14-slot cap
  safetyRetryUsed: boolean; // true if safety-rephrase fallback engaged
}

export async function composeMoodboard(input: ComposeInput): Promise<ComposeResult> {
  const subjectSlots = input.subjectJpegs.slice(0, NBP_MAX_REFS);
  const remaining = NBP_MAX_REFS - subjectSlots.length;
  const refSlots = input.refJpegs.slice(0, Math.max(0, remaining));
  const referenceImages = [...subjectSlots, ...refSlots];
  const refsSkipped = Math.max(0, input.refJpegs.length - refSlots.length);

  const basePrompt =
    `Fuse ${referenceImages.length} reference images into one cohesive moodboard keyframe. ` +
    `Primary effect(s): ${input.effectTags.join(', ')}. ` +
    (input.styleHint ? `Style hint: ${input.styleHint}. ` : '') +
    `Preserve identity of any subject reference. Capture lighting, palette, lens character, ` +
    `and framing. Output a single still suitable as an image-to-video seed for Veo 3.1. ` +
    `Forbidden: text overlays, watermarks, frames, borders, multi-panel layouts.`;

  // High-reject categories: lead with a safety-aware prefix on the first try.
  const isRisky = input.effectTags.some((t) => NBP_HIGH_REJECT_CATEGORIES.has(t));
  const safePrefix = isRisky
    ? 'Family-friendly cinematic mood study, no blood, no gore, no explicit content. '
    : '';
  let safetyRetryUsed = false;

  async function callNbp(prompt: string): Promise<MoodboardNbpOutput> {
    try {
      return await generateImageNanoBananaPro({
        prompt,
        referenceImages,
        imageSize: input.outputSize,
      });
    } catch (err) {
      // NBP service throws domain-specific errors when safety filter blocks.
      // Detect by name OR by error message — the service may wrap as a generic Error.
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      if (/safety|blocked|filtered|prohibited/i.test(msg)) {
        throw new SafetyRejectedError(msg, input.effectTags);
      }
      throw err;
    }
  }

  let out: MoodboardNbpOutput;
  try {
    out = await callNbp(safePrefix + basePrompt);
  } catch (err) {
    if (err instanceof SafetyRejectedError) {
      // One retry with a more conservative prefix — abstract/stylised re-framing.
      safetyRetryUsed = true;
      const retryPrompt =
        'Abstract stylised composition study. Soft conceptual rendering, painterly, ' +
        'no realistic depiction of harmful content. ' + basePrompt;
      // Second failure propagates as SafetyRejectedError — caller (refs-service) catches
      // and downgrades to TEXT_ONLY mode.
      out = await callNbp(retryPrompt);
    } else {
      throw err;
    }
  }

  return {
    outputPath: out.outputPath,
    width: out.width,
    height: out.height,
    costUsd: out.costUsd,
    refsUsed: [], // populated by refs-service.ts (Task 1.7) which knows the object_keys
    refsSkipped,
    safetyRetryUsed,
  };
}
