import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isKlingV2Enabled,
  submitPathFor,
  pollPathFor,
  buildV2Body,
  mapV2Status,
  parseV2SubmitResponse,
  parseV2TaskResponse,
  resolveV2Route,
  isV2OnlyModel,
  assertV2AuthAvailable,
  KLING_V2_STATUSES,
} from '../../../src/video/providers/kling-v2.js';
import { ValidationError, ApiError } from '../../../src/core/errors.js';
import type { VideoGenerationRequest } from '../../../src/video/providers/base.js';
import { VIDEO_MODELS } from '../../../src/core/models.js';

function baseReq(overrides: Partial<VideoGenerationRequest> = {}): VideoGenerationRequest {
  return {
    modelId: 'kling-3.0-turbo',
    mode: 't2v',
    prompt: 'a cat riding a skateboard',
    durationSec: 5,
    resolution: '1080p',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isKlingV2Enabled — only the exact string 'true' may switch protocols.
// ---------------------------------------------------------------------------
describe('isKlingV2Enabled', () => {
  it('"true" enables it', () => {
    expect(isKlingV2Enabled({ MEDIA_FORGE_KLING_API_V2: 'true' })).toBe(true);
  });

  // A permissive parser here would let a shell typo or a truthy-looking value
  // silently switch a paid API to a body shape the other side does not expect.
  it.each(['TRUE', '1', 'yes', ''])('%j does NOT enable it (only exact "true" does)', (v) => {
    expect(isKlingV2Enabled({ MEDIA_FORGE_KLING_API_V2: v })).toBe(false);
  });

  it('unset does NOT enable it (default stays legacy)', () => {
    expect(isKlingV2Enabled({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// submitPathFor — `/{operation}/{modelVersion}`, no `/v1/` prefix.
// ---------------------------------------------------------------------------
describe('submitPathFor', () => {
  it('builds the 2.0 path with no /v1/ segment', () => {
    const path = submitPathFor('image-to-video', 'kling-3.0-turbo');
    expect(path).toBe('/image-to-video/kling-3.0-turbo');
    // The whole point of this module is that 2.0 dropped /v1/ — a regression
    // that reintroduced it would silently 404 against the legacy host path.
    expect(path).not.toContain('/v1/');
  });

  it('empty model version throws rather than emitting a malformed path', () => {
    expect(() => submitPathFor('image-to-video', '')).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// pollPathFor — the discriminating case: task_ids XOR external_task_ids.
// ---------------------------------------------------------------------------
describe('pollPathFor', () => {
  it('taskIds alone works', () => {
    expect(pollPathFor({ taskIds: ['abc123'] })).toBe('/tasks?task_ids=abc123');
  });

  it('externalTaskIds alone works', () => {
    expect(pollPathFor({ externalTaskIds: ['ext-1'] })).toBe('/tasks?external_task_ids=ext-1');
  });

  // The API documents these as mutually exclusive. Sending both would have the
  // server filter on one kind and silently ignore the other rather than erroring
  // — so this must refuse locally instead of shipping an ambiguous request.
  it('BOTH taskIds and externalTaskIds together throws', () => {
    expect(() =>
      pollPathFor({ taskIds: ['a'], externalTaskIds: ['b'] }),
    ).toThrow(ValidationError);
  });

  it('NEITHER id kind throws (nothing to query)', () => {
    expect(() => pollPathFor({})).toThrow(ValidationError);
  });

  it('multiple ids join with a comma', () => {
    const path = pollPathFor({ taskIds: ['id1', 'id2', 'id3'] });
    expect(path).toContain('id1%2Cid2%2Cid3');
  });

  it('the id list is URL-encoded (comma becomes %2C, not a raw ",")', () => {
    const path = pollPathFor({ taskIds: ['id1', 'id2'] });
    expect(path).toBe('/tasks?task_ids=id1%2Cid2');
    expect(path).not.toContain('id1,id2');
  });
});

// ---------------------------------------------------------------------------
// buildV2Body
// ---------------------------------------------------------------------------
describe('buildV2Body', () => {
  it('prompt becomes contents[0] with type "prompt"', () => {
    const body = buildV2Body({ req: baseReq({ prompt: 'hello world' }) });
    expect(body.contents[0]).toEqual({ type: 'prompt', text: 'hello world' });
  });

  it('firstFrameImagePath/lastFrameImagePath become first_frame/last_frame entries', () => {
    const body = buildV2Body({
      req: baseReq({
        firstFrameImagePath: 'https://cdn.example.com/first.png',
        lastFrameImagePath: 'https://cdn.example.com/last.png',
      }),
    });
    expect(body.contents).toContainEqual({
      type: 'first_frame',
      url: 'https://cdn.example.com/first.png',
    });
    expect(body.contents).toContainEqual({
      type: 'last_frame',
      url: 'https://cdn.example.com/last.png',
    });
  });

  it('referenceImagePaths each become a reference_image entry', () => {
    const body = buildV2Body({
      req: baseReq({
        referenceImagePaths: [
          'https://cdn.example.com/ref1.png',
          'https://cdn.example.com/ref2.png',
        ],
      }),
    });
    const refs = body.contents.filter((c) => c.type === 'reference_image');
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.url)).toEqual([
      'https://cdn.example.com/ref1.png',
      'https://cdn.example.com/ref2.png',
    ]);
  });

  it('settings carries resolution + duration', () => {
    const body = buildV2Body({ req: baseReq({ resolution: '720p', durationSec: 8 }) });
    expect(body.settings).toEqual({ resolution: '720p', duration: 8 });
  });

  it('options is ABSENT when no option was supplied', () => {
    const body = buildV2Body({ req: baseReq() });
    expect(body.options).toBeUndefined();
    expect('options' in body).toBe(false);
  });

  it('options is present when at least one option was supplied', () => {
    const body = buildV2Body({ req: baseReq(), callbackUrl: 'https://example.com/cb' });
    expect(body.options).toEqual({ callback_url: 'https://example.com/cb' });
  });

  it('options carries external_task_id, callback_url, and watermark_info together', () => {
    const body = buildV2Body({
      req: baseReq(),
      externalTaskId: 'ext-42',
      callbackUrl: 'https://example.com/cb',
      watermark: false,
    });
    expect(body.options).toEqual({
      external_task_id: 'ext-42',
      callback_url: 'https://example.com/cb',
      watermark_info: { enabled: false },
    });
  });

  // The legacy protocol carries model identity as `model_name` in the body.
  // 2.0 moves it into the URL — a leftover `model_name` key would be a silent
  // hybrid of both shapes, undetectable by a shallow "does it have contents/settings" check.
  it('body does NOT contain model_name — it lives in the URL in 2.0', () => {
    const body = buildV2Body({ req: baseReq() }) as Record<string, unknown>;
    expect('model_name' in body).toBe(false);
    expect(JSON.stringify(body)).not.toContain('model_name');
  });

  it('empty prompt throws', () => {
    expect(() => buildV2Body({ req: baseReq({ prompt: '' }) })).toThrow(ValidationError);
  });

  // 2.0 takes remote URLs in contents[], not filesystem paths. A local path sent
  // verbatim would be rejected remotely (or worse, silently misinterpreted) —
  // catching it locally with a message that says "wants a URL" is the whole point.
  it('a LOCAL PATH for a frame throws with a message that explains it wants a URL', () => {
    expect(() =>
      buildV2Body({ req: baseReq({ firstFrameImagePath: '/local/disk/frame.png' }) }),
    ).toThrow(ValidationError);
    try {
      buildV2Body({ req: baseReq({ firstFrameImagePath: '/local/disk/frame.png' }) });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as Error).message).toMatch(/URL/);
    }
  });

  it('a LOCAL PATH for a reference image also throws', () => {
    expect(() =>
      buildV2Body({ req: baseReq({ referenceImagePaths: ['C:\\local\\ref.png'] }) }),
    ).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// mapV2Status
// ---------------------------------------------------------------------------
describe('mapV2Status', () => {
  const expected: Record<string, string> = {
    succeeded: 'completed',
    failed: 'failed',
    submitted: 'pending',
    processing: 'in_progress',
  };

  // Iterates the exported status list rather than hardcoding four calls: a new
  // status added to KLING_V2_STATUSES without an entry here would otherwise
  // fall through silently to the default arm and never be caught by this test.
  it.each(KLING_V2_STATUSES)('%s maps to the expected JobState', (status) => {
    expect(mapV2Status(status)).toBe(expected[status]);
  });

  // An unrecognised status must NOT be treated as 'failed': the job is most
  // likely still running (and billing) under a status this build has never
  // seen, and abandoning it as failed would be the expensive mistake, not the
  // safe default.
  it('an UNKNOWN status maps to "in_progress", never "failed"', () => {
    expect(mapV2Status('some-future-status')).toBe('in_progress');
  });

  it('undefined status also maps to "in_progress"', () => {
    expect(mapV2Status(undefined)).toBe('in_progress');
  });
});

// ---------------------------------------------------------------------------
// parseV2SubmitResponse
// ---------------------------------------------------------------------------
describe('parseV2SubmitResponse', () => {
  it('reads data.id and data.status', () => {
    const result = parseV2SubmitResponse({
      code: 0,
      message: 'SUCCEED',
      data: { id: 'task-123', status: 'submitted' },
    });
    expect(result).toEqual({ taskId: 'task-123', status: 'submitted' });
  });

  it('defaults status to "submitted" when the response omits it', () => {
    const result = parseV2SubmitResponse({ code: 0, data: { id: 'task-456' } });
    expect(result.status).toBe('submitted');
  });

  // Kling reports application-level failures with HTTP 200 + non-zero code.
  // Trusting the (200) status line and reading data.id anyway would mint a
  // job id that does not exist on the provider's side.
  it('a NON-ZERO code throws even though this represents an HTTP 200 body', () => {
    expect(() =>
      parseV2SubmitResponse({ code: 1234, message: 'insufficient balance' }),
    ).toThrow(ApiError);
    try {
      parseV2SubmitResponse({ code: 1234, message: 'insufficient balance' });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('1234');
      expect((err as Error).message).toContain('insufficient balance');
    }
  });

  it('missing id throws with the raw body included in the message', () => {
    const body = { code: 0, data: { status: 'submitted' } };
    try {
      parseV2SubmitResponse(body);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as Error).message).toContain(JSON.stringify(body).slice(0, 50));
    }
  });

  it('empty-string id also throws (not just undefined)', () => {
    expect(() => parseV2SubmitResponse({ code: 0, data: { id: '' } })).toThrow(ApiError);
  });
});

// ---------------------------------------------------------------------------
// parseV2TaskResponse — data is an ARRAY here, unlike submit's single object.
// ---------------------------------------------------------------------------
describe('parseV2TaskResponse', () => {
  it('a well-formed array yields state + assetUrls from outputs[].url', () => {
    const body = {
      code: 0,
      data: [
        {
          id: 'task-1',
          status: 'succeeded',
          outputs: [{ type: 'video', id: 'o1', url: 'https://cdn.example.com/out.mp4' }],
        },
      ],
    };
    const result = parseV2TaskResponse(body, 'job-1');
    expect(result.state).toBe('completed');
    expect(result.assetUrls).toEqual(['https://cdn.example.com/out.mp4']);
  });

  // Same non-zero-code contract as submit, but the caller here is polling, not
  // submitting — the honest response is a failed JobStatus with the reason
  // attached, not a thrown exception that would crash a poll loop.
  it('non-zero code returns state "failed" with an errorMessage rather than throwing', () => {
    const result = parseV2TaskResponse({ code: 500, message: 'server error' }, 'job-2');
    expect(result.state).toBe('failed');
    expect(result.errorMessage).toContain('500');
    expect(result.errorMessage).toContain('server error');
  });

  it('empty data array returns "failed" with a message (no task for this id)', () => {
    const result = parseV2TaskResponse({ code: 0, data: [] }, 'job-3');
    expect(result.state).toBe('failed');
    expect(result.errorMessage).toBeDefined();
  });

  it('data as a bare object (not an array) is treated as "no task" rather than crashing', () => {
    const result = parseV2TaskResponse({ code: 0, data: { id: 'not-an-array' } }, 'job-4');
    expect(result.state).toBe('failed');
  });

  // The caller chose a watermark setting at submit time. Returning the other
  // variant here would silently deliver an asset that does not match what was
  // requested and paid for — so watermark_url must never leak into assetUrls.
  it('watermark_url is NOT included in assetUrls even when present on the output', () => {
    const body = {
      code: 0,
      data: [
        {
          id: 'task-5',
          status: 'succeeded',
          outputs: [
            {
              type: 'video',
              id: 'o1',
              url: 'https://cdn.example.com/clean.mp4',
              watermark_url: 'https://cdn.example.com/watermarked.mp4',
            },
          ],
        },
      ],
    };
    const result = parseV2TaskResponse(body, 'job-5');
    expect(result.assetUrls).toEqual(['https://cdn.example.com/clean.mp4']);
    expect(result.assetUrls).not.toContain('https://cdn.example.com/watermarked.mp4');
  });

  it('a failed task surfaces task.message as errorMessage', () => {
    const body = {
      code: 0,
      data: [{ id: 'task-6', status: 'failed', message: 'content policy violation' }],
    };
    const result = parseV2TaskResponse(body, 'job-6');
    expect(result.state).toBe('failed');
    expect(result.errorMessage).toBe('content policy violation');
  });

  it('a non-failed task does NOT surface task.message as errorMessage', () => {
    const body = {
      code: 0,
      data: [{ id: 'task-7', status: 'processing', message: 'informational note' }],
    };
    const result = parseV2TaskResponse(body, 'job-7');
    expect(result.errorMessage).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// assertV2AuthAvailable
// ---------------------------------------------------------------------------
describe('assertV2AuthAvailable', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env['KLING_API_KEY'];
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('throws when KLING_API_KEY is unset', () => {
    expect(() => assertV2AuthAvailable({})).toThrow(ValidationError);
  });

  it('throws when KLING_API_KEY is an empty string', () => {
    expect(() => assertV2AuthAvailable({ KLING_API_KEY: '' })).toThrow(ValidationError);
  });

  it('the thrown message names KLING_API_KEY and explains the legacy JWT is rejected', () => {
    try {
      assertV2AuthAvailable({});
      throw new Error('should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('KLING_API_KEY');
      expect(msg.toLowerCase()).toContain('jwt');
    }
  });

  it('passes (does not throw) when KLING_API_KEY is set', () => {
    expect(() => assertV2AuthAvailable({ KLING_API_KEY: 'ak-live-123' })).not.toThrow();
  });

  it('reads real process.env by default when no env arg is passed', () => {
    process.env['KLING_API_KEY'] = 'from-process-env';
    expect(() => assertV2AuthAvailable()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// resolveV2Route / isV2OnlyModel
// ---------------------------------------------------------------------------
describe('resolveV2Route / isV2OnlyModel', () => {
  it('kling-3.0-turbo resolves to its verified 2.0 route', () => {
    expect(resolveV2Route('kling-3.0-turbo')).toEqual({
      operation: 'image-to-video',
      modelVersion: 'kling-3.0-turbo',
    });
  });

  it('kling-3.0-turbo is v2-only', () => {
    expect(isV2OnlyModel('kling-3.0-turbo')).toBe(true);
  });

  // Unmapped is not an error condition — it is what makes the flag safe:
  // an unmapped model must fall back to the legacy protocol rather than fail.
  it('an UNMAPPED model (kling-v3-standard) returns undefined from resolveV2Route', () => {
    expect(resolveV2Route('kling-v3-standard')).toBeUndefined();
  });

  it('an UNMAPPED model is NOT v2-only, so it stays reachable via legacy', () => {
    expect(isV2OnlyModel('kling-v3-standard')).toBe(false);
  });

  it('a completely unknown model id is also not v2-only', () => {
    expect(isV2OnlyModel('totally-made-up-model')).toBe(false);
    expect(resolveV2Route('totally-made-up-model')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// kling-3.0-turbo registry entry (src/core/models.ts) — the derivation the
// gate exists to protect. Written as a multiplication rather than a rounded
// decimal in the source so it stays auditable; this test protects that chain.
// ---------------------------------------------------------------------------
describe('kling-3.0-turbo registry entry', () => {
  const spec = VIDEO_MODELS['kling-3.0-turbo'];

  it('is registered', () => {
    expect(spec).toBeDefined();
  });

  it('base rate is 0.8 units/s * $0.14/unit', () => {
    expect(spec!.pricing.rate).toBeCloseTo(0.8 * 0.14, 10);
  });

  it('resolutionMultipliers: 720p=1, 1080p=1/0.8', () => {
    expect(spec!.pricing.resolutionMultipliers?.['720p']).toBe(1);
    expect(spec!.pricing.resolutionMultipliers?.['1080p']).toBeCloseTo(1 / 0.8, 10);
  });

  it('maxDurationSec is 15', () => {
    expect(spec!.maxDurationSec).toBe(15);
  });

  it('resolutions are exactly 720p and 1080p', () => {
    expect([...spec!.resolutions].sort()).toEqual(['1080p', '720p']);
  });

  // The published figure is "1.0 unit/second for 1080P" at $0.14/unit. The
  // derived cost must land on that number exactly (within float tolerance) —
  // this is the auditability the multiplication-not-decimal choice buys.
  it('the DERIVED 1080p cost equals the published $0.14/s exactly', () => {
    const derived = spec!.pricing.rate * (spec!.pricing.resolutionMultipliers?.['1080p'] ?? 1);
    expect(derived).toBeCloseTo(0.14, 10);
  });
});
