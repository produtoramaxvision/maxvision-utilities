import { describe, it, expect } from 'vitest';
import {
  parseStoryboardResult,
  type StoryboardArtistInput,
  type StoryboardShotT,
} from '../../../src/narrative/agents/storyboard-artist.js';
import type { ExtractedCharacterT } from '../../../src/narrative/agents/character-extractor.js';

function makeCharacter(tag: string): ExtractedCharacterT {
  return { tag, name: tag, appearance: 'x', role: 'protagonist', needsVisualAnchor: true };
}

function makeShot(overrides: Partial<StoryboardShotT> = {}): StoryboardShotT {
  return {
    shot_id: 'shot_a',
    shot_index: 1,
    delivers_beat_ids: ['beat_a'],
    action: 'walks forward',
    camera: 'medium shot',
    character_tags: ['hero'],
    shot_structure: 'compact_single_take',
    chain_from: null,
    duration_sec: 4,
    ...overrides,
  };
}

function makeInput(overrides: Partial<StoryboardArtistInput> = {}): StoryboardArtistInput {
  return {
    sceneId: 'scene_1',
    sceneDescription: 'hero walks in',
    location: 'street',
    timeOfDay: 'day',
    beats: [{ beat_id: 'beat_a', description: 'x' }],
    characters: [makeCharacter('hero')],
    maxChainDepth: 3,
    targetDurationSec: null,
    ...overrides,
  };
}

describe('parseStoryboardResult', () => {
  it('rejects a shot_index gap', () => {
    const shots = [
      makeShot({ shot_id: 'shot_a', shot_index: 1, delivers_beat_ids: ['beat_a'] }),
      makeShot({ shot_id: 'shot_b', shot_index: 3, delivers_beat_ids: [] }),
    ];
    expect(() => parseStoryboardResult({ shots }, makeInput())).toThrow(/contiguous/);
  });

  it('rejects a duplicate shot_id', () => {
    const shots = [
      makeShot({ shot_id: 'shot_a', shot_index: 1 }),
      makeShot({ shot_id: 'shot_a', shot_index: 2 }),
    ];
    expect(() => parseStoryboardResult({ shots }, makeInput())).toThrow(/duplicate shot_id/);
  });

  it('rejects zero shots — nothing would be generated', () => {
    expect(() => parseStoryboardResult({ shots: [] }, makeInput())).toThrow(/zero shots/);
  });

  it('rejects an unknown character tag — it carries no appearance description', () => {
    const shots = [makeShot({ character_tags: ['ghost'] })];
    expect(() => parseStoryboardResult({ shots }, makeInput())).toThrow(/unknown character tag/);
  });

  it('rejects delivering an unknown beat', () => {
    const shots = [makeShot({ delivers_beat_ids: ['beat_ghost'] })];
    expect(() => parseStoryboardResult({ shots }, makeInput())).toThrow(/delivers unknown beat/);
  });

  it('rejects a beat delivered by no shot', () => {
    const shots = [makeShot({ delivers_beat_ids: [] })];
    expect(() => parseStoryboardResult({ shots }, makeInput())).toThrow(/delivered by no shot/);
  });

  it('rejects a beat delivered by two shots', () => {
    const shots = [
      makeShot({ shot_id: 'shot_a', shot_index: 1, delivers_beat_ids: ['beat_a'] }),
      makeShot({ shot_id: 'shot_b', shot_index: 2, delivers_beat_ids: ['beat_a'] }),
    ];
    expect(() => parseStoryboardResult({ shots }, makeInput())).toThrow(/delivered by 2 shots/);
  });

  it('rejects chain_from pointing at an unknown shot', () => {
    const shots = [makeShot({ chain_from: 'shot_ghost' })];
    expect(() => parseStoryboardResult({ shots }, makeInput())).toThrow(
      /chains from unknown shot/,
    );
  });

  it('rejects a shot chaining from itself', () => {
    const shots = [makeShot({ shot_id: 'shot_a', chain_from: 'shot_a' })];
    expect(() => parseStoryboardResult({ shots }, makeInput())).toThrow(/chains from itself/);
  });

  it('rejects a chain deeper than the scene max chain depth', () => {
    const beats = [
      { beat_id: 'beat_a', description: 'x' },
      { beat_id: 'beat_b', description: 'x' },
      { beat_id: 'beat_c', description: 'x' },
    ];
    const shots = [
      makeShot({ shot_id: 'shot_a', shot_index: 1, delivers_beat_ids: ['beat_a'], chain_from: null }),
      makeShot({
        shot_id: 'shot_b',
        shot_index: 2,
        delivers_beat_ids: ['beat_b'],
        chain_from: 'shot_a',
      }),
      makeShot({
        shot_id: 'shot_c',
        shot_index: 3,
        delivers_beat_ids: ['beat_c'],
        chain_from: 'shot_b',
      }),
    ];
    const input = makeInput({ beats, maxChainDepth: 1 });
    expect(() => parseStoryboardResult({ shots }, input)).toThrow(/caps at 1/);
  });

  it('accepts a chain exactly at the max chain depth cap', () => {
    const beats = [
      { beat_id: 'beat_a', description: 'x' },
      { beat_id: 'beat_b', description: 'x' },
      { beat_id: 'beat_c', description: 'x' },
    ];
    const shots = [
      makeShot({ shot_id: 'shot_a', shot_index: 1, delivers_beat_ids: ['beat_a'], chain_from: null }),
      makeShot({
        shot_id: 'shot_b',
        shot_index: 2,
        delivers_beat_ids: ['beat_b'],
        chain_from: 'shot_a',
      }),
      makeShot({
        shot_id: 'shot_c',
        shot_index: 3,
        delivers_beat_ids: ['beat_c'],
        chain_from: 'shot_b',
      }),
    ];
    // shot_c chains two links deep (shot_c -> shot_b -> shot_a); a cap of 2
    // must accept it exactly, not reject at the boundary.
    const input = makeInput({ beats, maxChainDepth: 2 });
    expect(() => parseStoryboardResult({ shots }, input)).not.toThrow();
  });

  it('rejects a chain cycle and completes rather than hanging', () => {
    const beats = [
      { beat_id: 'beat_a', description: 'x' },
      { beat_id: 'beat_b', description: 'x' },
    ];
    const shots = [
      makeShot({
        shot_id: 'shot_a',
        shot_index: 1,
        delivers_beat_ids: ['beat_a'],
        chain_from: 'shot_b',
      }),
      makeShot({
        shot_id: 'shot_b',
        shot_index: 2,
        delivers_beat_ids: ['beat_b'],
        chain_from: 'shot_a',
      }),
    ];
    // The chain-depth walk is bounded by a visited set in the implementation;
    // if that regressed to an unbounded walk this call would hang instead of
    // returning a rejection, and the timeout itself would be the failure signal.
    const input = makeInput({ beats, maxChainDepth: 3 });
    expect(() => parseStoryboardResult({ shots }, input)).toThrow(/chain cycle/);
  });
});
