import type { SafetyBlockError } from '../core/errors.js';

export interface RephraseHint {
  strategy:
    | 'less-explicit'
    | 'remove-real-person'
    | 'remove-violence'
    | 'remove-copyrighted'
    | 'soften-language'
    | 'unknown';
  suggestion: string;
  retryable: boolean;
}

const HINTS: Record<string, RephraseHint> = {
  SAFETY: {
    strategy: 'less-explicit',
    suggestion:
      'Remove or soften explicit, violent, or graphic language. Try abstract descriptors.',
    retryable: true,
  },
  IMAGE_SAFETY: {
    strategy: 'less-explicit',
    suggestion: 'The image content was flagged. Make the scene less suggestive.',
    retryable: true,
  },
  PROHIBITED_CONTENT: {
    strategy: 'remove-copyrighted',
    suggestion:
      'Avoid named celebrities, copyrighted characters, brand logos.',
    retryable: true,
  },
  BLOCKLIST: {
    strategy: 'soften-language',
    suggestion: 'A specific term is blocked. Replace with a synonym.',
    retryable: true,
  },
};

const UNKNOWN_HINT: RephraseHint = {
  strategy: 'unknown',
  suggestion: 'Block reason not specified. Try paraphrasing the prompt entirely.',
  retryable: false,
};

export function suggestRephrase(err: SafetyBlockError): RephraseHint {
  const ctx = err.context as Record<string, unknown> | undefined;
  const reason =
    (typeof ctx?.blockReason === 'string' ? ctx.blockReason : undefined) ??
    (typeof ctx?.finishReason === 'string' ? ctx.finishReason : undefined);

  if (!reason) return UNKNOWN_HINT;
  return HINTS[reason] ?? UNKNOWN_HINT;
}
