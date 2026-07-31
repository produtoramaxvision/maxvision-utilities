import { describe, it, expect } from 'vitest';
import {
  parseScreenwriterResult,
  type ScreenwriterInput,
  type ScreenwriterBeatT,
} from '../../../src/narrative/agents/screenwriter.js';
import { MAX_BEATS } from '../../../src/narrative/agents/bounds.js';

function makeBeat(overrides: Partial<ScreenwriterBeatT> = {}): ScreenwriterBeatT {
  return {
    beat_id: 'beat_intro',
    description: 'the hero arrives',
    narrative_function: 'setup',
    dependencies: [],
    ...overrides,
  };
}

function makeInput(overrides: Partial<ScreenwriterInput> = {}): ScreenwriterInput {
  return { brief: 'a short ad', characters: [], targetDurationSec: null, ...overrides };
}

function makeResult(beats: ScreenwriterBeatT[]): unknown {
  return {
    logline: 'a stranger arrives',
    story_promise: 'the town will change',
    objective: 'find the well',
    initial_condition: 'drought',
    final_outcome: 'rain',
    tone: 'somber',
    medium: 'video',
    beats,
  };
}

describe('parseScreenwriterResult', () => {
  it('parses a valid beat list', () => {
    const beats = [
      makeBeat({ beat_id: 'beat_intro' }),
      makeBeat({ beat_id: 'beat_end', dependencies: ['beat_intro'] }),
    ];
    expect(() => parseScreenwriterResult(makeResult(beats), makeInput())).not.toThrow();
  });

  it('rejects more than MAX_BEATS beats', () => {
    const beats = Array.from({ length: MAX_BEATS + 1 }, (_, i) =>
      makeBeat({ beat_id: `beat_${i}` }),
    );
    expect(() => parseScreenwriterResult(makeResult(beats), makeInput())).toThrow(/cap is/);
  });

  it('rejects a duplicate beat_id', () => {
    const beats = [makeBeat({ beat_id: 'beat_a' }), makeBeat({ beat_id: 'beat_a' })];
    expect(() => parseScreenwriterResult(makeResult(beats), makeInput())).toThrow(
      /duplicate beat_id/,
    );
  });

  it('rejects a dependency referencing a nonexistent beat_id', () => {
    const beats = [makeBeat({ beat_id: 'beat_a', dependencies: ['beat_ghost'] })];
    expect(() => parseScreenwriterResult(makeResult(beats), makeInput())).toThrow(
      /unknown beat_id/,
    );
  });

  it('rejects a beat depending on itself', () => {
    const beats = [makeBeat({ beat_id: 'beat_a', dependencies: ['beat_a'] })];
    expect(() => parseScreenwriterResult(makeResult(beats), makeInput())).toThrow(
      /depends on itself/,
    );
  });

  it('rejects a two-beat cycle and completes rather than hanging', () => {
    const beats = [
      makeBeat({ beat_id: 'beat_a', dependencies: ['beat_b'] }),
      makeBeat({ beat_id: 'beat_b', dependencies: ['beat_a'] }),
    ];
    // If assertNoDependencyCycle ever regressed into unbounded recursion, this
    // call would simply never return and the test would time out instead of
    // failing cleanly — that timeout is itself the failure signal for a real
    // hang, not a flake.
    expect(() => parseScreenwriterResult(makeResult(beats), makeInput())).toThrow(/cycle/);
  });

  it('rejects a three-beat cycle and completes rather than hanging', () => {
    const beats = [
      makeBeat({ beat_id: 'beat_a', dependencies: ['beat_c'] }),
      makeBeat({ beat_id: 'beat_b', dependencies: ['beat_a'] }),
      makeBeat({ beat_id: 'beat_c', dependencies: ['beat_b'] }),
    ];
    expect(() => parseScreenwriterResult(makeResult(beats), makeInput())).toThrow(/cycle/);
  });

  it('accepts a diamond-shaped DAG (d depends on b and c, both depend on a)', () => {
    // Proves the cycle check does not reject legitimate shared dependencies:
    // b and c both pointing back at a is convergence, not a cycle.
    const beats = [
      makeBeat({ beat_id: 'beat_a', dependencies: [] }),
      makeBeat({ beat_id: 'beat_b', dependencies: ['beat_a'] }),
      makeBeat({ beat_id: 'beat_c', dependencies: ['beat_a'] }),
      makeBeat({ beat_id: 'beat_d', dependencies: ['beat_b', 'beat_c'] }),
    ];
    expect(() => parseScreenwriterResult(makeResult(beats), makeInput())).not.toThrow();
  });
});
