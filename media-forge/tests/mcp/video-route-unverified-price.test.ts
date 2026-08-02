// An unverified price must SAY it is unverified, in the route the caller reads.
//
// `source: 'unverified'` was added to PRICING_SOURCES for the five Higgsfield
// HTTP specs, whose rates (25/70/40/18/35) predate the Cloud API account and
// disagree with every `base_credits` the catalogue reports (1.0 / 0.0 / 9.0 /
// 6.5; speak is not listed at all). The API balance is 0, so no billed
// generation has ever settled which side is right.
//
// Two of those specs already carried the word UNVERIFIED — inside the free-text
// `notes` field, where no caller and no guard could act on it. A marker nothing
// reads is decoration. This file is what stops it becoming decoration again: it
// asserts the enum value reaches the router's rationale, so deleting the warning
// fails a test rather than silently restoring "estimate that looks measured".

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { handleVideoRoute } from '../../src/mcp/handlers.js';
import { VIDEO_MODELS } from '../../src/core/models.js';

const API_RATE = 'MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT';

describe('unverified pricing is surfaced, not just recorded', () => {
  let prev: string | undefined;

  beforeAll(() => {
    prev = process.env[API_RATE];
    // Credit-priced candidates normalize to Infinity without a rate and drop out
    // of routing entirely, which would make every assertion below vacuous.
    process.env[API_RATE] = '0.0625';
  });

  afterAll(() => {
    if (prev === undefined) delete process.env[API_RATE];
    else process.env[API_RATE] = prev;
  });

  it('marks exactly the five Higgsfield HTTP specs as unverified', () => {
    const unverified = Object.values(VIDEO_MODELS)
      .filter((s) => s.pricing.source === 'unverified')
      .map((s) => s.id)
      .sort();

    expect(unverified).toEqual([
      'higgsfield-dop',
      'higgsfield-dop-turbo',
      'higgsfield-soul-standard',
      'higgsfield-soul2',
      'higgsfield-speak',
    ]);
  });

  it('every unverified spec belongs to the HTTP transport, never the CLI', () => {
    // The CLI rates were MEASURED with `higgsfield generate cost <job_type>`, a
    // read that spends nothing. Marking one of those unverified would be as
    // wrong in the other direction.
    for (const spec of Object.values(VIDEO_MODELS)) {
      if (spec.pricing.source !== 'unverified') continue;
      expect(spec.provider, `${spec.id} is not an HTTP spec`).toBe('higgsfield');
    }
  });

  it('warns in the rationale when the routed model carries an unverified rate', async () => {
    const result = await handleVideoRoute({
      mode: 'i2v',
      prompt: 'slow dolly past the doorway',
      durationSec: 5,
      resolution: '720p',
      preferProvider: 'higgsfield',
    });

    expect(result.modelId).toMatch(/^higgsfield-dop/);
    expect(result.rationale).toContain('UNVERIFIED');
    // The rate itself, so the reader can judge the size of the doubt rather than
    // just being told doubt exists.
    expect(result.rationale).toMatch(/\d+ credits-per-video/);
  });

  it('stays silent when the routed model has a confirmed rate', async () => {
    // kling's rates come off a published table read in an authenticated session.
    // A blanket warning on every route would train the reader to skip it.
    const result = await handleVideoRoute({
      mode: 't2v',
      prompt: 'a quiet street at dawn',
      durationSec: 5,
      resolution: '720p',
      preferProvider: 'kling',
    });

    expect(result.provider).toBe('kling');
    expect(result.rationale).not.toContain('UNVERIFIED');
  });
});
