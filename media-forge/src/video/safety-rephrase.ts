import { SafetyBlockError } from '../core/errors.js';

export interface VideoRephraseHint {
  strategy:
    | 'less-explicit'
    | 'remove-real-person'
    | 'remove-copyrighted'
    | 'soften-language'
    | 'unknown';
  suggestion: string;
  retryable: boolean;
}

const REASON_MAP: Record<string, VideoRephraseHint> = {
  celebrity: {
    strategy: 'remove-real-person',
    suggestion:
      'Avoid referencing real celebrities or identifiable public figures. Use fictional characters or descriptive traits instead.',
    retryable: true,
  },
  identifiable_person: {
    strategy: 'remove-real-person',
    suggestion:
      'Remove references to identifiable real people. Describe appearance traits rather than named individuals.',
    retryable: true,
  },
  violence: {
    strategy: 'less-explicit',
    suggestion:
      'Soften or remove violent imagery. Focus on abstract or implied action rather than explicit depiction.',
    retryable: true,
  },
  explicit: {
    strategy: 'less-explicit',
    suggestion: 'Remove or tone down explicit content. Use neutral, descriptive language.',
    retryable: true,
  },
  sexual: {
    strategy: 'less-explicit',
    suggestion: 'Remove sexual references. Reframe the scene in non-suggestive terms.',
    retryable: true,
  },
  copyrighted_character: {
    strategy: 'remove-copyrighted',
    suggestion:
      'Avoid named copyrighted characters. Replace with original or generic character descriptions.',
    retryable: true,
  },
  logo: {
    strategy: 'remove-copyrighted',
    suggestion: 'Remove references to specific brand logos or trademarks.',
    retryable: true,
  },
  trademark: {
    strategy: 'remove-copyrighted',
    suggestion: 'Avoid mentioning trademarked names or branded imagery.',
    retryable: true,
  },
  language: {
    strategy: 'soften-language',
    suggestion: 'Replace blocked language with neutral synonyms or rephrase the sentence.',
    retryable: true,
  },
  blocklist: {
    strategy: 'soften-language',
    suggestion: 'A specific term triggered the blocklist. Rephrase using synonyms.',
    retryable: true,
  },
};

const UNKNOWN_HINT: VideoRephraseHint = {
  strategy: 'unknown',
  suggestion:
    'The block reason is unrecognized. Try paraphrasing the entire prompt to reduce safety risk.',
  retryable: false,
};

export function detectVideoSafetyBlock(operationResponse: {
  raiMediaFilteredReasons?: string[];
  raiMediaFilteredCount?: number;
}): SafetyBlockError | null {
  const reasons = operationResponse.raiMediaFilteredReasons ?? [];
  const count = operationResponse.raiMediaFilteredCount ?? 0;
  if (count === 0 && reasons.length === 0) return null;
  return new SafetyBlockError(`Veo filtered ${count} videos: ${reasons.join(', ')}`, {
    suggested_rephrasing: true,
    blockReason: reasons[0] ?? 'unknown',
  });
}

export function suggestVideoRephrase(err: SafetyBlockError): VideoRephraseHint {
  const ctx = err.context as Record<string, unknown> | undefined;
  const reason =
    typeof ctx?.blockReason === 'string' ? ctx.blockReason.toLowerCase() : undefined;

  if (!reason) return UNKNOWN_HINT;
  return REASON_MAP[reason] ?? UNKNOWN_HINT;
}
