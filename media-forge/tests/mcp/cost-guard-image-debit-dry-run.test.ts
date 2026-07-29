// tests/mcp/cost-guard-image-debit-dry-run.test.ts
// P1 fixes (2026-07-29), verified end-to-end through registerAllTools ->
// wrap() -> the actual tool handler, exactly like cost-guard-video-block.test.ts
// and cost-guard-image-failure.test.ts.
//
// Defect 1 — dry-run charges credits: withImageDebit used to run unconditionally
// at every image site, including under dry-run, reserving+capturing credit for a
// generation that never reached the provider. Fixed by gating the debit on the
// SAME `client.dryRun` check the cost guard and image ledger already use (see
// checkCostGuardOrThrow's doc comment in src/mcp/handlers/register.ts) — not a
// second way of asking "is this a dry run". NOTE: dry-run-ness is decided by
// `client.dryRun` (set when the MediaForgeClient is constructed), NOT by the
// per-request `dryRun` field on the tool input — none of the image services read
// that field, so it is intentionally omitted from these test payloads.
//
// Defect 2 — media_edit_image and media_compose_scene generate without debiting:
// neither called withImageDebit at all. Both are now wired through it exactly
// like media_generate_image / media_generate_imagen.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAllTools, type HandlersDeps } from '../../src/mcp/handlers.js';
import { closeDb } from '../../src/core/db.js';
import type { MediaForgeConfig } from '../../src/core/config.js';
import type { MediaForgeClient } from '../../src/core/client.js';
import type { CreditClient } from '../../src/billing/credit-client.js';

const PLACEHOLDER_REF_IMAGE = resolve('tests/evals/fixtures/placeholder.png');

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

/** Spy CreditClient — same shape as tests/unit/billing/debit-wiring.test.ts's spyClient(). */
function spyCreditClient() {
  const reserve = vi.fn(async () => {});
  const capture = vi.fn(async () => {});
  const release = vi.fn(async () => {});
  const client = {
    reserve,
    capture,
    release,
    balance: vi.fn(async () => 1_000_000),
    grant: vi.fn(async () => {}),
  };
  return { client: client as unknown as CreditClient, reserve, capture, release };
}

// Matches the { candidates: [{ finishReason, content: { parts: [{ inlineData }] } }] }
// shape all three image services (nano-banana-pro.ts, edit-image.ts, compose-scene.ts)
// parse out of client.ai.models.generateContent()'s response.
const FAKE_IMAGE_RESPONSE = {
  promptFeedback: undefined,
  candidates: [
    {
      finishReason: 'STOP',
      content: { parts: [{ inlineData: { data: 'ZmFrZQ==', mimeType: 'image/png' } }] },
    },
  ],
};

describe('media-forge cost guards — image debit dry-run gating + edit/compose wiring (P1)', () => {
  let tmpDir: string;
  let dbPath: string;
  let prevProjectDir: string | undefined;
  let sourceImagePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-cost-guard-img-debit-'));
    dbPath = join(tmpDir, 'cost.db');
    prevProjectDir = process.env['MEDIA_FORGE_PROJECT_DIR'];
    process.env['MEDIA_FORGE_PROJECT_DIR'] = tmpDir;
    // edit-image only base64-encodes this file's bytes (readBase64) — it never
    // decodes it as an image, so arbitrary bytes are fine for the non-dry-run path.
    sourceImagePath = join(tmpDir, 'source.png');
    writeFileSync(sourceImagePath, Buffer.from('fake-source-bytes'));
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

  // -------------------------------------------------------------------------
  // Defect 1 — dry-run must not reserve or capture credit
  // -------------------------------------------------------------------------

  it('media_generate_image: dry-run + billing ON reaches neither the provider nor the creditClient', async () => {
    const server = makeMockServer();
    const spy = spyCreditClient();
    const generateContent = vi.fn().mockResolvedValue(FAKE_IMAGE_RESPONSE);
    const client: MediaForgeClient = {
      mode: 'gemini',
      dryRun: true,
      ai: { models: { generateContent } } as never,
    };
    const deps: HandlersDeps = { client, config: makeFakeConfig(), creditClient: spy.client, tenantId: 't-dry' };
    registerAllTools(server, deps);
    const tool = getCapturedTools(server).find((t) => t.name === 'media_generate_image');
    expect(tool).toBeDefined();

    const result = await tool!.handler({ op: 'nano-banana-pro', prompt: 'a test image' });
    expect(result.isError).toBeFalsy();

    expect(generateContent).not.toHaveBeenCalled();
    expect(spy.reserve).not.toHaveBeenCalled();
    expect(spy.capture).not.toHaveBeenCalled();
  });

  it('media_generate_image: a REAL (non-dry-run) generation still reserves AND captures credit', async () => {
    const server = makeMockServer();
    const spy = spyCreditClient();
    const generateContent = vi.fn().mockResolvedValue(FAKE_IMAGE_RESPONSE);
    const client: MediaForgeClient = {
      mode: 'gemini',
      dryRun: false,
      ai: { models: { generateContent } } as never,
    };
    const deps: HandlersDeps = { client, config: makeFakeConfig(), creditClient: spy.client, tenantId: 't-real' };
    registerAllTools(server, deps);
    const tool = getCapturedTools(server).find((t) => t.name === 'media_generate_image');
    expect(tool).toBeDefined();

    const result = await tool!.handler({ op: 'nano-banana-pro', prompt: 'a test image' });
    expect(result.isError).toBeFalsy();

    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(spy.reserve).toHaveBeenCalledTimes(1);
    expect(spy.capture).toHaveBeenCalledTimes(1);
  });

  it('media_edit_image: dry-run + billing ON reaches neither the provider nor the creditClient', async () => {
    const server = makeMockServer();
    const spy = spyCreditClient();
    const generateContent = vi.fn().mockResolvedValue(FAKE_IMAGE_RESPONSE);
    const client: MediaForgeClient = {
      mode: 'gemini',
      dryRun: true,
      ai: { models: { generateContent } } as never,
    };
    const deps: HandlersDeps = { client, config: makeFakeConfig(), creditClient: spy.client, tenantId: 't-edit-dry' };
    registerAllTools(server, deps);
    const tool = getCapturedTools(server).find((t) => t.name === 'media_edit_image');
    expect(tool).toBeDefined();

    const result = await tool!.handler({ op: 'edit-image', prompt: 'add a hat', sourceImage: sourceImagePath });
    expect(result.isError).toBeFalsy();

    expect(generateContent).not.toHaveBeenCalled();
    expect(spy.reserve).not.toHaveBeenCalled();
    expect(spy.capture).not.toHaveBeenCalled();
  });

  it('media_compose_scene: dry-run + billing ON reaches neither the provider nor the creditClient', async () => {
    const server = makeMockServer();
    const spy = spyCreditClient();
    const generateContent = vi.fn().mockResolvedValue(FAKE_IMAGE_RESPONSE);
    const client: MediaForgeClient = {
      mode: 'gemini',
      dryRun: true,
      ai: { models: { generateContent } } as never,
    };
    const deps: HandlersDeps = { client, config: makeFakeConfig(), creditClient: spy.client, tenantId: 't-compose-dry' };
    registerAllTools(server, deps);
    const tool = getCapturedTools(server).find((t) => t.name === 'media_compose_scene');
    expect(tool).toBeDefined();

    const result = await tool!.handler({
      op: 'compose-scene',
      prompt: 'combine these',
      referenceImages: [{ path: PLACEHOLDER_REF_IMAGE, roleLabel: 'subject' }],
    });
    expect(result.isError).toBeFalsy();

    expect(generateContent).not.toHaveBeenCalled();
    expect(spy.reserve).not.toHaveBeenCalled();
    expect(spy.capture).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Defect 2 — media_edit_image and media_compose_scene must reserve+capture
  // -------------------------------------------------------------------------

  it('media_edit_image: reserves AND captures credit for a real (non-dry-run) edit', async () => {
    const server = makeMockServer();
    const spy = spyCreditClient();
    const generateContent = vi.fn().mockResolvedValue(FAKE_IMAGE_RESPONSE);
    const client: MediaForgeClient = {
      mode: 'gemini',
      dryRun: false,
      ai: { models: { generateContent } } as never,
    };
    const deps: HandlersDeps = { client, config: makeFakeConfig(), creditClient: spy.client, tenantId: 't-edit' };
    registerAllTools(server, deps);
    const tool = getCapturedTools(server).find((t) => t.name === 'media_edit_image');
    expect(tool).toBeDefined();

    const result = await tool!.handler({ op: 'edit-image', prompt: 'add a hat', sourceImage: sourceImagePath });
    expect(result.isError).toBeFalsy();

    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(spy.reserve).toHaveBeenCalledTimes(1);
    expect(spy.capture).toHaveBeenCalledTimes(1);
  });

  it('media_compose_scene: reserves AND captures credit for a real (non-dry-run) composition', async () => {
    const server = makeMockServer();
    const spy = spyCreditClient();
    const generateContent = vi.fn().mockResolvedValue(FAKE_IMAGE_RESPONSE);
    const client: MediaForgeClient = {
      mode: 'gemini',
      dryRun: false,
      ai: { models: { generateContent } } as never,
    };
    const deps: HandlersDeps = { client, config: makeFakeConfig(), creditClient: spy.client, tenantId: 't-compose' };
    registerAllTools(server, deps);
    const tool = getCapturedTools(server).find((t) => t.name === 'media_compose_scene');
    expect(tool).toBeDefined();

    const result = await tool!.handler({
      op: 'compose-scene',
      prompt: 'combine these',
      referenceImages: [{ path: PLACEHOLDER_REF_IMAGE, roleLabel: 'subject' }],
    });
    expect(result.isError).toBeFalsy();

    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(spy.reserve).toHaveBeenCalledTimes(1);
    expect(spy.capture).toHaveBeenCalledTimes(1);
  });
});
