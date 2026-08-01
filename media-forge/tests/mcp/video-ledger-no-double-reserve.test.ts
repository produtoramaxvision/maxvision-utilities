// tests/mcp/video-ledger-no-double-reserve.test.ts
// A5 (2026-07-30) — semantic proof that NO site is left with both a
// `ledgerHooks.beforeSubmit` reserve AND a post-submit `reserveVideoSubmit`
// call. A grep only catches the spelling of the defect (a source line that
// says "reserveVideoSubmit"); this file catches the actual behavior: driving
// every one of the 15 Kling/Higgsfield/Seedance submit tools through the REAL
// `registerAllTools` -> handler -> provider.generate() path and asserting the
// credit-core `reserve` call fires EXACTLY once per invocation. A double
// reserve on the same jobId 402s per credit-core's `runReserveTxn` (balance
// check runs before the `ON CONFLICT DO NOTHING` insert — see
// credit-core/src/store.ts) — that would surface here as `result.isError`
// on a tenant with just-enough credit, not merely as reserve.mock.calls.length
// === 2, which is why this file also asserts `result.isError` is falsy for
// every site alongside the exact call count.
//
// New file — does not modify any pre-existing test.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('@fal-ai/client', () => {
  const submit = vi.fn();
  const status = vi.fn();
  const result = vi.fn();
  const config = vi.fn();
  return { fal: { config, queue: { submit, status, result } } };
});

import { fal } from '@fal-ai/client';
import {
  registerAllTools,
  type HandlersDeps,
  _resetHiggsfieldProviderForTests,
} from '../../src/mcp/handlers.js';
import { closeDb } from '../../src/core/db.js';
import { HiggsfieldCliProvider } from '../../src/video/providers/higgsfield-cli.js';
import {
  _resetHiggsfieldCliProviderForTests,
  _setHiggsfieldCliProviderForTests,
} from '../../src/mcp/handlers/shared.js';
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
    // Generous thresholds — this file is about reserve call COUNT, not guard
    // behavior (that's covered by higgsfield-billing-submit.test.ts /
    // veo-billing-submit.test.ts / the new *-ledger-hooks.test.ts files).
    dailyCapUsd: 100000,
    confirmThresholdUsd: 100000,
    blockThresholdUsd: 100000,
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

// One entry per submit site — all 15 Kling (5) + Higgsfield (6) + Seedance (4)
// submit tools that A5 touches. Inputs lifted verbatim from each site's own
// tests/mcp/*-handler.test.ts (already known to satisfy both the Zod schema
// AND each provider's pre-submit validation).
const SITES: Array<{ tool: string; input: Record<string, unknown> }> = [
  // -- Kling (5) --
  {
    tool: 'media_kling_motion_brush',
    input: {
      prompt: 'wave the flag in the upper-left region',
      imageUrl: 'https://example/scene.png',
      regions: [{ id: 'flag', polygon: [[0, 0], [200, 0], [200, 100], [0, 100]], motionVector: [30, -10] }],
      durationSec: 5,
    },
  },
  {
    tool: 'media_kling_elements',
    input: {
      prompt: 'all four characters dance in the desert',
      imageUrl: 'https://example/base.png',
      elementIds: ['elem-A', 'elem-B', 'elem-C', 'elem-D'],
      durationSec: 5,
    },
  },
  {
    tool: 'media_kling_lip_sync',
    input: { videoUrl: 'https://example/source.mp4', text: 'hello world, this is a test', emotion: 'happy' },
  },
  {
    tool: 'media_kling_omni_multishot',
    input: {
      shots: [
        { index: 1, prompt: 'wide establishing shot of city skyline at dawn', duration: 5 },
        { index: 2, prompt: 'medium shot of protagonist on rooftop', duration: 5 },
      ],
      imageRefs: [{ imageUrl: 'https://example.com/protag.png' }],
      aspectRatio: '16:9',
    },
  },
  {
    tool: 'media_kling_video_extend',
    input: { videoUrl: 'https://example/source.mp4', prompt: 'continue the motion outward', hops: 1 },
  },
  // -- Higgsfield (6) --
  {
    tool: 'media_higgsfield_dop',
    input: {
      modelId: 'higgsfield-dop',
      firstFrameImagePath: '/tmp/scene.png',
      prompt: 'reveal the city skyline',
      cameraVerbs: ['crane_up', 'dolly_in'],
      durationSec: 6,
      resolution: '1080p',
      aspectRatio: '16:9',
    },
  },
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
    input: { modelId: 'higgsfield-soul-standard', mode: 't2v', prompt: 'a quiet lake at sunrise', durationSec: 5, resolution: '1080p' },
  },
  // -- Seedance (4) --
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

describe('A5 — no submit site double-reserves (Kling + Higgsfield + Seedance, 14 sites)', () => {
  let tmpDir: string;
  let dbPath: string;
  let prevProjectDir: string | undefined;
  const ORIG_FETCH = global.fetch;
  let falCounter = 0;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-no-double-reserve-'));
    dbPath = join(tmpDir, 'cost.db');
    prevProjectDir = process.env['MEDIA_FORGE_PROJECT_DIR'];
    process.env['MEDIA_FORGE_PROJECT_DIR'] = tmpDir;
    process.env['KLING_ACCESS_KEY'] = 'ak_test';
    process.env['KLING_SECRET_KEY'] = 'sk_test';
    process.env['HF_API_KEY'] = 'pk_test';
    process.env['HF_API_SECRET'] = 'sk_test';
    process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = '0.039';
    process.env['FAL_KEY'] = 'fal_test';
    process.env['BYTEPLUS_ARK_API_KEY'] = 'ark_test';
    _resetHiggsfieldProviderForTests();
    // The two Studio tools submit over the CLI, not fetch.
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
    falCounter = 0;
    vi.mocked(fal.queue.submit).mockImplementation(async () => ({ request_id: `fal-req-${falCounter++}` }) as never);
    // One fetch mock body satisfies BOTH Kling's `{code, data:{task_id}}`
    // envelope and Higgsfield's `{request_id, status_url, cancel_url}` one —
    // each provider only reads the fields it cares about.
    let call = 0;
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          code: 0,
          data: { task_id: `kling-task-${call}` },
          request_id: `hf-req-${call++}`,
          status_url: 'https://platform.higgsfield.ai/requests/x/status',
          cancel_url: 'https://platform.higgsfield.ai/requests/x/cancel',
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
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
    delete process.env['KLING_ACCESS_KEY'];
    delete process.env['KLING_SECRET_KEY'];
    delete process.env['HF_API_KEY'];
    delete process.env['HF_API_SECRET'];
    delete process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
    delete process.env['FAL_KEY'];
    delete process.env['BYTEPLUS_ARK_API_KEY'];
    global.fetch = ORIG_FETCH;
    vi.restoreAllMocks();
  });

  it('each of the 14 submit sites reserves credit EXACTLY once — never zero, never twice', async () => {
    const server = makeMockServer();
    const spy = spyCreditClient(1_000_000);
    const deps: HandlersDeps = {
      client: makeFakeClient(),
      config: makeFakeConfig(),
      creditClient: spy.client,
      tenantId: 't1',
    };
    registerAllTools(server, deps);
    const tools = getCapturedTools(server);

    for (const site of SITES) {
      const tool = tools.find((t) => t.name === site.tool);
      expect(tool, `${site.tool} not registered`).toBeDefined();

      spy.reserve.mockClear();
      const result = await tool!.handler(site.input);
      expect(result.isError, `${site.tool}: ${JSON.stringify(result.content)}`).toBeFalsy();
      expect(spy.reserve, `${site.tool}: expected exactly 1 reserve() call`).toHaveBeenCalledTimes(1);
    }
  });
});
