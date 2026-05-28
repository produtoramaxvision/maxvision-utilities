// tests/video/providers/bytedance-webhook-handler.test.ts
// P16.W FASE 3 — tests for the real fal.ai webhook handler.
// R21 — added Codex R20 P2 #1 (request_id binding) + P2 #2 (non-blocking ACK) tests.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBytedanceWebhookHandler } from '../../../src/video/providers/bytedance-webhook-handler.js';
import { recordJob, getJobRecord } from '../../../src/core/cost-tracker.js';
import { closeDb } from '../../../src/core/db.js';

function fakeFetch(body: Buffer, status = 200): typeof fetch {
  return (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      async arrayBuffer() {
        return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
      },
    }) as unknown as Response) as typeof fetch;
}

/** Fetch that resolves only after `delayMs` — simulates slow CDN. */
function slowFetch(body: Buffer, delayMs: number): typeof fetch {
  return (async () => {
    await new Promise<void>((r) => setTimeout(r, delayMs));
    return {
      ok: true,
      status: 200,
      async arrayBuffer() {
        return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
      },
    } as unknown as Response;
  }) as typeof fetch;
}

describe('createBytedanceWebhookHandler', () => {
  let tmpDir: string;
  let dbPath: string;
  let outputsDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-bytedance-wh-'));
    dbPath = join(tmpDir, 'cost.db');
    outputsDir = join(tmpDir, 'outputs');
  });

  afterEach(() => {
    closeDb(dbPath);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedJob(jobId: string, nativeTaskId: string = `fal-req-${jobId}`): void {
    recordJob({
      dbPath,
      jobId,
      provider: 'bytedance',
      model: 'seedance-2.0-standard',
      mode: 't2v',
      paramsHash: 'h',
      estUsd: 1.0,
      nativeTaskId,
    });
  }

  it('throws on orphan webhook (unknown jobId)', async () => {
    const h = createBytedanceWebhookHandler({ dbPath, outputsDir, awaitBackgroundDownload: true });
    await expect(
      h({
        provider: 'bytedance',
        jobId: 'never-recorded',
        payload: { status: 'OK', request_id: 'x', payload: { video: { url: 'https://x/y.mp4' } } },
        headers: {},
      }),
    ).rejects.toThrow(/no cost-tracker record/);
  });

  it('status=OK + matching request_id + video.url → downloads asset + persists status=completed', async () => {
    const jobId = 'job-ok-1';
    seedJob(jobId, 'fal-req-MATCH');
    const videoBytes = Buffer.from('FAKE_MP4_BYTES');
    const h = createBytedanceWebhookHandler({
      dbPath,
      outputsDir,
      fetchImpl: fakeFetch(videoBytes),
      awaitBackgroundDownload: true,
    });

    await h({
      provider: 'bytedance',
      jobId,
      payload: {
        request_id: 'fal-req-MATCH',
        status: 'OK',
        payload: { video: { url: 'https://cdn.fal/v.mp4', duration: 5 } },
      },
      headers: {},
    });

    expect(existsSync(join(outputsDir, `${jobId}.mp4`))).toBe(true);
    expect(statSync(join(outputsDir, `${jobId}.mp4`)).size).toBe(videoBytes.length);

    const row = getJobRecord({ dbPath, jobId });
    expect(row?.status).toBe('completed');
    expect(row?.actualUsd).toBeNull();
  });

  it('status=ERROR + matching request_id → marks status=failed', async () => {
    const jobId = 'job-err-1';
    seedJob(jobId, 'fal-req-ERR');
    const h = createBytedanceWebhookHandler({ dbPath, outputsDir, awaitBackgroundDownload: true });

    await h({
      provider: 'bytedance',
      jobId,
      payload: {
        request_id: 'fal-req-ERR',
        status: 'ERROR',
        error: 'Invalid status code: 422',
      },
      headers: {},
    });

    const row = getJobRecord({ dbPath, jobId });
    expect(row?.status).toBe('failed');
    expect(row?.actualUsd).toBeNull();
  });

  it('status=ERROR does NOT clobber already-completed row', async () => {
    const jobId = 'job-err-after-complete';
    seedJob(jobId, 'fal-req-LATE');
    const { openDb } = await import('../../../src/core/db.js');
    const db = openDb(dbPath);
    db.prepare("UPDATE video_jobs SET status='completed', actual_usd=1.5 WHERE id=?").run(jobId);

    const h = createBytedanceWebhookHandler({ dbPath, outputsDir, awaitBackgroundDownload: true });
    await h({
      provider: 'bytedance',
      jobId,
      payload: { request_id: 'fal-req-LATE', status: 'ERROR', error: 'late error' },
      headers: {},
    });

    const row = getJobRecord({ dbPath, jobId });
    expect(row?.status).toBe('completed');
    expect(row?.actualUsd).toBe(1.5);
  });

  it('non-terminal status (IN_PROGRESS) + matching request_id → no-op', async () => {
    const jobId = 'job-progress';
    seedJob(jobId, 'fal-req-PROG');
    let fetchCalled = false;
    const trackedFetch = (async () => {
      fetchCalled = true;
      return { ok: true, status: 200, async arrayBuffer() { return new ArrayBuffer(0); } } as Response;
    }) as typeof fetch;

    const h = createBytedanceWebhookHandler({ dbPath, outputsDir, fetchImpl: trackedFetch, awaitBackgroundDownload: true });
    await h({
      provider: 'bytedance',
      jobId,
      payload: { request_id: 'fal-req-PROG', status: 'IN_PROGRESS' },
      headers: {},
    });

    expect(fetchCalled).toBe(false);
    const row = getJobRecord({ dbPath, jobId });
    expect(row?.status).toBe('pending');
  });

  it('status=OK without video.url → log + no-op (pollStatus will resolve)', async () => {
    const jobId = 'job-ok-no-url';
    seedJob(jobId, 'fal-req-NOURL');
    let fetchCalled = false;
    const trackedFetch = (async () => {
      fetchCalled = true;
      return {} as Response;
    }) as typeof fetch;

    const h = createBytedanceWebhookHandler({ dbPath, outputsDir, fetchImpl: trackedFetch, awaitBackgroundDownload: true });
    await h({
      provider: 'bytedance',
      jobId,
      payload: { request_id: 'fal-req-NOURL', status: 'OK', payload: { video: {} } },
      headers: {},
    });

    expect(fetchCalled).toBe(false);
    const row = getJobRecord({ dbPath, jobId });
    expect(row?.status).toBe('pending');
  });

  it('asset download fails (500) → background error logged, ACK still happens', async () => {
    const jobId = 'job-dl-fail';
    seedJob(jobId, 'fal-req-DLFAIL');
    const h = createBytedanceWebhookHandler({
      dbPath,
      outputsDir,
      fetchImpl: fakeFetch(Buffer.from(''), 500),
      awaitBackgroundDownload: true,
    });

    // Background download errors thrown when awaitBackground=true so we can assert.
    await expect(
      h({
        provider: 'bytedance',
        jobId,
        payload: {
          request_id: 'fal-req-DLFAIL',
          status: 'OK',
          payload: { video: { url: 'https://cdn/y.mp4' } },
        },
        headers: {},
      }),
    ).rejects.toThrow(/asset download failed/);

    // BUT status was already persisted before the download attempt.
    const row = getJobRecord({ dbPath, jobId });
    expect(row?.status).toBe('completed');
  });

  it('duplicate delivery is safe — second download overwrites, status idempotent', async () => {
    const jobId = 'job-dup';
    seedJob(jobId, 'fal-req-DUP');
    const videoBytes = Buffer.from('SAME_BYTES');
    const h = createBytedanceWebhookHandler({
      dbPath,
      outputsDir,
      fetchImpl: fakeFetch(videoBytes),
      awaitBackgroundDownload: true,
    });
    const ctx = {
      provider: 'bytedance' as const,
      jobId,
      payload: { request_id: 'fal-req-DUP', status: 'OK', payload: { video: { url: 'https://cdn/v.mp4' } } },
      headers: {},
    };

    await h(ctx);
    await h(ctx);

    const row = getJobRecord({ dbPath, jobId });
    expect(row?.status).toBe('completed');
    expect(statSync(join(outputsDir, `${jobId}.mp4`)).size).toBe(videoBytes.length);
  });

  // --- Codex R20 P2 #1: request_id binding ---
  it('R20 P2 #1: rejects callback whose request_id does NOT match row.native_task_id (cross-account spoofing defense)', async () => {
    const jobId = 'job-spoof';
    seedJob(jobId, 'fal-req-OURS');
    const h = createBytedanceWebhookHandler({ dbPath, outputsDir, awaitBackgroundDownload: true });

    await expect(
      h({
        provider: 'bytedance',
        jobId,
        payload: {
          // Attacker's request_id — ED25519 sig would still verify (shared JWKS)
          // but request_id binding catches it.
          request_id: 'fal-req-ATTACKER',
          status: 'OK',
          payload: { video: { url: 'https://attacker.cdn/evil.mp4' } },
        },
        headers: {},
      }),
    ).rejects.toThrow(/request_id mismatch/);

    // Row state untouched.
    const row = getJobRecord({ dbPath, jobId });
    expect(row?.status).toBe('pending');
    expect(existsSync(join(outputsDir, `${jobId}.mp4`))).toBe(false);
  });

  it('R20 P2 #1: rejects callback with missing request_id (and gateway_request_id)', async () => {
    const jobId = 'job-no-rid';
    seedJob(jobId, 'fal-req-OURS');
    const h = createBytedanceWebhookHandler({ dbPath, outputsDir, awaitBackgroundDownload: true });

    await expect(
      h({
        provider: 'bytedance',
        jobId,
        payload: {
          status: 'OK',
          payload: { video: { url: 'https://x/y.mp4' } },
        },
        headers: {},
      }),
    ).rejects.toThrow(/request_id mismatch/);
  });

  it('R20 P2 #1: rejects callback when row has no native_task_id (legacy pre-R21 row)', async () => {
    const jobId = 'job-legacy';
    // Simulate legacy row: recordJob WITHOUT nativeTaskId.
    recordJob({
      dbPath,
      jobId,
      provider: 'bytedance',
      model: 'seedance-2.0-standard',
      mode: 't2v',
      paramsHash: 'h',
      estUsd: 1.0,
      // nativeTaskId intentionally omitted
    });
    const h = createBytedanceWebhookHandler({ dbPath, outputsDir, awaitBackgroundDownload: true });

    await expect(
      h({
        provider: 'bytedance',
        jobId,
        payload: { request_id: 'whatever', status: 'OK' },
        headers: {},
      }),
    ).rejects.toThrow(/row\.native_task_id missing/);
  });

  it('R20 P2 #1: accepts callback where gateway_request_id matches (fal sends both)', async () => {
    const jobId = 'job-gateway-rid';
    seedJob(jobId, 'fal-req-GATE');
    const h = createBytedanceWebhookHandler({
      dbPath,
      outputsDir,
      fetchImpl: fakeFetch(Buffer.from('OK')),
      awaitBackgroundDownload: true,
    });

    await h({
      provider: 'bytedance',
      jobId,
      // No request_id, only gateway_request_id — handler must fall back to it.
      payload: {
        gateway_request_id: 'fal-req-GATE',
        status: 'OK',
        payload: { video: { url: 'https://cdn/v.mp4' } },
      },
      headers: {},
    });

    expect(getJobRecord({ dbPath, jobId })?.status).toBe('completed');
  });

  it('R22 (CR R21 nuance): accepts when gateway_request_id matches even if request_id is set to a different value', async () => {
    // fal.ai may populate both fields with different semantics (gateway routes
    // through a load balancer that has its own ID, while request_id remains
    // the submitter-facing identifier — or vice versa). Either field proving
    // "we asked for this work" is sufficient binding.
    const jobId = 'job-both-fields';
    seedJob(jobId, 'fal-req-OURS');
    const h = createBytedanceWebhookHandler({
      dbPath,
      outputsDir,
      fetchImpl: fakeFetch(Buffer.from('OK')),
      awaitBackgroundDownload: true,
    });

    await h({
      provider: 'bytedance',
      jobId,
      payload: {
        request_id: 'fal-internal-different-id', // does NOT match
        gateway_request_id: 'fal-req-OURS', // matches → accept
        status: 'OK',
        payload: { video: { url: 'https://cdn/v.mp4' } },
      },
      headers: {},
    });

    expect(getJobRecord({ dbPath, jobId })?.status).toBe('completed');
  });

  it('R22: rejects when NEITHER field matches (still defended)', async () => {
    const jobId = 'job-neither-matches';
    seedJob(jobId, 'fal-req-OURS');
    const h = createBytedanceWebhookHandler({ dbPath, outputsDir, awaitBackgroundDownload: true });

    await expect(
      h({
        provider: 'bytedance',
        jobId,
        payload: {
          request_id: 'attacker-A',
          gateway_request_id: 'attacker-B',
          status: 'OK',
          payload: { video: { url: 'https://evil/x.mp4' } },
        },
        headers: {},
      }),
    ).rejects.toThrow(/request_id mismatch/);

    expect(getJobRecord({ dbPath, jobId })?.status).toBe('pending');
  });

  // --- Codex R20 P2 #2: non-blocking ACK ---
  it('R20 P2 #2: handler returns quickly even when CDN download is slow (fire-and-forget)', async () => {
    const jobId = 'job-slow-cdn';
    seedJob(jobId, 'fal-req-SLOW');
    const h = createBytedanceWebhookHandler({
      dbPath,
      outputsDir,
      fetchImpl: slowFetch(Buffer.from('SLOW'), 500), // 500ms simulated CDN latency
      // awaitBackgroundDownload NOT set → background mode (production behavior)
    });

    const t0 = Date.now();
    await h({
      provider: 'bytedance',
      jobId,
      payload: {
        request_id: 'fal-req-SLOW',
        status: 'OK',
        payload: { video: { url: 'https://slow.cdn/v.mp4' } },
      },
      headers: {},
    });
    const elapsed = Date.now() - t0;

    // Should return well before the 500ms CDN delay (status persist is ~ms).
    expect(elapsed).toBeLessThan(200);

    // Status was persisted synchronously.
    expect(getJobRecord({ dbPath, jobId })?.status).toBe('completed');

    // Wait for background download to finish, verify asset present.
    await new Promise((r) => setTimeout(r, 700));
    expect(existsSync(join(outputsDir, `${jobId}.mp4`))).toBe(true);
  });

  it('R20 P2 #2: background download failure does NOT throw from handler (fire-and-forget)', async () => {
    const jobId = 'job-bg-fail';
    seedJob(jobId, 'fal-req-BG');
    const h = createBytedanceWebhookHandler({
      dbPath,
      outputsDir,
      fetchImpl: fakeFetch(Buffer.from(''), 500),
      // background mode (default)
    });

    // Must NOT throw — error is logged, status already persisted.
    await expect(
      h({
        provider: 'bytedance',
        jobId,
        payload: {
          request_id: 'fal-req-BG',
          status: 'OK',
          payload: { video: { url: 'https://cdn/y.mp4' } },
        },
        headers: {},
      }),
    ).resolves.toBeUndefined();

    expect(getJobRecord({ dbPath, jobId })?.status).toBe('completed');
  });
});
