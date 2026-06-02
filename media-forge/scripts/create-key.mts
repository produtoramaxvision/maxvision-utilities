// media-forge/scripts/create-key.mts
// Admin script: gera raw key, hash HMAC-SHA256, insere tenant + key no Postgres.
// Uso: DATABASE_URL=... MEDIA_FORGE_KEY_PEPPER=... pnpm db:create-key \
//        --tier creator --tenant-id <uuid-ou-novo>
// Imprime a raw key UMA VEZ. Nao e recuperavel depois.
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith('--') ? [[a.slice(2), arr[i + 1] ?? '']] : [],
  ),
) as Record<string, string>;

const tier = (['free', 'creator', 'pro'] as const).find((t) => t === args['tier']) ?? 'creator';
const tenantId = args['tenant-id'] ?? randomUUID();
const pepper = process.env['MEDIA_FORGE_KEY_PEPPER'];
if (!pepper || pepper.length < 16) {
  process.stderr.write('MEDIA_FORGE_KEY_PEPPER must be set (>=16 chars)\n');
  process.exit(1);
}
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  process.stderr.write('DATABASE_URL must be set\n');
  process.exit(1);
}

const rawKey = randomBytes(32).toString('hex'); // 64 chars hex -- high-entropy
const keyHash = createHmac('sha256', pepper).update(rawKey).digest('hex');

const pool = new Pool({ connectionString: databaseUrl });
try {
  // Aplica migration se tabelas nao existirem ainda
  const migrationPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '001_tenants_keys.sql');
  await pool.query(readFileSync(migrationPath, 'utf8'));

  await pool.query('BEGIN');
  await pool.query(
    `INSERT INTO tenants (id, tier) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET tier = EXCLUDED.tier`,
    [tenantId, tier],
  );
  await pool.query(
    `INSERT INTO api_keys (key_hash, tenant_id) VALUES ($1, $2)`,
    [keyHash, tenantId],
  );
  await pool.query('COMMIT');
  process.stdout.write(
    `tenant_id=${tenantId}\ntier=${tier}\nraw_key=${rawKey}\n` +
      `\nSAVE THE RAW KEY -- IT WILL NOT BE SHOWN AGAIN.\n`,
  );
} catch (err) {
  await pool.query('ROLLBACK').catch(() => {});
  process.stderr.write(`Error: ${(err as Error).message}\n`);
  process.exit(1);
} finally {
  await pool.end();
}
