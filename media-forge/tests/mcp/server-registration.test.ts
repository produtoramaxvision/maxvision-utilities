/**
 * Tests for src/mcp/server.ts — runtime tool registration (P13 Task 14.5)
 *
 * Purpose: prevent the silent-fail mode where a handler exists in handlers.ts
 * but the corresponding `registerTool` call is missing, omitted, or shadowed.
 * Static-analysis tests (grep for tool name in schemas.ts) do NOT catch this;
 * the assertion below is on the live McpServer instance produced by buildServer()
 * AFTER registerAllTools has executed, so only tools whose registration actually
 * fired land in the asserted set.
 *
 * Introspection contract: SDK @modelcontextprotocol/sdk@1.29.0 stores registered
 * tools on the McpServer instance under `_registeredTools` (Record<string,
 * RegisteredTool>). The high-level McpServer class does NOT expose a public
 * listTools() method in this version, so reading the internal property is the
 * only direct way to verify registration without standing up an in-memory
 * transport and round-tripping a tools/list JSON-RPC request. If the SDK ever
 * exposes a public accessor or renames the field, update both the helper below
 * and bump the version annotation.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildServer } from '../../src/mcp/server.js';
import type { MediaForgeConfig } from '../../src/core/config.js';
import type { MediaForgeClient } from '../../src/core/client.js';

// ---------------------------------------------------------------------------
// Fakes — mirror the shape used by tests/unit/mcp/server.test.ts so the
// registration path runs without touching process.env or the network.
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
// listRegisteredToolNames — single introspection point, version-pinned.
// ---------------------------------------------------------------------------
// SDK @modelcontextprotocol/sdk@1.29.0 — registered tools live on
// McpServer._registeredTools (Record<string, RegisteredTool>). The
// ListToolsRequestSchema handler (server/mcp.js:67) iterates this same map,
// so its keys ARE the runtime tool surface. Re-check this contract on SDK
// upgrade — if the field is renamed or made private via #-prefix, both this
// helper and the version annotation above must update together.
function listRegisteredToolNames(server: McpServer): string[] {
  const internal = server as unknown as {
    _registeredTools?: Record<string, unknown>;
  };
  const tools = internal._registeredTools;
  if (!tools || typeof tools !== 'object') {
    throw new Error(
      'McpServer._registeredTools is missing or not an object — SDK shape changed; ' +
        'update listRegisteredToolNames() in tests/mcp/server-registration.test.ts',
    );
  }
  return Object.keys(tools);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCP server tool registration', () => {
  let prevPricing: string | undefined;

  beforeAll(() => {
    prevPricing = process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
    // D-6: boot validation requires this env var; set a valid value for tests.
    process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = '0.039';
  });

  afterAll(() => {
    if (prevPricing === undefined) delete process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
    else process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = prevPricing;
  });

  it('registers all 4 new P13 video provider tools', () => {
    const server = buildServer({ config: makeFakeConfig(), client: makeFakeClient() });
    const names = listRegisteredToolNames(server);

    // The full registry has 30+ tools (image, refs, help, etc.); we only
    // assert presence of the 4 new P13 additions here. Count drift is covered
    // by per-tool handler tests elsewhere — this test exists solely to catch
    // missing-registration regressions for the new surface.
    expect(names).toEqual(
      expect.arrayContaining([
        'media_video_route',
        'media_video_cost_estimate',
        'media_video_cost_report',
        'media_video_webhook_status',
      ]),
    );
  });

  it('keeps legacy Veo video tools registered (no regression)', () => {
    const server = buildServer({ config: makeFakeConfig(), client: makeFakeClient() });
    const names = listRegisteredToolNames(server);

    expect(names).toEqual(
      expect.arrayContaining([
        'media_generate_video_t2v',
        'media_generate_video_i2v',
        'media_extend_video',
      ]),
    );
  });

  it('registers all 4 new P16 Seedance tools', () => {
    const server = buildServer({ config: makeFakeConfig(), client: makeFakeClient() });
    const names = listRegisteredToolNames(server);

    expect(names).toEqual(
      expect.arrayContaining([
        'media_seedance_text_to_video',
        'media_seedance_image_to_video',
        'media_seedance_multishot',
        'media_seedance_reference_fusion',
      ]),
    );
  });

  it('registers exactly 55 tools (22 base + 4 refs + 4 routing/cost + 10 higgsfield + 10 kling + 4 seedance + 1 gallery)', () => {
    const server = buildServer({ config: makeFakeConfig(), client: makeFakeClient() });
    const names = listRegisteredToolNames(server);
    expect(names).toHaveLength(55);
  });

  it('registers exactly 51 tools when MEDIA_FORGE_SEEDANCE_ENABLED=false', () => {
    const prev = process.env['MEDIA_FORGE_SEEDANCE_ENABLED'];
    process.env['MEDIA_FORGE_SEEDANCE_ENABLED'] = 'false';
    try {
      const server = buildServer({ config: makeFakeConfig(), client: makeFakeClient() });
      const names = listRegisteredToolNames(server);
      expect(names).toHaveLength(51);
      expect(names).not.toContain('media_seedance_text_to_video');
      expect(names).not.toContain('media_seedance_image_to_video');
      expect(names).not.toContain('media_seedance_multishot');
      expect(names).not.toContain('media_seedance_reference_fusion');
    } finally {
      if (prev === undefined) delete process.env['MEDIA_FORGE_SEEDANCE_ENABLED'];
      else process.env['MEDIA_FORGE_SEEDANCE_ENABLED'] = prev;
    }
  });
});
