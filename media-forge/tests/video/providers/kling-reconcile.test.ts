// tests/video/providers/kling-reconcile.test.ts
// Covers KlingProvider.reconcileBillingWindow (src/video/providers/kling.ts) —
// the settlement pass that overwrites video_jobs.actual_usd with what Kling
// ACTUALLY charged, and reports drift when the local estimate disagrees.
//
// Runs against a real temp sqlite db (via cost-tracker's real recordJob/
// getJobRecord API, not raw SQL) so the assertions prove the DB round-trip,
// not just an in-memory return value. fetchImpl is always injected — no
// network I/O.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDb, openDb, runMigrations } from '../../../src/core/db.js';
import { recordJob, getJobRecord } from '../../../src/core/cost-tracker.js';
import { KlingProvider } from '../../../src/video/providers/kling.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('KlingProvider.reconcileBillingWindow', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-kling-reconcile-'));
    dbPath = join(tmpDir, 'cost.db');
  });

  afterEach(() => {
    try {
      closeDb(dbPath);
    } catch {
      /* ignore — handle may already be closed */
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* Windows EPERM straggler — ignore */
    }
  });

  // The billing endpoints are API 2.0 only, which accepts API-key auth
  // exclusively — a legacy AccessKey/SecretKey env has nothing this call can
  // use, so it must refuse loudly and name the missing var rather than send a
  // request that Kling will reject anyway.
  it('throws when KLING_API_KEY is unset, naming it', async () => {
    const provider = new KlingProvider({ dbPath, env: {} });
    await expect(
      provider.reconcileBillingWindow({ startTimeMs: 0, endTimeMs: 1000 }),
    ).rejects.toThrow(/KLING_API_KEY/);
  });

  it('settles a local job: actual_usd in the DB equals the PROVIDER amount, not the estimate', async () => {
    recordJob({
      dbPath,
      jobId: 'job-local-1',
      provider: 'kling',
      model: 'kling-v3-standard',
      mode: 't2v',
      paramsHash: 'hash-1',
      estUsd: 0.5, // deliberately wrong — the point is this gets overwritten
      nativeTaskId: 'kling-task-billed-1',
    });

    const fetchImpl = async () =>
      jsonResponse({
        code: 0,
        data: [
          {
            id: 'kling-task-billed-1',
            billing: [{ charge_type: 'cash', amount: '0.98' }],
          },
        ],
      });

    const provider = new KlingProvider({ dbPath, env: { KLING_API_KEY: 'ak-test' } });
    const result = await provider.reconcileBillingWindow({
      startTimeMs: 0,
      endTimeMs: 1000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.settled).toEqual([{ taskId: 'kling-task-billed-1', actualUsd: 0.98 }]);

    // Read the row back — proves the write landed in sqlite, not just the
    // in-memory return value.
    const row = getJobRecord({ dbPath, jobId: 'job-local-1' });
    expect(row?.actualUsd).toBe(0.98);
    expect(row?.actualUsd).not.toBe(row?.estUsd);
  });

  // The same Kling API key can be used from more than one machine (or a prior
  // install). A billed task this DB has no row for must be skipped silently —
  // attributing it to a guessed local job would record someone else's spend.
  it('a billed task with NO local row is skipped and does not throw', async () => {
    // BUG (src/video/providers/kling.ts:591-594): findJobByNativeTaskId calls
    // openDb(this.dbPath) directly, bypassing runMigrations — unlike every
    // other cost-tracker entry point, which goes through ensureDb(). On a
    // brand-new dbPath where reconcileBillingWindow is the FIRST DB operation
    // in the process (e.g. a reconcile-only cron job that never calls
    // recordJob), this throws "no such table: video_jobs" instead of cleanly
    // reporting no local row. Migrating here up front works around it so this
    // test can assert the intended "skip silently" behavior; a real deployment
    // hitting this path first would crash instead.
    runMigrations(openDb(dbPath));

    const fetchImpl = async () =>
      jsonResponse({
        code: 0,
        data: [
          {
            id: 'kling-task-unowned',
            billing: [{ charge_type: 'cash', amount: '3' }],
          },
        ],
      });

    const provider = new KlingProvider({ dbPath, env: { KLING_API_KEY: 'ak-test' } });
    const result = await provider.reconcileBillingWindow({
      startTimeMs: 0,
      endTimeMs: 1000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.settled).toEqual([]);
    expect(result.drift).toEqual([]);
  });

  // Drift means the local rate table (src/core/models.ts) disagrees with what
  // the provider actually charges — which makes every FUTURE pre-submit
  // estimate wrong too, not just this one job. That is reported, never
  // silently corrected, so the operator can go fix the rate table.
  it('drift: an estimate >1% off the billed amount is reported with the right ratio', async () => {
    recordJob({
      dbPath,
      jobId: 'job-drift',
      provider: 'kling',
      model: 'kling-v3-standard',
      mode: 't2v',
      paramsHash: 'hash-drift',
      estUsd: 1.0,
      nativeTaskId: 'kling-task-drift',
    });

    const fetchImpl = async () =>
      jsonResponse({
        code: 0,
        data: [
          {
            id: 'kling-task-drift',
            billing: [{ charge_type: 'cash', amount: '1.20' }], // 20% over estimate
          },
        ],
      });

    const provider = new KlingProvider({ dbPath, env: { KLING_API_KEY: 'ak-test' } });
    const result = await provider.reconcileBillingWindow({
      startTimeMs: 0,
      endTimeMs: 1000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.drift).toEqual([
      { taskId: 'kling-task-drift', estimateUsd: 1.0, actualUsd: 1.2, ratio: 1.2 },
    ]);
  });

  it('within 1% of the estimate does NOT appear in drift', async () => {
    recordJob({
      dbPath,
      jobId: 'job-no-drift',
      provider: 'kling',
      model: 'kling-v3-standard',
      mode: 't2v',
      paramsHash: 'hash-no-drift',
      estUsd: 1.0,
      nativeTaskId: 'kling-task-no-drift',
    });

    const fetchImpl = async () =>
      jsonResponse({
        code: 0,
        data: [
          {
            id: 'kling-task-no-drift',
            billing: [{ charge_type: 'cash', amount: '1.005' }], // 0.5% over — within tolerance
          },
        ],
      });

    const provider = new KlingProvider({ dbPath, env: { KLING_API_KEY: 'ak-test' } });
    const result = await provider.reconcileBillingWindow({
      startTimeMs: 0,
      endTimeMs: 1000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.drift).toEqual([]);
    // Still settled — drift-detection is orthogonal to whether the row got updated.
    expect(result.settled).toEqual([{ taskId: 'kling-task-no-drift', actualUsd: 1.005 }]);
  });
});

describe('KlingProvider.reconcileBillingWindow — regressions', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-kling-recon-reg-'));
    dbPath = join(tmpDir, 'cost.db');
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
      /* Windows EPERM — ignore */
    }
  });

  it('migrates the database itself, so a reconcile-only process does not crash', async () => {
    // The db is NEVER migrated here on purpose. A cron job or CLI that only
    // reconciles — never submits — hits a fresh dbPath, and reading video_jobs
    // before migrating throws "no such table" instead of cleanly reporting that
    // the task has no local row. Every other cost-tracker entry point migrates
    // via ensureDb(); this path did not.
    const provider = new KlingProvider({
      dbPath,
      env: { KLING_API_KEY: 'k-test' } as never,
    });

    const fetchImpl = (async () =>
      jsonResponse({
        code: 0,
        data: [{ id: 'task-unknown', billing: [{ charge_type: 'unit', amount: '4' }] }],
        has_more: false,
      })) as unknown as typeof fetch;

    const result = await provider.reconcileBillingWindow({
      startTimeMs: 1,
      endTimeMs: 2,
      fetchImpl,
    });

    // No local row for that task, so nothing settles — but it must not throw.
    expect(result.settled).toHaveLength(0);
  });

  it('follows next_cursor, so a window larger than one page is fully settled', async () => {
    // Stopping at page one while has_more is true would leave real charges
    // unsettled while REPORTING success. The reconciliation would look complete
    // and every task past the first page would keep its estimate forever.
    runMigrations(openDb(dbPath));

    recordJob({
      dbPath,
      jobId: 'job-page-1',
      provider: 'kling',
      model: 'kling-v3-standard',
      mode: 't2v',
      paramsHash: 'h1',
      estUsd: 1.0,
      status: 'pending',
      nativeTaskId: 'task-p1',
    });
    recordJob({
      dbPath,
      jobId: 'job-page-2',
      provider: 'kling',
      model: 'kling-v3-standard',
      mode: 't2v',
      paramsHash: 'h2',
      estUsd: 1.0,
      status: 'pending',
      nativeTaskId: 'task-p2',
    });

    let call = 0;
    const fetchImpl = (async (url: string) => {
      call += 1;
      if (call === 1) {
        // First page reports more, and hands back a cursor.
        expect(String(url)).toContain('start_time');
        return jsonResponse({
          code: 0,
          data: [{ id: 'task-p1', billing: [{ charge_type: 'unit', amount: '10' }] }],
          next_cursor: 'CURSOR-2',
          has_more: true,
        });
      }
      // Second page must be requested BY CURSOR, with the window dropped —
      // the docs state start_time/end_time are ignored once a cursor is set.
      expect(String(url)).toContain('cursor=CURSOR-2');
      expect(String(url)).not.toContain('start_time');
      return jsonResponse({
        code: 0,
        data: [{ id: 'task-p2', billing: [{ charge_type: 'unit', amount: '20' }] }],
        has_more: false,
      });
    }) as unknown as typeof fetch;

    const provider = new KlingProvider({
      dbPath,
      env: { KLING_API_KEY: 'k-test' } as never,
    });
    const result = await provider.reconcileBillingWindow({
      startTimeMs: 1,
      endTimeMs: 2,
      fetchImpl,
    });
    expect(result.settled).toHaveLength(2);

    // Both rows carry the PROVIDER's amount, not the $1.00 estimate.
    expect(getJobRecord({ dbPath, jobId: 'job-page-1' })?.actualUsd).toBeCloseTo(10 * 0.14, 6);
    expect(getJobRecord({ dbPath, jobId: 'job-page-2' })?.actualUsd).toBeCloseTo(20 * 0.14, 6);
  });
});
