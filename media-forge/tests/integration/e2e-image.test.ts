/**
 * E2E integration test for image generation pipeline (mocked SDK).
 * Exercises: OutputManager → generateImageNanoBananaPro → saveAsset →
 *            saveMetadata → savePayload → savePrompt → appendTrace → reviewAsset.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import { resolve } from 'node:path';
import { makeTempDir, type TempDirHandle } from '../helpers/fs-tempdir.js';
import { TINY_PNG_BASE64 } from '../helpers/fixtures.js';
import { createMockGenAI } from '../helpers/mock-genai.js';
import { OutputManager } from '../../src/output/output-manager.js';
import { generateImageNanoBananaPro } from '../../src/image/image-service.js';
import { NanoBananaProInput } from '../../src/image/image-schemas.js';
import { appendTrace } from '../../src/trace/trace-writer.js';
import type { MediaForgeClient } from '../../src/core/client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMockedClient(mockAi: ReturnType<typeof createMockGenAI>): MediaForgeClient {
  return {
    mode: 'gemini',
    dryRun: false,
    ai: mockAi.client as unknown as MediaForgeClient['ai'],
  };
}

const VALID_INPUT = NanoBananaProInput.parse({
  op: 'nano-banana-pro',
  prompt: 'A leather handbag on white marble background, studio lighting',
  imageSize: '1K',
  aspectRatio: '1:1',
  referenceImages: [],
});

// ---------------------------------------------------------------------------
// Mocks for review sub-services (OCR + brand + judge)
// ---------------------------------------------------------------------------

vi.mock('../../src/review/ocr-validator.js', () => ({
  OcrValidator: vi.fn().mockImplementation(() => ({
    validateText: vi.fn().mockResolvedValue({
      ok: true,
      skipped: true,
      reason: 'no-text-intent',
      detectedText: '',
      similarity: 1,
      editDistance: 0,
      backend: 'cloud-vision',
    }),
  })),
}));

vi.mock('../../src/review/brand-checker.js', () => ({
  checkBrand: vi.fn().mockResolvedValue({
    ok: true,
    violations: [],
    guidelinesFound: false,
  }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('E2E image pipeline (mocked SDK)', () => {
  let tmp: TempDirHandle;
  let outputManager: OutputManager;
  let originalSessionId: string | undefined;

  beforeEach(() => {
    tmp = makeTempDir('e2e-image-');
    outputManager = new OutputManager({ baseDir: tmp.path });
    // Force judgeAsset into subagent mode so no Anthropic SDK call occurs
    originalSessionId = process.env['CLAUDE_CODE_SESSION_ID'];
    process.env['CLAUDE_CODE_SESSION_ID'] = 'test-e2e-session';
  });

  afterEach(() => {
    if (originalSessionId === undefined) {
      delete process.env['CLAUDE_CODE_SESSION_ID'];
    } else {
      process.env['CLAUDE_CODE_SESSION_ID'] = originalSessionId;
    }
    tmp.cleanup();
    vi.clearAllMocks();
  });

  it('happy path: generates image, saves all artifacts, trace entry written, verdict.json exists', async () => {
    const mock = createMockGenAI();
    mock.queueImageResponse({ base64: TINY_PNG_BASE64, mimeType: 'image/png' });
    const client = buildMockedClient(mock);

    // 1. Create job + version
    const { jobId, jobDir } = await outputManager.createJob({ name: 'e2e-test' });
    const version = await outputManager.nextVersion({ jobId });

    // 2. Generate image
    const result = await generateImageNanoBananaPro(VALID_INPUT, client);
    expect(result.base64.length).toBeGreaterThan(0);
    expect(result.mimeType).toBe('image/png');

    // 3. Save asset
    const assetBytes = Buffer.from(result.base64, 'base64');
    const savedAsset = await outputManager.saveAsset({
      jobId,
      version,
      kind: 'image',
      bytes: assetBytes,
      mime: 'image/png',
      filename: 'hero.png',
    });
    expect(fs.existsSync(savedAsset.path)).toBe(true);

    // 4. Save metadata + payload + prompt
    await outputManager.saveMetadata({
      jobId,
      version,
      metadata: { model: result.modelUsed, prompt: VALID_INPUT.prompt },
    });
    await outputManager.savePayload({
      jobId,
      version,
      payload: { op: 'nano-banana-pro', prompt: VALID_INPUT.prompt },
    });
    await outputManager.savePrompt({ jobId, version, prompt: VALID_INPUT.prompt });

    // 5. Append trace entry
    await appendTrace({
      jobId,
      jobDir,
      entry: {
        stage: 'image-generate',
        inputHash: 'abcd1234abcd1234abcd1234abcd1234',
        outputPath: savedAsset.path,
        model: result.modelUsed,
        durationMs: 500,
        costUsd: 0.01,
      },
    });

    // Verify trace.jsonl has at least 1 entry
    const tracePath = resolve(jobDir, 'trace.jsonl');
    expect(fs.existsSync(tracePath)).toBe(true);
    const traceLines = fs.readFileSync(tracePath, 'utf8').trim().split('\n').filter(Boolean);
    expect(traceLines.length).toBeGreaterThanOrEqual(1);

    // 6. Run review pipeline (judge returns subagent directive since CLAUDE_CODE_SESSION_ID is set)
    const { reviewAsset } = await import('../../src/review/reviewer.js');
    const reviewResult = await reviewAsset({
      assetPath: savedAsset.path,
      refinedSpec: { description: 'leather handbag product photo', domain: 'product' },
      traceExcerpt: '',
      jobId,
      jobDir,
      version,
      attemptCount: 0,
      originalGeneratorAgent: 'product-photographer',
      outputManager,
    });

    // 7. Assert verdict.json exists
    expect(fs.existsSync(reviewResult.verdictPath)).toBe(true);

    // Verdict is a JudgeDirective (subagent mode)
    expect('mode' in reviewResult.verdict).toBe(true);
    if ('mode' in reviewResult.verdict) {
      expect(reviewResult.verdict.mode).toBe('subagent');
    }

    // metadata.json exists
    const metaPath = resolve(outputManager.resolveVersionDir(jobId, version), 'metadata.json');
    expect(fs.existsSync(metaPath)).toBe(true);
  });

  it('OCR fail short-circuit: synthetic text_typo verdict, judge NOT called', async () => {
    // Override OcrValidator to return a fail result
    const { OcrValidator } = await import('../../src/review/ocr-validator.js');
    const mockInstance = {
      validateText: vi.fn().mockResolvedValue({
        ok: false,
        skipped: false,
        reason: 'mismatch',
        detectedText: 'SALLE',
        similarity: 0.6,
        editDistance: 2,
        backend: 'cloud-vision',
      }),
    };
    vi.mocked(OcrValidator).mockImplementationOnce(() => mockInstance as never);

    const { jobId, jobDir } = await outputManager.createJob({ name: 'e2e-ocr-fail' });
    const version = await outputManager.nextVersion({ jobId });

    // Write a placeholder image file
    const versionDir = outputManager.resolveVersionDir(jobId, version);
    fs.mkdirSync(versionDir, { recursive: true });
    const assetPath = resolve(versionDir, 'hero.png');
    fs.writeFileSync(assetPath, Buffer.from(TINY_PNG_BASE64, 'base64'));

    const { reviewAsset } = await import('../../src/review/reviewer.js');
    const reviewResult = await reviewAsset({
      assetPath,
      refinedSpec: { description: 'banner with CTA text', domain: 'product' },
      traceExcerpt: '',
      jobId,
      jobDir,
      version,
      attemptCount: 0,
      originalGeneratorAgent: 'ad-designer',
      outputManager,
      ocrRequiredText: 'SALE',
    });

    // OCR fail → synthetic text_typo verdict, no JudgeDirective
    expect('mode' in reviewResult.verdict).toBe(false);
    if (!('mode' in reviewResult.verdict)) {
      expect(reviewResult.verdict.verdict).toBe('fail');
      expect(reviewResult.verdict.errors[0]?.class).toBe('text_typo');
    }

    // Route decision exists (short-circuit still routes)
    expect(reviewResult.routeDecision).toBeDefined();
    expect(reviewResult.verdictPath).toBeTruthy();
    expect(fs.existsSync(reviewResult.verdictPath)).toBe(true);
  });

  it('brand fail short-circuit: synthetic brand_violation_color verdict', async () => {
    const { checkBrand } = await import('../../src/review/brand-checker.js');
    vi.mocked(checkBrand).mockResolvedValueOnce({
      ok: false,
      violations: [
        {
          class: 'color',
          severity: 'major',
          detail: 'brand color primary (#FF6B00) not present',
        },
      ],
      guidelinesFound: true,
    });

    const { jobId, jobDir } = await outputManager.createJob({ name: 'e2e-brand-fail' });
    const version = await outputManager.nextVersion({ jobId });

    const versionDir = outputManager.resolveVersionDir(jobId, version);
    fs.mkdirSync(versionDir, { recursive: true });
    const assetPath = resolve(versionDir, 'hero.png');
    fs.writeFileSync(assetPath, Buffer.from(TINY_PNG_BASE64, 'base64'));

    const { reviewAsset } = await import('../../src/review/reviewer.js');
    const reviewResult = await reviewAsset({
      assetPath,
      refinedSpec: { description: 'brand-compliant product hero', domain: 'product' },
      traceExcerpt: '',
      jobId,
      jobDir,
      version,
      attemptCount: 0,
      originalGeneratorAgent: 'product-photographer',
      outputManager,
      enterpriseMode: true,
    });

    expect('mode' in reviewResult.verdict).toBe(false);
    if (!('mode' in reviewResult.verdict)) {
      expect(reviewResult.verdict.verdict).toBe('fail');
      expect(reviewResult.verdict.errors[0]?.class).toBe('brand_violation_color');
    }

    expect(reviewResult.routeDecision).toBeDefined();
    if (reviewResult.routeDecision) {
      expect(reviewResult.routeDecision.fixTargetAgent).toBe('media-forge:enterprise-corrector');
    }
    expect(fs.existsSync(reviewResult.verdictPath)).toBe(true);
  });
});
