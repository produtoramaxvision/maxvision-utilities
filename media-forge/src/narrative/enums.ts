// src/narrative/enums.ts
// T10 — the enums shared across the narrative schemas, defined exactly once.
//
// The upstream JSON Schemas repeat these literal arrays in several files:
// clip-contract.status and project-state's clip.status are the same eight values;
// take-review.source_status is a strict subset of them; scene.status and
// beat.status are the same five values written twice. Porting each schema
// independently would reproduce that duplication in TypeScript, and the first
// time someone adds a status to one list and not the other the mismatch surfaces
// as a runtime validation failure with no obvious cause.
//
// Defining them here means the subset relationships are checked by the compiler
// rather than by hope. See the SOURCE_STATUS_IS_SUBSET assertion below.
//
// ## Deliberate divergence from the source JSON Schemas: `.strict()`
//
// None of the five files in skills/_shared/schemas/*.json sets
// `additionalProperties: false`, and JSON Schema 2020-12 defaults it to true. The
// Zod ports all use `.strict()`, so they are strictly more restrictive than their
// source. That is chosen, not accidental.
//
// These documents are written by language models and hand-edited between
// sessions. Under the permissive default, `felt_intnet` parses cleanly, the
// misspelled key is dropped on the way through, and the required `felt_intent`
// error points at a field the author believes they set. Rejecting the unknown key
// names the actual mistake. The cost is that a forward-compatible field added by a
// newer writer is rejected by an older reader — acceptable, because
// `schema_version` on ProjectState is the intended channel for that, and a
// version bump is a visible migration rather than a silent partial read.

import { z } from 'zod';

/**
 * Lifecycle of a single clip, from planned through to a terminal verdict.
 *
 * Order is meaningful for reading, not enforced as a state machine here —
 * `repair` legitimately loops back to `generated`.
 */
export const CLIP_STATUSES = [
  'planned',
  'ready',
  'generated',
  'reviewed',
  'accepted',
  'accepted_with_deviation',
  'repair',
  'rejected',
] as const;

export const ClipStatus = z.enum(CLIP_STATUSES);
export type ClipStatusT = z.infer<typeof ClipStatus>;

/**
 * The statuses a take can be reviewed *from*. A take cannot be reviewed before
 * it has been generated, so `planned` and `ready` are excluded.
 */
export const SOURCE_STATUSES = [
  'generated',
  'reviewed',
  'accepted',
  'accepted_with_deviation',
  'repair',
  'rejected',
] as const;

export const SourceStatus = z.enum(SOURCE_STATUSES);
export type SourceStatusT = z.infer<typeof SourceStatus>;

// Compile-time proof that SOURCE_STATUSES stays a subset of CLIP_STATUSES.
// If someone adds a value to SOURCE_STATUSES that is not a clip status, or
// removes one from CLIP_STATUSES that a review still references, this fails to
// typecheck instead of failing at runtime on a user's project state.
const SOURCE_STATUS_IS_SUBSET: readonly ClipStatusT[] = SOURCE_STATUSES;
void SOURCE_STATUS_IS_SUBSET;

/** Shared by scenes and beats — both track the same planning lifecycle. */
export const PLANNING_STATUSES = [
  'planned',
  'current',
  'completed',
  'omitted',
  'replaced',
] as const;

export const PlanningStatus = z.enum(PLANNING_STATUSES);
export type PlanningStatusT = z.infer<typeof PlanningStatus>;

/** How a clip is physically structured as a generation request. */
export const SHOT_STRUCTURES = [
  'compact_single_take',
  'phased_single_take',
  'dense_multishot',
  'first_last_frame_transition',
  'video_edit_contract',
] as const;

export const ShotStructure = z.enum(SHOT_STRUCTURES);
export type ShotStructureT = z.infer<typeof ShotStructure>;

/** Where a clip sits on the narrative arc. */
export const ARC_POSITIONS = ['open', 'rising', 'turn', 'climax', 'release'] as const;

export const ArcPosition = z.enum(ARC_POSITIONS);
export type ArcPositionT = z.infer<typeof ArcPosition>;

/** How this clip relates to the one before it. Drives prompt construction. */
export const SEQUENCE_RELATIONS = [
  'standalone',
  'sequence_first_clip',
  'seamless_continuation',
  'intentional_next_shot',
  'bridge_between_known_states',
  'repair_tail',
  'reanchor_after_drift',
] as const;

export const SequenceRelation = z.enum(SEQUENCE_RELATIONS);
export type SequenceRelationT = z.infer<typeof SequenceRelation>;

/** Which artifact establishes the clip's opening frame. */
export const OPENING_STATE_SOURCES = [
  'planned_start_state',
  'observed_end_state',
  'user_supplied_final_frame',
  'source_clip',
] as const;

export const OpeningStateSource = z.enum(OPENING_STATE_SOURCES);
export type OpeningStateSourceT = z.infer<typeof OpeningStateSource>;

/** Reviewer verdict on a single take. */
export const TAKE_VERDICTS = ['accept', 'accept_with_deviation', 'repair', 'reject'] as const;

export const TakeVerdict = z.enum(TAKE_VERDICTS);
export type TakeVerdictT = z.infer<typeof TakeVerdict>;

export const OBSERVATION_CONFIDENCES = ['low', 'medium', 'high'] as const;

export const ObservationConfidence = z.enum(OBSERVATION_CONFIDENCES);
export type ObservationConfidenceT = z.infer<typeof ObservationConfidence>;

export const PROJECT_MODES = ['standalone_clip', 'sequence_project'] as const;

export const ProjectMode = z.enum(PROJECT_MODES);
export type ProjectModeT = z.infer<typeof ProjectMode>;

/**
 * Free-form JSON object, used for the state-description blobs (planned_start_state,
 * world_bible, surface) that the upstream schema leaves as bare `{"type":
 * "object"}`. Deliberately permissive: these hold model-authored descriptions
 * whose shape is not fixed. Kept as a named export so the looseness is a single
 * documented decision rather than scattered `z.record` calls.
 */
export const StateBlob = z.record(z.unknown());
export type StateBlobT = z.infer<typeof StateBlob>;
