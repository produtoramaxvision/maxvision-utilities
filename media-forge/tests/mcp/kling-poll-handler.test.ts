import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, closeDb } from '../../src/core/db.js';
import { recordJob } from '../../src/core/cost-tracker.js';
import { recordRequestMapping } from '../../src/core/provider-request-map.js';
import { handleKlingPoll } from '../../src/mcp/handlers.js';

/**
 * Codex P2 round 13 PR#11 regression: when callbacks are suppressed (default,
 * because of HMAC mismatch) and `media_kling_poll` is the only completion path,
 * a Kling task that polls as `failed` must be persisted to video_jobs.status
 * so the row doesn't dangle in 'pending' forever — symmetric with the failed
 * path in kling-webhook-handler.ts.
 */
describe('handleKlingPoll — persists failed state to video_jobs', () => {
  let tmpDir: string;
  let dbPath: string;
  let prev: Record<string, string | undefined>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-kling-poll-'));
    dbPath = join(tmpDir, 'cost.db');
    prev = {
      MEDIA_FORGE_PROJECT_DIR: process.env['MEDIA_FORGE_PROJECT_DIR'],
      KLING_ACCESS_KEY: process.env['KLING_ACCESS_KEY'],
      KLING_SECRET_KEY: process.env['KLING_SECRET_KEY'],
    };
    process.env['MEDIA_FORGE_PROJECT_DIR'] = tmpDir;
    process.env['KLING_ACCESS_KEY'] = 'ak_test';
    process.env['KLING_SECRET_KEY'] = 'sk_test';
    const db = openDb(dbPath);
    runMigrations(db);
  });

  afterEach(() => {
    try {
      closeDb(dbPath);
    } catch {
      /* ignore */
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* Windows EPERM straggler */
    }
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('updates video_jobs.status to failed when pollStatus reports failed', async () => {
    recordJob({
      dbPath,
      jobId: 'internal-fail-1',
      provider: 'kling',
      model: 'kling-v3-standard',
      mode: 't2v',
      paramsHash: 'h-fail',
      estUsd: 0.42,
      nativeTaskId: 'kling-native-fail',
    });
    recordRequestMapping({
      dbPath,
      jobId: 'internal-fail-1',
      provider: 'kling',
      providerRequestId: 'kling-native-fail',
    });

    const fetchImpl = async (..._args: Parameters<typeof fetch>): Promise<Response> => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          data: {
            task_id: 'kling-native-fail',
            task_status: 'failed',
            task_status_msg: 'upstream rejected',
          },
        }),
      } as unknown as Response;
    };

    const result = await handleKlingPoll(
      { jobId: 'internal-fail-1' },
      { fetchImpl: fetchImpl as never },
    );
    expect(result.state).toBe('failed');

    const db = openDb(dbPath);
    const row = db
      .prepare("SELECT status, completed_at FROM video_jobs WHERE id = ?")
      .get('internal-fail-1') as { status: string; completed_at: string | null };
    expect(row.status).toBe('failed');
    expect(row.completed_at).not.toBeNull();
    closeDb(dbPath);
  });

  it('does NOT touch the row when pollStatus reports a non-terminal state', async () => {
    recordJob({
      dbPath,
      jobId: 'internal-pending-1',
      provider: 'kling',
      model: 'kling-v3-standard',
      mode: 't2v',
      paramsHash: 'h-pending',
      estUsd: 0.42,
      nativeTaskId: 'kling-native-pending',
    });
    recordRequestMapping({
      dbPath,
      jobId: 'internal-pending-1',
      provider: 'kling',
      providerRequestId: 'kling-native-pending',
    });

    const fetchImpl = async (..._args: Parameters<typeof fetch>): Promise<Response> => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          data: { task_id: 'kling-native-pending', task_status: 'processing' },
        }),
      } as unknown as Response;
    };

    await handleKlingPoll(
      { jobId: 'internal-pending-1' },
      { fetchImpl: fetchImpl as never },
    );
    const db = openDb(dbPath);
    const row = db
      .prepare("SELECT status FROM video_jobs WHERE id = ?")
      .get('internal-pending-1') as { status: string };
    expect(row.status).toBe('pending');
    closeDb(dbPath);
  });
});
