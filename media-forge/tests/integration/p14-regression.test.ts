import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  handleVideoRoute,
  handleVideoCostEstimate,
  handleHiggsfieldSoulId,
} from '../../src/mcp/handlers.js';
import { MCP_TOOLS } from '../../src/mcp/schemas.js';
import { closeDb } from '../../src/core/db.js';

describe('P14 regression — Veo still wired AND Higgsfield is live', () => {
  let tmpDir: string;
  let prev: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-p14-reg-'));
    prev = process.env['MEDIA_FORGE_PROJECT_DIR'];
    process.env['MEDIA_FORGE_PROJECT_DIR'] = tmpDir;
    process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = '0.039';
  });

  afterEach(() => {
    // Close SQLite handle before deleting tmpDir — prevents EPERM on Windows.
    closeDb(join(tmpDir, 'cost.db'));
    rmSync(tmpDir, { recursive: true, force: true });
    if (prev === undefined) delete process.env['MEDIA_FORGE_PROJECT_DIR'];
    else process.env['MEDIA_FORGE_PROJECT_DIR'] = prev;
    delete process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
  });

  it('Veo regression: plain t2v still routes to google', async () => {
    const r = await handleVideoRoute({
      mode: 't2v',
      prompt: 'a quiet lake at sunrise',
      durationSec: 4,
      resolution: '720p',
    });
    expect(r.provider).toBe('google');
  });

  it('Veo cost estimate unchanged', async () => {
    const r = await handleVideoCostEstimate({
      modelId: 'veo-3.1-generate-preview',
      mode: 't2v',
      prompt: 'x',
      durationSec: 8,
      resolution: '1080p',
    });
    expect(r.estimatedCostUSD).toBeCloseTo(4.0, 2);
  });

  it('Higgsfield Soul ID lifecycle works end-to-end', async () => {
    await handleHiggsfieldSoulId({
      action: 'create',
      id: 'soul_p14_reg',
      characterName: 'P14Reg',
      assetPaths: ['/tmp/a.png'],
    });
    const list = await handleHiggsfieldSoulId({ action: 'list' });
    expect((list as { records: unknown[] }).records.length).toBe(1);
  });

  it('MCP_TOOLS count is 41 (P13 30 + P14 7 + P15 Task 6 1 + P15 Tasks 6.5-6.7 3)', () => {
    expect(MCP_TOOLS.length).toBe(41);
  });

  it('lip-sync route picks Higgsfield', async () => {
    const r = await handleVideoRoute({
      mode: 'lip-sync',
      prompt: 'x',
      durationSec: 15,
      resolution: '720p',
    });
    expect(r.provider).toBe('higgsfield');
  });
});
