import { ImageAnnotatorClient } from '@google-cloud/vision';
import { readBase64 } from '../utils/files.js';
import { ApiError, MediaForgeError } from '../core/errors.js';
import { logger } from '../core/logger.js';

export type OcrBackend = 'cloud-vision' | 'paddleocr-wasm';

export interface OcrValidatorOpts {
  backend?: OcrBackend;
  skipWhenNoTextIntent?: boolean;
  /** Test injection */
  _visionClient?: ImageAnnotatorClient;
}

export interface ValidateTextOpts {
  imagePath: string;
  requiredText: string;
  hasTextIntent?: boolean;
  /**
   * Optional BCP-47 language codes forwarded to Cloud Vision's textDetection
   * (`imageContext.languageHints`). Improves recognition accuracy on
   * multilingual assets. Omit for default auto-detect.
   */
  languages?: string[];
}

export interface ValidateTextResult {
  ok: boolean;
  skipped: boolean;
  reason?: 'no-text-intent' | 'mismatch' | 'no-text-detected';
  detectedText: string;
  similarity: number;
  editDistance: number;
  backend: OcrBackend;
}

// DP Levenshtein implementation
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  // dp[i][j] = edit distance between a[0..i-1] and b[0..j-1]
  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = new Array<number>(n + 1).fill(0);
    dp[i]![0] = i;
  }
  for (let j = 0; j <= n; j++) {
    dp[0]![j] = j;
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,       // deletion
        dp[i]![j - 1]! + 1,       // insertion
        dp[i - 1]![j - 1]! + cost // substitution
      );
    }
  }
  return dp[m]![n]!;
}

// Normalized Levenshtein similarity: 1 - (editDistance / maxLen)
function normalizedSimilarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return 1 - dist / maxLen;
}

export class OcrValidator {
  private readonly backend: OcrBackend;
  private readonly skipWhenNoTextIntent: boolean;
  private readonly injectedVisionClient?: ImageAnnotatorClient;
  private lazyVisionClient?: ImageAnnotatorClient;

  constructor(opts?: OcrValidatorOpts) {
    this.backend =
      opts?.backend ??
      ((process.env['MEDIA_FORGE_OCR'] as OcrBackend | undefined) ??
        'cloud-vision');
    this.skipWhenNoTextIntent =
      opts?.skipWhenNoTextIntent ??
      (process.env['MEDIA_FORGE_SKIP_OCR_WHEN_NO_TEXT_INTENT'] === 'true');
    this.injectedVisionClient = opts?._visionClient;
  }

  private getVisionClient(): ImageAnnotatorClient {
    if (this.injectedVisionClient) return this.injectedVisionClient;
    if (this.lazyVisionClient) return this.lazyVisionClient;
    // Lazy init — constructor probes GCP credentials, not the static import
    this.lazyVisionClient = new ImageAnnotatorClient();
    return this.lazyVisionClient;
  }

  async validateText(opts: ValidateTextOpts): Promise<ValidateTextResult> {
    const { imagePath, requiredText, hasTextIntent, languages } = opts;

    // Stage 1: skip if no text intent
    if (hasTextIntent === false && this.skipWhenNoTextIntent) {
      logger.debug('OcrValidator: skipping (no text intent)', { imagePath });
      return {
        ok: true,
        skipped: true,
        reason: 'no-text-intent',
        detectedText: '',
        similarity: 1,
        editDistance: 0,
        backend: this.backend,
      };
    }

    // Stage 2: unsupported backend
    if (this.backend === 'paddleocr-wasm') {
      throw new MediaForgeError(
        'paddleocr-wasm backend not implemented yet — track DEBT-007',
        'CAPABILITY',
      );
    }

    // Stage 3: read image bytes
    const bytes = readBase64(imagePath);

    // Stage 4: call Cloud Vision
    let detectedText = '';
    try {
      logger.debug('OcrValidator: calling Cloud Vision textDetection', {
        imagePath,
        languages,
      });
      const client = this.getVisionClient();
      const [result] = await client.textDetection({
        image: { content: bytes },
        ...(languages && languages.length > 0
          ? { imageContext: { languageHints: languages } }
          : {}),
      });
      detectedText = result?.fullTextAnnotation?.text ?? '';
    } catch (err) {
      if (err instanceof MediaForgeError) throw err;
      throw new ApiError(
        `Cloud Vision textDetection failed: ${err instanceof Error ? err.message : String(err)}`,
        'API',
        { imagePath, cause: err instanceof Error ? err.message : String(err) },
      );
    }

    // Stage 5: empty detection
    if (!detectedText) {
      logger.warn('OcrValidator: no text detected', { imagePath });
      return {
        ok: false,
        skipped: false,
        reason: 'no-text-detected',
        detectedText: '',
        similarity: 0,
        editDistance: requiredText.length,
        backend: this.backend,
      };
    }

    // Stage 6: compute similarity
    const similarity = normalizedSimilarity(detectedText.trim(), requiredText.trim());
    const editDistance = levenshtein(detectedText.trim(), requiredText.trim());

    const ok = similarity >= 0.85 && editDistance <= 2;
    const reason: ValidateTextResult['reason'] = ok ? undefined : 'mismatch';

    logger.info('OcrValidator: validation complete', {
      imagePath,
      ok,
      similarity,
      editDistance,
    });

    return {
      ok,
      skipped: false,
      reason,
      detectedText,
      similarity,
      editDistance,
      backend: this.backend,
    };
  }
}
