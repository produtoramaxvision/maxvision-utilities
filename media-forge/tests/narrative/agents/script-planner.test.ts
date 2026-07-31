import { describe, it, expect } from 'vitest';
import {
  SCRIPT_PLAN_MODES,
  parseScriptPlannerResult,
  type ScriptPlannerInput,
  type ScriptPlannerSceneT,
} from '../../../src/narrative/agents/script-planner.js';
import type { ScreenwriterBeatT } from '../../../src/narrative/agents/screenwriter.js';
import { MAX_SCENES } from '../../../src/narrative/agents/bounds.js';

function makeBeat(beat_id: string): ScreenwriterBeatT {
  return { beat_id, description: 'x', narrative_function: 'y', dependencies: [] };
}

function makeScene(overrides: Partial<ScriptPlannerSceneT> = {}): ScriptPlannerSceneT {
  return {
    scene_id: 'scene_1',
    scene_index: 1,
    narrative_function: 'setup',
    arc_position: 'open',
    location: 'street',
    time_of_day: 'day',
    anchor_source: [],
    max_chain_depth: 2,
    audio_plan: 'ambient',
    assigned_beat_ids: [],
    transition_out: 'cut',
    status: 'planned',
    ...overrides,
  };
}

function makeInput(
  beats: ScreenwriterBeatT[],
  overrides: Partial<ScriptPlannerInput> = {},
): ScriptPlannerInput {
  return { beats, characters: [], mode: 'narrative', targetDurationSec: null, ...overrides };
}

describe('SCRIPT_PLAN_MODES', () => {
  it('is exactly narrative, motion, montage', () => {
    // The three modes disagree about what a scene boundary even means (see the
    // file header); a fourth mode here would need matching upstream semantics
    // this port has no reference behavior for.
    expect(SCRIPT_PLAN_MODES).toEqual(['narrative', 'motion', 'montage']);
  });
});

describe('parseScriptPlannerResult', () => {
  it('rejects a scene_index gap', () => {
    const beats = [makeBeat('beat_a'), makeBeat('beat_b')];
    const scenes = [
      makeScene({ scene_id: 's1', scene_index: 1, assigned_beat_ids: ['beat_a'] }),
      makeScene({ scene_id: 's2', scene_index: 3, assigned_beat_ids: ['beat_b'] }),
    ];
    expect(() => parseScriptPlannerResult({ scenes }, makeInput(beats))).toThrow(/contiguous/);
  });

  it('rejects a duplicate scene_index', () => {
    const beats = [makeBeat('beat_a'), makeBeat('beat_b')];
    const scenes = [
      makeScene({ scene_id: 's1', scene_index: 1, assigned_beat_ids: ['beat_a'] }),
      makeScene({ scene_id: 's2', scene_index: 1, assigned_beat_ids: ['beat_b'] }),
    ];
    expect(() => parseScriptPlannerResult({ scenes }, makeInput(beats))).toThrow(/contiguous/);
  });

  it('accepts contiguous scene_index starting at 1', () => {
    const beats = [makeBeat('beat_a'), makeBeat('beat_b')];
    const scenes = [
      makeScene({ scene_id: 's1', scene_index: 1, assigned_beat_ids: ['beat_a'] }),
      makeScene({ scene_id: 's2', scene_index: 2, assigned_beat_ids: ['beat_b'] }),
    ];
    expect(() => parseScriptPlannerResult({ scenes }, makeInput(beats))).not.toThrow();
  });

  it('rejects a duplicate scene_id', () => {
    const beats = [makeBeat('beat_a'), makeBeat('beat_b')];
    const scenes = [
      makeScene({ scene_id: 's1', scene_index: 1, assigned_beat_ids: ['beat_a'] }),
      makeScene({ scene_id: 's1', scene_index: 2, assigned_beat_ids: ['beat_b'] }),
    ];
    expect(() => parseScriptPlannerResult({ scenes }, makeInput(beats))).toThrow(
      /duplicate scene_id/,
    );
  });

  it('rejects max_chain_depth 4 (schema cap is 3)', () => {
    const beats = [makeBeat('beat_a')];
    const scenes = [makeScene({ assigned_beat_ids: ['beat_a'], max_chain_depth: 4 })];
    expect(() => parseScriptPlannerResult({ scenes }, makeInput(beats))).toThrow();
  });

  it.each([0, 3])('accepts max_chain_depth %d', (depth) => {
    const beats = [makeBeat('beat_a')];
    const scenes = [makeScene({ assigned_beat_ids: ['beat_a'], max_chain_depth: depth })];
    expect(() => parseScriptPlannerResult({ scenes }, makeInput(beats))).not.toThrow();
  });

  it('rejects assigned_beat_ids referencing an unknown beat', () => {
    const beats = [makeBeat('beat_a')];
    const scenes = [makeScene({ assigned_beat_ids: ['beat_ghost'] })];
    expect(() => parseScriptPlannerResult({ scenes }, makeInput(beats))).toThrow(
      /unknown beat_id/,
    );
  });

  it('rejects an input beat assigned to no scene — it would never be filmed', () => {
    const beats = [makeBeat('beat_a'), makeBeat('beat_b')];
    const scenes = [makeScene({ assigned_beat_ids: ['beat_a'] })];
    expect(() => parseScriptPlannerResult({ scenes }, makeInput(beats))).toThrow(
      /unassigned, never filmed/,
    );
  });

  it('rejects an input beat assigned to two scenes — it would be shot twice', () => {
    const beats = [makeBeat('beat_a')];
    const scenes = [
      makeScene({ scene_id: 's1', scene_index: 1, assigned_beat_ids: ['beat_a'] }),
      makeScene({ scene_id: 's2', scene_index: 2, assigned_beat_ids: ['beat_a'] }),
    ];
    expect(() => parseScriptPlannerResult({ scenes }, makeInput(beats))).toThrow(/shot twice/);
  });

  it('rejects more than MAX_SCENES scenes', () => {
    const beats = Array.from({ length: MAX_SCENES + 1 }, (_, i) => makeBeat(`beat_${i}`));
    const scenes = beats.map((b, i) =>
      makeScene({ scene_id: `s${i}`, scene_index: i + 1, assigned_beat_ids: [b.beat_id] }),
    );
    expect(() => parseScriptPlannerResult({ scenes }, makeInput(beats))).toThrow(/cap is/);
  });
});
