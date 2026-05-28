import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, closeDb } from '../../../src/core/db.js';
import { getJobRecord } from '../../../src/core/cost-tracker.js';

// Mock @fal-ai/client so unit tests NEVER hit the network.
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

// Mock byteplus-ark for fallback assertions. Preserve the real error classes.
import type * as ByteplusArkModule from '../../../src/video/providers/byteplus-ark.js';
vi.mock('../../../src/video/providers/byteplus-ark.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ByteplusArkModule>();
  return {
    ...actual,
    submitArkTask: vi.fn(),
    pollArkTask: vi.fn(),
    downloadArkAsset: vi.fn(),
  };
});

import { fal } from '@fal-ai/client';
import {
  submitArkTask,
  pollArkTask,
  ArkAuthConfigError,
} from '../../../src/video/providers/byteplus-ark.js';
import {
  BytedanceSeedanceProvider,
  falEndpointFor,
  __resetBytedanceSeedanceSingleton,
  getBytedanceSeedanceProvider,
} from '../../../src/video/providers/bytedance-seedance.js';

// ---------------------------------------------------------------------------
// Per-test fetchImpl factory — never leaks across tests (assigned via opts).
// ---------------------------------------------------------------------------

function makeOkFetch(body: Buffer, contentType = 'video/mp4'): typeof fetch {
  return (async () =>
    ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': contentType }),
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      text: async () => '',
      json: async () => ({}),
    }) as unknown as Response) as typeof fetch;
}

function makeStatusFetch(status: number): typeof fetch {
  return (async () =>
    ({
      ok: false,
      status,
      headers: new Headers(),
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => '',
      json: async () => ({}),
    }) as unknown as Response) as typeof fetch;
}

describe('BytedanceSeedanceProvider', () => {
  let tmpDir: string;
  let dbPath: string;
  let provider: BytedanceSeedanceProvider;

  beforeEach(() => {
    __resetBytedanceSeedanceSingleton();
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-seedance-'));
    dbPath = join(tmpDir, 'cost.db');
    const db = openDb(dbPath);
    runMigrations(db);
    provider = new BytedanceSeedanceProvider({
      dbPath,
      env: {
        FAL_KEY: 'fal_test_xyz',
        BYTEPLUS_ARK_API_KEY: 'ark_test_xyz',
      },
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

  // -------------------------------------------------------------------------
  // Surface: name, models, slug builder
  // -------------------------------------------------------------------------

  it('name = bytedance', () => {
    expect(provider.name).toBe('bytedance');
  });

  it('lists Fast + Standard tiers (no Pro per A0.1)', () => {
    const ids = provider.models.map((m) => m.id).sort();
    expect(ids).toEqual(['seedance-2.0-fast', 'seedance-2.0-standard']);
  });

  it('falEndpointFor — Standard t2v', () => {
    expect(falEndpointFor({ tier: 'standard', mode: 't2v' })).toBe(
      'bytedance/seedance-2.0/text-to-video',
    );
  });

  it('falEndpointFor — Standard i2v', () => {
    expect(falEndpointFor({ tier: 'standard', mode: 'i2v' })).toBe(
      'bytedance/seedance-2.0/image-to-video',
    );
  });

  it('falEndpointFor — Standard with-refs (r2v)', () => {
    expect(falEndpointFor({ tier: 'standard', mode: 'with-refs' })).toBe(
      'bytedance/seedance-2.0/reference-to-video',
    );
  });

  it('falEndpointFor — Fast tier inserts /fast/ BEFORE the mode segment', () => {
    expect(falEndpointFor({ tier: 'fast', mode: 't2v' })).toBe(
      'bytedance/seedance-2.0/fast/text-to-video',
    );
    expect(falEndpointFor({ tier: 'fast', mode: 'i2v' })).toBe(
      'bytedance/seedance-2.0/fast/image-to-video',
    );
    expect(falEndpointFor({ tier: 'fast', mode: 'with-refs' })).toBe(
      'bytedance/seedance-2.0/fast/reference-to-video',
    );
  });

  it('falEndpointFor — multi-shot dispatches to text-to-video endpoint (A0.4)', () => {
    expect(falEndpointFor({ tier: 'standard', mode: 'multi-shot' })).toBe(
      'bytedance/seedance-2.0/text-to-video',
    );
  });

  it('falEndpointFor — targeted-edit dispatches to image-to-video endpoint (A0.4)', () => {
    expect(falEndpointFor({ tier: 'fast', mode: 'targeted-edit' })).toBe(
      'bytedance/seedance-2.0/fast/image-to-video',
    );
  });

  // -------------------------------------------------------------------------
  // estimateCostUSD — per-second per A0.3
  // -------------------------------------------------------------------------

  it('estimateCostUSD — Fast tier: 0.2419 * durationSec', () => {
    const usd = provider.estimateCostUSD({
      modelId: 'seedance-2.0-fast',
      mode: 't2v',
      prompt: 'x',
      durationSec: 5,
      resolution: '720p',
    });
    expect(usd).toBeCloseTo(0.2419 * 5, 4);
  });

  it('estimateCostUSD — Standard tier 1080p = 0.3024 × 2.25 × durationSec (Codex P2 round 15, PR#12)', () => {
    // 1080p multiplier per fal.ai token formula = 2.25 (1920×1080 / 1280×720).
    const usd = provider.estimateCostUSD({
      modelId: 'seedance-2.0-standard',
      mode: 't2v',
      prompt: 'x',
      durationSec: 10,
      resolution: '1080p',
    });
    expect(usd).toBeCloseTo(0.3024 * 2.25 * 10, 4);
  });

  it('estimateCostUSD — Standard tier 720p baseline = 0.3024 × durationSec', () => {
    const usd = provider.estimateCostUSD({
      modelId: 'seedance-2.0-standard',
      mode: 't2v',
      prompt: 'x',
      durationSec: 10,
      resolution: '720p',
    });
    expect(usd).toBeCloseTo(0.3024 * 10, 4);
  });

  it('estimateCostUSD — Standard tier 480p = 0.3024 × 0.4448 × durationSec', () => {
    // 480p multiplier per fal.ai token formula = 0.4448 (854×480 / 1280×720).
    const usd = provider.estimateCostUSD({
      modelId: 'seedance-2.0-standard',
      mode: 't2v',
      prompt: 'x',
      durationSec: 10,
      resolution: '480p',
    });
    expect(usd).toBeCloseTo(0.3024 * 0.4448 * 10, 4);
  });

  it('estimateCostUSD throws on non-bytedance modelId', () => {
    expect(() =>
      provider.estimateCostUSD({
        modelId: 'veo-3.1-generate-preview',
        mode: 't2v',
        prompt: 'x',
        durationSec: 4,
        resolution: '720p',
      }),
    ).toThrow(/not a bytedance/i);
  });

  it('estimateCostUSD throws on unknown model', () => {
    expect(() =>
      provider.estimateCostUSD({
        modelId: 'seedance-fake',
        mode: 't2v',
        prompt: 'x',
        durationSec: 4,
        resolution: '720p',
      }),
    ).toThrow(/unknown model/i);
  });

  // -------------------------------------------------------------------------
  // generate (fal primary) — endpoint wiring + body shape
  // -------------------------------------------------------------------------

  it('generate uses fal slug for Standard t2v and stores request_id', async () => {
    vi.mocked(fal.queue.submit).mockResolvedValue({ request_id: 'fal-req-std' } as never);
    const handle = await provider.generate({
      modelId: 'seedance-2.0-standard',
      mode: 't2v',
      prompt: 'a cat',
      durationSec: 5,
      resolution: '1080p',
    });
    expect(handle.provider).toBe('bytedance');
    expect(handle.providerNativeId).toBe('fal-req-std');
    expect(vi.mocked(fal.queue.submit)).toHaveBeenCalledTimes(1);
    const [endpoint, opts] = vi.mocked(fal.queue.submit).mock.calls[0]! as [
      string,
      Record<string, unknown>,
    ];
    expect(endpoint).toBe('bytedance/seedance-2.0/text-to-video');
    const input = opts.input as Record<string, unknown>;
    expect(input.prompt).toBe('a cat');
    expect(input.resolution).toBe('1080p');
    expect(input.generate_audio).toBe(true);
    // FIX (CodeRabbit round 10, PR#12): fal.ai `DurationEnum` is string-typed
    // ("4", "5", ...). Lock the contract that buildFalInput converts the
    // numeric schema value to its string form before submit. Passing a raw
    // number would let fal.ai silently fall back to "auto".
    expect(input.duration).toBe('5');
    expect(typeof input.duration).toBe('string');
  });

  it('generate omits `duration` from fal payload when extras.durationAutoMode is true (Codex P2 round 13, PR#12)', async () => {
    vi.mocked(fal.queue.submit).mockResolvedValue({ request_id: 'fal-auto-dur' } as never);
    await provider.generate({
      modelId: 'seedance-2.0-standard',
      mode: 't2v',
      prompt: 'auto duration',
      durationSec: 5, // preview value only — buildFalInput must ignore it
      resolution: '720p',
      extras: {
        providerKind: 'bytedance',
        durationAutoMode: true,
      },
    });
    const [, opts] = vi.mocked(fal.queue.submit).mock.calls[0]! as [
      string,
      Record<string, unknown>,
    ];
    const input = opts.input as Record<string, unknown>;
    // fal.ai falls back to its "auto" default when `duration` is absent.
    expect(input.duration).toBeUndefined();
    expect('duration' in input).toBe(false);
  });

  it('generate routes Fast tier through /fast/ slug', async () => {
    vi.mocked(fal.queue.submit).mockResolvedValue({ request_id: 'fal-req-fast' } as never);
    await provider.generate({
      modelId: 'seedance-2.0-fast',
      mode: 't2v',
      prompt: 'x',
      durationSec: 4,
      resolution: '720p',
    });
    const [endpoint] = vi.mocked(fal.queue.submit).mock.calls[0]! as [string];
    expect(endpoint).toBe('bytedance/seedance-2.0/fast/text-to-video');
  });

  it('generate i2v adds image_url to input', async () => {
    vi.mocked(fal.queue.submit).mockResolvedValue({ request_id: 'fal-i2v' } as never);
    await provider.generate({
      modelId: 'seedance-2.0-standard',
      mode: 'i2v',
      prompt: 'animate',
      durationSec: 4,
      resolution: '720p',
      firstFrameImagePath: 'https://cdn.test/first.jpg',
    });
    const [, opts] = vi.mocked(fal.queue.submit).mock.calls[0]! as [string, Record<string, unknown>];
    const input = opts.input as Record<string, unknown>;
    expect(input.image_url).toBe('https://cdn.test/first.jpg');
  });

  it('generate with-refs adds image_urls/video_urls/audio_urls from extras', async () => {
    vi.mocked(fal.queue.submit).mockResolvedValue({ request_id: 'fal-r2v' } as never);
    await provider.generate({
      modelId: 'seedance-2.0-standard',
      mode: 'with-refs',
      prompt: 'fuse refs',
      durationSec: 5,
      resolution: '1080p',
      extras: {
        providerKind: 'bytedance',
        referenceImageUrls: ['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg'],
        referenceVideoUrls: ['https://cdn.test/v.mp4'],
        referenceAudioUrls: ['https://cdn.test/a.wav'],
      },
    });
    const [endpoint, opts] = vi.mocked(fal.queue.submit).mock.calls[0]! as [
      string,
      Record<string, unknown>,
    ];
    expect(endpoint).toBe('bytedance/seedance-2.0/reference-to-video');
    const input = opts.input as Record<string, unknown>;
    expect(input.image_urls).toEqual(['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg']);
    expect(input.video_urls).toEqual(['https://cdn.test/v.mp4']);
    expect(input.audio_urls).toEqual(['https://cdn.test/a.wav']);
  });

  it('generate multi-shot serializes timestamps into prompt + dispatches to t2v', async () => {
    vi.mocked(fal.queue.submit).mockResolvedValue({ request_id: 'fal-ms' } as never);
    await provider.generate({
      modelId: 'seedance-2.0-standard',
      mode: 'multi-shot',
      prompt: 'urban montage',
      durationSec: 10,
      resolution: '1080p',
      extras: {
        providerKind: 'bytedance',
        multiShotTimestamps: [
          { start: 0, end: 5, prompt: 'wide city' },
          { start: 5, end: 10, prompt: 'close window' },
        ],
      },
    });
    const [endpoint, opts] = vi.mocked(fal.queue.submit).mock.calls[0]! as [
      string,
      Record<string, unknown>,
    ];
    expect(endpoint).toBe('bytedance/seedance-2.0/text-to-video');
    const finalPrompt = (opts.input as Record<string, unknown>).prompt as string;
    expect(finalPrompt).toMatch(/\[00:00-00:05\]/);
    expect(finalPrompt).toMatch(/\[00:05-00:10\]/);
    expect(finalPrompt).toContain('wide city');
    expect(finalPrompt).toContain('close window');
  });

  it('generate embeds jobId in webhookUrl path when MEDIA_FORGE_WEBHOOK_PUBLIC_URL is set (A0.7)', async () => {
    // P16.W FASE 3 (PR#12): INSECURE opt-in gate removed. Router supports
    // fal.ai's native ED25519+JWKS signature scheme via registerAuthValidator
    // + auth/fal-ed25519.ts (verified via context7 /websites/fal_ai).
    // Webhook URL is now emitted whenever PUBLIC_URL is set.
    const prov = new BytedanceSeedanceProvider({
      dbPath,
      env: {
        FAL_KEY: 'k',
        BYTEPLUS_ARK_API_KEY: 'a',
        MEDIA_FORGE_WEBHOOK_PUBLIC_URL: 'https://hook.test',
      },
    });
    vi.mocked(fal.queue.submit).mockResolvedValue({ request_id: 'fal-wh' } as never);
    const handle = await prov.generate({
      modelId: 'seedance-2.0-fast',
      mode: 't2v',
      prompt: 'x',
      durationSec: 4,
      resolution: '720p',
    });
    const [, opts] = vi.mocked(fal.queue.submit).mock.calls[0]! as [string, Record<string, unknown>];
    const webhookUrl = opts.webhookUrl as string;
    expect(webhookUrl).toContain('/webhooks/bytedance/');
    expect(webhookUrl).toContain(encodeURIComponent(handle.jobId));
  });

  it('generate omits webhookUrl when MEDIA_FORGE_WEBHOOK_PUBLIC_URL is unset (polling-only fallback)', async () => {
    const prov = new BytedanceSeedanceProvider({
      dbPath,
      env: {
        FAL_KEY: 'k',
        BYTEPLUS_ARK_API_KEY: 'a',
        // PUBLIC_URL not set — no webhook URL emitted, polling-only path
      },
    });
    vi.mocked(fal.queue.submit).mockResolvedValue({ request_id: 'fal-no-wh' } as never);
    await prov.generate({
      modelId: 'seedance-2.0-fast',
      mode: 't2v',
      prompt: 'x',
      durationSec: 4,
      resolution: '720p',
    });
    const [, opts] = vi.mocked(fal.queue.submit).mock.calls[0]! as [string, Record<string, unknown>];
    expect(opts.webhookUrl).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Fallback to ARK on transient fal errors
  // -------------------------------------------------------------------------

  it('generate falls back to BytePlus ARK on fal.ai 503', async () => {
    vi.mocked(fal.queue.submit).mockRejectedValue(
      Object.assign(new Error('upstream timeout'), { status: 503 }),
    );
    vi.mocked(submitArkTask).mockResolvedValue({ taskId: 'ark-fall-1', status: 'queued' });
    const handle = await provider.generate({
      modelId: 'seedance-2.0-standard',
      mode: 't2v',
      prompt: 'fallback',
      durationSec: 5,
      resolution: '1080p',
    });
    expect(submitArkTask).toHaveBeenCalledTimes(1);
    expect(handle.providerNativeId).toBe('ark-fall-1');
  });

  it('generate also falls back on 429 (rate limit)', async () => {
    vi.mocked(fal.queue.submit).mockRejectedValue(
      Object.assign(new Error('rate-limited'), { status: 429 }),
    );
    vi.mocked(submitArkTask).mockResolvedValue({ taskId: 'ark-429', status: 'queued' });
    const handle = await provider.generate({
      modelId: 'seedance-2.0-fast',
      mode: 't2v',
      prompt: 'x',
      durationSec: 4,
      resolution: '720p',
    });
    expect(handle.providerNativeId).toBe('ark-429');
  });

  it('generate does NOT fall back on 4xx other than 408/429', async () => {
    vi.mocked(fal.queue.submit).mockRejectedValue(
      Object.assign(new Error('bad request'), { status: 422 }),
    );
    await expect(
      provider.generate({
        modelId: 'seedance-2.0-standard',
        mode: 't2v',
        prompt: 'x',
        durationSec: 5,
        resolution: '1080p',
      }),
    ).rejects.toThrow(/bad request/);
    expect(submitArkTask).not.toHaveBeenCalled();
  });

  it('generate surfaces a clear error when fal AND ark are both unavailable (no ARK key)', async () => {
    vi.mocked(fal.queue.submit).mockRejectedValue(
      Object.assign(new Error('upstream timeout'), { status: 503 }),
    );
    vi.mocked(submitArkTask).mockRejectedValue(
      new ArkAuthConfigError('BytePlus ARK auth not configured'),
    );
    await expect(
      provider.generate({
        modelId: 'seedance-2.0-fast',
        mode: 't2v',
        prompt: 'x',
        durationSec: 4,
        resolution: '720p',
      }),
    ).rejects.toThrow(/BYTEPLUS_ARK_API_KEY not set/);
  });

  it('generate routes via ARK direct when useArkDirect: true (no fal call)', async () => {
    const arkOnly = new BytedanceSeedanceProvider({
      dbPath,
      env: { FAL_KEY: 'k', BYTEPLUS_ARK_API_KEY: 'a' },
      useArkDirect: true,
    });
    vi.mocked(submitArkTask).mockResolvedValue({ taskId: 'ark-direct-1', status: 'queued' });
    const handle = await arkOnly.generate({
      modelId: 'seedance-2.0-fast',
      mode: 't2v',
      prompt: 'direct',
      durationSec: 4,
      resolution: '720p',
    });
    expect(handle.providerNativeId).toBe('ark-direct-1');
    expect(vi.mocked(fal.queue.submit)).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // pollStatus
  // -------------------------------------------------------------------------

  it('pollStatus (fal path) maps COMPLETED → completed and returns video URL', async () => {
    vi.mocked(fal.queue.submit).mockResolvedValue({ request_id: 'fp-1' } as never);
    vi.mocked(fal.queue.status).mockResolvedValue({ status: 'COMPLETED' } as never);
    vi.mocked(fal.queue.result).mockResolvedValue({
      data: { video: { url: 'https://fal.cdn/v.mp4' } },
    } as never);
    const handle = await provider.generate({
      modelId: 'seedance-2.0-standard',
      mode: 't2v',
      prompt: 'x',
      durationSec: 5,
      resolution: '1080p',
    });
    const status = await provider.pollStatus(handle.jobId);
    expect(status.state).toBe('completed');
    expect(status.assetUrls).toContain('https://fal.cdn/v.mp4');
    expect(status.progress).toBe(1);
  });

  it('pollStatus (fal path) maps IN_PROGRESS → in_progress', async () => {
    vi.mocked(fal.queue.submit).mockResolvedValue({ request_id: 'fp-2' } as never);
    vi.mocked(fal.queue.status).mockResolvedValue({ status: 'IN_PROGRESS' } as never);
    const handle = await provider.generate({
      modelId: 'seedance-2.0-fast',
      mode: 't2v',
      prompt: 'x',
      durationSec: 4,
      resolution: '720p',
    });
    const status = await provider.pollStatus(handle.jobId);
    expect(status.state).toBe('in_progress');
  });

  it('pollStatus (ARK path) maps ARK succeeded → completed with video URL', async () => {
    vi.mocked(fal.queue.submit).mockRejectedValue(
      Object.assign(new Error('upstream'), { status: 502 }),
    );
    vi.mocked(submitArkTask).mockResolvedValue({ taskId: 'ark-poll', status: 'queued' });
    vi.mocked(pollArkTask).mockResolvedValue({
      taskId: 'ark-poll',
      status: 'succeeded',
      videoUrl: 'https://ark.cdn/p.mp4',
    });
    const handle = await provider.generate({
      modelId: 'seedance-2.0-fast',
      mode: 't2v',
      prompt: 'x',
      durationSec: 4,
      resolution: '720p',
    });
    const status = await provider.pollStatus(handle.jobId);
    expect(status.state).toBe('completed');
    expect(status.assetUrls).toContain('https://ark.cdn/p.mp4');
  });

  it('pollStatus on unknown jobId (post-restart) returns state=failed with resubmit guidance', async () => {
    const fresh = new BytedanceSeedanceProvider({
      dbPath,
      env: { FAL_KEY: 'k', BYTEPLUS_ARK_API_KEY: 'a' },
    });
    const status = await fresh.pollStatus('unknown-job-prior-process');
    expect(status.state).toBe('failed');
    expect(status.errorMessage).toMatch(/resubmit/i);
  });

  // -------------------------------------------------------------------------
  // Cost recording: per-tier rate, atomic + idempotent
  // -------------------------------------------------------------------------

  it('pollStatus records per-tier actual_usd on transition to completed (Fast)', async () => {
    vi.mocked(fal.queue.submit).mockResolvedValue({ request_id: 'cost-fast' } as never);
    vi.mocked(fal.queue.status).mockResolvedValue({ status: 'COMPLETED' } as never);
    vi.mocked(fal.queue.result).mockResolvedValue({
      data: { video: { url: 'https://fal.cdn/f.mp4' } },
    } as never);
    const handle = await provider.generate({
      modelId: 'seedance-2.0-fast',
      mode: 't2v',
      prompt: 'x',
      durationSec: 5,
      resolution: '720p',
    });
    await provider.pollStatus(handle.jobId);
    const row = getJobRecord({ dbPath, jobId: handle.jobId });
    expect(row?.actualUsd).toBeCloseTo(0.2419 * 5, 4);
    expect(row?.model).toBe('seedance-2.0-fast');
  });

  it('pollStatus records resolution-aware actual_usd on transition to completed (Standard 1080p)', async () => {
    vi.mocked(fal.queue.submit).mockResolvedValue({ request_id: 'cost-std' } as never);
    vi.mocked(fal.queue.status).mockResolvedValue({ status: 'COMPLETED' } as never);
    vi.mocked(fal.queue.result).mockResolvedValue({
      data: { video: { url: 'https://fal.cdn/s.mp4' } },
    } as never);
    const handle = await provider.generate({
      modelId: 'seedance-2.0-standard',
      mode: 't2v',
      prompt: 'x',
      durationSec: 10,
      resolution: '1080p',
    });
    await provider.pollStatus(handle.jobId);
    const row = getJobRecord({ dbPath, jobId: handle.jobId });
    // FIX (Codex P2 round 15, PR#12): 1080p Standard now records 2.25× the
    // 720p baseline rate per fal.ai token formula.
    expect(row?.actualUsd).toBeCloseTo(0.3024 * 2.25 * 10, 4);
  });

  it('pollStatus persists status="failed" when fal queue returns ERROR (Codex P2 round 16, PR#12)', async () => {
    vi.mocked(fal.queue.submit).mockResolvedValue({ request_id: 'fail-fal' } as never);
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

    const db = openDb(dbPath);
    const row = db
      .prepare("SELECT status, actual_usd, completed_at FROM video_jobs WHERE id = ?")
      .get(handle.jobId) as { status: string; actual_usd: number | null; completed_at: string | null };
    expect(row.status).toBe('failed');
    expect(row.actual_usd).toBe(0);
    expect(row.completed_at).not.toBeNull();
    closeDb(dbPath);
  });

  it('generate does NOT record a job when both fal AND ARK fail (Codex P2 round 15, PR#12)', async () => {
    // Force fal.ai 4xx (non-transient → no ARK fallback).
    vi.mocked(fal.queue.submit).mockRejectedValue(
      Object.assign(new Error('fal 401 unauthorized'), { status: 401 }),
    );
    await expect(
      provider.generate({
        modelId: 'seedance-2.0-standard',
        mode: 't2v',
        prompt: 'fail-path',
        durationSec: 5,
        resolution: '720p',
      }),
    ).rejects.toThrow(/fal 401/);

    const db = openDb(dbPath);
    const row = db.prepare('SELECT COUNT(*) AS n FROM video_jobs').get() as { n: number };
    // Previous behaviour: 1 dangling 'pending' row per failed submit.
    expect(row.n).toBe(0);
    closeDb(dbPath);
  });

  it('pollStatus is idempotent — re-poll after completion does NOT double-bill', async () => {
    vi.mocked(fal.queue.submit).mockResolvedValue({ request_id: 'idem-poll' } as never);
    vi.mocked(fal.queue.status).mockResolvedValue({ status: 'COMPLETED' } as never);
    vi.mocked(fal.queue.result).mockResolvedValue({
      data: { video: { url: 'https://fal.cdn/i.mp4' } },
    } as never);
    const handle = await provider.generate({
      modelId: 'seedance-2.0-fast',
      mode: 't2v',
      prompt: 'x',
      durationSec: 4,
      resolution: '720p',
    });
    await provider.pollStatus(handle.jobId);
    await provider.pollStatus(handle.jobId);
    const row = getJobRecord({ dbPath, jobId: handle.jobId });
    // 0.2419 * 4 = 0.9676 — must NOT be 1.9352 (double) and NOT some other tier.
    expect(row?.actualUsd).toBeCloseTo(0.2419 * 4, 4);
  });

  // -------------------------------------------------------------------------
  // download — happy path + stale-URL refresh
  // -------------------------------------------------------------------------

  it('download fetches a direct URL and returns buffer + metadata', async () => {
    const bytes = Buffer.from('FAKE_MP4');
    const prov = new BytedanceSeedanceProvider({
      dbPath,
      env: { FAL_KEY: 'k', BYTEPLUS_ARK_API_KEY: 'a' },
      fetchImpl: makeOkFetch(bytes, 'video/mp4'),
    });
    const asset = await prov.download('https://fal.cdn/direct.mp4');
    expect(asset.buffer.length).toBe(bytes.length);
    expect(asset.metadata.contentType).toBe('video/mp4');
    expect(asset.metadata.cdnUrl).toBe('https://fal.cdn/direct.mp4');
  });

  it('download throws clearly on non-2xx for direct URL (no jobId to refresh)', async () => {
    const prov = new BytedanceSeedanceProvider({
      dbPath,
      env: { FAL_KEY: 'k', BYTEPLUS_ARK_API_KEY: 'a' },
      fetchImpl: makeStatusFetch(403),
    });
    await expect(prov.download('https://fal.cdn/expired.mp4')).rejects.toThrow(/HTTP 403/);
  });

  it('download retries with a refreshed URL on 403 from a stale CDN URL', async () => {
    vi.mocked(fal.queue.submit).mockResolvedValue({ request_id: 'ttl' } as never);
    vi.mocked(fal.queue.status).mockResolvedValue({ status: 'COMPLETED' } as never);
    vi.mocked(fal.queue.result)
      .mockResolvedValueOnce({ data: { video: { url: 'https://fal.cdn/STALE.mp4' } } } as never)
      .mockResolvedValueOnce({ data: { video: { url: 'https://fal.cdn/FRESH.mp4' } } } as never);

    let calls = 0;
    const fetchSeq: typeof fetch = (async (_url: RequestInfo | URL) => {
      calls++;
      if (calls === 1) {
        // First fetch: STALE → 403
        return {
          ok: false,
          status: 403,
          headers: new Headers(),
          arrayBuffer: async () => new ArrayBuffer(0),
          text: async () => 'expired',
        } as unknown as Response;
      }
      // Second fetch: FRESH → 200 + bytes
      const bytes = Buffer.from('FRESHDATA');
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'video/mp4' }),
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        text: async () => '',
      } as unknown as Response;
    }) as typeof fetch;

    const prov = new BytedanceSeedanceProvider({
      dbPath,
      env: { FAL_KEY: 'k', BYTEPLUS_ARK_API_KEY: 'a' },
      fetchImpl: fetchSeq,
    });

    const handle = await prov.generate({
      modelId: 'seedance-2.0-fast',
      mode: 't2v',
      prompt: 'x',
      durationSec: 4,
      resolution: '720p',
    });
    const asset = await prov.download(handle.jobId);
    expect(asset.metadata.cdnUrl).toBe('https://fal.cdn/FRESH.mp4');
    expect(asset.buffer.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Lazy singleton
  // -------------------------------------------------------------------------

  it('getBytedanceSeedanceProvider returns the same instance across calls', () => {
    const a = getBytedanceSeedanceProvider({
      dbPath,
      env: { FAL_KEY: 'k', BYTEPLUS_ARK_API_KEY: 'a' },
    });
    const b = getBytedanceSeedanceProvider({
      dbPath,
      env: { FAL_KEY: 'k', BYTEPLUS_ARK_API_KEY: 'a' },
    });
    expect(a).toBe(b);
  });

  it('__resetBytedanceSeedanceSingleton creates a fresh instance on the next get', () => {
    const a = getBytedanceSeedanceProvider({
      dbPath,
      env: { FAL_KEY: 'k', BYTEPLUS_ARK_API_KEY: 'a' },
    });
    __resetBytedanceSeedanceSingleton();
    const b = getBytedanceSeedanceProvider({
      dbPath,
      env: { FAL_KEY: 'k', BYTEPLUS_ARK_API_KEY: 'a' },
    });
    expect(a).not.toBe(b);
  });
});
