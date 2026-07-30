// tests/mcp/cost-guard-retake-reserve.test.ts
// T14 at the integration point — checkCostGuardOrThrow inside registerAllTools.
//
// The pure evaluateCostGuard unit tests live in
// tests/unit/core/cost-guard-reserve.test.ts. This file covers the part they
// cannot: that the config values actually reach the guard, and that a reserve
// block surfaces to the MCP caller as kind 'retake-reserve' with the NEW-WORK
// budget as limitUsd rather than the full daily cap.
//
// That distinction is the whole point of the third error kind. A client shown
// `kind: 'daily-cap', limitUsd: 25` when the cap is $25 and only $22.50 was
// actually available will tell the user to raise a cap they never hit.

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

/**
 * kling-v3-pro is $0.168/s; the motion-brush schema caps durationSec at 10, so a
 * full-length call estimates $1.68. Every case below is built around that one
 * number so the arithmetic stays checkable by hand.
 */
const ESTIMATE_USD = 1.68;

function callMotionBrush(config: MediaForgeConfig) {
  const server = makeMockServer();
  const deps: HandlersDeps = { client: makeFakeClient(), config };
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

describe('T14 retake reserve — MCP integration', () => {
  let tmpDir: string;
  let dbPath: string;
  let prevProjectDir: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-retake-reserve-'));
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

  it('blocks new work that fits the daily cap but not the new-work budget, in cap mode', async () => {
    // Cap $2.00 with a 10% reserve leaves $1.80 for new work. The $1.68 estimate
    // fits the cap and fits the new-work budget, so raise the reserve to 50%:
    // $1.00 available, $1.68 requested. blockThresholdUsd is lifted above the
    // estimate so this can only be the reserve firing, not the per-call limit.
    const result = await callMotionBrush(
      makeFakeConfig({
        dailyCapUsd: 2.0,
        blockThresholdUsd: 5.0,
        budgetReservePct: 0.5,
        budgetReserveMode: 'cap',
      }),
    );

    expect(result.isError).toBe(true);
    const text = JSON.stringify(result.content);
    expect(text).toContain('MEDIA_FORGE_BUDGET_RESERVE_PCT');
    expect(text).toContain('reserved for reviewer retakes');
    // The user must not be told to raise a cap they did not reach.
    expect(text).not.toContain('exceeds the daily cap');
  });

  it('names the new-work budget rather than the daily cap as the limit that was hit', async () => {
    // This originally asserted only the message text, because the MCP envelope
    // dropped every structured field and `kind` never reached the client. That
    // gap has since been closed in plumbing.ts, so the structured assertion below
    // is the real one and this stays as the human-readable half.
    const result = await callMotionBrush(
      makeFakeConfig({
        dailyCapUsd: 2.0,
        blockThresholdUsd: 5.0,
        budgetReservePct: 0.5,
        budgetReserveMode: 'cap',
      }),
    );

    const text = JSON.stringify(result.content);
    // $2.00 cap, 50% reserved -> $1.00 is what new work could actually spend.
    expect(text).toContain('$1.00 available to new generations');
    expect(text).toContain('$1.00 of the $2.00 daily cap');
    // The remedy offered must be the reserve, not "raise the cap you did not hit".
    expect(text).toContain('MEDIA_FORGE_BUDGET_RESERVE_MODE=warn');
  });

  it('surfaces kind "retake-reserve" and the new-work budget as structured fields', async () => {
    // The machine-readable half. A client shown kind:'daily-cap' with
    // limitUsd equal to the full cap would tell the user to raise a cap they
    // never reached; the three kinds exist because the remedies differ.
    const result = await callMotionBrush(
      makeFakeConfig({
        dailyCapUsd: 2.0,
        blockThresholdUsd: 5.0,
        budgetReservePct: 0.5,
        budgetReserveMode: 'cap',
      }),
    );

    const structured = result.structuredContent as {
      error?: boolean;
      code?: string;
      kind?: string;
      limitUsd?: number;
      estimateUsd?: number;
    };

    expect(structured.error).toBe(true);
    expect(structured.code).toBe('COST_GUARD');
    expect(structured.kind).toBe('retake-reserve');
    // $2.00 cap with 50% reserved -> $1.00 was what new work could spend.
    expect(structured.limitUsd).toBeCloseTo(1.0, 6);
    expect(structured.limitUsd).not.toBeCloseTo(2.0, 6);
    expect(structured.estimateUsd).toBeCloseTo(ESTIMATE_USD, 6);
  });

  it('a hard per-call block reports kind "block", distinguishable without parsing text', async () => {
    const result = await callMotionBrush(
      makeFakeConfig({ dailyCapUsd: 25, blockThresholdUsd: 1.0 }),
    );
    const structured = result.structuredContent as { kind?: string; limitUsd?: number };
    expect(structured.kind).toBe('block');
    expect(structured.limitUsd).toBeCloseTo(1.0, 6);
  });

  it('is inert in the default observe mode even when the estimate is inside the reserve', async () => {
    // Identical numbers to the blocking case, mode left at the shipped default.
    // If this ever starts blocking, an existing install's budget silently shrank.
    const result = await callMotionBrush(
      makeFakeConfig({
        dailyCapUsd: 2.0,
        blockThresholdUsd: 5.0,
        budgetReservePct: 0.5,
        // budgetReserveMode omitted -> 'observe'
      }),
    );

    // The guard allows, so the handler proceeds to the provider. Without Kling
    // credentials that fails at submit — which is fine and is the point: the
    // failure is NOT a cost guard block.
    const text = JSON.stringify(result.content);
    expect(text).not.toContain('MEDIA_FORGE_BUDGET_RESERVE_PCT');
    expect(text).not.toContain('retake-reserve');
  });

  it('warn mode surfaces the reserve as a costWarning instead of blocking', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { task_id: 'kling-reserve-warn' } }),
    }) as unknown as typeof fetch;
    process.env['KLING_ACCESS_KEY'] = 'ak_test';
    process.env['KLING_SECRET_KEY'] = 'sk_test';

    try {
      const result = await callMotionBrush(
        makeFakeConfig({
          dailyCapUsd: 2.0,
          blockThresholdUsd: 5.0,
          confirmThresholdUsd: 5.0, // keep the confirm warning out of the way
          budgetReservePct: 0.5,
          budgetReserveMode: 'warn',
        }),
      );

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as { costWarning?: string };
      expect(structured.costWarning).toContain('MEDIA_FORGE_BUDGET_RESERVE_PCT');
      expect(structured.costWarning).toContain('reserve mode is "warn"');
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env['KLING_ACCESS_KEY'];
      delete process.env['KLING_SECRET_KEY'];
    }
  });

  it('the hard per-call block still wins over the reserve', async () => {
    // Both would fire. The per-call limit is the stricter, more specific failure
    // and must be the one reported, otherwise the user shrinks their reserve and
    // hits the same wall again.
    const result = await callMotionBrush(
      makeFakeConfig({
        dailyCapUsd: 25,
        blockThresholdUsd: 1.0, // 1.68 > 1.00
        budgetReservePct: 0.9,
        budgetReserveMode: 'cap',
      }),
    );

    expect(result.isError).toBe(true);
    const text = JSON.stringify(result.content);
    expect(text).toContain('MEDIA_FORGE_BLOCK_THRESHOLD_USD');
    expect(text).not.toContain('MEDIA_FORGE_BUDGET_RESERVE_PCT');
    expect(text).not.toContain('reserved for reviewer retakes');
  });

  it('a reserve of 0 disables the feature entirely, even in cap mode', async () => {
    const result = await callMotionBrush(
      makeFakeConfig({
        dailyCapUsd: 2.0,
        blockThresholdUsd: 5.0,
        budgetReservePct: 0,
        budgetReserveMode: 'cap',
      }),
    );

    const text = JSON.stringify(result.content);
    expect(text).not.toContain('MEDIA_FORGE_BUDGET_RESERVE_PCT');
    expect(ESTIMATE_USD).toBeLessThan(2.0); // the estimate does fit the cap
  });
});
