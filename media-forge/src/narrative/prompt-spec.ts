// src/narrative/prompt-spec.ts
// T10 — Zod port of skills/_shared/schemas/prompt-spec.schema.json.
//
// The prompt spec is the resolved, auditable form of a prompt: every decision
// that went into the natural-language string is recorded as a field beside it.
// That is what makes a bad take diagnosable -- you can see whether the model
// failed or whether it was handed the wrong opening state.
//
// `prompt_version` is what ties a spec to a generation run. It must change when
// any field here changes, otherwise two different prompts share an identity and
// the review history stops meaning anything.

import { z } from 'zod';
import { OpeningStateSource, SequenceRelation } from './enums.js';
import { assertPromptWithinBudget } from '../core/prompt-budget.js';
import type { Provider } from '../core/models.js';

/**
 * A reference asset and the role it plays.
 *
 * Kept structurally loose because T12 (Reference Authority Resolver) owns the
 * "exactly one owner per controlled dimension" invariant; restating half of that
 * rule here would give it two homes that drift apart.
 *
 * One deliberate narrowing over the source schema, which declares
 * `reference_roles` as a bare `{"type": "array"}` with no `items` constraint:
 * entries must be objects. A reference role is by definition a pairing of an
 * asset with the dimension it controls, so a bare string or number in this array
 * carries no role at all and can only be a planner defect. Rejecting it here
 * surfaces that defect while the spec is still editable, rather than as a
 * confusing failure inside the resolver later. The constraint stops at "is an
 * object" precisely so it does not preempt T12's real rules.
 */
export const ReferenceRole = z.record(z.unknown());

export const PromptSpec = z
  .object({
    project_id: z.string(),
    clip_id: z.string(),

    /** Changes whenever any other field changes. See the file header. */
    prompt_version: z.string(),

    sequence_relation: SequenceRelation,
    generation_mode: z.string(),

    reference_roles: z.array(ReferenceRole),

    opening_state_source: OpeningStateSource,

    current_clip_action: z.string(),
    endpoint: z.string(),

    /**
     * Negative context. These are beats the prompt must actively avoid, either
     * because they already happened or because they belong to a later clip.
     * They mirror the clip contract's lists after resolution.
     */
    completed_beat_exclusions: z.array(z.string()),
    reserved_future_exclusions: z.array(z.string()),

    /** The string actually sent to the provider. Never empty. */
    natural_language_prompt: z.string().min(1),
  })
  .strict();

export type PromptSpecT = z.infer<typeof PromptSpec>;

/**
 * Validates the spec and, when a provider is supplied, checks the resolved
 * prompt against that provider's published character budget.
 *
 * The budget check lives here rather than at submit time because a prompt that
 * overruns is a planning defect: truncation at the provider boundary silently
 * drops the end of the prompt, which is exactly where the exclusions and the
 * endpoint description sit. Catching it while the spec is still editable is the
 * difference between a fixable plan and a wasted generation.
 *
 * Omitting the provider skips the check -- correct while the spec is still being
 * assembled and the target provider is not yet resolved. Note that passing a
 * provider which publishes no bound is also a no-op by design; that is why
 * `prompt-budget.ts` models "no published limit" as null rather than Infinity.
 */
export function parsePromptSpec(input: unknown, provider?: Provider): PromptSpecT {
  const spec = PromptSpec.parse(input);

  if (provider !== undefined) {
    assertPromptWithinBudget({
      provider,
      prompt: spec.natural_language_prompt,
      field: 'natural_language_prompt',
    });
  }

  return spec;
}
