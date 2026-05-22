import { describe, it, expect } from 'vitest';
import { suggestRephrase } from '../../../src/image/safety-rephrase.js';
import { SafetyBlockError } from '../../../src/core/errors.js';

function makeError(context: Record<string, unknown> = {}): SafetyBlockError {
  return new SafetyBlockError('blocked', context);
}

describe('suggestRephrase', () => {
  it('blockReason=SAFETY → strategy=less-explicit, retryable=true', () => {
    const hint = suggestRephrase(makeError({ blockReason: 'SAFETY' }));
    expect(hint.strategy).toBe('less-explicit');
    expect(hint.retryable).toBe(true);
    expect(hint.suggestion).toContain('explicit');
  });

  it('finishReason=SAFETY → strategy=less-explicit, retryable=true', () => {
    const hint = suggestRephrase(makeError({ finishReason: 'SAFETY' }));
    expect(hint.strategy).toBe('less-explicit');
    expect(hint.retryable).toBe(true);
  });

  it('blockReason=PROHIBITED_CONTENT → strategy=remove-copyrighted, retryable=true', () => {
    const hint = suggestRephrase(makeError({ blockReason: 'PROHIBITED_CONTENT' }));
    expect(hint.strategy).toBe('remove-copyrighted');
    expect(hint.retryable).toBe(true);
    expect(hint.suggestion).toContain('celebrit');
  });

  it('finishReason=IMAGE_SAFETY → strategy=less-explicit, retryable=true', () => {
    const hint = suggestRephrase(makeError({ finishReason: 'IMAGE_SAFETY' }));
    expect(hint.strategy).toBe('less-explicit');
    expect(hint.retryable).toBe(true);
    expect(hint.suggestion).toContain('image');
  });

  it('blockReason=BLOCKLIST → strategy=soften-language, retryable=true', () => {
    const hint = suggestRephrase(makeError({ blockReason: 'BLOCKLIST' }));
    expect(hint.strategy).toBe('soften-language');
    expect(hint.retryable).toBe(true);
  });

  it('blockReason=OTHER → strategy=unknown, retryable=false', () => {
    const hint = suggestRephrase(makeError({ blockReason: 'OTHER' }));
    expect(hint.strategy).toBe('unknown');
    expect(hint.retryable).toBe(false);
  });

  it('no context → strategy=unknown, retryable=false', () => {
    const hint = suggestRephrase(new SafetyBlockError('blocked'));
    expect(hint.strategy).toBe('unknown');
    expect(hint.retryable).toBe(false);
  });

  it('unknown context shape → strategy=unknown, retryable=false', () => {
    const hint = suggestRephrase(makeError({ someOtherField: 'foo' }));
    expect(hint.strategy).toBe('unknown');
    expect(hint.retryable).toBe(false);
  });
});
