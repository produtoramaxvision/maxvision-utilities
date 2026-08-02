// tests/mcp/higgsfield-billing-submit.test.ts
// T15 part B — Higgsfield submit-side credit lifecycle, all 5 submit tools
// (DoP, Cinema Studio, Speak, Marketing Studio, Generate).
//
// Recast is gone: /higgsfield-ai/recast/standard answers 404 and the product is
// on no Higgsfield surface. Cinema Studio and Marketing Studio still submit, but
// over the CLI transport now (their Cloud API endpoints also 404), so this file
// installs a fake CLI provider alongside the fetch stub — the ledger contract is
// the same on both transports and both must honour it.
//
// Before this change, all 6 landed a row in video_jobs (via
// HiggsfieldProvider.generate() -> recordJob, on a successful submit only)
// but never ran the cost guard and never reserved credit — see the T15
// section of .maxvision/plans/2026-07-29-higgsfield-kling-api-refresh.md.
// This file proves the fix end-to-end through registerAllTools -> wrap() ->
// handleHiggsfield*(input, videoGuardOpts) -> reserveVideoSubmit, mirroring
// tests/mcp/veo-billing-submit.test.ts and cost-guard-video-block.test.ts.
//
// The reserve/tenant assertions loop over all 5 sites (SITES below) so a
// missing `await reserveVideoSubmit(...)` or a forgotten `videoGuardOpts` at
// any ONE of the five would fail the suite, not just DoP's. The guard-block
// and insufficient-credit tests stay on media_higgsfield_dop alone — that
// gate logic (checkCostGuardOrThrow / preflightVideoCredit) is shared,
// provider-agnostic code already covered per-site by the reserve/tenant loop
// calling it, so re-deriving a distinct cost estimate per site for those two
// tests would add file weight without adding coverage.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  registerAllTools,
  type HandlersDeps,
  _resetHiggsfieldProviderForTests,
} from '../../src/mcp/handlers.js';
import { HiggsfieldCliProvider } from '../../src/video/providers/higgsfield-cli.js';
import {
  _resetHiggsfieldCliProviderForTests,
  _setHiggsfieldCliProviderForTests,
} from '../../src/mcp/handlers/shared.js';
import { getJobRecord } from '../../src/core/cost-tracker.js';
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

function spyCreditClient(balance: number) {
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

const DOP_INPUT = {
  modelId: 'higgsfield-dop',
  firstFrameImagePath: '/tmp/scene.png',
  prompt: 'reveal the city skyline',
  cameraVerbs: ['crane_up', 'dolly_in'],
  durationSec: 6,
  resolution: '1080p' as const,
  aspectRatio: '16:9' as const,
};

// One entry per submit site, inputs lifted verbatim from each site's own
// tests/mcp/higgsfield-*-handler.test.ts (already known to satisfy both the
// Zod schema AND HiggsfieldProvider's pre-submit maxDurationSec/resolutions
// validation — higgsfield.ts:99-107 — so a submit never throws for the wrong
// reason before reserve ever runs).
const SITES: Array<{ tool: string; input: Record<string, unknown> }> = [
  { tool: 'media_higgsfield_dop', input: DOP_INPUT },
  {
    tool: 'media_higgsfield_cinema_studio',
    input: {
      prompt: 'noir interrogation',
      durationSec: 15,
      resolution: '1080p',
      cameraStyle: 'intimate_observer',
      colorGrading: 'classic_bw',
      genre: 'noir',
    },
  },
  {
    tool: 'media_higgsfield_speak',
    input: {
      modelId: 'higgsfield-speak',
      portraitImagePath: '/tmp/face.png',
      audioPath: '/tmp/voice.wav',
      prompt: 'confident newsreader',
      durationSec: 15,
      resolution: '720p',
    },
  },
  {
    tool: 'media_higgsfield_marketing_studio',
    input: {
      prompt: 'show the box opening with the gadget revealed',
      durationSec: 15,
      resolution: '1080p',
      avatarIds: ['672be390-36ab-4d79-bb95-ff562a57c79c'],
    },
  },
  {
    tool: 'media_higgsfield_generate',
    input: {
      modelId: 'higgsfield-soul-standard',
      mode: 't2v',
      prompt: 'a quiet lake at sunrise',
      durationSec: 5,
      resolution: '1080p',
    },
  },
];

describe('T15 part B — Higgsfield submit ledger (all 5 submit tools)', () => {
  let tmpDir: string;
  let dbPath: string;
  let prevProjectDir: string | undefined;
  const ORIG_FETCH = global.fetch;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-hf-billing-submit-'));
    dbPath = join(tmpDir, 'cost.db');
    prevProjectDir = process.env['MEDIA_FORGE_PROJECT_DIR'];
    process.env['MEDIA_FORGE_PROJECT_DIR'] = tmpDir;
    process.env['HF_API_KEY'] = 'pk';
    process.env['HF_API_SECRET'] = 'sk';
    process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = '0.039';
    // Both transports run in this file, and they bill separate pools. The
    // Studio tools below submit over the CLI, which prices from its own rate.
    process.env['MEDIA_FORGE_HIGGSFIELD_CLI_USD_PER_CREDIT'] = '0.0483333';
    // Cinema Studio and Marketing Studio submit over the CLI, so a fetch stub
    // cannot stand in for them.
    _setHiggsfieldCliProviderForTests(
      new HiggsfieldCliProvider({
        dbPath,
        runner: async (args) => {
          const [group, verb] = args;
          if (group === 'auth') return { stdout: '{"token":"t"}', stderr: '', exitCode: 0 };
          if (group === 'generate' && verb === 'cost') {
            return { stdout: '{"credits": 75}', stderr: '', exitCode: 0 };
          }
          if (group === 'generate' && verb === 'create') {
            return { stdout: '{"id":"cli-job"}', stderr: '', exitCode: 0 };
          }
          return { stdout: '{}', stderr: '', exitCode: 0 };
        },
      }),
    );
    _resetHiggsfieldProviderForTests();
  });

  afterEach(() => {
    _resetHiggsfieldCliProviderForTests();
    closeDb(dbPath);
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // EPERM on Windows — ignore
    }
    if (prevProjectDir === undefined) delete process.env['MEDIA_FORGE_PROJECT_DIR'];
    else process.env['MEDIA_FORGE_PROJECT_DIR'] = prevProjectDir;
    delete process.env['HF_API_KEY'];
    delete process.env['HF_API_SECRET'];
    delete process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
    delete process.env['MEDIA_FORGE_HIGGSFIELD_CLI_USD_PER_CREDIT'];
    global.fetch = ORIG_FETCH;
    vi.restoreAllMocks();
  });

  it('each of the 5 submit sites reserves credit + sets tenant when billing is on', async () => {
    const server = makeMockServer();
    let call = 0;
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ request_id: `req-${call++}`, status_url: 'u', cancel_url: 'c' }), { status: 200 }),
    ) as unknown as typeof fetch;
    const spy = spyCreditClient(1_000_000);
    // High thresholds: this test is about reserve/tenant wiring, not guard
    // behavior (that's covered separately below). Each of the 6 sites has a
    // different cost estimate (Cinema Studio alone is ~$3.51) and all 6 land
    // in the SAME UTC day's dailySpendUsd — a low cap here would make later
    // sites in the loop fail for a reason unrelated to what this test checks.
    const deps: HandlersDeps = {
      client: makeFakeClient(),
      config: makeFakeConfig({ blockThresholdUsd: 1000, dailyCapUsd: 1000 }),
      creditClient: spy.client,
      tenantId: 't1',
    };
    registerAllTools(server, deps);
    const tools = getCapturedTools(server);

    for (const site of SITES) {
      const tool = tools.find((t) => t.name === site.tool);
      expect(tool, `${site.tool} not registered`).toBeDefined();

      const result = await tool!.handler(site.input);
      expect(result.isError, `${site.tool}: ${JSON.stringify(result.content)}`).toBeFalsy();
      const structured = result.structuredContent as { jobId: string; estimatedCostUSD: number };
      expect(structured.estimatedCostUSD, `${site.tool}`).toBeGreaterThan(0);

      const row = getJobRecord({ dbPath, jobId: structured.jobId });
      expect(row, `${site.tool}: no video_jobs row`).not.toBeNull();
      expect(row!.tenantId, `${site.tool}: tenant not set`).toBe('t1');
      // Two transports, one ledger contract. The Studios bill the subscription
      // workspace over the CLI and the rest bill API credits over HTTP, so the
      // row must name which — that separation is why they are distinct providers
      // rather than a mode flag (see PROVIDERS in models.ts).
      const expectedProvider =
        site.tool === 'media_higgsfield_cinema_studio' ||
        site.tool === 'media_higgsfield_marketing_studio'
          ? 'higgsfield-cli'
          : 'higgsfield';
      expect(row!.provider, `${site.tool}`).toBe(expectedProvider);
    }

    expect(spy.reserve).toHaveBeenCalledTimes(SITES.length);
  });

  it('does not reserve when billing is off (no creditClient/tenantId) — each of the 5 sites', async () => {
    const server = makeMockServer();
    let call = 0;
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ request_id: `req-off-${call++}`, status_url: 'u', cancel_url: 'c' }), { status: 200 }),
    ) as unknown as typeof fetch;
    const deps: HandlersDeps = {
      client: makeFakeClient(),
      config: makeFakeConfig({ blockThresholdUsd: 1000, dailyCapUsd: 1000 }),
    }; // no creditClient
    registerAllTools(server, deps);
    const tools = getCapturedTools(server);

    for (const site of SITES) {
      const tool = tools.find((t) => t.name === site.tool);
      const result = await tool!.handler(site.input);
      expect(result.isError, `${site.tool}: ${JSON.stringify(result.content)}`).toBeFalsy();
      const structured = result.structuredContent as { jobId: string };

      // Row still lands (recordJob is provider-internal, unconditional on submit
      // success) but tenant defaults to 'default' since deps.tenantId is undefined.
      const row = getJobRecord({ dbPath, jobId: structured.jobId });
      expect(row, `${site.tool}: no video_jobs row`).not.toBeNull();
      expect(row!.tenantId, `${site.tool}`).toBe('default');
    }
  });

  it('insufficient credit blocks the submit — the provider is never called', async () => {
    const server = makeMockServer();
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const spy = spyCreditClient(0); // balance far below any estimate
    const deps: HandlersDeps = { client: makeFakeClient(), config: makeFakeConfig(), creditClient: spy.client, tenantId: 't1' };
    registerAllTools(server, deps);
    const tool = getCapturedTools(server).find((t) => t.name === 'media_higgsfield_dop');

    const result = await tool!.handler(DOP_INPUT);
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('InsufficientCreditError');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(spy.reserve).not.toHaveBeenCalled();
  });

  it('the cost guard blocks a submit over the block threshold — the provider is never called', async () => {
    const server = makeMockServer();
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const spy = spyCreditClient(1_000_000);
    // estimateUsd = 40 credits * $0.039 = $1.56 — set the block threshold below that.
    const deps: HandlersDeps = {
      client: makeFakeClient(),
      config: makeFakeConfig({ blockThresholdUsd: 1.0 }),
      creditClient: spy.client,
      tenantId: 't1',
    };
    registerAllTools(server, deps);
    const tool = getCapturedTools(server).find((t) => t.name === 'media_higgsfield_dop');

    const result = await tool!.handler(DOP_INPUT);
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('CostGuardError');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(spy.reserve).not.toHaveBeenCalled();
  });
});
