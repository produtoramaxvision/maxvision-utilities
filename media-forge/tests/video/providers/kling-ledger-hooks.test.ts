// tests/video/providers/kling-ledger-hooks.test.ts
// A5 (2026-07-30) — proves KlingProvider.generate() reserves credit BEFORE the
// network submit via the optional `ledgerHooks` second argument (VideoLedgerHooks,
// base.ts), closing C8 for Kling the same way Veo already closed it
// (submitVeoWithLedger, register.ts).
//
// New file — does not modify any pre-existing test. Mirrors the setup in
// tests/video/providers/kling.test.ts (dbPath, fetchImpl injection, JWT cache reset).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDb } from '../../../src/core/db.js';
import { __resetKlingJwtCache } from '../../../src/video/providers/auth/kling-jwt.js';
import type { VideoLedgerHooks } from '../../../src/video/providers/base.js';

// Partial module mock — only recordJob is replaceable per-test (via
// mockImplementation), everything else is the real cost-tracker module. This
// is how test 4 below (onPostSubmitError) forces a post-submit-success
// bookkeeping failure deterministically, without depending on a real SQLite
// error condition.
import type * as CostTrackerModule from '../../../src/core/cost-tracker.js';

vi.mock('../../../src/core/cost-tracker.js', async (importOriginal) => {
  const actual = await importOriginal<typeof CostTrackerModule>();
  return { ...actual, recordJob: vi.fn(actual.recordJob) };
});

import { recordJob } from '../../../src/core/cost-tracker.js';
import { KlingProvider } from '../../../src/video/providers/kling.js';

const KLING_ENV = { KLING_ACCESS_KEY: 'ak_test', KLING_SECRET_KEY: 'sk_test' } as const;

function makeReq() {
  return {
    modelId: 'kling-v3-standard' as const,
    mode: 't2v' as const,
    prompt: 'a quiet lake at sunrise',
    durationSec: 5,
    resolution: '720p' as const,
  };
}

function okFetchResponse() {
  return { ok: true, status: 200, json: async () => ({ code: 0, data: { task_id: 'kling-task-abc' } }) };
}

function makeHooks(order: string[]) {
  const beforeSubmit = vi.fn(async () => {
    order.push('reserve');
  });
  const onSubmitFailed = vi.fn(async () => {
    order.push('release');
  });
  const onPostSubmitError = vi.fn(() => {
    order.push('postSubmitError');
  });
  const hooks: VideoLedgerHooks = { beforeSubmit, onSubmitFailed, onPostSubmitError };
  return { hooks, beforeSubmit, onSubmitFailed, onPostSubmitError };
}

describe('KlingProvider ledger hooks (A5)', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    __resetKlingJwtCache();
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-kling-ledger-'));
    dbPath = join(tmpDir, 'cost.db');
    vi.mocked(recordJob).mockClear();
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
    vi.restoreAllMocks();
  });

  it('reserves BEFORE the network submit — asserts ORDER, not just that both happened', async () => {
    const order: string[] = [];
    const fetchImpl = vi.fn().mockImplementation(async () => {
      order.push('submit');
      return okFetchResponse();
    });
    const { hooks, beforeSubmit } = makeHooks(order);
    const provider = new KlingProvider({ dbPath, env: KLING_ENV, fetchImpl: fetchImpl as unknown as typeof fetch });

    await provider.generate(makeReq(), hooks);

    expect(beforeSubmit).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['reserve', 'submit']);
  });

  it('insufficient credit in beforeSubmit means the network call NEVER happens', async () => {
    const fetchImpl = vi.fn();
    const beforeSubmit = vi.fn(async () => {
      throw new Error('InsufficientCreditError: balance too low');
    });
    const onSubmitFailed = vi.fn();
    const onPostSubmitError = vi.fn();
    const provider = new KlingProvider({ dbPath, env: KLING_ENV, fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(
      provider.generate(makeReq(), { beforeSubmit, onSubmitFailed, onPostSubmitError }),
    ).rejects.toThrow(/InsufficientCreditError/);

    expect(fetchImpl).not.toHaveBeenCalled();
    // Nothing to clean up — the submit never started.
    expect(onSubmitFailed).not.toHaveBeenCalled();
    expect(onPostSubmitError).not.toHaveBeenCalled();
  });

  it('a submit that throws calls onSubmitFailed and the original error still propagates', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network: ECONNRESET'));
    const beforeSubmit = vi.fn(async () => {});
    const onSubmitFailed = vi.fn(async () => {});
    const onPostSubmitError = vi.fn();
    const provider = new KlingProvider({ dbPath, env: KLING_ENV, fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(
      provider.generate(makeReq(), { beforeSubmit, onSubmitFailed, onPostSubmitError }),
    ).rejects.toThrow(/ECONNRESET/);

    expect(onSubmitFailed).toHaveBeenCalledTimes(1);
    expect(onPostSubmitError).not.toHaveBeenCalled();
    expect(vi.mocked(recordJob)).not.toHaveBeenCalled();
  });

  it('a throw AFTER a successful submit calls onPostSubmitError, propagates the original error, and issues no release', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okFetchResponse());
    const postSubmitErr = new Error('SQLITE_BUSY: database is locked');
    vi.mocked(recordJob).mockImplementationOnce(() => {
      throw postSubmitErr;
    });
    const beforeSubmit = vi.fn(async () => {});
    const onSubmitFailed = vi.fn(async () => {});
    const onPostSubmitError = vi.fn();
    const provider = new KlingProvider({ dbPath, env: KLING_ENV, fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(
      provider.generate(makeReq(), { beforeSubmit, onSubmitFailed, onPostSubmitError }),
    ).rejects.toThrow(/SQLITE_BUSY/);

    expect(fetchImpl).toHaveBeenCalledTimes(1); // the submit DID happen
    expect(onPostSubmitError).toHaveBeenCalledTimes(1);
    const [jobIdArg, , errArg] = vi.mocked(onPostSubmitError).mock.calls[0]!;
    expect(typeof jobIdArg).toBe('string');
    expect(errArg).toBe(postSubmitErr);
    // The reservation must NOT be released — the provider already accepted the job.
    expect(onSubmitFailed).not.toHaveBeenCalled();
  });

  it('with ledgerHooks omitted, behavior is byte-identical to today (no hook calls, normal success)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okFetchResponse());
    const provider = new KlingProvider({ dbPath, env: KLING_ENV, fetchImpl: fetchImpl as unknown as typeof fetch });

    const handle = await provider.generate(makeReq());

    expect(handle.jobId).toBeTruthy();
    expect(handle.providerNativeId).toBe('kling-task-abc');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordJob)).toHaveBeenCalledTimes(1);
  });
});
