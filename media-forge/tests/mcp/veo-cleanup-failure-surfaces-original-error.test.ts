// tests/mcp/veo-cleanup-failure-surfaces-original-error.test.ts
// T15 part B — the test part A (T15a / commit c0415f9) didn't have.
//
// submitVeoWithLedger (register.ts) individually try/catches recordActualCost
// and releaseVideoFailed around its cleanup after a throwing submit, with an
// explicit invariant in the comment above each: "Cleanup must never replace
// the caller's error." This file proves that invariant under the harder
// case — not just "release throws" (which the comment already documents),
// but the caller actually SEEING the original error rather than whatever the
// release cleanup raised. A submit failing on a safety block or upstream
// error is far more actionable to a caller than a credit-core 500 raised
// while cleaning up after it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAllTools, type HandlersDeps } from '../../src/mcp/handlers.js';
import { openDb, closeDb, runMigrations } from '../../src/core/db.js';
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

function makeFakeClient(generateVideos: ReturnType<typeof vi.fn>): MediaForgeClient {
  return {
    mode: 'gemini',
    dryRun: false,
    ai: { models: { generateVideos } } as never,
  };
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

function readAllVideoJobRows(dbPath: string): Array<{ id: string; status: string; actual_usd: number | null }> {
  const db = openDb(dbPath);
  runMigrations(db);
  return db.prepare('SELECT id, status, actual_usd FROM video_jobs').all() as Array<{
    id: string;
    status: string;
    actual_usd: number | null;
  }>;
}

describe('T15 part B — cleanup failure must never mask the original submit error', () => {
  let tmpDir: string;
  let dbPath: string;
  let prevProjectDir: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-veo-cleanup-fail-'));
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

  it('submit throws a distinctive error AND release also throws — caller sees the SUBMIT error, not the release error', async () => {
    const server = makeMockServer();
    const generateVideos = vi.fn().mockImplementation(async () => {
      throw new Error('DISTINCTIVE_SUBMIT_FAILURE_xyz789');
    });
    const client = makeFakeClient(generateVideos);
    const release = vi.fn().mockImplementation(async () => {
      throw new Error('credit-core 500: release endpoint unreachable');
    });
    const spyClient = {
      reserve: vi.fn(async () => {}),
      capture: vi.fn(async () => {}),
      release,
      balance: vi.fn(async () => 1_000_000),
      grant: vi.fn(async () => {}),
    } as unknown as CreditClient;
    const deps: HandlersDeps = { client, config: makeFakeConfig(), creditClient: spyClient, tenantId: 't1' };
    registerAllTools(server, deps);
    const tool = getCapturedTools(server).find((t) => t.name === 'media_generate_video_t2v');
    expect(tool).toBeDefined();

    const result = await tool!.handler({ op: 't2v', prompt: 'will fail, and cleanup will also fail' });

    // The caller must see the SUBMIT's error, not the release cleanup's error.
    expect(result.isError).toBe(true);
    const text = JSON.stringify(result.content);
    expect(text).toContain('DISTINCTIVE_SUBMIT_FAILURE_xyz789');
    expect(text).not.toContain('credit-core 500');

    // Release WAS attempted (and failed) — proves this isn't passing by
    // accident because release was skipped.
    expect(release).toHaveBeenCalledTimes(1);

    // The row still settles as failed at $0 despite the release failure —
    // recordActualCost is in its own try/catch, independent of release's.
    const rows = readAllVideoJobRows(dbPath);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.actual_usd).toBe(0);
  });
});
