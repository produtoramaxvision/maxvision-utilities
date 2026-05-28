import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, closeDb } from '../../src/core/db.js';
import { handleKlingElementDelete } from '../../src/mcp/handlers.js';

describe('media_kling_element_delete handler', () => {
  let tmpDir: string;
  let dbPath: string;
  let prev: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-kling-el-del-'));
    dbPath = join(tmpDir, 'cost.db');
    prev = process.env['MEDIA_FORGE_PROJECT_DIR'];
    process.env['MEDIA_FORGE_PROJECT_DIR'] = tmpDir;
    process.env['KLING_ACCESS_KEY'] = 'ak_test';
    process.env['KLING_SECRET_KEY'] = 'sk_test';
    const db = openDb(dbPath);
    runMigrations(db);
    // Seed one element for delete tests
    db.prepare(
      `INSERT INTO kling_elements (element_id, display_name, category, created_at) VALUES (?, ?, ?, datetime('now'))`,
    ).run('el-todelete', 'To Delete', 'character');
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

  it('(a) rejects when confirm is omitted or false', async () => {
    // confirm omitted
    await expect(
      handleKlingElementDelete({ elementId: 'el-todelete' }),
    ).rejects.toThrow();
    // confirm:false
    await expect(
      handleKlingElementDelete({ elementId: 'el-todelete', confirm: false }),
    ).rejects.toThrow();
  });

  it('(b) deletes locally and remotely by default (alsoDeleteRemote defaults true)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0 }),
    });
    const result = await handleKlingElementDelete(
      { elementId: 'el-todelete', confirm: true },
      { fetchImpl: fetchImpl as never },
    );
    expect(result.elementId).toBe('el-todelete');
    expect(result.localDeleted).toBe(true);
    expect(result.remoteDeleted).toBe(true);
    // Verify DELETE called on remote
    const [url, init] = fetchImpl.mock.calls[0] as [string, { method: string }];
    expect(url).toBe('https://api-singapore.klingai.com/v1/elements/el-todelete');
    expect(init.method).toBe('DELETE');
    // Verify local soft-delete (deleted_at set)
    const db = openDb(dbPath);
    const row = db.prepare('SELECT deleted_at FROM kling_elements WHERE element_id = ?').get('el-todelete') as { deleted_at: string | null };
    expect(row.deleted_at).not.toBeNull();
  });

  it('(c) alsoDeleteRemote:false skips remote call', async () => {
    const fetchImpl = vi.fn();
    const result = await handleKlingElementDelete(
      { elementId: 'el-todelete', confirm: true, alsoDeleteRemote: false },
      { fetchImpl: fetchImpl as never },
    );
    expect(result.remoteDeleted).toBe(false);
    expect(result.localDeleted).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('(d) backend 404 surfaces error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ message: 'element not found' }),
    });
    await expect(
      handleKlingElementDelete(
        { elementId: 'el-nonexistent', confirm: true },
        { fetchImpl: fetchImpl as never },
      ),
    ).rejects.toThrow(/404/);
  });
});
