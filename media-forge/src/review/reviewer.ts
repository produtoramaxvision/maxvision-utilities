import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import { OcrValidator } from './ocr-validator.js';
import { checkBrand } from './brand-checker.js';
import { judgeAsset } from './llm-judge.js';
import { route } from './router.js';
import { appendTrace } from '../trace/trace-writer.js';
import { recordLineage } from '../trace/lineage.js';
import { safeJoin } from '../utils/paths.js';
import { ensureDir } from '../utils/files.js';
import { logger } from '../core/logger.js';
import { computeRefMatchScore } from '../refs/ref-match-checker.js';
import type { OutputManager } from '../output/output-manager.js';
import type { ValidateTextResult } from './ocr-validator.js';
import type { BrandCheckResult } from './brand-checker.js';
import type { JudgeVerdict, JudgeDirective } from './llm-judge.js';
import type { RouteDecision } from './router.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ReviewOpts {
  jobId: string;
  jobDir: string;
  version: string;
  assetPath: string;
  refinedSpec: Record<string, unknown>;
  traceExcerpt: string;
  enterpriseMode?: boolean;
  ocrRequiredText?: string;
  brandGuidelinesPath?: string;
  attemptCount: number;
  originalGeneratorAgent: string;
  outputManager: OutputManager;
  // Phase 3 — ref-match (4th stage, optional)
  moodboardPath?: string;
  refMatchEnabled?: boolean;
  refMatchThreshold?: number;
  voyageApiKey?: string;
  /** Test seam: override the frame extractor to avoid real ffmpeg in unit tests. */
  _extractFirstFrame?: (assetPath: string) => Promise<Buffer>;
}

export interface ReviewResult {
  verdict: JudgeVerdict | JudgeDirective;
  ocr?: ValidateTextResult;
  brand?: BrandCheckResult;
  routeDecision?: RouteDecision;
  verdictPath: string;
  // Phase 3 — populated when 4th stage (ref-match) runs
  refMatchScore?: number;
  refMatchFailReason?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInputHash(jobId: string, assetPath: string): string {
  return crypto
    .createHash('sha256')
    .update(`${jobId}:${assetPath}:${Date.now()}`)
    .digest('hex')
    .slice(0, 32);
}

function buildSyntheticOcrFailVerdict(detail: string): JudgeVerdict {
  return {
    verdict: 'fail',
    scores: {
      adherence: 2,
      quality: 5,
      alignment: 5,
      safety: 10,
      overall: 3,
    },
    rootCauseStage: 'image-generator',
    errors: [
      {
        class: 'text_typo',
        severity: 'critical',
        detail,
      },
    ],
  };
}

function buildSyntheticBrandFailVerdict(detail: string, errorClass: JudgeVerdict['errors'][number]['class']): JudgeVerdict {
  return {
    verdict: 'fail',
    scores: {
      adherence: 3,
      quality: 5,
      alignment: 3,
      safety: 10,
      overall: 4,
    },
    rootCauseStage: 'image-generator',
    errors: [
      {
        class: errorClass,
        severity: 'major',
        detail,
      },
    ],
  };
}

function brandViolationToErrorClass(
  cls: 'color' | 'logo' | 'font',
): JudgeVerdict['errors'][number]['class'] {
  switch (cls) {
    case 'color': return 'brand_violation_color';
    case 'logo': return 'brand_violation_logo';
    case 'font': return 'brand_violation_font';
  }
}

function buildSyntheticRefMatchFailVerdict(detail: string): JudgeVerdict {
  return {
    verdict: 'fail',
    scores: {
      adherence: 3,
      quality: 5,
      alignment: 3,
      safety: 10,
      overall: 4,
    },
    rootCauseStage: 'cinematic-director',
    errors: [
      {
        class: 'ref_match_low',
        severity: 'major',
        detail,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// extractFirstFrame helper (Phase 3 — 4th review stage)
// ---------------------------------------------------------------------------

async function extractFirstFrame(videoPath: string): Promise<Buffer> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { resolveFfmpegPath } = await import('../core/ffmpeg.js');
  const ffmpegPath = resolveFfmpegPath();
  const execFileP = promisify(execFile);
  const dir = await mkdtemp(join(tmpdir(), 'mf-rev-'));
  try {
    const out = join(dir, 'first.jpg');
    await execFileP(ffmpegPath, ['-y', '-i', videoPath, '-vframes', '1', '-q:v', '3', out]);
    return readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Main reviewer orchestrator
// ---------------------------------------------------------------------------

export async function reviewAsset(opts: ReviewOpts): Promise<ReviewResult> {
  const start = Date.now();
  const inputHash = makeInputHash(opts.jobId, opts.assetPath);

  logger.info('reviewAsset: starting 3-stage review', {
    jobId: opts.jobId,
    version: opts.version,
    assetPath: opts.assetPath,
  });

  let ocrResult: ValidateTextResult | undefined;
  let brandResult: BrandCheckResult | undefined;
  let finalVerdict: JudgeVerdict | JudgeDirective;
  let routeDecision: RouteDecision | undefined;
  let refMatchScore: number | undefined;
  let refMatchFailReason: string | undefined;

  // -----------------------------------------------------------------------
  // Stage 1: OCR validation
  // -----------------------------------------------------------------------
  if (opts.ocrRequiredText) {
    logger.debug('reviewAsset: stage 1 — OCR', { jobId: opts.jobId });
    const ocrValidator = new OcrValidator();
    ocrResult = await ocrValidator.validateText({
      imagePath: opts.assetPath,
      requiredText: opts.ocrRequiredText,
      hasTextIntent: true,
    });

    if (!ocrResult.ok) {
      logger.warn('reviewAsset: OCR failed — short-circuiting to synthetic verdict', {
        jobId: opts.jobId,
        reason: ocrResult.reason,
      });
      const syntheticVerdict = buildSyntheticOcrFailVerdict(
        `OCR validation failed: required "${opts.ocrRequiredText}", detected "${ocrResult.detectedText}" (similarity=${ocrResult.similarity.toFixed(3)})`,
      );
      finalVerdict = syntheticVerdict;
      routeDecision = route({
        verdict: syntheticVerdict,
        attemptCount: opts.attemptCount,
        originalGeneratorAgent: opts.originalGeneratorAgent,
      });
      return await persistAndReturn({
        opts, start, inputHash, finalVerdict, ocrResult, brandResult, routeDecision,
        refMatchScore: undefined, refMatchFailReason: undefined,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Stage 2: Brand compliance check
  // -----------------------------------------------------------------------
  if (opts.enterpriseMode === true) {
    logger.debug('reviewAsset: stage 2 — brand check', { jobId: opts.jobId });
    brandResult = await checkBrand({
      imagePath: opts.assetPath,
      guidelinesPath: opts.brandGuidelinesPath,
      ocrText: ocrResult?.detectedText,
      // Enterprise mode runs the full brand contract: color delta + font
      // keyword scan + logo identity check (when guidelines.logo is set).
      // The reviewer always opts in here so logo rules in brand-guidelines.yml
      // are honored — checkBrand still no-ops when guidelines.logo is absent.
      enableLogoDetection: true,
    });

    if (!brandResult.ok) {
      const firstViolation = brandResult.violations[0];
      if (firstViolation) {
        logger.warn('reviewAsset: brand check failed — short-circuiting', {
          jobId: opts.jobId,
          violation: firstViolation.class,
        });
        const errorClass = brandViolationToErrorClass(firstViolation.class);
        const syntheticVerdict = buildSyntheticBrandFailVerdict(
          firstViolation.detail,
          errorClass,
        );
        finalVerdict = syntheticVerdict;
        routeDecision = route({
          verdict: syntheticVerdict,
          attemptCount: opts.attemptCount,
          originalGeneratorAgent: opts.originalGeneratorAgent,
        });
        return await persistAndReturn({
          opts, start, inputHash, finalVerdict, ocrResult, brandResult, routeDecision,
          refMatchScore: undefined, refMatchFailReason: undefined,
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // Stage 3: LLM judge
  // -----------------------------------------------------------------------
  logger.debug('reviewAsset: stage 3 — LLM judge', { jobId: opts.jobId });
  const judgeResult = await judgeAsset(
    {
      refinedSpec: opts.refinedSpec,
      assetPath: opts.assetPath,
      traceExcerpt: opts.traceExcerpt,
      jobId: opts.jobId,
    },
  );

  if ('mode' in judgeResult) {
    // JudgeDirective — caller must dispatch; no route decision yet
    finalVerdict = judgeResult;
    return await persistAndReturn({
      opts, start, inputHash, finalVerdict, ocrResult, brandResult, routeDecision: undefined,
      refMatchScore: undefined, refMatchFailReason: undefined,
    });
  }

  // JudgeVerdict — compute route decision
  finalVerdict = judgeResult;
  routeDecision = route({
    verdict: judgeResult,
    attemptCount: opts.attemptCount,
    originalGeneratorAgent: opts.originalGeneratorAgent,
  });

  // -----------------------------------------------------------------------
  // Stage 4: Ref-match score (Phase 3 — optional, gated by flag + moodboard)
  // Only runs when all prior stages pass (judge returned a non-fail JudgeVerdict).
  // Short-circuits from OCR/brand already returned early above; directives returned
  // early above as well. This stage therefore only executes on the full-pass path.
  // -----------------------------------------------------------------------
  if (
    opts.refMatchEnabled === true &&
    opts.moodboardPath != null &&
    'verdict' in finalVerdict
  ) {
    logger.debug('reviewAsset: stage 4 — ref-match score', {
      jobId: opts.jobId,
      moodboardPath: opts.moodboardPath,
    });
    try {
      const frameExtractor = opts._extractFirstFrame ?? extractFirstFrame;
      const outputFrame = await frameExtractor(opts.assetPath);
      const moodboard = await fs.promises.readFile(opts.moodboardPath);
      const score = await computeRefMatchScore(outputFrame, moodboard, opts.voyageApiKey ?? '');
      refMatchScore = score;
      const threshold = opts.refMatchThreshold ?? 0.65;
      if (score < threshold) {
        refMatchFailReason = `cosine ${score.toFixed(3)} < threshold ${threshold}`;
        logger.warn('reviewAsset: ref-match below threshold — overriding verdict to fail', {
          jobId: opts.jobId,
          score,
          threshold,
        });
        const refMatchVerdict = buildSyntheticRefMatchFailVerdict(refMatchFailReason);
        finalVerdict = refMatchVerdict;
        routeDecision = route({
          verdict: refMatchVerdict,
          attemptCount: opts.attemptCount,
          originalGeneratorAgent: opts.originalGeneratorAgent,
        });
      }
    } catch (err) {
      logger.error('reviewAsset: ref-match stage failed — skipping', {
        jobId: opts.jobId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return await persistAndReturn({
    opts, start, inputHash, finalVerdict, ocrResult, brandResult, routeDecision,
    refMatchScore, refMatchFailReason,
  });
}

// ---------------------------------------------------------------------------
// Persistence helper
// ---------------------------------------------------------------------------

interface PersistOpts {
  opts: ReviewOpts;
  start: number;
  inputHash: string;
  finalVerdict: JudgeVerdict | JudgeDirective;
  ocrResult: ValidateTextResult | undefined;
  brandResult: BrandCheckResult | undefined;
  routeDecision: RouteDecision | undefined;
  refMatchScore: number | undefined;
  refMatchFailReason: string | undefined;
}

async function persistAndReturn(p: PersistOpts): Promise<ReviewResult> {
  const { opts, start, inputHash, finalVerdict, ocrResult, brandResult, routeDecision, refMatchScore, refMatchFailReason } = p;
  const durationMs = Date.now() - start;

  // Write verdict.json directly to version dir (pick (a) from spec — use fs.writeFile)
  const versionDir = opts.outputManager.resolveVersionDir(opts.jobId, opts.version);
  ensureDir(versionDir);
  const verdictPath = safeJoin(versionDir, 'verdict.json');

  const verdictPayload = {
    verdict: finalVerdict,
    ocr: ocrResult,
    brand: brandResult,
    routeDecision,
    refMatchScore,
    refMatchFailReason,
    writtenAt: new Date().toISOString(),
  };

  await fs.promises.writeFile(verdictPath, JSON.stringify(verdictPayload, null, 2), 'utf8');
  logger.debug('reviewAsset: verdict.json written', {
    jobId: opts.jobId,
    version: opts.version,
    verdictPath,
  });

  // Determine verdict enum value for trace
  const verdictValue: 'pass' | 'fail' | 'partial' =
    'mode' in finalVerdict
      ? 'partial' // directive = unknown yet, treat as partial for trace
      : finalVerdict.verdict;

  const rootCauseStage =
    'mode' in finalVerdict ? undefined : finalVerdict.rootCauseStage;

  // Append trace entry
  await appendTrace({
    jobId: opts.jobId,
    jobDir: opts.jobDir,
    entry: {
      stage: 'review-judge',
      inputHash,
      durationMs,
      verdict: verdictValue,
      rootCause: rootCauseStage,
    },
  });

  // Record lineage if routing to retry
  if (
    routeDecision?.action === 'retry' &&
    routeDecision.fixTargetAgent &&
    routeDecision.fixDirective &&
    !('mode' in finalVerdict)
  ) {
    await recordLineage({
      jobDir: opts.jobDir,
      attempt: opts.attemptCount + 1,
      rootCause: finalVerdict.rootCauseStage,
      fixTargetAgent: routeDecision.fixTargetAgent,
      fixDirective: routeDecision.fixDirective,
      verdict: finalVerdict.verdict,
    });
  }

  logger.info('reviewAsset: complete', {
    jobId: opts.jobId,
    verdict: verdictValue,
    routeAction: routeDecision?.action,
    durationMs,
  });

  return {
    verdict: finalVerdict,
    ocr: ocrResult,
    brand: brandResult,
    routeDecision,
    verdictPath,
    refMatchScore,
    refMatchFailReason,
  };
}
