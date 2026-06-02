// credit-core/scripts/migrate.mjs
// Aplica migrations sem subir o servidor (ops/CI). Requer build (dist/migrate.js).
import { Pool } from 'pg';
import { runMigrations } from '../dist/migrate.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({ connectionString });
try {
  const applied = await runMigrations(pool);
  console.log(applied.length ? `applied: ${applied.join(', ')}` : 'no pending migrations');
} finally {
  await pool.end();
}
