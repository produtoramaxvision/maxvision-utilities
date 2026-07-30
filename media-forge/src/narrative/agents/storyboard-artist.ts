// src/narrative/agents/storyboard-artist.ts
// T13 — decomposes a scene into the shots that will actually be generated.
//
// This is the stage where the plan stops being prose and becomes generation
// requests. Each shot here becomes one clip contract (src/narrative/clip-contract.ts),
// so the fields it emits are chosen to line up with that schema rather than to
// read well in isolation.
//
// The load-bearing output is `chain_from`. A shot that continues the previous
// one inherits its last frame, which is cheap and seamless but compounds drift;
// a shot that re-anchors from a reference costs an extra reference pass but
// resets the error. Deciding that per shot, at plan time, is what keeps a
// sequence from degrading into unrecognisable characters six shots in.

import { z } from 'zod';
import {
  invokeNarrativeAgent,
  isDirective,
  type InvokeAgentOpts,
  type ObjectJsonSchema,
} from './invoke.js';
import { assertWithinCap, MAX_SHOTS_PER_SCENE } from './bounds.js';
import { SHOT_STRUCTURES } from '../enums.js';
import type { ExtractedCharacterT } from './character-extractor.js';

export interface StoryboardArtistInput {
  readonly sceneId: string;
  readonly sceneDescription: string;
  readonly location: string;
  readonly timeOfDay: string;
  readonly beats: ReadonlyArray<{ beat_id: string; description: string }>;
  readonly characters: ReadonlyArray<ExtractedCharacterT>;
  /**
   * From the scene's max_chain_depth. The agent must not plan a chain deeper
   * than the scene allows, because the cap exists to bound accumulated drift.
   */
  readonly maxChainDepth: number;
  readonly targetDurationSec: number | null;
}

export const StoryboardShot = z
  .object({
    shot_id: z
      .string()
      .min(2)
      .max(60)
      .regex(/^[a-z][a-z0-9_]*$/, 'shot_id must be lower_snake_case'),

    /** 1-based position within the scene. Contiguity is checked in the parser. */
    shot_index: z.number().int().min(1),

    /** Which beats this shot delivers. Maps onto the clip contract's this_clip_only. */
    delivers_beat_ids: z.array(z.string()),

    /** Prose the prompt compiler turns into the actual generation prompt. */
    action: z.string().min(1),

    /** Framing and camera, kept separate from action so either can be revised alone. */
    camera: z.string().min(1),

    /** Character tags visible in this shot. Drives reference selection. */
    character_tags: z.array(z.string()),

    shot_structure: z.enum(SHOT_STRUCTURES),

    /**
     * The shot_id this one continues from, or null to re-anchor from references.
     *
     * Null is a real choice, not a missing value: it costs a reference pass but
     * resets accumulated drift. See the file header.
     */
    chain_from: z.string().nullable(),

    duration_sec: z.number().positive(),
  })
  .strict();

export type StoryboardShotT = z.infer<typeof StoryboardShot>;

export const StoryboardArtistResult = z.object({ shots: z.array(StoryboardShot) }).strict();

export type StoryboardArtistResultT = z.infer<typeof StoryboardArtistResult>;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    shots: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          shot_id: { type: 'string' },
          shot_index: { type: 'integer' },
          delivers_beat_ids: { type: 'array', items: { type: 'string' } },
          action: { type: 'string' },
          camera: { type: 'string' },
          character_tags: { type: 'array', items: { type: 'string' } },
          shot_structure: {
            type: 'string',
            enum: [
              'compact_single_take',
              'phased_single_take',
              'dense_multishot',
              'first_last_frame_transition',
              'video_edit_contract',
            ],
          },
          chain_from: { type: ['string', 'null'] },
          duration_sec: { type: 'number' },
        },
        required: [
          'shot_id',
          'shot_index',
          'delivers_beat_ids',
          'action',
          'camera',
          'character_tags',
          'shot_structure',
          'chain_from',
          'duration_sec',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['shots'],
  additionalProperties: false,
} as const satisfies ObjectJsonSchema;

const SYSTEM_PROMPT = `You decompose one scene into the shots that will be generated.

Rules:
- Every beat listed in the scene must be delivered by exactly one shot. A beat delivered by
  no shot never appears in the finished video; a beat delivered twice is filmed twice.
- shot_index starts at 1 and is contiguous.
- character_tags must use the exact tags supplied. Never invent a tag, and never
  paraphrase a character's name in place of their tag — the tag is what carries the
  appearance description into the prompt.
- chain_from continues from a previous shot's final frame and is cheap and seamless, but
  drift compounds along a chain. Use null to re-anchor from references whenever the shot
  changes location, time of day, or camera position substantially.
- Never plan a chain deeper than the scene's stated max chain depth.
- duration_sec must sum to roughly the scene's share of the target duration.
- Prefer fewer, longer shots over many short ones unless the scene is explicitly a montage:
  each shot is a separate paid generation.`;

export async function storyboardScene(
  input: StoryboardArtistInput,
  opts?: InvokeAgentOpts,
): Promise<StoryboardArtistResultT | { mode: 'subagent'; agentName: string; payload: unknown }> {
  const raw = await invokeNarrativeAgent({
    agent: 'storyboard-artist',
    input,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildPrompt(input),
    outputSchema: OUTPUT_SCHEMA,
    ...(opts ? { opts } : {}),
  });

  if (isDirective(raw)) return raw;
  return parseStoryboardResult(raw, input);
}

/**
 * Validates the shot list against the scene it came from.
 *
 * Exported so the subagent path runs identical checks — two validation paths for
 * one contract is how the two modes start disagreeing.
 */
export function parseStoryboardResult(
  raw: unknown,
  input: StoryboardArtistInput,
): StoryboardArtistResultT {
  const result = StoryboardArtistResult.parse(raw);
  const problems: string[] = [];

  assertWithinCap({
    items: result.shots,
    cap: MAX_SHOTS_PER_SCENE,
    what: `storyboard-artist returned too many shots for scene ${input.sceneId}`,
  });

  if (result.shots.length === 0) {
    problems.push('scene decomposed into zero shots — nothing would be generated');
  }

  // shot_index contiguous from 1. A gap means a shot was dropped between
  // planning and output, and the sequence would render with a hole in it.
  const indices = result.shots.map((s) => s.shot_index).sort((a, b) => a - b);
  for (let i = 0; i < indices.length; i += 1) {
    if (indices[i] !== i + 1) {
      problems.push(
        `shot_index must be contiguous from 1; got [${indices.join(', ')}]`,
      );
      break;
    }
  }

  const shotIds = new Set<string>();
  for (const shot of result.shots) {
    if (shotIds.has(shot.shot_id)) {
      problems.push(`duplicate shot_id: ${shot.shot_id}`);
    }
    shotIds.add(shot.shot_id);
  }

  const knownTags = new Set(input.characters.map((c) => c.tag));
  const knownBeats = new Set(input.beats.map((b) => b.beat_id));
  const deliveredBy = new Map<string, string[]>();

  for (const shot of result.shots) {
    // An unknown character tag has no appearance description attached, so the
    // model renders whoever it likes and the character changes between shots.
    for (const tag of shot.character_tags) {
      if (!knownTags.has(tag)) {
        problems.push(
          `shot ${shot.shot_id} references unknown character tag "${tag}" — it carries no ` +
            `appearance description, so the character would render differently in this shot`,
        );
      }
    }

    for (const beatId of shot.delivers_beat_ids) {
      if (!knownBeats.has(beatId)) {
        problems.push(`shot ${shot.shot_id} delivers unknown beat "${beatId}"`);
      }
      const existing = deliveredBy.get(beatId) ?? [];
      existing.push(shot.shot_id);
      deliveredBy.set(beatId, existing);
    }

    if (shot.chain_from !== null && !shotIds.has(shot.chain_from)) {
      // Checked after the full id set is built, so forward references within the
      // same scene are allowed to resolve.
      if (!result.shots.some((s) => s.shot_id === shot.chain_from)) {
        problems.push(`shot ${shot.shot_id} chains from unknown shot "${shot.chain_from}"`);
      }
    }

    if (shot.chain_from === shot.shot_id) {
      problems.push(`shot ${shot.shot_id} chains from itself`);
    }
  }

  // Every beat filmed exactly once. Neither failure is visible in the output
  // video as an obvious error: a missing beat just leaves the story incomplete,
  // and a doubled one is a paid generation of something already covered.
  for (const beat of input.beats) {
    const shots = deliveredBy.get(beat.beat_id) ?? [];
    if (shots.length === 0) {
      problems.push(
        `beat "${beat.beat_id}" is delivered by no shot — it would never appear on screen`,
      );
    } else if (shots.length > 1) {
      problems.push(
        `beat "${beat.beat_id}" is delivered by ${shots.length} shots (${shots.join(', ')}) — ` +
          `it would be generated and paid for more than once`,
      );
    }
  }

  // Chain depth against the scene's cap. Exceeding it is what the cap exists to
  // prevent: drift compounds along every link.
  const byId = new Map(result.shots.map((s) => [s.shot_id, s]));
  for (const shot of result.shots) {
    let depth = 0;
    let cursor = shot.chain_from;
    const visited = new Set<string>([shot.shot_id]);
    while (cursor !== null) {
      if (visited.has(cursor)) {
        problems.push(`shot ${shot.shot_id} sits in a chain cycle via ${cursor}`);
        break;
      }
      visited.add(cursor);
      depth += 1;
      if (depth > input.maxChainDepth) {
        problems.push(
          `shot ${shot.shot_id} chains ${depth} deep but scene ${input.sceneId} caps at ` +
            `${input.maxChainDepth}; each link compounds visual drift`,
        );
        break;
      }
      cursor = byId.get(cursor)?.chain_from ?? null;
    }
  }

  if (problems.length > 0) {
    throw new z.ZodError(
      problems.map((message) => ({
        code: z.ZodIssueCode.custom,
        path: ['shots'],
        message,
      })),
    );
  }

  return result;
}

function buildPrompt(input: StoryboardArtistInput): string {
  const cast = input.characters
    .map((c) => `  ${c.tag} (${c.name}, ${c.role}): ${c.appearance}`)
    .join('\n');
  const beats = input.beats.map((b) => `  ${b.beat_id}: ${b.description}`).join('\n');

  return [
    `Scene ${input.sceneId}`,
    `Location: ${input.location}`,
    `Time of day: ${input.timeOfDay}`,
    `Max chain depth: ${input.maxChainDepth}`,
    input.targetDurationSec !== null
      ? `Target duration for the whole piece: ${input.targetDurationSec}s`
      : 'No fixed target duration.',
    '',
    `Description:\n${input.sceneDescription}`,
    '',
    `Beats this scene must deliver (each exactly once):\n${beats}`,
    '',
    `Cast (use these tags verbatim):\n${cast}`,
  ].join('\n');
}
