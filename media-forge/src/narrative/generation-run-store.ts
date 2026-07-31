// src/narrative/generation-run-store.ts
// Persistence for the narrative provenance record. Migration 012.
//
// GenerationRun shipped as a schema with no store and no writer, which meant the
// question it exists to answer — "which prompt produced this take" — could only
// be answered until the process exited.
//
// Follows the same conventions as project-state-store.ts: dbPath per call rather
// than a module singleton, so a per-request tenant scope cannot leak into a later
// request.
//
// ## No money here, deliberately
//
// This store never reads or writes a cost column, and `recordGenerationRun`
// asserts that on every call. The reasoning is generation-run.ts's, not a rule
// invented here: two independent writers for the price of one generation diverge
// the first time a retry settles at a different actual cost, and the daily cap
// then has no principled way to choose between them. Money is owned by
// video_jobs and trace.jsonl; this table joins to them on run_id.

import { openDb, runMigrations } from '../core/db.js';
import {
  parseGenerationRun,
  assertNoCostFields,
  type GenerationRunT,
} from './generation-run.js';

export interface RecordGenerationRunInput {
  readonly dbPath: string;
  readonly run: GenerationRunT;
  readonly tenantId?: string | null;
  /** Test seam. Defaults to now. */
  readonly nowIso?: string;
}

function connect(dbPath: string) {
  const db = openDb(dbPath);
  runMigrations(db);
  return db;
}

/**
 * Writes one run record.
 *
 * Validated through `parseGenerationRun`, which enforces the fixture/billing
 * consistency rules — a record flagged synthetic while reporting a dispatched
 * status means an eval fixture reached a real provider, and that is the mistake
 * that spends money during a test run.
 *
 * `INSERT OR REPLACE` rather than plain INSERT: the run is written at submit and
 * updated as the take is reviewed and judged, and run_id is the identity
 * throughout. A second row for the same job would be a second narrative account
 * of one generation.
 */
export function recordGenerationRun(input: RecordGenerationRunInput): void {
  // Cheap, and it fires at the exact moment someone would have added a cost
  // field: when wiring the writer that would populate it.
  assertNoCostFields();

  const { dbPath, tenantId = null, nowIso } = input;
  const run = parseGenerationRun(input.run);
  const now = nowIso ?? new Date().toISOString();

  const db = connect(dbPath);
  db.prepare(
    `INSERT OR REPLACE INTO narrative_generation_run
       (run_id, project_id, clip_id, surface, prompt_version, input_mode,
        reference_tags, prompt, result_status, is_synthetic_fixture,
        tenant_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    run.run_id,
    run.project_id,
    run.clip_id,
    run.surface,
    run.prompt_version,
    run.input_mode,
    JSON.stringify(run.reference_tags),
    run.prompt,
    run.result_status,
    run.is_synthetic_fixture ? 1 : 0,
    tenantId,
    now,
  );
}

interface RunRow {
  readonly run_id: string;
  readonly project_id: string;
  readonly clip_id: string;
  readonly surface: string;
  readonly prompt_version: string;
  readonly input_mode: string;
  readonly reference_tags: string;
  readonly prompt: string;
  readonly result_status: string;
  readonly is_synthetic_fixture: number;
}

function mapRow(row: RunRow): GenerationRunT {
  // Back through the parser rather than cast: a row written by an older build,
  // or edited by hand, reaches the caller as a validated record or not at all.
  return parseGenerationRun({
    run_id: row.run_id,
    project_id: row.project_id,
    clip_id: row.clip_id,
    surface: row.surface,
    prompt_version: row.prompt_version,
    input_mode: row.input_mode,
    reference_tags: JSON.parse(row.reference_tags) as string[],
    prompt: row.prompt,
    result_status: row.result_status,
    is_synthetic_fixture: row.is_synthetic_fixture === 1,
  });
}

/** One run by its job id, or null. */
export function getGenerationRun(input: {
  readonly dbPath: string;
  readonly runId: string;
  readonly tenantId?: string | null;
}): GenerationRunT | null {
  const { dbPath, runId, tenantId = null } = input;
  const row = connect(dbPath)
    .prepare(
      `SELECT run_id, project_id, clip_id, surface, prompt_version, input_mode,
              reference_tags, prompt, result_status, is_synthetic_fixture
         FROM narrative_generation_run
        WHERE run_id = ?
          AND (tenant_id IS ? OR tenant_id = ?)`,
    )
    .get(runId, tenantId, tenantId) as RunRow | undefined;

  return row === undefined ? null : mapRow(row);
}

/**
 * A clip's attempt history, oldest first.
 *
 * This ordering is the point of the table. Read across it and you get the
 * sequence of prompt versions tried for one clip, which — paired with the ONE
 * changed variable each take review records — turns a list of failures into a
 * bisection instead of a pile.
 */
export function listRunsForClip(input: {
  readonly dbPath: string;
  readonly projectId: string;
  readonly clipId: string;
  readonly tenantId?: string | null;
}): GenerationRunT[] {
  const { dbPath, projectId, clipId, tenantId = null } = input;
  const rows = connect(dbPath)
    .prepare(
      `SELECT run_id, project_id, clip_id, surface, prompt_version, input_mode,
              reference_tags, prompt, result_status, is_synthetic_fixture
         FROM narrative_generation_run
        WHERE project_id = ? AND clip_id = ?
          AND (tenant_id IS ? OR tenant_id = ?)
        ORDER BY created_at ASC`,
    )
    .all(projectId, clipId, tenantId, tenantId) as unknown as RunRow[];

  return rows.map(mapRow);
}
