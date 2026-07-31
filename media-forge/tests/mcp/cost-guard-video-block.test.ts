// tests/mcp/cost-guard-video-block.test.ts
// Proves a Kling video tool returns { isError: true } when the cost guard
// blocks — end to end through registerAllTools -> wrap() -> checkCostGuard.
// No fetch mock needed: the guard runs BEFORE provider.generate() ever
// reaches the network (estimateCostUSD is pure), so a blocked call never
// touches KLING_ACCESS_KEY/SECRET or global.fetch at all.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAllTools, type HandlersDeps } from '../../src/mcp/handlers.js';
import type { MediaForgeConfig } from '../../src/core/config.js';
import type { MediaForgeClient } from '../../src/core/client.js';
import { closeDb } from '../../src/core/db.js';

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

describe('media-forge cost guard — video tool block returns isError', () => {
  let tmpDir: string;
  let dbPath: string;
  let prevProjectDir: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-cost-guard-block-'));
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

  it('media_kling_motion_brush returns isError:true when the estimate exceeds a low blockThresholdUsd', async () => {
    // kling-v3-pro is usd-per-second @ 0.168; durationSec 10 (the schema max
    // for motion-brush) -> estimate $1.68. Set blockThresholdUsd below that
    // so the guard deterministically blocks without needing a huge duration.
    const server = makeMockServer();
    const deps: HandlersDeps = {
      client: makeFakeClient(),
      config: makeFakeConfig({ blockThresholdUsd: 1.0 }),
      // no creditClient/tenantId — billing off, preflightVideoCredit is a no-op.
    };
    registerAllTools(server, deps);
    const tools = getCapturedTools(server);
    const tool = tools.find((t) => t.name === 'media_kling_motion_brush');
    expect(tool).toBeDefined();

    const result = await tool!.handler({
      prompt: 'wave the flag',
      imageUrl: 'https://example/scene.png',
      regions: [{ id: 'flag', polygon: [[0, 0], [200, 0], [200, 100]], motionVector: [30, -10] }],
      durationSec: 10,
    });

    expect(result.isError).toBe(true);
    const text = JSON.stringify(result.content);
    expect(text).toContain('CostGuardError');
    expect(text).toMatch(/1\.68/);
    expect(text).toContain('MEDIA_FORGE_BLOCK_THRESHOLD_USD');
  });

  it('media_kling_motion_brush allows + surfaces costWarning when only the confirm threshold is exceeded', async () => {
    const server = makeMockServer();
    const deps: HandlersDeps = {
      client: makeFakeClient(),
      config: makeFakeConfig({ confirmThresholdUsd: 0.1 }), // 1.68 > 0.1, but < blockThreshold(2.0) and < dailyCap
    };
    registerAllTools(server, deps);
    const tools = getCapturedTools(server);
    const tool = tools.find((t) => t.name === 'media_kling_motion_brush');
    expect(tool).toBeDefined();

    const fetchImpl = undefined; // real fetch would fire here since the guard allows — but Kling
    // submit doesn't accept a fetchImpl override via the registered MCP tool path, so this test
    // only asserts the warning is attached; it does not assert network behavior.
    void fetchImpl;

    // Stub global.fetch so provider.generate() (called after the guard allows)
    // doesn't hit the real network.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { task_id: 'kling-task-1' } }),
    }) as unknown as typeof fetch;
    process.env['KLING_ACCESS_KEY'] = 'ak_test';
    process.env['KLING_SECRET_KEY'] = 'sk_test';

    try {
      const result = await tool!.handler({
        prompt: 'wave the flag',
        imageUrl: 'https://example/scene.png',
        regions: [{ id: 'flag', polygon: [[0, 0], [200, 0], [200, 100]], motionVector: [30, -10] }],
        durationSec: 10,
      });

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as { costWarning?: string };
      expect(structured.costWarning).toBeDefined();
      expect(structured.costWarning).toContain('MEDIA_FORGE_CONFIRM_THRESHOLD_USD');
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env['KLING_ACCESS_KEY'];
      delete process.env['KLING_SECRET_KEY'];
    }
  });
});
