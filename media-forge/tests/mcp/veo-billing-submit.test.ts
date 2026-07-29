// tests/mcp/veo-billing-submit.test.ts
// T15/PR3b — Veo submit-before-reserve ledger.
//
// Prior state (see .maxvision/plans/2026-07-29-higgsfield-kling-api-refresh.md,
// T15): Veo never called recordJob at all. GoogleVeoProvider.generate() is the
// only site that does, and it is never invoked from the MCP tools — they call
// generateVideoT2V/I2V/etc. directly. Net effect: no video_jobs row, no cost
// guard, no credit reserve, and dailySpendUsd blind to every Veo generation
// (the daily cap silently undercounted, and Veo was free in hosted mode).
//
// This file proves the fix end-to-end through registerAllTools -> wrap() ->
// submitVeoWithLedger, mirroring the style of cost-guard-video-block.test.ts
// and debit-wiring.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAllTools, type HandlersDeps } from '../../src/mcp/handlers.js';
import { dailySpendUsd, getJobRecord } from '../../src/core/cost-tracker.js';
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

function makeFakeClient(generateVideos: ReturnType<typeof vi.fn>, dryRun = false): MediaForgeClient {
  return {
    mode: 'gemini',
    dryRun,
    ai: { models: { generateVideos } } as never,
  };
}

/** Spy CreditClient mirroring tests/unit/billing/debit-wiring.test.ts's spyClient. */
function spyCreditClient(balance: number) {
  const calls: string[] = [];
  const reserve = vi.fn(async () => {
    calls.push('reserve');
  });
  const capture = vi.fn(async () => {
    calls.push('capture');
  });
  const release = vi.fn(async () => {
    calls.push('release');
  });
  const client = {
    reserve,
    capture,
    release,
    balance: vi.fn(async () => balance),
    grant: vi.fn(async () => {}),
  };
  return { client: client as unknown as CreditClient, calls, reserve, capture, release };
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

/** Reads every video_jobs row directly — used when a thrown-error response
 *  (text-only, no structuredContent) means the jobId can't be read off the
 *  tool's return value. Safe because each test gets a fresh, isolated tmp DB. */
function readAllVideoJobRows(dbPath: string): Array<{ id: string; status: string; actual_usd: number | null }> {
  const db = openDb(dbPath);
  runMigrations(db); // dry-run tests never touch the DB, so the table may not exist yet
  return db.prepare('SELECT id, status, actual_usd FROM video_jobs').all() as Array<{
    id: string;
    status: string;
    actual_usd: number | null;
  }>;
}

describe('T15/PR3b — Veo submit ledger (media_generate_video_t2v)', () => {
  let tmpDir: string;
  let dbPath: string;
  let prevProjectDir: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-veo-billing-submit-'));
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

  it('records a pending video_jobs row whose native_task_id equals the returned operationName', async () => {
    const server = makeMockServer();
    const generateVideos = vi.fn().mockResolvedValue({ name: 'op-abc-123' });
    const client = makeFakeClient(generateVideos);
    const spy = spyCreditClient(1_000_000);
    const deps: HandlersDeps = { client, config: makeFakeConfig(), creditClient: spy.client, tenantId: 't1' };
    registerAllTools(server, deps);
    const tool = getCapturedTools(server).find((t) => t.name === 'media_generate_video_t2v');
    expect(tool).toBeDefined();

    const result = await tool!.handler({ op: 't2v', prompt: 'a timelapse' });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { jobId: string; operationName: string };
    expect(structured.jobId).toBeTruthy();
    expect(structured.operationName).toBe('op-abc-123');

    const row = getJobRecord({ dbPath, jobId: structured.jobId });
    expect(row).not.toBeNull();
    expect(row!.provider).toBe('google');
    expect(row!.status).toBe('pending');
    expect(row!.nativeTaskId).toBe('op-abc-123');
  });

  it('dailySpendUsd counts the pending Veo job — the regression this task fixes', async () => {
    const server = makeMockServer();
    const generateVideos = vi.fn().mockResolvedValue({ name: 'op-count-1' });
    const client = makeFakeClient(generateVideos);
    const spy = spyCreditClient(1_000_000);
    const deps: HandlersDeps = { client, config: makeFakeConfig(), creditClient: spy.client, tenantId: 't1' };
    registerAllTools(server, deps);
    const tool = getCapturedTools(server).find((t) => t.name === 'media_generate_video_t2v');

    expect(dailySpendUsd({ dbPath, tenantId: 't1' })).toBe(0);
    const result = await tool!.handler({ op: 't2v', prompt: 'count me' });
    expect(result.isError).toBeFalsy();
    // t2v defaults to 720p + audio -> VEO_PRICE['720p'].withAudio = $0.40
    expect(dailySpendUsd({ dbPath, tenantId: 't1' })).toBeCloseTo(0.4, 5);
  });

  it('reserves credit BEFORE the submit; a throwing submit releases the reservation and settles the row as failed', async () => {
    const server = makeMockServer();
    const order: string[] = [];
    const generateVideos = vi.fn().mockImplementation(async () => {
      order.push('submit');
      throw new Error('upstream Veo 500');
    });
    const client = makeFakeClient(generateVideos);
    const spy = spyCreditClient(1_000_000);
    spy.reserve.mockImplementation(async () => {
      order.push('reserve');
      spy.calls.push('reserve');
    });
    const deps: HandlersDeps = { client, config: makeFakeConfig(), creditClient: spy.client, tenantId: 't1' };
    registerAllTools(server, deps);
    const tool = getCapturedTools(server).find((t) => t.name === 'media_generate_video_t2v');

    const result = await tool!.handler({ op: 't2v', prompt: 'will fail' });
    expect(result.isError).toBe(true);

    // (a) reserve fired BEFORE the submit ever reached the provider.
    expect(order).toEqual(['reserve', 'submit']);
    // (b) release fired (reservation does not leak until TTL), capture never did.
    expect(spy.release).toHaveBeenCalledTimes(1);
    expect(spy.capture).not.toHaveBeenCalled();

    // (c) the row settles as failed at $0 — never left pending at its estimate,
    // which would otherwise poison the rest of the UTC day's cap for a call
    // that cost nothing.
    const rows = readAllVideoJobRows(dbPath);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.actual_usd).toBe(0);
  });

  it('insufficient credit blocks the submit — the provider is never called', async () => {
    const server = makeMockServer();
    const generateVideos = vi.fn().mockResolvedValue({ name: 'should-never-happen' });
    const client = makeFakeClient(generateVideos);
    const spy = spyCreditClient(0); // far below what any estimate costs in credits
    const deps: HandlersDeps = { client, config: makeFakeConfig(), creditClient: spy.client, tenantId: 't1' };
    registerAllTools(server, deps);
    const tool = getCapturedTools(server).find((t) => t.name === 'media_generate_video_t2v');

    const result = await tool!.handler({ op: 't2v', prompt: 'no balance' });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('InsufficientCreditError');

    expect(generateVideos).not.toHaveBeenCalled();
    expect(spy.reserve).not.toHaveBeenCalled();
    // no row at all — preflight runs before recordJob.
    expect(readAllVideoJobRows(dbPath)).toHaveLength(0);
  });

  it('the cost guard blocks a submit over the block threshold — the provider is never called', async () => {
    const server = makeMockServer();
    const generateVideos = vi.fn().mockResolvedValue({ name: 'should-never-happen' });
    const client = makeFakeClient(generateVideos);
    const spy = spyCreditClient(1_000_000);
    // t2v default estimate is $0.40 (720p + audio) — set the block threshold
    // below that so the guard deterministically blocks.
    const deps: HandlersDeps = {
      client,
      config: makeFakeConfig({ blockThresholdUsd: 0.1 }),
      creditClient: spy.client,
      tenantId: 't1',
    };
    registerAllTools(server, deps);
    const tool = getCapturedTools(server).find((t) => t.name === 'media_generate_video_t2v');

    const result = await tool!.handler({ op: 't2v', prompt: 'too expensive' });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('CostGuardError');

    expect(generateVideos).not.toHaveBeenCalled();
    expect(spy.reserve).not.toHaveBeenCalled();
    expect(readAllVideoJobRows(dbPath)).toHaveLength(0);
  });

  it('dry-run does none of it: no row, no reserve, no capture, provider not double-billed', async () => {
    const server = makeMockServer();
    // generateVideoT2V short-circuits internally on client.dryRun and never
    // reaches client.ai.models.generateVideos — assert that here too.
    const generateVideos = vi.fn().mockResolvedValue({ name: 'should-never-happen' });
    const client = makeFakeClient(generateVideos, /* dryRun */ true);
    const spy = spyCreditClient(1_000_000);
    const deps: HandlersDeps = { client, config: makeFakeConfig(), creditClient: spy.client, tenantId: 't1' };
    registerAllTools(server, deps);
    const tool = getCapturedTools(server).find((t) => t.name === 'media_generate_video_t2v');

    const result = await tool!.handler({ op: 't2v', prompt: 'dry run only' });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { operationName: string; dryRun?: boolean };
    expect(structured.dryRun).toBe(true);

    expect(generateVideos).not.toHaveBeenCalled();
    expect(spy.reserve).not.toHaveBeenCalled();
    expect(spy.capture).not.toHaveBeenCalled();
    expect(readAllVideoJobRows(dbPath)).toHaveLength(0);
    expect(dailySpendUsd({ dbPath, tenantId: 't1' })).toBe(0);
  });
});
