// tests/mcp/narrative-execute-handler.test.ts
//
// Gate for the three narrative executor tools. Unlike the pure-executor suite,
// these go through the real SQLite stores — the provenance row and the plan state
// are what these tools exist to write, and asserting the returned object alone
// would pass even if neither write happened.
//
// No provider is ever contacted: `media_narrative_execute_clip` deliberately does
// not dispatch, and the other two are told about a jobId rather than producing
// one. That is the design, not a test shortcut — dispatch belongs to the provider
// tools that already carry the cost guard and ledger hooks.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  handleNarrativeExecuteClip,
  handleNarrativeRecordRun,
  handleNarrativeRecordTake,
  DISPATCH_TOOLS,
} from '../../src/mcp/handlers/narrative-execute.js';
import { saveProjectState, loadProjectState } from '../../src/narrative/project-state-store.js';
import {
  getGenerationRun,
  listRunsForClip,
} from '../../src/narrative/generation-run-store.js';
import { MCP_TOOLS } from '../../src/mcp/schemas.js';
import type { ClipT, ProjectStateT, SceneT } from '../../src/narrative/project-state.js';

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mf-narr-exec-'));
  dbPath = join(tmpDir, 'narrative.db');
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // EPERM on Windows — a SQLite handle may still be closing.
  }
});

function makeScene(overrides: Partial<SceneT> = {}): SceneT {
  return {
    scene_id: 'scene_1',
    scene_index: 1,
    narrative_function: 'setup',
    arc_position: 'open',
    location: 'a kitchen',
    time_of_day: 'morning',
    anchor_source: [],
    max_chain_depth: 3,
    audio_plan: 'ambient',
    assigned_clip_ids: ['clip_a'],
    transition_out: 'cut',
    status: 'planned',
    ...overrides,
  };
}

function makeClip(overrides: Partial<ClipT> = {}): ClipT {
  return {
    clip_id: 'clip_a',
    parent_clip_id: null,
    scene_id: 'scene_1',
    sequence_index: 1,
    prompt_version: 'v1',
    generation_mode: 't2v',
    status: 'planned',
    narrative_job: 'she pours the coffee',
    felt_intent: 'quiet morning calm',
    shot_structure: 'compact_single_take',
    camera: 'slow push in',
    target_duration_sec: 5,
    already_happened: [],
    this_clip_only: ['beat_1'],
    reserved_for_later: [],
    planned_start_state: {},
    planned_end_state: {},
    observed_start_state: null,
    observed_end_state: null,
    continuity_locks: ['@ana'],
    allowed_changes: [],
    continuity_breaks: [],
    accepted_deviations: [],
    transition_in: 'cut',
    transition_out: 'cut',
    open_motion_vectors: [],
    handoff_requirements: [],
    extension_depth: 0,
    ...overrides,
  };
}

function makeState(overrides: Partial<ProjectStateT> = {}): ProjectStateT {
  const clips = overrides.clips ?? [makeClip()];
  return {
    schema_version: '1.0.0',
    state_revision: 1,
    project_id: 'proj_exec',
    project_mode: 'sequence_project',
    surface: {},
    clip_budget_sec: 10,
    prompt_budget: null,
    story: {
      logline: 'a quiet morning',
      story_promise: 'calm',
      objective: 'establish tone',
      initial_condition: 'asleep',
      final_outcome: 'awake',
      target_duration_sec: 10,
      tone: 'warm, unhurried',
      medium: 'film',
    },
    world_bible: {},
    reference_registry: [{ tag: '@ana', role: 'protagonist', preserve_exact_tag: true }],
    scenes: overrides.scenes ?? [makeScene({ assigned_clip_ids: clips.map((c) => c.clip_id) })],
    beats: [
      {
        beat_id: 'beat_1',
        description: 'she pours coffee',
        narrative_function: 'setup',
        status: 'planned',
        assigned_clip_id: clips[0]?.clip_id ?? null,
        dependencies: [],
      },
    ],
    clips,
    take_history: [],
    current_clip_id: clips[0]?.clip_id ?? '',
    canon_revision: 1,
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function seed(state: ProjectStateT = makeState()): ProjectStateT {
  saveProjectState({ dbPath, state });
  return state;
}

// ---------------------------------------------------------------------------
// The dispatch map must name tools that exist
// ---------------------------------------------------------------------------

describe('dispatch tool map', () => {
  it('every tool the executor can name is a real registered tool', () => {
    // The failure this prevents: execute_clip returns a tool name, reports
    // success, and the caller discovers only at dispatch that no such tool
    // exists — after this call already said it worked.
    //
    // Read straight out of the map rather than reached through the handler, so
    // it covers EVERY entry rather than the provider/mode pairs a test author
    // remembered to enumerate. A rename in schemas.ts breaks here instead of in
    // a user's session.
    const known = new Set(MCP_TOOLS.map((t) => t.name));

    for (const [provider, modes] of Object.entries(DISPATCH_TOOLS)) {
      for (const [mode, tool] of Object.entries(modes)) {
        expect(known, `${provider}/${mode} maps to "${tool}", which is not a registered tool`).toContain(
          tool,
        );
      }
    }
  });

  it('covers every provider that has a video submit tool', () => {
    // higgsfield-cli is deliberately absent: its CLI job types share no names
    // with the registry, an open finding in TODOS.md. Listing it would route a
    // spec to a transport that rejects every one of them.
    expect(Object.keys(DISPATCH_TOOLS).sort()).toEqual([
      'bytedance',
      'google',
      'higgsfield',
      'kling',
      'muapi',
      'wan2gp',
    ]);
  });

  it('an unsupported provider/mode pair is refused, never guessed', async () => {
    seed(makeState({ clips: [makeClip({ generation_mode: 'lip-sync' })] }));
    await expect(
      handleNarrativeExecuteClip({ projectId: 'proj_exec', provider: 'google', modelId: 'm' }, { dbPath }),
    ).rejects.toThrow(/no media-forge tool submits generation_mode "lip-sync"/);
  });
});

// ---------------------------------------------------------------------------
// handleNarrativeExecuteClip
// ---------------------------------------------------------------------------

describe('handleNarrativeExecuteClip', () => {
  it('returns the contract, the spec and a dispatch envelope', async () => {
    seed();
    const result = await handleNarrativeExecuteClip(
      { projectId: 'proj_exec', provider: 'bytedance', modelId: 'seedance-2-0' },
      { dbPath },
    );

    expect(result.clipId).toBe('clip_a');
    expect(result.contract.shot_structure).toBe('compact_single_take');
    expect(result.dispatch.tool).toBe('media_seedance_text_to_video');
    expect(result.dispatch.arguments['prompt']).toBe(result.promptSpec.natural_language_prompt);
    expect(result.dispatch.arguments['durationSec']).toBe(5);
    expect(result.priorAttempts).toBe(0);
  });

  it('writes NOTHING — the plan only advances once a provider has accepted', async () => {
    const state = seed();
    await handleNarrativeExecuteClip(
      { projectId: 'proj_exec', provider: 'bytedance', modelId: 'm' },
      { dbPath },
    );

    // Advancing here would mark a clip generated on the strength of a request
    // that may never be sent, and the next call would skip it — a hole in the
    // sequence that nothing reports.
    const stored = loadProjectState({ dbPath, projectId: 'proj_exec' });
    expect(stored?.state_revision).toBe(state.state_revision);
    expect(stored?.clips[0]!.status).toBe('planned');
  });

  it('refuses an unsaved project and names the tool that creates one', async () => {
    await expect(
      handleNarrativeExecuteClip({ projectId: 'nope', provider: 'google', modelId: 'm' }, { dbPath }),
    ).rejects.toThrow(/media_narrative_plan or media_narrative_assemble/);
  });

  it('refuses an extension whose parent has no take yet, before anything expensive', async () => {
    seed(
      makeState({
        clips: [
          makeClip({ clip_id: 'clip_a', status: 'planned' }),
          makeClip({
            clip_id: 'clip_b',
            sequence_index: 2,
            parent_clip_id: 'clip_a',
            generation_mode: 'extend',
            extension_depth: 1,
          }),
        ],
        scenes: [makeScene({ assigned_clip_ids: ['clip_a', 'clip_b'] })],
      }),
    );

    await expect(
      handleNarrativeExecuteClip(
        { projectId: 'proj_exec', clipId: 'clip_b', provider: 'kling', modelId: 'm' },
        { dbPath },
      ),
    ).rejects.toThrow(/no anchor/);
  });

  it('bumpPromptVersion moves v1 to v2 so the attempt history stays a bisection', async () => {
    seed();
    const result = await handleNarrativeExecuteClip(
      { projectId: 'proj_exec', provider: 'bytedance', modelId: 'm', bumpPromptVersion: true },
      { dbPath },
    );
    expect(result.promptSpec.prompt_version).toBe('v2');
  });

  it('referenceCandidates without maxReferences is refused rather than defaulted', async () => {
    seed();
    await expect(
      handleNarrativeExecuteClip(
        {
          projectId: 'proj_exec',
          provider: 'bytedance',
          modelId: 'm',
          referenceCandidates: [{ assetId: 'a1', description: 'her jacket' }],
        },
        { dbPath },
      ),
      // The cap is the target provider's own limit; over it the request is
      // rejected and near it each reference is weighted less. No safe default.
    ).rejects.toThrow(/without maxReferences/);
  });
});

// ---------------------------------------------------------------------------
// handleNarrativeRecordRun
// ---------------------------------------------------------------------------

describe('handleNarrativeRecordRun', () => {
  const runInput = {
    projectId: 'proj_exec',
    clipId: 'clip_a',
    jobId: 'job-123',
    surface: 'bytedance/seedance-2-0',
    promptVersion: 'v1',
    prompt: 'she pours the coffee',
    inputMode: 't2v',
    referenceTags: ['@ana'],
  };

  it('writes the provenance row AND advances the plan', async () => {
    seed();
    const result = await handleNarrativeRecordRun(runInput, { dbPath, nowIso: 'T' });

    expect(result.stateRevision).toBe(2);

    const run = getGenerationRun({ dbPath, runId: 'job-123' });
    expect(run?.clip_id).toBe('clip_a');
    expect(run?.prompt_version).toBe('v1');
    expect(run?.reference_tags).toEqual(['@ana']);
    expect(run?.result_status).toBe('submitted');

    const stored = loadProjectState({ dbPath, projectId: 'proj_exec' });
    expect(stored?.clips[0]!.status).toBe('generated');
  });

  it('run_id IS the job id, which is what joins narrative provenance to cost', async () => {
    seed();
    await handleNarrativeRecordRun(runInput, { dbPath });
    // No cost column is read or written here; video_jobs and trace.jsonl own the
    // money and are keyed on this same id.
    expect(getGenerationRun({ dbPath, runId: 'job-123' })?.run_id).toBe('job-123');
  });

  it('a synthetic fixture is recorded as not_run_fixture, never as dispatched', async () => {
    seed();
    await handleNarrativeRecordRun({ ...runInput, isSyntheticFixture: true }, { dbPath });
    const run = getGenerationRun({ dbPath, runId: 'job-123' });
    // The check that stops an eval fixture from looking like it reached a real
    // provider — which is the mistake that spends money during a test run.
    expect(run?.result_status).toBe('not_run_fixture');
    expect(run?.is_synthetic_fixture).toBe(true);
  });

  it('records one row per attempt, oldest first — the bisection the table exists for', async () => {
    seed();
    await handleNarrativeRecordRun(runInput, { dbPath, nowIso: '2026-01-01T00:00:00.000Z' });

    // Second attempt on the same clip: send it back for repair first.
    const stored = loadProjectState({ dbPath, projectId: 'proj_exec' })!;
    saveProjectState({
      dbPath,
      state: {
        ...stored,
        clips: [{ ...stored.clips[0]!, status: 'repair' }],
        state_revision: stored.state_revision + 1,
      },
    });

    await handleNarrativeRecordRun(
      { ...runInput, jobId: 'job-456', promptVersion: 'v2' },
      { dbPath, nowIso: '2026-01-02T00:00:00.000Z' },
    );

    const runs = listRunsForClip({ dbPath, projectId: 'proj_exec', clipId: 'clip_a' });
    expect(runs.map((r) => r.prompt_version)).toEqual(['v1', 'v2']);
  });

  it('refuses a clip that is not in the plan', async () => {
    seed();
    await expect(
      handleNarrativeRecordRun({ ...runInput, clipId: 'clip_zzz' }, { dbPath }),
    ).rejects.toThrow(/not in project/);
  });
});

// ---------------------------------------------------------------------------
// handleNarrativeRecordTake
// ---------------------------------------------------------------------------

describe('handleNarrativeRecordTake', () => {
  function review(overrides: Record<string, unknown> = {}) {
    return {
      project_id: 'proj_exec',
      clip_id: 'clip_a',
      take_id: 'take_1',
      source_status: 'generated',
      verdict: 'accept',
      observed_start_state: { light: 'dim' },
      observed_end_state: { light: 'bright' },
      completed_beats: ['beat_1'],
      incomplete_beats: [],
      unexpected_completed_beats: [],
      continuity_breaks: [],
      accepted_deviations: [],
      observation_confidence: 'high',
      uncertainties: [],
      requires_user_confirmation: false,
      ...overrides,
    };
  }

  it('applies the verdict and persists it', async () => {
    seed(makeState({ clips: [makeClip({ status: 'generated' })] }));
    const result = await handleNarrativeRecordTake(
      { projectId: 'proj_exec', review: review() },
      { dbPath },
    );

    expect(result.clipStatus).toBe('accepted');
    expect(result.heldForConfirmation).toBe(false);

    const stored = loadProjectState({ dbPath, projectId: 'proj_exec' });
    expect(stored?.clips[0]!.observed_end_state).toEqual({ light: 'bright' });
    expect(stored?.take_history).toHaveLength(1);
  });

  it('a low-confidence repair is stored but parks the clip, authorising no retake', async () => {
    seed(makeState({ clips: [makeClip({ status: 'generated' })] }));
    const result = await handleNarrativeRecordTake(
      {
        projectId: 'proj_exec',
        review: review({
          verdict: 'repair',
          observation_confidence: 'low',
          requires_user_confirmation: true,
          completed_beats: [],
          incomplete_beats: ['beat_1'],
        }),
      },
      { dbPath },
    );

    expect(result.heldForConfirmation).toBe(true);
    expect(result.clipStatus).toBe('reviewed');

    // And the executor genuinely will not pick it up again.
    await expect(
      handleNarrativeExecuteClip(
        { projectId: 'proj_exec', provider: 'bytedance', modelId: 'm' },
        { dbPath },
      ),
    ).rejects.toThrow(/no clip left to run/);
  });

  it('rejects a review whose verdict contradicts its own observations', async () => {
    seed(makeState({ clips: [makeClip({ status: 'generated' })] }));
    // `accept` with an incomplete beat would be read by the retake protocol as a
    // finished clip, and the missing beat is then generated by nothing at all.
    await expect(
      handleNarrativeRecordTake(
        {
          projectId: 'proj_exec',
          review: review({ incomplete_beats: ['beat_1'], completed_beats: [] }),
        },
        { dbPath },
      ),
    ).rejects.toThrow();
  });
});
