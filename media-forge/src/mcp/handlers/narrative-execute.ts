// src/mcp/handlers/narrative-execute.ts
// The plan executor: the three tools that turn a ProjectState into generations.
//
// T10 delivered clip-contract, prompt-spec, generation-run and take-review; T13
// delivered the planner and image-selector. Nothing consumed any of them. No task
// in the plan ever specified a runner — T10 says "port the schemas", T13 says
// "the output feeds project-state" — so five tested modules sat with zero
// importers in src/. This is the consumer they were built for.
//
// ## Why three tools and not one
//
// The loop is prepare -> dispatch -> record -> review, and the dispatch step is
// NOT ours. Every provider already has a submit tool with its own cost guard,
// credit preflight and ledger hooks wired at the register.ts call site. Adding a
// dispatch path here would be a SECOND submit path per provider — the exact
// duplication this repo keeps finding as a defect (two writers for one event
// diverge, and nothing decides which is right). It would also be one more place
// to route a spec to an adapter that rejects it, which is a failure this branch
// has already paid for once.
//
// So:
//
//   media_narrative_execute_clip   picks the clip, validates it is safe to run,
//                                  builds the contract and the prompt spec, and
//                                  returns the exact tool + arguments to call.
//                                  Read-only: no state write, no spend.
//
//   media_narrative_record_run     you dispatched and got a jobId back. Writes
//                                  the provenance row and advances the clip.
//
//   media_narrative_record_take    a reviewer judged the take. Folds the verdict
//                                  into the plan.
//
// Splitting on the jobId boundary is not a workaround: `GenerationRun.run_id` IS
// the job id, by design, so the provenance row cannot exist before the provider
// has answered. The same shape as the submit/poll/download idiom already used
// for Kling, Higgsfield and MuAPI.
//
// ## What this does NOT decide
//
// The provider and model are caller input, never inferred. An executor that
// picked its own provider would be the automatic router with a different name,
// and this repo already has an open finding where a transport reached a
// catalogue that shared no model names with the registry.
//
// Reference AUTHORITY (which asset owns which controlled dimension) is T12's and
// is not touched here. `selectReferences` chooses WHICH assets; that is a
// different question, and prompt-spec.ts is explicit that restating any part of
// T12's rule would give it two homes that drift apart.
//
// ## Verification status
//
// Every rule below is exercised against a built ProjectState. NO paid generation
// has been dispatched through this path — by design, since dispatch belongs to
// the provider tools, and by circumstance, since this branch is not spending.
// Stated rather than left to be assumed from a green suite.

import { z } from 'zod';
import { ValidationError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import { PROVIDERS, type Provider } from '../../core/models.js';
import {
  selectNextClip,
  assertDispatchable,
  toClipContract,
  buildPromptSpec,
  applyDispatch,
  applyTakeReview,
  nextPromptVersion,
} from '../../narrative/executor.js';
import {
  loadProjectState,
  saveProjectState,
} from '../../narrative/project-state-store.js';
import { recordGenerationRun, listRunsForClip } from '../../narrative/generation-run-store.js';
import { parseTakeReview } from '../../review/take-review.js';
import {
  selectReferences,
  selectBestTake,
  winningTake,
  type ReferenceCandidate,
  type TakeCandidate,
} from '../../narrative/agents/image-selector.js';
import { isDirective } from '../../narrative/agents/invoke.js';
import type { ClipContractT } from '../../narrative/clip-contract.js';
import type { PromptSpecT } from '../../narrative/prompt-spec.js';
import type { ProjectStateT } from '../../narrative/project-state.js';

export interface NarrativeExecuteOpts {
  readonly dbPath?: string;
  readonly tenantId?: string | null;
  /** Test seam; forwarded to image-selector. */
  readonly agentOpts?: unknown;
  /** Test seam so state transitions are deterministic. */
  readonly nowIso?: string;
}

/**
 * The provider submit tool each generation mode maps onto.
 *
 * A map rather than a guess. An unmapped provider/mode pair is refused by name:
 * the alternative is emitting a tool name that does not exist, which the caller
 * discovers only when the dispatch fails, after this tool has already reported
 * success.
 */
export const DISPATCH_TOOLS: Record<string, Partial<Record<string, string>>> = {
  google: {
    t2v: 'media_generate_video_t2v',
    i2v: 'media_generate_video_i2v',
    extend: 'media_extend_video',
    interpolate: 'media_generate_video_interpolate',
    'with-refs': 'media_generate_video_with_refs',
  },
  bytedance: {
    t2v: 'media_seedance_text_to_video',
    i2v: 'media_seedance_image_to_video',
    'multi-shot': 'media_seedance_multishot',
    'with-refs': 'media_seedance_reference_fusion',
  },
  kling: {
    extend: 'media_kling_video_extend',
    'multi-shot': 'media_kling_omni_multishot',
    elements: 'media_kling_elements',
    'lip-sync': 'media_kling_lip_sync',
    'motion-brush': 'media_kling_motion_brush',
  },
  higgsfield: {
    t2v: 'media_higgsfield_generate',
    i2v: 'media_higgsfield_generate',
  },
  muapi: {
    t2v: 'media_muapi_generate',
    i2v: 'media_muapi_generate',
  },
  wan2gp: {
    t2v: 'media_wan2gp_generate',
  },
};

function resolveDispatchTool(provider: Provider, mode: string): string {
  const tool = DISPATCH_TOOLS[provider]?.[mode];
  if (tool === undefined) {
    const available = Object.keys(DISPATCH_TOOLS[provider] ?? {});
    throw new ValidationError(
      `no media-forge tool submits generation_mode "${mode}" to provider "${provider}". ` +
        (available.length > 0
          ? `That provider's tools cover: ${available.join(', ')}. `
          : `That provider has no submit tool here. `) +
        `Re-plan the clip with a mode this provider serves, or dispatch it to a provider ` +
        `that does — naming a tool that does not exist would fail only after this call ` +
        `reported success.`,
    );
  }
  return tool;
}

/**
 * Unwraps an agent result, refusing a subagent directive.
 *
 * Mirrors `requireResolved` in narrative.ts, and for the same reason: a
 * directive means the agent expects the Claude Code orchestrator to dispatch it,
 * which this process cannot do. Returning it as if it were a result is the
 * silent failure the two-tool split in that file exists to avoid — you assign a
 * directive to a variable typed as a selection and find out several steps later.
 *
 * Written as an explicit unwrap rather than relying on `isDirective` to narrow,
 * because its `AgentDirective<T>` predicate does not subtract cleanly from these
 * unions and the negative branch stays widened.
 */
function requireAgentResult<T>(
  value: T | { mode: 'subagent'; agentName: string; payload: unknown },
  agent: string,
  remedy: string,
): T {
  if (isDirective(value)) {
    throw new ValidationError(
      `the ${agent} returned a subagent directive, which only the Claude Code orchestrator ` +
        `can dispatch. Either unset CLAUDE_CODE_SESSION_ID to use the Anthropic SDK, or ${remedy}.`,
    );
  }
  return value as T;
}

function requireDb(opts: NarrativeExecuteOpts): string {
  if (opts.dbPath === undefined) {
    throw new ValidationError(
      'the narrative executor needs a project database; none is configured for this server',
    );
  }
  return opts.dbPath;
}

function requireState(opts: NarrativeExecuteOpts, projectId: string): ProjectStateT {
  const state = loadProjectState({
    dbPath: requireDb(opts),
    projectId,
    tenantId: opts.tenantId ?? null,
  });
  if (state === null) {
    throw new ValidationError(
      `no saved project ${projectId}. Run media_narrative_plan or media_narrative_assemble ` +
        `with persist:true first — the executor advances a stored plan, it does not create one.`,
    );
  }
  return state;
}

// ---------------------------------------------------------------------------
// media_narrative_execute_clip
// ---------------------------------------------------------------------------

const ReferenceCandidateInput = z.object({
  assetId: z.string().min(1),
  description: z.string().min(1),
  characterTag: z.string().min(1).optional(),
});

export const NarrativeExecuteClipInput = z.object({
  projectId: z.string().min(1),
  /** Overrides the plan's own choice of next clip. */
  clipId: z.string().min(1).optional(),

  /**
   * Never inferred. See the header: an executor that picks its own provider is
   * the automatic router under another name.
   */
  provider: z.enum(PROVIDERS),
  modelId: z.string().min(1),

  /**
   * Reference assets to choose from. When given, the reference-image-selector
   * agent picks which ones this shot uses; when omitted, no references are
   * attached and the prompt relies on the tags alone.
   */
  referenceCandidates: z.array(ReferenceCandidateInput).optional(),
  /** How many references the target provider accepts. Required with candidates. */
  maxReferences: z.number().int().positive().optional(),

  /**
   * Bump the prompt version. Set on a retake so the attempt history stays a
   * bisection rather than two different prompts sharing one identity.
   */
  bumpPromptVersion: z.boolean().default(false),
});

export interface ExecuteClipResult {
  readonly projectId: string;
  readonly clipId: string;
  readonly contract: ClipContractT;
  readonly promptSpec: PromptSpecT;
  readonly dispatch: {
    readonly tool: string;
    readonly arguments: Record<string, unknown>;
  };
  readonly priorAttempts: number;
  readonly referenceReasons?: ReadonlyArray<{ assetId: string; reason: string }>;
}

/**
 * Prepares the next clip for dispatch. Writes nothing and spends nothing.
 *
 * Read-only is deliberate. The clip does not advance until a provider has
 * actually accepted the job, which `media_narrative_record_run` is told about.
 * Advancing here would mark a clip generated on the strength of a request that
 * may never be sent — and the next call would then skip it, leaving a hole in
 * the sequence that nothing reports.
 */
export async function handleNarrativeExecuteClip(
  rawInput: unknown,
  opts: NarrativeExecuteOpts = {},
): Promise<ExecuteClipResult> {
  const input = NarrativeExecuteClipInput.parse(rawInput);
  const state = requireState(opts, input.projectId);

  const clip =
    input.clipId !== undefined
      ? state.clips.find((c) => c.clip_id === input.clipId)
      : selectNextClip(state);

  if (clip === undefined || clip === null) {
    throw new ValidationError(
      input.clipId !== undefined
        ? `clip ${input.clipId} is not in project ${input.projectId}`
        : `project ${input.projectId} has no clip left to run — every clip is generated, ` +
          `reviewed or terminal.`,
    );
  }

  // Before anything expensive: refuse a clip whose parent has no take yet, or
  // one past its scene's chain cap. Both produce a paid generation that is wrong
  // in a way nothing downstream can distinguish from a model quality problem.
  assertDispatchable(state, clip);

  // parseClipContract, which is what enforces that the three beat lists are
  // disjoint. Those lists are derived by index arithmetic in buildClip and have
  // never been validated against a real screenplay.
  const contract = toClipContract(state, clip);

  const tool = resolveDispatchTool(input.provider, clip.generation_mode);

  let referenceRoles: Array<Record<string, unknown>> = [];
  let referenceReasons: Array<{ assetId: string; reason: string }> | undefined;

  if (input.referenceCandidates !== undefined && input.referenceCandidates.length > 0) {
    if (input.maxReferences === undefined) {
      throw new ValidationError(
        'referenceCandidates were supplied without maxReferences. The cap is the target ' +
          "provider's own limit — over it the request is rejected, and near it each " +
          'reference is weighted less. There is no safe default to assume.',
      );
    }

    const selection = requireAgentResult(
      await selectReferences(
        {
          shotId: clip.clip_id,
          shotAction: clip.narrative_job,
          requiredCharacterTags: clip.continuity_locks.filter(
            (l): l is string => typeof l === 'string',
          ),
          candidates: input.referenceCandidates as ReadonlyArray<ReferenceCandidate>,
          maxReferences: input.maxReferences,
        },
        opts.agentOpts as never,
      ),
      'reference-image-selector',
      'omit referenceCandidates and attach references yourself',
    );

    // Passed through as opaque records. T12 owns what a role MEANS; this only
    // records which asset was chosen and why.
    referenceRoles = selection.selected.map((s) => ({ asset_id: s.assetId, reason: s.reason }));
    referenceReasons = selection.selected.map((s) => ({ assetId: s.assetId, reason: s.reason }));
  }

  const promptVersion = input.bumpPromptVersion
    ? nextPromptVersion(clip.prompt_version)
    : clip.prompt_version;

  // Budget-checked against THIS provider. A prompt that overruns is a planning
  // defect: the provider truncates silently, and the tail is where the
  // exclusions sit — so the model would be free to stage exactly the beats the
  // contract reserved for later clips.
  const promptSpec = buildPromptSpec({
    state,
    clip,
    contract,
    provider: input.provider,
    referenceRoles,
    promptVersion,
  });

  const priorAttempts = listRunsForClip({
    dbPath: requireDb(opts),
    projectId: state.project_id,
    clipId: clip.clip_id,
    tenantId: opts.tenantId ?? null,
  }).length;

  return {
    projectId: state.project_id,
    clipId: clip.clip_id,
    contract,
    promptSpec,
    dispatch: {
      tool,
      arguments: {
        modelId: input.modelId,
        prompt: promptSpec.natural_language_prompt,
        durationSec: contract.target_duration_sec,
      },
    },
    priorAttempts,
    ...(referenceReasons !== undefined ? { referenceReasons } : {}),
  };
}

// ---------------------------------------------------------------------------
// media_narrative_record_run
// ---------------------------------------------------------------------------

export const NarrativeRecordRunInput = z.object({
  projectId: z.string().min(1),
  clipId: z.string().min(1),

  /**
   * The provider's job id, as returned by whichever submit tool was called.
   *
   * This IS the run id — the same identifier video_jobs and the trace are keyed
   * on. That is what lets the narrative record join to the cost record without
   * either side storing the other's data.
   */
  jobId: z.string().min(1),

  surface: z.string().min(1),
  promptVersion: z.string().min(1),
  prompt: z.string().min(1),
  inputMode: z.string().min(1),
  referenceTags: z.array(z.string()).default([]),

  /**
   * Marks an eval-suite record. A synthetic run must never have reserved credit,
   * and `parseGenerationRun` refuses the combination of this flag with a
   * dispatched status — the check that stops a fixture from quietly reaching a
   * real provider.
   */
  isSyntheticFixture: z.boolean().default(false),
});

export interface RecordRunResult {
  readonly projectId: string;
  readonly clipId: string;
  readonly runId: string;
  readonly stateRevision: number;
  readonly nextClipId: string;
}

/**
 * Records that a clip was really dispatched, and advances the plan.
 *
 * Two writes, ordered so a failure cannot leave the plan claiming a generation
 * that has no provenance: the run row first, the state second. The reverse order
 * would mark the clip generated and then fail to record which prompt produced
 * it, which is precisely the question GenerationRun exists to answer.
 *
 * Carries NO cost. Money is owned by video_jobs and trace.jsonl, joined on this
 * same jobId; a second writer for one amount diverges the first time a retry
 * settles differently, and the daily cap then has no principled source.
 */
export async function handleNarrativeRecordRun(
  rawInput: unknown,
  opts: NarrativeExecuteOpts = {},
): Promise<RecordRunResult> {
  const input = NarrativeRecordRunInput.parse(rawInput);
  const dbPath = requireDb(opts);
  const state = requireState(opts, input.projectId);

  const clip = state.clips.find((c) => c.clip_id === input.clipId);
  if (clip === undefined) {
    throw new ValidationError(
      `clip ${input.clipId} is not in project ${input.projectId}`,
    );
  }

  recordGenerationRun({
    dbPath,
    tenantId: opts.tenantId ?? null,
    ...(opts.nowIso !== undefined ? { nowIso: opts.nowIso } : {}),
    run: {
      run_id: input.jobId,
      project_id: state.project_id,
      clip_id: input.clipId,
      surface: input.surface,
      prompt_version: input.promptVersion,
      input_mode: input.inputMode,
      reference_tags: input.referenceTags,
      prompt: input.prompt,
      // A fixture never reached a provider; anything else has been submitted.
      result_status: input.isSyntheticFixture ? 'not_run_fixture' : 'submitted',
      is_synthetic_fixture: input.isSyntheticFixture,
    },
  });

  const advanced = applyDispatch({
    state,
    clipId: input.clipId,
    promptVersion: input.promptVersion,
    ...(opts.nowIso !== undefined ? { nowIso: opts.nowIso } : {}),
  });

  saveProjectState({
    dbPath,
    state: advanced,
    tenantId: opts.tenantId ?? null,
    ...(opts.nowIso !== undefined ? { nowIso: opts.nowIso } : {}),
  });

  logger.info('narrative run recorded', {
    projectId: state.project_id,
    clipId: input.clipId,
    runId: input.jobId,
    stateRevision: advanced.state_revision,
  });

  return {
    projectId: state.project_id,
    clipId: input.clipId,
    runId: input.jobId,
    stateRevision: advanced.state_revision,
    nextClipId: advanced.current_clip_id,
  };
}

// ---------------------------------------------------------------------------
// media_narrative_record_take
// ---------------------------------------------------------------------------

const TakeCandidateInput = z.object({
  takeId: z.string().min(1),
  assetPath: z.string().min(1),
});

export const NarrativeRecordTakeInput = z.object({
  projectId: z.string().min(1),
  /** A full TakeReview document. Validated by parseTakeReview. */
  review: z.unknown(),

  /**
   * More than one take for this clip. When given, the best-image-selector ranks
   * them and the winner is returned; the ranking is never reduced to a bare
   * winner, so a close call stays visible.
   */
  takeCandidates: z.array(TakeCandidateInput).optional(),
  /** What the sequence has already established, for consistency scoring. */
  establishedLook: z.string().optional(),
});

export interface RecordTakeResult {
  readonly projectId: string;
  readonly clipId: string;
  readonly clipStatus: string;
  readonly stateRevision: number;
  readonly heldForConfirmation: boolean;
  readonly winningTakeId?: string;
  readonly ranking?: ReadonlyArray<{ takeId: string; score: number; reason: string }>;
}

/**
 * Folds a reviewer's verdict back into the plan.
 *
 * `parseTakeReview` runs first and is not a formality: it rejects a review that
 * reports incomplete beats while returning `accept`, which the retake protocol
 * would otherwise read as a finished clip — leaving the missing beat to be
 * generated by nothing at all.
 *
 * A low-confidence verdict that would authorise more spending is recorded but
 * NOT acted on; see `applyTakeReview`. The clip parks at `reviewed`, which is
 * not a runnable status, so nothing dispatches until a human decides.
 */
export async function handleNarrativeRecordTake(
  rawInput: unknown,
  opts: NarrativeExecuteOpts = {},
): Promise<RecordTakeResult> {
  const input = NarrativeRecordTakeInput.parse(rawInput);
  const dbPath = requireDb(opts);
  const state = requireState(opts, input.projectId);

  const review = parseTakeReview(input.review);

  let winningTakeId: string | undefined;
  let ranking: Array<{ takeId: string; score: number; reason: string }> | undefined;

  if (input.takeCandidates !== undefined && input.takeCandidates.length > 0) {
    const clip = state.clips.find((c) => c.clip_id === review.clip_id);
    if (clip === undefined) {
      throw new ValidationError(
        `take review names clip ${review.clip_id}, which is not in project ${state.project_id}`,
      );
    }

    const selection = requireAgentResult(
      await selectBestTake(
        {
          shotId: clip.clip_id,
          shotAction: clip.narrative_job,
          establishedLook: input.establishedLook ?? state.story.tone,
          candidates: input.takeCandidates as ReadonlyArray<TakeCandidate>,
        },
        opts.agentOpts as never,
      ),
      'best-image-selector',
      'omit takeCandidates and pick the take yourself',
    );

    // `winningTake` re-sorts rather than trusting the model's ordering. Silently
    // keeping the wrong take is invisible until someone watches the cut.
    winningTakeId = winningTake(selection);
    ranking = selection.ranking;
  }

  const applied = applyTakeReview({
    state,
    review,
    ...(opts.nowIso !== undefined ? { nowIso: opts.nowIso } : {}),
  });

  saveProjectState({
    dbPath,
    state: applied.state,
    tenantId: opts.tenantId ?? null,
    ...(opts.nowIso !== undefined ? { nowIso: opts.nowIso } : {}),
  });

  const clipStatus =
    applied.state.clips.find((c) => c.clip_id === review.clip_id)?.status ?? 'unknown';

  return {
    projectId: state.project_id,
    clipId: review.clip_id,
    clipStatus,
    stateRevision: applied.state.state_revision,
    heldForConfirmation: applied.heldForConfirmation,
    ...(winningTakeId !== undefined ? { winningTakeId } : {}),
    ...(ranking !== undefined ? { ranking } : {}),
  };
}
