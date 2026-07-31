// src/narrative/project-state.ts
// T10 — Zod port of skills/_shared/schemas/project-state.schema.json.
//
// This is the durable document a sequence project is rebuilt from between
// sessions. Everything else in src/narrative/ is derived from it or written back
// into it, so its integrity rules are stricter than the raw JSON Schema can
// express: the schema can say "scenes is an array of scene objects", but not
// "every clip_id a scene claims must exist in clips".
//
// Those cross-references are enforced in `validateProjectStateIntegrity` and are
// the difference between a state file that reloads and one that reloads into a
// planner that then dereferences a clip that was never there.

import { z } from 'zod';
import {
  ArcPosition,
  ClipStatus,
  PlanningStatus,
  ProjectMode,
  ShotStructure,
  StateBlob,
} from './enums.js';

export const Story = z
  .object({
    logline: z.string(),
    story_promise: z.string(),
    objective: z.string(),
    initial_condition: z.string(),
    final_outcome: z.string(),
    target_duration_sec: z.number().nullable(),
    tone: z.string(),
    medium: z.string(),
  })
  .strict();

export type StoryT = z.infer<typeof Story>;

export const ReferenceEntry = z
  .object({
    tag: z.string().min(1),
    role: z.string(),

    /**
     * `const: true` upstream, kept as a literal rather than a boolean. The tag is
     * a token the model is instructed to reproduce verbatim; a reference that
     * permits rewriting its own tag defeats the mechanism, so `false` is not a
     * configuration -- it is an invalid reference.
     */
    preserve_exact_tag: z.literal(true),
  })
  .strict();

export type ReferenceEntryT = z.infer<typeof ReferenceEntry>;

export const Scene = z
  .object({
    scene_id: z.string(),
    scene_index: z.number().int().min(1),
    narrative_function: z.string(),
    arc_position: ArcPosition,
    location: z.string(),
    time_of_day: z.string(),
    anchor_source: z.array(z.string()),

    /**
     * Upstream caps chain depth at 3. Each extension inherits the previous
     * clip's last frame, so drift compounds; past three links the accumulated
     * error is usually worse than re-anchoring from a reference.
     */
    max_chain_depth: z.number().int().min(0).max(3),

    audio_plan: z.string(),
    assigned_clip_ids: z.array(z.string()),
    transition_out: z.string(),
    status: PlanningStatus,
  })
  .strict();

export type SceneT = z.infer<typeof Scene>;

export const Beat = z
  .object({
    beat_id: z.string(),
    description: z.string(),
    narrative_function: z.string(),
    status: PlanningStatus,
    assigned_clip_id: z.string().nullable(),
    dependencies: z.array(z.string()),
  })
  .strict();

export type BeatT = z.infer<typeof Beat>;

export const Clip = z
  .object({
    clip_id: z.string(),
    parent_clip_id: z.string().nullable(),
    scene_id: z.string(),
    sequence_index: z.number().int().min(1),
    prompt_version: z.string(),
    generation_mode: z.string(),

    /** Optional upstream — present only for edit/extend modes. */
    source_clip_tag: z.string().nullable().optional(),

    // -----------------------------------------------------------------------
    // Carried over from the storyboard shot. These three were produced by the
    // storyboard artist and then DROPPED by `buildClip`, so a persisted project
    // could not be turned back into a runnable request:
    //
    //   shot_structure  required by ClipContract, and unreconstructible — the
    //                   executor had no legal value to supply and no way to
    //                   guess one that would not be wrong data validating cleanly
    //   camera          the storyboard keeps framing separate from action "so
    //                   either can be revised alone"; dropping it deleted every
    //                   camera direction from the prompt
    //   target_duration_sec  per-shot duration; only the whole-project
    //                   clip_budget_sec survived, so every clip in a plan looked
    //                   the same length
    //
    // Optional, not required. `loadProjectState` THROWS on a document that fails
    // validation rather than returning null, so making these mandatory would turn
    // every project saved before today into an unloadable one — a migration
    // disguised as a schema tweak.
    // -----------------------------------------------------------------------

    /** How this clip is physically structured as a generation request. */
    shot_structure: ShotStructure.optional(),
    /** Framing and camera direction, kept separate from the action prose. */
    camera: z.string().optional(),
    /** This clip's own duration. Null means "inherit the project budget". */
    target_duration_sec: z.number().positive().nullable().optional(),

    status: ClipStatus,
    narrative_job: z.string(),
    felt_intent: z.string().min(1),

    already_happened: z.array(z.string()),
    this_clip_only: z.array(z.string()),
    reserved_for_later: z.array(z.string()),

    planned_start_state: StateBlob,
    planned_end_state: StateBlob,

    /** Null until a take has actually been reviewed. */
    observed_start_state: StateBlob.nullable(),
    observed_end_state: StateBlob.nullable(),

    continuity_locks: z.array(z.unknown()),
    allowed_changes: z.array(z.unknown()),
    continuity_breaks: z.array(z.unknown()),
    accepted_deviations: z.array(z.unknown()),

    transition_in: z.string(),
    transition_out: z.string(),
    open_motion_vectors: z.array(z.unknown()),
    handoff_requirements: z.array(z.unknown()),

    extension_depth: z.number().int().min(0),
  })
  .strict();

export type ClipT = z.infer<typeof Clip>;

export const ProjectState = z
  .object({
    schema_version: z.string(),

    /**
     * Bumped on every write. Used for optimistic concurrency: a writer holding
     * revision N must not overwrite a stored revision > N. See
     * `assertMonotonicRevision`.
     */
    state_revision: z.number().int().min(1),

    project_id: z.string().min(1),
    project_mode: ProjectMode,
    surface: StateBlob,

    clip_budget_sec: z.number().nullable(),
    prompt_budget: z.number().int().nullable(),

    story: Story,
    world_bible: StateBlob,
    reference_registry: z.array(ReferenceEntry),

    scenes: z.array(Scene),
    beats: z.array(Beat),
    clips: z.array(Clip),
    take_history: z.array(z.unknown()),

    current_clip_id: z.string(),
    canon_revision: z.number().int().min(1),
    updated_at: z.string(),
  })
  .strict();

export type ProjectStateT = z.infer<typeof ProjectState>;

/**
 * Cross-reference and uniqueness rules the JSON Schema cannot express.
 *
 * Returns every violation rather than throwing on the first, because a state
 * file that has drifted usually has drifted in several places at once and
 * fixing them one reload at a time is miserable.
 */
export function validateProjectStateIntegrity(state: ProjectStateT): string[] {
  const problems: string[] = [];

  const clipIds = new Set<string>();
  for (const clip of state.clips) {
    if (clipIds.has(clip.clip_id)) {
      problems.push(`duplicate clip_id: ${clip.clip_id}`);
    }
    clipIds.add(clip.clip_id);
  }

  const sceneIds = new Set<string>();
  for (const scene of state.scenes) {
    if (sceneIds.has(scene.scene_id)) {
      problems.push(`duplicate scene_id: ${scene.scene_id}`);
    }
    sceneIds.add(scene.scene_id);
  }

  const beatIds = new Set<string>();
  for (const beat of state.beats) {
    if (beatIds.has(beat.beat_id)) {
      problems.push(`duplicate beat_id: ${beat.beat_id}`);
    }
    beatIds.add(beat.beat_id);
  }

  // Every clip points at a scene that exists, and at a parent that exists.
  for (const clip of state.clips) {
    if (!sceneIds.has(clip.scene_id)) {
      problems.push(`clip ${clip.clip_id} references unknown scene_id ${clip.scene_id}`);
    }
    if (clip.parent_clip_id !== null && !clipIds.has(clip.parent_clip_id)) {
      problems.push(
        `clip ${clip.clip_id} references unknown parent_clip_id ${clip.parent_clip_id}`,
      );
    }
    if (clip.parent_clip_id === clip.clip_id) {
      problems.push(`clip ${clip.clip_id} is its own parent`);
    }
  }

  // Scene assignments and beat assignments point at real clips.
  for (const scene of state.scenes) {
    for (const assigned of scene.assigned_clip_ids) {
      if (!clipIds.has(assigned)) {
        problems.push(`scene ${scene.scene_id} assigns unknown clip_id ${assigned}`);
      }
    }
  }

  for (const beat of state.beats) {
    if (beat.assigned_clip_id !== null && !clipIds.has(beat.assigned_clip_id)) {
      problems.push(`beat ${beat.beat_id} assigns unknown clip_id ${beat.assigned_clip_id}`);
    }
    for (const dependency of beat.dependencies) {
      if (!beatIds.has(dependency)) {
        problems.push(`beat ${beat.beat_id} depends on unknown beat_id ${dependency}`);
      }
    }
    if (beat.dependencies.includes(beat.beat_id)) {
      problems.push(`beat ${beat.beat_id} depends on itself`);
    }
  }

  // current_clip_id must resolve. An empty string is the legitimate "no current
  // clip yet" marker for a freshly planned project.
  if (state.current_clip_id !== '' && !clipIds.has(state.current_clip_id)) {
    problems.push(`current_clip_id ${state.current_clip_id} is not a known clip`);
  }

  // Reference tags are the tokens the model must reproduce verbatim. Two
  // references sharing a tag makes the reference ambiguous at prompt time.
  const tags = new Set<string>();
  for (const reference of state.reference_registry) {
    if (tags.has(reference.tag)) {
      problems.push(`duplicate reference tag: ${reference.tag}`);
    }
    tags.add(reference.tag);
  }

  // extension_depth must agree with the actual parent chain, otherwise the
  // scene's max_chain_depth cap is enforced against a number that means nothing.
  const clipById = new Map(state.clips.map((c) => [c.clip_id, c]));
  for (const clip of state.clips) {
    let depth = 0;
    let cursor = clip.parent_clip_id;
    const visited = new Set<string>([clip.clip_id]);
    while (cursor !== null && cursor !== undefined) {
      if (visited.has(cursor)) {
        problems.push(`clip ${clip.clip_id} sits in a parent cycle via ${cursor}`);
        depth = -1;
        break;
      }
      visited.add(cursor);
      depth += 1;
      cursor = clipById.get(cursor)?.parent_clip_id ?? null;
    }
    if (depth >= 0 && depth !== clip.extension_depth) {
      problems.push(
        `clip ${clip.clip_id} declares extension_depth ${clip.extension_depth} ` +
          `but its parent chain is ${depth} deep`,
      );
    }
  }

  return problems;
}

/**
 * Parses and enforces integrity in one step. Use at every trust boundary --
 * reading the state file, accepting it over MCP, restoring from SQLite.
 */
export function parseProjectState(input: unknown): ProjectStateT {
  const state = ProjectState.parse(input);
  const problems = validateProjectStateIntegrity(state);
  if (problems.length > 0) {
    throw new z.ZodError(
      problems.map((message) => ({
        code: z.ZodIssueCode.custom,
        path: ['clips'],
        message,
      })),
    );
  }
  return state;
}

/**
 * Optimistic concurrency guard for the persisted state.
 *
 * Two agents planning the same project concurrently is the expected case, not an
 * edge case -- the reviewer writes take results while the planner writes the next
 * clip contract. Without this check the later write silently wins and the earlier
 * agent's work vanishes with no error anywhere.
 */
export function assertMonotonicRevision(args: {
  readonly storedRevision: number;
  readonly incomingRevision: number;
  readonly projectId: string;
}): void {
  const { storedRevision, incomingRevision, projectId } = args;
  if (incomingRevision <= storedRevision) {
    throw new Error(
      `project ${projectId}: refusing to write state_revision ${incomingRevision} ` +
        `over stored revision ${storedRevision}. Reload the state, reapply the change, ` +
        `and write again — overwriting would discard the concurrent update.`,
    );
  }
}
