import { describe, it, expect } from 'vitest';
import { buildPrimaryHeaders } from '../../../src/video/providers/auth/higgsfield-headers.js';

const SHOULD_RUN =
  process.env['MEDIA_FORGE_RUN_LIVE_TESTS'] === 'true' &&
  typeof process.env['HF_API_KEY'] === 'string' &&
  process.env['HF_API_KEY'].length > 0 &&
  typeof process.env['HF_API_SECRET'] === 'string' &&
  process.env['HF_API_SECRET'].length > 0;

const describeIfLive = SHOULD_RUN ? describe : describe.skip;

/** Tiny in-memory portrait + audio URL for the probe. We don't actually want a
 * generation to succeed — only to discriminate "accepted audio reference" from
 * "upload required". Status 4xx with audio-related error text => upload path.
 * Status 4xx with image/prompt errors but no audio error => URL path accepted. */
const SAMPLE_PORTRAIT_URL = 'https://platform.higgsfield.ai/_probe/portrait.png';
const SAMPLE_AUDIO_URL = 'https://platform.higgsfield.ai/_probe/audio.wav';

describeIfLive('Higgsfield Speak audio format probe', () => {
  it('reports whether audio_url accepts plain HTTP URLs or requires signed upload', async () => {
    const res = await fetch('https://platform.higgsfield.ai/higgsfield-ai/speak/standard', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...buildPrimaryHeaders() },
      body: JSON.stringify({
        prompt: 'p14 speak audio format probe',
        first_frame_url: SAMPLE_PORTRAIT_URL,
        audio_url: SAMPLE_AUDIO_URL,
        aspect_ratio: '16:9',
        resolution: '720p',
      }),
    });
    const body = await res.text();
    // eslint-disable-next-line no-console
    console.log('[P14-speak-audio-probe]', JSON.stringify({
      status: res.status,
      bodyExcerpt: body.slice(0, 600),
    }, null, 2));
    // We accept ANY non-5xx outcome — the test exists to surface platform behavior, not to assert success.
    expect(res.status).toBeLessThan(500);
  }, 30_000);
});
