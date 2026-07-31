// tests/unit/video/providers/bytedance-seedance-actual-credits.test.ts
//
// A4 (2026-07-30): pollStatus's 'completed' branch now also persists
// `actualCredits: videoActualCredits(actualUsd)` on the video_jobs row.
//
// Why this matters (see the comment in bytedance-seedance.ts:pollStatus):
// Seedance is the ONLY provider whose credit capture is sweep-driven — it
// registers no poll/download MCP tool, so completion runs through the webhook
// and pollStatus, neither of which has a per-request creditClient. credit-core's
// sweep reads the row through src/http/job-status.ts, which only returns
// actualCredits when the column is populated. Before this change the column
// was always null, so the sweep captured whatever it defaults to rather than
// the reconciled cost. This file locks in that the column gets populated, that
// the http oracle surfaces it, that the resolution multiplier reaches the
// credit value (not just the USD value), that terminal failures do NOT invent
// credits, and that a re-poll is a no-op.
//
// Seam note: BytedanceSeedanceProvider has no injectable fal.ai client — the
// constructor only exposes `fetchImpl` (used by download() and the ARK REST
// fallback), never a per-call client for the `@fal-ai/client` SDK calls
// pollStatus makes via fal.queue.status/result. The existing suite at
// tests/video/providers/bytedance-seedance.test.ts already establishes the
// real seam for this: vi.mock('@fal-ai/client') at module load, then drive
// generate() (fal path) to populate the in-memory routeByJobId, then mock
// fal.queue.status/result to reach the 'completed' branch of pollStatus. This
// file reuses that exact seam rather than adding any new production hook.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, closeDb } from '../../../../src/core/db.js';
import { getJobRecord } from '../../../../src/core/cost-tracker.js';
import { videoActualCredits } from '../../../../src/billing/pricing.js';
import { buildJobStatusRoute } from '../../../../src/http/job-status.js';

// Mock @fal-ai/client so unit tests never hit the network — same pattern as
// tests/video/providers/bytedance-seedance.test.ts.
vi.mock('@fal-ai/client', () => {
  const submit = vi.fn();
  const status = vi.fn();
  const result = vi.fn();
  const config = vi.fn();
  return {
    fal: {
      config,
      queue: { submit, status, result },
    },
  };
});

import { fal } from '@fal-ai/client';
import {
  BytedanceSeedanceProvider,
  __resetBytedanceSeedanceSingleton,
} from '../../../../src/video/providers/bytedance-seedance.js';

describe('BytedanceSeedanceProvider.pollStatus — actualCredits capture (A4)', () => {
  let tmpDir: string;
  let dbPath: string;
  let provider: BytedanceSeedanceProvider;

  beforeEach(() => {
    __resetBytedanceSeedanceSingleton();
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-seedance-credits-'));
    dbPath = join(tmpDir, 'cost.db');
    const db = openDb(dbPath);
    runMigrations(db);
    provider = new BytedanceSeedanceProvider({
      dbPath,
      env: { FAL_KEY: 'fal_test_xyz', BYTEPLUS_ARK_API_KEY: 'ark_test_xyz' },
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    try {
      closeDb(dbPath);
    } catch {
      /* better-sqlite3 may have closed already */
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* Windows EPERM strangler — ignore */
    }
    vi.restoreAllMocks();
  });

  /** Drives a fresh job through generate() → pollStatus() to 'completed' and
   *  returns the jobId. Standard tier so the resolution multiplier is live. */
  async function completeJob(args: {
    readonly resolution: '480p' | '720p' | '1080p';
    readonly durationSec: number;
    readonly requestId: string;
    readonly videoUrl: string;
  }): Promise<string> {
    vi.mocked(fal.queue.submit).mockResolvedValueOnce({ request_id: args.requestId } as never);
    vi.mocked(fal.queue.status).mockResolvedValue({ status: 'COMPLETED' } as never);
    vi.mocked(fal.queue.result).mockResolvedValue({
      data: { video: { url: args.videoUrl } },
    } as never);
    const handle = await provider.generate({
      modelId: 'seedance-2.0-standard',
      mode: 't2v',
      prompt: 'x',
      durationSec: args.durationSec,
      resolution: args.resolution,
    });
    await provider.pollStatus(handle.jobId);
    return handle.jobId;
  }

  // 1. The column is populated, and equals videoActualCredits(actual_usd) —
  //    the relationship, not a hardcoded number, so a markup change can't
  //    silently break the test's meaning.
  it('persists a non-null actual_credits equal to videoActualCredits(actual_usd)', async () => {
    const jobId = await completeJob({
      resolution: '720p',
      durationSec: 10,
      requestId: 'credits-720p',
      videoUrl: 'https://fal.cdn/720.mp4',
    });
    const row = getJobRecord({ dbPath, jobId });
    expect(row?.actualUsd).not.toBeNull();
    expect(row?.actualCredits).not.toBeNull();
    expect(row!.actualCredits).toBe(videoActualCredits(row!.actualUsd!));
  });

  // 2. The http oracle (credit-core's sweep consumer) surfaces actualCredits,
  //    not just status — this is the half that was broken before A4.
  it('buildJobStatusRoute returns {status: completed, actualCredits} for the settled job', async () => {
    const jobId = await completeJob({
      resolution: '720p',
      durationSec: 10,
      requestId: 'oracle-720p',
      videoUrl: 'https://fal.cdn/oracle.mp4',
    });
    const row = getJobRecord({ dbPath, jobId });
    expect(row?.actualCredits).not.toBeNull();

    const app = buildJobStatusRoute({
      secret: 's',
      getJobRecord: (id) => getJobRecord({ dbPath, jobId: id }),
    });
    const res = await app.request(`/${jobId}`, { headers: { 'x-mf-status-secret': 's' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'completed', actualCredits: row!.actualCredits });
  });

  // 3. The resolution multiplier reaches the credit value, not just the USD
  //    value — two different resolutions must yield two different credit
  //    totals for the same duration.
  it('different resolutions produce different actual_credits (multiplier reaches credits, not just USD)', async () => {
    const jobId720 = await completeJob({
      resolution: '720p',
      durationSec: 10,
      requestId: 'res-720p',
      videoUrl: 'https://fal.cdn/r720.mp4',
    });
    const jobId1080 = await completeJob({
      resolution: '1080p',
      durationSec: 10,
      requestId: 'res-1080p',
      videoUrl: 'https://fal.cdn/r1080.mp4',
    });

    const row720 = getJobRecord({ dbPath, jobId: jobId720 });
    const row1080 = getJobRecord({ dbPath, jobId: jobId1080 });

    expect(row720?.actualUsd).toBeCloseTo(0.3024 * 1.0 * 10, 4);
    expect(row1080?.actualUsd).toBeCloseTo(0.3024 * 2.25 * 10, 4);

    expect(row720!.actualCredits).toBe(videoActualCredits(row720!.actualUsd!));
    expect(row1080!.actualCredits).toBe(videoActualCredits(row1080!.actualUsd!));
    expect(row1080!.actualCredits).not.toBe(row720!.actualCredits);
  });

  // 4. Terminal failure paths (failed/canceled/nsfw) must NOT invent credits —
  //    lock in the current behaviour: actualUsd: 0, actualCredits stays null.
  it('a terminal failed poll records actualUsd: 0 and does NOT invent actualCredits', async () => {
    vi.mocked(fal.queue.submit).mockResolvedValueOnce({ request_id: 'fail-1' } as never);
    vi.mocked(fal.queue.status).mockResolvedValue({ status: 'ERROR' } as never);
    const handle = await provider.generate({
      modelId: 'seedance-2.0-standard',
      mode: 't2v',
      prompt: 'x',
      durationSec: 5,
      resolution: '720p',
    });
    const status = await provider.pollStatus(handle.jobId);
    expect(status.state).toBe('failed');

    const row = getJobRecord({ dbPath, jobId: handle.jobId });
    expect(row?.status).toBe('failed');
    expect(row?.actualUsd).toBe(0);
    expect(row?.actualCredits).toBeNull();
  });

  // 5. Idempotent: recordActualCost guards on WHERE actual_usd IS NULL — a
  //    second poll after completion must not change the row.
  it('a second poll after completion does not change actual_usd or actual_credits', async () => {
    const jobId = await completeJob({
      resolution: '1080p',
      durationSec: 8,
      requestId: 'idem-1080p',
      videoUrl: 'https://fal.cdn/idem.mp4',
    });
    const before = getJobRecord({ dbPath, jobId });
    expect(before?.actualCredits).not.toBeNull();

    await provider.pollStatus(jobId);

    const after = getJobRecord({ dbPath, jobId });
    expect(after?.actualUsd).toBe(before?.actualUsd);
    expect(after?.actualCredits).toBe(before?.actualCredits);
  });
});
