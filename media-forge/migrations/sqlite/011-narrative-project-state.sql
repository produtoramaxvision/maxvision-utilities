-- 011-narrative-project-state.sql
-- T10 — durable storage for the narrative project state between sessions.
--
-- The state is stored as a single JSON document rather than shredded into
-- relational tables. That is a deliberate trade, not laziness:
--
--   * The authoritative shape is the Zod schema in src/narrative/project-state.ts.
--     Shredding it into tables would create a second schema definition that has
--     to be migrated in lockstep with the first, and the two drift the moment a
--     nested field changes.
--   * Reads are whole-document: the planner loads the entire state, mutates it,
--     and writes it back. There is no query pattern that would benefit from
--     joins over scenes or beats.
--   * Integrity across clips/scenes/beats is enforced in
--     validateProjectStateIntegrity(), which needs the whole document in memory
--     anyway. SQL foreign keys could only enforce a subset of those rules.
--
-- What IS relational is the concurrency control. state_revision is a real column
-- rather than a field inside the blob so an optimistic-concurrency UPDATE can be
-- expressed as a WHERE clause and settled by the database, instead of by a
-- read-compare-write in application code that races under exactly the conditions
-- it is meant to protect against.

CREATE TABLE IF NOT EXISTS narrative_project_state (
  project_id      TEXT    PRIMARY KEY,

  -- Mirrored out of the JSON document for the concurrency guard. Kept in sync by
  -- the writer; the CHECK below stops a zero or negative revision from ever
  -- being stored, which would make the monotonic comparison meaningless.
  state_revision  INTEGER NOT NULL CHECK (state_revision >= 1),

  -- Mirrored for the same reason: lets a caller detect a canon change without
  -- parsing the document.
  canon_revision  INTEGER NOT NULL CHECK (canon_revision >= 1),

  schema_version  TEXT    NOT NULL,
  project_mode    TEXT    NOT NULL CHECK (project_mode IN ('standalone_clip', 'sequence_project')),

  -- The full ProjectState document, validated by parseProjectState() on both
  -- write and read. Stored as TEXT because this file targets SQLite, which has
  -- no native JSON column type; the json_valid CHECK is what keeps a truncated
  -- write from being silently readable as garbage later.
  document        TEXT    NOT NULL CHECK (json_valid(document)),

  -- Tenant scoping, matching the convention established by 008-video-jobs-tenant
  -- and 010-image-jobs-tenant. Nullable for single-tenant local installs, which
  -- is how those two migrations model it as well.
  tenant_id       TEXT,

  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL
);

-- Listing a tenant's projects by recency is the one access pattern that is not a
-- primary-key lookup.
CREATE INDEX IF NOT EXISTS idx_narrative_project_state_tenant_updated
  ON narrative_project_state (tenant_id, updated_at DESC);
