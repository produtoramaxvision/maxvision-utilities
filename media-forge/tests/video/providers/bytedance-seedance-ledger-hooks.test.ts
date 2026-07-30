// tests/video/providers/bytedance-seedance-ledger-hooks.test.ts
// A5 (2026-07-30) — proves BytedanceSeedanceProvider.generate() reserves credit
// BEFORE the fal.ai/ARK submit via the optional `ledgerHooks` second argument
// (VideoLedgerHooks, base.ts), closing C8 for Seedance.
//
// IMPORTANT (do not "simplify" this away): this file mocks `@fal-ai/client`
// only, exactly like tests/video/providers/bytedance-seedance.test.ts, and
// drives the REAL BytedanceSeedanceProvider. It deliberately does NOT use the
// module-mock pattern from tests/mcp/seedance-billing-submit.test.ts (which
// replaces the whole provider) — the ledger hooks live INSIDE the real
// generate(), so a fully-mocked provider would never call them and every
// assertion below would pass vacuously. That exact blind spot is why
// seedance-billing-submit.test.ts's "reserves credit" assertion no longer
// holds after this change (see the A5 report) — it drives a provider mock
// that predates the hook, not the code path this file exercises.
//
// New file — does not modify any pre-existing test.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, closeDb } from '../../../src/core/db.js';
import type { VideoLedgerHooks } from '../../../src/video/providers/base.js';

vi.mock('@fal-ai/client', () => {
  const submit = vi.fn();
  const status = vi.fn();
  const result = vi.fn();
  const config = vi.fn();
  return { fal: { config, queue: { submit, status, result } } };
});

import type * as CostTrackerModule from '../../../src/core/cost-tracker.js';

vi.mock('../../../src/core/cost-tracker.js', async (importOriginal) => {
  const actual = await importOriginal<typeof CostTrackerModule>();
  return { ...actual, recordJob: vi.fn(actual.recordJob) };
});

import { fal } from '@fal-ai/client';
import { recordJob } from '../../../src/core/cost-tracker.js';
import {
  BytedanceSeedanceProvider,
  __resetBytedanceSeedanceSingleton,
} from '../../../src/video/providers/bytedance-seedance.js';

function makeReq() {
  return {
    modelId: 'seedance-2.0-standard' as const,
    mode: 't2v' as const,
    prompt: 'a quiet lake at sunrise',
    durationSec: 5,
    resolution: '1080p' as const,
  };
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

describe('BytedanceSeedanceProvider ledger hooks (A5)', () => {
  let tmpDir: string;
  let dbPath: string;
  let provider: BytedanceSeedanceProvider;

  beforeEach(() => {
    __resetBytedanceSeedanceSingleton();
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-seedance-ledger-'));
    dbPath = join(tmpDir, 'cost.db');
    const db = openDb(dbPath);
    runMigrations(db);
    vi.clearAllMocks();
    vi.mocked(recordJob).mockClear();
    provider = new BytedanceSeedanceProvider({
      dbPath,
      env: { FAL_KEY: 'fal_test', BYTEPLUS_ARK_API_KEY: 'ark_test' },
    });
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
      /* Windows EPERM straggler — ignore */
    }
    vi.restoreAllMocks();
  });

  it('reserves BEFORE the fal.ai submit — asserts ORDER, not just that both happened', async () => {
    const order: string[] = [];
    vi.mocked(fal.queue.submit).mockImplementation(async () => {
      order.push('submit');
      return { request_id: 'fal-req-1' } as never;
    });
    const { hooks, beforeSubmit } = makeHooks(order);

    await provider.generate(makeReq(), hooks);

    expect(beforeSubmit).toHaveBeenCalledTimes(1);
    expect(fal.queue.submit).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['reserve', 'submit']);
  });

  it('insufficient credit in beforeSubmit means the network call NEVER happens', async () => {
    const beforeSubmit = vi.fn(async () => {
      throw new Error('InsufficientCreditError: balance too low');
    });
    const onSubmitFailed = vi.fn();
    const onPostSubmitError = vi.fn();

    await expect(
      provider.generate(makeReq(), { beforeSubmit, onSubmitFailed, onPostSubmitError }),
    ).rejects.toThrow(/InsufficientCreditError/);

    expect(fal.queue.submit).not.toHaveBeenCalled();
    expect(onSubmitFailed).not.toHaveBeenCalled();
    expect(onPostSubmitError).not.toHaveBeenCalled();
  });

  it('a submit that throws (non-transient, no ARK fallback) calls onSubmitFailed and the original error still propagates', async () => {
    vi.mocked(fal.queue.submit).mockRejectedValue(
      Object.assign(new Error('fal 401 unauthorized'), { status: 401 }),
    );
    const beforeSubmit = vi.fn(async () => {});
    const onSubmitFailed = vi.fn(async () => {});
    const onPostSubmitError = vi.fn();

    await expect(
      provider.generate(makeReq(), { beforeSubmit, onSubmitFailed, onPostSubmitError }),
    ).rejects.toThrow(/fal 401/);

    expect(onSubmitFailed).toHaveBeenCalledTimes(1);
    expect(onPostSubmitError).not.toHaveBeenCalled();
    expect(vi.mocked(recordJob)).not.toHaveBeenCalled();
  });

  it('a throw AFTER a successful fal.ai submit calls onPostSubmitError, propagates the original error, issues no release, and does NOT fall back to ARK', async () => {
    vi.mocked(fal.queue.submit).mockResolvedValue({ request_id: 'fal-req-2' } as never);
    const postSubmitErr = new Error('SQLITE_BUSY: database is locked');
    vi.mocked(recordJob).mockImplementationOnce(() => {
      throw postSubmitErr;
    });
    const beforeSubmit = vi.fn(async () => {});
    const onSubmitFailed = vi.fn(async () => {});
    const onPostSubmitError = vi.fn();

    await expect(
      provider.generate(makeReq(), { beforeSubmit, onSubmitFailed, onPostSubmitError }),
    ).rejects.toThrow(/SQLITE_BUSY/);

    expect(fal.queue.submit).toHaveBeenCalledTimes(1); // the submit DID happen
    expect(onPostSubmitError).toHaveBeenCalledTimes(1);
    const [jobIdArg, , errArg] = vi.mocked(onPostSubmitError).mock.calls[0]!;
    expect(typeof jobIdArg).toBe('string');
    expect(errArg).toBe(postSubmitErr);
    expect(onSubmitFailed).not.toHaveBeenCalled();
    // Critical: fal.ai already accepted the job — a post-accept bookkeeping
    // failure must NOT trigger the transient-error fallback to ARK (that
    // would double-submit a job fal.ai already accepted). Only one
    // fal.queue.submit call happened above; if the fallback logic had
    // incorrectly treated this as a submit failure it would have attempted
    // BytePlus ARK next, which isn't configured/mocked here and would have
    // surfaced as a DIFFERENT error (ArkAuthConfigError / fetch failure)
    // instead of the original SQLITE_BUSY asserted above.
  });

  it('with ledgerHooks omitted, behavior is byte-identical to today (no hook calls, normal success)', async () => {
    vi.mocked(fal.queue.submit).mockResolvedValue({ request_id: 'fal-req-3' } as never);

    const handle = await provider.generate(makeReq());

    expect(handle.jobId).toBeTruthy();
    expect(handle.providerNativeId).toBe('fal-req-3');
    expect(fal.queue.submit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordJob)).toHaveBeenCalledTimes(1);
  });
});
