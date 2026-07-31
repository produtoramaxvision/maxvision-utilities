// tests/mcp/dry-run-request-field.test.ts
// The per-request `dryRun` field, end-to-end through registerAllTools.
//
// Every image and video schema declares `dryRun: z.boolean().default(false)`,
// and nothing read it. Only `client.dryRun` — fixed when the server was
// constructed — decided anything. A caller passing `dryRun: true` to a normal
// server got a real generation and a real charge from a parameter that reads
// like a safety, with no error and no warning.
//
// The contract asserted here is deliberately ASYMMETRIC: the request may only
// ever ADD dry-run, never remove it. A server started in dry-run mode stays dry
// whatever the request says, because the other direction would let a caller
// switch a safety off.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAllTools, type HandlersDeps } from '../../src/mcp/handlers.js';
import { closeDb } from '../../src/core/db.js';
import type { MediaForgeConfig } from '../../src/core/config.js';
import type { MediaForgeClient } from '../../src/core/client.js';
import type { CreditClient } from '../../src/billing/credit-client.js';

function makeMockServer() {
  return { registerTool: vi.fn() } as unknown as McpServer;
}

function makeFakeConfig(): MediaForgeConfig {
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
  }) as MediaForgeConfig;
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

function spyCreditClient() {
  const reserve = vi.fn(async () => {});
  const capture = vi.fn(async () => {});
  const release = vi.fn(async () => {});
  return {
    client: {
      reserve,
      capture,
      release,
      balance: vi.fn(async () => 1_000_000),
      grant: vi.fn(async () => {}),
    } as unknown as CreditClient,
    reserve,
    capture,
    release,
  };
}

const FAKE_IMAGE_RESPONSE = {
  promptFeedback: undefined,
  candidates: [
    {
      finishReason: 'STOP',
      content: { parts: [{ inlineData: { data: 'ZmFrZQ==', mimeType: 'image/png' } }] },
    },
  ],
};

describe('per-request dryRun is honoured', () => {
  let tmpDir: string;
  let dbPath: string;
  let prevProjectDir: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-dryrun-request-'));
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

  // The defect, stated as a test: a normal server, billing on, and a request
  // that asks not to spend anything.
  it('media_generate_image: dryRun:true on a NON-dry-run client reaches neither the provider nor the credit client', async () => {
    const server = makeMockServer();
    const spy = spyCreditClient();
    const generateContent = vi.fn().mockResolvedValue(FAKE_IMAGE_RESPONSE);
    const client: MediaForgeClient = {
      mode: 'gemini',
      dryRun: false,
      ai: { models: { generateContent } } as never,
    };
    const deps: HandlersDeps = {
      client,
      config: makeFakeConfig(),
      creditClient: spy.client,
      tenantId: 't-req-dry',
    };
    registerAllTools(server, deps);
    const tool = getCapturedTools(server).find((t) => t.name === 'media_generate_image');
    expect(tool).toBeDefined();

    const result = await tool!.handler({ op: 'nano-banana-pro', prompt: 'a test image', dryRun: true });

    expect(result.isError).toBeFalsy();
    expect(generateContent).not.toHaveBeenCalled();
    expect(spy.reserve).not.toHaveBeenCalled();
    expect(spy.capture).not.toHaveBeenCalled();
  });

  // Without this, the fix above would be indistinguishable from "always dry-run".
  it('media_generate_image: dryRun omitted still generates and still charges', async () => {
    const server = makeMockServer();
    const spy = spyCreditClient();
    const generateContent = vi.fn().mockResolvedValue(FAKE_IMAGE_RESPONSE);
    const client: MediaForgeClient = {
      mode: 'gemini',
      dryRun: false,
      ai: { models: { generateContent } } as never,
    };
    const deps: HandlersDeps = {
      client,
      config: makeFakeConfig(),
      creditClient: spy.client,
      tenantId: 't-req-real',
    };
    registerAllTools(server, deps);
    const tool = getCapturedTools(server).find((t) => t.name === 'media_generate_image');

    const result = await tool!.handler({ op: 'nano-banana-pro', prompt: 'a real image' });

    expect(result.isError).toBeFalsy();
    expect(generateContent).toHaveBeenCalled();
    expect(spy.reserve).toHaveBeenCalled();
    expect(spy.capture).toHaveBeenCalled();
  });

  // The asymmetry. dryRun defaults to false in the schema, so EVERY request
  // against a dry-run server carries dryRun:false — if the request won, a
  // server started with --dry-run would generate for real on every call.
  it('media_generate_image: dryRun:false CANNOT turn off a dry-run client', async () => {
    const server = makeMockServer();
    const spy = spyCreditClient();
    const generateContent = vi.fn().mockResolvedValue(FAKE_IMAGE_RESPONSE);
    const client: MediaForgeClient = {
      mode: 'gemini',
      dryRun: true,
      ai: { models: { generateContent } } as never,
    };
    const deps: HandlersDeps = {
      client,
      config: makeFakeConfig(),
      creditClient: spy.client,
      tenantId: 't-req-override',
    };
    registerAllTools(server, deps);
    const tool = getCapturedTools(server).find((t) => t.name === 'media_generate_image');

    const result = await tool!.handler({ op: 'nano-banana-pro', prompt: 'x', dryRun: false });

    expect(result.isError).toBeFalsy();
    expect(generateContent).not.toHaveBeenCalled();
    expect(spy.reserve).not.toHaveBeenCalled();
  });

  // Video costs an order of magnitude more than an image, so the same field
  // meaning nothing there is the more expensive half of the same defect.
  it('media_generate_video_t2v: dryRun:true on a NON-dry-run client never submits and never reserves', async () => {
    const server = makeMockServer();
    const spy = spyCreditClient();
    const generateVideos = vi.fn().mockResolvedValue({ name: 'operations/should-not-happen' });
    const client: MediaForgeClient = {
      mode: 'gemini',
      dryRun: false,
      ai: { models: { generateVideos } } as never,
    };
    const deps: HandlersDeps = {
      client,
      config: makeFakeConfig(),
      creditClient: spy.client,
      tenantId: 't-req-video',
    };
    registerAllTools(server, deps);
    const tool = getCapturedTools(server).find((t) => t.name === 'media_generate_video_t2v');
    expect(tool).toBeDefined();

    const result = await tool!.handler({ op: 't2v', prompt: 'a test clip', dryRun: true });

    expect(result.isError).toBeFalsy();
    expect(generateVideos).not.toHaveBeenCalled();
    expect(spy.reserve).not.toHaveBeenCalled();
  });
});
