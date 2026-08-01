// Live gate: every Higgsfield endpoint this repo ships against the platform's
// own catalogue.
//
// `GET /models` returns the authoritative model list — slug, operation_type,
// output_type and base_credits. It is a read and costs nothing. Probed on
// 2026-08-01 with a freshly minted API key, it answered 13 models, and six of
// the ten endpoints in HIGGSFIELD_ENDPOINTS were not among them. Each of those
// six also answered `404 {"detail":"model_not_found"}` to a direct POST, so the
// absence is the platform's answer and not a listing quirk.
//
// This file pins TODAY'S TRUTH rather than the wish list: the four reachable
// endpoints must stay reachable, and the six absent ones must stay absent. If
// Higgsfield ships Speak on this surface, or retires DoP Turbo, this turns red
// and someone reads the record instead of discovering it through a failed
// paid call.
//
// Needs HF_API_KEY + HF_API_SECRET (Higgsfield Cloud dashboard -> API Keys) and
// MEDIA_FORGE_RUN_LIVE_TESTS=true.

import { describe, it, expect } from 'vitest';
import { HIGGSFIELD_ENDPOINTS } from '../../../src/video/providers/higgsfield.js';
import { buildPrimaryHeaders } from '../../../src/video/providers/auth/higgsfield-headers.js';

const SHOULD_RUN =
  process.env['MEDIA_FORGE_RUN_LIVE_TESTS'] === 'true' &&
  (process.env['HF_API_KEY']?.length ?? 0) > 0 &&
  (process.env['HF_API_SECRET']?.length ?? 0) > 0;

const describeIfLive = SHOULD_RUN ? describe : describe.skip;

/**
 * Endpoints this repo maps that the platform does not serve, with the answer it
 * gave on 2026-08-01. Removing an entry is a claim that the model now exists —
 * the assertion below will check it.
 */
const KNOWN_ABSENT: Readonly<Record<string, string>> = {
  // "pro" is not a tier. The path segment is a mode, and the platform said so:
  // Input should be 'reference', 'character' or 'standard'
  'higgsfield-soul-pro': 'invalid mode segment — soul takes reference|character|standard',
  // The catalogue lists this as `higgsfield-ai/soul/v2/standard`.
  'higgsfield-soul2': '404 model_not_found — catalogued as higgsfield-ai/soul/v2/standard',
  // Speak answers on /v1/speak/higgsfield, which GET /models does not list at
  // all. Two live surfaces, one catalogue. See TODOS.md.
  'higgsfield-speak': '404 model_not_found — Speak lives at /v1/speak/higgsfield',
  'higgsfield-speak2': '404 model_not_found — no speak2 on either surface',
  'higgsfield-cinema-studio-3.5': '404 model_not_found — catalogue has soul/cinema (an IMAGE model)',
  'higgsfield-marketing-studio': '404 model_not_found — not in the catalogue',
  'higgsfield-recast': '404 model_not_found — not in the catalogue',
};

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
  it('every mapped endpoint is either catalogued or listed as known-absent', async () => {
    const slugs = new Set((await fetchCatalogue()).map((m) => `/${m.slug}`));

    const unexpectedlyAbsent: string[] = [];
    const unexpectedlyPresent: string[] = [];

    for (const [modelId, endpoint] of Object.entries(HIGGSFIELD_ENDPOINTS)) {
      const catalogued = slugs.has(endpoint);
      const expectedAbsent = modelId in KNOWN_ABSENT;
      if (!catalogued && !expectedAbsent) unexpectedlyAbsent.push(`${modelId} -> ${endpoint}`);
      if (catalogued && expectedAbsent) unexpectedlyPresent.push(`${modelId} -> ${endpoint}`);
    }

    expect(
      unexpectedlyAbsent,
      'mapped endpoints the platform no longer serves — every call to these returns model_not_found',
    ).toEqual([]);
    expect(
      unexpectedlyPresent,
      'listed in KNOWN_ABSENT but the platform now serves them — remove the entry and wire the tool',
    ).toEqual([]);
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

  it('the Speak contract is the params-wrapped one, and its path is not ours', async () => {
    // Two POSTs with deliberately empty bodies. Neither can start a generation:
    // one 404s, the other fails schema validation before any work is queued.
    const post = (path: string, body: unknown): Promise<Response> =>
      fetch(`https://platform.higgsfield.ai${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...buildPrimaryHeaders(),
        },
        body: JSON.stringify(body),
      });

    const ours = await post(HIGGSFIELD_ENDPOINTS['higgsfield-speak']!, {});
    expect(ours.status, 'the shipped Speak path answered something other than 404').toBe(404);

    const documented = await post('/v1/speak/higgsfield', { params: {} });
    expect(documented.status).toBe(422);
    const detail = JSON.stringify(await documented.json());
    for (const field of ['input_image', 'input_audio', 'prompt']) {
      expect(detail, `${field} is no longer required by the Speak schema`).toContain(field);
    }
  }, 60_000);
});
