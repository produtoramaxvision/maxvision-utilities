// src/narrative/agents/script-planner.ts
// T13 — third stage: turn a beat list into a scene grid, in one of three modes.
//
// A beat is a unit of story; a scene is a unit of shooting. The two are not the
// same size, and how they map onto each other depends entirely on what kind of
// piece this is. A narrative ad cuts on story turns. A single continuous product
// move should not be chopped into one scene per beat just because the beats
// exist — that breaks the one thing motion mode exists to protect. A montage
// wants the opposite of both: many short scenes, on purpose, with a weaker
// causal chain between them. Collapsing these into one generic "beats become
// scenes" pass would silently pick narrative's rhythm for all three, which is
// wrong for the other two by design, not by mistake.

import { z } from 'zod';
import { invokeNarrativeAgent, isDirective, type InvokeAgentOpts, type ObjectJsonSchema } from './invoke.js';
import { assertWithinCap, MAX_SCENES } from './bounds.js';
import { ARC_POSITIONS, ArcPosition, PLANNING_STATUSES, PlanningStatus } from '../enums.js';
import type { ScreenwriterBeatT } from './screenwriter.js';
import type { ExtractedCharacterT } from './character-extractor.js';

/**
 * The three modes are fixed at three, carried over from the upstream pattern
 * this planner reimplements. Adding a fourth here without a matching upstream
 * concept would mean inventing scene-boundary semantics with no reference
 * behavior to validate them against.
 */
export const SCRIPT_PLAN_MODES = ['narrative', 'motion', 'montage'] as const;

export type ScriptPlanMode = (typeof SCRIPT_PLAN_MODES)[number];

export interface ScriptPlannerInput {
  /** The beat list produced by screenwriter.ts. */
  readonly beats: ReadonlyArray<ScreenwriterBeatT>;
  /** The cast, so scene-level anchoring can reference character tags correctly. */
  readonly characters: ReadonlyArray<ExtractedCharacterT>;
  readonly mode: ScriptPlanMode;
  readonly targetDurationSec: number | null;
}

export const ScriptPlannerScene = z
  .object({
    scene_id: z.string().min(1),
    scene_index: z.number().int().min(1),
    narrative_function: z.string().min(1),
    arc_position: ArcPosition,
    location: z.string().min(1),
    time_of_day: z.string().min(1),
    anchor_source: z.array(z.string()),

    /**
     * Same 0-3 ceiling and the same reason project-state.ts's Scene documents:
     * each clip in a chain inherits the last frame of the one before it, so
     * drift compounds with every link. Past 3 the accumulated error is usually
     * worse than re-anchoring the scene from a fresh reference, so this is
     * enforced structurally here rather than restated as a separate check.
     */
    max_chain_depth: z.number().int().min(0).max(3),

    audio_plan: z.string().min(1),

    /**
     * project-state.ts's Scene calls the equivalent field `assigned_clip_ids`.
     * It is `assigned_beat_ids` here on purpose, not a rename slip: at this
     * planning stage no clip exists yet — there is nothing with a clip_id to
     * assign. Reusing `assigned_clip_ids` for beat ids would make one field
     * name mean two different kinds of reference depending on which pipeline
     * stage wrote the document. A later pass maps beats to generated clips and
     * writes that mapping into the real `assigned_clip_ids`; this field is the
     * input to that mapping, not a stand-in for its output.
     */
    assigned_beat_ids: z.array(z.string()),

    transition_out: z.string().min(1),
    status: PlanningStatus,
  })
  .strict();

export type ScriptPlannerSceneT = z.infer<typeof ScriptPlannerScene>;

export const ScriptPlannerResult = z
  .object({ scenes: z.array(ScriptPlannerScene) })
  .strict();

export type ScriptPlannerResultT = z.infer<typeof ScriptPlannerResult>;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          scene_id: { type: 'string' },
          scene_index: { type: 'integer' },
          narrative_function: { type: 'string' },
          arc_position: { type: 'string', enum: [...ARC_POSITIONS] },
          location: { type: 'string' },
          time_of_day: { type: 'string' },
          anchor_source: { type: 'array', items: { type: 'string' } },
          max_chain_depth: { type: 'integer' },
          audio_plan: { type: 'string' },
          assigned_beat_ids: { type: 'array', items: { type: 'string' } },
          transition_out: { type: 'string' },
          status: { type: 'string', enum: [...PLANNING_STATUSES] },
        },
        required: [
          'scene_id',
          'scene_index',
          'narrative_function',
          'arc_position',
          'location',
          'time_of_day',
          'anchor_source',
          'max_chain_depth',
          'audio_plan',
          'assigned_beat_ids',
          'transition_out',
          'status',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['scenes'],
  additionalProperties: false,
} as const satisfies ObjectJsonSchema;

const SYSTEM_PROMPT_BASE = `You are a script planner turning a beat list into a scene grid.

Rules:
- Every scene gets a scene_id and a scene_index. scene_index must be contiguous starting at 1
  with no gaps or duplicates — the shooting order is read directly off it.
- assigned_beat_ids may only reference beat_ids from the supplied beat list. Every supplied beat
  must end up assigned to exactly one scene: an unassigned beat is never filmed, and a beat
  assigned to two scenes gets shot twice.
- max_chain_depth is 0-3. Each clip in a generation chain inherits the last frame of the one
  before it, so drift compounds with every link; past 3 the accumulated error is usually worse
  than re-anchoring the scene from a fresh reference instead of extending the chain further.
- anchor_source names what establishes the scene's opening frame — a reference image tag, or a
  prior scene it continues from. Leave it empty only when the scene truly has nothing to anchor
  from yet.
- status is always "planned" here; nothing has been shot yet.`;

/**
 * Each mode gets real staging direction, not a one-line label, because the
 * three modes disagree about what a scene boundary even means and a thin
 * prompt collapses back to whichever behavior the model defaults to.
 */
const MODE_GUIDANCE: Record<ScriptPlanMode, string> = {
  narrative: `Mode: narrative. Story beats drive every scene boundary. End a scene when the beat
driving it resolves, or when the next beat needs a different location, time of day, or arc
position to land. Prefer cutting on causal turns — a decision made, a reveal landed, a reversal —
over cutting on a fixed rhythm. Let scene count track the actual shape of the story: a quiet
middle beat can be one long scene, a fast sequence of reversals can be several short scenes back
to back. Do not merge beats across a real story turn just to save a scene.`,
  motion: `Mode: motion. A continuous camera or subject movement is the scene's spine, not the
beat structure. Treat individual beats as waypoints inside one longer unbroken movement rather
than as boundaries to cut on. Prefer fewer, longer scenes: merging several consecutive beats into
a single scene is correct here whenever doing so keeps one camera or subject move unbroken, because
every scene boundary is a place that movement has to restart, and a restarted move reads on screen
as a cut, not as continuous motion. Only start a new scene where the movement itself genuinely
breaks.`,
  montage: `Mode: montage. The goal is rapid thematic juxtaposition, not causal continuity. Prefer
many short scenes, each landing a single image or beat fragment before cutting to the next. The
causal chain between scenes is deliberately weaker than in narrative mode: adjacent scenes may
jump in time, location, or arc position as long as the sequence of images serves the theme. A beat
that would be one scene under narrative mode should typically split into several short montage
scenes instead — resist the pull to merge beats back into narrative-length scenes.`,
};

function buildSystemPrompt(mode: ScriptPlanMode): string {
  return `${SYSTEM_PROMPT_BASE}\n\n${MODE_GUIDANCE[mode]}`;
}

function buildPrompt(input: ScriptPlannerInput): string {
  const beatsList = input.beats
    .map((b) => {
      const deps = b.dependencies.length > 0 ? b.dependencies.join(', ') : 'none';
      return `- ${b.beat_id} [dependencies: ${deps}] (${b.narrative_function}): ${b.description}`;
    })
    .join('\n');
  const cast = input.characters.map((c) => `- ${c.tag}: ${c.appearance}`).join('\n');
  const duration =
    input.targetDurationSec === null
      ? 'No target duration was given.'
      : `Target duration: ${input.targetDurationSec} seconds.`;
  return `Beats to place into scenes:\n${beatsList}\n\nCast:\n${cast}\n\n${duration}`;
}

/**
 * Plans the scene grid for one mode. Returns a directive inside Claude Code, a
 * validated result otherwise — same dual-mode contract as character-extractor.ts.
 */
export async function planScenes(
  input: ScriptPlannerInput,
  opts?: InvokeAgentOpts,
): Promise<ScriptPlannerResultT | { mode: 'subagent'; agentName: string; payload: unknown }> {
  const raw = await invokeNarrativeAgent({
    agent: 'script-planner',
    input,
    systemPrompt: buildSystemPrompt(input.mode),
    userPrompt: buildPrompt(input),
    outputSchema: OUTPUT_SCHEMA,
    ...(opts ? { opts } : {}),
  });

  if (isDirective(raw)) return raw;

  return parseScriptPlannerResult(raw, input);
}

/**
 * Validates the agent's reply and enforces the invariants the JSON Schema cannot.
 *
 * Exported so the subagent path — where the orchestrator gets the reply, not this
 * module — runs exactly the same checks. Two validation paths for one contract is
 * how the two modes start disagreeing.
 */
export function parseScriptPlannerResult(
  raw: unknown,
  input: ScriptPlannerInput,
): ScriptPlannerResultT {
  const result = ScriptPlannerResult.parse(raw);

  assertWithinCap({
    items: result.scenes,
    cap: MAX_SCENES,
    what: 'script-planner returned too many scenes',
  });

  // scene_index is the literal shooting order. A gap means a slot has nothing
  // in it; a duplicate means two scenes claim the same slot.
  const sortedIndices = [...result.scenes.map((s) => s.scene_index)].sort((a, b) => a - b);
  for (const [i, index] of sortedIndices.entries()) {
    const expected = i + 1;
    if (index !== expected) {
      throw new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          path: ['scenes'],
          message: `scene_index must be contiguous from 1 with no gaps or duplicates — expected ${expected} at that position, found ${index}`,
        },
      ]);
    }
  }

  const sceneIds = new Set<string>();
  for (const scene of result.scenes) {
    if (sceneIds.has(scene.scene_id)) {
      throw new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          path: ['scenes'],
          message: `duplicate scene_id "${scene.scene_id}"`,
        },
      ]);
    }
    sceneIds.add(scene.scene_id);
  }

  // Every assignment must resolve to a beat that actually exists in this call's
  // input — an assignment to an unknown beat_id is not something a later stage
  // can map to a clip, because there is no beat behind it to derive one from.
  const knownBeatIds = new Set(input.beats.map((b) => b.beat_id));
  const assignmentCount = new Map<string, number>();
  for (const scene of result.scenes) {
    for (const beatId of scene.assigned_beat_ids) {
      if (!knownBeatIds.has(beatId)) {
        throw new z.ZodError([
          {
            code: z.ZodIssueCode.custom,
            path: ['scenes'],
            message: `scene "${scene.scene_id}" assigns unknown beat_id "${beatId}"`,
          },
        ]);
      }
      assignmentCount.set(beatId, (assignmentCount.get(beatId) ?? 0) + 1);
    }
  }

  // The beat-to-scene assignment must be a partition of the input beats: every
  // beat exactly once. Zero scenes means the beat is never filmed; more than
  // one means it gets shot twice — both are reported together so a drifted
  // plan can be fixed in one pass instead of one rejection at a time.
  const unassigned: string[] = [];
  const doublyAssigned: string[] = [];
  for (const beat of input.beats) {
    const count = assignmentCount.get(beat.beat_id) ?? 0;
    if (count === 0) unassigned.push(beat.beat_id);
    else if (count > 1) doublyAssigned.push(beat.beat_id);
  }
  if (unassigned.length > 0 || doublyAssigned.length > 0) {
    const parts: string[] = [];
    if (unassigned.length > 0) {
      parts.push(`unassigned, never filmed: ${unassigned.join(', ')}`);
    }
    if (doublyAssigned.length > 0) {
      parts.push(`assigned to more than one scene, shot twice: ${doublyAssigned.join(', ')}`);
    }
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.custom,
        path: ['scenes'],
        message: `beat assignment is not a one-to-one partition of the input beats — ${parts.join('; ')}`,
      },
    ]);
  }

  return result;
}
