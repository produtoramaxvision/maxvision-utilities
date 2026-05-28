/**
 * BytePlus ModelArk direct REST client — Seedance 2.0 fallback path.
 *
 * Kept isolated from bytedance-seedance.ts so swapping to a different regional
 * ARK endpoint (e.g. Volcengine CN in P17) does not touch provider orchestration.
 *
 * Auth: Authorization: Bearer $BYTEPLUS_ARK_API_KEY
 * Submit:  POST https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks
 * Poll:    GET  https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks/<task_id>
 * Download: GET <video_url> (returned in poll response)
 */

const ARK_BASE =
  'https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks';

// -------------------------------------------------------------------------
// Defensive first-404 logger (debug-friendly, silent after first hit).
// -------------------------------------------------------------------------
let _loggedFirst404 = false;

function maybeLog404(url: string, bodyPreview: string): void {
  if (_loggedFirst404) return;
  _loggedFirst404 = true;
  process.stderr.write(
    `[byteplus-ark] WARN: first 404 from ARK REST — check endpoint path or model name.\n` +
      `  url:  ${url}\n` +
      `  body: ${bodyPreview.slice(0, 400)}\n`,
  );
}

// -------------------------------------------------------------------------
// Error classes
// -------------------------------------------------------------------------

export class ArkAuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArkAuthConfigError';
  }
}

export class ArkHttpError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'ArkHttpError';
    this.status = status;
    this.body = body;
  }
}

// -------------------------------------------------------------------------
// Interfaces
// -------------------------------------------------------------------------

export interface SubmitArkOptions {
  readonly model: string;
  readonly prompt: string;
  readonly durationSec: number;
  /** Resolution enum per A0.6 (480p supported on fast tier; 1080p Standard-only). */
  readonly resolution: '480p' | '720p' | '1080p';
  readonly aspectRatio?: '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16';
  readonly imageUrls?: ReadonlyArray<string>;
  readonly videoUrls?: ReadonlyArray<string>;
  readonly audioUrls?: ReadonlyArray<string>;
  readonly seed?: number;
  readonly endUserId?: string;
  /** Inject a fetch implementation at call time (enables per-test mocking). */
  readonly fetchImpl?: typeof fetch;
  /**
   * Optional injected API key — overrides process.env['BYTEPLUS_ARK_API_KEY']. Lets
   * BytedanceSeedanceProvider pass its `env.BYTEPLUS_ARK_API_KEY` (constructor-
   * injected) so tests and runtime callers that use env-injection actually
   * authenticate. (Codex P2 fix, PR#12.)
   */
  readonly apiKey?: string;
}

export interface SubmitArkResult {
  readonly taskId: string;
  readonly status: string;
}

export type ArkStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface PollArkOptions {
  readonly taskId: string;
  /** Inject a fetch implementation at call time (enables per-test mocking). */
  readonly fetchImpl?: typeof fetch;
  /** Override process.env BYTEPLUS_ARK_API_KEY (Codex P2 fix PR#12). */
  readonly apiKey?: string;
}

export interface PollArkResult {
  readonly taskId: string;
  readonly status: ArkStatus | string;
  readonly videoUrl?: string;
  readonly errorMessage?: string;
}

export interface DownloadArkOptions {
  readonly url: string;
  /** Inject a fetch implementation at call time (enables per-test mocking). */
  readonly fetchImpl?: typeof fetch;
}

export interface DownloadedArkAsset {
  readonly buffer: Buffer;
  readonly metadata: {
    readonly contentType: string;
    readonly sizeBytes: number;
    readonly cdnUrl: string;
  };
}

// -------------------------------------------------------------------------
// Auth helper
// -------------------------------------------------------------------------

function buildAuthHeader(injectedKey?: string): { Authorization: string } {
  // FIX (Codex P2, PR#12): honor injected key from opts before falling back to
  // process.env. BytedanceSeedanceProvider passes its constructor-injected
  // env.BYTEPLUS_ARK_API_KEY through opts.apiKey so providers + tests with
  // isolated env subsets actually authenticate.
  const key = (injectedKey ?? process.env['BYTEPLUS_ARK_API_KEY'])?.trim();
  if (!key || key.length === 0) {
    throw new ArkAuthConfigError(
      'BytePlus ARK auth not configured. Set BYTEPLUS_ARK_API_KEY env var. ' +
        'Generate a key at https://console.byteplus.com/auth/api-key',
    );
  }
  return { Authorization: `Bearer ${key}` };
}

// -------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------

/**
 * Submits a Seedance video generation task to BytePlus ModelArk.
 *
 * Body shape: `{ model, content: { type, prompt, duration, resolution, ... } }`
 * — mirrors the BytePlus ModelArk REST contract. If official docs reveal a
 * different top-level key structure, update the body object AND the test that
 * pins `Object.keys(body).sort()` === ['content', 'model'].
 */
export async function submitArkTask(opts: SubmitArkOptions): Promise<SubmitArkResult> {
  const authHeader = buildAuthHeader(opts.apiKey);
  const headers: Record<string, string> = {
    ...authHeader,
    'Content-Type': 'application/json',
    ...(opts.endUserId ? { 'X-End-User-Id': opts.endUserId } : {}),
  };

  const content: Record<string, unknown> = {
    type: 'video',
    prompt: opts.prompt,
    duration: opts.durationSec,
    resolution: opts.resolution,
    aspect_ratio: opts.aspectRatio ?? '16:9',
  };
  if (opts.imageUrls && opts.imageUrls.length > 0) content['image_urls'] = [...opts.imageUrls];
  if (opts.videoUrls && opts.videoUrls.length > 0) content['video_urls'] = [...opts.videoUrls];
  if (opts.audioUrls && opts.audioUrls.length > 0) content['audio_urls'] = [...opts.audioUrls];
  if (typeof opts.seed === 'number') content['seed'] = opts.seed;

  const body = { model: opts.model, content };

  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(ARK_BASE, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 404) {
      maybeLog404(ARK_BASE, text);
    }
    throw new ArkHttpError(
      `ARK submitArkTask failed: HTTP ${res.status}`,
      res.status,
      text,
    );
  }

  const json = (await res.json()) as { id: string; status: string };
  return { taskId: json.id, status: json.status };
}

/**
 * Polls a BytePlus ModelArk task by id. Maps ARK's native response shape:
 * - `content.video_url` → `videoUrl`
 * - `error_message`     → `errorMessage`
 */
export async function pollArkTask(opts: PollArkOptions): Promise<PollArkResult> {
  const authHeader = buildAuthHeader(opts.apiKey);
  const url = `${ARK_BASE}/${opts.taskId}`;

  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(url, {
    method: 'GET',
    headers: { ...authHeader },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 404) {
      maybeLog404(url, text);
    }
    throw new ArkHttpError(
      `ARK pollArkTask failed: HTTP ${res.status}`,
      res.status,
      text,
    );
  }

  const json = (await res.json()) as {
    id: string;
    status: ArkStatus;
    content?: { video_url?: string };
    error_message?: string;
  };

  return {
    taskId: json.id,
    status: json.status,
    videoUrl: json.content?.video_url,
    errorMessage: json.error_message,
  };
}

/**
 * Downloads a BytePlus ARK video asset from a CDN URL.
 * Mirrors higgsfield.ts download pattern: GET → arrayBuffer → Buffer.
 */
export async function downloadArkAsset(opts: DownloadArkOptions): Promise<DownloadedArkAsset> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(opts.url, { method: 'GET' });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 404) {
      maybeLog404(opts.url, text);
    }
    throw new ArkHttpError(
      `ARK downloadArkAsset failed: HTTP ${res.status}`,
      res.status,
      text,
    );
  }

  const arr = await res.arrayBuffer();
  const buffer = Buffer.from(arr);
  return {
    buffer,
    metadata: {
      contentType: res.headers.get('content-type') ?? 'video/mp4',
      sizeBytes: buffer.length,
      cdnUrl: opts.url,
    },
  };
}
