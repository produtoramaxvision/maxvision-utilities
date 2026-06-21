// credit-core/tests/global-setup.ts
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pg: EmbeddedPostgres | undefined;
let dataDir: string | undefined;

export async function setup(): Promise<void> {
  dataDir = mkdtempSync(join(tmpdir(), 'cc-pg-'));
  const port = 54329; // porta dedicada de teste
  pg = new EmbeddedPostgres({
    databaseDir: dataDir, user: 'credit', password: 'credit', port, persistent: false,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('credit_core');
  process.env.DATABASE_URL = `postgres://credit:credit@localhost:${port}/credit_core`;
}

export async function teardown(): Promise<void> {
  await pg?.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
}
