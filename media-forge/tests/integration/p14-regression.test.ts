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

  it('Veo regression: plain t2v still routes to google when preferProvider is forced', async () => {
    // P15 Option A removed google-default tiebreaker; Kling wins on cost for plain t2v.
    // preferProvider: 'google' preserves the P14 intent: Veo is still wired and callable.
    const r = await handleVideoRoute({
      mode: 't2v',
      prompt: 'a quiet lake at sunrise',
      durationSec: 4,
      resolution: '720p',
      preferProvider: 'google',
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

  it('MCP_TOOLS count is 47 (P13 30 + P14 7 + P15 Task 6 1 + P15 Tasks 6.5-6.7 3 + P15 Task 7 1 + P15 Task 8 1 + P15 Task 9 1 + P15 Task 10 1 + Codex round 6 PR#11 lifecycle 2)', () => {
    expect(MCP_TOOLS.length).toBe(47);
  });

  it('lip-sync route picks Kling in P15 (explicit-tier override; Higgsfield still reachable via preferProvider)', async () => {
    // P14: Higgsfield was sole lip-sync provider. P15: kling-v3-pro joins with explicit-tier
    // override — pickExplicitTier routes lip-sync to kling-v3-pro before cost sort.
    // Higgsfield lip-sync remains reachable via preferProvider: 'higgsfield'.
    // PR#10 Codex P2 fix: router now filters by maxDurationSec — kling-v3-pro caps at 10s.
    // Use 10s so kling-v3-pro stays in the candidate pool and explicit-tier override wins.
    const r = await handleVideoRoute({
      mode: 'lip-sync',
      prompt: 'x',
      durationSec: 10,
      resolution: '1080p',
    });
    expect(r.provider).toBe('kling');
  });
});
