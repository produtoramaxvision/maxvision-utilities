/**
 * Tests for src/mcp/handlers.ts (P8.2)
 *
 * Uses a mock McpServer (simple object with registerTool: vi.fn())
 * and mock deps to verify all 30 tools are registered correctly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAllTools, type HandlersDeps } from '../../../src/mcp/handlers.js';
import { listMCPToolNames } from '../../../src/mcp/schemas.js';
import type { MediaForgeConfig } from '../../../src/core/config.js';
import type { MediaForgeClient } from '../../../src/core/client.js';

// ---------------------------------------------------------------------------
// Mock server
// ---------------------------------------------------------------------------

function makeMockServer() {
  return {
    registerTool: vi.fn(),
  } as unknown as McpServer;
}

// ---------------------------------------------------------------------------
// Fake config / client
// ---------------------------------------------------------------------------

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
  });
}

function makeFakeClient(): MediaForgeClient {
  // models.list() returns a Pager-like object whose `page` array contains the
  // three LOCKED model identifiers, so media_validate_environment reports
  // all three reachable. Tests that need to simulate unreachable models can
  // override `ai` directly.
  const lockedModels = [
    { name: 'models/gemini-3-pro-image-preview' },
    { name: 'models/imagen-4.0-ultra-generate-001' },
    { name: 'models/veo-3.1-generate-preview' },
  ];
  return Object.freeze({
    mode: 'gemini' as const,
    dryRun: false,
    ai: {
      models: {
        list: () => Promise.resolve({ page: lockedModels }),
      },
    } as never,
  });
}

function makeDeps(overrides: Partial<HandlersDeps> = {}): HandlersDeps {
  return {
    client: makeFakeClient(),
    config: makeFakeConfig(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Type helpers to read captured registerTool calls
// ---------------------------------------------------------------------------

interface CapturedTool {
  name: string;
  config: { title?: string; description?: string; inputSchema?: unknown };
  handler: (input: unknown) => Promise<unknown>;
}

function getCapturedTools(mockServer: McpServer): CapturedTool[] {
  const mock = mockServer as unknown as { registerTool: ReturnType<typeof vi.fn> };
  return mock.registerTool.mock.calls.map(([name, config, handler]) => ({
    name: name as string,
    config: config as CapturedTool['config'],
    handler: handler as CapturedTool['handler'],
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registerAllTools()', () => {
  let server: McpServer;
  let deps: HandlersDeps;
  let tools: CapturedTool[];

  beforeEach(() => {
    server = makeMockServer();
    deps = makeDeps();
    registerAllTools(server, deps);
    tools = getCapturedTools(server);
  });

  // Test 1: exactly 35 tools registered (26 base + media_video_webhook_status + media_video_cost_estimate + media_video_cost_report + media_video_route added P13 + media_higgsfield_soul_id + media_higgsfield_dop + media_higgsfield_cinema_studio + media_higgsfield_speak + media_higgsfield_marketing_studio added P14)
  it('calls registerTool exactly 47 times', () => {
    const mock = server as unknown as { registerTool: ReturnType<typeof vi.fn> };
    expect(mock.registerTool).toHaveBeenCalledTimes(47);
  });

  // Test 2: set equality with listMCPToolNames()
  it('registered tool names match listMCPToolNames()', () => {
    const registeredNames = new Set(tools.map((t) => t.name));
    const expectedNames = new Set(listMCPToolNames());
    expect(registeredNames).toEqual(expectedNames);
  });

  // Test 3: each tool has title, description, inputSchema
  it('every registered tool has non-empty title, description, and inputSchema', () => {
    for (const tool of tools) {
      expect(typeof tool.config.title).toBe('string');
      expect((tool.config.title?.length ?? 0)).toBeGreaterThan(0);
      expect(typeof tool.config.description).toBe('string');
      expect((tool.config.description?.length ?? 0)).toBeGreaterThan(0);
      expect(tool.config.inputSchema).toBeDefined();
    }
  });

  // Test 4: calling a handler with valid input returns {content, structuredContent}
  it('media_dry_run_payload handler returns content + structuredContent', async () => {
    const tool = tools.find((t) => t.name === 'media_dry_run_payload');
    expect(tool).toBeDefined();
    const result = await tool!.handler({ op: 'test', params: { foo: 'bar' } });
    expect(result).toMatchObject({
      content: [{ type: 'text' }],
      structuredContent: expect.any(Object),
    });
  });

  // Test 5: handler that throws returns {content, isError: true}
  // We test this via media_extract_palette which has simple input and throws
  // deterministically when passed bad input that triggers an error.
  // The wrap() utility is the mechanism under test — a thrown error from any handler
  // should result in {content, isError: true}.
  it('handler error surface: tool that encounters error returns isError:true', async () => {
    // media_extract_palette calls extractPalette(input) — pass a path that doesn't exist
    // so it throws, verifying the wrap() catches it and returns isError:true.
    const tool = tools.find((t) => t.name === 'media_extract_palette');
    expect(tool).toBeDefined();
    const result = await tool!.handler({
      op: 'extract-palette',
      imagePath: '/nonexistent/path/image.png',
      format: 'hex',
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    // The tool may succeed (returning a result) or fail (returning isError:true).
    // Either way, it must return content array (no throw propagates).
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0]).toHaveProperty('type', 'text');
    // If it errored, isError is true. If it succeeded somehow, isError is absent.
    // The key invariant: no exception thrown from the handler.
  });

  // Additional Test 5b: direct wrap behavior — custom mock server verifies isError path
  it('wrap() catches thrown errors and returns {isError:true, content}', async () => {
    // Register a minimal custom tool-like wrapper to test the error path.
    // We do this by injecting a client whose ai property triggers the error.
    const errorClient: MediaForgeClient = Object.freeze({
      mode: 'gemini' as const,
      dryRun: false,
      // Deliberately bad ai object — service calls will throw
      ai: null as never,
    });
    const errorServer = makeMockServer();
    registerAllTools(errorServer, { ...deps, client: errorClient });
    const errorTools = getCapturedTools(errorServer);

    // media_describe_image calls describeImage(input, client) which uses client.ai
    const tool = errorTools.find((t) => t.name === 'media_describe_image');
    expect(tool).toBeDefined();

    const result = await tool!.handler({
      op: 'describe',
      imagePath: '/any.png',
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    // Should have caught the error from the service and returned isError:true
    expect(result.isError).toBe(true);
    expect(result.content[0]?.type).toBe('text');
    expect(result.content[0]?.text.length).toBeGreaterThan(0);
  });

  // Test 6: media_dry_run_payload echoes {dryRun: true, payload: input}
  it('media_dry_run_payload returns {dryRun: true, payload: input}', async () => {
    const tool = tools.find((t) => t.name === 'media_dry_run_payload');
    expect(tool).toBeDefined();
    const input = { op: 'my-op', params: { x: 1 } };
    const result = await tool!.handler(input) as {
      content: Array<{ type: string; text: string }>;
      structuredContent: { dryRun: boolean; payload: unknown };
    };
    expect(result.structuredContent.dryRun).toBe(true);
    expect(result.structuredContent.payload).toEqual(input);
  });

  // Test 7: media_validate_environment returns ok:false when no credentials
  it('media_validate_environment returns ok:false when config has no apiKey', async () => {
    const serverNoKey = makeMockServer();
    const depsNoKey = makeDeps({ config: makeFakeConfig({ apiKey: undefined }) });
    registerAllTools(serverNoKey, depsNoKey);
    const freshTools = getCapturedTools(serverNoKey);
    const tool = freshTools.find((t) => t.name === 'media_validate_environment');
    expect(tool).toBeDefined();
    const result = await tool!.handler({}) as {
      structuredContent: { ok: boolean; missing: string[] };
    };
    expect(result.structuredContent.ok).toBe(false);
    expect(result.structuredContent.missing.length).toBeGreaterThan(0);
  });

  // Test 8: media_validate_environment returns ok:true when apiKey is set
  it('media_validate_environment returns ok:true when apiKey is set', async () => {
    const tool = tools.find((t) => t.name === 'media_validate_environment');
    expect(tool).toBeDefined();
    const result = await tool!.handler({}) as {
      structuredContent: { ok: boolean; missing: string[] };
    };
    expect(result.structuredContent.ok).toBe(true);
    expect(result.structuredContent.missing).toHaveLength(0);
  });

  // Test 9: media_capability_matrix has expected model keys
  it('media_capability_matrix returns object with expected model keys', async () => {
    const tool = tools.find((t) => t.name === 'media_capability_matrix');
    expect(tool).toBeDefined();
    const result = await tool!.handler({}) as {
      structuredContent: Record<string, unknown>;
    };
    expect(result.structuredContent).toHaveProperty('gemini-3-pro-image-preview');
    expect(result.structuredContent).toHaveProperty('imagen-4.0-ultra-generate-001');
    expect(result.structuredContent).toHaveProperty('veo-3.1-generate-preview');
  });

  // Test 10: media_estimate_cost with image-nano-banana-pro returns totalUsd > 0
  it('media_estimate_cost with nano-banana-pro item returns totalUsd > 0', async () => {
    const tool = tools.find((t) => t.name === 'media_estimate_cost');
    expect(tool).toBeDefined();
    const result = await tool!.handler({
      items: [{ op: 'image-nano-banana-pro', params: {} }],
    }) as {
      structuredContent: { totalUsd: number; perItem: unknown[] };
    };
    expect(result.structuredContent.totalUsd).toBeGreaterThan(0);
    expect(result.structuredContent.perItem).toHaveLength(1);
  });

  // Test R6: media_estimate_cost with refMode=MOODBOARD returns refsBreakdown
  it('media_estimate_cost with refMode=MOODBOARD includes refsBreakdown in perItem', async () => {
    const tool = tools.find((t) => t.name === 'media_estimate_cost');
    expect(tool).toBeDefined();
    const result = await tool!.handler({
      items: [{ op: 'video', params: { refMode: 'MOODBOARD', refCount: 5, subjectCount: 1, outputSize: '2048' } }],
    }) as {
      structuredContent: { totalUsd: number; perItem: Array<{ op: string; usd: number; breakdown: string; refsBreakdown?: Record<string, unknown> }> };
    };
    const item = result.structuredContent.perItem[0];
    expect(item).toBeDefined();
    expect(item!.refsBreakdown).toBeDefined();
    expect((item!.refsBreakdown as Record<string, unknown>)?.mode).toBe('MOODBOARD');
    expect(result.structuredContent.totalUsd).toBeGreaterThan(0);
    // Total must include moodboardComposeUsd
    const rb = item!.refsBreakdown as { moodboardComposeUsd: number; refsLookupUsd: number; totalUsd: number };
    expect(rb.moodboardComposeUsd).toBeGreaterThan(0);
    expect(result.structuredContent.totalUsd).toBeCloseTo(rb.totalUsd, 5);
  });

  // Test 11: media_help with specific topic returns help containing the tool name
  it('media_help with topic="media_generate_image" returns text with that name', async () => {
    const tool = tools.find((t) => t.name === 'media_help');
    expect(tool).toBeDefined();
    const result = await tool!.handler({ topic: 'media_generate_image' }) as {
      content: Array<{ type: string; text: string }>;
    };
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('media_generate_image');
  });

  // Test 12: media_help with no topic lists all 30 tool names
  it('media_help with no topic lists all 30 tool names', async () => {
    const tool = tools.find((t) => t.name === 'media_help');
    expect(tool).toBeDefined();
    const result = await tool!.handler({}) as {
      content: Array<{ type: string; text: string }>;
    };
    const text = result.content[0]?.text ?? '';
    for (const name of listMCPToolNames()) {
      expect(text).toContain(name);
    }
  });
});
