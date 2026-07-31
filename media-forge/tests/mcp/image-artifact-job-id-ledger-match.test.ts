// tests/mcp/image-artifact-job-id-ledger-match.test.ts
// Regression guard for the maybeStoreImageArtifact jobId fix (register.ts).
//
// Before the fix, maybeStoreImageArtifact minted its OWN jobId with
// generateJobId(prefix) for storeArtifact, while the caller had already
// minted a DIFFERENT jobId for the image_jobs ledger row (recordImageJob via
// withImageLedger) and the credit debit (withImageDebit). The `job_id`
// returned to the MCP caller named nothing in the ledger: a user looking at
// a result could not find its cost, and a cost row could not be traced back
// to what it produced.
//
// Asserting the two id strings are equal to each other is weaker than
// asserting the returned id actually resolves to a row in image_jobs — a
// bug that swapped BOTH ids for a third value would still pass a bare
// string-equality check. There is no per-row image_jobs read API in
// cost-tracker.ts (only aggregate sums like dailySpendUsd — see
// getJobRecord, which reads video_jobs, not image_jobs), so this queries
// the ledger table directly via openDb, the same primitive recordImageJob
// itself is built on.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAllTools, type HandlersDeps } from '../../src/mcp/handlers.js';
import { openDb, closeDb } from '../../src/core/db.js';
import type { MediaForgeConfig } from '../../src/core/config.js';
import type { MediaForgeClient } from '../../src/core/client.js';
import type { OutputStorageClient } from '../../src/output/storage.js';

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

// Matches the { candidates: [{ finishReason, content: { parts: [{ inlineData }] } }] }
// shape nano-banana-pro.ts / edit-image.ts / compose-scene.ts parse out of
// client.ai.models.generateContent()'s response — same fixture used by
// cost-guard-image-debit-dry-run.test.ts.
const FAKE_IMAGE_RESPONSE = {
  promptFeedback: undefined,
  candidates: [
    {
      finishReason: 'STOP',
      content: { parts: [{ inlineData: { data: 'ZmFrZQ==', mimeType: 'image/png' } }] },
    },
  ],
};

// Imagen 4 Ultra goes through a DIFFERENT SDK method (generateImages, not
// generateContent) — see imagen-4-ultra.ts. Shape matches
// tests/unit/image/imagen-4-ultra.test.ts's fixtures.
const FAKE_IMAGEN_RESPONSE = {
  generatedImages: [{ image: { imageBytes: 'ZmFrZQ==', mimeType: 'image/png' } }],
};

/** In-memory OutputStorageClient — no real MinIO/S3 call, just enough for
 *  maybeStoreImageArtifact to take its non-dry-run, non-empty-base64 path. */
function makeFakeStorage(): OutputStorageClient {
  return {
    putObject: vi.fn().mockResolvedValue(undefined),
    presignGet: vi.fn().mockResolvedValue('https://storage.example.com/outputs/fake.png?sig=x'),
    headObject: vi.fn().mockResolvedValue(null),
  };
}

/** Row shape image_jobs actually persists (see 009-image-jobs.sql). Only `id`
 *  is asserted on here — its mere presence is the point: the row is found AT
 *  ALL under the id the tool call returned. */
interface ImageJobRow {
  id: string;
}

function findImageJobById(dbPath: string, jobId: string): ImageJobRow | undefined {
  const db = openDb(dbPath);
  return db.prepare('SELECT id FROM image_jobs WHERE id = ?').get(jobId) as ImageJobRow | undefined;
}

/** Total row count — rules out "job_id resolves to SOME row" being a coincidence
 *  of a stray row from elsewhere; with a fresh per-test tmpdir + one generation,
 *  exactly one row must exist and it must be this call's. */
function countImageJobs(dbPath: string): number {
  const db = openDb(dbPath);
  const row = db.prepare('SELECT COUNT(*) as n FROM image_jobs').get() as { n: number };
  return row.n;
}

describe('image artifact job_id matches its image_jobs ledger row', () => {
  let tmpDir: string;
  let dbPath: string;
  let prevProjectDir: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-image-artifact-jobid-'));
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

  it('media_generate_image: the returned job_id resolves to the image_jobs row the same call wrote', async () => {
    const server = makeMockServer();
    const generateContent = vi.fn().mockResolvedValue(FAKE_IMAGE_RESPONSE);
    const client: MediaForgeClient = {
      mode: 'gemini',
      dryRun: false,
      ai: { models: { generateContent } } as never,
    };
    const deps: HandlersDeps = {
      client,
      config: makeFakeConfig(),
      storage: makeFakeStorage(),
      tenantId: 't-image',
    };
    registerAllTools(server, deps);
    const tool = getCapturedTools(server).find((t) => t.name === 'media_generate_image');
    expect(tool).toBeDefined();

    const result = await tool!.handler({ op: 'nano-banana-pro', prompt: 'a test image' });
    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as { job_id?: string; url?: string };
    expect(structured.job_id).toBeTruthy();
    expect(structured.url).toBeTruthy();

    // The stronger assertion: the id is not just present, it actually names a
    // row in the ledger the SAME call created — not a coincidentally-shaped
    // string.  Pre-fix, storeArtifact minted its own id, so structured.job_id
    // would resolve to nothing here.
    const row = findImageJobById(dbPath, structured.job_id!);
    expect(row).toBeDefined();
    expect(row!.id).toBe(structured.job_id);
    // Not just "some row matches" — exactly one row exists, and it's this one.
    expect(countImageJobs(dbPath)).toBe(1);
  });

  it('media_generate_imagen: the returned job_id resolves to the image_jobs row the same call wrote', async () => {
    const server = makeMockServer();
    const generateImages = vi.fn().mockResolvedValue(FAKE_IMAGEN_RESPONSE);
    const client: MediaForgeClient = {
      mode: 'gemini',
      dryRun: false,
      ai: { models: { generateImages } } as never,
    };
    const deps: HandlersDeps = {
      client,
      config: makeFakeConfig(),
      storage: makeFakeStorage(),
      tenantId: 't-imagen',
    };
    registerAllTools(server, deps);
    const tool = getCapturedTools(server).find((t) => t.name === 'media_generate_imagen');
    expect(tool).toBeDefined();

    const result = await tool!.handler({ op: 'imagen-4-ultra', prompt: 'a sunny landscape' });
    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as { job_id?: string; url?: string };
    expect(structured.job_id).toBeTruthy();
    expect(structured.url).toBeTruthy();

    const row = findImageJobById(dbPath, structured.job_id!);
    expect(row).toBeDefined();
    expect(row!.id).toBe(structured.job_id);
    expect(countImageJobs(dbPath)).toBe(1);
  });

  // media_edit_image and media_compose_scene had the opposite half of the same
  // defect: not a WRONG id, but no id at all. Both write an image_jobs row and
  // debit credit under `jobId`, then returned nothing the caller could use to
  // find it — money recorded against an id the caller never saw.
  it('media_edit_image: returns a job_id that resolves to its ledger row', async () => {
    const server = makeMockServer();
    const generateContent = vi.fn().mockResolvedValue(FAKE_IMAGE_RESPONSE);
    const client: MediaForgeClient = {
      mode: 'gemini',
      dryRun: false,
      ai: { models: { generateContent } } as never,
    };
    const sourceImage = join(tmpDir, 'source.png');
    writeFileSync(sourceImage, Buffer.from('fake-source-bytes'));

    registerAllTools(server, {
      client,
      config: makeFakeConfig(),
      storage: makeFakeStorage(),
      tenantId: 't-edit',
    } as HandlersDeps);
    const tool = getCapturedTools(server).find((t) => t.name === 'media_edit_image');
    expect(tool).toBeDefined();

    const result = await tool!.handler({ op: 'edit-image', prompt: 'remove the sign', sourceImage });
    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as { job_id?: string };
    expect(structured.job_id).toBeTruthy();
    expect(findImageJobById(dbPath, structured.job_id!)).toBeDefined();
    expect(countImageJobs(dbPath)).toBe(1);
  });

  it('media_compose_scene: returns a job_id that resolves to its ledger row', async () => {
    const server = makeMockServer();
    const generateContent = vi.fn().mockResolvedValue(FAKE_IMAGE_RESPONSE);
    const client: MediaForgeClient = {
      mode: 'gemini',
      dryRun: false,
      ai: { models: { generateContent } } as never,
    };
    // A real PNG, unlike edit-image's source: compose-scene DECODES its
    // references (sharp), so arbitrary bytes fail before the handler is reached.
    const refImage = resolve('tests/evals/fixtures/placeholder.png');

    registerAllTools(server, {
      client,
      config: makeFakeConfig(),
      storage: makeFakeStorage(),
      tenantId: 't-compose',
    } as HandlersDeps);
    const tool = getCapturedTools(server).find((t) => t.name === 'media_compose_scene');
    expect(tool).toBeDefined();

    const result = await tool!.handler({
      op: 'compose-scene',
      prompt: 'put the product on a marble table',
      referenceImages: [{ path: refImage, roleLabel: 'subject' }],
    });
    if (result.isError) throw new Error(JSON.stringify(result.content));
    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as { job_id?: string };
    expect(structured.job_id).toBeTruthy();
    expect(findImageJobById(dbPath, structured.job_id!)).toBeDefined();
    expect(countImageJobs(dbPath)).toBe(1);
  });
});
