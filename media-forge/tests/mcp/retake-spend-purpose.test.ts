// tests/mcp/retake-spend-purpose.test.ts
// T11/T14 — HandlersDeps.spendPurpose reaching the cost guard.
//
// This is the loop closure for the retake protocol: router.ts computes
// `spendsCredit`/`spendPurposeFor` from the triage, but nothing stops there
// unless a dispatcher actually threads `spendPurpose: 'retake'` into
// HandlersDeps and `checkCostGuardOrThrow` (register.ts:213) actually reads it
// before every provider call. tests/mcp/cost-guard-retake-reserve.test.ts
// already proves the reserve math and the wire-format of the block message;
// this file proves the one thing that file does not: that
// `deps.spendPurpose` — the field router.ts's spendPurposeFor is FOR — is the
// thing that flips the guard from blocking to allowing the exact same call.
//
// Modeled directly on cost-guard-retake-reserve.test.ts's harness
// (makeFakeConfig / makeMockServer / getCapturedTools) so the two files stay
// readable side by side.

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
    budgetReservePct: 0.1,
    budgetReserveMode: 'observe' as const,
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
  handler: (input: unknown) => Promise<{
    content: unknown;
    isError?: boolean;
    structuredContent?: unknown;
  }>;
}

function getCapturedTools(server: McpServer): CapturedTool[] {
  const mock = server as unknown as { registerTool: ReturnType<typeof vi.fn> };
  return mock.registerTool.mock.calls.map(([name, , handler]) => ({
    name: name as string,
    handler: handler as CapturedTool['handler'],
  }));
}

// kling-v3-pro is $0.168/s; the motion-brush schema caps durationSec at 10, so a
// full-length call estimates $1.68 — same fixture number as
// cost-guard-retake-reserve.test.ts, kept identical so both files' arithmetic
// is checkable against the same one config.

function callMotionBrush(deps: HandlersDeps) {
  const server = makeMockServer();
  registerAllTools(server, deps);
  const tool = getCapturedTools(server).find((t) => t.name === 'media_kling_motion_brush');
  expect(tool).toBeDefined();
  return tool!.handler({
    prompt: 'wave the flag',
    imageUrl: 'https://example/scene.png',
    regions: [{ id: 'flag', polygon: [[0, 0], [200, 0], [200, 100]], motionVector: [30, -10] }],
    durationSec: 10,
  });
}

// Cap $2.00 with a 50% reserve leaves $1.00 for new work; the $1.68 estimate
// clears the daily cap but not the new-work budget, so 'cap' mode blocks it —
// UNLESS the caller is a retake, which is exactly what this reserve exists for.
const RESERVE_CONFIG = {
  dailyCapUsd: 2.0,
  blockThresholdUsd: 5.0,
  budgetReservePct: 0.5,
  budgetReserveMode: 'cap' as const,
};

describe('T11/T14 — HandlersDeps.spendPurpose reaches the cost guard', () => {
  let tmpDir: string;
  let dbPath: string;
  let prevProjectDir: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-retake-spend-purpose-'));
    dbPath = join(tmpDir, 'cost.db');
    prevProjectDir = process.env['MEDIA_FORGE_PROJECT_DIR'];
    process.env['MEDIA_FORGE_PROJECT_DIR'] = tmpDir;
  });

  afterEach(() => {
    closeDb(dbPath);
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // EPERM on Windows — the OS reclaims the temp dir.
    }
    if (prevProjectDir === undefined) delete process.env['MEDIA_FORGE_PROJECT_DIR'];
    else process.env['MEDIA_FORGE_PROJECT_DIR'] = prevProjectDir;
    vi.restoreAllMocks();
  });

  it('deps.spendPurpose "retake" is NOT blocked by a reserve that would block new work', async () => {
    const result = await callMotionBrush({
      client: makeFakeClient(),
      config: makeFakeConfig(RESERVE_CONFIG),
      spendPurpose: 'retake',
    });

    // This is the whole point of T14's reserve: a retake is allowed exactly
    // where new work is not, using the identical estimate and config.
    const text = JSON.stringify(result.content);
    expect(text).not.toContain('reserved for reviewer retakes');
    expect(text).not.toContain('MEDIA_FORGE_BUDGET_RESERVE_PCT');
  });

  it('the same call with spendPurpose omitted IS blocked (proves the field above is load-bearing)', async () => {
    const result = await callMotionBrush({
      client: makeFakeClient(),
      config: makeFakeConfig(RESERVE_CONFIG),
      // spendPurpose omitted — checkCostGuardOrThrow's default (register.ts:213)
      // must fall back to 'new', the conservative reading for a dispatcher
      // that has not opted a call into the retake reserve.
    });

    expect(result.isError).toBe(true);
    const text = JSON.stringify(result.content);
    expect(text).toContain('reserved for reviewer retakes');
    expect(text).toContain('MEDIA_FORGE_BUDGET_RESERVE_PCT');
  });
});
