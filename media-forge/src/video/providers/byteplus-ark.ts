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

import { resolveReferenceAuthority } from '../reference-authority.js';

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
  /**
   * The frame the clip must OPEN on. Kept separate from `imageUrls` because ARK
   * gives it a different role (`first_frame`) and documents the frame scenarios
   * as mutually exclusive with multimodal references — merging them, which is
   * what this adapter used to do, silently demotes a hard frame constraint to a
   * loose style hint.
   */
  readonly firstFrameUrl?: string;
  /** The frame the clip must CLOSE on. Requires a first frame. */
  readonly lastFrameUrl?: string;
  /** Loose multimodal references. Cannot be combined with the frames above. */
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
 * media-forge registry id -> the model id ARK actually accepts.
 *
 * The adapter used to pass `req.modelId` straight through, which meant ARK was
 * asked for `seedance-2.0-standard` — a name only this repo uses. Verified via
 * context7 against ModelArk doc 2298881 ("Model Capabilities"), which names
 * `dreamina-seedance-2-0-260128` as standard Dreamina Seedance 2.0 and
 * `dreamina-seedance-2-0-fast-260128` as the faster variant. Both appear as
 * `model` values in the task-listing responses of docs 1521675 and 2291680.
 *
 * An unmapped id is refused rather than forwarded: sending a registry name ARK
 * has never heard of produces an error from the vendor about a model, which
 * reads as "the model is unavailable" instead of "this adapter sent the wrong
 * string".
 */
const ARK_MODEL_IDS: Readonly<Record<string, string>> = Object.freeze({
  'seedance-2.0-standard': 'dreamina-seedance-2-0-260128',
  'seedance-2.0-fast': 'dreamina-seedance-2-0-fast-260128',
});

export function arkModelIdFor(registryId: string): string {
  const arkId = ARK_MODEL_IDS[registryId];
  if (arkId === undefined) {
    throw new ArkAuthConfigError(
      `no BytePlus ModelArk model id is known for "${registryId}". ARK accepts the vendor's ` +
        `own ids (e.g. dreamina-seedance-2-0-260128), not media-forge registry names. ` +
        `Add the mapping in byteplus-ark.ts rather than forwarding a name ARK cannot resolve.`,
    );
  }
  return arkId;
}

/**
 * Submits a Seedance video generation task to BytePlus ModelArk.
 *
 * ## The body this used to send was a guess, and it was wrong
 *
 * The previous shape was `{ model, content: { type, prompt, duration, ... } }`
 * with `image_urls` / `video_urls` / `audio_urls` arrays nested inside
 * `content`. Its own comment admitted the guess: "If official docs reveal a
 * different top-level key structure, update the body object". They do.
 *
 * Verified via context7 against ModelArk docs 1366799 (this exact endpoint),
 * 2291680 and 2315856. Four things were wrong at once, so the ARK-direct route
 * cannot ever have completed a submit:
 *
 *   content       is an ARRAY of typed items, not an object
 *   the prompt    goes in `content[].text`, not `content.prompt`
 *   references    go in `content[].image_url.url` with a `role`, not in
 *                 `content.image_urls[]`
 *   duration/seed are TOP-LEVEL, not nested inside content
 *
 * The `role` field is the vendor's own vocabulary — `reference_image`,
 * `reference_video`, `reference_audio` — and doc 1520757 states the scenarios
 * (first-frame, first-and-last-frame, multimodal reference) are mutually
 * exclusive.
 *
 * The poll half was already correct: `{ id, status, content.video_url }` matches
 * the documented GET response, which is why only the submit is rewritten here.
 *
 * STILL NOT EXERCISED LIVE. This repo has no BYTEPLUS_ARK_API_KEY, so what
 * changed is a guess replaced by a documented shape — stronger evidence, not a
 * response from the API.
 */
export async function submitArkTask(opts: SubmitArkOptions): Promise<SubmitArkResult> {
  const authHeader = buildAuthHeader(opts.apiKey);
  const headers: Record<string, string> = {
    ...authHeader,
    'Content-Type': 'application/json',
    ...(opts.endUserId ? { 'X-End-User-Id': opts.endUserId } : {}),
  };

  // The prompt is always first. ARK reads the array in order, and reference
  // items are described relative to the text that precedes them.
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: opts.prompt }];

  // T12: exactly one role per asset, and the three ARK scenarios never mixed.
  // Throws on an ambiguous set rather than picking — the resolver's whole reason
  // to exist is that authority must never be inferred from media type or order.
  const { assignments } = resolveReferenceAuthority({
    firstFrameUrl: opts.firstFrameUrl,
    lastFrameUrl: opts.lastFrameUrl,
    referenceImageUrls: opts.imageUrls,
    referenceVideoUrls: opts.videoUrls,
    referenceAudioUrls: opts.audioUrls,
  });

  for (const { url, role } of assignments) {
    if (role === 'reference_video') {
      content.push({ type: 'video_url', video_url: { url }, role });
    } else if (role === 'reference_audio') {
      content.push({ type: 'audio_url', audio_url: { url }, role });
    } else {
      // first_frame, last_frame and reference_image are all image_url items;
      // only the role separates them, which is precisely the distinction that
      // was being lost.
      content.push({ type: 'image_url', image_url: { url }, role });
    }
  }

  const body: Record<string, unknown> = {
    model: arkModelIdFor(opts.model),
    content,
    duration: opts.durationSec,
    resolution: opts.resolution,
    ratio: opts.aspectRatio ?? '16:9',
  };
  if (typeof opts.seed === 'number') body['seed'] = opts.seed;

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
