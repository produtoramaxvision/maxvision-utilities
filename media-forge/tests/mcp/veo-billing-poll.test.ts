// tests/mcp/veo-billing-poll.test.ts
// T15/PR3b — Veo completion path (media_poll_video_operation).
//
// The deferral comment this task replaces claimed completion couldn't be
// correlated back to a submit. That was wrong: media_poll_video_operation
// already receives `operationName` — the same id the submit returns, now
// bound to our internal jobId via setJobNativeTaskId at submit time (see
// tests/mcp/veo-billing-submit.test.ts). This file proves the poll handler
// resolves that correlation (findJobByNativeTaskId) and settles the row:
// capture on done+success, release on done+failure, and does nothing when
// the operation isn't done yet or when no row exists at all (self-host,
// dry-run, or a job that predates this correlation).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAllTools, type HandlersDeps } from '../../src/mcp/handlers.js';
import { recordJob, setJobNativeTaskId, getJobRecord } from '../../src/core/cost-tracker.js';
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

function makeFakeClient(getVideosOperation: ReturnType<typeof vi.fn>): MediaForgeClient {
  return {
    mode: 'gemini',
    dryRun: false,
    ai: { operations: { getVideosOperation } } as never,
  };
}

function spyCreditClient(balance = 1_000_000) {
  const capture = vi.fn(async () => {});
  const release = vi.fn(async () => {});
  const client = {
    reserve: vi.fn(async () => {}),
    capture,
    release,
    balance: vi.fn(async () => balance),
    grant: vi.fn(async () => {}),
  };
  return { client: client as unknown as CreditClient, capture, release };
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

describe('T15/PR3b — Veo poll settlement (media_poll_video_operation)', () => {
  let tmpDir: string;
  let dbPath: string;
  let prevProjectDir: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-veo-billing-poll-'));
    dbPath = join(tmpDir, 'cost.db');
    prevProjectDir = process.env['MEDIA_FORGE_PROJECT_DIR'];
    process.env['MEDIA_FORGE_PROJECT_DIR'] = tmpDir;
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

  /** Seeds a pending row + native_task_id binding, simulating a prior
   *  submitVeoWithLedger call without re-driving the whole submit tool. */
  function seedPendingJob(jobId: string, nativeTaskId: string, estUsd = 0.4): void {
    recordJob({
      dbPath,
      jobId,
      provider: 'google',
      model: 'veo-3.1-generate-preview',
      mode: 't2v',
      paramsHash: 'test-hash',
      estUsd,
    });
    setJobNativeTaskId({ dbPath, jobId, nativeTaskId });
  }

  it('done + succeeded: captures and the row becomes completed', async () => {
    const server = makeMockServer();
    seedPendingJob('job-poll-ok-1', 'op-poll-ok-1', 0.4);

    const getVideosOperation = vi.fn().mockResolvedValue({
      done: true,
      response: { generatedVideos: [{ video: { uri: 'https://example/video.mp4' } }] },
    });
    const client = makeFakeClient(getVideosOperation);
    const spy = spyCreditClient();
    const deps: HandlersDeps = { client, config: makeFakeConfig(), creditClient: spy.client, tenantId: 't1' };
    registerAllTools(server, deps);
    const tool = getCapturedTools(server).find((t) => t.name === 'media_poll_video_operation');
    expect(tool).toBeDefined();

    const result = await tool!.handler({ operationName: 'op-poll-ok-1', intervalMs: 10, timeoutMs: 100 });
    expect(result.isError).toBeFalsy();

    expect(spy.capture).toHaveBeenCalledTimes(1);
    expect(spy.release).not.toHaveBeenCalled();

    const row = getJobRecord({ dbPath, jobId: 'job-poll-ok-1' });
    expect(row!.status).toBe('completed');
    expect(row!.actualUsd).toBe(0.4);
  });

  it('done + failed: releases and the row becomes failed', async () => {
    const server = makeMockServer();
    seedPendingJob('job-poll-fail-1', 'op-poll-fail-1', 0.4);

    const getVideosOperation = vi.fn().mockResolvedValue({
      done: true,
      error: { code: 500, message: 'internal' },
    });
    const client = makeFakeClient(getVideosOperation);
    const spy = spyCreditClient();
    const deps: HandlersDeps = { client, config: makeFakeConfig(), creditClient: spy.client, tenantId: 't1' };
    registerAllTools(server, deps);
    const tool = getCapturedTools(server).find((t) => t.name === 'media_poll_video_operation');

    const result = await tool!.handler({ operationName: 'op-poll-fail-1', intervalMs: 10, timeoutMs: 100 });
    // pollVideoOperation throws ApiError for a done+error operation; wrap()
    // converts that into the standard isError:true tool response.
    expect(result.isError).toBe(true);

    expect(spy.release).toHaveBeenCalledTimes(1);
    expect(spy.capture).not.toHaveBeenCalled();

    const row = getJobRecord({ dbPath, jobId: 'job-poll-fail-1' });
    expect(row!.status).toBe('failed');
    expect(row!.actualUsd).toBe(0);
  });

  it('not done (timeout): changes nothing — row stays pending, no capture/release', async () => {
    const server = makeMockServer();
    seedPendingJob('job-poll-pending-1', 'op-poll-pending-1', 0.4);

    // Never done within the (tiny) attempt budget below -> pollVideoOperation
    // throws PollingError, which is NOT an ApiError, so the poll handler must
    // leave the row untouched.
    const getVideosOperation = vi.fn().mockResolvedValue({ done: false });
    const client = makeFakeClient(getVideosOperation);
    const spy = spyCreditClient();
    const deps: HandlersDeps = { client, config: makeFakeConfig(), creditClient: spy.client, tenantId: 't1' };
    registerAllTools(server, deps);
    const tool = getCapturedTools(server).find((t) => t.name === 'media_poll_video_operation');

    const result = await tool!.handler({ operationName: 'op-poll-pending-1', intervalMs: 1, timeoutMs: 1 });
    expect(result.isError).toBe(true); // PollingError surfaces as a tool error, same as before this change

    expect(spy.capture).not.toHaveBeenCalled();
    expect(spy.release).not.toHaveBeenCalled();

    const row = getJobRecord({ dbPath, jobId: 'job-poll-pending-1' });
    expect(row!.status).toBe('pending');
    expect(row!.actualUsd).toBeNull();
  });

  it('unknown operationName: no matching row — still returns the poll result and does not throw', async () => {
    const server = makeMockServer();
    // deliberately NOT seeding any row for this operationName.
    const getVideosOperation = vi.fn().mockResolvedValue({
      done: true,
      response: { generatedVideos: [{ video: { uri: 'https://example/video.mp4' } }] },
    });
    const client = makeFakeClient(getVideosOperation);
    const spy = spyCreditClient();
    const deps: HandlersDeps = { client, config: makeFakeConfig(), creditClient: spy.client, tenantId: 't1' };
    registerAllTools(server, deps);
    const tool = getCapturedTools(server).find((t) => t.name === 'media_poll_video_operation');

    const result = await tool!.handler({
      operationName: 'op-never-recorded',
      intervalMs: 10,
      timeoutMs: 100,
    });

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { operation: unknown };
    expect(structured.operation).toBeDefined();
    expect(spy.capture).not.toHaveBeenCalled();
    expect(spy.release).not.toHaveBeenCalled();
  });
});
