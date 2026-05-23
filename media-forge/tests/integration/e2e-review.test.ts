/**
 * E2E integration tests for the review orchestrator (mocked OCR, brand, judge).
 * Covers: OCR pass+brand pass+judge pass, OCR fail, brand fail, judge directive, judge fail→route.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import { resolve } from 'node:path';
import { makeTempDir, type TempDirHandle } from '../helpers/fs-tempdir.js';
import { TINY_PNG_BASE64 } from '../helpers/fixtures.js';
import { OutputManager } from '../../src/output/output-manager.js';

// ---------------------------------------------------------------------------
// Module-level mocks (vi.mock hoisted to top of module)
// ---------------------------------------------------------------------------

vi.mock('../../src/review/ocr-validator.js', () => ({
  OcrValidator: vi.fn().mockImplementation(() => ({
    validateText: vi.fn().mockResolvedValue({
      ok: true,
      skipped: false,
      detectedText: 'SALE',
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

vi.mock('../../src/review/llm-judge.js', () => ({
  judgeAsset: vi.fn().mockResolvedValue({
    verdict: 'pass',
    scores: {
      adherence: 9,
      quality: 8,
      alignment: 9,
      safety: 10,
      overall: 9,
    },
    rootCauseStage: 'none',
    errors: [],
  }),
}));

// ---------------------------------------------------------------------------
// Helper: write a tiny PNG asset and return its path
// ---------------------------------------------------------------------------

async function writeAsset(outputManager: OutputManager, jobId: string, version: string): Promise<string> {
  const versionDir = outputManager.resolveVersionDir(jobId, version);
  fs.mkdirSync(versionDir, { recursive: true });
  const assetPath = resolve(versionDir, 'asset.png');
  fs.writeFileSync(assetPath, Buffer.from(TINY_PNG_BASE64, 'base64'));
  return assetPath;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('E2E review orchestrator (mocked OCR + brand + judge)', () => {
  let tmp: TempDirHandle;
  let outputManager: OutputManager;
  let originalSessionId: string | undefined;

  beforeEach(() => {
    tmp = makeTempDir('e2e-review-');
    outputManager = new OutputManager({ baseDir: tmp.path });
    // Ensure judgeAsset doesn't auto-switch to subagent mode via env
    originalSessionId = process.env['CLAUDE_CODE_SESSION_ID'];
    delete process.env['CLAUDE_CODE_SESSION_ID'];
  });

  afterEach(() => {
    if (originalSessionId !== undefined) {
      process.env['CLAUDE_CODE_SESSION_ID'] = originalSessionId;
    }
    tmp.cleanup();
    vi.clearAllMocks();
  });

  it('Test 1: OCR pass + brand pass + judge pass (overall=9) → verdict=pass, routeDecision.action=accept', async () => {
    const { judgeAsset } = await import('../../src/review/llm-judge.js');
    vi.mocked(judgeAsset).mockResolvedValueOnce({
      verdict: 'pass',
      scores: { adherence: 9, quality: 8, alignment: 9, safety: 10, overall: 9 },
      rootCauseStage: 'none',
      errors: [],
    });

    const { jobId, jobDir } = await outputManager.createJob({ name: 'review-pass' });
    const version = await outputManager.nextVersion({ jobId });
    const assetPath = await writeAsset(outputManager, jobId, version);

    const { reviewAsset } = await import('../../src/review/reviewer.js');
    const result = await reviewAsset({
      assetPath,
      refinedSpec: { description: 'clean product photo on white bg', domain: 'product' },
      traceExcerpt: '',
      jobId,
      jobDir,
      version,
      attemptCount: 0,
      originalGeneratorAgent: 'product-photographer',
      outputManager,
    });

    expect('mode' in result.verdict).toBe(false);
    if (!('mode' in result.verdict)) {
      expect(result.verdict.verdict).toBe('pass');
    }
    expect(result.routeDecision).toBeDefined();
    if (result.routeDecision) {
      expect(result.routeDecision.action).toBe('accept');
    }
    expect(fs.existsSync(result.verdictPath)).toBe(true);
  });

  it('Test 2: OCR fail → synthetic text_typo verdict, judge NOT called', async () => {
    const { OcrValidator } = await import('../../src/review/ocr-validator.js');
    vi.mocked(OcrValidator).mockImplementationOnce(() => ({
      validateText: vi.fn().mockResolvedValue({
        ok: false,
        skipped: false,
        reason: 'mismatch',
        detectedText: 'SALLE',
        similarity: 0.6,
        editDistance: 2,
        backend: 'cloud-vision',
      }),
    }));

    const { judgeAsset } = await import('../../src/review/llm-judge.js');

    const { jobId, jobDir } = await outputManager.createJob({ name: 'review-ocr-fail' });
    const version = await outputManager.nextVersion({ jobId });
    const assetPath = await writeAsset(outputManager, jobId, version);

    const { reviewAsset } = await import('../../src/review/reviewer.js');
    const result = await reviewAsset({
      assetPath,
      refinedSpec: { description: 'misspelled CTA on banner', domain: 'product' },
      traceExcerpt: '',
      jobId,
      jobDir,
      version,
      attemptCount: 0,
      originalGeneratorAgent: 'ad-designer',
      outputManager,
      ocrRequiredText: 'SALE',
    });

    // Should be synthetic OCR fail verdict, not a directive
    expect('mode' in result.verdict).toBe(false);
    if (!('mode' in result.verdict)) {
      expect(result.verdict.verdict).toBe('fail');
      expect(result.verdict.errors[0]?.class).toBe('text_typo');
    }

    // judgeAsset must NOT have been called (short-circuit)
    expect(vi.mocked(judgeAsset)).not.toHaveBeenCalled();

    expect(result.routeDecision).toBeDefined();
    expect(fs.existsSync(result.verdictPath)).toBe(true);
  });

  it('Test 3: brand fail → synthetic brand_violation_color verdict', async () => {
    const { checkBrand } = await import('../../src/review/brand-checker.js');
    vi.mocked(checkBrand).mockResolvedValueOnce({
      ok: false,
      violations: [
        { class: 'color', severity: 'major', detail: 'brand color primary (#FF6B00) missing' },
      ],
      guidelinesFound: true,
    });

    const { jobId, jobDir } = await outputManager.createJob({ name: 'review-brand-fail' });
    const version = await outputManager.nextVersion({ jobId });
    const assetPath = await writeAsset(outputManager, jobId, version);

    const { reviewAsset } = await import('../../src/review/reviewer.js');
    const result = await reviewAsset({
      assetPath,
      refinedSpec: { description: 'off-palette product hero', domain: 'product' },
      traceExcerpt: '',
      jobId,
      jobDir,
      version,
      attemptCount: 0,
      originalGeneratorAgent: 'product-photographer',
      outputManager,
      enterpriseMode: true,
    });

    expect('mode' in result.verdict).toBe(false);
    if (!('mode' in result.verdict)) {
      expect(result.verdict.verdict).toBe('fail');
      expect(result.verdict.errors[0]?.class).toBe('brand_violation_color');
    }
    expect(result.routeDecision?.action).toBe('retry');
    expect(result.routeDecision?.fixTargetAgent).toBe('media-forge:enterprise-corrector');
    expect(fs.existsSync(result.verdictPath)).toBe(true);
  });

  it('Test 4: judge returns directive (subagent mode) → ReviewResult.routeDecision is undefined', async () => {
    const { judgeAsset } = await import('../../src/review/llm-judge.js');
    vi.mocked(judgeAsset).mockResolvedValueOnce({
      mode: 'subagent',
      agentName: 'media-forge:quality-reviewer',
      payload: {
        refinedSpec: { description: 'test' },
        assetPath: 'dummy.png',
        traceExcerpt: '',
        jobId: 'test-job',
      },
    });

    const { jobId, jobDir } = await outputManager.createJob({ name: 'review-directive' });
    const version = await outputManager.nextVersion({ jobId });
    const assetPath = await writeAsset(outputManager, jobId, version);

    const { reviewAsset } = await import('../../src/review/reviewer.js');
    const result = await reviewAsset({
      assetPath,
      refinedSpec: { description: 'scene composition with refs', domain: 'product' },
      traceExcerpt: '',
      jobId,
      jobDir,
      version,
      attemptCount: 0,
      originalGeneratorAgent: 'scene-composer',
      outputManager,
    });

    // Directive → routeDecision is undefined (reviewer.ts:213)
    expect('mode' in result.verdict).toBe(true);
    expect(result.routeDecision).toBeUndefined();
    expect(fs.existsSync(result.verdictPath)).toBe(true);
  });

  it('Test 5: judge returns fail → route to enterprise-corrector', async () => {
    const { judgeAsset } = await import('../../src/review/llm-judge.js');
    vi.mocked(judgeAsset).mockResolvedValueOnce({
      verdict: 'fail',
      scores: { adherence: 3, quality: 4, alignment: 3, safety: 10, overall: 4 },
      rootCauseStage: 'image-generator',
      errors: [
        { class: 'brand_violation_color', severity: 'major', detail: 'off-palette colors detected' },
      ],
    });

    const { jobId, jobDir } = await outputManager.createJob({ name: 'review-fail-route' });
    const version = await outputManager.nextVersion({ jobId });
    const assetPath = await writeAsset(outputManager, jobId, version);

    const { reviewAsset } = await import('../../src/review/reviewer.js');
    const result = await reviewAsset({
      assetPath,
      refinedSpec: { description: 'off-palette ad banner', domain: 'product' },
      traceExcerpt: '',
      jobId,
      jobDir,
      version,
      attemptCount: 0,
      originalGeneratorAgent: 'ad-designer',
      outputManager,
    });

    expect('mode' in result.verdict).toBe(false);
    if (!('mode' in result.verdict)) {
      expect(result.verdict.verdict).toBe('fail');
    }
    expect(result.routeDecision).toBeDefined();
    if (result.routeDecision) {
      expect(result.routeDecision.action).toBe('retry');
      expect(result.routeDecision.fixTargetAgent).toBe('media-forge:enterprise-corrector');
    }
    expect(fs.existsSync(result.verdictPath)).toBe(true);
  });
});
