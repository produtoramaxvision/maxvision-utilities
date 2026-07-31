// src/narrative/executor.ts
// The consumer T10 and T13 were built for and nobody ever wrote.
//
// ## What was missing
//
// T10 (`8576d20`, 2026-07-30) delivered five schemas — clip-contract, prompt-spec,
// generation-run, take-review, project-state — and T13 (`466a144`, same day) added
// the six planning agents and `image-selector`. Between them they produce a
// validated ProjectState and define exactly what a runnable clip looks like.
//
// Nothing turned one into the other. No task in the plan ever specified a runner:
// T10 says "port the schemas", T13 says "the output feeds T10's project-state",
// and the step that reads a plan and dispatches a generation was never anybody's
// deliverable. So five modules sat with zero importers in src/ — correct,
// tested, and unreachable.
//
// This file is that step. It is deliberately PURE: it reads a ProjectState and
// produces the contract, the prompt spec and the state transition, and it never
// touches the network, a database, or a provider. Dispatch, credit reservation
// and persistence belong to the handler in src/mcp/handlers/narrative-execute.ts.
// That split is what lets every rule below be tested without a provider and
// without spending anything.
//
// ## One clip per call, never a loop
//
// `current_clip_id` is a single value and `assertMonotonicRevision` guards one
// write at a time. More importantly, a loop that walks a whole plan is a
// credit-spending runaway with no authorisation point per generation. The repo's
// existing idiom is submit / poll / download as separate calls, and this follows
// it: advance exactly one clip, return the new state, let the caller decide
// whether to continue.
//
// ## What building this found
//
// `buildClip` was dropping three storyboard fields — `shot_structure`, `camera`
// and `duration_sec`. `shot_structure` is REQUIRED by ClipContract, so a
// persisted plan could not be turned into a contract at all, and there was no
// legal value to substitute: guessing one would have been wrong data that
// validates cleanly, which planner.ts:80-88 already names as the worst failure
// mode available here. They are carried now.

import {
  parseClipContract,
  type ClipContractT,
} from './clip-contract.js';
import { parsePromptSpec, type PromptSpecT } from './prompt-spec.js';
import {
  parseProjectState,
  type ClipT,
  type ProjectStateT,
  type SceneT,
} from './project-state.js';
import type { TakeReviewT } from '../review/take-review.js';
import type { SequenceRelationT, OpeningStateSourceT, ShotStructureT } from './enums.js';
import type { Provider } from '../core/models.js';
import { ValidationError } from '../core/errors.js';

/**
 * The clip statuses that mean "this clip still needs a generation".
 *
 * `repair` is included: the T11 retake protocol sends a clip back for another
 * attempt, and a repair that could not be re-dispatched would strand the clip.
 * `reviewed` is NOT — it has a take awaiting a verdict, and re-running it would
 * pay for a second generation of something already in hand.
 */
const RUNNABLE_STATUSES: ReadonlyArray<ClipT['status']> = ['planned', 'ready', 'repair'];

/**
 * Picks the clip to run next.
 *
 * `current_clip_id` wins when it is runnable, because that is the pointer the
 * planner and any concurrent writer agree on. Otherwise the lowest
 * `sequence_index` still runnable — deterministic, so two callers racing on the
 * same state select the same clip and the revision guard resolves the conflict
 * rather than both silently generating different clips.
 *
 * Returns null when the plan has nothing left to run. Null is the completion
 * signal, not an error: a caller looping until null is the intended usage.
 */
export function selectNextClip(state: ProjectStateT): ClipT | null {
  const runnable = state.clips.filter((c) => RUNNABLE_STATUSES.includes(c.status));
  if (runnable.length === 0) return null;

  const current = runnable.find((c) => c.clip_id === state.current_clip_id);
  if (current !== undefined) return current;

  return [...runnable].sort((a, b) => a.sequence_index - b.sequence_index)[0] ?? null;
}

function sceneFor(state: ProjectStateT, clip: ClipT): SceneT {
  const scene = state.scenes.find((s) => s.scene_id === clip.scene_id);
  if (scene === undefined) {
    // Unreachable through parseProjectState, which rejects a clip pointing at an
    // unknown scene. Checked anyway because this function is also reachable from
    // a hand-built state in tests, and a silent undefined here would surface as
    // an unrelated error several steps later.
    throw new ValidationError(
      `clip ${clip.clip_id} references scene ${clip.scene_id}, which is not in this project`,
    );
  }
  return scene;
}

/**
 * Every reason this clip must not be dispatched right now.
 *
 * Returned as a list rather than thrown so a caller sees all of them at once.
 * These are the checks that stop a generation which would be paid for and wrong:
 * an extend with no anchor produces a clip that ignores its parent, and nothing
 * downstream can tell that from a model quality problem.
 */
export function findDispatchBlockers(state: ProjectStateT, clip: ClipT): string[] {
  const problems: string[] = [];

  if (!RUNNABLE_STATUSES.includes(clip.status)) {
    problems.push(
      `clip ${clip.clip_id} has status "${clip.status}"; only ${RUNNABLE_STATUSES.join(', ')} ` +
        `may be dispatched. Re-running it would pay for a second generation of a take you ` +
        `already have.`,
    );
  }

  // An extension inherits its parent's last frame. Dispatching before the parent
  // has a take means there is no frame to inherit.
  if (clip.parent_clip_id !== null) {
    const parent = state.clips.find((c) => c.clip_id === clip.parent_clip_id);
    if (parent === undefined) {
      problems.push(`clip ${clip.clip_id} extends ${clip.parent_clip_id}, which is not in this project`);
    } else if (!['generated', 'reviewed', 'accepted', 'accepted_with_deviation'].includes(parent.status)) {
      problems.push(
        `clip ${clip.clip_id} extends ${parent.clip_id}, which is still "${parent.status}". ` +
          `An extension inherits the parent's last frame, so dispatching now would generate ` +
          `from no anchor at all — billed, and unusable.`,
      );
    }
  }

  // The scene's cap on chain depth. `validateProjectStateIntegrity` checks that
  // extension_depth is CONSISTENT with the parent chain; nothing checks it
  // against the cap, which is what the cap is for.
  const scene = sceneFor(state, clip);
  if (clip.extension_depth > scene.max_chain_depth) {
    problems.push(
      `clip ${clip.clip_id} sits ${clip.extension_depth} extensions deep but scene ` +
        `${scene.scene_id} caps the chain at ${scene.max_chain_depth}. Each link inherits the ` +
        `previous frame, so drift compounds; re-anchor from a reference instead.`,
    );
  }

  return problems;
}

/** Throws with every blocker at once. Use before any paid dispatch. */
export function assertDispatchable(state: ProjectStateT, clip: ClipT): void {
  const problems = findDispatchBlockers(state, clip);
  if (problems.length > 0) {
    throw new ValidationError(
      `clip ${clip.clip_id} cannot be dispatched:\n- ${problems.join('\n- ')}`,
    );
  }
}

/**
 * Projects a stored clip into the contract the reviewer judges takes against.
 *
 * Goes through `parseClipContract`, not `ClipContract.parse`: the wrapper is what
 * enforces that the three beat lists are disjoint. `buildClip` derives those
 * lists by index arithmetic over the screenplay's beat order and nothing has ever
 * validated the result — a beat in both `already_happened` and `this_clip_only`
 * produces a prompt telling the model to both stage and not stage the same
 * action, which the model resolves arbitrarily and which reads downstream as a
 * model quality problem rather than the planning bug it is.
 *
 * `shot_structure` has no default. A clip planned before it was carried has none,
 * and substituting one would put a fabricated structure into the record the
 * reviewer trusts.
 */
export function toClipContract(state: ProjectStateT, clip: ClipT): ClipContractT {
  if (clip.shot_structure === undefined) {
    throw new ValidationError(
      `clip ${clip.clip_id} has no shot_structure, so no clip contract can be built for it. ` +
        `This plan was assembled before the storyboard's shot_structure was carried into the ` +
        `project state; re-run the planner for this project. Defaulting the value here would ` +
        `put a structure the storyboard never chose into the contract the reviewer judges ` +
        `the take against.`,
    );
  }

  return parseClipContract({
    project_id: state.project_id,
    clip_id: clip.clip_id,
    parent_clip_id: clip.parent_clip_id,
    scene_id: clip.scene_id,
    sequence_index: clip.sequence_index,
    narrative_job: clip.narrative_job,
    felt_intent: clip.felt_intent,
    target_duration_sec: clip.target_duration_sec ?? state.clip_budget_sec,
    generation_mode: clip.generation_mode,
    shot_structure: clip.shot_structure satisfies ShotStructureT,
    already_happened: clip.already_happened,
    this_clip_only: clip.this_clip_only,
    reserved_for_later: clip.reserved_for_later,
    planned_start_state: clip.planned_start_state,
    planned_end_state: clip.planned_end_state,
    continuity_locks: clip.continuity_locks,
    allowed_changes: clip.allowed_changes,
    status: clip.status,
  });
}

/**
 * How this clip relates to the one before it.
 *
 * Derived from facts already in the state rather than asked for, because every
 * input to the decision is recorded: whether the project has more than one clip,
 * whether this clip extends another, whether it is a repair, and whether its
 * parent's take was accepted with a deviation (which is drift, and re-anchoring
 * is the response).
 */
export function resolveSequenceRelation(state: ProjectStateT, clip: ClipT): SequenceRelationT {
  if (state.project_mode === 'standalone_clip') return 'standalone';
  if (clip.status === 'repair') return 'repair_tail';

  if (clip.parent_clip_id === null) {
    // No parent: either the very first clip, or a deliberate re-anchor after a
    // chain was cut. sequence_index distinguishes them.
    return clip.sequence_index === 1 ? 'sequence_first_clip' : 'reanchor_after_drift';
  }

  const parent = state.clips.find((c) => c.clip_id === clip.parent_clip_id);
  if (parent?.status === 'accepted_with_deviation') {
    // The parent ended somewhere other than planned. Continuing seamlessly from
    // it would compound a deviation the reviewer already flagged.
    return 'reanchor_after_drift';
  }

  return clip.transition_in === 'continuous' ? 'seamless_continuation' : 'intentional_next_shot';
}

/**
 * Which artifact establishes this clip's opening frame.
 *
 * `observed_end_state` beats `planned_start_state` whenever the parent has one:
 * what the previous take actually ended on is the frame this clip will really
 * continue from, and planning against the intended state instead is how a chain
 * drifts while every individual clip looks correct.
 */
export function resolveOpeningStateSource(
  state: ProjectStateT,
  clip: ClipT,
): OpeningStateSourceT {
  if (clip.parent_clip_id === null) return 'planned_start_state';
  const parent = state.clips.find((c) => c.clip_id === clip.parent_clip_id);
  if (parent?.observed_end_state != null) return 'observed_end_state';
  return 'planned_start_state';
}

export interface BuildPromptSpecInput {
  readonly state: ProjectStateT;
  readonly clip: ClipT;
  readonly contract: ClipContractT;
  /** Checked against this provider's published prompt budget when given. */
  readonly provider?: Provider;
  /**
   * Reference roles for this clip, already resolved by the caller.
   *
   * Passed through untouched. T12 (Reference Authority Resolver) owns the
   * "exactly one owner per controlled dimension" invariant, and prompt-spec.ts
   * says so explicitly — restating any part of it here would give that rule two
   * homes that drift apart.
   */
  readonly referenceRoles?: ReadonlyArray<Record<string, unknown>>;
  /** Bumped by the caller on a retake. See `nextPromptVersion`. */
  readonly promptVersion?: string;
}

/**
 * Compiles the clip into the resolved, auditable prompt.
 *
 * Validated through `parsePromptSpec` with the provider, so a prompt that
 * overruns the provider's published character budget fails HERE, while the spec
 * is still editable. Truncation at the provider boundary silently drops the tail
 * of the prompt — which is exactly where the exclusions sit, so the model would
 * be free to stage the beats the contract reserved.
 */
export function buildPromptSpec(input: BuildPromptSpecInput): PromptSpecT {
  const { state, clip, contract } = input;

  const spec = {
    project_id: state.project_id,
    clip_id: clip.clip_id,
    prompt_version: input.promptVersion ?? clip.prompt_version,
    sequence_relation: resolveSequenceRelation(state, clip),
    generation_mode: clip.generation_mode,
    reference_roles: [...(input.referenceRoles ?? [])],
    opening_state_source: resolveOpeningStateSource(state, clip),
    current_clip_action: clip.narrative_job,
    endpoint: describeEndState(contract),
    completed_beat_exclusions: contract.already_happened,
    reserved_future_exclusions: contract.reserved_for_later,
    natural_language_prompt: composePrompt(state, clip, contract),
  };

  return parsePromptSpec(spec, input.provider);
}

/**
 * The string actually sent to the provider.
 *
 * Composed rather than templated from a config file so the ordering is visible:
 * action first because that is what the model weights most heavily, camera next
 * because the storyboard deliberately keeps framing separate from action, then
 * the reference tags that must survive verbatim, and the exclusions last.
 *
 * The exclusions are phrased as instructions rather than listed as bare beat ids.
 * A model handed `beat_03` as something to avoid has been told nothing — the beat
 * DESCRIPTIONS are what carry meaning, so they are resolved from the state.
 */
export function composePrompt(
  state: ProjectStateT,
  clip: ClipT,
  contract: ClipContractT,
): string {
  const parts: string[] = [clip.narrative_job];

  if (clip.camera !== undefined && clip.camera.length > 0) {
    parts.push(`Camera: ${clip.camera}`);
  }

  // Reference tags are tokens the model is instructed to reproduce verbatim;
  // that is the whole mechanism keeping a character consistent across clips.
  const tags = state.reference_registry.map((r) => r.tag);
  if (tags.length > 0) {
    parts.push(`Keep these exact reference tags unchanged: ${tags.join(', ')}.`);
  }

  const alreadyHappened = describeBeats(state, contract.already_happened);
  if (alreadyHappened.length > 0) {
    parts.push(`Do not re-stage what has already happened: ${alreadyHappened.join('; ')}.`);
  }

  const reserved = describeBeats(state, contract.reserved_for_later);
  if (reserved.length > 0) {
    parts.push(
      `Do not show any of the following — they belong to later clips: ${reserved.join('; ')}.`,
    );
  }

  return parts.join(' ');
}

/**
 * Beat descriptions for a list of ids.
 *
 * An id with no matching beat is skipped rather than passed through. Emitting a
 * bare `beat_07` into the prompt would ask the model to avoid a token that means
 * nothing to it, which is noise at best; `parseProjectState` already rejects a
 * state whose beats do not resolve, so a miss here is only reachable from a
 * hand-built state.
 */
function describeBeats(state: ProjectStateT, beatIds: ReadonlyArray<string>): string[] {
  const byId = new Map(state.beats.map((b) => [b.beat_id, b.description]));
  return beatIds.map((id) => byId.get(id)).filter((d): d is string => d !== undefined && d.length > 0);
}

/** Human-readable description of where the clip must end. */
function describeEndState(contract: ClipContractT): string {
  const planned = contract.planned_end_state;
  const keys = Object.keys(planned);
  if (keys.length === 0) return contract.felt_intent;
  return keys.map((k) => `${k}: ${String(planned[k])}`).join('; ');
}

/**
 * The next prompt version for a retake.
 *
 * prompt-spec.ts requires the version to change whenever any field changes, and
 * take-review.ts records the ONE variable a retake is permitted to change.
 * Together those make a clip's attempt history a bisection: read across the
 * versions and you see the sequence of single changes tried. Reusing a version
 * after changing the prompt collapses two different prompts into one identity and
 * the history stops meaning anything.
 *
 * `v1` -> `v2` -> `v3`. A version that does not match the pattern gets a `.1`
 * suffix rather than being renumbered, so a caller's own scheme survives.
 */
export function nextPromptVersion(current: string): string {
  const match = /^v(\d+)$/.exec(current);
  if (match !== null) return `v${Number(match[1]) + 1}`;
  return `${current}.1`;
}

export interface ApplyDispatchInput {
  readonly state: ProjectStateT;
  readonly clipId: string;
  /** The prompt version actually used, so a retake's bump is recorded. */
  readonly promptVersion: string;
  /** Test seam. Defaults to now. */
  readonly nowIso?: string;
}

/**
 * Records that a clip was dispatched: status to `generated`, revision bumped.
 *
 * Returns a NEW state rather than mutating: `assertMonotonicRevision` compares a
 * held revision against the stored one, and an in-place bump would make the
 * caller's "before" and "after" the same object, defeating the check.
 *
 * The revision bump is the point. Two agents working one project concurrently is
 * the expected case — the reviewer writes take results while the planner writes
 * the next clip — and without a bump here the later write silently wins.
 */
export function applyDispatch(input: ApplyDispatchInput): ProjectStateT {
  const { state, clipId, promptVersion } = input;

  const exists = state.clips.some((c) => c.clip_id === clipId);
  if (!exists) {
    throw new ValidationError(`cannot record a dispatch for unknown clip ${clipId}`);
  }

  const clips = state.clips.map((c) =>
    c.clip_id === clipId ? { ...c, status: 'generated' as const, prompt_version: promptVersion } : c,
  );

  // The next runnable clip becomes current. Leaving current_clip_id pointing at
  // a clip that was just generated would make the next call re-select it, find
  // it no longer runnable, and fall back to sequence order anyway — same result,
  // one confusing step later.
  const next = clips.find(
    (c) => c.clip_id !== clipId && RUNNABLE_STATUSES.includes(c.status),
  );

  return parseProjectState({
    ...state,
    clips,
    current_clip_id: next?.clip_id ?? '',
    state_revision: state.state_revision + 1,
    updated_at: input.nowIso ?? new Date().toISOString(),
  });
}

/**
 * The clip status each verdict resolves to.
 *
 * Exhaustive over `TakeVerdict` by construction — a new verdict fails to
 * typecheck here rather than silently falling through to a default, which would
 * leave the clip in whatever status it already had while the review claimed
 * otherwise.
 */
const STATUS_FOR_VERDICT = {
  accept: 'accepted',
  accept_with_deviation: 'accepted_with_deviation',
  repair: 'repair',
  reject: 'rejected',
} as const satisfies Record<TakeReviewT['verdict'], ClipT['status']>;

export interface ApplyTakeReviewInput {
  readonly state: ProjectStateT;
  readonly review: TakeReviewT;
  /** Test seam. Defaults to now. */
  readonly nowIso?: string;
}

export interface ApplyTakeReviewResult {
  readonly state: ProjectStateT;
  /**
   * True when the verdict was withheld because the reviewer asked for user
   * confirmation. The review is still recorded; only the status transition that
   * would authorise a paid retake is held back.
   */
  readonly heldForConfirmation: boolean;
}

/**
 * Folds a reviewer's observation back into the plan.
 *
 * Three things happen, and they are separable on purpose. The review is appended
 * to `take_history` — the document's own log, so it persists with the state and
 * participates in the same `state_revision` concurrency guard rather than needing
 * a second store that could disagree. The clip's `observed_start_state` and
 * `observed_end_state` are set from what the reviewer SAW, which is what the next
 * clip in the chain will really continue from. And the verdict resolves to a
 * status.
 *
 * ## Why a low-confidence verdict does not become `repair`
 *
 * `repair` is a runnable status: the very next execute call would dispatch a paid
 * retake off the back of it. take-review.ts requires
 * `requires_user_confirmation` whenever observation confidence is low, and its
 * comment says honouring the flag is "what stops a low-confidence automated
 * verdict from silently burning credit on rerolls the user would not have
 * authorised." Honouring it means exactly this: record everything, park the clip
 * at `reviewed`, and let a human decide. `reviewed` is deliberately not runnable,
 * so nothing advances on its own.
 *
 * The two ACCEPT verdicts are applied even under the flag — they are terminal and
 * spend nothing. Only the paths that would authorise more spending are held.
 */
export function applyTakeReview(input: ApplyTakeReviewInput): ApplyTakeReviewResult {
  const { state, review } = input;

  const clip = state.clips.find((c) => c.clip_id === review.clip_id);
  if (clip === undefined) {
    throw new ValidationError(
      `take review names clip ${review.clip_id}, which is not in project ${state.project_id}`,
    );
  }

  if (review.project_id !== state.project_id) {
    // A review carrying another project's id is almost always a copy-paste of a
    // take from a different run. Applying it would overwrite this clip's
    // observed state with observations of a completely different generation.
    throw new ValidationError(
      `take review is for project ${review.project_id} but this state is ${state.project_id}`,
    );
  }

  const resolved = STATUS_FOR_VERDICT[review.verdict];
  const authorisesSpending = resolved === 'repair' || resolved === 'rejected';
  const heldForConfirmation = review.requires_user_confirmation && authorisesSpending;
  const nextStatus: ClipT['status'] = heldForConfirmation ? 'reviewed' : resolved;

  const clips = state.clips.map((c) =>
    c.clip_id === review.clip_id
      ? {
          ...c,
          status: nextStatus,
          observed_start_state: review.observed_start_state,
          observed_end_state: review.observed_end_state,
          continuity_breaks: review.continuity_breaks,
          accepted_deviations: review.accepted_deviations,
        }
      : c,
  );

  // Beats the take actually delivered are marked completed. A beat the reviewer
  // saw fire that was RESERVED for a later clip is also marked completed — the
  // damage is done, and leaving it planned would have a later clip generate it a
  // second time.
  const delivered = new Set([...review.completed_beats, ...review.unexpected_completed_beats]);
  const beats = state.beats.map((b) =>
    delivered.has(b.beat_id) ? { ...b, status: 'completed' as const } : b,
  );

  return {
    state: parseProjectState({
      ...state,
      clips,
      beats,
      take_history: [...state.take_history, review],
      state_revision: state.state_revision + 1,
      updated_at: input.nowIso ?? new Date().toISOString(),
    }),
    heldForConfirmation,
  };
}
