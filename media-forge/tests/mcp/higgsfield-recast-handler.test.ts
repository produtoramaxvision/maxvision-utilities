import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, closeDb } from '../../src/core/db.js';
import { handleHiggsfieldRecast, _resetHiggsfieldProviderForTests } from '../../src/mcp/handlers.js';

const ORIG_FETCH = global.fetch;

describe('media_higgsfield_recast handler', () => {
  let tmpDir: string;
  let dbPath: string;
  let prev: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-hf-recast-'));
    dbPath = join(tmpDir, 'cost.db');
    prev = process.env['MEDIA_FORGE_PROJECT_DIR'];
    process.env['MEDIA_FORGE_PROJECT_DIR'] = tmpDir;
    process.env['HF_API_KEY'] = 'pk';
    process.env['HF_API_SECRET'] = 'sk';
    process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = '0.039';
    const db = openDb(dbPath);
    runMigrations(db);
    _resetHiggsfieldProviderForTests();
  });

  afterEach(() => {
    closeDb(dbPath);
    rmSync(tmpDir, { recursive: true, force: true });
    if (prev === undefined) delete process.env['MEDIA_FORGE_PROJECT_DIR'];
    else process.env['MEDIA_FORGE_PROJECT_DIR'] = prev;
    global.fetch = ORIG_FETCH;
    delete process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
  });

  it('dispatches Recast with source video + target character', async () => {
    let captured!: RequestInit;
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = init ?? {};
      return new Response(
        JSON.stringify({ request_id: 'r', status_url: 'u', cancel_url: 'c' }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const result = await handleHiggsfieldRecast({
      sourceVideoPath: '/tmp/original.mp4',
      targetCharacterImagePath: '/tmp/newchar.png',
      prompt: 'replace the lead actor',
      durationSec: 10,
      resolution: '720p',
    });

    expect(result.provider).toBe('higgsfield');
    const body = JSON.parse(captured.body as string) as Record<string, unknown>;
    expect(body['target_character_url']).toBe('/tmp/newchar.png');
  });

  it('rejects when target character path is empty', async () => {
    await expect(
      handleHiggsfieldRecast({
        sourceVideoPath: '/tmp/x.mp4',
        targetCharacterImagePath: '',
        prompt: 'x',
        durationSec: 5,
        resolution: '720p',
      }),
    ).rejects.toThrow();
  });
});
