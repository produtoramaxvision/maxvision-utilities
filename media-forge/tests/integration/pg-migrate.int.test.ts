// tests/integration/pg-migrate.int.test.ts
// Testa o runner de migrations Postgres em schema isolado (embedded-postgres via globalSetup).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { runPgMigrations } from '../../src/core/pg-migrate.js';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

// Schema isolado por arquivo — evita conflito de DDL paralelo com outros testes.
// Prefixo "pg_" é reservado pelo Postgres; usar prefixo alternativo.
const SCHEMA = 'mf_pg_migrate_it';

d('runPgMigrations', () => {
  let pool: Pool;

  beforeAll(async () => {
    // Cria schema fresco; pool usa search_path para isolamento.
    const admin = new Pool({ connectionString: url });
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`);
    await admin.end();
    pool = new Pool({ connectionString: url, options: `-c search_path=${SCHEMA}` });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('(a) aplica as 5 migrations underscore em schema fresco e cria as tabelas', async () => {
    const applied = await runPgMigrations(pool);

    // Deve retornar exatamente os 5 arquivos NNN_*.sql
    expect(applied).toHaveLength(5);
    expect(applied).toEqual([
      '001_tenants_keys.sql',
      '002_generations.sql',
      '003_payments.sql',
      '004_tier_changes.sql',
      '005_subscriptions.sql',
    ]);

    // Tabelas centrais devem existir no schema
    const { rows: tenants } = await pool.query(`SELECT to_regclass('tenants') AS oid`);
    expect(tenants[0].oid).not.toBeNull();

    const { rows: tierChanges } = await pool.query(`SELECT to_regclass('tier_changes') AS oid`);
    expect(tierChanges[0].oid).not.toBeNull();

    const { rows: subscriptions } = await pool.query(
      `SELECT to_regclass('subscriptions') AS oid`,
    );
    expect(subscriptions[0].oid).not.toBeNull();
  });

  it('(b) segunda execução retorna [] (no-op — já rastreado)', async () => {
    const applied = await runPgMigrations(pool);
    expect(applied).toEqual([]);
  });

  it('(c) nunca aplica arquivos dash-named', async () => {
    // O tracking table só deve conter os underscore files
    const { rows } = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
    const versions = rows.map((r: { version: string }) => r.version);

    // Não deve conter nenhum dash file
    expect(versions).not.toContain('000-role.sql');
    expect(versions).not.toContain('001-refs-index.sql');
    expect(versions).not.toContain('002-refs-index-marengo.sql');

    // E deve conter só os underscore
    expect(versions).toEqual([
      '001_tenants_keys.sql',
      '002_generations.sql',
      '003_payments.sql',
      '004_tier_changes.sql',
      '005_subscriptions.sql',
    ]);
  });
});
