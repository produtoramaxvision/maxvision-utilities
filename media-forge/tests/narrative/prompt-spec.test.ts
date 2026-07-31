import { describe, it, expect } from 'vitest';
import {
  OPENING_STATE_SOURCES,
  SEQUENCE_RELATIONS,
} from '../../src/narrative/enums.js';
import { PromptSpec, parsePromptSpec, type PromptSpecT } from '../../src/narrative/prompt-spec.js';

function makePromptSpec(overrides: Partial<PromptSpecT> = {}): PromptSpecT {
  return {
    project_id: 'proj-1',
    clip_id: 'clip-1',
    prompt_version: 'v1',
    sequence_relation: 'standalone',
    generation_mode: 'text_to_video',
    reference_roles: [],
    opening_state_source: 'planned_start_state',
    current_clip_action: 'walks toward the door',
    endpoint: 'reaches out to the handle',
    completed_beat_exclusions: [],
    reserved_future_exclusions: [],
    natural_language_prompt: 'A cinematic tracking shot of a figure approaching a door.',
    ...overrides,
  };
}

describe('PromptSpec', () => {
  it('parses a valid spec', () => {
    expect(() => PromptSpec.parse(makePromptSpec())).not.toThrow();
  });

  it('rejects an unknown extra key (.strict())', () => {
    const withExtra = { ...makePromptSpec(), unexpected_field: 'x' };
    expect(() => PromptSpec.parse(withExtra)).toThrow();
  });

  it('accepts every declared sequence_relation and rejects a bogus one', () => {
    for (const sequence_relation of SEQUENCE_RELATIONS) {
      expect(() => PromptSpec.parse(makePromptSpec({ sequence_relation }))).not.toThrow();
    }
    expect(() =>
      PromptSpec.parse(makePromptSpec({ sequence_relation: 'made_up_relation' as never })),
    ).toThrow();
  });

  it('accepts every declared opening_state_source and rejects a bogus one', () => {
    for (const opening_state_source of OPENING_STATE_SOURCES) {
      expect(() => PromptSpec.parse(makePromptSpec({ opening_state_source }))).not.toThrow();
    }
    expect(() =>
      PromptSpec.parse(makePromptSpec({ opening_state_source: 'made_up_source' as never })),
    ).toThrow();
  });

  it('natural_language_prompt rejects an empty string (the string actually sent to the provider)', () => {
    expect(() =>
      PromptSpec.parse(makePromptSpec({ natural_language_prompt: '' })),
    ).toThrow();
  });
});

describe('parsePromptSpec', () => {
  it('returns the parsed spec when no provider is supplied (budget check skipped)', () => {
    const spec = makePromptSpec();
    expect(parsePromptSpec(spec)).toEqual(spec);
  });
});
