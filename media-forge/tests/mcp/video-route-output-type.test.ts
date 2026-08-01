// The router must never hand a VIDEO request a model that returns an IMAGE.
//
// Higgsfield's Soul family is text2image — `GET /models` says so in its own
// words, and the live gate prints it every run:
//
//   higgsfield-ai/soul/standard    text2image  image  1.0000
//   higgsfield-ai/soul/v2/standard text2image  image  0.0000
//
// The registry nonetheless shipped `higgsfield-soul-standard`, `-soul-pro` and
// `-soul2` inside VIDEO_MODELS with `modes: ['t2v','i2v']`, and handleVideoRoute
// filtered on mode, provider, duration and resolution — never on what comes back.
// So a video request could be answered with an image endpoint.
//
// It did not show up in the default cost sort, which is why it survived: at
// USD_PER_CREDIT=0.0625 the flat 25-credit Soul price ($1.5625) loses to
// kling-v3-standard at every duration the spec allows. It shows up the moment the
// caller names the provider — and it would have shown up EVERYWHERE the day the
// Soul price was "corrected" toward the 1.0 base_credits the catalogue reports,
// which would make it $0.0625 flat and the cheapest t2v candidate by ~16x.
//
// That is the trap this file exists to spring before the price change does.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { handleVideoRoute } from '../../src/mcp/handlers.js';
import { VIDEO_MODELS } from '../../src/core/models.js';

/**
 * The rate must be set for these assertions to mean anything.
 *
 * Without MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT every credit-priced candidate
 * normalises to Infinity and handleVideoRoute throws "no priceable provider"
 * before selecting anything. That accidental unreachability is what kept the
 * defect invisible; asserting against it would test the missing env var, not the
 * filter. 0.0625 is the measured API rate (top-up publishes "16 credits = $1").
 */
const RATE = '0.0625';
let previousRate: string | undefined;

beforeAll(() => {
  previousRate = process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
  process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = RATE;
});

afterAll(() => {
  if (previousRate === undefined) delete process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
  else process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = previousRate;
});

/** Specs the platform serves as text2image, whatever VIDEO_MODELS claims. */
const IMAGE_OUTPUT_MODEL_IDS = [
  'higgsfield-soul-standard',
  'higgsfield-soul-pro',
  'higgsfield-soul2',
] as const;

describe('video routing never selects an image-output model', () => {
  it('marks every image-output spec as such in the registry', () => {
    for (const id of IMAGE_OUTPUT_MODEL_IDS) {
      const spec = VIDEO_MODELS[id];
      expect(spec, `${id} is missing from VIDEO_MODELS`).toBeDefined();
      expect(spec!.outputType, `${id} returns an image and must say so`).toBe('image');
    }
  });

  it('leaves every other spec producing video', () => {
    const mislabelled = Object.values(VIDEO_MODELS)
      .filter(
        (spec) =>
          spec.outputType !== 'video' &&
          !(IMAGE_OUTPUT_MODEL_IDS as readonly string[]).includes(spec.id),
      )
      .map((spec) => spec.id);
    expect(mislabelled, 'a video model was labelled image — it will drop out of routing').toEqual(
      [],
    );
  });

  // The live path. Without preferProvider the cost sort hides the defect behind
  // Kling; naming the provider narrows the pool to Higgsfield, and Soul used to
  // be the cheapest thing left — this is the call that returned an image endpoint
  // for a video request before the filter landed.
  //
  // It now REFUSES, and that is the honest answer rather than a weaker one: strip
  // the image models and the 404s and the Higgsfield Cloud API has no working t2v
  // at all. What remains is dop / dop-turbo (i2v, with-refs) and speak (lip-sync).
  it('refuses t2v on Higgsfield rather than answering with an image model', async () => {
    await expect(
      handleVideoRoute({
        mode: 't2v',
        prompt: 'slow push in on a rain-slicked street',
        durationSec: 8,
        resolution: '1080p',
        preferProvider: 'higgsfield',
      }),
    ).rejects.toThrow(/preferProvider higgsfield has no model supporting mode t2v/);
  });

  // i2v still has real Higgsfield models, so this one returns — and must not
  // return Soul, which also declares i2v.
  it('routes i2v on Higgsfield to a video model, never to Soul', async () => {
    const result = await handleVideoRoute({
      mode: 'i2v',
      prompt: 'the subject turns toward camera',
      durationSec: 5,
      resolution: '720p',
      preferProvider: 'higgsfield',
    });
    expect(
      IMAGE_OUTPUT_MODEL_IDS as readonly string[],
      `routed a video request to ${result.modelId}, which returns an image`,
    ).not.toContain(result.modelId);
    expect(result.provider).toBe('higgsfield');
  });

  // Pins the `unavailable` mechanism ITSELF, not a side effect of it.
  //
  // The refusal tests above would still pass with the unavailable filter deleted
  // — outputType already removes the Soul specs, and targeted-edit has no other
  // provider once Seedance is off. This walks every mode an unserved spec claims
  // and asserts it never comes back, so removing the filter turns THIS red.
  it('never returns a spec marked unavailable, in any mode it claims', async () => {
    const unserved = Object.values(VIDEO_MODELS).filter((s) => s.unavailable !== undefined);
    expect(unserved.length, 'no unavailable specs to check — has the marker been lost?')
      .toBeGreaterThan(0);

    const unservedIds = unserved.map((s) => s.id);
    const modes = [...new Set(unserved.flatMap((s) => s.modes))];

    for (const mode of modes) {
      for (const resolution of ['720p', '1080p'] as const) {
        // preferProvider is REQUIRED for this to test anything. Every unserved
        // spec here belongs to 'higgsfield', and in the open cost sort Kling
        // undercuts all of them — so a default route never surfaces one even
        // with the filter deleted. Narrowing the pool to the provider that owns
        // them is what makes the assertion bite. (Verified by deleting the
        // filter and watching this go red.)
        //
        // Some modes have no provider at all once these are excluded; a refusal
        // is a pass. What must never happen is a dead model coming back.
        const result = await handleVideoRoute({
          mode,
          prompt: 'unavailable-spec routing check',
          durationSec: 5,
          resolution,
          preferProvider: 'higgsfield',
        }).catch(() => undefined);
        if (result === undefined) continue;
        expect(
          unservedIds,
          `mode='${mode}' ${resolution} routed to ${result.modelId}, whose endpoint the provider does not serve`,
        ).not.toContain(result.modelId);
      }
    }
  });

  // The default path, across the grid where Soul is actually eligible.
  //
  // This does NOT simulate the latent case (Soul repriced at the catalogue's 1.0
  // base_credits, which would make it the cheapest candidate by ~16x) — it
  // asserts the current registry. The protection against that case is
  // structural rather than tested here: the outputType filter runs BEFORE the
  // cost sort and does not consult price, so no rate can promote an image model
  // back into the pool. Say what is verified, not what is hoped.
  it('keeps image models out of the unpreferred cost sort too', async () => {
    for (const resolution of ['720p', '1080p'] as const) {
      for (const durationSec of [3, 5, 8]) {
        const result = await handleVideoRoute({
          mode: 't2v',
          prompt: 'a candle burns down',
          durationSec,
          resolution,
        });
        expect(
          IMAGE_OUTPUT_MODEL_IDS as readonly string[],
          `${durationSec}s ${resolution} routed to ${result.modelId}, which returns an image`,
        ).not.toContain(result.modelId);
      }
    }
  });
});
