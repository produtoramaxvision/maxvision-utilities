// tests/mcp/higgsfield-billing-poll.test.ts
// T15 part B — Higgsfield completion path (media_higgsfield_poll).
//
// Higgsfield's correlation is simpler than Veo's: media_higgsfield_poll's
// `jobId` IS the SAME internal id HiggsfieldProvider.generate() already
// writes via recordJob (no native-task-id indirection needed) — see the
// updated comment above the DoP submit site in register.ts. This file proves
// the poll handler settles the row + credit reservation opened by
// tests/mcp/higgsfield-billing-submit.test.ts's submit path: capture on
// state 'completed', release on any of the 3 failure-equivalent terminal
// states ('failed' | 'nsfw' | 'canceled'), and settles nothing while the job
// is still 'pending' | 'in_progress'.
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

const DOP_INPUT = {
  modelId: 'higgsfield-dop',
  firstFrameImagePath: '/tmp/scene.png',
  prompt: 'reveal the city skyline',
  cameraVerbs: ['crane_up', 'dolly_in'],
  durationSec: 6,
  resolution: '1080p' as const,
  aspectRatio: '16:9' as const,
};

describe('T15 part B — Higgsfield poll settlement (media_higgsfield_poll)', () => {
  let tmpDir: string;
  let dbPath: string;
  let prevProjectDir: string | undefined;
  const ORIG_FETCH = global.fetch;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-hf-billing-poll-'));
    dbPath = join(tmpDir, 'cost.db');
    prevProjectDir = process.env['MEDIA_FORGE_PROJECT_DIR'];
    process.env['MEDIA_FORGE_PROJECT_DIR'] = tmpDir;
    process.env['HF_API_KEY'] = 'pk';
    process.env['HF_API_SECRET'] = 'sk';
    process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = '0.039';
    _resetHiggsfieldProviderForTests();
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
    delete process.env['HF_API_KEY'];
    delete process.env['HF_API_SECRET'];
    delete process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
    global.fetch = ORIG_FETCH;
    vi.restoreAllMocks();
  });

  /** Drives a real submit through media_higgsfield_dop (fetch mocked to accept),
   *  returning the internal jobId the row + reservation were opened under. */
  async function submitJob(
    server: McpServer,
    fetchQueue: Array<() => Response>,
  ): Promise<string> {
    let call = 0;
    global.fetch = vi.fn(async () => {
      const i = Math.min(call, fetchQueue.length - 1);
      call++;
      return fetchQueue[i]!();
    }) as unknown as typeof fetch;

    const tool = getCapturedTools(server).find((t) => t.name === 'media_higgsfield_dop');
    const result = await tool!.handler(DOP_INPUT);
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { jobId: string };
    return structured.jobId;
  }

  it('completed: captures and the row becomes completed', async () => {
    const server = makeMockServer();
    const spy = spyCreditClient();
    const deps: HandlersDeps = { client: makeFakeClient(), config: makeFakeConfig(), creditClient: spy.client, tenantId: 't1' };
    registerAllTools(server, deps);

    const jobId = await submitJob(server, [
      () => new Response(JSON.stringify({ request_id: 'req-poll-ok', status_url: 'u', cancel_url: 'c' }), { status: 200 }),
      () =>
        new Response(
          JSON.stringify({ status: 'completed', video: { url: 'https://cdn.higgsfield.ai/out.mp4' } }),
          { status: 200 },
        ),
    ]);
    expect(spy.reserve).toHaveBeenCalledTimes(1);

    const pollTool = getCapturedTools(server).find((t) => t.name === 'media_higgsfield_poll');
    const pollResult = await pollTool!.handler({ jobId });
    expect(pollResult.isError).toBeFalsy();
    const structured = pollResult.structuredContent as { state: string };
    expect(structured.state).toBe('completed');

    expect(spy.capture).toHaveBeenCalledTimes(1);
    expect(spy.release).not.toHaveBeenCalled();

    const row = getJobRecord({ dbPath, jobId });
    expect(row!.status).toBe('completed');
    expect(row!.actualUsd).toBeCloseTo(1.56, 5);
  });

  it('failed: releases and the row becomes failed', async () => {
    const server = makeMockServer();
    const spy = spyCreditClient();
    const deps: HandlersDeps = { client: makeFakeClient(), config: makeFakeConfig(), creditClient: spy.client, tenantId: 't1' };
    registerAllTools(server, deps);

    const jobId = await submitJob(server, [
      () => new Response(JSON.stringify({ request_id: 'req-poll-fail', status_url: 'u', cancel_url: 'c' }), { status: 200 }),
      () => new Response(JSON.stringify({ status: 'failed', error: 'upstream generation error' }), { status: 200 }),
    ]);

    const pollTool = getCapturedTools(server).find((t) => t.name === 'media_higgsfield_poll');
    const pollResult = await pollTool!.handler({ jobId });
    expect(pollResult.isError).toBeFalsy();
    const structured = pollResult.structuredContent as { state: string };
    expect(structured.state).toBe('failed');

    expect(spy.release).toHaveBeenCalledTimes(1);
    expect(spy.capture).not.toHaveBeenCalled();

    const row = getJobRecord({ dbPath, jobId });
    expect(row!.status).toBe('failed');
    expect(row!.actualUsd).toBe(0);
  });

  it('still running (in_progress): settles nothing', async () => {
    const server = makeMockServer();
    const spy = spyCreditClient();
    const deps: HandlersDeps = { client: makeFakeClient(), config: makeFakeConfig(), creditClient: spy.client, tenantId: 't1' };
    registerAllTools(server, deps);

    const jobId = await submitJob(server, [
      () => new Response(JSON.stringify({ request_id: 'req-poll-pending', status_url: 'u', cancel_url: 'c' }), { status: 200 }),
      () => new Response(JSON.stringify({ status: 'in_progress', progress: 0.4 }), { status: 200 }),
    ]);

    const pollTool = getCapturedTools(server).find((t) => t.name === 'media_higgsfield_poll');
    const pollResult = await pollTool!.handler({ jobId });
    expect(pollResult.isError).toBeFalsy();
    const structured = pollResult.structuredContent as { state: string };
    expect(structured.state).toBe('in_progress');

    expect(spy.capture).not.toHaveBeenCalled();
    expect(spy.release).not.toHaveBeenCalled();

    const row = getJobRecord({ dbPath, jobId });
    expect(row!.status).toBe('pending');
    expect(row!.actualUsd).toBeNull();
  });
});
