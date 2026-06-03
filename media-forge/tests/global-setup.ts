// media-forge/tests/global-setup.ts
// embedded-postgres globalSetup for gallery integration tests (F-I).
// Port 54330 — does not conflict with credit-core (54329).
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pg: EmbeddedPostgres | undefined;
let dataDir: string | undefined;

export async function setup(): Promise<void> {
  dataDir = mkdtempSync(join(tmpdir(), 'mf-pg-'));
  const port = 54330; // porta dedicada de teste (nao conflita com credit-core 54329)
  pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'mediaforge',
    password: 'mediaforge',
    port,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('media_forge_test');
  const url = `postgres://mediaforge:mediaforge@localhost:${port}/media_forge_test`;
  process.env.GALLERY_DATABASE_URL = url;
  // F-E: billing integration tests (payments-store, reconcile) read DATABASE_URL.
  // Same embedded-postgres instance/db — billing migrations apply alongside gallery.
  process.env.DATABASE_URL = url;
}

export async function teardown(): Promise<void> {
  await pg?.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
}
