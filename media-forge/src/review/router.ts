import type { JudgeVerdict, JudgeError } from './llm-judge.js';
import { logger } from '../core/logger.js';

// ---------------------------------------------------------------------------
// Routing table (per spec §5.3, 10 classes)
// ---------------------------------------------------------------------------

interface RoutingTableEntry {
  fixTargetAgent: string;
  fixDirectiveTemplate: string;
}

const ROUTING_TABLE: Record<string, RoutingTableEntry> = {
  text_typo: {
    fixTargetAgent: '<original generator>',
    fixDirectiveTemplate:
      'Re-generate with explicit negative prompt forbidding misspelled text: "{{negativeText}}". Reinforce exact target string verbatim.',
  },
  brand_violation_color: {
    fixTargetAgent: 'media-forge:enterprise-corrector',
    fixDirectiveTemplate:
      'Targeted re-generation honoring brand palette: {{brandColors}}. Avoid drift from anchor colors.',
  },
  brand_violation_logo: {
    fixTargetAgent: 'media-forge:enterprise-corrector',
    fixDirectiveTemplate:
      'Reserve a logo zone in the composition. Logo must appear at {{logoPosition}} with ≥{{logoConfidence}} confidence.',
  },
  brand_violation_font: {
    fixTargetAgent: 'media-forge:enterprise-corrector',
    fixDirectiveTemplate:
      'Use approved font(s): {{approvedFonts}}. Render any text in one of these typefaces.',
  },
  semantic_object_wrong: {
    fixTargetAgent: 'media-forge:prompt-engineer',
    fixDirectiveTemplate:
      'Rewrite prompt — be more specific about the subject noun. Add a negative prompt for the wrong-object class.',
  },
  semantic_color_wrong: {
    fixTargetAgent: 'media-forge:prompt-engineer',
    fixDirectiveTemplate:
      'Rewrite prompt — replace abstract color words with hex codes. Add negative prompt for the off-target hue.',
  },
  composition_wrong: {
    fixTargetAgent: 'media-forge:scene-composer',
    fixDirectiveTemplate:
      'Re-do multi-image composition. Verify role labels and reference ordering.',
  },
  temporal_drift: {
    fixTargetAgent: 'media-forge:video-editor',
    fixDirectiveTemplate:
      'Re-prompt the extension hop with full character/scene description repeated verbatim (≥80% of original prompt).',
  },
  safety_blocked: {
    fixTargetAgent: 'media-forge:prompt-engineer',
    fixDirectiveTemplate:
      'Rephrase per safety bypass strategy: {{strategy}}. Avoid the flagged class.',
  },
  lipsync_miss: {
    fixTargetAgent: '<original generator>',
    fixDirectiveTemplate:
      'Re-prompt with "medium close-up" framing and shortened dialogue (≤12s).',
  },
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RouteOpts {
  verdict: JudgeVerdict;
  attemptCount: number;
  maxAttempts?: number;
  previousRootCause?: string;
  originalGeneratorAgent: string;
  context?: {
    negativeText?: string;
    brandColors?: string[];
    logoPosition?: string;
    logoConfidence?: number;
    approvedFonts?: string[];
    strategy?: string;
  };
}

export interface RouteDecision {
  action: 'retry' | 'escalate' | 'accept';
  fixTargetAgent?: string;
  fixDirective?: string;
  reason: string;
  attemptCount: number;
  remainingBudget: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  major: 1,
  minor: 2,
};

function sortErrorsBySeverity(errors: JudgeError[]): JudgeError[] {
  return [...errors].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99),
  );
}

function resolveTemplate(
  template: string,
  originalGeneratorAgent: string,
  context?: RouteOpts['context'],
): string {
  return template
    .replace('{{negativeText}}', context?.negativeText ?? '')
    .replace('{{brandColors}}', context?.brandColors?.join(', ') ?? '')
    .replace('{{logoPosition}}', context?.logoPosition ?? 'center')
    .replace('{{logoConfidence}}', String(context?.logoConfidence ?? 0.8))
    .replace('{{approvedFonts}}', context?.approvedFonts?.join(', ') ?? '')
    .replace('{{strategy}}', context?.strategy ?? 'safe rephrasing');
}

function resolveAgent(agent: string, originalGeneratorAgent: string): string {
  return agent === '<original generator>' ? originalGeneratorAgent : agent;
}

// ---------------------------------------------------------------------------
// Main router
// ---------------------------------------------------------------------------

export function route(opts: RouteOpts): RouteDecision {
  const maxAttempts =
    opts.maxAttempts ??
    (process.env['MEDIA_FORGE_MAX_FIX_ATTEMPTS']
      ? parseInt(process.env['MEDIA_FORGE_MAX_FIX_ATTEMPTS'], 10)
      : 3);

  const remainingBudget = Math.max(0, maxAttempts - opts.attemptCount - 1);

  // Rule 1: verdict is pass → accept
  if (opts.verdict.verdict === 'pass') {
    logger.info('router: verdict=pass → accept', { attemptCount: opts.attemptCount });
    return {
      action: 'accept',
      reason: 'verdict is pass',
      attemptCount: opts.attemptCount,
      remainingBudget,
    };
  }

  // Rule 2: max attempts reached → escalate
  if (opts.attemptCount >= maxAttempts) {
    logger.warn('router: max attempts reached → escalate', {
      attemptCount: opts.attemptCount,
      maxAttempts,
    });
    return {
      action: 'escalate',
      reason: `max attempts (${maxAttempts}) reached`,
      attemptCount: opts.attemptCount,
      remainingBudget: 0,
    };
  }

  // Rule 3: same root cause repeated on second+ attempt → escalate
  // "2× in a row" = attemptCount >= 1 AND rootCause matches previousRootCause
  if (
    opts.previousRootCause !== undefined &&
    opts.verdict.rootCauseStage === opts.previousRootCause &&
    opts.attemptCount >= 1
  ) {
    logger.warn('router: same root cause repeated → escalate', {
      rootCause: opts.verdict.rootCauseStage,
      attemptCount: opts.attemptCount,
    });
    return {
      action: 'escalate',
      reason: 'same root cause repeated',
      attemptCount: opts.attemptCount,
      remainingBudget,
    };
  }

  // Rule 4: pick first error by severity, map to routing table
  const sortedErrors = sortErrorsBySeverity(opts.verdict.errors);
  const topError = sortedErrors[0];

  if (!topError) {
    // verdict is fail/partial but no errors — generic escalate
    logger.warn('router: fail verdict with no errors → escalate', {
      verdict: opts.verdict.verdict,
    });
    return {
      action: 'escalate',
      reason: 'verdict is non-pass but no errors provided',
      attemptCount: opts.attemptCount,
      remainingBudget,
    };
  }

  const entry = ROUTING_TABLE[topError.class];
  if (!entry) {
    // Unknown error class — escalate
    logger.warn('router: unknown error class → escalate', { class: topError.class });
    return {
      action: 'escalate',
      reason: `unknown error class: ${topError.class}`,
      attemptCount: opts.attemptCount,
      remainingBudget,
    };
  }

  const fixTargetAgent = resolveAgent(entry.fixTargetAgent, opts.originalGeneratorAgent);
  const fixDirective = resolveTemplate(
    entry.fixDirectiveTemplate,
    opts.originalGeneratorAgent,
    opts.context,
  );

  logger.info('router: routing to fix agent', {
    errorClass: topError.class,
    fixTargetAgent,
    attemptCount: opts.attemptCount,
  });

  return {
    action: 'retry',
    fixTargetAgent,
    fixDirective,
    reason: `error class ${topError.class} (${topError.severity}) → route to ${fixTargetAgent}`,
    attemptCount: opts.attemptCount,
    remainingBudget,
  };
}

// ---------------------------------------------------------------------------
// Budget estimator (C4 visible budget)
// ---------------------------------------------------------------------------

export function estimateRetryBudget(maxAttempts?: number): {
  maxAttempts: number;
  estimatedCostUsd: number;
} {
  const max =
    maxAttempts ??
    (process.env['MEDIA_FORGE_MAX_FIX_ATTEMPTS']
      ? parseInt(process.env['MEDIA_FORGE_MAX_FIX_ATTEMPTS'], 10)
      : 3);
  return {
    maxAttempts: max,
    estimatedCostUsd: max * 0.5,
  };
}
