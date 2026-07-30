// src/narrative/project-state-store.ts
// T10 — persistence for the narrative project state, with optimistic concurrency.
//
// Follows the store conventions already in src/core/soul-id-cache.ts: dbPath is
// passed per call rather than captured in a module singleton, so a per-request
// tenant scope cannot leak into a later request. (That leak is exactly the class
// of bug found in the Seedance provider singleton earlier in this refresh.)

import { openDb, runMigrations, withTransaction } from '../core/db.js';
import {
  parseProjectState,
  assertMonotonicRevision,
  type ProjectStateT,
} from './project-state.js';

export interface LoadProjectStateInput {
  readonly dbPath: string;
  readonly projectId: string;
  readonly tenantId?: string | null;
}

export interface SaveProjectStateInput {
  readonly dbPath: string;
  readonly state: ProjectStateT;
  readonly tenantId?: string | null;
  /** Test seam. Defaults to now. */
  readonly nowIso?: string;
}

interface StoredRow {
  readonly document: string;
  readonly state_revision: number;
}

function connect(dbPath: string) {
  const db = openDb(dbPath);
  runMigrations(db);
  return db;
}

/**
 * Returns null when the project has never been saved. Any stored document that
 * fails validation throws rather than returning null: a corrupt state file and
 * an absent one need different responses from the caller, and collapsing them
 * would let a corrupted project silently restart from scratch.
 */
export function loadProjectState(input: LoadProjectStateInput): ProjectStateT | null {
  const { dbPath, projectId, tenantId = null } = input;
  const db = connect(dbPath);

  const row = db
    .prepare(
      `SELECT document, state_revision
         FROM narrative_project_state
        WHERE project_id = ?
          AND (tenant_id IS ? OR tenant_id = ?)`,
    )
    .get(projectId, tenantId, tenantId) as StoredRow | undefined;

  if (row === undefined) return null;

  return parseProjectState(JSON.parse(row.document));
}

/**
 * Writes the state, refusing to clobber a concurrent update.
 *
 * The revision comparison happens inside a transaction, and the UPDATE carries
 * the expected revision in its WHERE clause. Checking in application code alone
 * would leave a window between the read and the write in which another writer
 * commits -- the precise race this is meant to prevent.
 */
export function saveProjectState(input: SaveProjectStateInput): void {
  const { dbPath, state, tenantId = null, nowIso } = input;

  // Validate before touching the database so an invalid document can never be
  // the thing that occupies the row.
  const validated = parseProjectState(state);
  const now = nowIso ?? new Date().toISOString();

  const db = connect(dbPath);

  withTransaction(db, () => {
    const existing = db
      .prepare(
        `SELECT state_revision
           FROM narrative_project_state
          WHERE project_id = ?
            AND (tenant_id IS ? OR tenant_id = ?)`,
      )
      .get(validated.project_id, tenantId, tenantId) as
      | { state_revision: number }
      | undefined;

    if (existing === undefined) {
      db.prepare(
        `INSERT INTO narrative_project_state
           (project_id, state_revision, canon_revision, schema_version,
            project_mode, document, tenant_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        validated.project_id,
        validated.state_revision,
        validated.canon_revision,
        validated.schema_version,
        validated.project_mode,
        JSON.stringify(validated),
        tenantId,
        now,
        now,
      );
      return;
    }

    assertMonotonicRevision({
      storedRevision: existing.state_revision,
      incomingRevision: validated.state_revision,
      projectId: validated.project_id,
    });

    const result = db
      .prepare(
        `UPDATE narrative_project_state
            SET state_revision = ?, canon_revision = ?, schema_version = ?,
                project_mode = ?, document = ?, updated_at = ?
          WHERE project_id = ?
            AND (tenant_id IS ? OR tenant_id = ?)
            AND state_revision = ?`,
      )
      .run(
        validated.state_revision,
        validated.canon_revision,
        validated.schema_version,
        validated.project_mode,
        JSON.stringify(validated),
        now,
        validated.project_id,
        tenantId,
        tenantId,
        existing.state_revision,
      );

    if (result.changes === 0) {
      // Another writer committed between the SELECT and the UPDATE. Reported as
      // a conflict rather than retried here: the caller holds the intent and is
      // the only thing that can reapply it to the newer state.
      throw new Error(
        `project ${validated.project_id}: concurrent write detected while saving ` +
          `state_revision ${validated.state_revision}. Reload and reapply.`,
      );
    }
  });
}

/** Lists saved project ids for a tenant, most recently updated first. */
export function listProjectStates(input: {
  readonly dbPath: string;
  readonly tenantId?: string | null;
}): Array<{ projectId: string; stateRevision: number; updatedAt: string }> {
  const { dbPath, tenantId = null } = input;
  const db = connect(dbPath);

  const rows = db
    .prepare(
      `SELECT project_id, state_revision, updated_at
         FROM narrative_project_state
        WHERE (tenant_id IS ? OR tenant_id = ?)
        ORDER BY updated_at DESC`,
    )
    .all(tenantId, tenantId) as Array<{
    project_id: string;
    state_revision: number;
    updated_at: string;
  }>;

  return rows.map((r) => ({
    projectId: r.project_id,
    stateRevision: r.state_revision,
    updatedAt: r.updated_at,
  }));
}
