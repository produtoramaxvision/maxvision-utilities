// src/narrative/clip-contract.ts
// T10 — Zod port of skills/_shared/schemas/clip-contract.schema.json.
//
// The clip contract is what the planner commits to before generation: what this
// clip must accomplish, what has already been established, and what is
// deliberately held back for later clips. The reviewer (T11) checks the take
// against this contract rather than against the prompt, which is why the three
// beat lists are required rather than optional -- an empty list is a decision
// ("nothing is reserved for later"), whereas a missing list is an omission, and
// the reviewer cannot tell those apart if the field is optional.

import { z } from 'zod';
import { ClipStatus, ShotStructure, StateBlob } from './enums.js';

export const ClipContract = z
  .object({
    project_id: z.string(),
    clip_id: z.string(),

    /**
     * Null for the first clip of a chain. Not optional: the distinction between
     * "explicitly has no parent" and "nobody set this" matters when computing
     * extension depth.
     */
    parent_clip_id: z.string().nullable(),

    scene_id: z.string(),
    sequence_index: z.number().int().min(1),

    narrative_job: z.string(),

    /** What the viewer should feel. Empty string is never a valid intent. */
    felt_intent: z.string().min(1),

    target_duration_sec: z.number().nullable(),

    generation_mode: z.string(),
    shot_structure: ShotStructure,

    /**
     * The three beat lists are the anti-repetition mechanism. `already_happened`
     * is excluded from the prompt so the model does not re-stage it;
     * `reserved_for_later` is excluded so it does not fire early and strand the
     * clips that were meant to deliver it.
     */
    already_happened: z.array(z.string()),
    this_clip_only: z.array(z.string()),
    reserved_for_later: z.array(z.string()),

    planned_start_state: StateBlob,
    planned_end_state: StateBlob,

    /** What must not change. Checked by the reviewer as continuity breaks. */
    continuity_locks: z.array(z.unknown()),
    /** What is permitted to change without counting as a break. */
    allowed_changes: z.array(z.unknown()),

    status: ClipStatus,
  })
  .strict();

export type ClipContractT = z.infer<typeof ClipContract>;

/**
 * A beat may appear in exactly one of the three lists. The same beat marked both
 * `already_happened` and `this_clip_only` is a planner bug that produces a prompt
 * instructing the model to both stage and not stage the same action; the model
 * resolves that arbitrarily and the failure looks like a model quality problem
 * rather than a planning one.
 *
 * Returned as a list rather than thrown so a caller can report every collision
 * at once instead of surfacing them one reroll at a time.
 */
export function findBeatCollisions(contract: ClipContractT): string[] {
  const seen = new Map<string, string>();
  const collisions: string[] = [];

  const lists: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
    ['already_happened', contract.already_happened],
    ['this_clip_only', contract.this_clip_only],
    ['reserved_for_later', contract.reserved_for_later],
  ];

  for (const [listName, beats] of lists) {
    for (const beat of beats) {
      const previous = seen.get(beat);
      if (previous !== undefined) {
        collisions.push(`beat "${beat}" appears in both ${previous} and ${listName}`);
      } else {
        seen.set(beat, listName);
      }
    }
  }

  return collisions;
}

/**
 * Parses and additionally enforces the cross-field invariant that the raw schema
 * cannot express. Prefer this over `ClipContract.parse` at trust boundaries.
 */
export function parseClipContract(input: unknown): ClipContractT {
  const contract = ClipContract.parse(input);
  const collisions = findBeatCollisions(contract);
  if (collisions.length > 0) {
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.custom,
        path: ['already_happened'],
        message: `beat lists must be disjoint: ${collisions.join('; ')}`,
      },
    ]);
  }
  return contract;
}
