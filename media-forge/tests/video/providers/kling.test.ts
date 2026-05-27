import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KlingProvider } from '../../../src/video/providers/kling.js';
import { __resetKlingJwtCache } from '../../../src/video/providers/auth/kling-jwt.js';
import { closeDb } from '../../../src/core/db.js';

describe('KlingProvider', () => {
  let tmpDir: string;
  let dbPath: string;
  let provider: KlingProvider;
  const env = {
    KLING_ACCESS_KEY: 'ak_test',
    KLING_SECRET_KEY: 'sk_test',
  } as const;

  beforeEach(() => {
    __resetKlingJwtCache();
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-kling-test-'));
    dbPath = join(tmpDir, 'cost.db');
    provider = new KlingProvider({ dbPath, env, fetchImpl: vi.fn() });
  });

  afterEach(() => {
    // Close the SQLite handle before rmSync — better-sqlite3 / node:sqlite hold
    // the file open on Windows, causing EPERM on tempdir removal otherwise.
    try {
      closeDb(dbPath);
    } catch {
      /* ignore — handle may have been closed already */
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* tempdir may already be gone on a retry; ignore Windows EPERM stragglers */
    }
    vi.restoreAllMocks();
  });

  it('reports name = kling', () => {
    expect(provider.name).toBe('kling');
  });

  it('lists all 4 Kling models registered in P15 Task 2', () => {
    const ids = provider.models.map((m) => m.id).sort();
    expect(ids).toEqual([
      'kling-v3-master',
      'kling-v3-omni',
      'kling-v3-pro',
      'kling-v3-standard',
    ]);
  });

  it('estimateCostUSD(v3-standard, 5s) = 0.126 * 5 = 0.63', () => {
    const usd = provider.estimateCostUSD({
      modelId: 'kling-v3-standard',
      mode: 't2v',
      prompt: 'test',
      durationSec: 5,
      resolution: '720p',
    });
    expect(usd).toBeCloseTo(0.63, 4);
  });

  it('estimateCostUSD(v3-pro, 10s) = 0.168 * 10 = 1.68', () => {
    const usd = provider.estimateCostUSD({
      modelId: 'kling-v3-pro',
      mode: 't2v',
      prompt: 'test',
      durationSec: 10,
      resolution: '1080p',
    });
    expect(usd).toBeCloseTo(1.68, 4);
  });

  it('estimateCostUSD throws on unknown model', () => {
    expect(() =>
      provider.estimateCostUSD({
        modelId: 'kling-fake',
        mode: 't2v',
        prompt: 'x',
        durationSec: 5,
        resolution: '720p',
      }),
    ).toThrow(/unknown model/i);
  });

  it('estimateCostUSD throws when given a non-kling model id', () => {
    expect(() =>
      provider.estimateCostUSD({
        modelId: 'veo-3.1-generate-preview',
        mode: 't2v',
        prompt: 'x',
        durationSec: 5,
        resolution: '720p',
      }),
    ).toThrow(/not a kling provider model/i);
  });

  it('generate(t2v) POSTs to /v1/videos/text2video with Bearer JWT + correct body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { task_id: 'kling-task-123' } }),
    });
    const p = new KlingProvider({ dbPath, env, fetchImpl });
    const handle = await p.generate({
      modelId: 'kling-v3-standard',
      mode: 't2v',
      prompt: 'a peaceful lake at dawn',
      durationSec: 5,
      resolution: '720p',
      aspectRatio: '16:9',
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api-singapore.klingai.com/v1/videos/text2video');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toMatch(/^Bearer /);
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body as string);
    expect(body.model_name).toBe('kling-v3');
    expect(body.prompt).toBe('a peaceful lake at dawn');
    expect(body.duration).toBe('5');
    expect(body.mode).toBe('std');
    expect(body.aspect_ratio).toBe('16:9');
    expect(handle.provider).toBe('kling');
    expect(handle.providerNativeId).toBe('kling-task-123');
    expect(handle.model).toBe('kling-v3-standard');
  });

  it('generate(i2v) POSTs to /v1/videos/image2video with image_url field', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { task_id: 'kling-i2v-1' } }),
    });
    const p = new KlingProvider({ dbPath, env, fetchImpl });
    await p.generate({
      modelId: 'kling-v3-pro',
      mode: 'i2v',
      prompt: 'pan left to reveal',
      durationSec: 5,
      resolution: '1080p',
      firstFrameImagePath: 'https://example/start.png',
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api-singapore.klingai.com/v1/videos/image2video');
    const body = JSON.parse(init.body as string);
    expect(body.image_url).toBe('https://example/start.png');
    expect(body.mode).toBe('pro');
  });

  it('generate(multi-shot Omni) POSTs to /v1/videos/omni-video/ with multi_prompt array', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { task_id: 'kling-omni-1' } }),
    });
    const p = new KlingProvider({ dbPath, env, fetchImpl });
    await p.generate({
      modelId: 'kling-v3-omni',
      mode: 'multi-shot',
      prompt: 'multi-shot sequence',
      durationSec: 10,
      resolution: '1080p',
      extras: {
        providerKind: 'kling',
        omniMultiShot: {
          multiPrompt: [
            { index: 0, prompt: 'wide shot', duration: 5 },
            { index: 1, prompt: 'close-up', duration: 5 },
          ],
          imageList: [{ imageUrl: 'https://example/ref.png' }],
        },
      },
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api-singapore.klingai.com/v1/videos/omni-video/');
    const body = JSON.parse(init.body as string);
    expect(body.model_name).toBe('kling-v3-omni');
    expect(body.multi_shot).toBe(true);
    expect(body.shot_type).toBe('customize');
    expect(body.multi_prompt).toHaveLength(2);
    expect(body.multi_prompt[0]).toEqual({ index: 0, prompt: 'wide shot', duration: 5 });
    expect(body.image_list).toEqual([{ image_url: 'https://example/ref.png' }]);
  });

  it('generate sets watermark_info.enabled=false by default on paid keys', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { task_id: 'kling-wm-1' } }),
    });
    const p = new KlingProvider({ dbPath, env, fetchImpl });
    await p.generate({
      modelId: 'kling-v3-pro',
      mode: 't2v',
      prompt: 'x',
      durationSec: 5,
      resolution: '1080p',
    });
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.watermark_info).toEqual({ enabled: false });
  });

  it('generate honors explicit watermark opt-in but logs a warning', async () => {
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { task_id: 'kling-wm-on' } }),
    });
    const p = new KlingProvider({ dbPath, env, fetchImpl });
    await p.generate({
      modelId: 'kling-v3-pro',
      mode: 't2v',
      prompt: 'x',
      durationSec: 5,
      resolution: '1080p',
      extras: { providerKind: 'kling', watermarkEnabled: true },
    });
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.watermark_info).toEqual({ enabled: true });
    expect(warnSpy).toHaveBeenCalled();
    expect((warnSpy.mock.calls[0][0] as string).toLowerCase()).toContain('watermark');
  });

  it('watermark dual-path: PAID key with watermark_info.enabled=false succeeds (no watermark on output)', async () => {
    // Paid-key happy path: explicit opt-out, Kling returns clean asset
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { task_id: 'kling-paid-clean' } }),
    });
    const p = new KlingProvider({ dbPath, env: { ...env, KLING_TIER: 'paid' } as never, fetchImpl });
    const handle = await p.generate({
      modelId: 'kling-v3-pro',
      mode: 't2v',
      prompt: 'paid no-watermark test',
      durationSec: 5,
      resolution: '1080p',
      extras: { providerKind: 'kling', watermarkEnabled: false },
    });
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.watermark_info).toEqual({ enabled: false });
    expect(handle.providerNativeId).toBe('kling-paid-clean');
  });

  it('watermark dual-path: FREE key with watermark_info.enabled=false either succeeds-with-watermark OR rejects with free-tier error (graceful fallback documented in SKILL.md)', async () => {
    // Free-key path: Kling may return success (silent watermark fallback) OR 4xx (hard reject).
    // Test both behaviors are handled without retry-loop.

    // Case A: silent fallback - asset returned, watermark is forced server-side
    const fetchImplSuccess = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { task_id: 'kling-free-silent', tier: 'free' } }),
    });
    const pA = new KlingProvider({
      dbPath,
      env: { ...env, KLING_TIER: 'free' } as never,
      fetchImpl: fetchImplSuccess,
    });
    const handleA = await pA.generate({
      modelId: 'kling-v3-standard',
      mode: 't2v',
      prompt: 'free silent fallback test',
      durationSec: 5,
      resolution: '720p',
      extras: { providerKind: 'kling', watermarkEnabled: false },
    });
    expect(handleA.providerNativeId).toBe('kling-free-silent');
    // No retry - single call, no loop
    expect(fetchImplSuccess).toHaveBeenCalledOnce();

    // Case B: hard rejection - Kling returns 403 with free-tier policy error
    const fetchImplReject = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        code: 2003,
        message: 'free-tier watermark cannot be disabled - upgrade to paid',
      }),
      text: async () => '{"code":2003,"message":"free-tier watermark cannot be disabled"}',
    });
    const pB = new KlingProvider({
      dbPath,
      env: { ...env, KLING_TIER: 'free' } as never,
      fetchImpl: fetchImplReject,
    });
    await expect(
      pB.generate({
        modelId: 'kling-v3-standard',
        mode: 't2v',
        prompt: 'free hard reject test',
        durationSec: 5,
        resolution: '720p',
        extras: { providerKind: 'kling', watermarkEnabled: false },
      }),
    ).rejects.toThrow(/2003|free-tier|watermark/i);
    // Verify NO retry-with-watermark-on happened - single failed call, surface error to caller
    expect(fetchImplReject).toHaveBeenCalledOnce();
  });

  it('generate populates callback_url from webhook router base URL when INSECURE flag set', async () => {
    // PR#11 Codex P1 fix: media-forge webhook router rejects POSTs without
    // HMAC headers — Kling can't sign them. callback_url suppressed by default;
    // opt-in via MEDIA_FORGE_KLING_WEBHOOK_INSECURE=true for diagnostic logging.
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { task_id: 'kling-cb-1' } }),
    });
    const p = new KlingProvider({
      dbPath,
      env: {
        ...env,
        MEDIA_FORGE_WEBHOOK_PUBLIC_URL: 'https://media.example.com',
        MEDIA_FORGE_KLING_WEBHOOK_INSECURE: 'true',
      },
      fetchImpl,
    });
    const handle = await p.generate({
      modelId: 'kling-v3-standard',
      mode: 't2v',
      prompt: 'x',
      durationSec: 5,
      resolution: '720p',
    });
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.callback_url).toBe(`https://media.example.com/webhooks/kling/${handle.jobId}`);
    expect(body.external_task_id).toBe(handle.jobId);
  });

  it('generate omits callback_url by default even when MEDIA_FORGE_WEBHOOK_PUBLIC_URL is set (PR#11 P1)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { task_id: 'kling-no-cb' } }),
    });
    const p = new KlingProvider({
      dbPath,
      env: { ...env, MEDIA_FORGE_WEBHOOK_PUBLIC_URL: 'https://media.example.com' },
      // INSECURE flag NOT set
      fetchImpl,
    });
    await p.generate({
      modelId: 'kling-v3-standard',
      mode: 't2v',
      prompt: 'x',
      durationSec: 5,
      resolution: '720p',
    });
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.callback_url).toBeUndefined();
  });

  it('generate throws clear error on Kling 4xx with code+message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ code: 1001, message: 'invalid access key' }),
      text: async () => '{"code":1001,"message":"invalid access key"}',
    });
    const p = new KlingProvider({ dbPath, env, fetchImpl });
    await expect(
      p.generate({
        modelId: 'kling-v3-standard',
        mode: 't2v',
        prompt: 'x',
        durationSec: 5,
        resolution: '720p',
      }),
    ).rejects.toThrow(/kling api.*1001.*invalid access key/i);
  });

  it('pollStatus(t2v) GETs /v1/videos/text2video/{task_id} and maps state', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        data: {
          task_id: 'kling-poll-1',
          task_status: 'succeed',
          task_result: { videos: [{ id: 'v1', url: 'https://cdn/x.mp4', duration: '5' }] },
        },
      }),
    });
    const p = new KlingProvider({ dbPath, env, fetchImpl });
    // Seed the type lookup table so pollStatus knows this jobId was a t2v call
    p._rememberJobType('internal-job-1', 'text2video', 'kling-poll-1');
    const status = await p.pollStatus('internal-job-1');
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api-singapore.klingai.com/v1/videos/text2video/kling-poll-1');
    expect(status.state).toBe('completed');
    expect(status.assetUrls).toEqual(['https://cdn/x.mp4']);
  });

  it('pollStatus maps Kling failed → JobState failed and surfaces error message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        data: { task_id: 'kling-fail', task_status: 'failed', task_status_msg: 'NSFW content' },
      }),
    });
    const p = new KlingProvider({ dbPath, env, fetchImpl });
    p._rememberJobType('internal-fail', 'text2video', 'kling-fail');
    const status = await p.pollStatus('internal-fail');
    expect(status.state).toBe('failed');
    expect(status.errorMessage).toMatch(/nsfw/i);
  });

  // -------------------------------------------------------------------------
  // hydrateFromDb — Codex P1 round 6, PR#11
  // Default MCP Kling flow suppresses callback URLs (HMAC mismatch). The
  // throwaway KlingProvider built by handleKlingPoll/Download has no
  // in-memory jobTypeMap entry for jobs submitted by a prior process.
  // hydrateFromDb fills the gap from cost-tracker DB so pollStatus / download
  // can drive a job to completion manually.
  // -------------------------------------------------------------------------
  it('hydrateFromDb seeds jobTypeMap from native_task_id + mode then pollStatus works', async () => {
    const { openDb, runMigrations } = await import('../../../src/core/db.js');
    const { recordJob } = await import('../../../src/core/cost-tracker.js');
    const db = openDb(dbPath);
    runMigrations(db);
    recordJob({
      dbPath,
      jobId: 'internal-rehydrated',
      provider: 'kling',
      model: 'kling-v3-standard',
      mode: 'i2v', // ensures derived endpointKind = image2video, not text2video
      paramsHash: 'h-rehyd',
      estUsd: 0.3,
      nativeTaskId: 'kling-native-rehyd',
    });

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        data: {
          task_id: 'kling-native-rehyd',
          task_status: 'succeed',
          task_result: { videos: [{ id: 'v1', url: 'https://cdn/rehyd.mp4', duration: '5' }] },
        },
      }),
    });
    const p = new KlingProvider({ dbPath, env, fetchImpl });
    p.hydrateFromDb('internal-rehydrated');
    const status = await p.pollStatus('internal-rehydrated');
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api-singapore.klingai.com/v1/videos/image2video/kling-native-rehyd');
    expect(status.state).toBe('completed');
  });

  it('hydrateFromDb throws when jobId missing or native_task_id unset', async () => {
    const p = new KlingProvider({ dbPath, env, fetchImpl: vi.fn() });
    expect(() => p.hydrateFromDb('does-not-exist')).toThrow(/missing from video_jobs|native_task_id/i);
  });
});
