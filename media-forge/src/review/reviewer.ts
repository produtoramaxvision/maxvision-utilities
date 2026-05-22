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
}

export interface ReviewResult {
  verdict: JudgeVerdict | JudgeDirective;
  ocr?: ValidateTextResult;
  brand?: BrandCheckResult;
  routeDecision?: RouteDecision;
  verdictPath: string;
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
      enableLogoDetection: false,
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
    });
  }

  // JudgeVerdict — compute route decision
  finalVerdict = judgeResult;
  routeDecision = route({
    verdict: judgeResult,
    attemptCount: opts.attemptCount,
    originalGeneratorAgent: opts.originalGeneratorAgent,
  });

  return await persistAndReturn({
    opts, start, inputHash, finalVerdict, ocrResult, brandResult, routeDecision,
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
}

async function persistAndReturn(p: PersistOpts): Promise<ReviewResult> {
  const { opts, start, inputHash, finalVerdict, ocrResult, brandResult, routeDecision } = p;
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
  };
}
