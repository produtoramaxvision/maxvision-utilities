import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', '..', 'migrations', 'sqlite');

// Track DB filename per instance since DatabaseSync does not expose .name
const POOL = new Map<string, { db: DatabaseSync; path: string; open: boolean }>();
const MIGRATED = new Set<string>();

export function openDb(path: string): DatabaseSync {
  const existing = POOL.get(path);
  if (existing && existing.open) return existing.db;
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  POOL.set(path, { db, path, open: true });
  return db;
}

export function closeDb(path: string): void {
  const entry = POOL.get(path);
  if (entry && entry.open) {
    MIGRATED.delete(entry.path);
    entry.db.close();
    entry.open = false;
  }
  POOL.delete(path);
}

// Splits a SQL script into individual statements, stripping comments + empties.
// Naive: assumes no semicolons inside string literals (true for our migration files).
function splitStatements(script: string): string[] {
  return script
    .replace(/--[^\n]*\n/g, '\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function runScript(db: DatabaseSync, script: string): void {
  for (const stmt of splitStatements(script)) {
    db.prepare(stmt).run();
  }
}

/**
 * Resolves the filesystem path used to open a DatabaseSync instance. Walks POOL
 * to find the matching entry (since DatabaseSync lacks a public name getter).
 */
function getDbPath(db: DatabaseSync): string {
  for (const entry of POOL.values()) {
    if (entry.db === db) return entry.path;
  }
  throw new Error('runMigrations called on DatabaseSync not managed by openDb()');
}

/**
 * Run callback inside a BEGIN/COMMIT transaction. Rolls back on error.
 * node:sqlite (Node 22.5+) does not expose a db.transaction() wrapper like
 * better-sqlite3 does; we implement one using exec() calls directly.
 */
function withTransaction(db: DatabaseSync, fn: () => void): void {
  db.exec('BEGIN');
  try {
    fn();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function runMigrations(db: DatabaseSync): void {
  // Idempotent per-process: once a given DB filename has been migrated in this
  // process, subsequent calls are a no-op. Avoids re-querying schema_migrations
  // on every cost-tracker operation.
  const dbName = getDbPath(db);
  if (MIGRATED.has(dbName)) return;

  runScript(
    db,
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL
     )`,
  );

  // Scoped strictly to migrations/sqlite/ -- existing migrations/*.sql are Postgres-only
  // (CREATE ROLE, SERIAL, etc.) and would crash the SQLite parser.
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: string }>).map(
      (r) => r.version,
    ),
  );

  const insert = db.prepare(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    withTransaction(db, () => {
      runScript(db, sql);
      insert.run(file, new Date().toISOString());
    });
  }

  MIGRATED.add(dbName);
}
