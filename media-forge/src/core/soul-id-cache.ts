import { createHash } from 'node:crypto';
import { openDb, runMigrations } from './db.js';
import type { Provider } from './models.js';

export interface SoulIdRecord {
  readonly id: string;
  readonly provider: Provider;
  readonly characterName: string;
  readonly assetPaths: ReadonlyArray<string>;
  readonly trainedAt: string;
  readonly lastUsed: string | null;
  readonly trainingCredits: number | null;
  readonly trainingUsd: number | null;
}

export interface CreateSoulIdInput {
  readonly dbPath: string;
  readonly id: string;
  readonly provider: Provider;
  readonly characterName: string;
  readonly assetPaths: ReadonlyArray<string>;
  readonly trainedAtOverride?: string;
}

export interface ListSoulIdsInput {
  readonly dbPath: string;
  readonly provider?: Provider;
}

export interface MarkUsedInput {
  readonly dbPath: string;
  readonly id: string;
}

export interface FindByNameInput {
  readonly dbPath: string;
  readonly characterName: string;
  readonly provider?: Provider;
}

export interface RecordTrainingCostInput {
  readonly dbPath: string;
  readonly id: string;
  readonly trainingCredits: number;
  readonly usdAtTime: number;
}

function ensureDb(dbPath: string) {
  const db = openDb(dbPath);
  runMigrations(db);
  return db;
}

interface SoulIdRow {
  id: string;
  provider: string;
  character_name: string;
  asset_paths_json: string;
  trained_at: string;
  last_used: string | null;
  training_credits: number | null;
  training_usd: number | null;
  fingerprint: string;
  training_state: string;
}

function rowToRecord(r: SoulIdRow): SoulIdRecord {
  let assetPaths: string[] = [];
  try {
    const parsed = JSON.parse(r.asset_paths_json) as unknown;
    if (Array.isArray(parsed)) assetPaths = parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    // Corrupt JSON: surface empty list rather than crash callers.
    assetPaths = [];
  }
  return {
    id: r.id,
    provider: r.provider as Provider,
    characterName: r.character_name,
    assetPaths,
    trainedAt: r.trained_at,
    lastUsed: r.last_used,
    trainingCredits: r.training_credits,
    trainingUsd: r.training_usd,
  };
}

export interface SoulIdFingerprintInput {
  readonly characterName: string;
  readonly assetPaths: ReadonlyArray<string>;
}

/** Stable sha256 of normalized character name + sorted asset paths.
 *  Same inputs => same fingerprint, regardless of array ordering or case.
 *
 *  FIX (CodeRabbit round 9, PR#10): path normalization now lowercases too,
 *  matching the JSDoc + the lowercased-name treatment. Previously `trim()`
 *  alone left `/Tmp/A.png` and `/tmp/a.png` producing different fingerprints
 *  for the same asset set. */
export function computeSoulIdFingerprint(input: SoulIdFingerprintInput): string {
  const normalizedName = input.characterName.trim().toLowerCase();
  const sortedPaths = [...input.assetPaths].map((p) => p.trim().toLowerCase()).sort();
  const seed = JSON.stringify({ name: normalizedName, paths: sortedPaths });
  return createHash('sha256').update(seed).digest('hex');
}

export function createSoulId(input: CreateSoulIdInput): void {
  const db = ensureDb(input.dbPath);
  const trainedAt = input.trainedAtOverride ?? new Date().toISOString();
  const fingerprint = computeSoulIdFingerprint({
    characterName: input.characterName,
    assetPaths: input.assetPaths,
  });
  db.prepare(
    `INSERT OR IGNORE INTO soul_ids
     (id, provider, character_name, asset_paths_json, trained_at, last_used, training_credits, training_usd, fingerprint)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
  ).run(
    input.id,
    input.provider,
    input.characterName,
    JSON.stringify([...input.assetPaths]),
    trainedAt,
    fingerprint,
  );
}

export function listSoulIds(input: ListSoulIdsInput): SoulIdRecord[] {
  const db = ensureDb(input.dbPath);
  const rows = input.provider
    ? (db.prepare(`SELECT * FROM soul_ids WHERE provider = ? ORDER BY trained_at DESC`).all(
        input.provider,
      ) as unknown as SoulIdRow[])
    : (db.prepare(`SELECT * FROM soul_ids ORDER BY trained_at DESC`).all() as unknown as SoulIdRow[]);
  return rows.map(rowToRecord);
}

export function markUsed(input: MarkUsedInput): void {
  const db = ensureDb(input.dbPath);
  db.prepare(`UPDATE soul_ids SET last_used = ? WHERE id = ?`).run(
    new Date().toISOString(),
    input.id,
  );
}

export function findByCharacterName(input: FindByNameInput): SoulIdRecord | undefined {
  const db = ensureDb(input.dbPath);
  const row = input.provider
    ? (db
        .prepare(
          `SELECT * FROM soul_ids WHERE LOWER(character_name) = LOWER(?) AND provider = ? LIMIT 1`,
        )
        .get(input.characterName, input.provider) as SoulIdRow | undefined)
    : (db
        .prepare(`SELECT * FROM soul_ids WHERE LOWER(character_name) = LOWER(?) LIMIT 1`)
        .get(input.characterName) as SoulIdRow | undefined);
  return row ? rowToRecord(row) : undefined;
}

export function recordTrainingCost(input: RecordTrainingCostInput): void {
  const db = ensureDb(input.dbPath);
  db.prepare(
    `UPDATE soul_ids SET training_credits = ?, training_usd = ? WHERE id = ?`,
  ).run(input.trainingCredits, input.usdAtTime, input.id);
}

// ===========================================================================
// Training-lock pattern (D-1 single-instance idempotency)
// ===========================================================================

export type TrainingLockOutcome =
  | { state: 'CLAIMED'; fingerprint: string }              // we now own training for this fingerprint
  | { state: 'ALREADY_COMMITTED'; record: SoulIdRecord }   // someone else already finished -- reuse
  | { state: 'ALREADY_PENDING'; record: SoulIdRecord };    // someone else is mid-training -- back off

/** Claim a PENDING row before issuing the Higgsfield training API call.
 *  Returns CLAIMED if we won the race, ALREADY_* if another caller got there first. */
export function claimTrainingPending(input: {
  readonly dbPath: string;
  readonly provisionalId: string;       // e.g. `pending-${fingerprint.slice(0,16)}`
  readonly provider: Provider;
  readonly characterName: string;
  readonly assetPaths: ReadonlyArray<string>;
}): TrainingLockOutcome {
  const db = ensureDb(input.dbPath);
  const fp = computeSoulIdFingerprint({
    characterName: input.characterName,
    assetPaths: input.assetPaths,
  });
  const now = new Date().toISOString();

  // Check existing row by fingerprint first (handles renames of same image set).
  // FIX (CodeRabbit round 9, PR#10): scope by provider — fingerprints are
  // not globally unique, and a row from a different provider must not return
  // ALREADY_* for the current claim attempt.
  const existing = db
    .prepare(`SELECT * FROM soul_ids WHERE fingerprint = ? AND provider = ? LIMIT 1`)
    .get(fp, input.provider) as SoulIdRow | undefined;
  if (existing) {
    const record = rowToRecord(existing);
    return existing.training_state === 'COMMITTED'
      ? { state: 'ALREADY_COMMITTED', record }
      : { state: 'ALREADY_PENDING', record };
  }

  // Attempt to insert the PENDING sentinel. The (provider, lower(character_name)) UNIQUE
  // index forces serialization -- second caller will get a constraint violation.
  try {
    db.prepare(
      `INSERT INTO soul_ids
         (id, provider, character_name, asset_paths_json, trained_at,
          last_used, training_credits, training_usd, fingerprint, training_state)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, 'PENDING')`,
    ).run(
      input.provisionalId,
      input.provider,
      input.characterName,
      JSON.stringify([...input.assetPaths]),
      now,
      fp,
    );
    return { state: 'CLAIMED', fingerprint: fp };
  } catch (e) {
    // UNIQUE constraint on (provider, lower(character_name)) -- re-read the winner.
    const winner = db
      .prepare(
        `SELECT * FROM soul_ids WHERE provider = ? AND LOWER(character_name) = LOWER(?) LIMIT 1`,
      )
      .get(input.provider, input.characterName) as SoulIdRow | undefined;
    if (!winner) throw e;  // unexpected -- re-throw the original error
    const record = rowToRecord(winner);
    return winner.training_state === 'COMMITTED'
      ? { state: 'ALREADY_COMMITTED', record }
      : { state: 'ALREADY_PENDING', record };
  }
}

/** Promote a PENDING row to COMMITTED with the real Soul ID returned by the platform.
 *
 *  FIX (CodeRabbit round 9, PR#10): guard on `training_state = 'PENDING'` so
 *  a bad call path can't silently overwrite an already-COMMITTED row's id. */
export function commitTrained(input: {
  readonly dbPath: string;
  readonly provisionalId: string;
  readonly realSoulId: string;
}): void {
  const db = ensureDb(input.dbPath);
  db.prepare(
    `UPDATE soul_ids SET id = ?, training_state = 'COMMITTED'
     WHERE id = ? AND training_state = 'PENDING'`,
  ).run(input.realSoulId, input.provisionalId);
}

/** Roll back a PENDING claim when the training API call failed. */
export function rollbackPending(input: { readonly dbPath: string; readonly provisionalId: string }): void {
  const db = ensureDb(input.dbPath);
  db.prepare(`DELETE FROM soul_ids WHERE id = ? AND training_state = 'PENDING'`).run(
    input.provisionalId,
  );
}
