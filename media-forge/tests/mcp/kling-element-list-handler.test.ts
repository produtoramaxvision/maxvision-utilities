import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, closeDb } from '../../src/core/db.js';
import { handleKlingElementList } from '../../src/mcp/handlers.js';

describe('media_kling_element_list handler', () => {
  let tmpDir: string;
  let dbPath: string;
  let prev: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-kling-el-list-'));
    dbPath = join(tmpDir, 'cost.db');
    prev = process.env['MEDIA_FORGE_PROJECT_DIR'];
    process.env['MEDIA_FORGE_PROJECT_DIR'] = tmpDir;
    process.env['KLING_ACCESS_KEY'] = 'ak_test';
    process.env['KLING_SECRET_KEY'] = 'sk_test';
    const db = openDb(dbPath);
    runMigrations(db);
    // Seed two rows: one character, one product
    db.prepare(
      `INSERT INTO kling_elements (element_id, display_name, category, created_at) VALUES (?, ?, ?, datetime('now'))`,
    ).run('el-char-1', 'Hero', 'character');
    db.prepare(
      `INSERT INTO kling_elements (element_id, display_name, category, created_at) VALUES (?, ?, ?, datetime('now'))`,
    ).run('el-prod-1', 'Widget', 'product');
    // Soft-deleted row
    db.prepare(
      `INSERT INTO kling_elements (element_id, display_name, category, created_at, deleted_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
    ).run('el-del-1', 'Deleted', 'character');
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

  it('(a) cache-only returns local rows (excludes deleted)', async () => {
    const result = await handleKlingElementList({});
    expect(result.source).toBe('cache');
    expect(result.elements).toHaveLength(2);
    const ids = result.elements.map((e) => e.elementId);
    expect(ids).toContain('el-char-1');
    expect(ids).toContain('el-prod-1');
    expect(ids).not.toContain('el-del-1');
  });

  it('(b) syncWithBackend merges fresh remote elements', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        data: {
          elements: [
            { element_id: 'el-char-1', name: 'Hero Updated', category: 'character', created_at: '2026-01-01T00:00:00Z' },
            { element_id: 'el-remote-new', name: 'New From Remote', category: 'location', created_at: '2026-01-02T00:00:00Z' },
          ],
        },
      }),
    });
    const result = await handleKlingElementList({ syncWithBackend: true }, { fetchImpl: fetchImpl as never });
    expect(result.source).toBe('cache+backend');
    expect(result.elements).toHaveLength(2);
    const ids = result.elements.map((e) => e.elementId);
    expect(ids).toContain('el-char-1');
    expect(ids).toContain('el-remote-new');
    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe('https://api-singapore.klingai.com/v1/elements');
  });

  it('(c) category filter returns only matching rows', async () => {
    const result = await handleKlingElementList({ category: 'character' });
    expect(result.source).toBe('cache');
    expect(result.elements).toHaveLength(1);
    expect(result.elements[0]!.elementId).toBe('el-char-1');
    expect(result.elements[0]!.category).toBe('character');
  });

  it('(d) includeDeleted:true returns deleted rows too', async () => {
    const result = await handleKlingElementList({ includeDeleted: true });
    expect(result.source).toBe('cache');
    // Should include both active and deleted rows
    const ids = result.elements.map((e) => e.elementId);
    expect(ids).toContain('el-del-1');
    expect(result.elements.length).toBeGreaterThanOrEqual(3);
  });
});
