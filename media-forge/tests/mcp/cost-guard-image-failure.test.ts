// tests/mcp/cost-guard-image-failure.test.ts
// Proves a FAILED image generation settles the image_jobs row at actualUsd:0
// / finalStatus:'failed' instead of staying 'pending' at its estimate forever
// — the same fix already applied to Kling's terminal-failure path
// (handleKlingPoll). Without this, every safety-blocked or API-erroring image
// call would permanently poison the rest of the UTC day's cap for a
// generation that cost $0 in reality.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAllTools, type HandlersDeps } from '../../src/mcp/handlers.js';
import { dailySpendUsd } from '../../src/core/cost-tracker.js';
import { closeDb } from '../../src/core/db.js';
import type { MediaForgeConfig } from '../../src/core/config.js';
import type { MediaForgeClient } from '../../src/core/client.js';

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
  handler: (input: unknown) => Promise<{ content: unknown; isError?: boolean }>;
}

function getCapturedTools(server: McpServer): CapturedTool[] {
  const mock = server as unknown as { registerTool: ReturnType<typeof vi.fn> };
  return mock.registerTool.mock.calls.map(([name, , handler]) => ({
    name: name as string,
    handler: handler as CapturedTool['handler'],
  }));
}

describe('media-forge cost guard — failed image generation does not poison the daily cap', () => {
  let tmpDir: string;
  let dbPath: string;
  let prevProjectDir: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-cost-guard-img-fail-'));
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

  it('media_generate_image: provider throw -> isError:true, and dailySpendUsd stays 0 afterward', async () => {
    const server = makeMockServer();
    const client: MediaForgeClient = {
      mode: 'gemini',
      dryRun: false, // NOT dry-run — the ledger write path must be exercised
      ai: {
        models: {
          generateContent: vi.fn().mockRejectedValue(new Error('upstream 500')),
        },
      } as never,
    };
    const deps: HandlersDeps = { client, config: makeFakeConfig() };
    registerAllTools(server, deps);
    const tool = getCapturedTools(server).find((t) => t.name === 'media_generate_image');
    expect(tool).toBeDefined();

    const result = await tool!.handler({ op: 'nano-banana-pro', prompt: 'a test image' });
    expect(result.isError).toBe(true);

    // The failed job must NOT count against the daily cap — settled at
    // actualUsd:0/finalStatus:'failed', not left 'pending' at its estimate.
    const today = new Date().toISOString().slice(0, 10);
    expect(dailySpendUsd({ dbPath, dateUtc: today })).toBe(0);
  });
});
