/**
 * Tests for src/mcp/server.ts (P8.1)
 *
 * Covers:
 * 1. buildServer() returns an McpServer instance
 * 2. Server advertises name 'media-forge', version '0.1.1'
 * 3. startStdioServer() calls server.connect (via McpServer.prototype spy)
 * 4. buildServer() does NOT write to stdout
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildServer } from '../../../src/mcp/server.js';
import type { MediaForgeConfig } from '../../../src/core/config.js';
import type { MediaForgeClient } from '../../../src/core/client.js';

// ---------------------------------------------------------------------------
// Minimal fakes for injection — avoids touching real env / network
// ---------------------------------------------------------------------------

function makeFakeConfig(): MediaForgeConfig {
  return Object.freeze({
    apiKey: 'test-api-key',
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
  });
}

function makeFakeClient(): MediaForgeClient {
  return Object.freeze({
    mode: 'gemini' as const,
    dryRun: false,
    ai: {} as never,
  });
}

// ---------------------------------------------------------------------------
// D-6: boot validation requires MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT.
// Set a valid value for all tests in this file.
// ---------------------------------------------------------------------------
let _prevPricingEnv: string | undefined;
beforeAll(() => {
  _prevPricingEnv = process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
  process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = '0.039';
});
afterAll(() => {
  if (_prevPricingEnv === undefined) delete process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
  else process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = _prevPricingEnv;
});

// ---------------------------------------------------------------------------
// Test 1 & 2: buildServer identity
// ---------------------------------------------------------------------------
describe('buildServer()', () => {
  it('returns an McpServer instance', () => {
    const server = buildServer({ config: makeFakeConfig(), client: makeFakeClient() });
    expect(server).toBeInstanceOf(McpServer);
  });

  it('returned server has connect method', () => {
    const server = buildServer({ config: makeFakeConfig(), client: makeFakeClient() });
    expect(typeof server.connect).toBe('function');
  });

  it('server advertises name=media-forge and version=0.1.0', () => {
    const server = buildServer({ config: makeFakeConfig(), client: makeFakeClient() });
    // McpServer wraps a lower-level Server at .server._serverInfo
    const inner = (
      server as unknown as {
        server: { _serverInfo: { name: string; version: string } };
      }
    ).server;
    expect(inner._serverInfo.name).toBe('media-forge');
    expect(inner._serverInfo.version).toBe('0.1.1');
  });
});

// ---------------------------------------------------------------------------
// Test 3: startStdioServer() connects to transport
// Uses McpServer.prototype.connect spy to observe the call without running
// actual stdio transport (which would block on stdin).
// ---------------------------------------------------------------------------
describe('startStdioServer()', () => {
  it('calls server.connect exactly once', async () => {
    const connectSpy = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(McpServer.prototype, 'connect').mockImplementationOnce(connectSpy as never);

    process.env['GOOGLE_API_KEY'] = 'smoke-key-for-startStdio-test';
    try {
      // Dynamic import to get the function (module already loaded in Node cache, spy applies)
      const { startStdioServer } = await import('../../../src/mcp/server.js');
      await startStdioServer();
      expect(connectSpy).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env['GOOGLE_API_KEY'];
      vi.restoreAllMocks();
    }
  });
});

// ---------------------------------------------------------------------------
// Test 4: buildServer() does NOT write to process.stdout
// ---------------------------------------------------------------------------
describe('stdout isolation', () => {
  let originalWrite: typeof process.stdout.write;
  let stdoutCalls: string[];

  beforeEach(() => {
    stdoutCalls = [];
    originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown) => {
      stdoutCalls.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
  });

  it('buildServer() writes nothing to stdout', () => {
    buildServer({ config: makeFakeConfig(), client: makeFakeClient() });
    expect(stdoutCalls).toHaveLength(0);
  });
});
