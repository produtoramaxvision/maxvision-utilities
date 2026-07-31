import { describe, it, expect } from 'vitest';
import {
  parseCharacterExtractorResult,
  type CharacterExtractorInput,
  type ExtractedCharacterT,
} from '../../../src/narrative/agents/character-extractor.js';
import { MAX_CHARACTERS } from '../../../src/narrative/agents/bounds.js';

function makeCharacter(overrides: Partial<ExtractedCharacterT> = {}): ExtractedCharacterT {
  return {
    tag: 'hero',
    name: 'Hero',
    appearance: 'tall, dark hair, red jacket',
    role: 'protagonist',
    needsVisualAnchor: true,
    ...overrides,
  };
}

function makeInput(overrides: Partial<CharacterExtractorInput> = {}): CharacterExtractorInput {
  return { brief: 'a stranger arrives in town', ...overrides };
}

describe('parseCharacterExtractorResult', () => {
  it('parses a valid single-character result', () => {
    const raw = { characters: [makeCharacter()] };
    expect(() => parseCharacterExtractorResult(raw, makeInput())).not.toThrow();
  });

  it('rejects an unknown extra key on a character (.strict())', () => {
    const raw = { characters: [{ ...makeCharacter(), extraField: 'nope' }] };
    expect(() => parseCharacterExtractorResult(raw, makeInput())).toThrow();
  });

  describe('tag shape', () => {
    it('accepts lower_snake_case', () => {
      const raw = { characters: [makeCharacter({ tag: 'main_hero_2' })] };
      expect(() => parseCharacterExtractorResult(raw, makeInput())).not.toThrow();
    });

    // Tags are embedded verbatim into every prompt that mentions the character.
    // Anything the regex would let a formatter reword (spaces, casing, a
    // leading digit) breaks that verbatim-match contract downstream.
    it.each(['Has Space', 'UPPER', '1leading'])('rejects "%s"', (tag) => {
      const raw = { characters: [makeCharacter({ tag })] };
      expect(() => parseCharacterExtractorResult(raw, makeInput())).toThrow();
    });
  });

  it('rejects duplicate tags — tags are identity tokens embedded verbatim in prompts', () => {
    const raw = {
      characters: [
        makeCharacter({ tag: 'hero', name: 'Hero One' }),
        makeCharacter({ tag: 'hero', name: 'Hero Two' }),
      ],
    };
    expect(() => parseCharacterExtractorResult(raw, makeInput())).toThrow(/duplicate character tag/);
  });

  describe('knownCharacters pinning', () => {
    it('recognises a pinned character present via a case-insensitive name match', () => {
      const raw = { characters: [makeCharacter({ tag: 'hero', name: 'Hero Prime' })] };
      expect(() =>
        parseCharacterExtractorResult(raw, makeInput({ knownCharacters: ['hero prime'] })),
      ).not.toThrow();
    });

    it('recognises a pinned character present via a tag match', () => {
      const raw = { characters: [makeCharacter({ tag: 'hero_prime', name: 'Someone Else' })] };
      expect(() =>
        parseCharacterExtractorResult(raw, makeInput({ knownCharacters: ['hero_prime'] })),
      ).not.toThrow();
    });

    it('rejects when extraction drops a pinned character entirely (no name or tag match)', () => {
      const raw = { characters: [makeCharacter({ tag: 'hero', name: 'Hero' })] };
      let caught: unknown;
      try {
        parseCharacterExtractorResult(raw, makeInput({ knownCharacters: ['villain'] }));
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      // ZodError.message is JSON.stringify(issues), which re-escapes the quotes
      // around "villain" as \" — matching those literally in a regex is brittle,
      // so check the substrings that survive escaping instead.
      const message = (caught as Error).message;
      expect(message).toContain('villain');
      expect(message).toContain('extraction dropped it');
    });
  });

  it('rejects more than MAX_CHARACTERS characters', () => {
    const characters = Array.from({ length: MAX_CHARACTERS + 1 }, (_, i) =>
      makeCharacter({ tag: `char_${i}`, name: `Char ${i}` }),
    );
    expect(() => parseCharacterExtractorResult({ characters }, makeInput())).toThrow(/cap is/);
  });
});
