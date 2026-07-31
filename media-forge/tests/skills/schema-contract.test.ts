// Ports the intent of upstream's scripts/schema_check.py (czlonkowski-style
// absorption from Emily2040/seedance-2.0, MIT, see NOTICE) to Vitest.
//
// Upstream's own docstring explains why this exists: "the other checkers
// re-declare required fields in Python, so a schema and its examples could
// drift apart silently and both would still pass. This runs the schemas as
// schemas." Same problem here -- skills/_shared/schemas/*.schema.json is the
// one part of the T9 absorption that is executable data, not prose, and
// nothing before this file ran a single one of them.
//
// Adaptation notes (upstream convention NOT ported, with reason):
// - Upstream requires a `validation/schema-instances.json` manifest mapping
//   each schema to example instance files on disk, and fails if a schema has
//   no declared instance. media-forge has no such manifest and no `examples/`
//   directory (see the schema-structure test below for `examples/` absence).
//   Porting the manifest convention would mean inventing a file layout we
//   never adopted. Instead this file declares one hand-built valid instance
//   per schema inline, as a typed const next to its schema -- same coverage
//   guarantee (every schema has at least one instance proven to validate),
//   without the extra manifest file upstream's checker exists to reconcile.
// - Upstream also rejects duplicate JSON object keys (a hand-authored schema
//   or fixture silently losing a field to a duplicate key). Not ported: our
//   5 schemas are static, hand-reviewed, single-author artifacts under this
//   package's own git history, not continuously re-ingested from a third
//   party -- the risk that motivated upstream's custom duplicate-key parser
//   (schema drift hidden by JSON.parse's last-key-wins behavior) does not
//   apply to a file set we ourselves wrote once and now guard structurally.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020Import from 'ajv/dist/2020';

// ESM/CJS interop: ajv's dist build can surface as a non-constructor default
// under some bundler/loader combinations. Normalize once.
const Ajv2020 = (Ajv2020Import as unknown as { default?: typeof Ajv2020Import }).default ??
  Ajv2020Import;

const __dir = dirname(fileURLToPath(import.meta.url));
const schemasDir = join(__dir, '..', '..', 'skills', '_shared', 'schemas');

function loadSchema(name: string): object {
  return JSON.parse(readFileSync(join(schemasDir, name), 'utf-8')) as object;
}

const schemaFiles = readdirSync(schemasDir).filter((f) => f.endsWith('.schema.json')).sort();

// ---------------------------------------------------------------------------
// Hand-built instances: one valid, minimal instance per schema, satisfying
// every field in that schema's `required` array (including nested `$defs`
// required arrays for project-state.schema.json). Kept next to the schema's
// own required-field list so drift is visible on read, not just on red CI.
// ---------------------------------------------------------------------------

const VALID_INSTANCES: Record<string, unknown> = {
  'clip-contract.schema.json': {
    project_id: 'proj_001',
    clip_id: 'clip_01',
    parent_clip_id: null,
    scene_id: 'scene_01',
    sequence_index: 1,
    narrative_job: 'establish arrival',
    felt_intent: 'quiet anticipation',
    target_duration_sec: 6,
    generation_mode: 'i2v',
    shot_structure: 'compact_single_take',
    already_happened: [],
    this_clip_only: ['character enters frame'],
    reserved_for_later: ['reunion'],
    planned_start_state: {},
    planned_end_state: {},
    continuity_locks: [],
    allowed_changes: [],
    status: 'planned',
  },
  'generation-run.schema.json': {
    run_id: 'run_001',
    project_id: 'proj_001',
    clip_id: 'clip_01',
    surface: 'seedance-i2v',
    prompt_version: 'v1',
    input_mode: 'i2v',
    reference_tags: ['@Image1'],
    prompt: 'A quiet arrival at dawn.',
    result_status: 'not_run_fixture',
    is_synthetic_fixture: true,
  },
  'prompt-spec.schema.json': {
    project_id: 'proj_001',
    clip_id: 'clip_01',
    prompt_version: 'v1',
    sequence_relation: 'standalone',
    generation_mode: 'i2v',
    reference_roles: [],
    opening_state_source: 'planned_start_state',
    current_clip_action: 'character walks to the door',
    endpoint: 'character stops at the threshold',
    completed_beat_exclusions: [],
    reserved_future_exclusions: ['reunion'],
    natural_language_prompt: 'A quiet arrival at dawn, locked medium shot.',
  },
  'take-review.schema.json': {
    project_id: 'proj_001',
    clip_id: 'clip_01',
    take_id: 'take_01',
    source_status: 'generated',
    verdict: 'accept',
    observed_start_state: {},
    observed_end_state: {},
    completed_beats: [],
    incomplete_beats: [],
    unexpected_completed_beats: [],
    continuity_breaks: [],
    accepted_deviations: [],
    observation_confidence: 'high',
    uncertainties: [],
    requires_user_confirmation: false,
  },
  'project-state.schema.json': {
    schema_version: '1.0',
    state_revision: 1,
    project_id: 'proj_001',
    project_mode: 'standalone_clip',
    surface: {},
    clip_budget_sec: 6,
    prompt_budget: 200,
    story: {
      logline: 'A traveler arrives at dawn.',
      story_promise: 'Someone is waiting.',
      objective: 'reach the platform',
      initial_condition: 'train has just arrived',
      final_outcome: 'traveler finds who they came for',
      target_duration_sec: 30,
      tone: 'quiet',
      medium: 'live-action',
    },
    world_bible: {},
    reference_registry: [{ tag: '@Image1', role: 'protagonist', preserve_exact_tag: true }],
    scenes: [
      {
        scene_id: 'scene_01',
        scene_index: 1,
        narrative_function: 'arrival',
        arc_position: 'open',
        location: 'station platform',
        time_of_day: 'dawn',
        anchor_source: [],
        max_chain_depth: 1,
        audio_plan: 'quiet ambience',
        assigned_clip_ids: ['clip_01'],
        transition_out: 'cut',
        status: 'current',
      },
    ],
    beats: [
      {
        beat_id: 'beat_01',
        description: 'traveler steps onto the platform',
        narrative_function: 'establish',
        status: 'current',
        assigned_clip_id: 'clip_01',
        dependencies: [],
      },
    ],
    clips: [
      {
        clip_id: 'clip_01',
        parent_clip_id: null,
        scene_id: 'scene_01',
        sequence_index: 1,
        prompt_version: 'v1',
        generation_mode: 'i2v',
        status: 'planned',
        narrative_job: 'establish arrival',
        felt_intent: 'quiet anticipation',
        already_happened: [],
        this_clip_only: ['character enters frame'],
        reserved_for_later: ['reunion'],
        planned_start_state: {},
        planned_end_state: {},
        observed_start_state: null,
        observed_end_state: null,
        continuity_locks: [],
        allowed_changes: [],
        continuity_breaks: [],
        accepted_deviations: [],
        transition_in: 'cut',
        transition_out: 'cut',
        open_motion_vectors: [],
        handoff_requirements: [],
        extension_depth: 0,
      },
    ],
    take_history: [],
    current_clip_id: 'clip_01',
    canon_revision: 1,
    updated_at: '2026-07-29T00:00:00Z',
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('shared JSON schemas -- structure and executable instances', () => {
  it('discovers exactly the 5 shipped schemas', () => {
    // Vacuity floor: a glob typo here would make every check below iterate
    // over zero files and pass for the wrong reason.
    expect(schemaFiles).toEqual([
      'clip-contract.schema.json',
      'generation-run.schema.json',
      'project-state.schema.json',
      'prompt-spec.schema.json',
      'take-review.schema.json',
    ]);
  });

  it('every schema file has a hand-built instance declared for it', () => {
    expect(Object.keys(VALID_INSTANCES).sort()).toEqual([...schemaFiles].sort());
  });

  describe.each(schemaFiles)('%s', (name) => {
    const schema = loadSchema(name);

    it('is a valid Draft 2020-12 JSON Schema', () => {
      // validateSchema (not compile): compile conflates "is this schema
      // spec-legal" with Ajv's own opinionated strict-mode lint. A schema
      // that is legal per the 2020-12 spec must not be reported as broken
      // just because Ajv's strict mode dislikes a pattern like `enum`
      // without a sibling `type`.
      const ajv = new Ajv2020({ strictSchema: false });
      const valid = ajv.validateSchema(schema);
      expect(valid, JSON.stringify(ajv.errors)).toBe(true);
    });

    it('accepts its declared valid instance', () => {
      const ajv = new Ajv2020({ strictSchema: false });
      const validate = ajv.compile(schema);
      const instance = VALID_INSTANCES[name];
      const ok = validate(instance);
      expect(ok, JSON.stringify(validate.errors)).toBe(true);
    });
  });
});

describe('shared JSON schemas -- negative cases (proves the validator is not vacuous)', () => {
  it('rejects an instance missing a required field', () => {
    const schema = loadSchema('take-review.schema.json');
    const ajv = new Ajv2020({ strictSchema: false });
    const validate = ajv.compile(schema);
    const instance = { ...(VALID_INSTANCES['take-review.schema.json'] as Record<string, unknown>) };
    delete instance.verdict;
    expect(validate(instance)).toBe(false);
    expect(validate.errors?.some((e) => e.params && 'missingProperty' in e.params && e.params.missingProperty === 'verdict')).toBe(true);
  });

  it('rejects an instance with a required field of the wrong type', () => {
    // Mirrors upstream's own regression case: schema_version declared as a
    // number instead of the required string.
    const schema = loadSchema('project-state.schema.json');
    const ajv = new Ajv2020({ strictSchema: false });
    const validate = ajv.compile(schema);
    const instance = { ...(VALID_INSTANCES['project-state.schema.json'] as Record<string, unknown>) };
    instance.schema_version = 1;
    expect(validate(instance)).toBe(false);
    expect(validate.errors?.some((e) => e.instancePath === '/schema_version')).toBe(true);
  });

  it('rejects an instance violating an enum constraint', () => {
    const schema = loadSchema('clip-contract.schema.json');
    const ajv = new Ajv2020({ strictSchema: false });
    const validate = ajv.compile(schema);
    const instance = { ...(VALID_INSTANCES['clip-contract.schema.json'] as Record<string, unknown>) };
    instance.status = 'not_a_real_status';
    expect(validate(instance)).toBe(false);
  });
});
