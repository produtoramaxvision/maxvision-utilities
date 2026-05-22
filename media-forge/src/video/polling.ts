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

export async function pollVideoOperation(opts: PollOpts): Promise<PollResult> {
  const intervalMs = opts.intervalMs ?? 10_000;
  const maxAttempts = opts.maxAttempts ?? 90;
  const start = Date.now();

  let operation: OperationShape = (await opts.client.ai.operations.getVideosOperation({
    operation: { name: opts.operationName } as never,
  })) as OperationShape;

  let attempts = 0;

  while (!operation.done && attempts < maxAttempts) {
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
      operation: operation as never,
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
