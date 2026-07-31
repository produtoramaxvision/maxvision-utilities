// tests/video/providers/higgsfield-ledger-hooks.test.ts
// A5 (2026-07-30) — proves HiggsfieldProvider.generate() reserves credit BEFORE
// the network submit via the optional `ledgerHooks` second argument
// (VideoLedgerHooks, base.ts), closing C8 for Higgsfield.
//
// New file — does not modify any pre-existing test. Mirrors the setup in
// tests/video/providers/higgsfield.test.ts (dbPath, global.fetch injection,
// env vars for HF_API_KEY/SECRET + usd-per-credit).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDb } from '../../../src/core/db.js';
import { clearRequestMapCache } from '../../../src/core/provider-request-map.js';
import type { VideoLedgerHooks } from '../../../src/video/providers/base.js';

import type * as CostTrackerModule from '../../../src/core/cost-tracker.js';

vi.mock('../../../src/core/cost-tracker.js', async (importOriginal) => {
  const actual = await importOriginal<typeof CostTrackerModule>();
  return { ...actual, recordJob: vi.fn(actual.recordJob) };
});

import { recordJob } from '../../../src/core/cost-tracker.js';
import { HiggsfieldProvider } from '../../../src/video/providers/higgsfield.js';

const ORIG_FETCH = global.fetch;

function makeReq() {
  return {
    modelId: 'higgsfield-soul-standard' as const,
    mode: 't2v' as const,
    prompt: 'a quiet lake at sunrise',
    durationSec: 8,
    resolution: '720p' as const,
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

describe('HiggsfieldProvider ledger hooks (A5)', () => {
  let tmpDir: string;
  let dbPath: string;
  let provider: HiggsfieldProvider;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-hf-ledger-'));
    dbPath = join(tmpDir, 'cost.db');
    clearRequestMapCache();
    process.env['HF_API_KEY'] = 'pk_test';
    process.env['HF_API_SECRET'] = 'sk_test';
    process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = '0.039';
    vi.mocked(recordJob).mockClear();
    provider = new HiggsfieldProvider({ dbPath, publicWebhookBaseUrl: 'https://app.example.com' });
  });

  afterEach(() => {
    global.fetch = ORIG_FETCH;
    try {
      closeDb(dbPath);
    } catch {
      /* ignore */
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* Windows EPERM straggler — ignore */
    }
    delete process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
    delete process.env['MEDIA_FORGE_HF_AUTH_FALLBACK_USED'];
    vi.restoreAllMocks();
  });

  it('reserves BEFORE the network submit — asserts ORDER, not just that both happened', async () => {
    const order: string[] = [];
    global.fetch = vi.fn(async () => {
      order.push('submit');
      return new Response(JSON.stringify({ request_id: 'req-1', status_url: 'u', cancel_url: 'c' }), { status: 200 });
    }) as unknown as typeof fetch;
    const { hooks, beforeSubmit } = makeHooks(order);

    await provider.generate(makeReq(), hooks);

    expect(beforeSubmit).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['reserve', 'submit']);
  });

  it('insufficient credit in beforeSubmit means the network call NEVER happens', async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const beforeSubmit = vi.fn(async () => {
      throw new Error('InsufficientCreditError: balance too low');
    });
    const onSubmitFailed = vi.fn();
    const onPostSubmitError = vi.fn();

    await expect(
      provider.generate(makeReq(), { beforeSubmit, onSubmitFailed, onPostSubmitError }),
    ).rejects.toThrow(/InsufficientCreditError/);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onSubmitFailed).not.toHaveBeenCalled();
    expect(onPostSubmitError).not.toHaveBeenCalled();
  });

  it('a submit that throws calls onSubmitFailed and the original error still propagates', async () => {
    global.fetch = vi.fn(async () => new Response('server error', { status: 500 })) as unknown as typeof fetch;
    const beforeSubmit = vi.fn(async () => {});
    const onSubmitFailed = vi.fn(async () => {});
    const onPostSubmitError = vi.fn();

    await expect(
      provider.generate(makeReq(), { beforeSubmit, onSubmitFailed, onPostSubmitError }),
    ).rejects.toThrow(/Higgsfield generate failed: 500/);

    expect(onSubmitFailed).toHaveBeenCalledTimes(1);
    expect(onPostSubmitError).not.toHaveBeenCalled();
    expect(vi.mocked(recordJob)).not.toHaveBeenCalled();
  });

  it('a throw AFTER a successful submit calls onPostSubmitError, propagates the original error, and issues no release', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ request_id: 'req-2', status_url: 'u', cancel_url: 'c' }), { status: 200 }),
    ) as unknown as typeof fetch;
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

    expect(global.fetch).toHaveBeenCalledTimes(1); // the submit DID happen
    expect(onPostSubmitError).toHaveBeenCalledTimes(1);
    const [jobIdArg, , errArg] = vi.mocked(onPostSubmitError).mock.calls[0]!;
    expect(typeof jobIdArg).toBe('string');
    expect(errArg).toBe(postSubmitErr);
    expect(onSubmitFailed).not.toHaveBeenCalled();
  });

  it('with ledgerHooks omitted, behavior is byte-identical to today (no hook calls, normal success)', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ request_id: 'req-3', status_url: 'u', cancel_url: 'c' }), { status: 200 }),
    ) as unknown as typeof fetch;

    const handle = await provider.generate(makeReq());

    expect(handle.jobId).toBeTruthy();
    expect(handle.providerNativeId).toBe('req-3');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordJob)).toHaveBeenCalledTimes(1);
  });
});
