// src/narrative/agents/character-extractor.ts
// T13 — first stage: who is in this thing.
//
// The cast is extracted before the script is written, not discovered while
// writing it. That ordering is the point of the pattern: a character that
// appears halfway through a generated script has no reference image, no
// consistent description, and no tag, so every shot renders a different person.
// Extracting first means every character has an identity token before any shot
// exists to need one.

import { z } from 'zod';
import { invokeNarrativeAgent, isDirective, type InvokeAgentOpts, type ObjectJsonSchema } from './invoke.js';
import { assertWithinCap, MAX_CHARACTERS } from './bounds.js';

export interface CharacterExtractorInput {
  /** The user's raw creative brief. */
  readonly brief: string;
  /** Optional cast the user already fixed; the agent must preserve these. */
  readonly knownCharacters?: ReadonlyArray<string>;
}

export const ExtractedCharacter = z
  .object({
    /**
     * The reference tag reproduced verbatim in every prompt mentioning this
     * character. Constrained to a conservative token shape because it must
     * survive being embedded in prose without being reworded by the model —
     * spaces and punctuation invite exactly that.
     */
    tag: z
      .string()
      .min(2)
      .max(40)
      .regex(
        /^[a-z][a-z0-9_]*$/,
        'tag must be lower_snake_case so it survives verbatim inside a prose prompt',
      ),
    name: z.string().min(1),
    /** Physical description carried into every prompt for visual consistency. */
    appearance: z.string().min(1),
    role: z.enum(['protagonist', 'antagonist', 'supporting', 'background', 'narrator']),
    /** Whether this character needs a trained Soul-ID / reference image. */
    needsVisualAnchor: z.boolean(),
  })
  .strict();

export type ExtractedCharacterT = z.infer<typeof ExtractedCharacter>;

export const CharacterExtractorResult = z
  .object({ characters: z.array(ExtractedCharacter) })
  .strict();

export type CharacterExtractorResultT = z.infer<typeof CharacterExtractorResult>;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    characters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tag: { type: 'string' },
          name: { type: 'string' },
          appearance: { type: 'string' },
          role: {
            type: 'string',
            enum: ['protagonist', 'antagonist', 'supporting', 'background', 'narrator'],
          },
          needsVisualAnchor: { type: 'boolean' },
        },
        required: ['tag', 'name', 'appearance', 'role', 'needsVisualAnchor'],
        additionalProperties: false,
      },
    },
  },
  required: ['characters'],
  additionalProperties: false,
} as const satisfies ObjectJsonSchema;

const SYSTEM_PROMPT = `You extract the cast from a creative brief for a video production.

Rules:
- Extract only characters who appear on screen. Do not invent characters the brief does not imply.
- Every character gets a lower_snake_case tag used verbatim in later prompts.
- appearance must be concrete and visual (age range, build, hair, clothing), because it is
  repeated in every shot prompt to keep the character looking the same.
- needsVisualAnchor is true for any character whose face must stay consistent across shots.
- A voice-only narrator has needsVisualAnchor false.
- Return at most ${MAX_CHARACTERS} characters.`;

/**
 * Extracts the cast. Returns a directive inside Claude Code, a validated result
 * otherwise.
 */
export async function extractCharacters(
  input: CharacterExtractorInput,
  opts?: InvokeAgentOpts,
): Promise<CharacterExtractorResultT | { mode: 'subagent'; agentName: string; payload: unknown }> {
  const userPrompt = buildPrompt(input);

  const raw = await invokeNarrativeAgent({
    agent: 'character-extractor',
    input,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    outputSchema: OUTPUT_SCHEMA,
    ...(opts ? { opts } : {}),
  });

  if (isDirective(raw)) return raw;

  return parseCharacterExtractorResult(raw, input);
}

/**
 * Validates the agent's reply and enforces the invariants the JSON Schema cannot.
 *
 * Exported so the subagent path — where the orchestrator gets the reply, not this
 * module — runs exactly the same checks. Two validation paths for one contract is
 * how the two modes start disagreeing.
 */
export function parseCharacterExtractorResult(
  raw: unknown,
  input: CharacterExtractorInput,
): CharacterExtractorResultT {
  const result = CharacterExtractorResult.parse(raw);

  assertWithinCap({
    items: result.characters,
    cap: MAX_CHARACTERS,
    what: 'character-extractor returned too many characters',
  });

  // Tags are the identity tokens later prompts embed verbatim. Two characters
  // sharing a tag makes every prompt mentioning it ambiguous, and the model
  // resolves that by blending them.
  const seen = new Set<string>();
  for (const character of result.characters) {
    if (seen.has(character.tag)) {
      throw new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          path: ['characters'],
          message: `duplicate character tag "${character.tag}" — tags are identity tokens and must be unique`,
        },
      ]);
    }
    seen.add(character.tag);
  }

  // A cast the user pinned must survive extraction. Dropping one silently means
  // the brief asked for someone who never appears in the plan.
  for (const required of input.knownCharacters ?? []) {
    const present = result.characters.some(
      (c) => c.name.toLowerCase() === required.toLowerCase() || c.tag === required,
    );
    if (!present) {
      throw new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          path: ['characters'],
          message: `the brief pinned character "${required}" but extraction dropped it`,
        },
      ]);
    }
  }

  return result;
}

function buildPrompt(input: CharacterExtractorInput): string {
  const pinned =
    input.knownCharacters && input.knownCharacters.length > 0
      ? `\n\nThese characters are fixed by the user and MUST appear in your output: ${input.knownCharacters.join(', ')}`
      : '';
  return `Creative brief:\n\n${input.brief}${pinned}`;
}
