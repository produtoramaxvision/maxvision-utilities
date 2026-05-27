import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, closeDb } from '../../src/core/db.js';

describe('db helper', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-db-test-'));
    dbPath = join(tmpDir, 'cost.db');
  });

  afterEach(() => {
    closeDb(dbPath);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the database file and applies migrations', () => {
    const db = openDb(dbPath);
    runMigrations(db);
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain('video_jobs');
    expect(names).toContain('schema_migrations');
  });

  it('is idempotent — runMigrations twice is safe', () => {
    const db = openDb(dbPath);
    runMigrations(db);
    runMigrations(db);
    const applied = db
      .prepare(`SELECT version FROM schema_migrations ORDER BY version`)
      .all() as Array<{ version: string }>;
    expect(applied.length).toBeGreaterThan(0);
  });
});
