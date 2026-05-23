import { describe, it, expect } from 'vitest';
import { detectVideoSafetyBlock, suggestVideoRephrase } from '../../../src/video/safety-rephrase.js';
import { SafetyBlockError } from '../../../src/core/errors.js';

function makeError(context: Record<string, unknown> = {}): SafetyBlockError {
  return new SafetyBlockError('blocked', context);
}

describe('detectVideoSafetyBlock', () => {
  it('raiMediaFilteredCount=0 and no reasons → returns null', () => {
    const result = detectVideoSafetyBlock({
      raiMediaFilteredCount: 0,
      raiMediaFilteredReasons: [],
    });
    expect(result).toBeNull();
  });

  it('empty object (no keys) → returns null', () => {
    const result = detectVideoSafetyBlock({});
    expect(result).toBeNull();
  });

  it('count=1, reason=violence → returns SafetyBlockError with blockReason', () => {
    const result = detectVideoSafetyBlock({
      raiMediaFilteredCount: 1,
      raiMediaFilteredReasons: ['violence'],
    });
    expect(result).toBeInstanceOf(SafetyBlockError);
    const ctx = result!.context as Record<string, unknown>;
    expect(ctx.blockReason).toBe('violence');
  });

  it('count=0 but has reasons → returns SafetyBlockError (reasons take precedence)', () => {
    const result = detectVideoSafetyBlock({
      raiMediaFilteredCount: 0,
      raiMediaFilteredReasons: ['celebrity'],
    });
    expect(result).toBeInstanceOf(SafetyBlockError);
  });
});

describe('suggestVideoRephrase', () => {
  it('blockReason=violence → strategy=less-explicit, retryable=true', () => {
    const hint = suggestVideoRephrase(makeError({ blockReason: 'violence' }));
    expect(hint.strategy).toBe('less-explicit');
    expect(hint.retryable).toBe(true);
  });

  it('blockReason=celebrity → strategy=remove-real-person, retryable=true', () => {
    const hint = suggestVideoRephrase(makeError({ blockReason: 'celebrity' }));
    expect(hint.strategy).toBe('remove-real-person');
    expect(hint.retryable).toBe(true);
    expect(hint.suggestion).toContain('celebrit');
  });

  it('blockReason=copyrighted_character → strategy=remove-copyrighted, retryable=true', () => {
    const hint = suggestVideoRephrase(makeError({ blockReason: 'copyrighted_character' }));
    expect(hint.strategy).toBe('remove-copyrighted');
    expect(hint.retryable).toBe(true);
  });

  it('blockReason=blocklist → strategy=soften-language, retryable=true', () => {
    const hint = suggestVideoRephrase(makeError({ blockReason: 'blocklist' }));
    expect(hint.strategy).toBe('soften-language');
    expect(hint.retryable).toBe(true);
  });

  it('blockReason=unknown_thing → strategy=unknown, retryable=false', () => {
    const hint = suggestVideoRephrase(makeError({ blockReason: 'unknown_thing' }));
    expect(hint.strategy).toBe('unknown');
    expect(hint.retryable).toBe(false);
  });

  it('no context → strategy=unknown, retryable=false', () => {
    const hint = suggestVideoRephrase(new SafetyBlockError('blocked'));
    expect(hint.strategy).toBe('unknown');
    expect(hint.retryable).toBe(false);
  });
});
