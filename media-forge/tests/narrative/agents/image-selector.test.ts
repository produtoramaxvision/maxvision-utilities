import { describe, it, expect } from 'vitest';
import {
  parseReferenceSelection,
  selectReferences,
  parseBestImageSelection,
  winningTake,
  type ReferenceCandidate,
  type ReferenceSelectorInput,
  type TakeCandidate,
  type BestImageSelectorInput,
  type BestImageSelectionT,
} from '../../../src/narrative/agents/image-selector.js';

function makeCandidate(overrides: Partial<ReferenceCandidate> = {}): ReferenceCandidate {
  return { assetId: 'asset_1', description: 'hero close up', characterTag: 'hero', ...overrides };
}

function makeRefInput(overrides: Partial<ReferenceSelectorInput> = {}): ReferenceSelectorInput {
  return {
    shotId: 'shot_1',
    shotAction: 'hero walks',
    requiredCharacterTags: ['hero'],
    candidates: [makeCandidate()],
    maxReferences: 2,
    ...overrides,
  };
}

function makeTake(overrides: Partial<TakeCandidate> = {}): TakeCandidate {
  return { takeId: 'take_1', assetPath: '/tmp/take1.png', ...overrides };
}

function makeBestInput(overrides: Partial<BestImageSelectorInput> = {}): BestImageSelectorInput {
  return {
    shotId: 'shot_1',
    shotAction: 'hero walks',
    establishedLook: 'red jacket',
    candidates: [makeTake()],
    ...overrides,
  };
}

describe('parseReferenceSelection', () => {
  it('rejects selecting an unknown assetId', () => {
    const raw = { selected: [{ assetId: 'ghost', reason: 'x' }] };
    expect(() => parseReferenceSelection(raw, makeRefInput())).toThrow(/unknown assetId/);
  });

  it('rejects selecting the same assetId twice', () => {
    const raw = {
      selected: [
        { assetId: 'asset_1', reason: 'a' },
        { assetId: 'asset_1', reason: 'b' },
      ],
    };
    expect(() => parseReferenceSelection(raw, makeRefInput())).toThrow(/selected twice/);
  });

  it('rejects a selection exceeding maxReferences', () => {
    const input = makeRefInput({
      maxReferences: 1,
      requiredCharacterTags: [],
      candidates: [
        makeCandidate({ assetId: 'a1', characterTag: undefined }),
        makeCandidate({ assetId: 'a2', characterTag: undefined }),
      ],
    });
    const raw = {
      selected: [
        { assetId: 'a1', reason: 'x' },
        { assetId: 'a2', reason: 'y' },
      ],
    };
    expect(() => parseReferenceSelection(raw, input)).toThrow(/the provider accepts/);
  });

  it('rejects when a required character has no anchoring reference selected', () => {
    const input = makeRefInput({
      requiredCharacterTags: ['villain'],
      candidates: [makeCandidate({ assetId: 'a1', characterTag: 'hero' })],
    });
    const raw = { selected: [{ assetId: 'a1', reason: 'x' }] };
    expect(() => parseReferenceSelection(raw, input)).toThrow(
      /no selected reference/,
    );
  });

  it('accepts a valid selection covering the required character', () => {
    const raw = { selected: [{ assetId: 'asset_1', reason: 'anchors hero face' }] };
    expect(() => parseReferenceSelection(raw, makeRefInput())).not.toThrow();
  });
});

describe('selectReferences', () => {
  it('throws when maxReferences is below 1, before any agent call is made', async () => {
    await expect(selectReferences(makeRefInput({ maxReferences: 0 }))).rejects.toThrow(
      /at least 1/,
    );
  });
});

describe('parseBestImageSelection', () => {
  it('rejects ranking an unknown takeId', () => {
    const raw = { ranking: [{ takeId: 'ghost', score: 5, reason: 'x' }] };
    expect(() => parseBestImageSelection(raw, makeBestInput())).toThrow(/unknown takeId/);
  });

  it('rejects ranking the same takeId twice', () => {
    const input = makeBestInput({ candidates: [makeTake({ takeId: 'take_1' })] });
    const raw = {
      ranking: [
        { takeId: 'take_1', score: 5, reason: 'a' },
        { takeId: 'take_1', score: 3, reason: 'b' },
      ],
    };
    expect(() => parseBestImageSelection(raw, input)).toThrow(/ranked twice/);
  });

  it('rejects an omitted candidate — it was paid for and has no fallback ordering', () => {
    const input = makeBestInput({
      candidates: [makeTake({ takeId: 'take_1' }), makeTake({ takeId: 'take_2' })],
    });
    const raw = { ranking: [{ takeId: 'take_1', score: 8, reason: 'x' }] };
    expect(() => parseBestImageSelection(raw, input)).toThrow(/left unranked/);
  });
});

describe('winningTake', () => {
  it('returns the highest-scored take even when the array is ordered worst-first', () => {
    // The code deliberately sorts rather than trusting the model's stated
    // ordering. Silently keeping the wrong take is invisible until someone
    // watches the finished cut.
    const selection: BestImageSelectionT = {
      ranking: [
        { takeId: 'worst', score: 1, reason: 'x' },
        { takeId: 'middle', score: 5, reason: 'y' },
        { takeId: 'best', score: 9, reason: 'z' },
      ],
    };
    expect(winningTake(selection)).toBe('best');
  });

  it('resolves a tie to the earlier entry', () => {
    const selection: BestImageSelectionT = {
      ranking: [
        { takeId: 'first', score: 7, reason: 'x' },
        { takeId: 'second', score: 7, reason: 'y' },
      ],
    };
    expect(winningTake(selection)).toBe('first');
  });
});
