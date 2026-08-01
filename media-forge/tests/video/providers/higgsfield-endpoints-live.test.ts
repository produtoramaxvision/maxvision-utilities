// Live gate: every Higgsfield endpoint and field name this repo ships, asked of
// the platform directly.
//
// Every request here is unsubmittable BY CONSTRUCTION — the body is empty, missing
// a required field, or carries a wrong-typed one — so it fails schema validation
// before anything can be queued. The whole file costs 0 credits and answers three
// questions no unit test can: does this path exist, what does it require, and
// what are its enums.
//
// "0 credits" must never rest on the platform continuing to REFUSE a valid-looking
// request. A cap that gets raised, or a value that gets clamped instead of rejected,
// would turn such a probe into a paid generation. Keep every body structurally
// invalid, not merely out of range.
//
// It exists because the shipped map was wrong in ways nothing local could catch.
// On 2026-08-01, with a freshly minted API key: six of ten endpoints answered
// `404 model_not_found`, `/higgsfield-ai/dop/standard` required `image_url`
// while this repo sent `first_frame_url`, and Speak capped duration at 15 while
// the registry claimed 30.
//
// It pins TODAY'S TRUTH, not a wish list: served endpoints must stay served,
// absent ones must stay absent, and the field names must keep matching. When
// Higgsfield changes any of that, this turns red instead of a paid call failing.
//
// Needs HF_API_KEY + HF_API_SECRET (Higgsfield Cloud dashboard -> API Keys) and
// MEDIA_FORGE_RUN_LIVE_TESTS=true.

import { describe, it, expect } from 'vitest';
import { HIGGSFIELD_ENDPOINTS } from '../../../src/video/providers/higgsfield.js';
import { VIDEO_MODELS } from '../../../src/core/models.js';
import { buildPrimaryHeaders } from '../../../src/video/providers/auth/higgsfield-headers.js';

const SHOULD_RUN =
  process.env['MEDIA_FORGE_RUN_LIVE_TESTS'] === 'true' &&
  (process.env['HF_API_KEY']?.length ?? 0) > 0 &&
  (process.env['HF_API_SECRET']?.length ?? 0) > 0;

const describeIfLive = SHOULD_RUN ? describe : describe.skip;

/**
 * Endpoints this repo maps that the platform does not serve — READ FROM THE
 * REGISTRY, not from a table kept here.
 *
 * This list used to be a local constant, which made the gate correct and the
 * ROUTER blind: handleVideoRoute ranked all ten mapped endpoints because nothing
 * in src/ knew that six of them 404. Two copies of a fact drift; one of them was
 * the one the runtime actually used.
 *
 * `spec.unavailable` in src/core/models.ts is now the single source, carrying the
 * platform's own answer and the date it was asked. This file's job is unchanged
 * and is what keeps that source honest: it re-POSTs every mapped endpoint and
 * fails if anything marked unavailable is now served (delete the marker and wire
 * the tool) or if anything unmarked has stopped being served.
 *
 * `higgsfield-speak` was written off here for exactly one commit and did not
 * belong: `/higgsfield-ai/speak/standard` 404s but `/higgsfield-ai/speak`
 * answers. It was assumed absent because it was missing from `GET /models`, and
 * that inference was wrong — see the comment on probeExists.
 */
const KNOWN_ABSENT: ReadonlySet<string> = new Set(
  Object.values(VIDEO_MODELS)
    .filter((spec) => spec.unavailable !== undefined)
    .map((spec) => spec.id),
);

/**
 * Does the platform serve this path?
 *
 * A POST with an empty body, which cannot start a generation: a served endpoint
 * fails schema validation (422, or 400 for the third-party JSON-schema models)
 * and an unserved one answers `404 {"detail":"model_not_found"}`.
 *
 * This asks the platform directly instead of checking membership in
 * `GET /models`, because that listing is NOT the platform catalogue — it is the
 * first-party generation-model list. `/kling-video/v2.1/pro/image-to-video`
 * (400), `/soul-id` (403 not_enough_credits) and every `/v1/*` path answer while
 * being absent from it. Treating absence as non-existence is what produced the
 * wrong `higgsfield-speak` entry above.
 */
async function probeExists(path: string, headers: Record<string, string>): Promise<boolean> {
  const res = await fetch(`https://platform.higgsfield.ai${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: '{}',
  });
  if (res.status === 404) return false;
  expect(
    [400, 401, 403, 422],
    `${path} answered ${res.status} — neither a schema error nor model_not_found`,
  ).toContain(res.status);

  // A 422 whose error is located in the PATH, not the body, means the route
  // pattern matched but this path segment is not a legal value — the endpoint is
  // not served at this URL. `/higgsfield-ai/soul/pro` is the case: it answers
  //   {"loc":["path","mode"],"msg":"Input should be 'reference', 'character' or 'standard'"}
  // because the segment is a MODE and "pro" is not one of them. Counting that as
  // "served" would have this gate report a tool as working when every call to it
  // fails.
  if (res.status === 422) {
    const body = (await res.json()) as { detail?: Array<{ loc?: unknown[] }> };
    const pathError = body.detail?.some((d) => Array.isArray(d.loc) && d.loc[0] === 'path');
    if (pathError === true) return false;
  }
  return true;
}

interface CatalogueEntry {
  readonly slug: string;
  readonly operation_type: string;
  readonly output_type: string;
  readonly base_credits: string;
}

async function fetchCatalogue(): Promise<CatalogueEntry[]> {
  const res = await fetch('https://platform.higgsfield.ai/models', {
    headers: { accept: 'application/json', ...buildPrimaryHeaders() },
  });
  expect(res.status, 'GET /models must authenticate and answer').toBe(200);
  const body = (await res.json()) as { items?: CatalogueEntry[] };
  expect(Array.isArray(body.items)).toBe(true);
  return body.items!;
}

describeIfLive('Higgsfield endpoint map vs the platform catalogue', () => {
  it('every mapped endpoint is served, or listed as known-absent', async () => {
    const headers = buildPrimaryHeaders();
    const unexpectedlyAbsent: string[] = [];
    const unexpectedlyPresent: string[] = [];

    for (const [modelId, endpoint] of Object.entries(HIGGSFIELD_ENDPOINTS)) {
      const served = await probeExists(endpoint, headers);
      const expectedAbsent = KNOWN_ABSENT.has(modelId);
      if (!served && !expectedAbsent) unexpectedlyAbsent.push(`${modelId} -> ${endpoint}`);
      if (served && expectedAbsent) unexpectedlyPresent.push(`${modelId} -> ${endpoint}`);
    }

    expect(
      unexpectedlyAbsent,
      'mapped endpoints the platform answers model_not_found for — every call to these fails',
    ).toEqual([]);
    expect(
      unexpectedlyPresent,
      'listed in KNOWN_ABSENT but the platform serves them — remove the entry and wire the tool',
    ).toEqual([]);
  }, 120_000);

  it('the request body uses the field names the platform requires', async () => {
    // The body this repo builds, minus the image: dop/standard must then ask for
    // exactly `image_url`. If it asks for anything else, buildRequestBody's
    // rename is wrong and every image-driven call is failing.
    const res = await fetch('https://platform.higgsfield.ai/higgsfield-ai/dop/standard', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...buildPrimaryHeaders(),
      },
      body: JSON.stringify({ prompt: 'field-name check', aspect_ratio: '16:9', duration: 5 }),
    });
    expect(res.status).toBe(422);
    const detail = JSON.stringify(await res.json());
    expect(detail, 'the required image field is no longer image_url').toContain('image_url');
    expect(detail, 'first_frame_url is not a field this API knows').not.toContain('first_frame_url');
  }, 60_000);

  it('reports the catalogue so drift in credits or media type is visible', async () => {
    const catalogue = await fetchCatalogue();
    // eslint-disable-next-line no-console
    console.log(
      '[higgsfield-catalogue]\n' +
        catalogue
          .map(
            (m) =>
              `${m.slug.padEnd(44)} ${m.operation_type.padEnd(13)} ${m.output_type.padEnd(6)} ${m.base_credits}`,
          )
          .join('\n'),
    );
    expect(catalogue.length).toBeGreaterThan(0);
  }, 60_000);

  it('Speak answers on the shipped path and asks for the shipped fields', async () => {
    // Empty body: the endpoint names its required fields and queues nothing.
    const res = await fetch(
      `https://platform.higgsfield.ai${HIGGSFIELD_ENDPOINTS['higgsfield-speak']!}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...buildPrimaryHeaders(),
        },
        body: '{}',
      },
    );
    expect(res.status, 'the shipped Speak path stopped answering').toBe(422);
    const detail = JSON.stringify(await res.json());
    for (const field of ['image_url', 'audio_url', 'prompt']) {
      expect(detail, `${field} is no longer required by the Speak schema`).toContain(field);
    }
  }, 60_000);

  it('Speak caps duration at the registry maximum', async () => {
    // The media fields are present but carry the WRONG TYPE (number, not string).
    //
    // This is the only shape that keeps the assertion honest AND keeps the cost at
    // zero by construction. The earlier version sent well-formed URLs and relied on
    // the platform rejecting the over-cap duration: the moment Higgsfield raises the
    // cap or clamps instead of refusing, that body becomes a complete, valid Speak
    // request and this "free" gate starts paying for generations.
    //
    // Dropping a required field instead would be worse in the other direction — the
    // 422 would name the missing field, the test would collapse into a copy of
    // "Speak answers on the shipped path", and the cap assertion (which is what pins
    // maxDurationSec at 15) would silently stop testing anything.
    //
    // A type error cannot be clamped or defaulted away by any schema, and Pydantic
    // reports every field error in one response, so the duration error still shows up
    // alongside it.
    const res = await fetch(
      `https://platform.higgsfield.ai${HIGGSFIELD_ENDPOINTS['higgsfield-speak']!}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...buildPrimaryHeaders(),
        },
        body: JSON.stringify({
          image_url: 1,
          audio_url: 1,
          prompt: 'duration bound check',
          duration: VIDEO_MODELS['higgsfield-speak']!.maxDurationSec + 1,
        }),
      },
    );
    expect(res.status, 'a duration above the registry cap was accepted').toBe(422);
    expect(
      JSON.stringify(await res.json()),
      'the platform stopped reporting a duration error for a value above the registry cap',
    ).toContain('duration');
  }, 60_000);
});
