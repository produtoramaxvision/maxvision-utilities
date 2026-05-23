import { GenerateVideosOperation } from '@google/genai';
import { ApiError, PollingError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import type { MediaForgeClient } from '../core/client.js';

export interface PollResult {
  operation: unknown;
  attempts: number;
  totalMs: number;
}

export interface PollOpts {
  client: MediaForgeClient;
  operationName: string;
  intervalMs?: number;
  maxAttempts?: number;
  abortSignal?: AbortSignal;
}

type OperationShape = {
  done?: boolean;
  error?: unknown;
  name?: string;
  response?: unknown;
};

/**
 * Creates a real SDK GenerateVideosOperation instance seeded with the given
 * operation name.
 *
 * @google/genai 2.6.0 `operations.getVideosOperation()` calls
 * `parameters.operation._fromAPIResponse({ apiResponse, _isVertexAI })` on
 * the object it receives (SDK source: index.mjs lines 16200, 16210).  A plain
 * `{ name }` object has no `_fromAPIResponse` and throws
 * `TypeError: operation._fromAPIResponse is not a function`.
 *
 * Using the SDK's own class ensures:
 *  1. No TypeError — the prototype method exists.
 *  2. Proper normalization — the Gemini (mldev) branch maps
 *     `response.generateVideoResponse.generatedSamples[].video.uri`
 *     to the canonical `response.generatedVideos[].video.uri` shape that
 *     callers (download.ts, live-smoke test) depend on.
 *  3. Forward compatibility — future SDK normalisation improvements apply
 *     automatically.
 */
function makeOperationHandle(opLike: { name?: string }): GenerateVideosOperation {
  const handle = new GenerateVideosOperation();
  if (opLike.name !== undefined) {
    handle.name = opLike.name;
  }
  return handle;
}

export async function pollVideoOperation(opts: PollOpts): Promise<PollResult> {
  const intervalMs = opts.intervalMs ?? 10_000;
  const maxAttempts = opts.maxAttempts ?? 90;
  const start = Date.now();

  let operation: OperationShape = (await opts.client.ai.operations.getVideosOperation({
    operation: makeOperationHandle({ name: opts.operationName }),
  })) as OperationShape;

  let attempts = 0;

  while (!operation.done && attempts < maxAttempts) {
    // Bail immediately if the caller's signal is already aborted (avoids
    // a wasted intervalMs sleep + an extra getVideosOperation call on
    // pre-aborted controllers, e.g. shared controllers between requests).
    if (opts.abortSignal?.aborted) {
      throw new Error('aborted');
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, intervalMs);
      opts.abortSignal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new Error('aborted'));
        },
        { once: true },
      );
    });
    operation = (await opts.client.ai.operations.getVideosOperation({
      operation: makeOperationHandle(operation),
    })) as OperationShape;
    attempts++;
    logger.debug('poll: tick', { name: opts.operationName, attempts });
  }

  if (!operation.done) {
    throw new PollingError(
      `Video operation timed out after ${attempts} attempts (~${(intervalMs * attempts) / 1000}s)`,
      {
        operationName: opts.operationName,
        attempts,
        maxAttempts,
      },
    );
  }

  if (operation.error) {
    throw new ApiError(`Video operation failed: ${JSON.stringify(operation.error)}`, 'API', {
      operation,
    });
  }

  return { operation, attempts, totalMs: Date.now() - start };
}
