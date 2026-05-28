import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, closeDb } from '../../../src/core/db.js';
import { recordJob, queryReport } from '../../../src/core/cost-tracker.js';
import { createKlingWebhookHandler } from '../../../src/video/providers/kling-webhook-handler.js';

describe('createKlingWebhookHandler', () => {
  let tmpDir: string;
  let dbPath: string;
  let outputsDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-kling-wh-'));
    dbPath = join(tmpDir, 'cost.db');
    outputsDir = join(tmpDir, 'outputs');
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
    vi.restoreAllMocks();
  });

  it('uses ctx.jobId (URL path /webhooks/kling/{jobId}) and records actual cost', async () => {
    // P14 webhook router extracts the trailing path segment as ctx.jobId.
    // KlingProvider.generate embeds our internal jobId into the callback_url it sends to Kling.
    // No global map needed.
    recordJob({
      dbPath,
      jobId: 'internal-job-A',
      provider: 'kling',
      model: 'kling-v3-standard',
      mode: 't2v',
      paramsHash: 'h1',
      estUsd: 0.63,
    });

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'video/mp4']]),
      arrayBuffer: async () => new TextEncoder().encode('FAKEMP4_BYTES').buffer,
    });

    const handler = createKlingWebhookHandler({ dbPath, outputsDir, fetchImpl: fetchImpl as never });
    await handler({
      provider: 'kling',
      jobId: 'internal-job-A', // <-- from URL path /webhooks/kling/internal-job-A, extracted by P14 router
      payload: {
        task_id: 'kling-native-A',
        task_status: 'succeed',
        task_result: {
          videos: [{ id: 'v1', url: 'https://cdn.kling/asset-A.mp4', duration: '5' }],
        },
      },
      headers: {},
    });

    expect(existsSync(join(outputsDir, 'internal-job-A.mp4'))).toBe(true);
    expect(readFileSync(join(outputsDir, 'internal-job-A.mp4')).toString()).toBe('FAKEMP4_BYTES');

    const report = queryReport({ dbPath, periodDays: 30 });
    expect(report.byProvider.kling?.actualUsd).toBeCloseTo(0.126 * 5, 4);
  });

  it('ignores payload when task_status is not "succeed" (processing/submitted)', async () => {
    recordJob({
      dbPath,
      jobId: 'internal-job-pending',
      provider: 'kling',
      model: 'kling-v3-standard',
      mode: 't2v',
      paramsHash: 'h2',
      estUsd: 0.63,
    });
    const fetchImpl = vi.fn();
    const handler = createKlingWebhookHandler({ dbPath, outputsDir, fetchImpl: fetchImpl as never });
    await handler({
      provider: 'kling',
      jobId: 'internal-job-pending', // <-- from URL path
      payload: { task_id: 'kling-native-P', task_status: 'processing' },
      headers: {},
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    const report = queryReport({ dbPath, periodDays: 30 });
    expect(report.byProvider.kling?.actualUsd ?? 0).toBe(0);
  });

  it('marks job failed (records 0 actual cost, logs error) on task_status=failed', async () => {
    recordJob({
      dbPath,
      jobId: 'internal-job-failed',
      provider: 'kling',
      model: 'kling-v3-standard',
      mode: 't2v',
      paramsHash: 'h3',
      estUsd: 0.63,
    });
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const fetchImpl = vi.fn();
    const handler = createKlingWebhookHandler({ dbPath, outputsDir, fetchImpl: fetchImpl as never });
    await handler({
      provider: 'kling',
      jobId: 'internal-job-failed', // <-- from URL path
      payload: {
        task_id: 'kling-native-F',
        task_status: 'failed',
        task_status_msg: 'content moderation rejected',
      },
      headers: {},
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
    expect((errSpy.mock.calls[0][0] as string).toLowerCase()).toContain('content moderation');
  });

  it('marks job failed when task_status=succeed but task_result.videos is empty (Codex P2 round 15, PR#11)', async () => {
    recordJob({
      dbPath,
      jobId: 'internal-job-empty',
      provider: 'kling',
      model: 'kling-v3-standard',
      mode: 't2v',
      paramsHash: 'h-empty',
      estUsd: 0.63,
    });
    const fetchImpl = vi.fn();
    const handler = createKlingWebhookHandler({ dbPath, outputsDir, fetchImpl: fetchImpl as never });
    await handler({
      provider: 'kling',
      jobId: 'internal-job-empty',
      payload: {
        task_id: 'kling-native-empty',
        task_status: 'succeed',
        task_result: { videos: [] },
      },
      headers: {},
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    const db = openDb(dbPath);
    const row = db
      .prepare('SELECT status, completed_at FROM video_jobs WHERE id = ?')
      .get('internal-job-empty') as { status: string; completed_at: string | null };
    expect(row.status).toBe('failed');
    expect(row.completed_at).not.toBeNull();
    closeDb(dbPath);
  });

  it('throws when no cost-tracker DB record exists for ctx.jobId (orphan webhook)', async () => {
    const fetchImpl = vi.fn();
    const handler = createKlingWebhookHandler({ dbPath, outputsDir, fetchImpl: fetchImpl as never });
    await expect(
      handler({
        provider: 'kling',
        jobId: 'unknown-internal-job', // <-- not present in video_jobs table
        payload: {
          task_id: 'kling-native-orphan',
          task_status: 'succeed',
          task_result: { videos: [{ id: 'v1', url: 'https://cdn/orphan.mp4', duration: '5' }] },
        },
        headers: {},
      }),
    ).rejects.toThrow(/no cost-tracker record|unknown jobId/i);
  });

  it('handles multi-shot omni payload with multiple video assets (parallel download via Promise.all)', async () => {
    recordJob({
      dbPath,
      jobId: 'internal-omni-1',
      provider: 'kling',
      model: 'kling-v3-omni',
      mode: 'multi-shot',
      paramsHash: 'h4',
      estUsd: 1.68,
    });

    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      const tag = url.includes('shot1') ? 'shot-A' : 'shot-B';
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'video/mp4']]),
        arrayBuffer: async () => new TextEncoder().encode(tag).buffer,
      };
    });

    const handler = createKlingWebhookHandler({ dbPath, outputsDir, fetchImpl: fetchImpl as never });
    await handler({
      provider: 'kling',
      jobId: 'internal-omni-1', // <-- from URL path
      payload: {
        task_id: 'kling-omni-native-1',
        task_status: 'succeed',
        task_result: {
          videos: [
            { id: 'v1', url: 'https://cdn/shot1.mp4', duration: '5' },
            { id: 'v2', url: 'https://cdn/shot2.mp4', duration: '5' },
          ],
        },
      },
      headers: {},
    });

    // Deterministic filenames preserved by .map(async (v, i) => ...) + Promise.all
    expect(existsSync(join(outputsDir, 'internal-omni-1.shot-0.mp4'))).toBe(true);
    expect(existsSync(join(outputsDir, 'internal-omni-1.shot-1.mp4'))).toBe(true);
    expect(readFileSync(join(outputsDir, 'internal-omni-1.shot-0.mp4')).toString()).toBe('shot-A');
    expect(readFileSync(join(outputsDir, 'internal-omni-1.shot-1.mp4')).toString()).toBe('shot-B');
  });

  it('retries with refreshed poll on 403/404 CDN download (TTL expiry path)', async () => {
    // Kling CDN URLs are temporary (TTL ~3600s). Max poll cadence should be <=30s, but if download
    // fails with 403/404 on a 'completed' URL, the handler re-polls /v1/videos/{type}/{task_id}
    // for a fresh URL.
    recordJob({
      dbPath,
      jobId: 'internal-ttl-1',
      provider: 'kling',
      model: 'kling-v3-standard',
      mode: 't2v',
      paramsHash: 'h5',
      estUsd: 0.63,
    });

    let n = 0;
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      n += 1;
      if (n === 1) return { ok: false, status: 403, statusText: 'Forbidden', json: async () => ({ message: 'URL expired' }) };
      if (url.includes('/v1/videos/text2video/')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            code: 0, data: { task_status: 'succeed', task_result: { videos: [{ url: 'https://cdn/fresh.mp4', duration: '5' }] } },
          }),
        };
      }
      return { ok: true, status: 200, headers: new Map([['content-type', 'video/mp4']]), arrayBuffer: async () => new TextEncoder().encode('FRESH').buffer };
    });

    const handler = createKlingWebhookHandler({
      dbPath, outputsDir, fetchImpl: fetchImpl as never,
      env: { KLING_ACCESS_KEY: 'ak', KLING_SECRET_KEY: 'sk' },
    });
    await handler({
      provider: 'kling',
      jobId: 'internal-ttl-1',
      payload: {
        task_id: 'kling-native-ttl',
        task_status: 'succeed',
        task_result: { videos: [{ id: 'v1', url: 'https://cdn/expired.mp4', duration: '5' }] },
      },
      headers: {},
    });
    expect(existsSync(join(outputsDir, 'internal-ttl-1.mp4'))).toBe(true);
    expect(readFileSync(join(outputsDir, 'internal-ttl-1.mp4')).toString()).toBe('FRESH');
  });

  // -------------------------------------------------------------------------
  // CodeRabbit round 9 PR#11 — TTL refresh coverage across non-t2v modes.
  // refreshPollPathFor() previously had ALL modes collapsing to text2video,
  // so jobs other than t2v hit the wrong endpoint on TTL refresh and got 404
  // forever. Round 5 fixed that. This block locks the per-mode coverage so
  // future regressions to that table fail fast.
  // -------------------------------------------------------------------------
  const TTL_MODE_MATRIX = [
    { mode: 'i2v', pollPath: '/v1/videos/image2video/' },
    { mode: 'lip-sync', pollPath: '/v1/videos/advanced-lip-sync/' },
    { mode: 'extend', pollPath: '/v1/videos/video-extend/' },
    { mode: 'multi-shot', pollPath: '/v1/videos/omni-video/' },
    { mode: 'motion-brush', pollPath: '/v1/motion/' },
    { mode: 'elements', pollPath: '/v1/motion/' },
  ] as const;

  for (const { mode, pollPath } of TTL_MODE_MATRIX) {
    it(`TTL refresh path for mode=${mode} hits ${pollPath}<task_id>`, async () => {
      recordJob({
        dbPath,
        jobId: `internal-ttl-${mode}`,
        provider: 'kling',
        model: 'kling-v3-standard',
        mode,
        paramsHash: `h-${mode}`,
        estUsd: 0.63,
        nativeTaskId: `kling-native-${mode}`,
      });
      const calls: string[] = [];
      const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
        calls.push(url);
        // Step 1: original CDN download → 403 expired
        if (calls.length === 1) {
          return {
            ok: false,
            status: 403,
            statusText: 'Forbidden',
            json: async () => ({ message: 'URL expired' }),
          };
        }
        // Step 2: re-poll for fresh URL → must hit `pollPath`
        if (url.includes(pollPath)) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              code: 0,
              data: {
                task_status: 'succeed',
                task_result: {
                  videos: [{ url: `https://cdn/fresh-${mode}.mp4`, duration: '5' }],
                },
              },
            }),
          };
        }
        // Step 3: fresh download → bytes
        return {
          ok: true,
          status: 200,
          headers: new Map([['content-type', 'video/mp4']]),
          arrayBuffer: async () => new TextEncoder().encode(`FRESH-${mode}`).buffer,
        };
      });
      const handler = createKlingWebhookHandler({
        dbPath,
        outputsDir,
        fetchImpl: fetchImpl as never,
        env: { KLING_ACCESS_KEY: 'ak', KLING_SECRET_KEY: 'sk' },
      });
      await handler({
        provider: 'kling',
        jobId: `internal-ttl-${mode}`,
        payload: {
          task_id: `kling-native-${mode}`,
          task_status: 'succeed',
          task_result: { videos: [{ id: 'v1', url: 'https://cdn/expired.mp4', duration: '5' }] },
        },
        headers: {},
      });
      // The refresh poll url must contain the per-mode path + the native task id
      const refreshCall = calls.find((u) => u.includes(pollPath));
      expect(refreshCall, `mode=${mode} did not hit ${pollPath} on refresh`).toBeDefined();
      expect(refreshCall).toContain(`kling-native-${mode}`);
      // Asset was written from the FRESH-${mode} re-poll response.
      const filename = join(outputsDir, `internal-ttl-${mode}.mp4`);
      expect(existsSync(filename)).toBe(true);
      expect(readFileSync(filename).toString()).toBe(`FRESH-${mode}`);
    });
  }

  it('falls back to estimated cost when payload omits per-video duration (Codex P2 round 6)', async () => {
    // Regression: Kling success payloads sometimes omit `duration`. Without this fallback,
    // totalDurationSec=0 skipped recordActualCost() and the row stayed 'pending' forever
    // despite assets being downloaded. The fallback uses the previously-recorded est_usd
    // (or 0) so the terminal status always flips.
    recordJob({
      dbPath,
      jobId: 'internal-no-duration',
      provider: 'kling',
      model: 'kling-v3-standard',
      mode: 't2v',
      paramsHash: 'h-no-dur',
      estUsd: 0.42,
    });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'video/mp4']]),
      arrayBuffer: async () => new TextEncoder().encode('NO_DUR').buffer,
    });
    const handler = createKlingWebhookHandler({ dbPath, outputsDir, fetchImpl: fetchImpl as never });
    await handler({
      provider: 'kling',
      jobId: 'internal-no-duration',
      payload: {
        task_id: 'kling-native-no-dur',
        task_status: 'succeed',
        task_result: { videos: [{ id: 'v1', url: 'https://cdn/no-dur.mp4' }] }, // <-- no duration
      },
      headers: {},
    });
    const report = queryReport({ dbPath, periodDays: 30 });
    expect(report.byProvider.kling?.actualUsd).toBeCloseTo(0.42, 4);
  });
});
