import { describe, it, expect } from 'vitest';
import { assembleProjectState, type AssemblePlanInput } from '../../src/narrative/planner.js';
import { parseProjectState } from '../../src/narrative/project-state.js';
import type { CharacterExtractorResultT } from '../../src/narrative/agents/character-extractor.js';
import type { ScreenwriterResultT } from '../../src/narrative/agents/screenwriter.js';
import type { ScriptPlannerResultT } from '../../src/narrative/agents/script-planner.js';
import type { StoryboardArtistResultT } from '../../src/narrative/agents/storyboard-artist.js';

// Fixture shape: 2 characters, 4 beats, 2 scenes, storyboards for both.
//
// Scene ids here are underscore-free ("scenea"/"sceneb") only because that is
// how the fixture was first written; nothing depends on it any more.
//
// It used to matter. An earlier assembler recovered a shot_id from a clip_id by
// splitting on "_" and dropping two segments, which assumed scene_id contained
// no underscore — and ScriptPlannerScene.scene_id is z.string().min(1) with no
// format restriction, unlike beat_id/shot_id/tag. With scene_id "scene_a", a
// shot chaining from a sibling resolved to parent_clip_id: null, and
// parseProjectState accepted it because null is a legal parent: a corrupted
// chain that validates clean. The assembler now carries an explicit
// clip_id -> shot map instead of reconstructing one, so the format assumption
// is gone. See the underscore regression test at the bottom of this file, which
// is the case that used to fail.
const CAST: CharacterExtractorResultT = {
  characters: [
    { tag: 'hero', name: 'Hero', appearance: 'tall, dark coat', role: 'protagonist', needsVisualAnchor: true },
    { tag: 'villain', name: 'Villain', appearance: 'pale, sharp suit', role: 'antagonist', needsVisualAnchor: true },
  ],
};

const SCREENPLAY: ScreenwriterResultT = {
  logline: 'a stranger arrives',
  story_promise: 'the town will change',
  objective: 'find the well',
  initial_condition: 'drought',
  final_outcome: 'rain',
  tone: 'somber',
  medium: 'video',
  beats: [
    { beat_id: 'beat_intro', description: 'hero arrives', narrative_function: 'setup', dependencies: [] },
    {
      beat_id: 'beat_conflict',
      description: 'villain confronts hero',
      narrative_function: 'conflict',
      dependencies: ['beat_intro'],
    },
    {
      beat_id: 'beat_climax',
      description: 'hero fights back',
      narrative_function: 'climax',
      dependencies: ['beat_conflict'],
    },
    {
      beat_id: 'beat_resolution',
      description: 'peace restored',
      narrative_function: 'resolution',
      dependencies: ['beat_climax'],
    },
  ],
};

// scenea carries the 3-shot chain (beat_intro -> beat_conflict -> beat_climax);
// sceneb carries the single closing beat.
const SCENES: ScriptPlannerResultT = {
  scenes: [
    {
      scene_id: 'scenea',
      scene_index: 1,
      narrative_function: 'setup through climax',
      arc_position: 'rising',
      location: 'town square',
      time_of_day: 'day',
      anchor_source: [],
      max_chain_depth: 3,
      audio_plan: 'tense strings',
      assigned_beat_ids: ['beat_intro', 'beat_conflict', 'beat_climax'],
      transition_out: 'cut',
      status: 'planned',
    },
    {
      scene_id: 'sceneb',
      scene_index: 2,
      narrative_function: 'resolution',
      arc_position: 'release',
      location: 'town square',
      time_of_day: 'evening',
      anchor_source: [],
      max_chain_depth: 3,
      audio_plan: 'calm strings',
      assigned_beat_ids: ['beat_resolution'],
      transition_out: 'cut',
      status: 'planned',
    },
  ],
};

const STORYBOARD_A: StoryboardArtistResultT = {
  shots: [
    {
      shot_id: 'shot_a1',
      shot_index: 1,
      delivers_beat_ids: ['beat_intro'],
      action: 'hero arrives',
      camera: 'wide',
      character_tags: ['hero'],
      shot_structure: 'compact_single_take',
      chain_from: null,
      duration_sec: 3,
    },
    {
      shot_id: 'shot_a2',
      shot_index: 2,
      delivers_beat_ids: ['beat_conflict'],
      action: 'villain confronts hero',
      camera: 'medium',
      character_tags: ['hero', 'villain'],
      shot_structure: 'compact_single_take',
      chain_from: 'shot_a1',
      duration_sec: 3,
    },
    {
      shot_id: 'shot_a3',
      shot_index: 3,
      delivers_beat_ids: ['beat_climax'],
      action: 'hero fights back',
      camera: 'close',
      character_tags: ['hero', 'villain'],
      shot_structure: 'compact_single_take',
      chain_from: 'shot_a2',
      duration_sec: 3,
    },
  ],
};

const STORYBOARD_B: StoryboardArtistResultT = {
  shots: [
    {
      shot_id: 'shot_b1',
      shot_index: 1,
      delivers_beat_ids: ['beat_resolution'],
      action: 'peace restored',
      camera: 'wide',
      character_tags: ['hero'],
      shot_structure: 'compact_single_take',
      chain_from: null,
      duration_sec: 4,
    },
  ],
};

function makeStoryboards(): Map<string, StoryboardArtistResultT> {
  return new Map([
    ['scenea', STORYBOARD_A],
    ['sceneb', STORYBOARD_B],
  ]);
}

function makeAssembleInput(overrides: Partial<AssemblePlanInput> = {}): AssemblePlanInput {
  return {
    projectId: 'proj_test',
    cast: CAST,
    screenplay: SCREENPLAY,
    scenes: SCENES,
    storyboards: makeStoryboards(),
    surface: {},
    nowIso: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('assembleProjectState', () => {
  it('assembles a state parseProjectState accepts, with clips/scenes/current_clip_id populated', () => {
    const state = assembleProjectState(makeAssembleInput());

    expect(() => parseProjectState(state)).not.toThrow();
    expect(state.clips).toHaveLength(4);

    const sceneA = state.scenes.find((s) => s.scene_id === 'scenea');
    const sceneB = state.scenes.find((s) => s.scene_id === 'sceneb');
    expect(sceneA?.assigned_clip_ids).toHaveLength(3);
    expect(sceneB?.assigned_clip_ids).toHaveLength(1);

    expect(state.current_clip_id).toBe(state.clips[0]?.clip_id);

    expect(state.reference_registry).toEqual([
      { tag: 'hero', role: 'protagonist', preserve_exact_tag: true },
      { tag: 'villain', role: 'antagonist', preserve_exact_tag: true },
    ]);
  });

  it('throws when a scene has no storyboard, naming the scene it would silently strand', () => {
    const onlySceneA = new Map([['scenea', STORYBOARD_A]]); // sceneb missing on purpose
    expect(() =>
      assembleProjectState(makeAssembleInput({ storyboards: onlySceneA })),
    ).toThrow(/sceneb/);
  });

  it('resolves parent_clip_id from chain_from to the sibling clip_id, not the bare shot_id', () => {
    const state = assembleProjectState(makeAssembleInput());
    const clipA1 = state.clips.find((c) => c.clip_id === 'clip_scenea_shot_a1');
    const clipA2 = state.clips.find((c) => c.clip_id === 'clip_scenea_shot_a2');
    expect(clipA1).toBeDefined();
    expect(clipA2?.parent_clip_id).toBe(clipA1?.clip_id);
    expect(clipA2?.parent_clip_id).not.toBe('shot_a1');
  });

  it('computes extension_depth matching the real parent chain for a 3-shot chain: 0, 1, 2', () => {
    const state = assembleProjectState(makeAssembleInput());
    const byId = new Map(state.clips.map((c) => [c.clip_id, c]));
    expect(byId.get('clip_scenea_shot_a1')?.extension_depth).toBe(0);
    expect(byId.get('clip_scenea_shot_a2')?.extension_depth).toBe(1);
    expect(byId.get('clip_scenea_shot_a3')?.extension_depth).toBe(2);
  });

  it('keeps already_happened, this_clip_only, and reserved_for_later disjoint for every clip', () => {
    // parseClipContract's rule: a beat in two of these lists produces a
    // self-contradicting prompt (told both to stage it and that it already
    // happened, or both stage it now and reserve it for later).
    const state = assembleProjectState(makeAssembleInput());
    for (const clip of state.clips) {
      const a = new Set(clip.already_happened);
      const b = new Set(clip.this_clip_only);
      const c = new Set(clip.reserved_for_later);
      const overlapsAny =
        [...a].some((id) => b.has(id) || c.has(id)) || [...b].some((id) => c.has(id));
      expect(overlapsAny).toBe(false);
    }
  });

  it('honours nowIso so assembly is deterministic', () => {
    const state = assembleProjectState(makeAssembleInput({ nowIso: '2020-05-05T00:00:00.000Z' }));
    expect(state.updated_at).toBe('2020-05-05T00:00:00.000Z');
  });

  it('sets project_mode to sequence_project when more than one clip is produced', () => {
    const state = assembleProjectState(makeAssembleInput());
    expect(state.project_mode).toBe('sequence_project');
  });

  it('sets project_mode to standalone_clip for a single clip', () => {
    const singleScreenplay: ScreenwriterResultT = {
      ...SCREENPLAY,
      beats: [{ beat_id: 'beat_only', description: 'x', narrative_function: 'y', dependencies: [] }],
    };
    const singleScenes: ScriptPlannerResultT = {
      scenes: [
        {
          scene_id: 'sceneonly',
          scene_index: 1,
          narrative_function: 'x',
          arc_position: 'open',
          location: 'x',
          time_of_day: 'day',
          anchor_source: [],
          max_chain_depth: 0,
          audio_plan: 'x',
          assigned_beat_ids: ['beat_only'],
          transition_out: 'cut',
          status: 'planned',
        },
      ],
    };
    const singleStoryboard: StoryboardArtistResultT = {
      shots: [
        {
          shot_id: 'shot_only',
          shot_index: 1,
          delivers_beat_ids: ['beat_only'],
          action: 'x',
          camera: 'x',
          character_tags: [],
          shot_structure: 'compact_single_take',
          chain_from: null,
          duration_sec: 3,
        },
      ],
    };

    const state = assembleProjectState(
      makeAssembleInput({
        screenplay: singleScreenplay,
        scenes: singleScenes,
        storyboards: new Map([['sceneonly', singleStoryboard]]),
      }),
    );
    expect(state.project_mode).toBe('standalone_clip');
  });
});

describe('assembleProjectState — scene_id containing an underscore (regression)', () => {
  // The exact case that used to corrupt silently. The assembler once recovered a
  // shot_id out of `clip_<sceneId>_<shotId>` by splitting on "_", so a scene_id
  // with its own underscore shifted the split and the shot was never found:
  // parent_clip_id became null, extension_depth became 0, and parseProjectState
  // accepted the document because null is a legal parent.
  //
  // That is the worst shape a bug can take here — a broken chain that validates.
  // The assembler now records clip_id -> shot when it mints the clip instead of
  // parsing it back out, so the id format carries no meaning at all.
  const screenplay: ScreenwriterResultT = {
    logline: 'l',
    story_promise: 'p',
    objective: 'o',
    initial_condition: 'i',
    final_outcome: 'f',
    tone: 't',
    medium: 'm',
    beats: [
      { beat_id: 'beat_one', description: 'first', narrative_function: 'setup', dependencies: [] },
      {
        beat_id: 'beat_two',
        description: 'second',
        narrative_function: 'turn',
        dependencies: ['beat_one'],
      },
    ],
  };

  const scenes: ScriptPlannerResultT = {
    scenes: [
      {
        scene_id: 'scene_a', // <- the underscore that used to break it
        scene_index: 1,
        narrative_function: 'setup',
        arc_position: 'open',
        location: 'street',
        time_of_day: 'dusk',
        anchor_source: [],
        max_chain_depth: 3,
        audio_plan: 'ambient',
        assigned_beat_ids: ['beat_one', 'beat_two'],
        transition_out: 'cut',
        status: 'planned',
      },
    ],
  };

  const storyboard: StoryboardArtistResultT = {
    shots: [
      {
        shot_id: 'shot_a1',
        shot_index: 1,
        delivers_beat_ids: ['beat_one'],
        action: 'establishing',
        camera: 'wide',
        character_tags: [],
        shot_structure: 'compact_single_take',
        chain_from: null,
        duration_sec: 4,
      },
      {
        shot_id: 'shot_a2',
        shot_index: 2,
        delivers_beat_ids: ['beat_two'],
        action: 'continues',
        camera: 'push in',
        character_tags: [],
        shot_structure: 'compact_single_take',
        chain_from: 'shot_a1',
        duration_sec: 4,
      },
    ],
  };

  it('resolves parent_clip_id and extension_depth despite the underscore', () => {
    const state = assembleProjectState({
      projectId: 'proj_underscore',
      cast: { characters: [] },
      screenplay,
      scenes,
      storyboards: new Map([['scene_a', storyboard]]),
      surface: {},
      nowIso: '2026-07-30T00:00:00.000Z',
    });

    const first = state.clips.find((c) => c.clip_id.endsWith('shot_a1'));
    const second = state.clips.find((c) => c.clip_id.endsWith('shot_a2'));

    expect(first).toBeDefined();
    expect(second).toBeDefined();

    // The chain must actually resolve. `null` here is the silent corruption.
    expect(second!.parent_clip_id).toBe(first!.clip_id);
    expect(first!.parent_clip_id).toBeNull();

    expect(first!.extension_depth).toBe(0);
    expect(second!.extension_depth).toBe(1);
  });

  it('the assembled document still satisfies parseProjectState', () => {
    // parseProjectState checks extension_depth against the real parent chain, so
    // this would throw if the depth and the links disagreed.
    const state = assembleProjectState({
      projectId: 'proj_underscore2',
      cast: { characters: [] },
      screenplay,
      scenes,
      storyboards: new Map([['scene_a', storyboard]]),
      surface: {},
      nowIso: '2026-07-30T00:00:00.000Z',
    });
    expect(() => parseProjectState(state)).not.toThrow();
  });
});
