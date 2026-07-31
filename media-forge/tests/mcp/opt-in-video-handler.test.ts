// tests/mcp/opt-in-video-handler.test.ts
//
// src/mcp/handlers/opt-in-video.ts (MuAPI + Wan2GP MCP entry points) shipped
// with zero test coverage — this file closes that gap.
//
// NEITHER provider can be reached from this repo: MuAPI needs a MUAPI_API_KEY
// this repo does not have, and Wan2GP needs a local GPU server nobody
// installed here. Every test below injects fetchImpl — mirrors the fetch
// routing style already used in tests/video/providers/muapi.test.ts and
// wan2gp.test.ts, and the env save/restore style used in
// tests/mcp/optional-providers-handler.test.ts.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  handleMuapiModels,
  handleMuapiGenerate,
  handleWan2gpGenerate,
} from '../../src/mcp/handlers/opt-in-video.js';
import { WAN2GP_DEFAULT_URL, WAN2GP_RATE_USD } from '../../src/video/providers/wan2gp.js';
import type { MuapiModelEntry } from '../../src/video/providers/muapi.js';
import { ValidationError } from '../../src/core/errors.js';

// ---------------------------------------------------------------------------
// Env management — every var these handlers read, saved and restored around
// each test regardless of which describe block touches them.
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  'MUAPI_API_KEY',
  'MEDIA_FORGE_WAN2GP_ENABLED',
  'MEDIA_FORGE_WAN2GP_URL',
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  // Known-clean slate regardless of the developer's own shell — a stray
  // MUAPI_API_KEY or MEDIA_FORGE_WAN2GP_ENABLED=true would silently flip the
  // "unset" branches below onto the happy path.
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

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

/** Routes fetch calls by exact URL string. An unrecognised URL is a bug in the
 * test's assumption about which endpoints the handler should hit, not
 * something to silently tolerate. */
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
// Catalogue fixtures — the real wire shape per muapi.ts's header comment:
// GET /api/v1/models -> { models: [{ name, cost, cost_currency,
// dynamic_pricing, endpoint, estimate_endpoint }] }
// ---------------------------------------------------------------------------

/** dynamic_pricing:false — the listed cost IS the price MuAPI charges. */
const FIXED_MODEL: MuapiModelEntry = {
  name: 'kling-master',
  cost: 1.5,
  cost_currency: 'USD',
  dynamic_pricing: false,
  endpoint: '/api/v1/kling-master',
  estimate_endpoint: null,
};

/** dynamic_pricing:true — the listed cost is only a floor; the real number
 * comes from estimate_endpoint at request time. */
const DYNAMIC_MODEL: MuapiModelEntry = {
  name: 'veo3-fast',
  cost: 0.8,
  cost_currency: 'USD',
  dynamic_pricing: true,
  endpoint: '/api/v1/veo3-fast',
  estimate_endpoint: '/api/v1/veo3-fast/estimate',
};

function catalogueRoute(models: MuapiModelEntry[] = [FIXED_MODEL, DYNAMIC_MODEL]) {
  return { 'https://api.muapi.ai/api/v1/models': () => jsonResponse({ models }) };
}

function validMuapiGenerateInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    modelName: 'kling-master',
    prompt: 'a quiet lake at sunrise',
    durationSec: 5,
    resolution: '720p',
    ...overrides,
  };
}

function validWan2gpGenerateInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    modelId: 'wan2gp-default',
    prompt: 'a quiet lake at sunrise',
    durationSec: 5,
    resolution: '720p',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// handleMuapiModels
// ---------------------------------------------------------------------------

describe('handleMuapiModels', () => {
  it('maps the live catalogue into { name, costUsd, currency, dynamicPricing, endpoint } and reports count', async () => {
    process.env['MUAPI_API_KEY'] = 'test-key';
    const fetchImpl = routeFetch(catalogueRoute());

    const result = await handleMuapiModels({}, { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.count).toBe(2);
    expect(result.models).toEqual([
      {
        name: 'kling-master',
        costUsd: 1.5,
        currency: 'USD',
        dynamicPricing: false,
        endpoint: '/api/v1/kling-master',
      },
      {
        name: 'veo3-fast',
        costUsd: 0.8,
        currency: 'USD',
        dynamicPricing: true,
        endpoint: '/api/v1/veo3-fast',
      },
    ]);
  });

  it('dynamicPricing:true changes what costUsd MEANS — it is a floor, not the price, unlike a static entry', async () => {
    process.env['MUAPI_API_KEY'] = 'test-key';
    const fetchImpl = routeFetch(catalogueRoute());

    const { models } = await handleMuapiModels({}, { fetchImpl: fetchImpl as unknown as typeof fetch });

    const fixed = models.find((m) => m.name === 'kling-master');
    const dynamic = models.find((m) => m.name === 'veo3-fast');
    expect(fixed?.dynamicPricing).toBe(false);
    expect(dynamic?.dynamicPricing).toBe(true);
    // Both surface a costUsd number, but only on the static entry is it the
    // actual charge — a caller that reads costUsd without checking
    // dynamicPricing would silently treat veo3-fast's floor as its price.
    expect(dynamic?.costUsd).toBe(DYNAMIC_MODEL.cost);
    expect(fixed?.costUsd).toBe(FIXED_MODEL.cost);
  });

  it('refuses with a message naming MUAPI_API_KEY when the key is unset', async () => {
    const fetchImpl = routeFetch(catalogueRoute());

    await expect(
      handleMuapiModels({}, { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/MUAPI_API_KEY/);
    // The key check happens before the network call — no wasted/leaked request.
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleMuapiGenerate
// ---------------------------------------------------------------------------

describe('handleMuapiGenerate', () => {
  it('prices BEFORE submitting, and returns the estimate it got from MuAPI', async () => {
    process.env['MUAPI_API_KEY'] = 'test-key';
    const order: string[] = [];
    const submitUrl = `https://api.muapi.ai${FIXED_MODEL.endpoint}`;
    const fetchImpl = routeFetch({
      'https://api.muapi.ai/api/v1/models': () => {
        order.push('models');
        return jsonResponse({ models: [FIXED_MODEL] });
      },
      [submitUrl]: () => {
        order.push('submit');
        return jsonResponse({ request_id: 'req-abc' }, { headers: { 'X-MuAPI-Cost-USD': '1.5' } });
      },
    });

    const result = await handleMuapiGenerate(validMuapiGenerateInput(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({
      jobId: expect.stringMatching(/^muapi-/),
      provider: 'muapi',
      modelId: 'kling-master',
      estimatedCostUSD: FIXED_MODEL.cost,
    });
    // The catalogue/price lookup must land before the submit POST — a caller
    // relying on the returned estimate to gate spend needs it computed before
    // MuAPI has been asked to actually run the job.
    expect(order).toEqual(['models', 'submit']);
  });

  it('for a dynamic_pricing model, returns the estimate_endpoint figure — NOT the catalogue floor', async () => {
    // The other test above uses FIXED_MODEL, where fetchCostUsd returns
    // entry.cost without any network call — a handler that read the
    // catalogue floor directly instead of calling fetchCostUsd would pass that
    // test too. Only a dynamic_pricing model discriminates "the estimate MuAPI
    // gave" from "the indicative number in the catalogue".
    process.env['MUAPI_API_KEY'] = 'test-key';
    const submitUrl = `https://api.muapi.ai${DYNAMIC_MODEL.endpoint}`;
    const estimateUrl = `https://api.muapi.ai${DYNAMIC_MODEL.estimate_endpoint}`;
    const fetchImpl = routeFetch({
      'https://api.muapi.ai/api/v1/models': () => jsonResponse({ models: [DYNAMIC_MODEL] }),
      [estimateUrl]: () => jsonResponse({ cost: 3.33 }),
      [submitUrl]: () => jsonResponse({ request_id: 'req-dyn' }),
    });

    const result = await handleMuapiGenerate(validMuapiGenerateInput({ modelName: 'veo3-fast' }), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.estimatedCostUSD).toBe(3.33);
    expect(result.estimatedCostUSD).not.toBe(DYNAMIC_MODEL.cost);
  });

  // The estimate the caller is quoted must price the request that was actually
  // submitted. An earlier version built its own { prompt, duration, resolution }
  // while generate() priced with buildMuapiParams(req) — which also carries
  // aspect_ratio and image_url — so on a dynamic_pricing model the caller was
  // quoted the WITHOUT-image price for a request that carried an image. A price
  // for the wrong request is worse than no price: it looks authoritative and it
  // is what the caller budgets against.
  it('prices the request that is actually submitted: both estimate calls carry image_url', async () => {
    process.env['MUAPI_API_KEY'] = 'test-key';
    const submitUrl = `https://api.muapi.ai${DYNAMIC_MODEL.endpoint}`;
    const estimateUrl = `https://api.muapi.ai${DYNAMIC_MODEL.estimate_endpoint}`;
    const estimateBodies: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://api.muapi.ai/api/v1/models') {
        return jsonResponse({ models: [DYNAMIC_MODEL] });
      }
      if (url === estimateUrl) {
        const body = init?.body !== undefined ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
        estimateBodies.push(body);
        // A price that reacts to the image being present, same as a real
        // per-pixel/per-frame aggregator estimate would.
        return jsonResponse({ cost: 'image_url' in body ? 5.0 : 3.33 });
      }
      if (url === submitUrl) return jsonResponse({ request_id: 'req-dyn-i2v' });
      throw new Error(`unexpected fetch to ${url}`);
    });

    const result = await handleMuapiGenerate(
      validMuapiGenerateInput({ modelName: 'veo3-fast', firstFrameImagePath: '/tmp/frame.png' }),
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    // Still two estimate calls — one here for the number the caller sees, one
    // inside generate(). Identical bodies now, so identical answers.
    expect(estimateBodies).toHaveLength(2);
    expect(estimateBodies[0]).toHaveProperty('image_url', '/tmp/frame.png');
    expect(estimateBodies[1]).toEqual(estimateBodies[0]);
    // The WITH-image price, matching the request that was submitted.
    expect(result.estimatedCostUSD).toBe(5.0);
  });

  it('a modelName absent from the live catalogue is rejected, and the error names the model', async () => {
    process.env['MUAPI_API_KEY'] = 'test-key';
    const fetchImpl = routeFetch(catalogueRoute([FIXED_MODEL]));

    await expect(
      handleMuapiGenerate(validMuapiGenerateInput({ modelName: 'not-a-real-model' }), {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/not-a-real-model/);
  });

  it('rejects with MUAPI_API_KEY named when the key is unset', async () => {
    const fetchImpl = routeFetch(catalogueRoute());

    await expect(
      handleMuapiGenerate(validMuapiGenerateInput(), { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/MUAPI_API_KEY/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleWan2gpGenerate
// ---------------------------------------------------------------------------

describe('handleWan2gpGenerate', () => {
  it('with MEDIA_FORGE_WAN2GP_ENABLED unset, throws before any fetch and names the setup command', async () => {
    const fetchImpl = vi.fn();

    await expect(
      handleWan2gpGenerate(validWan2gpGenerateInput(), { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(ValidationError);
    await expect(
      handleWan2gpGenerate(validWan2gpGenerateInput(), { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/media-forge setup wan2gp/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['TRUE', '1', 'yes', ''])(
    'MEDIA_FORGE_WAN2GP_ENABLED=%j (anything but the exact string "true") throws before any fetch',
    async (value) => {
      process.env['MEDIA_FORGE_WAN2GP_ENABLED'] = value;
      const fetchImpl = vi.fn();

      await expect(
        handleWan2gpGenerate(validWan2gpGenerateInput(), {
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }),
      ).rejects.toThrow(/media-forge setup wan2gp/);
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it('with the flag on, submits and returns { jobId, provider, modelId, estimatedCostUSD, baseUrl }, defaulting baseUrl', async () => {
    process.env['MEDIA_FORGE_WAN2GP_ENABLED'] = 'true';
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/predict')) return jsonResponse({ data: ['out.mp4'] });
      return jsonResponse({}); // preflight GET /
    });

    const result = await handleWan2gpGenerate(validWan2gpGenerateInput(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({
      jobId: expect.stringMatching(/^wan2gp-/),
      provider: 'wan2gp',
      modelId: 'wan2gp-default',
      estimatedCostUSD: WAN2GP_RATE_USD,
      baseUrl: WAN2GP_DEFAULT_URL,
    });
    // estimatedCostUSD is 0, but the field is PRESENT rather than omitted — a
    // local render must still surface in the cost record instead of vanishing.
    expect('estimatedCostUSD' in result).toBe(true);
  });

  it('baseUrl reflects MEDIA_FORGE_WAN2GP_URL when set', async () => {
    process.env['MEDIA_FORGE_WAN2GP_ENABLED'] = 'true';
    process.env['MEDIA_FORGE_WAN2GP_URL'] = 'http://192.168.1.50:7861';
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/predict')) return jsonResponse({ data: [] });
      return jsonResponse({});
    });

    const result = await handleWan2gpGenerate(validWan2gpGenerateInput(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.baseUrl).toBe('http://192.168.1.50:7861');
    // Assert on the calls actually made, not just the returned string — every
    // fetch this handler issued must have gone to the overridden host, not the
    // Gradio default.
    for (const [input] of fetchImpl.mock.calls) {
      expect(String(input).startsWith('http://192.168.1.50:7861')).toBe(true);
    }
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Shared: the mode derivation in toRequest (opt-in-video.ts's private helper,
// exercised through both handlers rather than imported — it is not exported).
// ---------------------------------------------------------------------------

describe('toRequest mode derivation', () => {
  it('MuAPI: a request WITH firstFrameImagePath carries image_url through to the submitted body (i2v)', async () => {
    process.env['MUAPI_API_KEY'] = 'test-key';
    const submitUrl = `https://api.muapi.ai${FIXED_MODEL.endpoint}`;
    let submittedBody: Record<string, unknown> = {};
    const fetchImpl = routeFetch({
      'https://api.muapi.ai/api/v1/models': () => jsonResponse({ models: [FIXED_MODEL] }),
      [submitUrl]: () => jsonResponse({ request_id: 'req-i2v' }),
    });
    // Capture the body actually sent, rather than trusting toRequest's source.
    const wrapped = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body !== undefined) submittedBody = JSON.parse(init.body as string);
      return fetchImpl(input);
    });

    await handleMuapiGenerate(
      validMuapiGenerateInput({ firstFrameImagePath: '/tmp/first-frame.png' }),
      { fetchImpl: wrapped as unknown as typeof fetch },
    );

    // firstFrameImagePath present -> toRequest sets mode 'i2v' -> buildMuapiParams
    // maps it to image_url. If this ever came back undefined, the image the
    // caller supplied silently vanished on the way to MuAPI.
    expect(submittedBody['image_url']).toBe('/tmp/first-frame.png');
  });

  it('MuAPI: a request WITHOUT firstFrameImagePath has no image_url in the submitted body (t2v)', async () => {
    process.env['MUAPI_API_KEY'] = 'test-key';
    const submitUrl = `https://api.muapi.ai${FIXED_MODEL.endpoint}`;
    let submittedBody: Record<string, unknown> = {};
    const fetchImpl = routeFetch({
      'https://api.muapi.ai/api/v1/models': () => jsonResponse({ models: [FIXED_MODEL] }),
      [submitUrl]: () => jsonResponse({ request_id: 'req-t2v' }),
    });
    const wrapped = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body !== undefined) submittedBody = JSON.parse(init.body as string);
      return fetchImpl(input);
    });

    await handleMuapiGenerate(validMuapiGenerateInput(), {
      fetchImpl: wrapped as unknown as typeof fetch,
    });

    expect(submittedBody).not.toHaveProperty('image_url');
  });

  // buildGradioPayload sends a POSITIONAL array — [prompt, duration, resolution,
  // aspectRatio] — with no image slot, and the right index depends on whichever
  // Gradio app the operator runs. So an i2v request used to reach the server
  // looking exactly like a t2v one, and come back without the reference, with
  // nothing reported.
  //
  // Refused at the handler instead. The contract asserted here is that NOTHING
  // is submitted: a loud refusal beats a silent downgrade, and this handler is
  // the first production caller of Wan2GP, so the drop was unreachable before
  // rather than tolerated.
  it('refuses firstFrameImagePath instead of silently dropping it, and submits nothing', async () => {
    process.env['MEDIA_FORGE_WAN2GP_ENABLED'] = 'true';
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [] }));

    await expect(
      handleWan2gpGenerate(validWan2gpGenerateInput({ firstFrameImagePath: '/tmp/first-frame.png' }), {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/image-to-video is not wired/);

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
