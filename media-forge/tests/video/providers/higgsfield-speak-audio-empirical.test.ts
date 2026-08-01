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
    // The probe has to DISCRIMINATE, not merely survive.
    //
    // Its only assertion used to be `expect(res.status).toBeLessThan(500)`, which
    // passes on every outcome this probe exists to tell apart: a 4xx rejecting
    // `audio_url` and a 4xx complaining about the portrait are both < 500. A
    // green run therefore said nothing, while the filename says "empirical" and
    // production still calls the shape PRELIMINAR_URL (higgsfield.ts). That is a
    // false signal of verification attached to a guessed request body.
    //
    // Classified instead. An auth/routing failure means the probe never reached
    // the question and is reported as inconclusive rather than passing quietly.
    const lower = body.toLowerCase();
    const mentionsAudio = /audio/.test(lower);
    const authOrRouting = res.status === 401 || res.status === 403 || res.status === 404;

    const verdict = authOrRouting
      ? 'inconclusive-auth-or-routing'
      : mentionsAudio
        ? 'audio_url-rejected-upload-required'
        : res.status < 400
          ? 'audio_url-accepted'
          : 'audio_url-not-the-complaint';

    // eslint-disable-next-line no-console
    console.log('[P14-speak-audio-probe] VERDICT:', verdict);

    // Reaching the platform at all is still required — a 5xx or a network error
    // means the probe told us nothing about the payload.
    expect(res.status).toBeLessThan(500);
    // And the run must have produced an answer to the question it was written to
    // ask. `inconclusive-auth-or-routing` fails here on purpose: credentials or a
    // moved endpoint are a problem with the PROBE, and a probe that cannot ask
    // its question must not report as if it did.
    expect(
      verdict,
      `probe could not discriminate — status ${res.status}, body: ${body.slice(0, 200)}`,
    ).not.toBe('inconclusive-auth-or-routing');
  }, 30_000);
});
