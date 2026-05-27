import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HiggsfieldProvider } from '../../../src/video/providers/higgsfield.js';
import { findRequestIdByJobId, clearRequestMapCache } from '../../../src/core/provider-request-map.js';
import { closeDb } from '../../../src/core/db.js';

const ORIG_FETCH = global.fetch;

describe('HiggsfieldProvider', () => {
  let tmpDir: string;
  let dbPath: string;
  let provider: HiggsfieldProvider;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-hf-'));
    dbPath = join(tmpDir, 'cost.db');
    clearRequestMapCache();
    process.env['HF_API_KEY'] = 'pk_test';
    process.env['HF_API_SECRET'] = 'sk_test';
    process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = '0.039';
    provider = new HiggsfieldProvider({
      dbPath,
      publicWebhookBaseUrl: 'https://app.example.com',
    });
  });

  afterEach(() => {
    global.fetch = ORIG_FETCH;
    // Close the SQLite handle before rmSync — better-sqlite3 / node:sqlite hold
    // the file open on Windows, causing EPERM on tempdir removal otherwise.
    closeDb(dbPath);
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* tempdir may already be gone on a retry; ignore Windows EPERM stragglers */
    }
    delete process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
    delete process.env['MEDIA_FORGE_HF_AUTH_FALLBACK_USED'];
    delete process.env['MEDIA_FORGE_HF_WEBHOOK_ENABLE'];
  });

  it('reports name = higgsfield', () => {
    expect(provider.name).toBe('higgsfield');
  });

  it('lists all 10 Higgsfield models from VIDEO_MODELS', () => {
    const ids = provider.models.map((m) => m.id).sort();
    expect(ids).toEqual(
      [
        'higgsfield-cinema-studio-3.5',
        'higgsfield-dop',
        'higgsfield-dop-turbo',
        'higgsfield-marketing-studio',
        'higgsfield-recast',
        'higgsfield-soul-pro',
        'higgsfield-soul-standard',
        'higgsfield-soul2',
        'higgsfield-speak',
        'higgsfield-speak2',
      ].sort(),
    );
  });

  it('estimateCostUSD multiplies credits by usdPerCredit (0.039 Plus plan)', () => {
    // Soul standard: 25 credits * 0.039 USD = 0.975
    const usd = provider.estimateCostUSD({
      modelId: 'higgsfield-soul-standard',
      mode: 't2v',
      prompt: 'a city at night',
      durationSec: 8,
      resolution: '720p',
    });
    expect(usd).toBeCloseTo(0.975, 3);
  });

  it('estimateCostUSD scales by model — Cinema Studio costs more than Soul standard', () => {
    const soul = provider.estimateCostUSD({
      modelId: 'higgsfield-soul-standard',
      mode: 't2v',
      prompt: 'x',
      durationSec: 8,
      resolution: '720p',
    });
    const cinema = provider.estimateCostUSD({
      modelId: 'higgsfield-cinema-studio-3.5',
      mode: 't2v',
      prompt: 'x',
      durationSec: 8,
      resolution: '720p',
    });
    expect(cinema).toBeGreaterThan(soul);
  });

  it('estimateCostUSD throws on unknown model', () => {
    expect(() =>
      provider.estimateCostUSD({
        modelId: 'mystery',
        mode: 't2v',
        prompt: 'x',
        durationSec: 4,
        resolution: '720p',
      }),
    ).toThrow(/unknown model/i);
  });

  it('estimateCostUSD throws when MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT is unset and no override given', () => {
    delete process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
    expect(() =>
      provider.estimateCostUSD({
        modelId: 'higgsfield-soul-standard',
        mode: 't2v',
        prompt: 'x',
        durationSec: 8,
        resolution: '720p',
      }),
    ).toThrow(/usdPerCredit/i);
  });

  it('generate POSTs the Soul endpoint with HF auth headers + webhook URL', async () => {
    // D-2: webhook injection is off by default in P14. Enable it for this specific test
    // so the original assertion (hf_webhook= in URL) remains meaningful.
    process.env['MEDIA_FORGE_HF_WEBHOOK_ENABLE'] = 'true';
    const captured: { url: string; init: RequestInit }[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url: String(input), init: init ?? {} });
      return new Response(
        JSON.stringify({
          request_id: 'req-soul-1',
          status_url: 'https://platform.higgsfield.ai/requests/req-soul-1/status',
          cancel_url: 'https://platform.higgsfield.ai/requests/req-soul-1/cancel',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const handle = await provider.generate({
      modelId: 'higgsfield-soul-standard',
      mode: 't2v',
      prompt: 'a quiet lake at sunrise',
      durationSec: 8,
      resolution: '720p',
      aspectRatio: '16:9',
    });

    expect(handle.provider).toBe('higgsfield');
    expect(handle.model).toBe('higgsfield-soul-standard');
    expect(handle.jobId).toMatch(/^hf-/);
    expect(handle.providerNativeId).toBe('req-soul-1');

    expect(captured).toHaveLength(1);
    const { url, init } = captured[0]!;
    expect(url).toContain('https://platform.higgsfield.ai/higgsfield-ai/soul/standard');
    expect(url).toContain('hf_webhook=https%3A%2F%2Fapp.example.com%2Fwebhooks%2Fhiggsfield%2F');
    const headers = (init.headers ?? {}) as Record<string, string>;
    // SDK-format headers, per shipped buildHiggsfieldHeaders (Task 1 may switch to Authorization).
    expect(headers['hf-api-key'] ?? headers['Authorization']).toBeDefined();
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['prompt']).toBe('a quiet lake at sunrise');
    expect(body['aspect_ratio']).toBe('16:9');
    expect(body['resolution']).toBe('720p');

    // Reconciliation map persists request_id → jobId
    expect(findRequestIdByJobId({ dbPath, jobId: handle.jobId })).toBe('req-soul-1');
  });

  it('generate routes DoP requests to /higgsfield-ai/dop/standard and includes camera verbs in prompt', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url: String(input), init: init ?? {} });
      return new Response(
        JSON.stringify({
          request_id: 'req-dop',
          status_url: 'https://platform.higgsfield.ai/requests/req-dop/status',
          cancel_url: 'https://platform.higgsfield.ai/requests/req-dop/cancel',
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await provider.generate({
      modelId: 'higgsfield-dop',
      mode: 'i2v',
      prompt: 'a desert canyon at golden hour',
      durationSec: 6,
      resolution: '1080p',
      firstFrameImagePath: '/tmp/canyon.png',
      extras: { providerKind: 'higgsfield', dopCameraVerbs: ['dolly_in', 'crash_zoom'] },
    });

    const { url, init } = captured[0]!;
    expect(url).toContain('/higgsfield-ai/dop/standard');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(String(body['prompt'])).toMatch(/dolly_in/);
    expect(String(body['prompt'])).toMatch(/crash_zoom/);
  });

  it('generate routes DoP turbo to /higgsfield-ai/dop/turbo', async () => {
    const captured: { url: string }[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      captured.push({ url: String(input) });
      return new Response(JSON.stringify({ request_id: 'r', status_url: 'u', cancel_url: 'c' }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    await provider.generate({
      modelId: 'higgsfield-dop-turbo',
      mode: 'i2v',
      prompt: 'x',
      durationSec: 4,
      resolution: '720p',
      firstFrameImagePath: '/tmp/x.png',
    });

    expect(captured[0]!.url).toContain('/higgsfield-ai/dop/turbo');
  });

  it('generate routes Speak lipsync to /higgsfield-ai/speak/standard with audio reference', async () => {
    let captured!: RequestInit;
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = init ?? {};
      return new Response(JSON.stringify({ request_id: 'r', status_url: 'u', cancel_url: 'c' }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    await provider.generate({
      modelId: 'higgsfield-speak',
      mode: 'lip-sync',
      prompt: 'a confident newsreader delivers the headline',
      durationSec: 15,
      resolution: '720p',
      firstFrameImagePath: '/tmp/face.png',
      extras: { providerKind: 'higgsfield', speakAudioPath: '/tmp/voice.wav' },
    });

    const body = JSON.parse(captured.body as string) as Record<string, unknown>;
    expect(body['audio_url'] ?? body['audio_path']).toBe('/tmp/voice.wav');
  });

  it('generate routes Marketing Studio with template + product URL', async () => {
    let captured!: RequestInit;
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = init ?? {};
      return new Response(JSON.stringify({ request_id: 'r', status_url: 'u', cancel_url: 'c' }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    await provider.generate({
      modelId: 'higgsfield-marketing-studio',
      mode: 't2v',
      prompt: 'product reveal',
      durationSec: 15,
      resolution: '1080p',
      extras: {
        providerKind: 'higgsfield',
        marketingStudioTemplate: 'unboxing',
        marketingStudioProductUrl: 'https://shop.example/p/42',
      },
    });

    const body = JSON.parse(captured.body as string) as Record<string, unknown>;
    expect(body['template']).toBe('unboxing');
    expect(body['product_url']).toBe('https://shop.example/p/42');
  });

  it('generate routes Cinema Studio with full lens dictionary', async () => {
    let captured!: RequestInit;
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = init ?? {};
      return new Response(JSON.stringify({ request_id: 'r', status_url: 'u', cancel_url: 'c' }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    await provider.generate({
      modelId: 'higgsfield-cinema-studio-3.5',
      mode: 'i2v',
      prompt: 'noir alley',
      durationSec: 8,
      resolution: '1080p',
      firstFrameImagePath: '/tmp/alley.png',
      extras: {
        providerKind: 'higgsfield',
        cinemaStudioParams: {
          focalLengthMm: 35,
          apertureFStop: 1.8,
          sensorSize: 'super35',
          colorGrading: 'noir',
          lensId: 'arri-master-prime-35mm',
        },
      },
    });

    const body = JSON.parse(captured.body as string) as Record<string, unknown>;
    expect(body['focal_length_mm']).toBe(35);
    expect(body['aperture_fstop']).toBe(1.8);
    expect(body['sensor_size']).toBe('super35');
    expect(body['color_grading']).toBe('noir');
    expect(body['lens_id']).toBe('arri-master-prime-35mm');
  });

  it('generate routes Recast with target character path', async () => {
    let captured!: RequestInit;
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = init ?? {};
      return new Response(JSON.stringify({ request_id: 'r', status_url: 'u', cancel_url: 'c' }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    await provider.generate({
      modelId: 'higgsfield-recast',
      mode: 'targeted-edit',
      prompt: 'swap the protagonist',
      durationSec: 10,
      resolution: '720p',
      extras: { providerKind: 'higgsfield', recastTargetCharacterPath: '/tmp/newchar.png' },
    });

    const body = JSON.parse(captured.body as string) as Record<string, unknown>;
    expect(body['target_character_url'] ?? body['target_character']).toBe('/tmp/newchar.png');
  });

  it('generate retries once with fallback headers on 401 and sets MEDIA_FORGE_HF_AUTH_FALLBACK_USED', async () => {
    // Deviation Rule 2: D-5 auth resilience is critical functionality but the
    // plan's test block omitted coverage. Add a test that exercises the 401
    // retry path + the operator-signal env var.
    const calls: RequestInit[] = [];
    let n = 0;
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ?? {});
      n++;
      if (n === 1) return new Response('nope', { status: 401 });
      return new Response(
        JSON.stringify({ request_id: 'r-retry', status_url: 'u', cancel_url: 'c' }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    delete process.env['MEDIA_FORGE_HF_AUTH_FALLBACK_USED'];

    const handle = await provider.generate({
      modelId: 'higgsfield-soul-standard',
      mode: 't2v',
      prompt: 'x',
      durationSec: 8,
      resolution: '720p',
    });

    expect(calls).toHaveLength(2);
    expect(process.env['MEDIA_FORGE_HF_AUTH_FALLBACK_USED']).toBe('true');
    expect(handle.providerNativeId).toBe('r-retry');
  });

  it('pollStatus GETs the platform job endpoint and returns JobStatus', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('/requests/req-xyz/status');
      return new Response(
        JSON.stringify({
          status: 'completed',
          request_id: 'req-xyz',
          video: { url: 'https://cdn.higgsfield.ai/foo.mp4' },
          progress: 1,
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    // Pre-populate map so the provider can find the request_id from jobId.
    const { recordRequestMapping } = await import('../../../src/core/provider-request-map.js');
    recordRequestMapping({
      dbPath,
      jobId: 'hf-poll-1',
      provider: 'higgsfield',
      providerRequestId: 'req-xyz',
    });

    const status = await provider.pollStatus('hf-poll-1');
    expect(status.state).toBe('completed');
    expect(status.assetUrls).toEqual(['https://cdn.higgsfield.ai/foo.mp4']);
  });

  it('pollStatus maps Higgsfield "nsfw" status to internal "nsfw" state', async () => {
    global.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ status: 'nsfw', request_id: 'req-nsfw', error: 'content rejected' }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const { recordRequestMapping } = await import('../../../src/core/provider-request-map.js');
    recordRequestMapping({
      dbPath,
      jobId: 'hf-nsfw',
      provider: 'higgsfield',
      providerRequestId: 'req-nsfw',
    });

    const status = await provider.pollStatus('hf-nsfw');
    expect(status.state).toBe('nsfw');
    expect(status.errorMessage).toBe('content rejected');
  });

  it('download fetches the CDN URL and returns DownloadedAsset with metadata', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://cdn.higgsfield.ai/asset.mp4');
      const buf = Buffer.from('FAKEMP4DATA');
      return new Response(buf, {
        status: 200,
        headers: { 'content-type': 'video/mp4', 'content-length': String(buf.length) },
      });
    }) as unknown as typeof fetch;

    const asset = await provider.download('https://cdn.higgsfield.ai/asset.mp4');
    expect(asset.buffer.toString()).toBe('FAKEMP4DATA');
    expect(asset.metadata.contentType).toBe('video/mp4');
    expect(asset.metadata.sizeBytes).toBe(11);
    expect(asset.metadata.cdnUrl).toBe('https://cdn.higgsfield.ai/asset.mp4');
  });

  it('recordActualCostUSD persists the cost to the video_jobs row', async () => {
    // First generate to insert a row
    global.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ request_id: 'r-cost', status_url: 'u', cancel_url: 'c' }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const handle = await provider.generate({
      modelId: 'higgsfield-soul-standard',
      mode: 't2v',
      prompt: 'x',
      durationSec: 8,
      resolution: '720p',
    });
    await provider.recordActualCostUSD(handle.jobId, 0.85);

    // Query SQLite directly to confirm
    const { openDb, runMigrations } = await import('../../../src/core/db.js');
    const db = openDb(dbPath);
    runMigrations(db);
    const row = db
      .prepare(`SELECT actual_usd, status FROM video_jobs WHERE id = ?`)
      .get(handle.jobId) as { actual_usd: number; status: string };
    expect(row.actual_usd).toBe(0.85);
    expect(row.status).toBe('completed');
  });
});
