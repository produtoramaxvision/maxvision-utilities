import { describe, it, expect, afterEach } from 'vitest';
import { route, estimateRetryBudget } from '../../../src/review/router.js';
import type { JudgeVerdict } from '../../../src/review/llm-judge.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVerdict(overrides: Partial<JudgeVerdict> = {}): JudgeVerdict {
  return {
    verdict: 'fail',
    scores: {
      adherence: 5,
      quality: 5,
      alignment: 5,
      safety: 8,
      overall: 5,
    },
    rootCauseStage: 'prompt-engineer',
    errors: [],
    ...overrides,
  };
}

function makeError(
  cls: JudgeVerdict['errors'][number]['class'],
  severity: 'critical' | 'major' | 'minor' = 'major',
): JudgeVerdict['errors'][number] {
  return { class: cls, severity, detail: `test error for ${cls}` };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('route', () => {
  afterEach(() => {
    delete process.env['MEDIA_FORGE_MAX_FIX_ATTEMPTS'];
  });

  // Tests 1-10: one per routing class

  // 1. text_typo → original generator
  it('routes text_typo to originalGeneratorAgent with re-generate directive', () => {
    const verdict = makeVerdict({ errors: [makeError('text_typo')] });
    const decision = route({
      verdict,
      attemptCount: 0,
      originalGeneratorAgent: 'media-forge:image-generator',
      context: { negativeText: 'typo' },
    });
    expect(decision.action).toBe('retry');
    expect(decision.fixTargetAgent).toBe('media-forge:image-generator');
    expect(decision.fixDirective).toContain('Re-generate');
    expect(decision.fixDirective).toContain('typo');
  });

  // 2. brand_violation_color → enterprise-corrector
  it('routes brand_violation_color to enterprise-corrector', () => {
    const verdict = makeVerdict({ errors: [makeError('brand_violation_color')] });
    const decision = route({
      verdict,
      attemptCount: 0,
      originalGeneratorAgent: 'media-forge:image-generator',
      context: { brandColors: ['#FF6B35', '#004E89'] },
    });
    expect(decision.action).toBe('retry');
    expect(decision.fixTargetAgent).toBe('media-forge:enterprise-corrector');
    expect(decision.fixDirective).toContain('#FF6B35');
    expect(decision.fixDirective).toContain('brand palette');
  });

  // 3. brand_violation_logo → enterprise-corrector
  it('routes brand_violation_logo to enterprise-corrector', () => {
    const verdict = makeVerdict({ errors: [makeError('brand_violation_logo')] });
    const decision = route({
      verdict,
      attemptCount: 0,
      originalGeneratorAgent: 'media-forge:image-generator',
      context: { logoPosition: 'bottom-right', logoConfidence: 0.8 },
    });
    expect(decision.action).toBe('retry');
    expect(decision.fixTargetAgent).toBe('media-forge:enterprise-corrector');
    expect(decision.fixDirective).toContain('logo zone');
    expect(decision.fixDirective).toContain('bottom-right');
  });

  // 4. brand_violation_font → enterprise-corrector
  it('routes brand_violation_font to enterprise-corrector', () => {
    const verdict = makeVerdict({ errors: [makeError('brand_violation_font')] });
    const decision = route({
      verdict,
      attemptCount: 0,
      originalGeneratorAgent: 'media-forge:image-generator',
      context: { approvedFonts: ['Inter', 'Roboto'] },
    });
    expect(decision.action).toBe('retry');
    expect(decision.fixTargetAgent).toBe('media-forge:enterprise-corrector');
    expect(decision.fixDirective).toContain('Inter');
  });

  // 5. semantic_object_wrong → prompt-engineer
  it('routes semantic_object_wrong to prompt-engineer', () => {
    const verdict = makeVerdict({ errors: [makeError('semantic_object_wrong')] });
    const decision = route({
      verdict,
      attemptCount: 0,
      originalGeneratorAgent: 'media-forge:image-generator',
    });
    expect(decision.action).toBe('retry');
    expect(decision.fixTargetAgent).toBe('media-forge:prompt-engineer');
    expect(decision.fixDirective).toContain('subject noun');
  });

  // 6. semantic_color_wrong → prompt-engineer
  it('routes semantic_color_wrong to prompt-engineer', () => {
    const verdict = makeVerdict({ errors: [makeError('semantic_color_wrong')] });
    const decision = route({
      verdict,
      attemptCount: 0,
      originalGeneratorAgent: 'media-forge:image-generator',
    });
    expect(decision.action).toBe('retry');
    expect(decision.fixTargetAgent).toBe('media-forge:prompt-engineer');
    expect(decision.fixDirective).toContain('hex codes');
  });

  // 7. composition_wrong → scene-composer
  it('routes composition_wrong to scene-composer', () => {
    const verdict = makeVerdict({ errors: [makeError('composition_wrong')] });
    const decision = route({
      verdict,
      attemptCount: 0,
      originalGeneratorAgent: 'media-forge:image-generator',
    });
    expect(decision.action).toBe('retry');
    expect(decision.fixTargetAgent).toBe('media-forge:scene-composer');
    expect(decision.fixDirective).toContain('composition');
  });

  // 8. temporal_drift → veo-director
  it('routes temporal_drift to veo-director', () => {
    const verdict = makeVerdict({ errors: [makeError('temporal_drift')] });
    const decision = route({
      verdict,
      attemptCount: 0,
      originalGeneratorAgent: 'media-forge:video-generator',
    });
    expect(decision.action).toBe('retry');
    expect(decision.fixTargetAgent).toBe('media-forge:veo-director');
    expect(decision.fixDirective).toContain('extension hop');
  });

  // 9. safety_blocked → prompt-engineer
  it('routes safety_blocked to prompt-engineer', () => {
    const verdict = makeVerdict({ errors: [makeError('safety_blocked')] });
    const decision = route({
      verdict,
      attemptCount: 0,
      originalGeneratorAgent: 'media-forge:image-generator',
      context: { strategy: 'reframe-positively' },
    });
    expect(decision.action).toBe('retry');
    expect(decision.fixTargetAgent).toBe('media-forge:prompt-engineer');
    expect(decision.fixDirective).toContain('reframe-positively');
  });

  // 10. lipsync_miss → original generator
  it('routes lipsync_miss to originalGeneratorAgent', () => {
    const verdict = makeVerdict({ errors: [makeError('lipsync_miss')] });
    const decision = route({
      verdict,
      attemptCount: 0,
      originalGeneratorAgent: 'media-forge:video-generator',
    });
    expect(decision.action).toBe('retry');
    expect(decision.fixTargetAgent).toBe('media-forge:video-generator');
    expect(decision.fixDirective).toContain('medium close-up');
  });

  // 11. verdict=pass → action=accept
  it('returns action=accept when verdict is pass', () => {
    const verdict = makeVerdict({ verdict: 'pass', errors: [] });
    const decision = route({
      verdict,
      attemptCount: 0,
      originalGeneratorAgent: 'media-forge:image-generator',
    });
    expect(decision.action).toBe('accept');
  });

  // 12. attemptCount=3, maxAttempts=3 → escalate
  it('escalates when attemptCount >= maxAttempts', () => {
    const verdict = makeVerdict({ errors: [makeError('text_typo')] });
    const decision = route({
      verdict,
      attemptCount: 3,
      maxAttempts: 3,
      originalGeneratorAgent: 'media-forge:image-generator',
    });
    expect(decision.action).toBe('escalate');
    expect(decision.reason).toContain('max attempts');
    expect(decision.remainingBudget).toBe(0);
  });

  // 13. previousRootCause matches AND attemptCount=1 → escalate
  it('escalates when same root cause appears on second attempt (attemptCount=1)', () => {
    const verdict = makeVerdict({
      rootCauseStage: 'prompt-engineer',
      errors: [makeError('semantic_object_wrong')],
    });
    const decision = route({
      verdict,
      attemptCount: 1,
      previousRootCause: 'prompt-engineer',
      originalGeneratorAgent: 'media-forge:image-generator',
    });
    expect(decision.action).toBe('escalate');
    expect(decision.reason).toContain('same root cause');
  });

  // 14. previousRootCause matches AND attemptCount=0 → still retry (first attempt)
  it('does NOT escalate on first attempt even if rootCause matches previous (attemptCount=0)', () => {
    const verdict = makeVerdict({
      rootCauseStage: 'prompt-engineer',
      errors: [makeError('semantic_object_wrong')],
    });
    const decision = route({
      verdict,
      attemptCount: 0,
      previousRootCause: 'prompt-engineer',
      originalGeneratorAgent: 'media-forge:image-generator',
    });
    expect(decision.action).toBe('retry');
  });

  // 15. Multiple errors → first by severity wins (critical > major > minor)
  it('picks critical error over major and minor when sorting by severity', () => {
    const verdict = makeVerdict({
      errors: [
        makeError('semantic_object_wrong', 'minor'),
        makeError('safety_blocked', 'critical'),
        makeError('text_typo', 'major'),
      ],
    });
    const decision = route({
      verdict,
      attemptCount: 0,
      originalGeneratorAgent: 'media-forge:image-generator',
      context: { strategy: 'safe-mode' },
    });
    expect(decision.action).toBe('retry');
    // safety_blocked is critical → should be routed to prompt-engineer
    expect(decision.fixTargetAgent).toBe('media-forge:prompt-engineer');
    expect(decision.fixDirective).toContain('safe-mode');
  });

  // 16. estimateRetryBudget returns sane numbers
  it('estimateRetryBudget returns correct budget calculation', () => {
    const budget = estimateRetryBudget(5);
    expect(budget.maxAttempts).toBe(5);
    expect(budget.estimatedCostUsd).toBe(2.5);
  });

  // 17. Env override of maxAttempts respected
  it('respects MEDIA_FORGE_MAX_FIX_ATTEMPTS env var', () => {
    process.env['MEDIA_FORGE_MAX_FIX_ATTEMPTS'] = '2';
    const verdict = makeVerdict({ errors: [makeError('text_typo')] });
    const decision = route({
      verdict,
      attemptCount: 2,
      originalGeneratorAgent: 'media-forge:image-generator',
    });
    expect(decision.action).toBe('escalate');
    expect(decision.reason).toContain('2');
  });

  // Extra: remainingBudget is calculated correctly
  it('calculates remainingBudget correctly', () => {
    const verdict = makeVerdict({ errors: [makeError('text_typo')] });
    const decision = route({
      verdict,
      attemptCount: 1,
      maxAttempts: 3,
      originalGeneratorAgent: 'media-forge:image-generator',
    });
    // remaining = max(0, 3 - 1 - 1) = 1
    expect(decision.remainingBudget).toBe(1);
  });

  // Extra: estimateRetryBudget uses env var when no arg
  it('estimateRetryBudget uses env var when no argument passed', () => {
    process.env['MEDIA_FORGE_MAX_FIX_ATTEMPTS'] = '4';
    const budget = estimateRetryBudget();
    expect(budget.maxAttempts).toBe(4);
    expect(budget.estimatedCostUsd).toBe(2.0);
  });
});
