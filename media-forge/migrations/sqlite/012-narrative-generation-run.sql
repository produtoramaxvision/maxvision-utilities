-- 012-narrative-generation-run.sql
-- The narrative provenance record: which prompt produced which take.
--
-- GenerationRun (src/narrative/generation-run.ts) shipped as a schema with no
-- store and no writer. Its entire stated purpose is answering "which prompt
-- produced this take" — and a record that lives only in memory answers that until
-- the process exits, which makes the module decorative rather than useful.
--
-- ## This table holds NO money, and that is the point
--
-- generation-run.ts is explicit: the run record must never carry cost. The split
-- is by ownership, not by preference —
--
--   trace.jsonl + video_jobs   own timing and MONEY (costUsd, est_usd, actual_usd)
--   this table                 owns NARRATIVE identity (project, clip, prompt
--                              version, references, how it ended)
--
-- Two writers for the same amount diverge the first time a retry settles at a
-- different actual cost, and nothing then decides which one the daily cap should
-- believe. `assertNoCostFields()` turns that from a convention into a test
-- failure, and this table deliberately mirrors the schema's columns and nothing
-- more. The join back to money is run_id, which IS the job id both the trace and
-- the ledger are keyed on: one number, one owner, joinable from either side.
--
-- run_id is therefore the primary key rather than a surrogate. A second row for
-- the same job would be a second narrative account of one generation.

CREATE TABLE IF NOT EXISTS narrative_generation_run (
  -- The job id. Same identifier as video_jobs.id and the trace entries, so this
  -- table joins to the cost record without either side storing the other's data.
  run_id            TEXT    PRIMARY KEY,

  project_id        TEXT    NOT NULL,
  clip_id           TEXT    NOT NULL,

  -- Provider/model surface this run was dispatched to.
  surface           TEXT    NOT NULL,

  -- Ties the run to the exact PromptSpec that produced it. Together with clip_id
  -- this is what makes a clip's attempt history a bisection: one row per version,
  -- each recording a single changed variable.
  prompt_version    TEXT    NOT NULL,

  input_mode        TEXT    NOT NULL,

  -- JSON array of reference tags. Stored as a document for the same reason the
  -- project state is: the authoritative shape is the Zod schema, and a join table
  -- here would be a second definition to keep in lockstep.
  reference_tags    TEXT    NOT NULL CHECK (json_valid(reference_tags)),

  -- The resolved prompt string actually sent. Kept verbatim: reconstructing it
  -- from the spec later would depend on the composer never changing, and the
  -- whole value of this row is being able to see what was really sent.
  prompt            TEXT    NOT NULL,

  result_status     TEXT    NOT NULL CHECK (
    result_status IN ('not_run_fixture', 'submitted', 'generated', 'reviewed', 'accepted', 'rejected')
  ),

  -- 1 for records produced by the eval suite. Enforced against result_status by
  -- the CHECK below rather than left to the writer: a row flagged synthetic while
  -- reporting a dispatched status means an eval fixture reached a real provider,
  -- which is precisely the mistake that spends money during a test run.
  is_synthetic_fixture INTEGER NOT NULL CHECK (is_synthetic_fixture IN (0, 1)),

  -- Tenant scoping, matching 008/010/011. Nullable for single-tenant installs.
  tenant_id         TEXT,

  created_at        TEXT    NOT NULL,

  -- TABLE-level constraint, so it must sit after every column definition —
  -- placing it between columns is a SQLite parse error, and the migration runner
  -- executes this file on every openDb(), so a syntax error here takes down every
  -- table in the database, not just this one.
  CHECK (
    (is_synthetic_fixture = 1 AND result_status = 'not_run_fixture')
    OR
    (is_synthetic_fixture = 0 AND result_status <> 'not_run_fixture')
  )
);

-- Reading a clip's attempt history in order is the access pattern this table
-- exists for; everything else is a primary-key lookup by run_id.
CREATE INDEX IF NOT EXISTS idx_narrative_generation_run_clip
  ON narrative_generation_run (project_id, clip_id, created_at);
