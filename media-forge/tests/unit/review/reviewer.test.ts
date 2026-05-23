import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { TINY_PNG_BASE64 } from '../../helpers/fixtures.js';

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports of the mocked modules
// ---------------------------------------------------------------------------

vi.mock('../../../src/review/ocr-validator.js', () => ({
  OcrValidator: vi.fn().mockImplementation(() => ({
    validateText: vi.fn(),
  })),
}));

vi.mock('../../../src/review/brand-checker.js', () => ({
  checkBrand: vi.fn(),
}));

vi.mock('../../../src/review/llm-judge.js', () => ({
  judgeAsset: vi.fn(),
}));

vi.mock('../../../src/trace/trace-writer.js', () => ({
  appendTrace: vi.fn(async () => undefined),
}));

vi.mock('../../../src/trace/lineage.js', () => ({
  recordLineage: vi.fn(async () => undefined),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { reviewAsset } from '../../../src/review/reviewer.js';
import { OcrValidator } from '../../../src/review/ocr-validator.js';
import { checkBrand } from '../../../src/review/brand-checker.js';
import { judgeAsset } from '../../../src/review/llm-judge.js';
import { appendTrace } from '../../../src/trace/trace-writer.js';
import { recordLineage } from '../../../src/trace/lineage.js';

const mockJudgeAsset = vi.mocked(judgeAsset);
const mockCheckBrand = vi.mocked(checkBrand);
const mockAppendTrace = vi.mocked(appendTrace);
const mockRecordLineage = vi.mocked(recordLineage);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): { dir: string; imgPath: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewer-test-'));
  const imgPath = path.join(dir, 'asset.png');
  fs.writeFileSync(imgPath, Buffer.from(TINY_PNG_BASE64, 'base64'));
  return {
    dir,
    imgPath,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

function makeOutputManager(baseDir: string) {
  return {
    resolveVersionDir: vi.fn((jobId: string, version: string) =>
      path.join(baseDir, 'jobs', jobId, version),
    ),
  };
}

const PASS_VERDICT = {
  verdict: 'pass' as const,
  scores: { adherence: 9, quality: 9, alignment: 9, safety: 10, overall: 9 },
  rootCauseStage: 'none' as const,
  errors: [] as [],
};

const FAIL_VERDICT = {
  verdict: 'fail' as const,
  scores: { adherence: 4, quality: 5, alignment: 4, safety: 10, overall: 5 },
  rootCauseStage: 'prompt-engineer' as const,
  errors: [
    {
      class: 'semantic_object_wrong' as const,
      severity: 'major' as const,
      detail: 'Wrong object detected',
    },
  ],
};

const BRAND_FAIL_VERDICT = {
  verdict: 'fail' as const,
  scores: { adherence: 3, quality: 5, alignment: 3, safety: 10, overall: 4 },
  rootCauseStage: 'image-generator' as const,
  errors: [
    {
      class: 'brand_violation_color' as const,
      severity: 'major' as const,
      detail: 'brand color primary (#FF6B35) not present',
    },
  ],
};

const JUDGE_DIRECTIVE = {
  mode: 'subagent' as const,
  agentName: 'media-forge:quality-reviewer' as const,
  payload: {
    refinedSpec: { domain: 'test' },
    assetPath: '/tmp/asset.png',
    traceExcerpt: '',
    jobId: 'test-job',
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('reviewAsset', () => {
  let tmp: ReturnType<typeof makeTmpDir>;

  beforeEach(() => {
    tmp = makeTmpDir();
    vi.clearAllMocks();
    delete process.env['CLAUDE_CODE_SESSION_ID'];
  });

  afterEach(() => {
    tmp.cleanup();
  });

  function makeOpts(overrides: Partial<Parameters<typeof reviewAsset>[0]> = {}) {
    const om = makeOutputManager(tmp.dir);
    return {
      jobId: 'job-test-001',
      jobDir: tmp.dir,
      version: 'v1',
      assetPath: tmp.imgPath,
      refinedSpec: { domain: 'product-photographer', prompt: 'leather bag' },
      traceExcerpt: 'stage: image-generate\nduration: 14000ms',
      enterpriseMode: false,
      attemptCount: 0,
      originalGeneratorAgent: 'media-forge:image-generator',
      outputManager: om as unknown as Parameters<typeof reviewAsset>[0]['outputManager'],
      ...overrides,
    };
  }

  // 1. OCR fail short-circuits to text_typo verdict (judge NOT called)
  it('OCR failure short-circuits to synthetic text_typo verdict without calling judge', async () => {
    const opts = makeOpts({ ocrRequiredText: 'Hello World' });

    // Set up OcrValidator mock instance
    const MockOcrClass = vi.mocked(OcrValidator);
    MockOcrClass.mockImplementationOnce(() => ({
      validateText: vi.fn().mockResolvedValue({
        ok: false,
        skipped: false,
        reason: 'mismatch',
        detectedText: 'Helloo Worldd',
        similarity: 0.7,
        editDistance: 4,
        backend: 'cloud-vision',
      }),
    }));

    const result = await reviewAsset(opts);

    expect(mockJudgeAsset).not.toHaveBeenCalled();
    expect('verdict' in result.verdict).toBe(true);
    if ('verdict' in result.verdict) {
      expect(result.verdict.verdict).toBe('fail');
      expect(result.verdict.errors[0]?.class).toBe('text_typo');
    }
    expect(result.ocr).toBeDefined();
    expect(result.routeDecision).toBeDefined();
    expect(result.verdictPath).toContain('verdict.json');
  });

  // 2. Brand violation short-circuits (enterprise mode on)
  it('brand violation short-circuits to synthetic brand_violation verdict', async () => {
    const opts = makeOpts({ enterpriseMode: true });

    mockCheckBrand.mockResolvedValueOnce({
      ok: false,
      violations: [
        {
          class: 'color',
          severity: 'major',
          detail: 'brand color primary (#FF6B35) not present (ΔE=15)',
        },
      ],
      guidelinesFound: true,
    });

    const result = await reviewAsset(opts);

    expect(mockJudgeAsset).not.toHaveBeenCalled();
    if ('verdict' in result.verdict) {
      expect(result.verdict.verdict).toBe('fail');
      expect(result.verdict.errors[0]?.class).toBe('brand_violation_color');
    }
    expect(result.brand).toBeDefined();
    expect(result.routeDecision?.fixTargetAgent).toBe('media-forge:enterprise-corrector');
  });

  // 3. Brand check skipped when enterpriseMode=false
  it('skips brand check when enterpriseMode=false', async () => {
    const opts = makeOpts({ enterpriseMode: false });
    mockJudgeAsset.mockResolvedValueOnce(PASS_VERDICT);

    await reviewAsset(opts);

    expect(mockCheckBrand).not.toHaveBeenCalled();
  });

  // 4. Happy path: OCR skip + brand skip + judge pass → verdict=pass, routeDecision.action=accept
  it('happy path: no OCR, no enterprise, judge passes → accept', async () => {
    const opts = makeOpts();
    mockJudgeAsset.mockResolvedValueOnce(PASS_VERDICT);

    const result = await reviewAsset(opts);

    expect(mockJudgeAsset).toHaveBeenCalledOnce();
    if ('verdict' in result.verdict) {
      expect(result.verdict.verdict).toBe('pass');
    }
    expect(result.routeDecision?.action).toBe('accept');
    expect(result.ocr).toBeUndefined();
    expect(result.brand).toBeUndefined();
  });

  // 5. Judge returns directive (subagent mode) → no routeDecision
  it('returns no routeDecision when judge returns a JudgeDirective', async () => {
    const opts = makeOpts();
    mockJudgeAsset.mockResolvedValueOnce(JUDGE_DIRECTIVE);

    const result = await reviewAsset(opts);

    if ('mode' in result.verdict) {
      expect(result.verdict.mode).toBe('subagent');
    }
    expect(result.routeDecision).toBeUndefined();
  });

  // 6. Judge fail + routing to enterprise-corrector → fixTargetAgent set
  it('routes to enterprise-corrector on brand violation error from judge', async () => {
    const opts = makeOpts();
    mockJudgeAsset.mockResolvedValueOnce(BRAND_FAIL_VERDICT);

    const result = await reviewAsset(opts);

    expect(result.routeDecision?.action).toBe('retry');
    expect(result.routeDecision?.fixTargetAgent).toBe('media-forge:enterprise-corrector');
  });

  // 7. verdict.json written to correct path
  it('writes verdict.json to the correct version directory path', async () => {
    const opts = makeOpts();
    mockJudgeAsset.mockResolvedValueOnce(PASS_VERDICT);

    const result = await reviewAsset(opts);

    expect(result.verdictPath).toContain('verdict.json');
    expect(result.verdictPath).toContain('v1');
    expect(fs.existsSync(result.verdictPath)).toBe(true);

    const written = JSON.parse(fs.readFileSync(result.verdictPath, 'utf8')) as {
      verdict: { verdict: string };
    };
    expect(written.verdict).toBeDefined();
  });

  // 8. trace + lineage written
  it('writes trace entry for review-judge stage', async () => {
    const opts = makeOpts();
    mockJudgeAsset.mockResolvedValueOnce(PASS_VERDICT);

    await reviewAsset(opts);

    expect(mockAppendTrace).toHaveBeenCalledOnce();
    const traceCall = mockAppendTrace.mock.calls[0]?.[0];
    expect(traceCall?.entry.stage).toBe('review-judge');
    expect(traceCall?.entry.verdict).toBe('pass');
  });

  it('writes lineage entry when routeDecision is retry', async () => {
    const opts = makeOpts();
    mockJudgeAsset.mockResolvedValueOnce(FAIL_VERDICT);

    await reviewAsset(opts);

    expect(mockRecordLineage).toHaveBeenCalledOnce();
    const lineageCall = mockRecordLineage.mock.calls[0]?.[0];
    expect(lineageCall?.attempt).toBe(1); // attemptCount + 1
    expect(lineageCall?.rootCause).toBe('prompt-engineer');
  });

  it('does NOT write lineage when routeDecision is accept', async () => {
    const opts = makeOpts();
    mockJudgeAsset.mockResolvedValueOnce(PASS_VERDICT);

    await reviewAsset(opts);

    expect(mockRecordLineage).not.toHaveBeenCalled();
  });

  // Extra: brand check with guidelines not found still proceeds to judge
  it('proceeds to judge when brand guidelines not found (guidelinesFound=false)', async () => {
    const opts = makeOpts({ enterpriseMode: true });
    mockCheckBrand.mockResolvedValueOnce({
      ok: true,
      violations: [],
      guidelinesFound: false,
    });
    mockJudgeAsset.mockResolvedValueOnce(PASS_VERDICT);

    const result = await reviewAsset(opts);

    expect(mockJudgeAsset).toHaveBeenCalledOnce();
    if ('verdict' in result.verdict) {
      expect(result.verdict.verdict).toBe('pass');
    }
  });
});
