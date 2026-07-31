// src/video/providers/kling-v2.ts
// Kling API 2.0 protocol. Pure functions — no network, no state.
//
// ## Why this exists
//
// media-forge speaks `POST /v1/videos/{type}` with `model_name` in the body.
// Every model page in Kling's current documentation describes a different shape:
//
//   legacy   POST /v1/videos/image2video      body: { model_name, image, prompt, ... }
//            GET  /v1/videos/image2video/{id}
//
//   API 2.0  POST /image-to-video/kling-3.0-turbo
//            body: { contents: [...], settings: {...}, options: {...} }
//            GET  /tasks?task_ids={id}
//
// The operation and the model version move INTO the path, `model_name`
// disappears, parameters are grouped rather than flat, and polling is one
// unified endpoint instead of one per type.
//
// Verified twice, on 2026-07-30:
//   - context7 against kling.ai/document-api (api/video/3-0-turbo)
//   - a zero-cost live probe with the real key, recorded in TODOS.md:
//       legacy  GET /v1/videos/text2video/{id}    -> HTTP 400, code 1201
//       2.0     GET /tasks?external_task_ids=...  -> HTTP 200, code 0 SUCCEED
//
// Both schemes answer. The legacy one works and is simply undocumented. That is
// what makes a flagged migration possible instead of a flag day.
//
// ## Why the legacy path is untouched here
//
// This module is additive: nothing in it runs unless MEDIA_FORGE_KLING_API_V2 is
// on. The legacy code is what every current user's jobs go through, and rewriting
// it in place to serve two protocols would put the working path at risk to reach
// the unreachable one.
//
// ## What this does NOT do
//
// It does not register the models the 2.0 API unlocks (3.0 Turbo, O1, 2.6,
// Motion Control, Avatar, ...). Each needs its own parameters and price read off
// its own page, and a model registered from a guessed spec would price wrongly in
// the ledger. The protocol lands first; models follow per verified page.

import { ApiError, ValidationError } from '../../core/errors.js';
import type { JobStatus, VideoGenerationRequest } from './base.js';

/** Same host as the legacy client. */
export const KLING_V2_BASE = 'https://api-singapore.klingai.com';

/**
 * Operations in the 2.0 path grammar: `POST /{operation}/{model-version}`.
 *
 * Kept as a closed list rather than a free string so a typo is a compile error
 * instead of a 404 discovered at submit time, after the cost guard has run and a
 * ledger row exists.
 */
export const KLING_V2_OPERATIONS = [
  'image-to-video',
  'text-to-video',
  'omni-video',
  'motion-control',
] as const;

export type KlingV2Operation = (typeof KLING_V2_OPERATIONS)[number];

/** Task states the unified /tasks endpoint reports. */
export const KLING_V2_STATUSES = ['submitted', 'processing', 'succeeded', 'failed'] as const;

export type KlingV2Status = (typeof KLING_V2_STATUSES)[number];

/**
 * Opt-in gate. Default FALSE — legacy stays the shipped path.
 *
 * Read at call time, and only the exact string 'true' enables it. A permissive
 * parse would make it easy to switch protocols by accident, and the two produce
 * different request bodies against a paid API.
 */
export function isKlingV2Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['MEDIA_FORGE_KLING_API_V2'] === 'true';
}

/** `POST /{operation}/{modelVersion}` — no `/v1/`, no `model_name` in the body. */
export function submitPathFor(operation: KlingV2Operation, modelVersion: string): string {
  if (modelVersion.length === 0) {
    throw new ValidationError('kling v2 submit path needs a model version segment');
  }
  return `/${operation}/${modelVersion}`;
}

/**
 * `GET /tasks`, querying by ONE id kind.
 *
 * The documentation is explicit that `task_ids` and `external_task_ids` cannot be
 * used together, so this refuses both rather than silently picking one — a
 * request that quietly drops half its filter returns the wrong task.
 */
export function pollPathFor(args: {
  readonly taskIds?: ReadonlyArray<string>;
  readonly externalTaskIds?: ReadonlyArray<string>;
}): string {
  const hasTask = (args.taskIds?.length ?? 0) > 0;
  const hasExternal = (args.externalTaskIds?.length ?? 0) > 0;

  if (hasTask && hasExternal) {
    throw new ValidationError(
      'kling v2 /tasks accepts task_ids OR external_task_ids, never both — the API ' +
        'documents them as mutually exclusive, and sending both would query on one and ' +
        'silently ignore the other',
    );
  }
  if (!hasTask && !hasExternal) {
    throw new ValidationError('kling v2 /tasks needs at least one id to query');
  }

  const key = hasTask ? 'task_ids' : 'external_task_ids';
  const ids = (hasTask ? args.taskIds! : args.externalTaskIds!).join(',');
  return `/tasks?${key}=${encodeURIComponent(ids)}`;
}

/**
 * Registry model id -> the 2.0 path it is served by.
 *
 * ONLY verified entries belong here. A model whose 2.0 path was guessed would
 * submit to a 404 after the cost guard has run and a ledger row exists, or worse
 * submit successfully to the wrong model and bill for it.
 *
 * An UNMAPPED model is not an error: `resolveV2Route` returns undefined and the
 * caller falls back to the legacy protocol. That is what makes the flag safe to
 * turn on — it upgrades the models that have been verified and leaves the rest
 * exactly as they are today.
 *
 * Verified 2026-07-30 via context7 against kling.ai/document-api:
 *   kling-3.0-turbo -> POST /image-to-video/kling-3.0-turbo (api/video/3-0-turbo)
 *
 * Deliberately NOT mapped yet, despite being plausible: kling-v3-standard /
 * -pro / -master are internal TIER ids that legacy expressed as model_name plus a
 * mode, and 2.0 expresses as a model path plus settings.resolution. Which path
 * each tier corresponds to has not been read off its page, and inferring it is
 * how a 4K request ends up billed against a different model.
 */
const V2_ROUTES: Readonly<Record<string, { operation: KlingV2Operation; modelVersion: string }>> = {
  'kling-3.0-turbo': { operation: 'image-to-video', modelVersion: 'kling-3.0-turbo' },
};

/**
 * Resolves a registry model id to its 2.0 route, or undefined when unmapped.
 *
 * Returns undefined rather than throwing so an unmapped model degrades to legacy
 * instead of failing — turning the flag on must never break a model that works
 * today.
 */
export function resolveV2Route(
  modelId: string,
): { operation: KlingV2Operation; modelVersion: string } | undefined {
  return V2_ROUTES[modelId];
}

/** Model ids that ONLY exist on 2.0 and cannot fall back. */
export function isV2OnlyModel(modelId: string): boolean {
  return modelId === 'kling-3.0-turbo';
}

/**
 * The 2.0 API accepts API-key auth only.
 *
 * From the 06/17/2026 API update: "the new API exclusively uses API Key
 * authentication". The legacy JWT signed from KLING_ACCESS_KEY/KLING_SECRET_KEY
 * is rejected, so a user with only the legacy pair would get an auth error whose
 * cause is invisible. Checked before submit, with the remedy named.
 */
export function assertV2AuthAvailable(env: NodeJS.ProcessEnv = process.env): void {
  const apiKey = env['KLING_API_KEY'];
  if (apiKey === undefined || apiKey.length === 0) {
    throw new ValidationError(
      'The Kling API 2.0 accepts API-key authentication only — set KLING_API_KEY. The legacy ' +
        'KLING_ACCESS_KEY/KLING_SECRET_KEY pair signs a JWT that 2.0 rejects, so leaving it ' +
        'that way fails at submit with an auth error that does not say why. Either set the ' +
        'API key or unset MEDIA_FORGE_KLING_API_V2 to stay on the legacy protocol.',
    );
  }
}

export interface KlingV2Content {
  readonly type: 'prompt' | 'negative_prompt' | 'first_frame' | 'last_frame' | 'reference_image';
  readonly text?: string;
  readonly url?: string;
}

export interface KlingV2Body {
  readonly contents: ReadonlyArray<KlingV2Content>;
  readonly settings: Record<string, unknown>;
  readonly options?: Record<string, unknown>;
}

export interface BuildV2BodyArgs {
  readonly req: VideoGenerationRequest;
  readonly externalTaskId?: string;
  readonly callbackUrl?: string;
  readonly watermark?: boolean;
}

/**
 * Builds the 2.0 request body.
 *
 * The three groups are the API's own shape, not a convenience:
 *   contents  what the model is given — prompt text and reference frames
 *   settings  how the output should look — resolution, duration
 *   options   how the job is administered — callback, external id, watermark
 *
 * `model_name` is deliberately absent. It lives in the URL now, and including it
 * in the body would be a leftover from the legacy shape.
 */
export function buildV2Body(args: BuildV2BodyArgs): KlingV2Body {
  const { req } = args;
  const contents: KlingV2Content[] = [];

  if (req.prompt.length === 0) {
    throw new ValidationError('kling v2 requires a non-empty prompt');
  }
  contents.push({ type: 'prompt', text: req.prompt });

  // First/last frame are URLs in 2.0. A local path would be sent verbatim and
  // rejected by the API, so it fails here with a message that says why.
  if (req.firstFrameImagePath !== undefined) {
    contents.push({ type: 'first_frame', url: assertUrl(req.firstFrameImagePath, 'first_frame') });
  }
  if (req.lastFrameImagePath !== undefined) {
    contents.push({ type: 'last_frame', url: assertUrl(req.lastFrameImagePath, 'last_frame') });
  }
  for (const ref of req.referenceImagePaths ?? []) {
    contents.push({ type: 'reference_image', url: assertUrl(ref, 'reference_image') });
  }

  const settings: Record<string, unknown> = {
    resolution: req.resolution,
    duration: req.durationSec,
  };

  const options: Record<string, unknown> = {};
  if (args.externalTaskId !== undefined) options['external_task_id'] = args.externalTaskId;
  if (args.callbackUrl !== undefined) options['callback_url'] = args.callbackUrl;
  if (args.watermark !== undefined) options['watermark_info'] = { enabled: args.watermark };

  return {
    contents,
    settings,
    ...(Object.keys(options).length > 0 ? { options } : {}),
  };
}

function assertUrl(value: string, field: string): string {
  if (!/^https?:\/\//i.test(value)) {
    throw new ValidationError(
      `kling v2 expects a URL for "${field}", got "${value.slice(0, 60)}". The 2.0 API takes ` +
        `remote URLs in contents[]; upload the asset first and pass its URL.`,
    );
  }
  return value;
}

/**
 * Maps a 2.0 task status onto the repo's JobState union.
 *
 * An unrecognised status maps to `in_progress`, not `failed`: it most likely
 * means Kling added a state this build has not seen, and treating that as failure
 * would abandon a job that is running and already billing.
 */
export function mapV2Status(status: string | undefined): JobStatus['state'] {
  switch (status) {
    case 'succeeded':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'submitted':
      return 'pending';
    case 'processing':
      return 'in_progress';
    default:
      return 'in_progress';
  }
}

export interface KlingV2TaskEnvelope {
  readonly code?: number;
  readonly message?: string;
  readonly data?: unknown;
}

export interface KlingV2Task {
  readonly id: string;
  readonly status: KlingV2Status | string;
  readonly message?: string;
  readonly external_id?: string;
  readonly outputs?: ReadonlyArray<{
    readonly type?: string;
    readonly id?: string;
    readonly url?: string;
    readonly watermark_url?: string;
    readonly duration?: string;
  }>;
}

/**
 * Reads the submit response.
 *
 * `code` is checked before `data`: Kling returns HTTP 200 with a non-zero `code`
 * for application-level failures, so trusting the status line alone would treat a
 * refusal as a success and mint a job id that does not exist.
 */
export function parseV2SubmitResponse(body: unknown): { taskId: string; status: string } {
  const envelope = body as KlingV2TaskEnvelope;

  if (typeof envelope?.code === 'number' && envelope.code !== 0) {
    throw new ApiError(
      `kling v2 submit rejected: code ${envelope.code} ${envelope.message ?? ''}`.trim(),
      'API',
      { provider: 'kling' },
    );
  }

  const data = envelope?.data as { id?: string; status?: string } | undefined;
  if (data?.id === undefined || data.id.length === 0) {
    throw new ApiError(
      `kling v2 submit returned no task id: ${JSON.stringify(body).slice(0, 300)}`,
      'API',
      { provider: 'kling' },
    );
  }

  return { taskId: data.id, status: data.status ?? 'submitted' };
}

/**
 * Reads a /tasks response into JobStatus.
 *
 * `data` is an ARRAY here, unlike the submit response's single object — the same
 * endpoint serves batch queries. Treating it as an object silently yields
 * undefined and looks like a job that vanished.
 */
export function parseV2TaskResponse(body: unknown, jobId: string): JobStatus {
  const envelope = body as KlingV2TaskEnvelope;

  if (typeof envelope?.code === 'number' && envelope.code !== 0) {
    return {
      jobId,
      state: 'failed',
      errorMessage: `kling v2 /tasks returned code ${envelope.code}: ${envelope.message ?? ''}`.trim(),
    };
  }

  const tasks = Array.isArray(envelope?.data) ? (envelope.data as KlingV2Task[]) : [];
  const task = tasks[0];

  if (task === undefined) {
    return {
      jobId,
      state: 'failed',
      errorMessage: 'kling v2 /tasks returned no task for this id',
    };
  }

  // watermark_url is ignored: the caller asked for a specific watermark setting
  // at submit, and returning the other variant here would silently deliver an
  // asset that does not match what was requested and paid for.
  const urls = (task.outputs ?? [])
    .map((o) => o.url)
    .filter((u): u is string => typeof u === 'string' && u.length > 0);

  return {
    jobId,
    state: mapV2Status(task.status),
    assetUrls: urls,
    ...(task.message !== undefined && task.status === 'failed'
      ? { errorMessage: task.message }
      : {}),
  };
}
