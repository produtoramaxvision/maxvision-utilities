import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, closeDb } from '../../src/core/db.js';
import {
  handleHiggsfieldGenerate,
  _resetHiggsfieldProviderForTests,
} from '../../src/mcp/handlers.js';
import { queryReport } from '../../src/core/cost-tracker.js';

/**
 * Codex local round 8 PR#10 — coverage for the new generic Soul / Soul2
 * submit path (`media_higgsfield_generate`). Previously only the registry
 * count assertion bumped from 39 → 40; no behavioural test existed.
 */

const ORIG_FETCH = global.fetch;

describe('media_higgsfield_generate handler', () => {
  let tmpDir: string;
  let dbPath: string;
  let prev: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-hf-gen-h-'));
    dbPath = join(tmpDir, 'cost.db');
    prev = process.env['MEDIA_FORGE_PROJECT_DIR'];
    process.env['MEDIA_FORGE_PROJECT_DIR'] = tmpDir;
    process.env['HF_API_KEY'] = 'pk';
    process.env['HF_API_SECRET'] = 'sk';
    process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = '0.039';
    const db = openDb(dbPath);
    runMigrations(db);
    _resetHiggsfieldProviderForTests();
  });

  afterEach(() => {
    closeDb(dbPath);
    rmSync(tmpDir, { recursive: true, force: true });
    if (prev === undefined) delete process.env['MEDIA_FORGE_PROJECT_DIR'];
    else process.env['MEDIA_FORGE_PROJECT_DIR'] = prev;
    global.fetch = ORIG_FETCH;
    delete process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
  });

  it('submits Soul t2v through HiggsfieldProvider.generate and records cost', async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          request_id: 'req-soul-1',
          status_url: 'https://platform.higgsfield.ai/requests/req-soul-1/status',
          cancel_url: 'https://platform.higgsfield.ai/requests/req-soul-1/cancel',
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const result = await handleHiggsfieldGenerate({
      modelId: 'higgsfield-soul-standard',
      mode: 't2v',
      prompt: 'a quiet lake at sunrise',
      durationSec: 5,
      resolution: '1080p',
    });
    expect(result.provider).toBe('higgsfield');
    expect(result.providerNativeId).toBe('req-soul-1');
    expect(typeof result.jobId).toBe('string');
    expect(result.estimatedCostUSD).toBeGreaterThan(0);

    // Cost row recorded (estUsd, status=pending) via provider.generate → recordJob
    const report = queryReport({ dbPath, periodDays: 30 });
    expect(report.byProvider.higgsfield?.jobs).toBe(1);
  });

  it('routes Soul i2v with firstFrameImagePath', async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          request_id: 'req-soul-i2v',
          status_url: 'https://platform.higgsfield.ai/requests/req-soul-i2v/status',
          cancel_url: '',
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const result = await handleHiggsfieldGenerate({
      modelId: 'higgsfield-soul2',
      mode: 'i2v',
      prompt: 'animate the still',
      durationSec: 5,
      resolution: '1080p',
      firstFrameImagePath: 'https://cdn/still.png',
    });
    expect(result.providerNativeId).toBe('req-soul-i2v');
  });

  it('rejects unknown modelId via schema', async () => {
    await expect(
      handleHiggsfieldGenerate({
        modelId: 'gpt-5-video', // not in enum
        prompt: 'x',
      }),
    ).rejects.toThrow();
  });

  it('rejects empty prompt via schema', async () => {
    await expect(
      handleHiggsfieldGenerate({
        modelId: 'higgsfield-soul-standard',
        prompt: '',
      }),
    ).rejects.toThrow();
  });

  it("rejects mode='i2v' without firstFrameImagePath (Codex P2 round 13, PR#10)", async () => {
    await expect(
      handleHiggsfieldGenerate({
        modelId: 'higgsfield-soul-standard',
        mode: 'i2v',
        prompt: 'animate the still',
        durationSec: 5,
        resolution: '1080p',
      }),
    ).rejects.toThrow(/firstFrameImagePath/i);
  });
});
