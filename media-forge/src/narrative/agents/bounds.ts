// src/narrative/agents/bounds.ts
// T13 — the defensive caps the plan requires, in one place.
//
// ## Why this file exists at all
//
// The plan's note on T13: "Adotar o cap defensivo do upstream: `event_extractor`
// limita eventos extraídos porque `is_last` vem só do LLM e sem bound o loop
// nunca termina."
//
// That is a real non-termination bug in the pattern being reimplemented, not a
// stylistic preference. Any loop whose exit condition is a flag the model
// returns — `is_last`, `has_more`, `is_complete` — can run forever, because a
// model that never sets the flag is a perfectly ordinary model failure. Every
// such loop needs an external bound that does not depend on the model agreeing
// to stop.
//
// The caps are collected here rather than scattered so the answer to "what stops
// this?" is one file, and so a bound can never be quietly raised at a single
// call site to make a stubborn case pass.

import { ValidationError } from '../../core/errors.js';

/**
 * Ceiling on beats extracted from a brief.
 *
 * Beyond this the output stops being a plan and becomes a transcript; a
 * 30-second ad does not have 200 beats. Hitting the cap means the extraction
 * went wrong, which is why it is an error rather than a silent truncation —
 * truncating would hand the planner a story missing its ending.
 */
export const MAX_BEATS = 120;

/** Ceiling on scenes. Same reasoning as MAX_BEATS. */
export const MAX_SCENES = 40;

/** Ceiling on shots per scene. */
export const MAX_SHOTS_PER_SCENE = 20;

/** Ceiling on cast size extracted from a brief. */
export const MAX_CHARACTERS = 25;

/**
 * Ceiling on iterations of any model-terminated loop.
 *
 * The number is deliberately generous — it is a backstop against a model that
 * never terminates, not a quality bar. A run that legitimately needs more than
 * this has a scoping problem upstream.
 */
export const MAX_AGENT_ITERATIONS = 50;

/**
 * Runs a loop whose continuation is decided by the model, with a hard bound.
 *
 * `shouldContinue` reading a model-supplied flag is exactly the pattern that
 * hangs. This makes the bound non-optional: there is no way to call it without
 * one, and exceeding it throws rather than returning a partial result, because a
 * partial narrative silently missing its final beats is worse than a failure
 * that says so.
 */
export async function runBoundedLoop<T>(args: {
  readonly label: string;
  readonly maxIterations?: number;
  readonly step: (iteration: number) => Promise<{ value: T; isLast: boolean }>;
}): Promise<T[]> {
  const max = args.maxIterations ?? MAX_AGENT_ITERATIONS;
  const results: T[] = [];

  for (let i = 0; i < max; i += 1) {
    const { value, isLast } = await args.step(i);
    results.push(value);
    if (isLast) return results;
  }

  throw new ValidationError(
    `${args.label} ran ${max} iterations without the model signalling completion. ` +
      `The termination flag comes only from the model, so this bound is what stops an ` +
      `endless loop — raising it is not the fix. Narrow the input instead.`,
  );
}

/**
 * Rejects an over-long collection with the cap named.
 *
 * Deliberately not a truncation. Silently dropping the tail of a beat list
 * removes the story's ending, and the planner downstream has no way to know
 * something is missing.
 */
export function assertWithinCap(args: {
  readonly items: ReadonlyArray<unknown>;
  readonly cap: number;
  readonly what: string;
}): void {
  if (args.items.length > args.cap) {
    throw new ValidationError(
      `${args.what}: got ${args.items.length}, cap is ${args.cap}. This is a defensive ` +
        `bound on model output, not a quality threshold — exceeding it means the ` +
        `extraction went wrong. Truncating instead would drop the tail of the story ` +
        `with nothing downstream able to notice.`,
    );
  }
}
