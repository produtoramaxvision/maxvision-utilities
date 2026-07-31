// src/narrative/planner.ts
// T13 — assembles the six agents' output into a ProjectState.
//
// The agents each solve one stage; this is where their results become the single
// durable document everything downstream reads. It is deliberately thin and
// synchronous: each agent has already validated its own output, and this layer's
// only job is to join them and hand the result to `parseProjectState`, which
// enforces the cross-document invariants none of the agents can see individually
// (a scene assigning a clip that does not exist, extension_depth disagreeing with
// the real parent chain, and so on).
//
// ## Why assembly is a separate step rather than the last agent's job
//
// The pipeline runs in two modes. Under the SDK path the planner can call the
// agents itself; under the subagent path each agent returns a directive and the
// orchestrator supplies the reply. Assembly has to work identically from a set of
// already-collected results either way, so it takes plain data and calls no
// agent. That is what makes both modes converge on the same document instead of
// having two assembly paths that drift.

import { randomUUID } from 'node:crypto';
import { parseProjectState, type ClipT, type ProjectStateT } from './project-state.js';
import { assertWithinCap, MAX_SCENES } from './agents/bounds.js';
import type { CharacterExtractorResultT } from './agents/character-extractor.js';
import type { ScreenwriterResultT } from './agents/screenwriter.js';
import type { ScriptPlannerResultT } from './agents/script-planner.js';
import type { StoryboardArtistResultT, StoryboardShotT } from './agents/storyboard-artist.js';

export const NARRATIVE_SCHEMA_VERSION = '1.0.0';

export interface AssemblePlanInput {
  readonly projectId: string;
  readonly cast: CharacterExtractorResultT;
  readonly screenplay: ScreenwriterResultT;
  readonly scenes: ScriptPlannerResultT;
  /** One storyboard per scene, keyed by scene_id. */
  readonly storyboards: ReadonlyMap<string, StoryboardArtistResultT>;
  readonly surface: Record<string, unknown>;
  readonly clipBudgetSec?: number | null;
  readonly promptBudget?: number | null;
  /** Test seam so assembly is deterministic. */
  readonly nowIso?: string;
}

/**
 * Joins the agent outputs into a validated ProjectState.
 *
 * Throws rather than returning a partial document: a ProjectState that fails
 * integrity is not a degraded plan, it is one the planner will dereference into
 * a missing clip on the first step.
 */
export function assembleProjectState(input: AssemblePlanInput): ProjectStateT {
  const now = input.nowIso ?? new Date().toISOString();

  assertWithinCap({
    items: input.scenes.scenes,
    cap: MAX_SCENES,
    what: 'assembleProjectState received too many scenes',
  });

  // Every scene must have been storyboarded. A scene with no storyboard
  // contributes no clips, so its beats silently never get filmed — the failure
  // is invisible in the assembled document because the scene still looks fine.
  const missing = input.scenes.scenes
    .filter((s) => !input.storyboards.has(s.scene_id))
    .map((s) => s.scene_id);
  if (missing.length > 0) {
    throw new Error(
      `cannot assemble a project state: no storyboard for scene(s) ${missing.join(', ')}. ` +
        `Each would contribute zero clips, so its beats would never be filmed and nothing ` +
        `downstream could detect the omission.`,
    );
  }

  const clips: ClipT[] = [];
  const sceneClipIds = new Map<string, string[]>();
  // Maps a storyboard shot_id to the clip_id it became, so chain_from can be
  // resolved into parent_clip_id after every clip exists.
  const clipIdByShotId = new Map<string, string>();
  // The inverse, carried explicitly rather than recovered by parsing clip_id.
  //
  // An earlier version derived the shot back out of the clip id with
  // `clip_id.split('_').slice(2).join('_')`, which assumes scene_id contains no
  // underscore. scene_id is unconstrained, so a scene called `scene_a` silently
  // produced the wrong shot, parent_clip_id resolved to null, and
  // parseProjectState accepted it because null is a legal parent. A corrupted
  // chain that validates cleanly is the worst failure mode available here, so
  // the mapping is now recorded when it is known instead of reconstructed.
  const shotByClipId = new Map<string, StoryboardShotT>();

  let sequenceIndex = 1;

  for (const scene of input.scenes.scenes) {
    const storyboard = input.storyboards.get(scene.scene_id);
    if (storyboard === undefined) continue; // unreachable: checked above

    const ordered = [...storyboard.shots].sort((a, b) => a.shot_index - b.shot_index);
    const idsForScene: string[] = [];

    for (const shot of ordered) {
      const clipId = `clip_${scene.scene_id}_${shot.shot_id}`;
      clipIdByShotId.set(shot.shot_id, clipId);
      shotByClipId.set(clipId, shot);
      idsForScene.push(clipId);

      clips.push(
        buildClip({
          clipId,
          sceneId: scene.scene_id,
          sequenceIndex: sequenceIndex++,
          shot,
          screenplay: input.screenplay,
        }),
      );
    }

    sceneClipIds.set(scene.scene_id, idsForScene);
  }

  // Resolve parent links and depths only once every clip exists, so a shot may
  // legitimately chain from one produced earlier in the same pass.
  const resolved: ClipT[] = clips.map((clip) => {
    const shot = shotByClipId.get(clip.clip_id);
    const parentClipId =
      shot?.chain_from != null ? (clipIdByShotId.get(shot.chain_from) ?? null) : null;

    return {
      ...clip,
      parent_clip_id: parentClipId,
      extension_depth: chainDepth(parentClipId, shotByClipId, clipIdByShotId),
    };
  });

  const state = {
    schema_version: NARRATIVE_SCHEMA_VERSION,
    state_revision: 1,
    project_id: input.projectId,
    project_mode: resolved.length > 1 ? 'sequence_project' : 'standalone_clip',
    surface: input.surface,
    clip_budget_sec: input.clipBudgetSec ?? null,
    prompt_budget: input.promptBudget ?? null,

    story: {
      logline: input.screenplay.logline,
      story_promise: input.screenplay.story_promise,
      objective: input.screenplay.objective,
      initial_condition: input.screenplay.initial_condition,
      final_outcome: input.screenplay.final_outcome,
      target_duration_sec: input.clipBudgetSec ?? null,
      tone: input.screenplay.tone,
      medium: input.screenplay.medium,
    },

    world_bible: {},

    // Every character becomes a reference entry. preserve_exact_tag is
    // literal-true by schema: a reference that permits its own tag to be
    // reworded defeats the mechanism that keeps the character consistent.
    reference_registry: input.cast.characters.map((c) => ({
      tag: c.tag,
      role: c.role,
      preserve_exact_tag: true as const,
    })),

    scenes: input.scenes.scenes.map((s) => ({
      scene_id: s.scene_id,
      scene_index: s.scene_index,
      narrative_function: s.narrative_function,
      arc_position: s.arc_position,
      location: s.location,
      time_of_day: s.time_of_day,
      anchor_source: s.anchor_source,
      max_chain_depth: s.max_chain_depth,
      audio_plan: s.audio_plan,
      // The planner's scenes carry assigned_BEAT_ids because clips did not exist
      // when they were planned. This is the point where the mapping happens.
      assigned_clip_ids: sceneClipIds.get(s.scene_id) ?? [],
      transition_out: s.transition_out,
      status: s.status,
    })),

    beats: input.screenplay.beats.map((b) => ({
      beat_id: b.beat_id,
      description: b.description,
      narrative_function: b.narrative_function,
      status: 'planned' as const,
      assigned_clip_id: findClipDelivering(b.beat_id, input.storyboards, clipIdByShotId),
      dependencies: b.dependencies,
    })),

    clips: resolved,
    take_history: [],
    current_clip_id: resolved[0]?.clip_id ?? '',
    canon_revision: 1,
    updated_at: now,
  };

  // parseProjectState is the gate, not a formality: it is what enforces the
  // cross-document rules this function cannot check while still building.
  return parseProjectState(state);
}

/** Fresh project id. Exposed so callers can pre-register one before assembly. */
export function newProjectId(): string {
  return `proj_${randomUUID()}`;
}

function buildClip(args: {
  clipId: string;
  sceneId: string;
  sequenceIndex: number;
  shot: StoryboardShotT;
  screenplay: ScreenwriterResultT;
}): ClipT {
  const { clipId, sceneId, sequenceIndex, shot, screenplay } = args;

  const delivered = new Set(shot.delivers_beat_ids);
  const allBeatIds = screenplay.beats.map((b) => b.beat_id);
  const deliveredIndex = allBeatIds.findIndex((id) => delivered.has(id));

  return {
    clip_id: clipId,
    parent_clip_id: null, // resolved in a second pass, once every clip exists
    scene_id: sceneId,
    sequence_index: sequenceIndex,
    prompt_version: 'v1',
    generation_mode: shot.chain_from === null ? 't2v' : 'extend',
    status: 'planned',
    narrative_job: shot.action,
    felt_intent: shot.action,

    // The three lists are the anti-repetition mechanism. `already_happened` is
    // everything earlier in the beat order, so the prompt does not re-stage it;
    // `reserved_for_later` is everything after, so it does not fire early and
    // strand the clip meant to deliver it.
    already_happened: deliveredIndex > 0 ? allBeatIds.slice(0, deliveredIndex) : [],
    this_clip_only: [...shot.delivers_beat_ids],
    reserved_for_later: allBeatIds.filter(
      (id, i) => !delivered.has(id) && i > deliveredIndex,
    ),

    planned_start_state: {},
    planned_end_state: {},
    observed_start_state: null,
    observed_end_state: null,

    continuity_locks: [...shot.character_tags],
    allowed_changes: [],
    continuity_breaks: [],
    accepted_deviations: [],

    transition_in: shot.chain_from === null ? 'cut' : 'continuous',
    transition_out: 'cut',
    open_motion_vectors: [],
    handoff_requirements: [],
    extension_depth: 0, // resolved in the second pass
  };
}

function findClipDelivering(
  beatId: string,
  storyboards: ReadonlyMap<string, StoryboardArtistResultT>,
  clipIdByShotId: ReadonlyMap<string, string>,
): string | null {
  for (const board of storyboards.values()) {
    for (const shot of board.shots) {
      if (shot.delivers_beat_ids.includes(beatId)) {
        return clipIdByShotId.get(shot.shot_id) ?? null;
      }
    }
  }
  return null;
}

/**
 * Depth of the parent chain above a clip.
 *
 * Bounded by a visited set rather than trusting the graph to be acyclic: this
 * runs before parseProjectState's own cycle detection, so a cyclic chain here
 * would hang the assembly instead of producing the error that explains it.
 */
function chainDepth(
  parentClipId: string | null,
  shotByClipId: ReadonlyMap<string, StoryboardShotT>,
  clipIdByShotId: ReadonlyMap<string, string>,
): number {
  let depth = 0;
  let cursor = parentClipId;
  const visited = new Set<string>();

  while (cursor !== null) {
    if (visited.has(cursor)) return depth; // cycle; parseProjectState reports it
    visited.add(cursor);
    depth += 1;

    const shot = shotByClipId.get(cursor);
    if (shot === undefined) return depth;

    cursor = shot.chain_from != null ? (clipIdByShotId.get(shot.chain_from) ?? null) : null;
  }

  return depth;
}
