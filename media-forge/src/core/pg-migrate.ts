// media-forge/src/core/pg-migrate.ts
// Runner de migrations Postgres com tracking de versão (schema_migrations). Idempotente:
// cada arquivo .sql roda uma única vez, dentro de uma transação. Aplica APENAS
// migrations com nome no padrão NNN_*.sql (underscore) — os arquivos dash-named
// usam variáveis psql e NÃO são compatíveis com node-pg.
import type { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Diretório de migrations relativo a este módulo (vale para src/ e dist/). */
function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'migrations');
}

/**
 * Aplica as migrations pendentes (padrão NNN_*.sql) em ordem lexical.
 * Retorna as que foram aplicadas agora.
 * Migrations dash-named (NNN-*.sql) e o subdir sqlite/ são ignorados.
 */
export async function runPgMigrations(pool: Pool): Promise<string[]> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version    TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );
  const dir = migrationsDir();
  const files = readdirSync(dir)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .sort();
  const applied: string[] = [];
  for (const file of files) {
    const { rowCount } = await pool.query('SELECT 1 FROM schema_migrations WHERE version=$1', [
      file,
    ]);
    if (rowCount) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations(version) VALUES($1)', [file]);
      await c.query('COMMIT');
      applied.push(file);
    } catch (err) {
      await c.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      c.release();
    }
  }
  return applied;
}
