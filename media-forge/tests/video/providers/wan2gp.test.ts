// tests/video/providers/wan2gp.test.ts
// T16 — Wan2gpProvider (src/video/providers/wan2gp.ts).
//
// Every test injects a fake fetchImpl. NOTHING here may reach a real Gradio
// server — this provider is a local-inference adapter with no fixed endpoint,
// and a real network call here would just hang or 404 in CI. See the header
// comment in wan2gp.ts for the two things this file exists to prove:
//   1. default-off + an actionable preflight message (opt-in contract), and
//   2. zero cost does not mean zero bookkeeping (ledger hooks still fire).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  Wan2gpProvider,
  isWan2gpEnabled,
  wan2gpBaseUrl,
  buildGradioPayload,
  checkWan2gpRequirements,
  WAN2GP_DEFAULT_URL,
  WAN2GP_MIN_VRAM_GB,
  WAN2GP_MIN_DISK_GB,
  WAN2GP_MAX_DISK_GB,
  WAN2GP_RATE_USD,
} from '../../../src/video/providers/wan2gp.js';
import { PROVIDERS, VIDEO_MODELS } from '../../../src/core/models.js';
import { ValidationError, ApiError } from '../../../src/core/errors.js';
import type { VideoGenerationRequest, VideoLedgerHooks } from '../../../src/video/providers/base.js';

function baseReq(overrides: Partial<VideoGenerationRequest> = {}): VideoGenerationRequest {
  return {
    modelId: 'wan2gp-default',
    mode: 't2v',
    prompt: 'a quiet lake at sunrise',
    durationSec: 5,
    resolution: '720p',
    ...overrides,
  };
}

function okResponse(body: unknown = {}): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

function statusResponse(status: number): Response {
  return {
    ok: false,
    status,
    headers: new Headers(),
    json: async () => ({}),
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// 1. isWan2gpEnabled — default-off is the explicit user constraint. Only the
//    exact string 'true' may flip it; anything else (including truthy-looking
//    values like '1' or 'yes') must stay disabled so an operator can't
//    accidentally enable a local server via a loosely-typed env value.
// ---------------------------------------------------------------------------
describe('isWan2gpEnabled', () => {
  it("'true' enables", () => {
    expect(isWan2gpEnabled({ MEDIA_FORGE_WAN2GP_ENABLED: 'true' })).toBe(true);
  });

  it.each(['TRUE', '1', 'yes', ''])('%s does NOT enable (only exact "true" does)', (value) => {
    expect(isWan2gpEnabled({ MEDIA_FORGE_WAN2GP_ENABLED: value })).toBe(false);
  });

  it('unset (no key at all) is disabled', () => {
    expect(isWan2gpEnabled({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. wan2gpBaseUrl
// ---------------------------------------------------------------------------
describe('wan2gpBaseUrl', () => {
  it('defaults to WAN2GP_DEFAULT_URL when no override is set', () => {
    expect(wan2gpBaseUrl({})).toBe(WAN2GP_DEFAULT_URL);
  });

  it('MEDIA_FORGE_WAN2GP_URL overrides the default', () => {
    expect(wan2gpBaseUrl({ MEDIA_FORGE_WAN2GP_URL: 'http://10.0.0.5:9999' })).toBe(
      'http://10.0.0.5:9999',
    );
  });
});

// ---------------------------------------------------------------------------
// 3-6. preflight() — reads the REAL isWan2gpEnabled()/process.env internally
// (no env param on preflight), so these tests toggle and restore the actual
// process.env var rather than injecting one.
// ---------------------------------------------------------------------------
describe('Wan2gpProvider.preflight()', () => {
  const ENV_KEY = 'MEDIA_FORGE_WAN2GP_ENABLED';
  let prevEnabled: string | undefined;

  beforeEach(() => {
    prevEnabled = process.env[ENV_KEY];
  });

  afterEach(() => {
    if (prevEnabled === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = prevEnabled;
    vi.restoreAllMocks();
  });

  it('disabled: throws ValidationError naming MEDIA_FORGE_WAN2GP_ENABLED and stating the plugin does not install it', async () => {
    delete process.env[ENV_KEY];
    // fetchImpl would throw if ever called — proves preflight fails BEFORE any
    // network attempt when the opt-in flag is off.
    const fetchImpl = vi.fn(async () => {
      throw new Error('must not be called while disabled');
    });
    const provider = new Wan2gpProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(provider.preflight()).rejects.toThrow(ValidationError);
    await expect(provider.preflight()).rejects.toThrow(/MEDIA_FORGE_WAN2GP_ENABLED/);
    // "never installs it for you" is the user-facing contract of the whole task.
    await expect(provider.preflight()).rejects.toThrow(/never installs/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('enabled but nothing answers: throws naming the URL and MEDIA_FORGE_WAN2GP_URL', async () => {
    process.env[ENV_KEY] = 'true';
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const provider = new Wan2gpProvider({
      baseUrl: 'http://127.0.0.1:9876',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(provider.preflight()).rejects.toThrow(ApiError);
    await expect(provider.preflight()).rejects.toThrow(/http:\/\/127\.0\.0\.1:9876/);
    await expect(provider.preflight()).rejects.toThrow(/MEDIA_FORGE_WAN2GP_URL/);
  });

  it('enabled, server answers non-2xx: throws a DIFFERENT message questioning whether it is really Gradio', async () => {
    process.env[ENV_KEY] = 'true';
    const fetchImpl = vi.fn(async () => statusResponse(503));
    const provider = new Wan2gpProvider({
      baseUrl: 'http://127.0.0.1:9876',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    let unreachableMessage = '';
    let non2xxMessage = '';
    // Capture the "nothing answers" message from a sibling provider for comparison.
    const unreachableProvider = new Wan2gpProvider({
      baseUrl: 'http://127.0.0.1:9876',
      fetchImpl: (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch,
    });
    try {
      await unreachableProvider.preflight();
    } catch (err) {
      unreachableMessage = (err as Error).message;
    }
    try {
      await provider.preflight();
    } catch (err) {
      non2xxMessage = (err as Error).message;
    }

    expect(non2xxMessage).toMatch(/HTTP 503/);
    expect(non2xxMessage).toMatch(/Gradio server/);
    // The two failure causes have different fixes — the messages must differ.
    expect(non2xxMessage).not.toBe(unreachableMessage);
  });

  it('happy path: a 200 response does not throw', async () => {
    process.env[ENV_KEY] = 'true';
    const fetchImpl = vi.fn(async () => okResponse());
    const provider = new Wan2gpProvider({
      baseUrl: 'http://127.0.0.1:9876',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(provider.preflight()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 7. estimateCostUSD — always 0, regardless of request shape.
// ---------------------------------------------------------------------------
describe('Wan2gpProvider.estimateCostUSD()', () => {
  it('is always 0, for any request shape', () => {
    const provider = new Wan2gpProvider({ fetchImpl: vi.fn() as unknown as typeof fetch });
    expect(provider.estimateCostUSD(baseReq())).toBe(WAN2GP_RATE_USD);
    expect(provider.estimateCostUSD(baseReq({ durationSec: 999, resolution: '4k' }))).toBe(0);
    expect(
      provider.estimateCostUSD(baseReq({ mode: 'interpolate', aspectRatio: '9:16' })),
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Ledger hooks at zero cost — the discriminating group. A $0 reservation is
// a ledger no-op, but the job ROW is what makes local work visible in the cost
// report and trace alongside paid work, so the hooks must still fire.
// ---------------------------------------------------------------------------
describe('Wan2gpProvider.generate() — ledger hooks fire at zero cost', () => {
  const ENV_KEY = 'MEDIA_FORGE_WAN2GP_ENABLED';
  let prevEnabled: string | undefined;

  beforeEach(() => {
    prevEnabled = process.env[ENV_KEY];
    process.env[ENV_KEY] = 'true';
  });

  afterEach(() => {
    if (prevEnabled === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = prevEnabled;
    vi.restoreAllMocks();
  });

  function makeHooks() {
    const beforeSubmit = vi.fn(async () => {});
    const onSubmitFailed = vi.fn(async () => {});
    const onPostSubmitError = vi.fn();
    const hooks: VideoLedgerHooks = { beforeSubmit, onSubmitFailed, onPostSubmitError };
    return { hooks, beforeSubmit, onSubmitFailed, onPostSubmitError };
  }

  it('beforeSubmit is called even though the amount is $0', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/predict')) return okResponse({ data: ['out.mp4'] });
      return okResponse(); // preflight GET /
    });
    const provider = new Wan2gpProvider({
      baseUrl: 'http://127.0.0.1:9876',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const { hooks, beforeSubmit } = makeHooks();

    await provider.generate(baseReq(), hooks);

    expect(beforeSubmit).toHaveBeenCalledTimes(1);
    const [, amount] = beforeSubmit.mock.calls[0]!;
    expect(amount).toBe(0);
  });

  it('submit failure (network error) calls onSubmitFailed, and the original error propagates', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/predict')) throw new Error('ECONNRESET');
      return okResponse(); // preflight GET / succeeds
    });
    const provider = new Wan2gpProvider({
      baseUrl: 'http://127.0.0.1:9876',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const { hooks, onSubmitFailed, onPostSubmitError } = makeHooks();

    await expect(provider.generate(baseReq(), hooks)).rejects.toThrow(/ECONNRESET/);
    expect(onSubmitFailed).toHaveBeenCalledTimes(1);
    expect(onPostSubmitError).not.toHaveBeenCalled();
  });

  it('a 2xx submit with a non-array `data` calls onPostSubmitError and NOT onSubmitFailed', async () => {
    // The provider already accepted (HTTP 2xx); releasing the reservation here
    // would be wrong if the job is in fact running — same asymmetric contract
    // as every other provider's ledger hooks.
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/predict')) return okResponse({ data: 'not-an-array' });
      return okResponse();
    });
    const provider = new Wan2gpProvider({
      baseUrl: 'http://127.0.0.1:9876',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const { hooks, onSubmitFailed, onPostSubmitError } = makeHooks();

    await expect(provider.generate(baseReq(), hooks)).rejects.toThrow(/no data array/);
    expect(onPostSubmitError).toHaveBeenCalledTimes(1);
    expect(onSubmitFailed).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 9. buildGradioPayload — Gradio takes a positional array; order is contract.
// ---------------------------------------------------------------------------
describe('buildGradioPayload', () => {
  it('returns [prompt, durationSec, resolution, aspectRatio] in that order', () => {
    const payload = buildGradioPayload(
      baseReq({ prompt: 'p', durationSec: 7, resolution: '1080p', aspectRatio: '9:16' }),
    );
    expect(payload).toEqual(['p', 7, '1080p', '9:16']);
  });

  it("defaults aspectRatio to '16:9' when the request omits it", () => {
    const payload = buildGradioPayload(baseReq({ aspectRatio: undefined }));
    expect(payload[3]).toBe('16:9');
  });
});

// ---------------------------------------------------------------------------
// 10. checkWan2gpRequirements — null must read differently from "not enough".
// ---------------------------------------------------------------------------
describe('checkWan2gpRequirements', () => {
  it('both above minimum: ok true, no warnings', () => {
    const result = checkWan2gpRequirements({ vramGb: WAN2GP_MIN_VRAM_GB + 2, freeDiskGb: WAN2GP_MAX_DISK_GB + 10 });
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('vram below minimum: ok false, warning names the minimum', () => {
    const result = checkWan2gpRequirements({
      vramGb: WAN2GP_MIN_VRAM_GB - 1,
      freeDiskGb: WAN2GP_MAX_DISK_GB,
    });
    expect(result.ok).toBe(false);
    expect(result.warnings.some((w) => w.includes(String(WAN2GP_MIN_VRAM_GB)))).toBe(true);
  });

  it('disk below minimum: ok false, warning names the range', () => {
    const result = checkWan2gpRequirements({
      vramGb: WAN2GP_MIN_VRAM_GB,
      freeDiskGb: WAN2GP_MIN_DISK_GB - 1,
    });
    expect(result.ok).toBe(false);
    const warning = result.warnings.find((w) => w.includes(String(WAN2GP_MIN_DISK_GB)));
    expect(warning).toBeDefined();
    expect(warning).toContain(String(WAN2GP_MAX_DISK_GB));
  });

  it('vramGb null: ok is FALSE with a "could not detect" warning, distinct from the "not enough" message', () => {
    const undetected = checkWan2gpRequirements({ vramGb: null, freeDiskGb: WAN2GP_MAX_DISK_GB });
    const tooSmall = checkWan2gpRequirements({
      vramGb: WAN2GP_MIN_VRAM_GB - 1,
      freeDiskGb: WAN2GP_MAX_DISK_GB,
    });

    expect(undetected.ok).toBe(false);
    expect(undetected.warnings.some((w) => /could not detect/i.test(w))).toBe(true);
    // Undetected must not be reported as fine, AND must not reuse the "not
    // enough" wording — sending a user to replace working hardware because a
    // probe merely failed is the exact mistake this distinction prevents.
    expect(undetected.warnings[0]).not.toBe(tooSmall.warnings[0]);
  });

  it('freeDiskGb null: same treatment — ok FALSE, "could not detect" warning distinct from "not enough"', () => {
    const undetected = checkWan2gpRequirements({ vramGb: WAN2GP_MAX_DISK_GB, freeDiskGb: null });
    const tooSmall = checkWan2gpRequirements({
      vramGb: WAN2GP_MIN_VRAM_GB,
      freeDiskGb: WAN2GP_MIN_DISK_GB - 1,
    });

    expect(undetected.ok).toBe(false);
    expect(undetected.warnings.some((w) => /could not detect/i.test(w))).toBe(true);
    expect(undetected.warnings[0]).not.toBe(tooSmall.warnings[0]);
  });
});

// ---------------------------------------------------------------------------
// 11. Registry shape — wan2gp is a registered provider with NO VIDEO_MODELS
// entry, same treatment as muapi (see tests/video/providers/muapi.test.ts).
// ---------------------------------------------------------------------------
describe('registry shape', () => {
  it('PROVIDERS contains wan2gp', () => {
    expect(PROVIDERS).toContain('wan2gp');
  });

  it('VIDEO_MODELS has no wan2gp entry — it is not in the static registry', () => {
    const wan2gpEntries = Object.values(VIDEO_MODELS).filter((m) => m.provider === 'wan2gp');
    expect(wan2gpEntries).toHaveLength(0);
  });
});
