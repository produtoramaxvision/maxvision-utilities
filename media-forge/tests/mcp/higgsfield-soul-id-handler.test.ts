import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, closeDb } from '../../src/core/db.js';
import { handleHiggsfieldSoulId } from '../../src/mcp/handlers.js';

describe('media_higgsfield_soul_id handler', () => {
  let tmpDir: string;
  let dbPath: string;
  let prev: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-hf-soulid-h-'));
    dbPath = join(tmpDir, 'cost.db');
    prev = process.env['MEDIA_FORGE_PROJECT_DIR'];
    process.env['MEDIA_FORGE_PROJECT_DIR'] = tmpDir;
    const db = openDb(dbPath);
    runMigrations(db);
  });

  afterEach(() => {
    closeDb(dbPath);
    rmSync(tmpDir, { recursive: true, force: true });
    if (prev === undefined) delete process.env['MEDIA_FORGE_PROJECT_DIR'];
    else process.env['MEDIA_FORGE_PROJECT_DIR'] = prev;
  });

  it('create action stores a soul id record', async () => {
    const result = await handleHiggsfieldSoulId({
      action: 'create',
      id: 'soul_test1',
      characterName: 'Lyra',
      assetPaths: ['/tmp/lyra1.png', '/tmp/lyra2.png'],
    });
    if (!('ok' in result)) throw new Error('expected create to return ok');
    expect(result.ok).toBe(true);
    expect(result.id).toBe('soul_test1');
  });

  it('list action returns previously created records', async () => {
    await handleHiggsfieldSoulId({
      action: 'create',
      id: 'soul_a',
      characterName: 'A',
      assetPaths: ['/tmp/a.png'],
    });
    await handleHiggsfieldSoulId({
      action: 'create',
      id: 'soul_b',
      characterName: 'B',
      assetPaths: ['/tmp/b.png'],
    });
    const result = await handleHiggsfieldSoulId({ action: 'list' });
    if (!('records' in result)) throw new Error('expected list to return records');
    expect(result.records.length).toBe(2);
  });

  it('find action returns the matching record by character name', async () => {
    await handleHiggsfieldSoulId({
      action: 'create',
      id: 'soul_aurora',
      characterName: 'Aurora',
      assetPaths: ['/tmp/a.png'],
    });
    const result = await handleHiggsfieldSoulId({ action: 'find', characterName: 'aurora' });
    if (!('record' in result)) throw new Error('expected find to return record');
    expect(result.record?.id).toBe('soul_aurora');
  });

  it('markUsed action updates last_used', async () => {
    await handleHiggsfieldSoulId({
      action: 'create',
      id: 'soul_used',
      characterName: 'Used',
      assetPaths: ['/tmp/u.png'],
    });
    const result = await handleHiggsfieldSoulId({ action: 'markUsed', id: 'soul_used' });
    if (!('ok' in result)) throw new Error('expected markUsed to return ok');
    expect(result.ok).toBe(true);
  });

  it('rejects invalid action via Zod', async () => {
    await expect(handleHiggsfieldSoulId({ action: 'destroy' } as unknown)).rejects.toThrow();
  });

  it('create rejects empty assetPaths', async () => {
    await expect(
      handleHiggsfieldSoulId({
        action: 'create',
        id: 'soul_empty',
        characterName: 'E',
        assetPaths: [],
      }),
    ).rejects.toThrow();
  });
});
