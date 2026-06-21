// credit-core/tests/migrate.int.test.ts
// Gated por DATABASE_URL (globalSetup do embedded-postgres provê). Valida que
// runMigrations cria o schema e é idempotente (2ª execução não reaplica).
import { describe, it, expect, beforeAll } from 'vitest';
import { Pool } from 'pg';
import { runMigrations } from '../src/migrate.js';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

d('runMigrations', () => {
  let pool: Pool;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await pool.query('DROP TABLE IF EXISTS ledger_entries');
    await pool.query('DROP TABLE IF EXISTS schema_migrations');
  });

  it('aplica 001 e cria ledger_entries', async () => {
    const applied = await runMigrations(pool);
    expect(applied).toContain('001_ledger.sql');
    const r = await pool.query("SELECT to_regclass('public.ledger_entries') AS t");
    expect(r.rows[0].t).toBe('ledger_entries');
  });

  it('idempotente: 2ª execução não reaplica nada', async () => {
    const applied = await runMigrations(pool);
    expect(applied).toEqual([]);
  });
});
