import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, closeDb } from '../../src/core/db.js';
import { handleKlingElementCreate } from '../../src/mcp/handlers.js';

describe('media_kling_element_create handler', () => {
  let tmpDir: string;
  let dbPath: string;
  let prev: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-kling-el-create-'));
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

  it('(a) success with imageUrl — sync fast-path returns elementId and posts to documented endpoint (Codex P2 round 14, PR#11)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { element_id: 'el-001' } }),
    });
    const result = await handleKlingElementCreate(
      {
        imageUrl: 'https://example.com/char.png',
        displayName: 'Hero Character',
        category: 'character',
      },
      { fetchImpl: fetchImpl as never },
    );
    expect(result.elementId).toBe('el-001');
    expect(result.displayName).toBe('Hero Character');
    expect(result.category).toBe('character');
    expect(typeof result.createdAt).toBe('string');
    // Documented endpoint per kling.ai docs.
    const [url, init] = fetchImpl.mock.calls[0] as [string, { body: string }];
    expect(url).toBe('https://api-singapore.klingai.com/v1/general/advanced-custom-elements/');
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body['element_name']).toBe('Hero Character');
    expect(body['element_description']).toBe('Hero Character');
    expect(body['reference_type']).toBe('image_refer');
    const list = body['element_image_list'] as Record<string, unknown>;
    expect(list['frontal_image']).toBe('https://example.com/char.png');
    expect(list['refer_images']).toEqual([]);
    expect(body['tag_list']).toEqual([{ tag_id: 'o_102' }]);
  });

  it('(b) success with imageBase64 — sync fast-path returns elementId', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { element_id: 'el-002' } }),
    });
    const result = await handleKlingElementCreate(
      {
        imageBase64: 'base64data==',
        displayName: 'Product Shot',
        category: 'product',
      },
      { fetchImpl: fetchImpl as never },
    );
    expect(result.elementId).toBe('el-002');
    expect(result.displayName).toBe('Product Shot');
    const [, init] = fetchImpl.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as Record<string, unknown>;
    const list = body['element_image_list'] as Record<string, unknown>;
    expect(list['frontal_image']).toBe('base64data==');
    expect(body['tag_list']).toEqual([{ tag_id: 'o_104' }]);
  });

  it('(c) rejects when both imageUrl and imageBase64 provided', async () => {
    await expect(
      handleKlingElementCreate({
        imageUrl: 'https://example.com/a.png',
        imageBase64: 'base64==',
        displayName: 'Conflict',
      }),
    ).rejects.toThrow(/exactly one of imageUrl or imageBase64/i);
  });

  it('(d) rejects when neither imageUrl nor imageBase64 provided', async () => {
    await expect(
      handleKlingElementCreate({
        displayName: 'Missing image',
      }),
    ).rejects.toThrow(/exactly one of imageUrl or imageBase64/i);
  });

  it('(e) writes row to kling_elements table after successful create', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { element_id: 'el-003' } }),
    });
    await handleKlingElementCreate(
      {
        imageUrl: 'https://example.com/loc.png',
        displayName: 'Mountain Pass',
        category: 'location',
      },
      { fetchImpl: fetchImpl as never },
    );
    const db = openDb(dbPath);
    const rows = db.prepare('SELECT element_id, display_name, category, source_url FROM kling_elements').all() as Array<{
      element_id: string;
      display_name: string;
      category: string;
      source_url: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.element_id).toBe('el-003');
    expect(rows[0]!.display_name).toBe('Mountain Pass');
    expect(rows[0]!.category).toBe('location');
    expect(rows[0]!.source_url).toBe('https://example.com/loc.png');
  });
});
