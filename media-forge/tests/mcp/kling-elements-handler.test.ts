import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, closeDb } from '../../src/core/db.js';
import { handleKlingElements } from '../../src/mcp/handlers.js';

describe('media_kling_elements handler', () => {
  let tmpDir: string;
  let dbPath: string;
  let prev: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-kling-elem-'));
    dbPath = join(tmpDir, 'cost.db');
    prev = process.env['MEDIA_FORGE_PROJECT_DIR'];
    process.env['MEDIA_FORGE_PROJECT_DIR'] = tmpDir;
    process.env['KLING_ACCESS_KEY'] = 'ak_test';
    process.env['KLING_SECRET_KEY'] = 'sk_test';
    const db = openDb(dbPath);
    runMigrations(db);
  });

  afterEach(() => {
    closeDb(dbPath);
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // EPERM on Windows — ignore
    }
    if (prev === undefined) delete process.env['MEDIA_FORGE_PROJECT_DIR'];
    else process.env['MEDIA_FORGE_PROJECT_DIR'] = prev;
    delete process.env['KLING_ACCESS_KEY'];
    delete process.env['KLING_SECRET_KEY'];
    vi.restoreAllMocks();
  });

  it('accepts up to 4 elementIds and dispatches via KlingProvider', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { task_id: 'kling-elem-1' } }),
    });
    const result = await handleKlingElements(
      {
        prompt: 'all four characters dance in the desert',
        imageUrl: 'https://example/base.png',
        elementIds: ['elem-A', 'elem-B', 'elem-C', 'elem-D'],
        durationSec: 5,
      },
      { fetchImpl: fetchImpl as never },
    );
    expect(result.provider).toBe('kling');
    expect(result.modelId).toBe('kling-v3-pro');
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.element_list).toEqual([
      { element_id: 'elem-A' },
      { element_id: 'elem-B' },
      { element_id: 'elem-C' },
      { element_id: 'elem-D' },
    ]);
  });

  it('rejects when > 4 elementIds (Kling hard limit)', async () => {
    await expect(
      handleKlingElements({
        prompt: 'x',
        imageUrl: 'https://example/base.png',
        elementIds: ['1', '2', '3', '4', '5'],
        durationSec: 5,
      }),
    ).rejects.toThrow(/max 4 elements/i);
  });

  it('rejects when no elementIds provided', async () => {
    await expect(
      handleKlingElements({
        prompt: 'x',
        imageUrl: 'https://example/base.png',
        elementIds: [],
        durationSec: 5,
      }),
    ).rejects.toThrow();
  });
});
