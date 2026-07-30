// src/mcp/handlers/narrative.ts
// The entry point into the T13 narrative planner.
//
// T10 and T13 delivered fifteen tested modules with no way to invoke them: a
// `fallow audit --production` run against origin/homolog flagged every file in
// src/narrative/ as unused, and a hand check confirmed it — nothing outside that
// directory imported any of it. Correct code nobody can call is not a feature.
//
// ## Two tools, because the two execution modes are genuinely different
//
// `media_narrative_plan` runs the whole pipeline through the Anthropic SDK. It
// needs ANTHROPIC_API_KEY and works anywhere.
//
// `media_narrative_assemble` takes agent results the CALLER already collected and
// does only the deterministic part: join, validate, persist. This is the path
// that works inside Claude Code, where the six agents run as subagents dispatched
// by the orchestrator rather than by this process.
//
// The alternative — one tool that sometimes returns a ProjectState and sometimes
// returns a directive the caller must dispatch and re-submit — was rejected. A
// tool whose return type depends on ambient environment is one callers get wrong,
// and the failure is silent: you assign a directive to a variable typed as a
// plan and find out several steps later.
//
// ## Planning LLM calls are NOT metered by the cost guard
//
// Stated plainly rather than left ambiguous. The SDK path makes up to six
// Anthropic calls, and `checkCostGuardOrThrow` does not see them.
//
// This matches the existing precedent rather than inventing a rule: the reviewer
// in src/review/llm-judge.ts has always called Anthropic outside the guard. The
// guard and the ledger are built around per-generation PROVIDER spend in USD —
// Veo, Kling, Higgsfield, Seedance — and folding token billing into them is a
// real design change, not a line to add here.
//
// What IS bounded is the number of calls: the pipeline makes at most one call per
// agent plus one per scene, and MAX_SCENES caps the second term. There is no
// model-terminated loop in this path, so it cannot run away.

import { z } from 'zod';
import { ValidationError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import {
  extractCharacters,
  type CharacterExtractorResultT,
} from '../../narrative/agents/character-extractor.js';
import { writeScreenplay, type ScreenwriterResultT } from '../../narrative/agents/screenwriter.js';
import {
  planScenes,
  SCRIPT_PLAN_MODES,
  type ScriptPlannerResultT,
} from '../../narrative/agents/script-planner.js';
import {
  storyboardScene,
  type StoryboardArtistResultT,
} from '../../narrative/agents/storyboard-artist.js';
import { isDirective } from '../../narrative/agents/invoke.js';
import { assembleProjectState, newProjectId } from '../../narrative/planner.js';
import { saveProjectState } from '../../narrative/project-state-store.js';
import type { ProjectStateT } from '../../narrative/project-state.js';

export const NarrativePlanInput = z.object({
  brief: z.string().min(1),
  mode: z.enum(SCRIPT_PLAN_MODES).default('narrative'),
  targetDurationSec: z.number().positive().nullable().default(null),
  knownCharacters: z.array(z.string()).optional(),
  projectId: z.string().optional(),
  /** Persist the assembled state so a later session can resume it. */
  persist: z.boolean().default(false),
});

export type NarrativePlanInputT = z.infer<typeof NarrativePlanInput>;

export interface NarrativeHandlerOpts {
  /** Test seam; forwarded to every agent. */
  readonly agentOpts?: {
    readonly forceMode?: 'subagent' | 'sdk';
    readonly _anthropicClient?: unknown;
  };
  readonly dbPath?: string;
  readonly tenantId?: string | null;
}

/**
 * Runs the full pipeline and returns a validated ProjectState.
 *
 * Refuses to run on the subagent path rather than returning a half-answer. In
 * Claude Code the agents are dispatched by the orchestrator, so this process
 * cannot resolve them; `media_narrative_assemble` is the tool for that case and
 * the error says so.
 */
export async function handleNarrativePlan(
  rawInput: unknown,
  opts: NarrativeHandlerOpts = {},
): Promise<ProjectStateT> {
  const input = NarrativePlanInput.parse(rawInput);
  const agentOpts = opts.agentOpts as never;

  const cast = requireResolved(
    await extractCharacters(
      {
        brief: input.brief,
        ...(input.knownCharacters ? { knownCharacters: input.knownCharacters } : {}),
      },
      agentOpts,
    ),
    'character-extractor',
  );

  const screenplay = requireResolved(
    await writeScreenplay(
      {
        brief: input.brief,
        characters: cast.characters,
        targetDurationSec: input.targetDurationSec,
      },
      agentOpts,
    ),
    'screenwriter',
  );

  const scenes = requireResolved(
    await planScenes(
      {
        beats: screenplay.beats,
        characters: cast.characters,
        mode: input.mode,
        targetDurationSec: input.targetDurationSec,
      },
      agentOpts,
    ),
    'script-planner',
  );

  // One storyboard per scene. Bounded by MAX_SCENES, which parseScriptPlannerResult
  // already enforced, so this loop has a hard ceiling and no model-supplied exit
  // condition.
  const storyboards = new Map<string, StoryboardArtistResultT>();
  for (const scene of scenes.scenes) {
    const beatsForScene = screenplay.beats.filter((b) =>
      scene.assigned_beat_ids.includes(b.beat_id),
    );

    const board = requireResolved(
      await storyboardScene(
        {
          sceneId: scene.scene_id,
          sceneDescription: scene.narrative_function,
          location: scene.location,
          timeOfDay: scene.time_of_day,
          beats: beatsForScene.map((b) => ({ beat_id: b.beat_id, description: b.description })),
          characters: cast.characters,
          maxChainDepth: scene.max_chain_depth,
          targetDurationSec: input.targetDurationSec,
        },
        agentOpts,
      ),
      `storyboard-artist(${scene.scene_id})`,
    );
    storyboards.set(scene.scene_id, board);
  }

  const state = assembleProjectState({
    projectId: input.projectId ?? newProjectId(),
    cast,
    screenplay,
    scenes,
    storyboards,
    surface: { mode: input.mode },
    clipBudgetSec: input.targetDurationSec,
  });

  if (input.persist) {
    if (opts.dbPath === undefined) {
      throw new ValidationError(
        'persist was requested but no dbPath is configured; the plan was built but not saved',
      );
    }
    saveProjectState({
      dbPath: opts.dbPath,
      state,
      tenantId: opts.tenantId ?? null,
    });
  }

  logger.info('narrative plan assembled', {
    projectId: state.project_id,
    scenes: state.scenes.length,
    clips: state.clips.length,
  });

  return state;
}

export const NarrativeAssembleInput = z.object({
  projectId: z.string().optional(),
  cast: z.unknown(),
  screenplay: z.unknown(),
  scenes: z.unknown(),
  /** Keyed by scene_id. */
  storyboards: z.record(z.unknown()),
  mode: z.enum(SCRIPT_PLAN_MODES).default('narrative'),
  targetDurationSec: z.number().positive().nullable().default(null),
  persist: z.boolean().default(false),
});

/**
 * The deterministic half: join already-collected agent results into a validated
 * ProjectState. No LLM calls, no cost, no network.
 *
 * This is the Claude Code path. The orchestrator dispatches the six agents as
 * subagents, then hands their outputs here — and they go through exactly the same
 * validation the SDK path uses, because assembleProjectState is shared. Two
 * assembly paths would be two chances to diverge.
 */
export async function handleNarrativeAssemble(
  rawInput: unknown,
  opts: NarrativeHandlerOpts = {},
): Promise<ProjectStateT> {
  const input = NarrativeAssembleInput.parse(rawInput);

  const storyboards = new Map<string, StoryboardArtistResultT>(
    Object.entries(input.storyboards).map(([sceneId, board]) => [
      sceneId,
      board as StoryboardArtistResultT,
    ]),
  );

  const state = assembleProjectState({
    projectId: input.projectId ?? newProjectId(),
    cast: input.cast as CharacterExtractorResultT,
    screenplay: input.screenplay as ScreenwriterResultT,
    scenes: input.scenes as ScriptPlannerResultT,
    storyboards,
    surface: { mode: input.mode },
    clipBudgetSec: input.targetDurationSec,
  });

  if (input.persist) {
    if (opts.dbPath === undefined) {
      throw new ValidationError(
        'persist was requested but no dbPath is configured; the plan was built but not saved',
      );
    }
    saveProjectState({ dbPath: opts.dbPath, state, tenantId: opts.tenantId ?? null });
  }

  return state;
}

/**
 * Rejects a directive with the reason and the remedy.
 *
 * A directive means the agent expects to be dispatched as a subagent, which this
 * process cannot do. Returning it as if it were a result is the silent failure
 * this whole two-tool split exists to avoid.
 */
function requireResolved<T>(
  value: T | { mode: 'subagent'; agentName: string; payload: unknown },
  agent: string,
): T {
  if (isDirective(value)) {
    throw new ValidationError(
      `media_narrative_plan cannot run inside a Claude Code session: "${agent}" returned a ` +
        `subagent directive, which only the orchestrator can dispatch. Either unset ` +
        `CLAUDE_CODE_SESSION_ID to use the Anthropic SDK directly, or dispatch the six ` +
        `narrative agents yourself and call media_narrative_assemble with their results.`,
    );
  }
  return value as T;
}
