// tests/narrative/executor.test.ts
//
// Gate for src/narrative/executor.ts — the consumer T10 and T13 were built for.
//
// Everything here is pure: the executor reads a ProjectState and produces a
// contract, a prompt spec and a state transition. It never touches a provider or
// a database, which is exactly what makes these rules testable without spending
// anything. The handler tests cover persistence separately.
//
// The rules worth their weight are the ones that stop a PAID generation from
// being wrong: an extension dispatched before its parent has a frame to inherit,
// a chain past its scene's drift cap, and a low-confidence verdict silently
// authorising a retake.

import { describe, it, expect } from 'vitest';
import {
  selectNextClip,
  findDispatchBlockers,
  assertDispatchable,
  toClipContract,
  buildPromptSpec,
  composePrompt,
  resolveSequenceRelation,
  resolveOpeningStateSource,
  nextPromptVersion,
  applyDispatch,
  applyTakeReview,
} from '../../src/narrative/executor.js';
import type { ClipT, ProjectStateT, SceneT } from '../../src/narrative/project-state.js';
import type { TakeReviewT } from '../../src/review/take-review.js';

// ---------------------------------------------------------------------------
// Fixtures. Built to pass parseProjectState, since every state transition below
// re-validates through it — a fixture that could not round-trip would be testing
// something the production path never sees.
// ---------------------------------------------------------------------------

function makeScene(overrides: Partial<SceneT> = {}): SceneT {
  return {
    scene_id: 'scene_1',
    scene_index: 1,
    narrative_function: 'setup',
    arc_position: 'open',
    location: 'a kitchen',
    time_of_day: 'morning',
    anchor_source: [],
    max_chain_depth: 3,
    audio_plan: 'ambient',
    assigned_clip_ids: [],
    transition_out: 'cut',
    status: 'planned',
    ...overrides,
  };
}

function makeClip(overrides: Partial<ClipT> = {}): ClipT {
  return {
    clip_id: 'clip_a',
    parent_clip_id: null,
    scene_id: 'scene_1',
    sequence_index: 1,
    prompt_version: 'v1',
    generation_mode: 't2v',
    status: 'planned',
    narrative_job: 'she pours the coffee',
    felt_intent: 'quiet morning calm',
    shot_structure: 'compact_single_take',
    camera: 'slow push in, waist height',
    target_duration_sec: 5,
    already_happened: [],
    this_clip_only: ['beat_1'],
    reserved_for_later: ['beat_2'],
    planned_start_state: {},
    planned_end_state: {},
    observed_start_state: null,
    observed_end_state: null,
    continuity_locks: ['@ana'],
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

function makeState(overrides: Partial<ProjectStateT> = {}): ProjectStateT {
  const clips = overrides.clips ?? [makeClip()];
  const scenes = overrides.scenes ?? [makeScene({ assigned_clip_ids: clips.map((c) => c.clip_id) })];
  return {
    schema_version: '1.0.0',
    state_revision: 1,
    project_id: 'proj_test',
    project_mode: 'sequence_project',
    surface: {},
    clip_budget_sec: 10,
    prompt_budget: null,
    story: {
      logline: 'a quiet morning',
      story_promise: 'calm',
      objective: 'establish tone',
      initial_condition: 'asleep',
      final_outcome: 'awake',
      target_duration_sec: 10,
      tone: 'warm, unhurried',
      medium: 'film',
    },
    world_bible: {},
    reference_registry: [{ tag: '@ana', role: 'protagonist', preserve_exact_tag: true }],
    scenes,
    beats: [
      {
        beat_id: 'beat_1',
        description: 'she pours coffee',
        narrative_function: 'setup',
        status: 'planned',
        assigned_clip_id: clips[0]?.clip_id ?? null,
        dependencies: [],
      },
      {
        beat_id: 'beat_2',
        description: 'the phone rings',
        narrative_function: 'turn',
        status: 'planned',
        assigned_clip_id: null,
        dependencies: [],
      },
    ],
    clips,
    take_history: [],
    current_clip_id: clips[0]?.clip_id ?? '',
    canon_revision: 1,
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeReview(overrides: Partial<TakeReviewT> = {}): TakeReviewT {
  return {
    project_id: 'proj_test',
    clip_id: 'clip_a',
    take_id: 'take_1',
    source_status: 'generated',
    verdict: 'accept',
    observed_start_state: { light: 'dim' },
    observed_end_state: { light: 'bright' },
    completed_beats: ['beat_1'],
    incomplete_beats: [],
    unexpected_completed_beats: [],
    continuity_breaks: [],
    accepted_deviations: [],
    observation_confidence: 'high',
    uncertainties: [],
    requires_user_confirmation: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// selectNextClip
// ---------------------------------------------------------------------------

describe('selectNextClip', () => {
  it('prefers current_clip_id when it is still runnable', () => {
    const clips = [
      makeClip({ clip_id: 'clip_a', sequence_index: 1 }),
      makeClip({ clip_id: 'clip_b', sequence_index: 2 }),
    ];
    const state = makeState({ clips, current_clip_id: 'clip_b' });
    // The pointer the planner and any concurrent writer agree on wins over
    // sequence order; ignoring it would silently re-run an earlier clip.
    expect(selectNextClip(state)?.clip_id).toBe('clip_b');
  });

  it('falls back to the lowest runnable sequence_index, not document order', () => {
    const clips = [
      makeClip({ clip_id: 'clip_late', sequence_index: 9 }),
      makeClip({ clip_id: 'clip_early', sequence_index: 2 }),
    ];
    const state = makeState({ clips, current_clip_id: '' });
    // Deterministic: two callers racing on the same state must select the same
    // clip, so the revision guard resolves the conflict rather than both
    // generating different clips.
    expect(selectNextClip(state)?.clip_id).toBe('clip_early');
  });

  it('a clip in "repair" is runnable — the retake protocol depends on it', () => {
    const state = makeState({
      clips: [makeClip({ status: 'repair' })],
      current_clip_id: '',
    });
    expect(selectNextClip(state)?.clip_id).toBe('clip_a');
  });

  it('a clip in "reviewed" is NOT runnable — it has a take awaiting a verdict', () => {
    // Re-running it would pay for a second generation of something already in
    // hand, which is the whole reason `reviewed` is excluded.
    const state = makeState({ clips: [makeClip({ status: 'reviewed' })], current_clip_id: '' });
    expect(selectNextClip(state)).toBeNull();
  });

  it('returns null when nothing is left — the completion signal, not an error', () => {
    const state = makeState({ clips: [makeClip({ status: 'accepted' })], current_clip_id: '' });
    expect(selectNextClip(state)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Dispatch preconditions — the rules that stop a paid, wrong generation
// ---------------------------------------------------------------------------

describe('findDispatchBlockers', () => {
  it('refuses an extension whose parent has no take yet', () => {
    const clips = [
      makeClip({ clip_id: 'clip_a', sequence_index: 1, status: 'planned' }),
      makeClip({
        clip_id: 'clip_b',
        sequence_index: 2,
        parent_clip_id: 'clip_a',
        generation_mode: 'extend',
        extension_depth: 1,
      }),
    ];
    const state = makeState({ clips });

    const problems = findDispatchBlockers(state, clips[1]!);
    // An extension inherits the parent's LAST FRAME. With the parent still
    // planned there is no frame — the generation is billed and unusable, and
    // nothing downstream can tell that from a model quality problem.
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/still "planned"/);
    expect(problems[0]).toMatch(/no anchor/);
  });

  it('allows an extension once the parent has been generated', () => {
    const clips = [
      makeClip({ clip_id: 'clip_a', sequence_index: 1, status: 'generated' }),
      makeClip({
        clip_id: 'clip_b',
        sequence_index: 2,
        parent_clip_id: 'clip_a',
        generation_mode: 'extend',
        extension_depth: 1,
      }),
    ];
    expect(findDispatchBlockers(makeState({ clips }), clips[1]!)).toEqual([]);
  });

  it("refuses a chain deeper than its scene's max_chain_depth", () => {
    const clips = [
      makeClip({ clip_id: 'clip_a', sequence_index: 1, status: 'accepted' }),
      makeClip({
        clip_id: 'clip_b',
        sequence_index: 2,
        parent_clip_id: 'clip_a',
        extension_depth: 1,
      }),
    ];
    const state = makeState({
      clips,
      scenes: [makeScene({ max_chain_depth: 0, assigned_clip_ids: ['clip_a', 'clip_b'] })],
    });

    // validateProjectStateIntegrity checks that extension_depth is CONSISTENT
    // with the parent chain. Nothing checked it against the cap, which is the
    // only thing the cap is for.
    const problems = findDispatchBlockers(state, clips[1]!);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/caps the chain at 0/);
  });

  it('reports every blocker at once rather than the first', () => {
    const clips = [
      makeClip({ clip_id: 'clip_a', sequence_index: 1, status: 'planned' }),
      makeClip({
        clip_id: 'clip_b',
        sequence_index: 2,
        parent_clip_id: 'clip_a',
        extension_depth: 1,
        status: 'accepted',
      }),
    ];
    const state = makeState({
      clips,
      scenes: [makeScene({ max_chain_depth: 0, assigned_clip_ids: ['clip_a', 'clip_b'] })],
    });
    // Terminal status + unready parent + over the cap.
    expect(findDispatchBlockers(state, clips[1]!)).toHaveLength(3);
  });

  it('assertDispatchable throws with all of them in one message', () => {
    const state = makeState({ clips: [makeClip({ status: 'accepted' })] });
    expect(() => assertDispatchable(state, state.clips[0]!)).toThrow(/cannot be dispatched/);
  });
});

// ---------------------------------------------------------------------------
// toClipContract
// ---------------------------------------------------------------------------

describe('toClipContract', () => {
  it('projects a stored clip into a valid contract', () => {
    const state = makeState();
    const contract = toClipContract(state, state.clips[0]!);
    expect(contract.clip_id).toBe('clip_a');
    expect(contract.shot_structure).toBe('compact_single_take');
    // Per-clip duration wins over the project budget.
    expect(contract.target_duration_sec).toBe(5);
  });

  it("falls back to the project budget when the clip has no duration of its own", () => {
    const state = makeState({ clips: [makeClip({ target_duration_sec: null })] });
    expect(toClipContract(state, state.clips[0]!).target_duration_sec).toBe(10);
  });

  it('rejects colliding beat lists instead of building a self-contradicting prompt', () => {
    // buildClip derives these three lists by index arithmetic over the beat
    // order and nothing has ever validated the result. A beat in two lists
    // produces a prompt telling the model to both stage and not stage the same
    // action — which reads downstream as a model quality problem.
    const state = makeState({
      clips: [makeClip({ already_happened: ['beat_1'], this_clip_only: ['beat_1'] })],
    });
    expect(() => toClipContract(state, state.clips[0]!)).toThrow(/disjoint/);
  });

  it('refuses a clip planned before shot_structure was carried, and says how to fix it', () => {
    const clip = makeClip();
    delete (clip as { shot_structure?: unknown }).shot_structure;
    const state = makeState({ clips: [clip] });

    // Defaulting would put a structure the storyboard never chose into the
    // record the reviewer judges the take against — wrong data that validates
    // cleanly, which is the worst failure mode available here.
    expect(() => toClipContract(state, clip)).toThrow(/no shot_structure/);
    expect(() => toClipContract(state, clip)).toThrow(/re-run the planner/);
  });
});

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

describe('resolveSequenceRelation', () => {
  it('standalone project -> standalone', () => {
    const state = makeState({ project_mode: 'standalone_clip' });
    expect(resolveSequenceRelation(state, state.clips[0]!)).toBe('standalone');
  });

  it('first clip of a sequence -> sequence_first_clip', () => {
    const state = makeState();
    expect(resolveSequenceRelation(state, state.clips[0]!)).toBe('sequence_first_clip');
  });

  it('a parentless clip that is NOT first -> reanchor_after_drift', () => {
    const clips = [makeClip({ clip_id: 'clip_a' }), makeClip({ clip_id: 'clip_b', sequence_index: 2 })];
    expect(resolveSequenceRelation(makeState({ clips }), clips[1]!)).toBe('reanchor_after_drift');
  });

  it('continuing from a parent accepted WITH a deviation re-anchors instead', () => {
    const clips = [
      makeClip({ clip_id: 'clip_a', status: 'accepted_with_deviation' }),
      makeClip({
        clip_id: 'clip_b',
        sequence_index: 2,
        parent_clip_id: 'clip_a',
        transition_in: 'continuous',
        extension_depth: 1,
      }),
    ];
    // The parent ended somewhere other than planned. Continuing seamlessly would
    // compound a deviation the reviewer already flagged.
    expect(resolveSequenceRelation(makeState({ clips }), clips[1]!)).toBe('reanchor_after_drift');
  });

  it('a repair is a repair_tail regardless of its position', () => {
    const state = makeState({ clips: [makeClip({ status: 'repair' })] });
    expect(resolveSequenceRelation(state, state.clips[0]!)).toBe('repair_tail');
  });
});

describe('resolveOpeningStateSource', () => {
  it('prefers what the parent take actually ended on over what was planned', () => {
    const clips = [
      makeClip({ clip_id: 'clip_a', status: 'accepted', observed_end_state: { light: 'bright' } }),
      makeClip({ clip_id: 'clip_b', sequence_index: 2, parent_clip_id: 'clip_a', extension_depth: 1 }),
    ];
    // Planning against the INTENDED state is how a chain drifts while every
    // individual clip looks correct.
    expect(resolveOpeningStateSource(makeState({ clips }), clips[1]!)).toBe('observed_end_state');
  });

  it('falls back to planned_start_state when the parent has no observation yet', () => {
    const clips = [
      makeClip({ clip_id: 'clip_a', status: 'generated' }),
      makeClip({ clip_id: 'clip_b', sequence_index: 2, parent_clip_id: 'clip_a', extension_depth: 1 }),
    ];
    expect(resolveOpeningStateSource(makeState({ clips }), clips[1]!)).toBe('planned_start_state');
  });
});

describe('composePrompt', () => {
  it('carries the camera direction the planner used to drop', () => {
    const state = makeState();
    const prompt = composePrompt(state, state.clips[0]!, toClipContract(state, state.clips[0]!));
    expect(prompt).toContain('slow push in, waist height');
  });

  it('instructs the model to preserve reference tags verbatim', () => {
    const state = makeState();
    const prompt = composePrompt(state, state.clips[0]!, toClipContract(state, state.clips[0]!));
    expect(prompt).toContain('@ana');
    expect(prompt).toMatch(/exact reference tags unchanged/);
  });

  it('excludes reserved beats by DESCRIPTION, never by bare id', () => {
    const state = makeState();
    const prompt = composePrompt(state, state.clips[0]!, toClipContract(state, state.clips[0]!));
    // A model handed `beat_2` as something to avoid has been told nothing; the
    // description is what carries meaning.
    expect(prompt).toContain('the phone rings');
    expect(prompt).not.toContain('beat_2');
  });

  it('omits the exclusion sentence entirely when there is nothing to exclude', () => {
    const state = makeState({ clips: [makeClip({ reserved_for_later: [] })] });
    const prompt = composePrompt(state, state.clips[0]!, toClipContract(state, state.clips[0]!));
    expect(prompt).not.toMatch(/belong to later clips/);
  });
});

describe('buildPromptSpec', () => {
  it('produces a spec that validates, carrying the exclusions from the contract', () => {
    const state = makeState();
    const contract = toClipContract(state, state.clips[0]!);
    const spec = buildPromptSpec({ state, clip: state.clips[0]!, contract });

    expect(spec.reserved_future_exclusions).toEqual(['beat_2']);
    expect(spec.sequence_relation).toBe('sequence_first_clip');
    expect(spec.natural_language_prompt.length).toBeGreaterThan(0);
  });

  it('passes reference roles through untouched — T12 owns what they mean', () => {
    const state = makeState();
    const contract = toClipContract(state, state.clips[0]!);
    const roles = [{ asset_id: 'asset_1', reason: 'anchors her jacket' }];
    const spec = buildPromptSpec({ state, clip: state.clips[0]!, contract, referenceRoles: roles });
    expect(spec.reference_roles).toEqual(roles);
  });

  it('rejects a prompt that overruns the provider budget, while the spec is still editable', () => {
    const long = 'x'.repeat(50_000);
    const state = makeState({ clips: [makeClip({ narrative_job: long })] });
    const contract = toClipContract(state, state.clips[0]!);
    // Truncation at the provider boundary silently drops the TAIL — which is
    // exactly where the exclusions sit, so the model would be free to stage the
    // beats the contract reserved.
    expect(() =>
      buildPromptSpec({ state, clip: state.clips[0]!, contract, provider: 'kling' }),
    ).toThrow();
  });
});

describe('nextPromptVersion', () => {
  it('v1 -> v2', () => {
    expect(nextPromptVersion('v1')).toBe('v2');
  });

  it("a caller's own scheme is suffixed rather than renumbered", () => {
    expect(nextPromptVersion('rev-a')).toBe('rev-a.1');
  });
});

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

describe('applyDispatch', () => {
  it('marks the clip generated, bumps the revision, and returns a NEW state', () => {
    const state = makeState();
    const next = applyDispatch({ state, clipId: 'clip_a', promptVersion: 'v2', nowIso: 'T' });

    expect(next.clips[0]!.status).toBe('generated');
    expect(next.clips[0]!.prompt_version).toBe('v2');
    expect(next.state_revision).toBe(2);
    // Not mutated: assertMonotonicRevision compares a held revision against the
    // stored one, and an in-place bump would make before and after the same
    // object, defeating the check.
    expect(state.clips[0]!.status).toBe('planned');
    expect(state.state_revision).toBe(1);
  });

  it('advances current_clip_id to the next runnable clip', () => {
    const clips = [makeClip({ clip_id: 'clip_a' }), makeClip({ clip_id: 'clip_b', sequence_index: 2 })];
    const next = applyDispatch({ state: makeState({ clips }), clipId: 'clip_a', promptVersion: 'v1' });
    expect(next.current_clip_id).toBe('clip_b');
  });

  it('clears current_clip_id when the plan has nothing left to run', () => {
    const next = applyDispatch({ state: makeState(), clipId: 'clip_a', promptVersion: 'v1' });
    expect(next.current_clip_id).toBe('');
  });

  it('refuses an unknown clip', () => {
    expect(() => applyDispatch({ state: makeState(), clipId: 'nope', promptVersion: 'v1' })).toThrow(
      /unknown clip/,
    );
  });
});

describe('applyTakeReview', () => {
  it('records the observation as the clip real end state and marks beats complete', () => {
    const { state: next, heldForConfirmation } = applyTakeReview({
      state: makeState({ clips: [makeClip({ status: 'generated' })] }),
      review: makeReview(),
      nowIso: 'T',
    });

    expect(next.clips[0]!.status).toBe('accepted');
    // The next clip in the chain continues from what the reviewer SAW.
    expect(next.clips[0]!.observed_end_state).toEqual({ light: 'bright' });
    expect(next.beats.find((b) => b.beat_id === 'beat_1')!.status).toBe('completed');
    expect(next.take_history).toHaveLength(1);
    expect(next.state_revision).toBe(2);
    expect(heldForConfirmation).toBe(false);
  });

  it('marks an UNEXPECTED completion complete too — the damage is already done', () => {
    const { state: next } = applyTakeReview({
      state: makeState({ clips: [makeClip({ status: 'generated' })] }),
      review: makeReview({
        completed_beats: ['beat_1'],
        unexpected_completed_beats: ['beat_2'],
      }),
    });
    // Leaving a beat that already fired marked `planned` would have a later clip
    // generate it a second time.
    expect(next.beats.find((b) => b.beat_id === 'beat_2')!.status).toBe('completed');
  });

  it('a low-confidence REPAIR is recorded but parked at "reviewed", authorising nothing', () => {
    const { state: next, heldForConfirmation } = applyTakeReview({
      state: makeState({ clips: [makeClip({ status: 'generated' })] }),
      review: makeReview({
        verdict: 'repair',
        observation_confidence: 'low',
        requires_user_confirmation: true,
        completed_beats: [],
        incomplete_beats: ['beat_1'],
      }),
    });

    // `repair` is runnable: the very next execute call would dispatch a paid
    // retake off the back of an unreliable verdict. `reviewed` is not.
    expect(next.clips[0]!.status).toBe('reviewed');
    expect(heldForConfirmation).toBe(true);
    // Recorded regardless — the observation is not discarded, only acted on.
    expect(next.take_history).toHaveLength(1);
    expect(selectNextClip(next)).toBeNull();
  });

  it('an ACCEPT under the same flag is applied — it is terminal and spends nothing', () => {
    const { state: next, heldForConfirmation } = applyTakeReview({
      state: makeState({ clips: [makeClip({ status: 'generated' })] }),
      review: makeReview({ requires_user_confirmation: true }),
    });
    expect(next.clips[0]!.status).toBe('accepted');
    expect(heldForConfirmation).toBe(false);
  });

  it("refuses a review carrying another project's id", () => {
    // Almost always a copy-paste of a take from a different run; applying it
    // would overwrite this clip's observed state with observations of a
    // completely different generation.
    expect(() =>
      applyTakeReview({ state: makeState(), review: makeReview({ project_id: 'proj_other' }) }),
    ).toThrow(/but this state is proj_test/);
  });

  it('refuses a review naming a clip that is not in the plan', () => {
    expect(() =>
      applyTakeReview({ state: makeState(), review: makeReview({ clip_id: 'clip_zzz' }) }),
    ).toThrow(/not in project/);
  });
});
