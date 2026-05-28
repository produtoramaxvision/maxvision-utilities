import { describe, it, expect, beforeEach } from 'vitest';
import {
  submitArkTask,
  pollArkTask,
  downloadArkAsset,
  ArkAuthConfigError,
  ArkHttpError,
} from '../../../src/video/providers/byteplus-ark.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOkFetch(jsonBody: unknown): typeof fetch {
  return async (_url: RequestInfo | URL, _init?: RequestInit) =>
    ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'video/mp4' }),
      json: async () => jsonBody,
      text: async () => JSON.stringify(jsonBody),
      arrayBuffer: async () => new ArrayBuffer(8),
    }) as unknown as Response;
}

function makeErrorFetch(status: number, bodyText: string): typeof fetch {
  return async (_url: RequestInfo | URL, _init?: RequestInit) =>
    ({
      ok: false,
      status,
      headers: new Headers(),
      json: async () => ({}),
      text: async () => bodyText,
    }) as unknown as Response;
}

// ---------------------------------------------------------------------------
// Submit — body shape
// ---------------------------------------------------------------------------

describe('submitArkTask', () => {
  beforeEach(() => {
    process.env['BYTEPLUS_ARK_API_KEY'] = 'test-ark-key-xyz';
  });

  it('posts to /api/v3/contents/generations/tasks with Bearer token', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchMock: typeof fetch = async (url, init = {}) => {
      calls.push({ url: url.toString(), init });
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ id: 'ark-task-123', status: 'queued' }),
        text: async () => '',
      } as unknown as Response;
    };

    const result = await submitArkTask({
      model: 'seedance-2.0-fast',
      prompt: 'a cat',
      durationSec: 5,
      resolution: '720p',
      fetchImpl: fetchMock,
    });

    expect(result.taskId).toBe('ark-task-123');
    expect(result.status).toBe('queued');
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toContain('/api/v3/contents/generations/tasks');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-ark-key-xyz');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('body shape: top-level keys are [content, model]; content has required fields', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchMock: typeof fetch = async (_url, init = {}) => {
      capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ id: 'ark-shape-1', status: 'queued' }),
        text: async () => '',
      } as unknown as Response;
    };

    await submitArkTask({
      model: 'seedance-2.0-standard',
      prompt: 'shape-check',
      durationSec: 5,
      resolution: '1080p',
      fetchImpl: fetchMock,
    });

    expect(capturedBody).not.toBeNull();
    // CRITICAL: top-level keys. If ARK docs reveal different nesting, this test
    // fails LOUDLY — fix adapter first, then update this assertion.
    expect(Object.keys(capturedBody!).sort()).toEqual(['content', 'model']);
    const content = capturedBody!['content'] as Record<string, unknown>;
    expect(content).toMatchObject({
      type: 'video',
      prompt: 'shape-check',
      duration: 5,
      resolution: '1080p',
    });
  });

  it('Seedance 2.0 model name passes through unchanged', async () => {
    let sentBody: Record<string, unknown> | null = null;
    const fetchMock: typeof fetch = async (_url, init = {}) => {
      sentBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ id: 'model-test', status: 'queued' }),
        text: async () => '',
      } as unknown as Response;
    };

    await submitArkTask({
      model: 'seedance-2.0-fast',
      prompt: 'test',
      durationSec: 4,
      resolution: '720p',
      fetchImpl: fetchMock,
    });

    expect(sentBody!['model']).toBe('seedance-2.0-fast');
  });

  it('resolution and duration enums appear in content block', async () => {
    let sentBody: Record<string, unknown> | null = null;
    const fetchMock: typeof fetch = async (_url, init = {}) => {
      sentBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ id: 't', status: 'queued' }),
        text: async () => '',
      } as unknown as Response;
    };

    await submitArkTask({
      model: 'seedance-2.0-standard',
      prompt: 'p',
      durationSec: 10,
      resolution: '1080p',
      fetchImpl: fetchMock,
    });

    const content = sentBody!['content'] as Record<string, unknown>;
    expect(content['resolution']).toBe('1080p');
    expect(content['duration']).toBe(10);
  });

  it('includes Authorization header matching /^Bearer /', async () => {
    let capturedHeaders: Record<string, string> | null = null;
    const fetchMock: typeof fetch = async (_url, init = {}) => {
      capturedHeaders = init.headers as Record<string, string>;
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ id: 'h-test', status: 'queued' }),
        text: async () => '',
      } as unknown as Response;
    };

    await submitArkTask({
      model: 'seedance-2.0-fast',
      prompt: 'p',
      durationSec: 5,
      resolution: '720p',
      fetchImpl: fetchMock,
    });

    expect(capturedHeaders!['Authorization']).toMatch(/^Bearer /);
    expect(capturedHeaders!['Content-Type']).toBe('application/json');
  });

  it('exact submit URL matches ARK endpoint', async () => {
    let capturedUrl = '';
    const fetchMock: typeof fetch = async (url, _init) => {
      capturedUrl = url.toString();
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ id: 'u-test', status: 'queued' }),
        text: async () => '',
      } as unknown as Response;
    };

    await submitArkTask({
      model: 'seedance-2.0-fast',
      prompt: 'p',
      durationSec: 5,
      resolution: '720p',
      fetchImpl: fetchMock,
    });

    expect(capturedUrl).toBe(
      'https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks',
    );
  });

  // -------------------------------------------------------------------------
  // Auth errors
  // -------------------------------------------------------------------------

  it('throws ArkAuthConfigError when BYTEPLUS_ARK_API_KEY is unset', async () => {
    const saved = process.env['BYTEPLUS_ARK_API_KEY'];
    delete process.env['BYTEPLUS_ARK_API_KEY'];
    try {
      await expect(
        submitArkTask({
          model: 'seedance-2.0-fast',
          prompt: 'x',
          durationSec: 5,
          resolution: '720p',
          fetchImpl: makeOkFetch({ id: 'x', status: 'queued' }),
        }),
      ).rejects.toThrow(ArkAuthConfigError);
    } finally {
      if (saved !== undefined) process.env['BYTEPLUS_ARK_API_KEY'] = saved;
    }
  });

  it('throws ArkAuthConfigError when BYTEPLUS_ARK_API_KEY is empty string', async () => {
    const saved = process.env['BYTEPLUS_ARK_API_KEY'];
    process.env['BYTEPLUS_ARK_API_KEY'] = '   ';
    try {
      await expect(
        submitArkTask({
          model: 'seedance-2.0-fast',
          prompt: 'x',
          durationSec: 5,
          resolution: '720p',
          fetchImpl: makeOkFetch({ id: 'x', status: 'queued' }),
        }),
      ).rejects.toThrow(ArkAuthConfigError);
    } finally {
      if (saved !== undefined) process.env['BYTEPLUS_ARK_API_KEY'] = saved;
    }
  });

  // -------------------------------------------------------------------------
  // HTTP error mapping
  // -------------------------------------------------------------------------

  it('surfaces ARK 5xx errors with status code in message', async () => {
    await expect(
      submitArkTask({
        model: 'seedance-2.0-fast',
        prompt: 'x',
        durationSec: 5,
        resolution: '720p',
        fetchImpl: makeErrorFetch(503, 'Service unavailable'),
      }),
    ).rejects.toThrow(/503/);
  });

  it('maps 401 (missing/invalid auth) to ArkHttpError with status 401', async () => {
    const err = await submitArkTask({
      model: 'seedance-2.0-fast',
      prompt: 'x',
      durationSec: 5,
      resolution: '720p',
      fetchImpl: makeErrorFetch(401, 'Unauthorized'),
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ArkHttpError);
    expect((err as ArkHttpError).status).toBe(401);
    expect((err as ArkHttpError).message).toMatch(/401/);
  });

  it('maps 429 (rate limit) to ArkHttpError with status 429', async () => {
    const err = await submitArkTask({
      model: 'seedance-2.0-fast',
      prompt: 'x',
      durationSec: 5,
      resolution: '720p',
      fetchImpl: makeErrorFetch(429, 'Too Many Requests'),
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ArkHttpError);
    expect((err as ArkHttpError).status).toBe(429);
    expect((err as ArkHttpError).message).toMatch(/429/);
  });

  it('maps 404 (model not found) to ArkHttpError with status 404', async () => {
    const err = await submitArkTask({
      model: 'seedance-2.0-nonexistent',
      prompt: 'x',
      durationSec: 5,
      resolution: '720p',
      fetchImpl: makeErrorFetch(404, 'Model not found'),
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ArkHttpError);
    expect((err as ArkHttpError).status).toBe(404);
    expect((err as ArkHttpError).message).toMatch(/404/);
  });
});

// ---------------------------------------------------------------------------
// Poll — status transitions
// ---------------------------------------------------------------------------

describe('pollArkTask', () => {
  beforeEach(() => {
    process.env['BYTEPLUS_ARK_API_KEY'] = 'test-ark-key-xyz';
  });

  it('GETs /api/v3/contents/generations/tasks/<id> with GET method', async () => {
    const calls: { url: string; method: string }[] = [];
    const fetchMock: typeof fetch = async (url, init = {}) => {
      calls.push({ url: url.toString(), method: (init.method ?? 'GET') });
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          id: 'ark-task-123',
          status: 'succeeded',
          content: { video_url: 'https://ark.cdn/clip.mp4' },
        }),
        text: async () => '',
      } as unknown as Response;
    };

    const result = await pollArkTask({ taskId: 'ark-task-123', fetchImpl: fetchMock });

    expect(result.status).toBe('succeeded');
    expect(result.videoUrl).toBe('https://ark.cdn/clip.mp4');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toMatch(/\/api\/v3\/contents\/generations\/tasks\/ark-task-123$/);
    expect(calls[0]!.method).toBe('GET');
  });

  it('status queued: returns queued, no videoUrl', async () => {
    const result = await pollArkTask({
      taskId: 'task-q',
      fetchImpl: makeOkFetch({ id: 'task-q', status: 'queued' }),
    });
    expect(result.status).toBe('queued');
    expect(result.videoUrl).toBeUndefined();
  });

  it('status running (in_progress): returns running, no videoUrl', async () => {
    const result = await pollArkTask({
      taskId: 'task-r',
      fetchImpl: makeOkFetch({ id: 'task-r', status: 'running' }),
    });
    expect(result.status).toBe('running');
    expect(result.videoUrl).toBeUndefined();
  });

  it('status completed (succeeded): returns videoUrl', async () => {
    const result = await pollArkTask({
      taskId: 'task-done',
      fetchImpl: makeOkFetch({
        id: 'task-done',
        status: 'succeeded',
        content: { video_url: 'https://cdn.byteplus.com/output.mp4' },
      }),
    });
    expect(result.status).toBe('succeeded');
    expect(result.videoUrl).toBe('https://cdn.byteplus.com/output.mp4');
  });

  it('maps ARK status "failed" with error_message', async () => {
    const result = await pollArkTask({
      taskId: 'task-fail',
      fetchImpl: makeOkFetch({
        id: 'task-fail',
        status: 'failed',
        error_message: 'NSFW content detected',
      }),
    });
    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('NSFW');
  });

  it('maps ARK status "canceled"', async () => {
    const result = await pollArkTask({
      taskId: 'task-cancel',
      fetchImpl: makeOkFetch({ id: 'task-cancel', status: 'canceled' }),
    });
    expect(result.status).toBe('canceled');
  });

  it('throws ArkHttpError on poll failure', async () => {
    const err = await pollArkTask({
      taskId: 'bad',
      fetchImpl: makeErrorFetch(500, 'Internal Error'),
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ArkHttpError);
    expect((err as ArkHttpError).status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

describe('downloadArkAsset', () => {
  it('fetches URL and returns buffer + metadata', async () => {
    const fetchMock: typeof fetch = async (_url, _init) =>
      ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'video/mp4' }),
        arrayBuffer: async () => {
          const buf = new ArrayBuffer(16);
          new Uint8Array(buf).fill(0xff);
          return buf;
        },
        text: async () => '',
        json: async () => ({}),
      }) as unknown as Response;

    const result = await downloadArkAsset({
      url: 'https://ark.cdn/clip.mp4',
      fetchImpl: fetchMock,
    });

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBe(16);
    expect(result.metadata.contentType).toBe('video/mp4');
    expect(result.metadata.sizeBytes).toBe(16);
    expect(result.metadata.cdnUrl).toBe('https://ark.cdn/clip.mp4');
  });

  it('throws ArkHttpError when CDN returns non-2xx', async () => {
    const err = await downloadArkAsset({
      url: 'https://ark.cdn/expired.mp4',
      fetchImpl: makeErrorFetch(403, 'Forbidden'),
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ArkHttpError);
    expect((err as ArkHttpError).status).toBe(403);
  });

  it('defaults content-type to video/mp4 when header absent', async () => {
    const fetchMock: typeof fetch = async () =>
      ({
        ok: true,
        status: 200,
        headers: new Headers(),
        arrayBuffer: async () => new ArrayBuffer(4),
        text: async () => '',
        json: async () => ({}),
      }) as unknown as Response;

    const result = await downloadArkAsset({ url: 'https://example.com/v.bin', fetchImpl: fetchMock });
    expect(result.metadata.contentType).toBe('video/mp4');
  });
});

// ---------------------------------------------------------------------------
// Per-test fetchImpl isolation
// ---------------------------------------------------------------------------

describe('per-test fetchImpl isolation', () => {
  beforeEach(() => {
    process.env['BYTEPLUS_ARK_API_KEY'] = 'isolation-key';
  });

  it('each test gets its own mock — calls do not bleed between tests', async () => {
    let call1Count = 0;
    let call2Count = 0;

    const mock1: typeof fetch = async () => {
      call1Count++;
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ id: 'm1', status: 'queued' }),
        text: async () => '',
      } as unknown as Response;
    };

    const mock2: typeof fetch = async () => {
      call2Count++;
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ id: 'm2', status: 'running' }),
        text: async () => '',
      } as unknown as Response;
    };

    await submitArkTask({ model: 'seedance-2.0-fast', prompt: 'a', durationSec: 4, resolution: '720p', fetchImpl: mock1 });
    await pollArkTask({ taskId: 'ark-1', fetchImpl: mock2 });

    expect(call1Count).toBe(1);
    expect(call2Count).toBe(1);
  });
});
