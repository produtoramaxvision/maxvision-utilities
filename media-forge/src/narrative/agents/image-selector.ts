// src/narrative/agents/image-selector.ts
// T13 — the two selection agents, which do opposite jobs and are easy to confuse.
//
//   reference-image-selector  runs BEFORE generation. Given the assets on hand,
//                             it chooses which ones to send as references for an
//                             upcoming shot. Input: a library. Output: a subset.
//
//   best-image-selector       runs AFTER generation. Given several takes of the
//                             same shot, it picks the one to keep. Input:
//                             candidates for one shot. Output: one winner.
//
// They share a file because they share the consistency criterion — "which of
// these best matches the established look" — but they are not interchangeable,
// and using one where the other belongs silently degrades the sequence.
//
// Both are advisory. Neither deletes anything: best-image-selector returns a
// ranking and the caller keeps the rest, because a discarded take cannot be
// recovered without paying to generate it again.

import { z } from 'zod';
import {
  invokeNarrativeAgent,
  isDirective,
  type InvokeAgentOpts,
  type ObjectJsonSchema,
} from './invoke.js';
import { ValidationError } from '../../core/errors.js';

// ---------------------------------------------------------------------------
// reference-image-selector
// ---------------------------------------------------------------------------

export interface ReferenceCandidate {
  readonly assetId: string;
  /** What the asset depicts, in the planner's own words. */
  readonly description: string;
  /** Character tag this asset anchors, when it anchors one. */
  readonly characterTag?: string;
}

export interface ReferenceSelectorInput {
  readonly shotId: string;
  readonly shotAction: string;
  readonly requiredCharacterTags: ReadonlyArray<string>;
  readonly candidates: ReadonlyArray<ReferenceCandidate>;
  /**
   * How many references the target provider accepts. Enforced locally so an
   * over-long selection fails here rather than at submit, after the cost guard
   * has already run and a ledger row exists.
   */
  readonly maxReferences: number;
}

export const ReferenceSelection = z
  .object({
    selected: z.array(
      z.object({
        assetId: z.string(),
        /** Why this asset, in one line. Surfaced in the trace for auditability. */
        reason: z.string().min(1),
      }),
    ),
  })
  .strict();

export type ReferenceSelectionT = z.infer<typeof ReferenceSelection>;

const REFERENCE_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    selected: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          assetId: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['assetId', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['selected'],
  additionalProperties: false,
} as const satisfies ObjectJsonSchema;

const REFERENCE_SYSTEM_PROMPT = `You choose which reference images to attach to an upcoming shot.

Rules:
- Select only from the candidate list. Never invent an assetId.
- Every character the shot requires must be anchored by at least one selected reference,
  otherwise that character renders inconsistently against earlier shots.
- Do not exceed the stated maximum. More references is not better: past the provider's
  limit the request is rejected, and near it the model weights each one less.
- Prefer the fewest references that cover every required character.
- Give a one-line reason per selection. It is written to the trace, so "matches the
  established look" is useless — say which attribute it anchors.`;

export async function selectReferences(
  input: ReferenceSelectorInput,
  opts?: InvokeAgentOpts,
): Promise<ReferenceSelectionT | { mode: 'subagent'; agentName: string; payload: unknown }> {
  if (input.maxReferences < 1) {
    throw new ValidationError(
      `maxReferences must be at least 1 (got ${input.maxReferences}); a shot with no ` +
        `references cannot anchor any character`,
    );
  }

  const raw = await invokeNarrativeAgent({
    agent: 'reference-image-selector',
    input,
    systemPrompt: REFERENCE_SYSTEM_PROMPT,
    userPrompt: buildReferencePrompt(input),
    outputSchema: REFERENCE_OUTPUT_SCHEMA,
    ...(opts ? { opts } : {}),
  });

  if (isDirective(raw)) return raw;
  return parseReferenceSelection(raw, input);
}

/** Exported so the subagent path validates identically. */
export function parseReferenceSelection(
  raw: unknown,
  input: ReferenceSelectorInput,
): ReferenceSelectionT {
  const result = ReferenceSelection.parse(raw);
  const problems: string[] = [];

  const known = new Map(input.candidates.map((c) => [c.assetId, c]));
  const seen = new Set<string>();

  for (const entry of result.selected) {
    if (!known.has(entry.assetId)) {
      // A hallucinated assetId reaches the provider as a broken reference and
      // the generation either fails or silently proceeds with fewer anchors.
      problems.push(`selected unknown assetId "${entry.assetId}"`);
    }
    if (seen.has(entry.assetId)) {
      problems.push(`assetId "${entry.assetId}" selected twice`);
    }
    seen.add(entry.assetId);
  }

  if (result.selected.length > input.maxReferences) {
    problems.push(
      `selected ${result.selected.length} references but the provider accepts ` +
        `${input.maxReferences}; the submit would be rejected after the cost guard has ` +
        `already run`,
    );
  }

  // Every required character anchored. An unanchored character is the failure
  // this whole stage exists to prevent.
  for (const tag of input.requiredCharacterTags) {
    const anchored = result.selected.some((s) => known.get(s.assetId)?.characterTag === tag);
    if (!anchored) {
      problems.push(
        `character "${tag}" appears in shot ${input.shotId} but no selected reference ` +
          `anchors them — they would render inconsistently against earlier shots`,
      );
    }
  }

  if (problems.length > 0) {
    throw new z.ZodError(
      problems.map((message) => ({
        code: z.ZodIssueCode.custom,
        path: ['selected'],
        message,
      })),
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// best-image-selector
// ---------------------------------------------------------------------------

export interface TakeCandidate {
  readonly takeId: string;
  readonly assetPath: string;
}

export interface BestImageSelectorInput {
  readonly shotId: string;
  readonly shotAction: string;
  /** What the sequence has already established, for consistency scoring. */
  readonly establishedLook: string;
  readonly candidates: ReadonlyArray<TakeCandidate>;
}

export const BestImageSelection = z
  .object({
    /** Every candidate, best first. Never a bare winner — see the file header. */
    ranking: z.array(
      z.object({
        takeId: z.string(),
        score: z.number().min(0).max(10),
        reason: z.string().min(1),
      }),
    ),
  })
  .strict();

export type BestImageSelectionT = z.infer<typeof BestImageSelection>;

const BEST_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ranking: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          takeId: { type: 'string' },
          score: { type: 'number' },
          reason: { type: 'string' },
        },
        required: ['takeId', 'score', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['ranking'],
  additionalProperties: false,
} as const satisfies ObjectJsonSchema;

const BEST_SYSTEM_PROMPT = `You rank generated takes of one shot, best first.

Rules:
- Rank EVERY candidate. Do not omit any, even a clearly bad one — the caller keeps the
  losers and needs the full ordering to fall back if the winner fails a later check.
- Score 0-10 on consistency with the established look FIRST, then on execution quality.
  A beautiful take whose character does not match earlier shots is worse than a plain
  take that matches, because inconsistency is visible across the cut and quality is not.
- The reason must name the deciding attribute, not restate the score.`;

export async function selectBestTake(
  input: BestImageSelectorInput,
  opts?: InvokeAgentOpts,
): Promise<BestImageSelectionT | { mode: 'subagent'; agentName: string; payload: unknown }> {
  if (input.candidates.length === 0) {
    throw new ValidationError(
      `selectBestTake called with no candidates for shot ${input.shotId}`,
    );
  }

  const raw = await invokeNarrativeAgent({
    agent: 'best-image-selector',
    input,
    systemPrompt: BEST_SYSTEM_PROMPT,
    userPrompt: buildBestPrompt(input),
    outputSchema: BEST_OUTPUT_SCHEMA,
    ...(opts ? { opts } : {}),
  });

  if (isDirective(raw)) return raw;
  return parseBestImageSelection(raw, input);
}

/** Exported so the subagent path validates identically. */
export function parseBestImageSelection(
  raw: unknown,
  input: BestImageSelectorInput,
): BestImageSelectionT {
  const result = BestImageSelection.parse(raw);
  const problems: string[] = [];

  const known = new Set(input.candidates.map((c) => c.takeId));
  const ranked = new Set<string>();

  for (const entry of result.ranking) {
    if (!known.has(entry.takeId)) {
      problems.push(`ranked unknown takeId "${entry.takeId}"`);
    }
    if (ranked.has(entry.takeId)) {
      problems.push(`takeId "${entry.takeId}" ranked twice`);
    }
    ranked.add(entry.takeId);
  }

  // Every candidate ranked. An omitted take is one the caller paid for and now
  // has no ordering for, so it cannot be used as a fallback.
  for (const candidate of input.candidates) {
    if (!ranked.has(candidate.takeId)) {
      problems.push(
        `take "${candidate.takeId}" was generated but left unranked — it was paid for and ` +
          `cannot serve as a fallback without an ordering`,
      );
    }
  }

  if (problems.length > 0) {
    throw new z.ZodError(
      problems.map((message) => ({
        code: z.ZodIssueCode.custom,
        path: ['ranking'],
        message,
      })),
    );
  }

  return result;
}

/**
 * The winning take id.
 *
 * Sorts by score rather than trusting the array order: the prompt asks for
 * best-first, but "the model was told to" is not an ordering guarantee, and
 * silently keeping the wrong take is invisible until someone watches the cut.
 * Ties resolve to the earlier entry, which preserves the model's stated
 * preference among equals.
 */
export function winningTake(selection: BestImageSelectionT): string {
  const sorted = [...selection.ranking].sort((a, b) => b.score - a.score);
  const winner = sorted[0];
  if (winner === undefined) {
    throw new ValidationError('winningTake called on an empty ranking');
  }
  return winner.takeId;
}

function buildReferencePrompt(input: ReferenceSelectorInput): string {
  const candidates = input.candidates
    .map(
      (c) =>
        `  ${c.assetId}${c.characterTag ? ` [anchors ${c.characterTag}]` : ''}: ${c.description}`,
    )
    .join('\n');

  return [
    `Shot ${input.shotId}`,
    `Action: ${input.shotAction}`,
    `Characters that must be anchored: ${input.requiredCharacterTags.join(', ') || '(none)'}`,
    `Maximum references: ${input.maxReferences}`,
    '',
    `Candidates:\n${candidates}`,
  ].join('\n');
}

function buildBestPrompt(input: BestImageSelectorInput): string {
  const candidates = input.candidates.map((c) => `  ${c.takeId}: ${c.assetPath}`).join('\n');
  return [
    `Shot ${input.shotId}`,
    `Intended action: ${input.shotAction}`,
    `Established look to stay consistent with: ${input.establishedLook}`,
    '',
    `Takes to rank (rank all ${input.candidates.length}):\n${candidates}`,
  ].join('\n');
}
