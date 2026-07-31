// src/narrative/agents/screenwriter.ts
// T13 — second stage: turn a brief plus its already-extracted cast into a beat list.
//
// Beats are extracted before scenes are planned for the same reason the cast is
// extracted before the script is written (see character-extractor.ts): a scene
// grid built straight from prose has no explicit dependency graph, so nothing
// downstream can tell which scenes must precede which. A shooting order that
// violates causality — the reveal shot generated before the setup it depends on
// — is invisible until someone actually watches the cut. A beat list with
// `dependencies` makes that graph a checkable artifact instead of something only
// implied by paragraph order.

import { z } from 'zod';
import { invokeNarrativeAgent, isDirective, type InvokeAgentOpts, type ObjectJsonSchema } from './invoke.js';
import { assertWithinCap, MAX_BEATS } from './bounds.js';
import type { ExtractedCharacterT } from './character-extractor.js';

export interface ScreenwriterInput {
  /** The user's raw creative brief. */
  readonly brief: string;
  /** The cast character-extractor already produced; beats may only name these tags. */
  readonly characters: ReadonlyArray<ExtractedCharacterT>;
  /** Null when the user gave no target length; the model then infers a reasonable one. */
  readonly targetDurationSec: number | null;
}

/**
 * Same token shape as `ExtractedCharacter.tag` in character-extractor.ts, and for
 * the same reason: a beat_id gets embedded verbatim inside other beats'
 * `dependencies` arrays and re-matched string-for-string, so anything that survives
 * being reworded by prose formatting (spaces, punctuation) would break that match.
 */
const BEAT_ID = z
  .string()
  .min(2)
  .max(40)
  .regex(
    /^[a-z][a-z0-9_]*$/,
    'beat_id must be lower_snake_case so it can be referenced verbatim from dependencies',
  );

export const ScreenwriterBeat = z
  .object({
    beat_id: BEAT_ID,
    description: z.string().min(1),
    narrative_function: z.string().min(1),
    /**
     * beat_ids that must be established before this beat makes sense.
     *
     * Deliberately the same field NAME as `Beat.dependencies` in
     * project-state.ts, because it is the same relationship. Two names for one
     * concept would force a translation step between the screenwriter and the
     * durable state, and a translation step is where a field quietly stops being
     * carried across.
     */
    dependencies: z.array(z.string()),
  })
  .strict();

export type ScreenwriterBeatT = z.infer<typeof ScreenwriterBeat>;

/**
 * Field names below mirror project-state.ts's `Story` schema on purpose, so the
 * planner can assemble a Story from this reply with no translation layer.
 *
 * `target_duration_sec` is the one Story field deliberately left out: it is
 * caller-supplied input here (`ScreenwriterInput.targetDurationSec`), not
 * something the model should be asked to reproduce. Echoing it back would only
 * invite the model to "correct" a number it was never asked to reason about;
 * the caller already holds the authoritative value and writes it into Story
 * directly when assembling the final document.
 *
 * `beats` is not a Story field at all — Story describes the whole narrative,
 * beats are project-state's separate top-level `beats` array. Keeping them in
 * one result here (rather than a second round trip) is what lets a single
 * screenwriter call produce everything the planner needs to seed both.
 */
export const ScreenwriterResult = z
  .object({
    logline: z.string().min(1),
    story_promise: z.string().min(1),
    objective: z.string().min(1),
    initial_condition: z.string().min(1),
    final_outcome: z.string().min(1),
    tone: z.string().min(1),
    medium: z.string().min(1),
    beats: z.array(ScreenwriterBeat),
  })
  .strict();

export type ScreenwriterResultT = z.infer<typeof ScreenwriterResult>;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    logline: { type: 'string' },
    story_promise: { type: 'string' },
    objective: { type: 'string' },
    initial_condition: { type: 'string' },
    final_outcome: { type: 'string' },
    tone: { type: 'string' },
    medium: { type: 'string' },
    beats: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          beat_id: { type: 'string' },
          description: { type: 'string' },
          narrative_function: { type: 'string' },
          dependencies: { type: 'array', items: { type: 'string' } },
        },
        required: ['beat_id', 'description', 'narrative_function', 'dependencies'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'logline',
    'story_promise',
    'objective',
    'initial_condition',
    'final_outcome',
    'tone',
    'medium',
    'beats',
  ],
  additionalProperties: false,
} as const satisfies ObjectJsonSchema;

const SYSTEM_PROMPT = `You are a screenwriter turning a creative brief and an already-extracted cast into a beat list.

Rules:
- Every beat gets a lower_snake_case beat_id, referenced verbatim by other beats' dependencies.
- dependencies lists the beat_ids that must be shot before this beat makes narrative sense. Leave
  it empty for beats with no prerequisite.
- The dependency graph must be acyclic: if beat A depends on B, B must not — directly or through
  any chain — depend back on A. A cycle means there is no valid order to shoot the beats in.
- Only name characters using tags from the supplied cast list. A character not in that list has
  no appearance description, so a beat naming one renders as a different person with nothing to
  keep it consistent.
- logline, story_promise, objective, initial_condition, and final_outcome describe the whole
  story arc, not any single beat.
- Return at most ${MAX_BEATS} beats.`;

/**
 * Extracts the beat list. Returns a directive inside Claude Code, a validated
 * result otherwise — same dual-mode contract as character-extractor.ts.
 */
export async function writeScreenplay(
  input: ScreenwriterInput,
  opts?: InvokeAgentOpts,
): Promise<ScreenwriterResultT | { mode: 'subagent'; agentName: string; payload: unknown }> {
  const userPrompt = buildPrompt(input);

  const raw = await invokeNarrativeAgent({
    agent: 'screenwriter',
    input,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    outputSchema: OUTPUT_SCHEMA,
    ...(opts ? { opts } : {}),
  });

  if (isDirective(raw)) return raw;

  return parseScreenwriterResult(raw, input);
}

/**
 * Validates the agent's reply and enforces the invariants the JSON Schema cannot.
 *
 * Exported so the subagent path — where the orchestrator gets the reply, not this
 * module — runs exactly the same checks. Two validation paths for one contract is
 * how the two modes start disagreeing.
 */
export function parseScreenwriterResult(
  raw: unknown,
  input: ScreenwriterInput,
): ScreenwriterResultT {
  const result = ScreenwriterResult.parse(raw);

  assertWithinCap({
    items: result.beats,
    cap: MAX_BEATS,
    what: 'screenwriter returned too many beats',
  });

  // beat_id is the dependency graph's node identity. Two beats sharing one
  // makes every dependencies referencing it ambiguous about which beat it means.
  const beatIds = new Set<string>();
  for (const beat of result.beats) {
    if (beatIds.has(beat.beat_id)) {
      throw new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          path: ['beats'],
          message: `duplicate beat_id "${beat.beat_id}" — beat_ids identify nodes in the dependency graph and must be unique`,
        },
      ]);
    }
    beatIds.add(beat.beat_id);
  }

  // A dependencies entry pointing outside this result, or at itself, is not
  // something a topological sort can resolve — it has to be caught here, not
  // discovered later as a scene the planner cannot order.
  for (const beat of result.beats) {
    if (beat.dependencies.includes(beat.beat_id)) {
      throw new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          path: ['beats'],
          message: `beat "${beat.beat_id}" depends on itself`,
        },
      ]);
    }
    for (const dep of beat.dependencies) {
      if (!beatIds.has(dep)) {
        throw new z.ZodError([
          {
            code: z.ZodIssueCode.custom,
            path: ['beats'],
            message: `beat "${beat.beat_id}" depends on unknown beat_id "${dep}"`,
          },
        ]);
      }
    }
  }

  assertNoDependencyCycle(result.beats);
  assertKnownCharacterTags(result.beats, input.characters);

  return result;
}

/**
 * Rejects a cyclic beat dependency graph.
 *
 * Uses Kahn's algorithm (repeatedly remove nodes with no remaining
 * prerequisites) rather than a recursive DFS with a visited-stack check,
 * specifically because this check has to be provably safe against the very
 * thing it is looking for: each iteration removes exactly the nodes it just
 * processed from a queue that started with `beats.length` entries, so the loop
 * terminates in at most `beats.length` iterations no matter what the graph
 * looks like. A cyclic beat graph means no valid shooting order exists — the
 * planner would otherwise stall trying to schedule a beat whose prerequisite
 * is itself still waiting on it.
 */
function assertNoDependencyCycle(beats: ReadonlyArray<ScreenwriterBeatT>): void {
  const remainingDeps = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const beat of beats) {
    remainingDeps.set(beat.beat_id, beat.dependencies.length);
  }
  for (const beat of beats) {
    for (const dep of beat.dependencies) {
      const list = dependents.get(dep) ?? [];
      list.push(beat.beat_id);
      dependents.set(dep, list);
    }
  }

  const queue: string[] = [];
  for (const [beatId, deps] of remainingDeps) {
    if (deps === 0) queue.push(beatId);
  }

  let processed = 0;
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    processed += 1;
    for (const dependent of dependents.get(current) ?? []) {
      const remaining = (remainingDeps.get(dependent) ?? 0) - 1;
      remainingDeps.set(dependent, remaining);
      if (remaining === 0) queue.push(dependent);
    }
  }

  if (processed !== beats.length) {
    const stuck = beats
      .filter((b) => (remainingDeps.get(b.beat_id) ?? 0) > 0)
      .map((b) => b.beat_id);
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.custom,
        path: ['beats'],
        message: `beat dependency graph has a cycle involving: ${stuck.join(', ')} — no valid shooting order exists for these beats`,
      },
    ]);
  }
}

/**
 * Matches a lower_snake_case token embedded in prose: at least one underscore,
 * so ordinary words ("the", "reveal") never trip this check — only multi-part
 * tokens shaped like the tags character-extractor hands out.
 *
 * A false positive here (a snake_case term that was never meant as a tag, e.g.
 * "close_up") costs a rejected reply and a cheap regeneration. A false
 * negative — a genuinely unextracted character slipping through — is a shot
 * that renders the wrong face, with nothing downstream positioned to catch it
 * until a human reviews the take. Erring toward over-flagging is the right
 * side of that trade.
 */
const TAG_LIKE_TOKEN = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;

function assertKnownCharacterTags(
  beats: ReadonlyArray<ScreenwriterBeatT>,
  characters: ReadonlyArray<ExtractedCharacterT>,
): void {
  const knownTags = new Set(characters.map((c) => c.tag));

  for (const beat of beats) {
    const candidates = beat.description.match(TAG_LIKE_TOKEN) ?? [];
    for (const token of candidates) {
      if (!knownTags.has(token)) {
        throw new z.ZodError([
          {
            code: z.ZodIssueCode.custom,
            path: ['beats'],
            message: `beat "${beat.beat_id}" names "${token}", which looks like a character tag but was never extracted — it has no appearance description and will render as a different person`,
          },
        ]);
      }
    }
  }
}

function buildPrompt(input: ScreenwriterInput): string {
  const cast = input.characters
    .map((c) => `- ${c.tag} (${c.role}): ${c.appearance}`)
    .join('\n');
  const duration =
    input.targetDurationSec === null
      ? 'No target duration was given — infer a reasonable one for the material.'
      : `Target duration: ${input.targetDurationSec} seconds.`;
  return `Creative brief:\n\n${input.brief}\n\nCast (use only these tags to name characters):\n${cast}\n\n${duration}`;
}
