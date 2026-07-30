import { describe, it, expect } from 'vitest';
import {
  ARC_POSITIONS,
  CLIP_STATUSES,
  PLANNING_STATUSES,
  PROJECT_MODES,
} from '../../src/narrative/enums.js';
import {
  ProjectState,
  ReferenceEntry,
  Scene,
  Beat,
  Clip,
  validateProjectStateIntegrity,
  parseProjectState,
  assertMonotonicRevision,
  type ProjectStateT,
  type SceneT,
  type BeatT,
  type ClipT,
  type ReferenceEntryT,
} from '../../src/narrative/project-state.js';

const STORY = {
  logline: 'a stranger arrives',
  story_promise: 'the town will change',
  objective: 'find the well',
  initial_condition: 'drought',
  final_outcome: 'rain',
  target_duration_sec: null,
  tone: 'somber',
  medium: 'video',
};

function makeReference(overrides: Partial<ReferenceEntryT> = {}): ReferenceEntryT {
  return { tag: 'hero', role: 'protagonist', preserve_exact_tag: true, ...overrides };
}

function makeScene(overrides: Partial<SceneT> = {}): SceneT {
  return {
    scene_id: 'scene-1',
    scene_index: 1,
    narrative_function: 'setup',
    arc_position: 'open',
    location: 'well',
    time_of_day: 'dawn',
    anchor_source: [],
    max_chain_depth: 3,
    audio_plan: 'ambient wind',
    assigned_clip_ids: ['clip-1'],
    transition_out: 'cut',
    status: 'current',
    ...overrides,
  };
}

function makeBeat(overrides: Partial<BeatT> = {}): BeatT {
  return {
    beat_id: 'beat-1',
    description: 'stranger looks at the well',
    narrative_function: 'inciting',
    status: 'current',
    assigned_clip_id: 'clip-1',
    dependencies: [],
    ...overrides,
  };
}

function makeClip(overrides: Partial<ClipT> = {}): ClipT {
  return {
    clip_id: 'clip-1',
    parent_clip_id: null,
    scene_id: 'scene-1',
    sequence_index: 1,
    prompt_version: 'v1',
    generation_mode: 'text_to_video',
    status: 'planned',
    narrative_job: 'establish the well',
    felt_intent: 'quiet unease',
    already_happened: [],
    this_clip_only: [],
    reserved_for_later: [],
    planned_start_state: {},
    planned_end_state: {},
    observed_start_state: null,
    observed_end_state: null,
    continuity_locks: [],
    allowed_changes: [],
    continuity_breaks: [],
    accepted_deviations: [],
    transition_in: 'cut',
    transition_out: 'cut',
    open_motion_vectors: [],
    handoff_requirements: [],
    extension_depth: 0,
    ...overrides,
  };
}

function makeProjectState(overrides: Partial<ProjectStateT> = {}): ProjectStateT {
  return {
    schema_version: '1.0',
    state_revision: 1,
    project_id: 'proj-1',
    project_mode: 'sequence_project',
    surface: {},
    clip_budget_sec: null,
    prompt_budget: null,
    story: STORY,
    world_bible: {},
    reference_registry: [],
    scenes: [makeScene()],
    beats: [makeBeat()],
    clips: [makeClip()],
    take_history: [],
    current_clip_id: '',
    canon_revision: 1,
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ProjectState', () => {
  it('parses a valid state', () => {
    expect(() => ProjectState.parse(makeProjectState())).not.toThrow();
  });

  it('rejects an unknown extra key (.strict())', () => {
    const withExtra = { ...makeProjectState(), unexpected_field: 'x' };
    expect(() => ProjectState.parse(withExtra)).toThrow();
  });

  it('accepts every declared project_mode and rejects a bogus one', () => {
    for (const project_mode of PROJECT_MODES) {
      expect(() => ProjectState.parse(makeProjectState({ project_mode }))).not.toThrow();
    }
    expect(() =>
      ProjectState.parse(makeProjectState({ project_mode: 'made_up_mode' as never })),
    ).toThrow();
  });

  it('clip_budget_sec accepts null but rejects being entirely absent', () => {
    expect(() =>
      ProjectState.parse(makeProjectState({ clip_budget_sec: null })),
    ).not.toThrow();
    const { clip_budget_sec: _drop, ...withoutField } = makeProjectState();
    expect(() => ProjectState.parse(withoutField)).toThrow();
  });
});

describe('Story.target_duration_sec', () => {
  it('accepts null but rejects being entirely absent', () => {
    expect(() =>
      ProjectState.parse(
        makeProjectState({ story: { ...STORY, target_duration_sec: null } }),
      ),
    ).not.toThrow();
    const { target_duration_sec: _drop, ...storyWithoutField } = STORY;
    expect(() =>
      ProjectState.parse(makeProjectState({ story: storyWithoutField as never })),
    ).toThrow();
  });
});

describe('ReferenceEntry.preserve_exact_tag', () => {
  it('accepts true but rejects false and rejects being absent', () => {
    expect(() => ReferenceEntry.parse(makeReference({ preserve_exact_tag: true }))).not.toThrow();
    expect(() =>
      ReferenceEntry.parse(makeReference({ preserve_exact_tag: false as never })),
    ).toThrow();
    const { preserve_exact_tag: _drop, ...withoutField } = makeReference();
    expect(() => ReferenceEntry.parse(withoutField)).toThrow();
  });
});

describe('Scene', () => {
  it('accepts every declared arc_position and status, rejects bogus values', () => {
    for (const arc_position of ARC_POSITIONS) {
      expect(() => Scene.parse(makeScene({ arc_position }))).not.toThrow();
    }
    for (const status of PLANNING_STATUSES) {
      expect(() => Scene.parse(makeScene({ status }))).not.toThrow();
    }
    expect(() => Scene.parse(makeScene({ arc_position: 'made_up' as never }))).toThrow();
    expect(() => Scene.parse(makeScene({ status: 'made_up' as never }))).toThrow();
  });

  it('max_chain_depth is bounded 0..3', () => {
    expect(() => Scene.parse(makeScene({ max_chain_depth: 0 }))).not.toThrow();
    expect(() => Scene.parse(makeScene({ max_chain_depth: 3 }))).not.toThrow();
    expect(() => Scene.parse(makeScene({ max_chain_depth: -1 }))).toThrow();
    expect(() => Scene.parse(makeScene({ max_chain_depth: 4 }))).toThrow();
  });
});

describe('Beat.assigned_clip_id', () => {
  it('accepts null but rejects being entirely absent', () => {
    expect(() => Beat.parse(makeBeat({ assigned_clip_id: null }))).not.toThrow();
    const { assigned_clip_id: _drop, ...withoutField } = makeBeat();
    expect(() => Beat.parse(withoutField)).toThrow();
  });
});

describe('Clip', () => {
  it('accepts every declared status and rejects a bogus one', () => {
    for (const status of CLIP_STATUSES) {
      expect(() => Clip.parse(makeClip({ status }))).not.toThrow();
    }
    expect(() => Clip.parse(makeClip({ status: 'made_up' as never }))).toThrow();
  });

  it('parent_clip_id accepts null but rejects being entirely absent', () => {
    expect(() => Clip.parse(makeClip({ parent_clip_id: null }))).not.toThrow();
    const { parent_clip_id: _drop, ...withoutField } = makeClip();
    expect(() => Clip.parse(withoutField)).toThrow();
  });

  it('observed_start_state / observed_end_state accept null but reject being entirely absent', () => {
    expect(() =>
      Clip.parse(makeClip({ observed_start_state: null, observed_end_state: null })),
    ).not.toThrow();
    const { observed_start_state: _a, ...withoutStart } = makeClip();
    expect(() => Clip.parse(withoutStart)).toThrow();
    const { observed_end_state: _b, ...withoutEnd } = makeClip();
    expect(() => Clip.parse(withoutEnd)).toThrow();
  });

  it('source_clip_tag is genuinely optional: absent, null, and a string all parse', () => {
    const { source_clip_tag: _drop, ...withoutField } = makeClip();
    expect(() => Clip.parse(withoutField)).not.toThrow();
    expect(() => Clip.parse(makeClip({ source_clip_tag: null }))).not.toThrow();
    expect(() => Clip.parse(makeClip({ source_clip_tag: 'ref-tag-1' }))).not.toThrow();
  });
});

describe('validateProjectStateIntegrity', () => {
  it('accepts current_clip_id === "" as the documented "no current clip yet" marker', () => {
    expect(validateProjectStateIntegrity(makeProjectState({ current_clip_id: '' }))).toEqual([]);
  });

  it('flags a duplicate clip_id', () => {
    const state = makeProjectState({ clips: [makeClip(), makeClip()] });
    const problems = validateProjectStateIntegrity(state);
    expect(problems.some((p) => p.includes('duplicate clip_id'))).toBe(true);
  });

  it('flags a duplicate scene_id', () => {
    const state = makeProjectState({ scenes: [makeScene(), makeScene()] });
    const problems = validateProjectStateIntegrity(state);
    expect(problems.some((p) => p.includes('duplicate scene_id'))).toBe(true);
  });

  it('flags a duplicate beat_id', () => {
    const state = makeProjectState({
      beats: [makeBeat({ assigned_clip_id: null }), makeBeat({ assigned_clip_id: null })],
    });
    const problems = validateProjectStateIntegrity(state);
    expect(problems.some((p) => p.includes('duplicate beat_id'))).toBe(true);
  });

  it('flags a clip referencing an unknown scene_id', () => {
    const state = makeProjectState({
      scenes: [],
      beats: [],
      clips: [makeClip({ scene_id: 'ghost-scene' })],
    });
    const problems = validateProjectStateIntegrity(state);
    expect(problems).toEqual([
      'clip clip-1 references unknown scene_id ghost-scene',
    ]);
  });

  it('flags a clip referencing an unknown parent_clip_id', () => {
    // The chain-walk still counts the phantom parent as one hop, so
    // extension_depth must be declared as 1 to keep this fixture isolated to
    // exactly the parent-reference problem.
    const state = makeProjectState({
      beats: [],
      clips: [makeClip({ parent_clip_id: 'ghost-parent', extension_depth: 1 })],
    });
    const problems = validateProjectStateIntegrity(state);
    expect(problems).toEqual([
      'clip clip-1 references unknown parent_clip_id ghost-parent',
    ]);
  });

  it('flags a clip that is its own parent', () => {
    const state = makeProjectState({
      beats: [],
      clips: [makeClip({ parent_clip_id: 'clip-1' })],
    });
    const problems = validateProjectStateIntegrity(state);
    expect(problems.some((p) => p.includes('is its own parent'))).toBe(true);
  });

  it('flags a scene assigning an unknown clip_id', () => {
    const state = makeProjectState({
      scenes: [makeScene({ assigned_clip_ids: ['ghost-clip'] })],
      beats: [],
    });
    const problems = validateProjectStateIntegrity(state);
    expect(problems).toEqual([
      'scene scene-1 assigns unknown clip_id ghost-clip',
    ]);
  });

  it('flags a beat assigning an unknown clip_id', () => {
    const state = makeProjectState({
      beats: [makeBeat({ assigned_clip_id: 'ghost-clip' })],
    });
    const problems = validateProjectStateIntegrity(state);
    expect(problems).toEqual([
      'beat beat-1 assigns unknown clip_id ghost-clip',
    ]);
  });

  it('flags a beat depending on an unknown beat', () => {
    const state = makeProjectState({
      beats: [makeBeat({ assigned_clip_id: null, dependencies: ['ghost-beat'] })],
    });
    const problems = validateProjectStateIntegrity(state);
    expect(problems).toEqual([
      'beat beat-1 depends on unknown beat_id ghost-beat',
    ]);
  });

  it('flags a beat depending on itself', () => {
    const state = makeProjectState({
      beats: [makeBeat({ assigned_clip_id: null, dependencies: ['beat-1'] })],
    });
    const problems = validateProjectStateIntegrity(state);
    expect(problems).toEqual(['beat beat-1 depends on itself']);
  });

  it('flags an unresolvable current_clip_id', () => {
    const state = makeProjectState({ current_clip_id: 'ghost-clip' });
    const problems = validateProjectStateIntegrity(state);
    expect(problems).toEqual([
      'current_clip_id ghost-clip is not a known clip',
    ]);
  });

  it('flags a duplicate reference tag', () => {
    const state = makeProjectState({
      reference_registry: [makeReference({ tag: 'hero' }), makeReference({ tag: 'hero' })],
    });
    const problems = validateProjectStateIntegrity(state);
    expect(problems.some((p) => p.includes('duplicate reference tag: hero'))).toBe(true);
  });

  it('flags extension_depth disagreeing with the real parent chain', () => {
    const state = makeProjectState({
      scenes: [makeScene({ assigned_clip_ids: ['clip-1', 'clip-2'] })],
      beats: [],
      clips: [
        makeClip({ clip_id: 'clip-1', parent_clip_id: null, extension_depth: 0 }),
        makeClip({ clip_id: 'clip-2', parent_clip_id: 'clip-1', extension_depth: 5 }),
      ],
    });
    const problems = validateProjectStateIntegrity(state);
    expect(problems).toEqual([
      'clip clip-2 declares extension_depth 5 but its parent chain is 1 deep',
    ]);
  });

  it('flags a parent cycle and terminates instead of hanging', () => {
    const state = makeProjectState({
      scenes: [makeScene({ assigned_clip_ids: ['clip-1', 'clip-2'] })],
      beats: [],
      clips: [
        makeClip({ clip_id: 'clip-1', parent_clip_id: 'clip-2' }),
        makeClip({ clip_id: 'clip-2', parent_clip_id: 'clip-1' }),
      ],
    });
    // If validateProjectStateIntegrity ever regresses into an unbounded walk on
    // a parent cycle, this call simply never returns and the test times out —
    // that timeout IS the failure signal for a real hang, not a flake.
    const problems = validateProjectStateIntegrity(state);
    const cycleProblems = problems.filter((p) => p.includes('parent cycle'));
    expect(cycleProblems).toHaveLength(2);
  });
});

describe('parseProjectState', () => {
  it('returns the parsed state when it is internally consistent', () => {
    const state = makeProjectState();
    expect(parseProjectState(state)).toEqual(state);
  });

  it('throws when an integrity rule is violated', () => {
    const state = makeProjectState({ current_clip_id: 'ghost-clip' });
    expect(() => parseProjectState(state)).toThrow();
  });
});

describe('assertMonotonicRevision', () => {
  it('throws when the incoming revision equals the stored revision', () => {
    expect(() =>
      assertMonotonicRevision({ storedRevision: 3, incomingRevision: 3, projectId: 'proj-1' }),
    ).toThrow();
  });

  it('throws when the incoming revision is lower than the stored revision', () => {
    expect(() =>
      assertMonotonicRevision({ storedRevision: 3, incomingRevision: 2, projectId: 'proj-1' }),
    ).toThrow();
  });

  it('passes when the incoming revision is higher than the stored revision', () => {
    expect(() =>
      assertMonotonicRevision({ storedRevision: 3, incomingRevision: 4, projectId: 'proj-1' }),
    ).not.toThrow();
  });
});
