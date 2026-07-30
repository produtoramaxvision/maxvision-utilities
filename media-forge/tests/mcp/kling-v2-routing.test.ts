import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleVideoRoute } from '../../src/mcp/handlers.js';

// The routing gate this file protects: kling-3.0-turbo (src/core/models.ts) is
// reachable ONLY through the Kling API 2.0 protocol (src/video/providers/kling-v2.ts),
// which is off by default. Its registry entry undercuts its Kling siblings on cost
// (src/mcp/handlers/video.ts's isV2OnlyModel filter, searched "isV2OnlyModel"), so a
// bare cost sort would pick it on every eligible route the moment it is registered —
// and every one of those routes would die at submit while the flag is off, after the
// cost guard has already run and a ledger row exists.
describe('handleVideoRoute — Kling API 2.0 routing gate (kling-3.0-turbo)', () => {
  const ORIGINAL_KLING_V2 = process.env['MEDIA_FORGE_KLING_API_V2'];
  const ORIGINAL_USD_PER_CREDIT = process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];

  beforeEach(() => {
    delete process.env['MEDIA_FORGE_KLING_API_V2'];
    // Credit-priced (Higgsfield) candidates normalize to Infinity cost without this
    // and therefore never win a cost sort regardless of the gate — that would let a
    // broken gate hide behind an unrelated missing env var. Setting a real value
    // here means every candidate in these tests is genuinely priced.
    process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = '0.01';
  });

  afterEach(() => {
    if (ORIGINAL_KLING_V2 === undefined) delete process.env['MEDIA_FORGE_KLING_API_V2'];
    else process.env['MEDIA_FORGE_KLING_API_V2'] = ORIGINAL_KLING_V2;
    if (ORIGINAL_USD_PER_CREDIT === undefined) delete process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
    else process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = ORIGINAL_USD_PER_CREDIT;
  });

  it('flag unset: a plain t2v 1080p route NEVER selects kling-3.0-turbo', async () => {
    const result = await handleVideoRoute({
      mode: 't2v',
      prompt: 'volume work',
      durationSec: 10,
      resolution: '1080p',
    });
    // Not pinned to one specific alternate winner: at this mode/resolution,
    // higgsfield-marketing-studio's flat per-video price outcompetes every Kling
    // tier regardless of the gate (see the i2v/preferProvider cases below for the
    // scenario where the gate is the ONLY thing standing between the cost sort and
    // kling-3.0-turbo). What must hold unconditionally is this assertion.
    expect(result.modelId).not.toBe('kling-3.0-turbo');
  });

  it('flag = "false" (not just unset): same guarantee holds', async () => {
    process.env['MEDIA_FORGE_KLING_API_V2'] = 'false';
    const result = await handleVideoRoute({
      mode: 't2v',
      prompt: 'volume work',
      durationSec: 10,
      resolution: '1080p',
    });
    expect(result.modelId).not.toBe('kling-3.0-turbo');
  });

  // i2v at 720p/10s is the clean, tie-free case: no Higgsfield i2v candidate
  // qualifies at this duration (their maxDurationSec caps top out at 8s), so the
  // only competition is within Kling itself — kling-3.0-turbo ($0.112*10=$1.12)
  // undercuts kling-v3-standard ($0.126*10=$1.26) outright, no stable-sort tie to
  // rely on.
  it('flag unset: automatic route picks kling-v3-standard, NOT the cheaper kling-3.0-turbo', async () => {
    const result = await handleVideoRoute({
      mode: 'i2v',
      prompt: 'push in on product',
      durationSec: 10,
      resolution: '720p',
    });
    expect(result.provider).toBe('kling');
    expect(result.modelId).toBe('kling-v3-standard');
    expect(result.modelId).not.toBe('kling-3.0-turbo');
  });

  it('flag = "true": kling-3.0-turbo becomes selectable and wins on cost (the bug the gate prevents)', async () => {
    process.env['MEDIA_FORGE_KLING_API_V2'] = 'true';
    const result = await handleVideoRoute({
      mode: 'i2v',
      prompt: 'push in on product',
      durationSec: 10,
      resolution: '720p',
    });
    expect(result.provider).toBe('kling');
    expect(result.modelId).toBe('kling-3.0-turbo');
    expect(result.estimatedCostUSD).toBeCloseTo(1.12, 4);
  });

  // Same story, isolated to the Kling adapter via preferProvider so the outcome
  // depends only on the gate and the Kling-internal cost sort, with zero
  // cross-provider noise from Higgsfield's flat per-video pricing.
  it('preferProvider="kling", flag unset: v3-standard wins (turbo excluded from candidates)', async () => {
    const result = await handleVideoRoute({
      mode: 't2v',
      prompt: 'volume work',
      durationSec: 10,
      resolution: '720p',
      preferProvider: 'kling',
    });
    expect(result.modelId).toBe('kling-v3-standard');
  });

  it('preferProvider="kling", flag=true: kling-3.0-turbo wins among its own siblings', async () => {
    process.env['MEDIA_FORGE_KLING_API_V2'] = 'true';
    const result = await handleVideoRoute({
      mode: 't2v',
      prompt: 'volume work',
      durationSec: 10,
      resolution: '720p',
      preferProvider: 'kling',
    });
    expect(result.modelId).toBe('kling-3.0-turbo');
  });
});
