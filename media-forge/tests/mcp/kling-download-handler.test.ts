import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, closeDb } from '../../src/core/db.js';
import { recordJob, queryReport } from '../../src/core/cost-tracker.js';
import { handleKlingDownload } from '../../src/mcp/handlers.js';

/**
 * Codex P1 round 7 PR#11 regression: handleKlingDownload must flip the
 * video_jobs row from 'pending' → terminal after a successful asset
 * download. Without this, manually downloaded jobs leave the cost ledger
 * forever-pending (symmetric to the round 6 webhook-handler bug).
 */
describe('handleKlingDownload — records actual cost on successful download', () => {
  let tmpDir: string;
  let dbPath: string;
  let outputsDir: string;
  let prev: Record<string, string | undefined>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-kling-dl-'));
    dbPath = join(tmpDir, 'cost.db');
    outputsDir = join(tmpDir, 'outputs');
    prev = {
      MEDIA_FORGE_PROJECT_DIR: process.env['MEDIA_FORGE_PROJECT_DIR'],
      MEDIA_FORGE_OUTPUTS_DIR: process.env['MEDIA_FORGE_OUTPUTS_DIR'],
      KLING_ACCESS_KEY: process.env['KLING_ACCESS_KEY'],
      KLING_SECRET_KEY: process.env['KLING_SECRET_KEY'],
    };
    process.env['MEDIA_FORGE_PROJECT_DIR'] = tmpDir;
    process.env['MEDIA_FORGE_OUTPUTS_DIR'] = outputsDir;
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

  it('records actualUsd from est_usd fallback and writes asset to outputsDir', async () => {
    recordJob({
      dbPath,
      jobId: 'internal-dl-1',
      provider: 'kling',
      model: 'kling-v3-standard',
      mode: 't2v',
      paramsHash: 'h-dl',
      estUsd: 0.63,
      nativeTaskId: 'kling-native-dl',
    });

    // Two-call mock: pollStatus → returns succeed + asset URL; downloadAsset → bytes.
    let call = 0;
    const fetchImpl = async (..._args: Parameters<typeof fetch>): Promise<Response> => {
      call += 1;
      if (call === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            code: 0,
            data: {
              task_id: 'kling-native-dl',
              task_status: 'succeed',
              task_result: { videos: [{ id: 'v1', url: 'https://cdn.kling/dl.mp4', duration: '5' }] },
            },
          }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'video/mp4']]),
        arrayBuffer: async () => new TextEncoder().encode('KLING_DL_BYTES').buffer,
      } as unknown as Response;
    };

    const result = await handleKlingDownload({ jobIdOrUrl: 'internal-dl-1' }, { fetchImpl });

    // Output asset written
    expect(existsSync(join(outputsDir, 'internal-dl-1.mp4'))).toBe(true);
    expect(result.outputPath).toContain('internal-dl-1.mp4');

    // Cost ledger flipped from pending → terminal with est_usd fallback
    expect(result.actualUsd).toBeCloseTo(0.63, 4);
    const report = queryReport({ dbPath, periodDays: 30 });
    expect(report.byProvider.kling?.actualUsd).toBeCloseTo(0.63, 4);
  });

  it('skips cost recording when caller passes a raw URL (no jobId to reconcile)', async () => {
    const fetchImpl = async (..._args: Parameters<typeof fetch>): Promise<Response> =>
      ({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'video/mp4']]),
        arrayBuffer: async () => new TextEncoder().encode('RAW_URL_BYTES').buffer,
      }) as unknown as Response;

    const result = await handleKlingDownload(
      { jobIdOrUrl: 'https://cdn.kling/external-asset.mp4' },
      { fetchImpl },
    );

    expect(result.actualUsd).toBeUndefined();
    expect(existsSync(result.outputPath)).toBe(true);
  });
});
