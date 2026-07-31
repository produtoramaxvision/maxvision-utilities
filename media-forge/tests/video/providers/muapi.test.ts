// tests/video/providers/muapi.test.ts
// PR7 — MuapiProvider (src/video/providers/muapi.ts).
//
// Every test injects a fake fetchImpl. NOTHING here may reach the real
// api.muapi.ai — that would hit a live account and spend real money on every
// test run. See the header comment in muapi.ts for why this adapter is worth
// having (it settles on MuAPI's OWN reported charge) and why it deliberately
// carries no local price table (it is an aggregator reselling Kling/Veo/etc
// under its own markup).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  MuapiProvider,
  readCostHeader,
  mapMuapiStatus,
  buildMuapiParams,
  type MuapiModelEntry,
} from '../../../src/video/providers/muapi.js';
import { PROVIDERS, VIDEO_MODELS } from '../../../src/core/models.js';
import { ValidationError } from '../../../src/core/errors.js';
import type { VideoGenerationRequest, VideoLedgerHooks } from '../../../src/video/providers/base.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** dynamic_pricing:false — the listed `cost` IS the charge, no estimate call needed. */
const FIXED_MODEL: MuapiModelEntry = {
  name: 'kling-master',
  cost: 1.5,
  cost_currency: 'USD',
  dynamic_pricing: false,
  endpoint: '/api/v1/kling-master',
  estimate_endpoint: null,
};

/** dynamic_pricing:true — the listed `cost` is only indicative; must call estimate_endpoint. */
const DYNAMIC_MODEL: MuapiModelEntry = {
  name: 'veo3-fast',
  cost: 0.8,
  cost_currency: 'USD',
  dynamic_pricing: true,
  endpoint: '/api/v1/veo3-fast',
  estimate_endpoint: '/api/v1/veo3-fast/estimate',
};

/** Priced in a non-USD currency — everything downstream of this adapter assumes USD. */
const EUR_MODEL: MuapiModelEntry = {
  name: 'eur-model',
  cost: 2,
  cost_currency: 'EUR',
  dynamic_pricing: false,
  endpoint: '/api/v1/eur-model',
  estimate_endpoint: null,
};

function baseReq(overrides: Partial<VideoGenerationRequest> = {}): VideoGenerationRequest {
  return {
    modelId: FIXED_MODEL.name,
    mode: 't2v',
    prompt: 'a quiet lake at sunrise',
    durationSec: 5,
    resolution: '720p',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fetch fakes — never touch the network.
// ---------------------------------------------------------------------------

function jsonResponse(
  body: unknown,
  opts: { ok?: boolean; status?: number; headers?: Record<string, string> } = {},
): Response {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    headers: new Headers(opts.headers ?? {}),
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

function bufferResponse(bytes: Uint8Array, headers: Record<string, string> = {}): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(headers),
    arrayBuffer: async () => bytes.buffer,
    json: async () => ({}),
    text: async () => '',
  } as unknown as Response;
}

/** Routes fetch calls by exact URL string. Throws on any URL not registered — an
 * unexpected call is a bug in the test's assumptions about which endpoints the
 * adapter should hit, not something to silently tolerate. */
function routeFetch(routes: Record<string, () => Response | Promise<Response>>) {
  return vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    const handler = routes[url];
    if (handler === undefined) {
      throw new Error(`unexpected fetch to ${url}`);
    }
    return handler();
  });
}

// ---------------------------------------------------------------------------
// Env management — MUAPI_API_KEY set by default; the resolveApiKey describe
// block below overrides it to absent for its own tests.
// ---------------------------------------------------------------------------

let prevMuapiKey: string | undefined;

beforeEach(() => {
  prevMuapiKey = process.env['MUAPI_API_KEY'];
  process.env['MUAPI_API_KEY'] = 'test-key';
});

afterEach(() => {
  if (prevMuapiKey === undefined) delete process.env['MUAPI_API_KEY'];
  else process.env['MUAPI_API_KEY'] = prevMuapiKey;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Auth header shape
// ---------------------------------------------------------------------------

describe('MuapiProvider — auth header shape', () => {
  it('every request carries x-api-key, and NEVER an Authorization: Bearer header', async () => {
    // MuAPI rejects Bearer outright (docs: x-api-key, not Bearer) — sending one
    // would fail every single call this adapter makes.
    const fetchImpl = routeFetch({
      'https://api.muapi.ai/api/v1/models': () => jsonResponse({ models: [FIXED_MODEL] }),
    });
    const provider = new MuapiProvider({ fetchImpl });

    await provider.fetchCatalogue();

    const call = fetchImpl.mock.calls[0];
    expect(call).toBeDefined();
    const init = call?.[1];
    const headers = init?.headers as Record<string, string> | undefined;

    expect(headers?.['x-api-key']).toBe('test-key');
    const headerKeys = Object.keys(headers ?? {}).map((k) => k.toLowerCase());
    expect(headerKeys).not.toContain('authorization');
    expect(JSON.stringify(headers ?? {})).not.toMatch(/Bearer/);
  });
});

// ---------------------------------------------------------------------------
// 2. resolveApiKey
// ---------------------------------------------------------------------------

describe('resolveApiKey (exercised via fetchCatalogue)', () => {
  beforeEach(() => {
    delete process.env['MUAPI_API_KEY'];
  });

  it('throws an actionable ValidationError when MUAPI_API_KEY is absent and no explicit key was passed', async () => {
    const fetchImpl = routeFetch({
      'https://api.muapi.ai/api/v1/models': () => jsonResponse({ models: [] }),
    });
    const provider = new MuapiProvider({ fetchImpl });

    await expect(provider.fetchCatalogue()).rejects.toThrow(ValidationError);
    await expect(provider.fetchCatalogue()).rejects.toThrow(/MUAPI_API_KEY/);
    // The key check happens before the network call — no wasted/leaked request.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('an explicit apiKey option satisfies auth even with no env var set', async () => {
    const fetchImpl = routeFetch({
      'https://api.muapi.ai/api/v1/models': () => jsonResponse({ models: [] }),
    });
    const provider = new MuapiProvider({ fetchImpl, apiKey: 'explicit-key' });

    await expect(provider.fetchCatalogue()).resolves.toBeInstanceOf(Map);
    const init = fetchImpl.mock.calls[0]?.[1];
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.['x-api-key']).toBe('explicit-key');
  });
});

// ---------------------------------------------------------------------------
// 3. fetchCatalogue
// ---------------------------------------------------------------------------

describe('fetchCatalogue', () => {
  it('parses the models array into a name-keyed map', async () => {
    const fetchImpl = routeFetch({
      'https://api.muapi.ai/api/v1/models': () => jsonResponse({ models: [FIXED_MODEL, DYNAMIC_MODEL] }),
    });
    const provider = new MuapiProvider({ fetchImpl });

    const catalogue = await provider.fetchCatalogue();

    expect(catalogue.get('kling-master')).toEqual(FIXED_MODEL);
    expect(catalogue.get('veo3-fast')).toEqual(DYNAMIC_MODEL);
    expect(catalogue.size).toBe(2);
  });

  it('caches the catalogue — a second call issues NO second fetch', async () => {
    const fetchImpl = routeFetch({
      'https://api.muapi.ai/api/v1/models': () => jsonResponse({ models: [FIXED_MODEL] }),
    });
    const provider = new MuapiProvider({ fetchImpl });

    await provider.fetchCatalogue();
    await provider.fetchCatalogue();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('throws on a non-2xx catalogue response', async () => {
    const fetchImpl = routeFetch({
      'https://api.muapi.ai/api/v1/models': () => jsonResponse({}, { ok: false, status: 503 }),
    });
    const provider = new MuapiProvider({ fetchImpl });

    await expect(provider.fetchCatalogue()).rejects.toThrow(/HTTP 503/);
  });
});

// ---------------------------------------------------------------------------
// 4. fetchCostUsd — the discriminating group
// ---------------------------------------------------------------------------

describe('fetchCostUsd', () => {
  it('a dynamic_pricing:false model returns the listed cost and does NOT call an estimate endpoint', async () => {
    const fetchImpl = routeFetch({
      'https://api.muapi.ai/api/v1/models': () => jsonResponse({ models: [FIXED_MODEL] }),
    });
    const provider = new MuapiProvider({ fetchImpl });

    const usd = await provider.fetchCostUsd('kling-master', { prompt: 'x' });

    expect(usd).toBe(FIXED_MODEL.cost);
    // Only the catalogue fetch happened — no second call to any estimate URL.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('a dynamic_pricing:true model calls its estimate_endpoint and returns THAT cost, not the indicative catalogue figure', async () => {
    const fetchImpl = routeFetch({
      'https://api.muapi.ai/api/v1/models': () => jsonResponse({ models: [DYNAMIC_MODEL] }),
      'https://api.muapi.ai/api/v1/veo3-fast/estimate': () => jsonResponse({ cost: 3.33 }),
    });
    const provider = new MuapiProvider({ fetchImpl });

    const usd = await provider.fetchCostUsd('veo3-fast', { durationSec: 10 });

    // Using the indicative catalogue figure (0.8) here would under-report the
    // estimate handed to the cost guard — the direction that lets spend through
    // a cap rather than wrongly blocking it.
    expect(usd).toBe(3.33);
    expect(usd).not.toBe(DYNAMIC_MODEL.cost);

    const estimateCall = fetchImpl.mock.calls.find(
      ([input]) => String(input) === 'https://api.muapi.ai/api/v1/veo3-fast/estimate',
    );
    expect(estimateCall).toBeDefined();
  });

  it('a model absent from the catalogue throws — this adapter keeps no local price table to fall back to', async () => {
    const fetchImpl = routeFetch({
      'https://api.muapi.ai/api/v1/models': () => jsonResponse({ models: [FIXED_MODEL] }),
    });
    const provider = new MuapiProvider({ fetchImpl });

    await expect(provider.fetchCostUsd('not-in-catalogue', {})).rejects.toThrow(ValidationError);
  });

  it('cost_currency EUR throws rather than being treated as USD', async () => {
    const fetchImpl = routeFetch({
      'https://api.muapi.ai/api/v1/models': () => jsonResponse({ models: [EUR_MODEL] }),
    });
    const provider = new MuapiProvider({ fetchImpl });

    // Silently treating EUR as USD would misprice by the FX rate — everything
    // downstream (guard, ledger, daily cap) assumes USD.
    await expect(provider.fetchCostUsd('eur-model', {})).rejects.toThrow(/EUR/);
  });

  // The estimate is a SEPARATE response from the catalogue entry, and it is the
  // one that decides what gets billed. Assuming it inherits the catalogue's
  // currency is how a non-USD figure reaches a USD ledger.
  // Shape verified against muapi.ai/docs/pricing on 2026-07-31:
  // { model, cost, currency, dynamic_pricing, cost_strategy }.
  it('an estimate quoted in a non-USD currency throws, naming the currency', async () => {
    const fetchImpl = routeFetch({
      'https://api.muapi.ai/api/v1/models': () => jsonResponse({ models: [DYNAMIC_MODEL] }),
      'https://api.muapi.ai/api/v1/veo3-fast/estimate': () =>
        jsonResponse({ model: 'veo3-fast', cost: 0.64, currency: 'EUR', dynamic_pricing: true }),
    });
    const provider = new MuapiProvider({ fetchImpl });
    await expect(provider.fetchCostUsd('veo3-fast', {})).rejects.toThrow(/EUR/);
  });

  it('an estimate in the documented shape returns its `cost`', async () => {
    const fetchImpl = routeFetch({
      'https://api.muapi.ai/api/v1/models': () => jsonResponse({ models: [DYNAMIC_MODEL] }),
      'https://api.muapi.ai/api/v1/veo3-fast/estimate': () =>
        jsonResponse({
          model: 'veo3-fast',
          cost: 0.64,
          currency: 'USD',
          dynamic_pricing: true,
          cost_strategy: 'veo3-fast-t2v',
        }),
    });
    const provider = new MuapiProvider({ fetchImpl });
    await expect(provider.fetchCostUsd('veo3-fast', {})).resolves.toBe(0.64);
  });

  it('an estimate endpoint returning no usable cost throws', async () => {
    const fetchImpl = routeFetch({
      'https://api.muapi.ai/api/v1/models': () => jsonResponse({ models: [DYNAMIC_MODEL] }),
      'https://api.muapi.ai/api/v1/veo3-fast/estimate': () => jsonResponse({ notCost: 'nope' }),
    });
    const provider = new MuapiProvider({ fetchImpl });

    await expect(provider.fetchCostUsd('veo3-fast', {})).rejects.toThrow(/no usable `cost`/);
  });
});

// ---------------------------------------------------------------------------
// 5. Aggregator invariant — MuAPI carries no local pricing anywhere in core/models.ts
// ---------------------------------------------------------------------------

describe('aggregator invariant', () => {
  it('VIDEO_MODELS has no muapi entry — pricing a MuAPI job from direct-vendor rates would under-report spend by the resale markup', () => {
    const muapiEntries = Object.values(VIDEO_MODELS).filter((m) => m.provider === 'muapi');
    expect(muapiEntries).toHaveLength(0);
  });

  it('PROVIDERS still lists muapi as a registered provider', () => {
    expect(PROVIDERS).toContain('muapi');
  });
});

// ---------------------------------------------------------------------------
// 6. Ledger hooks (A5 asymmetric contract)
// ---------------------------------------------------------------------------

describe('MuapiProvider ledger hooks (A5 contract)', () => {
  const submitUrl = `https://api.muapi.ai${FIXED_MODEL.endpoint}`;

  it('success: beforeSubmit runs BEFORE the submit fetch, and onSubmitFailed is never called', async () => {
    const order: string[] = [];
    const fetchImpl = routeFetch({
      'https://api.muapi.ai/api/v1/models': () => jsonResponse({ models: [FIXED_MODEL] }),
      [submitUrl]: () => {
        order.push('submit');
        return jsonResponse({ request_id: 'req-123' });
      },
    });
    const provider = new MuapiProvider({ fetchImpl });
    const beforeSubmit = vi.fn(async () => {
      order.push('reserve');
    });
    const onSubmitFailed = vi.fn(async () => {
      order.push('release');
    });
    const onPostSubmitError = vi.fn();

    const handle = await provider.generate(baseReq(), { beforeSubmit, onSubmitFailed, onPostSubmitError });

    expect(handle.providerNativeId).toBe('req-123');
    expect(order).toEqual(['reserve', 'submit']);
    expect(onSubmitFailed).not.toHaveBeenCalled();
  });

  it('submit fetch rejects: onSubmitFailed is called and the error propagates', async () => {
    const rejectErr = new Error('network blew up');
    const fetchImpl = routeFetch({
      'https://api.muapi.ai/api/v1/models': () => jsonResponse({ models: [FIXED_MODEL] }),
      [submitUrl]: () => {
        throw rejectErr;
      },
    });
    const provider = new MuapiProvider({ fetchImpl });
    const hooks: VideoLedgerHooks = {
      beforeSubmit: vi.fn(async () => {}),
      onSubmitFailed: vi.fn(async () => {}),
      onPostSubmitError: vi.fn(),
    };

    await expect(provider.generate(baseReq(), hooks)).rejects.toThrow(/network blew up/);
    expect(hooks.onSubmitFailed).toHaveBeenCalledTimes(1);
    expect(hooks.onPostSubmitError).not.toHaveBeenCalled();
  });

  it('submit returns non-2xx: onSubmitFailed is called', async () => {
    const fetchImpl = routeFetch({
      'https://api.muapi.ai/api/v1/models': () => jsonResponse({ models: [FIXED_MODEL] }),
      [submitUrl]: () => jsonResponse({}, { ok: false, status: 500 }),
    });
    const provider = new MuapiProvider({ fetchImpl });
    const hooks: VideoLedgerHooks = {
      beforeSubmit: vi.fn(async () => {}),
      onSubmitFailed: vi.fn(async () => {}),
      onPostSubmitError: vi.fn(),
    };

    await expect(provider.generate(baseReq(), hooks)).rejects.toThrow(/HTTP 500/);
    expect(hooks.onSubmitFailed).toHaveBeenCalledTimes(1);
    expect(hooks.onPostSubmitError).not.toHaveBeenCalled();
  });

  it('submit returns 2xx but no request_id: onPostSubmitError is called and onSubmitFailed is NOT', async () => {
    // MuAPI accepted the job (HTTP 2xx) and is very likely already billing it.
    // Releasing the reservation here would let a running generation complete
    // for free — the expensive mistake this asymmetry guards against.
    const fetchImpl = routeFetch({
      'https://api.muapi.ai/api/v1/models': () => jsonResponse({ models: [FIXED_MODEL] }),
      [submitUrl]: () => jsonResponse({ no_id_here: true }),
    });
    const provider = new MuapiProvider({ fetchImpl });
    const hooks: VideoLedgerHooks = {
      beforeSubmit: vi.fn(async () => {}),
      onSubmitFailed: vi.fn(async () => {}),
      onPostSubmitError: vi.fn(),
    };

    await expect(provider.generate(baseReq(), hooks)).rejects.toThrow(/no request_id/);
    expect(hooks.onPostSubmitError).toHaveBeenCalledTimes(1);
    expect(hooks.onSubmitFailed).not.toHaveBeenCalled();
  });

  it('beforeSubmit throwing blocks the submit — the submit fetch must never be invoked', async () => {
    const fetchImpl = routeFetch({
      'https://api.muapi.ai/api/v1/models': () => jsonResponse({ models: [FIXED_MODEL] }),
      [submitUrl]: () => {
        throw new Error('SUBMIT MUST NOT HAVE BEEN CALLED');
      },
    });
    const provider = new MuapiProvider({ fetchImpl });
    const hooks: VideoLedgerHooks = {
      beforeSubmit: vi.fn(async () => {
        throw new Error('InsufficientCreditError: balance too low');
      }),
      onSubmitFailed: vi.fn(),
      onPostSubmitError: vi.fn(),
    };

    await expect(provider.generate(baseReq(), hooks)).rejects.toThrow(/InsufficientCreditError/);

    const submitCalls = fetchImpl.mock.calls.filter(([input]) => String(input) === submitUrl);
    expect(submitCalls).toHaveLength(0);
    expect(hooks.onSubmitFailed).not.toHaveBeenCalled();
    expect(hooks.onPostSubmitError).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 7. readCostHeader
// ---------------------------------------------------------------------------

describe('readCostHeader', () => {
  it('parses X-MuAPI-Cost-USD', () => {
    const response = { headers: new Headers({ 'X-MuAPI-Cost-USD': '4.2' }) };
    expect(readCostHeader(response)).toBe(4.2);
  });

  it('returns undefined (NOT 0) when the header is missing', () => {
    const response = { headers: new Headers() };
    expect(readCostHeader(response)).toBeUndefined();
  });

  it('a "0" header returns the number 0 — distinct from undefined', () => {
    // 0 is a valid charge. Conflating "free" with "unknown" would settle a real
    // cost at zero and quietly under-count the daily cap.
    const response = { headers: new Headers({ 'X-MuAPI-Cost-USD': '0' }) };
    const result = readCostHeader(response);
    expect(result).toBe(0);
    expect(result).not.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 8. mapMuapiStatus
// ---------------------------------------------------------------------------

describe('mapMuapiStatus', () => {
  it.each([
    ['queued', 'pending'],
    ['processing', 'in_progress'],
    ['completed', 'completed'],
    ['failed', 'failed'],
  ])('maps MuAPI status %s -> %s', (status, expected) => {
    expect(mapMuapiStatus(status)).toBe(expected);
  });

  it('maps an UNKNOWN status to in_progress, not failed — abandoning a running, billing job is the expensive mistake', () => {
    expect(mapMuapiStatus('some_brand_new_status_this_build_has_never_seen')).toBe('in_progress');
    expect(mapMuapiStatus(undefined)).toBe('in_progress');
  });
});

// ---------------------------------------------------------------------------
// 9. pollStatus
// ---------------------------------------------------------------------------

describe('MuapiProvider.pollStatus()', () => {
  it('non-2xx returns state failed with an errorMessage, rather than throwing', async () => {
    const fetchImpl = routeFetch({
      'https://api.muapi.ai/api/v1/predictions/req-1/result': () => jsonResponse({}, { ok: false, status: 502 }),
    });
    const provider = new MuapiProvider({ fetchImpl });

    const status = await provider.pollStatus('req-1');

    expect(status.state).toBe('failed');
    expect(status.errorMessage).toMatch(/HTTP 502/);
  });

  it('a completed response surfaces outputs as assetUrls', async () => {
    const fetchImpl = routeFetch({
      'https://api.muapi.ai/api/v1/predictions/req-1/result': () =>
        jsonResponse({ status: 'completed', outputs: ['https://cdn.muapi.ai/out.mp4'] }),
    });
    const provider = new MuapiProvider({ fetchImpl });

    const status = await provider.pollStatus('req-1');

    expect(status.state).toBe('completed');
    expect(status.assetUrls).toEqual(['https://cdn.muapi.ai/out.mp4']);
  });
});

// ---------------------------------------------------------------------------
// 10. buildMuapiParams
// ---------------------------------------------------------------------------

describe('buildMuapiParams', () => {
  it('prompt is always present', () => {
    const params = buildMuapiParams(baseReq());
    expect(params['prompt']).toBe('a quiet lake at sunrise');
  });

  it('omits duration/aspect_ratio when not meaningfully set', () => {
    const params = buildMuapiParams(baseReq({ durationSec: 0, aspectRatio: undefined }));
    expect(params).not.toHaveProperty('duration');
    expect(params).not.toHaveProperty('aspect_ratio');
    // resolution is a required (non-optional) field on VideoGenerationRequest, so
    // an "absent resolution" branch is unreachable and deliberately not asserted
    // here — mirrors the same caveat in higgsfield-cli.test.ts.
  });

  it('includes duration/resolution/aspect_ratio when set', () => {
    const params = buildMuapiParams(baseReq({ durationSec: 5, resolution: '1080p', aspectRatio: '16:9' }));
    expect(params['duration']).toBe(5);
    expect(params['resolution']).toBe('1080p');
    expect(params['aspect_ratio']).toBe('16:9');
  });

  it('maps firstFrameImagePath to image_url', () => {
    const params = buildMuapiParams(baseReq({ firstFrameImagePath: '/tmp/first.png' }));
    expect(params['image_url']).toBe('/tmp/first.png');
  });

  it('omits image_url when firstFrameImagePath is absent', () => {
    const params = buildMuapiParams(baseReq());
    expect(params).not.toHaveProperty('image_url');
  });
});

// ---------------------------------------------------------------------------
// 11. download
// ---------------------------------------------------------------------------

describe('MuapiProvider.download()', () => {
  it('throws when the job has no outputs', async () => {
    const fetchImpl = routeFetch({
      'https://api.muapi.ai/api/v1/predictions/req-1/result': () =>
        jsonResponse({ status: 'processing', outputs: [] }),
    });
    const provider = new MuapiProvider({ fetchImpl });

    await expect(provider.download('req-1')).rejects.toThrow(/no downloadable output/);
  });

  it('a successful fetch returns buffer + contentType + cdnUrl', async () => {
    const cdnUrl = 'https://cdn.muapi.ai/out.mp4';
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchImpl = routeFetch({
      'https://api.muapi.ai/api/v1/predictions/req-1/result': () =>
        jsonResponse({ status: 'completed', outputs: [cdnUrl] }),
      [cdnUrl]: () => bufferResponse(bytes, { 'content-type': 'video/mp4' }),
    });
    const provider = new MuapiProvider({ fetchImpl });

    const asset = await provider.download('req-1');

    expect(Buffer.from(asset.buffer)).toEqual(Buffer.from(bytes));
    expect(asset.metadata.contentType).toBe('video/mp4');
    expect(asset.metadata.cdnUrl).toBe(cdnUrl);
  });
});
