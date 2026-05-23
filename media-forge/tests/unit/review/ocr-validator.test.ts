import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { ImageAnnotatorClient } from '@google-cloud/vision';
import { OcrValidator } from '../../../src/review/ocr-validator.js';
import { ApiError, MediaForgeError } from '../../../src/core/errors.js';
import { TINY_PNG_BASE64 } from '../../helpers/fixtures.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpImage(): { imgPath: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-test-'));
  const imgPath = path.join(dir, 'test.png');
  fs.writeFileSync(imgPath, Buffer.from(TINY_PNG_BASE64, 'base64'));
  return {
    imgPath,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

function makeVisionClient(fullText: string | null, shouldThrow?: boolean): ImageAnnotatorClient {
  return {
    textDetection: vi.fn(async (_req: unknown) => {
      if (shouldThrow) throw new Error('GCP network error');
      return [
        {
          fullTextAnnotation: fullText !== null ? { text: fullText } : undefined,
        },
      ];
    }),
  } as unknown as ImageAnnotatorClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OcrValidator', () => {
  let tmp: ReturnType<typeof makeTmpImage>;

  beforeEach(() => {
    tmp = makeTmpImage();
  });

  afterEach(() => {
    tmp.cleanup();
    vi.restoreAllMocks();
    delete process.env['MEDIA_FORGE_OCR'];
    delete process.env['MEDIA_FORGE_SKIP_OCR_WHEN_NO_TEXT_INTENT'];
  });

  // 1. Exact match
  it('returns ok=true with similarity=1, editDistance=0 on exact match', async () => {
    const client = makeVisionClient('Hello World');
    const validator = new OcrValidator({ _visionClient: client });
    const result = await validator.validateText({
      imagePath: tmp.imgPath,
      requiredText: 'Hello World',
    });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.similarity).toBe(1);
    expect(result.editDistance).toBe(0);
    expect(result.detectedText).toBe('Hello World');
    expect(result.backend).toBe('cloud-vision');
  });

  // 2. Off-by-one typo (editDistance=1, similarity close to 1)
  it('returns ok=true for off-by-one typo (editDistance=1)', async () => {
    const client = makeVisionClient('Hello Worls');
    const validator = new OcrValidator({ _visionClient: client });
    const result = await validator.validateText({
      imagePath: tmp.imgPath,
      requiredText: 'Hello World',
    });
    expect(result.editDistance).toBe(1);
    expect(result.ok).toBe(true);
  });

  // 3. Way off — completely different text
  it('returns ok=false for completely different detected text', async () => {
    const client = makeVisionClient('Goodbye Earth');
    const validator = new OcrValidator({ _visionClient: client });
    const result = await validator.validateText({
      imagePath: tmp.imgPath,
      requiredText: 'Hello World',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('mismatch');
  });

  // 4. Empty detection
  it('returns ok=false with reason=no-text-detected when detected text is empty', async () => {
    const client = makeVisionClient('');
    const validator = new OcrValidator({ _visionClient: client });
    const result = await validator.validateText({
      imagePath: tmp.imgPath,
      requiredText: 'Hello',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no-text-detected');
    expect(result.detectedText).toBe('');
  });

  // 5. Skip when no text intent
  it('skips validation when hasTextIntent=false and skipWhenNoTextIntent=true', async () => {
    const client = makeVisionClient('anything');
    const validator = new OcrValidator({
      _visionClient: client,
      skipWhenNoTextIntent: true,
    });
    const result = await validator.validateText({
      imagePath: tmp.imgPath,
      requiredText: 'Hello',
      hasTextIntent: false,
    });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('no-text-intent');
    expect(client.textDetection).not.toHaveBeenCalled();
  });

  // 6. Does NOT skip when hasTextIntent=true even if skipWhenNoTextIntent=true
  it('runs validation when hasTextIntent=true even with skipWhenNoTextIntent=true', async () => {
    const client = makeVisionClient('Hello World');
    const validator = new OcrValidator({
      _visionClient: client,
      skipWhenNoTextIntent: true,
    });
    const result = await validator.validateText({
      imagePath: tmp.imgPath,
      requiredText: 'Hello World',
      hasTextIntent: true,
    });
    expect(result.skipped).toBe(false);
    expect(client.textDetection).toHaveBeenCalledOnce();
  });

  // 7. paddleocr-wasm throws MediaForgeError (stub)
  it('throws MediaForgeError for paddleocr-wasm backend (stub)', async () => {
    const validator = new OcrValidator({ backend: 'paddleocr-wasm' });
    await expect(
      validator.validateText({ imagePath: tmp.imgPath, requiredText: 'text' })
    ).rejects.toThrow(MediaForgeError);
    await expect(
      validator.validateText({ imagePath: tmp.imgPath, requiredText: 'text' })
    ).rejects.toThrow('DEBT-007');
  });

  // 8. Cloud Vision API error wraps as ApiError
  it('wraps Cloud Vision API errors as ApiError', async () => {
    const client = makeVisionClient(null, true);
    const validator = new OcrValidator({ _visionClient: client });
    await expect(
      validator.validateText({ imagePath: tmp.imgPath, requiredText: 'Hello' })
    ).rejects.toThrow(ApiError);
  });

  // 9. Backend respects env var MEDIA_FORGE_OCR
  it('uses paddleocr-wasm backend when MEDIA_FORGE_OCR env var is set', async () => {
    process.env['MEDIA_FORGE_OCR'] = 'paddleocr-wasm';
    const validator = new OcrValidator();
    await expect(
      validator.validateText({ imagePath: tmp.imgPath, requiredText: 'text' })
    ).rejects.toThrow(MediaForgeError);
  });

  // 10. Boundary inclusive: similarity=0.85 AND editDistance=2 → ok=true
  it('ok=true at boundary: similarity>=0.85 AND editDistance<=2', async () => {
    // 'ABCDEFGHIJKLMNOPQRST' (20) vs 'ABCDEFGHIJKLMNOPQRXX' (20) → editDistance=2, similarity=0.9
    const required = 'ABCDEFGHIJKLMNOPQRST';
    const detectedStr = 'ABCDEFGHIJKLMNOPQRXX';
    const client = makeVisionClient(detectedStr);
    const validator = new OcrValidator({ _visionClient: client });
    const result = await validator.validateText({
      imagePath: tmp.imgPath,
      requiredText: required,
    });
    expect(result.editDistance).toBe(2);
    expect(result.similarity).toBeGreaterThanOrEqual(0.85);
    expect(result.ok).toBe(true);
  });

  // 11. Boundary: similarity=0.84 OR editDistance=3 → ok=false
  it('ok=false when similarity<0.85 (editDistance=3 on short string)', async () => {
    // 'Hello' (5) vs 'Xello' = editDistance=1 → sim=0.8 — but that's 1 edit
    // 10-char: 'ABCDEFGHIJ' vs 'ABCXXXGHIJ' → editDistance=3, similarity=0.7 → ok=false
    const required = 'ABCDEFGHIJ';
    const detectedStr = 'ABCXXXGHIJ';
    const client = makeVisionClient(detectedStr);
    const validator = new OcrValidator({ _visionClient: client });
    const result = await validator.validateText({
      imagePath: tmp.imgPath,
      requiredText: required,
    });
    expect(result.editDistance).toBe(3);
    expect(result.ok).toBe(false);
  });

  // Extra: null fullTextAnnotation (no text block returned) treated as empty
  it('handles null fullTextAnnotation as empty text → no-text-detected', async () => {
    const client: ImageAnnotatorClient = {
      textDetection: vi.fn(async () => [{ fullTextAnnotation: undefined }]),
    } as unknown as ImageAnnotatorClient;
    const validator = new OcrValidator({ _visionClient: client });
    const result = await validator.validateText({
      imagePath: tmp.imgPath,
      requiredText: 'Hello',
    });
    expect(result.reason).toBe('no-text-detected');
    expect(result.ok).toBe(false);
  });
});
