import { describe, it, expect } from 'vitest';

/**
 * Empirical Higgsfield auth probe.
 *
 * Sends a minimal `POST /higgsfield-ai/soul/standard` request with each of the
 * two candidate auth schemes and reports which one(s) the platform accepts.
 *
 * Run with: HF_API_KEY=... HF_API_SECRET=... MEDIA_FORGE_RUN_LIVE_TESTS=true \
 *   pnpm vitest run tests/video/providers/higgsfield-auth-empirical.test.ts
 *
 * Without those env vars the suite is skipped (no fake assertions).
 */
const SHOULD_RUN =
  process.env['MEDIA_FORGE_RUN_LIVE_TESTS'] === 'true' &&
  typeof process.env['HF_API_KEY'] === 'string' &&
  process.env['HF_API_KEY'].length > 0 &&
  typeof process.env['HF_API_SECRET'] === 'string' &&
  process.env['HF_API_SECRET'].length > 0;

const describeIfLive = SHOULD_RUN ? describe : describe.skip;

const BASE = 'https://platform.higgsfield.ai';
const ENDPOINT = `${BASE}/higgsfield-ai/soul/standard`;

interface ProbeOutcome {
  scheme: string;
  status: number;
  acceptedAuth: boolean;
  bodyExcerpt: string;
}

async function probe(headers: Record<string, string>, label: string): Promise<ProbeOutcome> {
  const minimalBody = {
    prompt: 'P14 auth probe — please reject for content rules, accept for auth',
    aspect_ratio: '16:9',
    resolution: '720p',
  };
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: JSON.stringify(minimalBody),
  });
  const text = await res.text();
  // 200/201/202 = accepted. 400/422 = auth OK but body validation rejected (still proves auth works).
  // 401/403 = auth rejected.
  const acceptedAuth = res.status !== 401 && res.status !== 403;
  return {
    scheme: label,
    status: res.status,
    acceptedAuth,
    bodyExcerpt: text.slice(0, 400),
  };
}

describeIfLive('Higgsfield auth empirical', () => {
  const key = process.env['HF_API_KEY']!;
  const secret = process.env['HF_API_SECRET']!;

  it('reports which auth scheme(s) the platform accepts', async () => {
    const sdkOutcome = await probe(
      { 'hf-api-key': key, 'hf-secret': secret },
      'SDK headers (hf-api-key + hf-secret)',
    );
    const restOutcome = await probe(
      { Authorization: `Key ${key}:${secret}` },
      'REST Authorization: Key K:S',
    );

    // eslint-disable-next-line no-console
    console.log('[P14-auth-probe]', JSON.stringify({ sdkOutcome, restOutcome }, null, 2));

    // We require AT LEAST ONE scheme to succeed. The plan handler in Step 4
    // reads this output and updates higgsfield-headers.ts accordingly.
    expect(sdkOutcome.acceptedAuth || restOutcome.acceptedAuth).toBe(true);
  }, 30_000);
});
