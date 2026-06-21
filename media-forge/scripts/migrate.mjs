// media-forge/scripts/migrate.mjs
// Aplica migrations Postgres sem subir o servidor (ops/CI). Requer build (dist/core/pg-migrate.js).
import { Pool } from 'pg';
import { runPgMigrations } from '../dist/core/pg-migrate.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({ connectionString });
try {
  const applied = await runPgMigrations(pool);
  console.log(applied.length ? `applied: ${applied.join(', ')}` : 'no pending migrations');
} finally {
  await pool.end();
}
