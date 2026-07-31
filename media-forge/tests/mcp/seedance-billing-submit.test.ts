// tests/mcp/seedance-billing-submit.test.ts
// T15 part B — Seedance submit-side credit lifecycle (4 tools: t2v / i2v /
// multishot / reference-fusion).
//
// Before this change, the 4 Seedance submit tools landed a row in video_jobs
// (via BytedanceSeedanceProvider.generate() -> recordJob, on a successful
// submit only, same shape as Higgsfield/Kling) but never ran the cost guard
// and never reserved credit — see the T15 section of
// .maxvision/plans/2026-07-29-higgsfield-kling-api-refresh.md.
//
// BytedanceSeedanceProvider uses the @fal-ai/client SDK, whose internal HTTP
// cannot be intercepted via fetchImpl injection (the Kling/Higgsfield fetch-
// mock pattern doesn't apply here — see the module mock comment on the
// existing tests/mcp/seedance-*-handler.test.ts files). This file follows the
// same module-mock approach, but has the mocked `generate` call the REAL
// recordJob so a genuine video_jobs row exists to assert reserve/tenant
// against — mirroring exactly what BytedanceSeedanceProvider.generate() does
// on a successful submit in production (bytedance-seedance.ts's
// recordOnSuccess closure).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const generate = vi.fn();
const estimateCostUSD = vi.fn();
const mockInstance = {
  generate,
  estimateCostUSD,
  pollStatus: vi.fn(),
  download: vi.fn(),
  recordActualCostUSD: vi.fn(),
  models: [],
  name: 'bytedance' as const,
};

vi.mock('../../src/video/providers/bytedance-seedance.js', () => ({
  BytedanceSeedanceProvider: vi.fn(() => mockInstance),
  getBytedanceSeedanceProvider: vi.fn(() => mockInstance),
  __resetBytedanceSeedanceSingleton: vi.fn(),
}));

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAllTools, type HandlersDeps } from '../../src/mcp/handlers.js';
import { recordJob, getJobRecord } from '../../src/core/cost-tracker.js';
import { closeDb } from '../../src/core/db.js';
import type { MediaForgeConfig } from '../../src/core/config.js';
import type { MediaForgeClient } from '../../src/core/client.js';
import type { CreditClient } from '../../src/billing/credit-client.js';

function makeMockServer() {
  return { registerTool: vi.fn() } as unknown as McpServer;
}

function makeFakeConfig(overrides: Partial<MediaForgeConfig> = {}): MediaForgeConfig {
  return Object.freeze({
    apiKey: 'test-key',
    useVertex: false,
    project: undefined,
    location: 'us-central1',
    outputDir: './outputs',
    projectDir: './.media-forge',
    logLevel: 'error' as const,
    logFormat: 'json' as const,
    dryRun: false,
    pollIntervalMs: 10000,
    pollMaxAttempts: 90,
    runLiveTests: false,
    runEvals: false,
    dailyCapUsd: 25,
    confirmThresholdUsd: 0.5,
    blockThresholdUsd: 2.0,
    retryBudgetMultiplier: 3,
    showRetryBudget: true,
    ocrBackend: 'cloud-vision' as const,
    ocrGoogleVisionKey: undefined,
    reviewThreshold: 7.5,
    maxFixAttempts: 3,
    skipOcrWhenNoTextIntent: true,
    region: undefined,
    ...overrides,
  }) as MediaForgeConfig;
}

function makeFakeClient(): MediaForgeClient {
  return Object.freeze({ mode: 'gemini' as const, dryRun: false, ai: {} as never });
}

function spyCreditClient(balance = 1_000_000) {
  const reserve = vi.fn(async () => {});
  const capture = vi.fn(async () => {});
  const release = vi.fn(async () => {});
  const client = {
    reserve,
    capture,
    release,
    balance: vi.fn(async () => balance),
    grant: vi.fn(async () => {}),
  };
  return { client: client as unknown as CreditClient, reserve, capture, release };
}

interface CapturedTool {
  name: string;
  handler: (input: unknown) => Promise<{ content: unknown; isError?: boolean; structuredContent?: unknown }>;
}

function getCapturedTools(server: McpServer): CapturedTool[] {
  const mock = server as unknown as { registerTool: ReturnType<typeof vi.fn> };
  return mock.registerTool.mock.calls.map(([name, , handler]) => ({
    name: name as string,
    handler: handler as CapturedTool['handler'],
  }));
}

const SITES: Array<{ tool: string; input: Record<string, unknown> }> = [
  {
    tool: 'media_seedance_text_to_video',
    input: { prompt: 'a quiet lake at sunrise', modelTier: 'standard', resolution: '1080p', durationSec: 5 },
  },
  {
    tool: 'media_seedance_image_to_video',
    input: {
      prompt: 'animate the still',
      modelTier: 'standard',
      resolution: '1080p',
      durationSec: 5,
      imageUrl: 'https://cdn.example/start.jpg',
    },
  },
  {
    tool: 'media_seedance_multishot',
    input: {
      prompt: 'urban montage',
      modelTier: 'standard',
      resolution: '1080p',
      shots: [
        { startSec: 0, endSec: 5, shotPrompt: 'wide skyline' },
        { startSec: 5, endSec: 10, shotPrompt: 'close window' },
      ],
    },
  },
  {
    tool: 'media_seedance_reference_fusion',
    input: {
      prompt: 'fuse the reference image',
      modelTier: 'standard',
      durationSec: 5,
      resolution: '720p',
      imageUrls: ['https://cdn/u1.jpg'],
      videoUrls: [],
      audioUrls: [],
    },
  },
];

let jobCounter = 0;

describe('T15 part B — Seedance submit ledger (4 tools)', () => {
  let tmpDir: string;
  let dbPath: string;
  let prevProjectDir: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    jobCounter = 0;
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-seedance-billing-submit-'));
    dbPath = join(tmpDir, 'cost.db');
    prevProjectDir = process.env['MEDIA_FORGE_PROJECT_DIR'];
    process.env['MEDIA_FORGE_PROJECT_DIR'] = tmpDir;

    estimateCostUSD.mockReturnValue(1.512);
    // Mirrors BytedanceSeedanceProvider.generate()'s recordOnSuccess closure:
    // recordJob only fires on a successful submit, using an internal jobId.
    generate.mockImplementation(async (req: { modelId: string; mode: string }) => {
      const jobId = `seedance-test-${jobCounter++}`;
      recordJob({
        dbPath,
        jobId,
        provider: 'bytedance',
        model: req.modelId,
        mode: req.mode,
        paramsHash: 'test-hash',
        estUsd: 1.512,
      });
      return {
        jobId,
        provider: 'bytedance',
        model: req.modelId,
        mode: req.mode,
        createdAt: new Date().toISOString(),
        providerNativeId: 'fal-req-x',
      };
    });
  });

  afterEach(() => {
    closeDb(dbPath);
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // EPERM on Windows — ignore
    }
    if (prevProjectDir === undefined) delete process.env['MEDIA_FORGE_PROJECT_DIR'];
    else process.env['MEDIA_FORGE_PROJECT_DIR'] = prevProjectDir;
    vi.restoreAllMocks();
  });

  it('each of the 4 Seedance submits reserves credit and sets the tenant', async () => {
    const server = makeMockServer();
    const spy = spyCreditClient();
    const deps: HandlersDeps = { client: makeFakeClient(), config: makeFakeConfig(), creditClient: spy.client, tenantId: 't1' };
    registerAllTools(server, deps);
    const tools = getCapturedTools(server);

    for (const site of SITES) {
      const tool = tools.find((t) => t.name === site.tool);
      expect(tool, `${site.tool} not registered`).toBeDefined();

      const result = await tool!.handler(site.input);
      expect(result.isError, `${site.tool}: ${JSON.stringify(result.content)}`).toBeFalsy();
      const structured = result.structuredContent as { jobId: string; estimatedCostUSD: number };
      expect(structured.estimatedCostUSD).toBeCloseTo(1.512, 4);

      const row = getJobRecord({ dbPath, jobId: structured.jobId });
      expect(row, `${site.tool}: no video_jobs row`).not.toBeNull();
      expect(row!.tenantId, `${site.tool}: tenant not set`).toBe('t1');
    }

    // A5 (2026-07-30): this used to assert `spy.reserve` was called 4 times, back
    // when the reserve lived in register.ts AFTER the submit returned. It now
    // happens inside BytedanceSeedanceProvider.generate(), via
    // ledgerHooks.beforeSubmit, so the credit is reserved BEFORE the provider is
    // ever contacted (C8).
    //
    // This file mocks the whole bytedance-seedance module, so the real generate()
    // — and therefore the real reserve — never executes here. That is not a
    // regression and not a reason to weaken the assertion: it is the wrong layer
    // to observe a provider-internal call. The ordering guarantee is proven
    // against the REAL provider in
    // tests/video/providers/bytedance-seedance-ledger-hooks.test.ts, which mocks
    // only @fal-ai/client.
    //
    // What IS observable and worth pinning here is the wiring: every submit tool
    // must hand the provider a hooks object carrying all three callbacks. If a
    // future edit drops that argument, the reserve silently stops happening and
    // only this assertion would catch it at the handler layer.
    expect(generate).toHaveBeenCalledTimes(SITES.length);
    for (const [i, call] of generate.mock.calls.entries()) {
      const hooks = call[1] as
        | { beforeSubmit?: unknown; onSubmitFailed?: unknown; onPostSubmitError?: unknown }
        | undefined;
      expect(hooks, `site ${i}: generate() called without ledgerHooks`).toBeDefined();
      expect(typeof hooks!.beforeSubmit, `site ${i}: beforeSubmit missing`).toBe('function');
      expect(typeof hooks!.onSubmitFailed, `site ${i}: onSubmitFailed missing`).toBe('function');
      expect(typeof hooks!.onPostSubmitError, `site ${i}: onPostSubmitError missing`).toBe('function');
    }
  });

  it('guard and preflight block Seedance submits the same way as Kling/Higgsfield', async () => {
    // Insufficient credit: provider never called.
    {
      const server = makeMockServer();
      const spy = spyCreditClient(0);
      const deps: HandlersDeps = { client: makeFakeClient(), config: makeFakeConfig(), creditClient: spy.client, tenantId: 't1' };
      registerAllTools(server, deps);
      const tool = getCapturedTools(server).find((t) => t.name === 'media_seedance_text_to_video');

      const result = await tool!.handler(SITES[0]!.input);
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('InsufficientCreditError');
      expect(generate).not.toHaveBeenCalled();
      expect(spy.reserve).not.toHaveBeenCalled();
    }

    // Cost guard: blockThresholdUsd below the $1.512 estimate.
    {
      const server = makeMockServer();
      const spy = spyCreditClient(1_000_000);
      const deps: HandlersDeps = {
        client: makeFakeClient(),
        config: makeFakeConfig({ blockThresholdUsd: 1.0 }),
        creditClient: spy.client,
        tenantId: 't1',
      };
      registerAllTools(server, deps);
      const tool = getCapturedTools(server).find((t) => t.name === 'media_seedance_text_to_video');

      const result = await tool!.handler(SITES[0]!.input);
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('CostGuardError');
      expect(generate).not.toHaveBeenCalled();
      expect(spy.reserve).not.toHaveBeenCalled();
    }
  });

  it('a submit leaves the row pending with no capture — the sweep is the intended settler, nothing double-settles here', async () => {
    const server = makeMockServer();
    const spy = spyCreditClient();
    const deps: HandlersDeps = { client: makeFakeClient(), config: makeFakeConfig(), creditClient: spy.client, tenantId: 't1' };
    registerAllTools(server, deps);
    const tool = getCapturedTools(server).find((t) => t.name === 'media_seedance_text_to_video');

    const result = await tool!.handler(SITES[0]!.input);
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { jobId: string };

    const row = getJobRecord({ dbPath, jobId: structured.jobId });
    expect(row!.status).toBe('pending');
    expect(row!.actualUsd).toBeNull();

    // register.ts never calls captureVideoComplete/releaseVideoFailed for
    // Seedance — completion is deliberately left to credit-core's sweep via
    // the job-status oracle (src/http/job-status.ts), not to a poll/download
    // tool (Seedance registers no such tool).
    expect(spy.capture).not.toHaveBeenCalled();
    expect(spy.release).not.toHaveBeenCalled();
  });
});
