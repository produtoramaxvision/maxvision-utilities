import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GenerateVideosOperation } from '@google/genai';
import type { GoogleGenAI } from '@google/genai';
import { pollVideoOperation } from '../../../src/video/polling.js';
import { ApiError, PollingError } from '../../../src/core/errors.js';
import { createMockGenAI } from '../../helpers/mock-genai.js';
import type { MediaForgeClient } from '../../../src/core/client.js';

function makeClient(mock: ReturnType<typeof createMockGenAI>): MediaForgeClient {
  return {
    mode: 'gemini',
    dryRun: false,
    ai: mock.client as unknown as GoogleGenAI,
  };
}

describe('pollVideoOperation', () => {
  let mock: ReturnType<typeof createMockGenAI>;

  beforeEach(() => {
    mock = createMockGenAI();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns immediately if operation.done=true on first call → attempts=0', async () => {
    vi.spyOn(mock.client.operations, 'getVideosOperation').mockResolvedValueOnce({
      name: 'op-done',
      done: true,
      response: { generatedVideos: [] },
    });
    const result = await pollVideoOperation({
      client: makeClient(mock),
      operationName: 'op-done',
      intervalMs: 1000,
      maxAttempts: 5,
    });
    expect(result.attempts).toBe(0);
    expect(result.operation).toMatchObject({ done: true });
  });

  it('completes after 3 ticks', async () => {
    const spy = vi.spyOn(mock.client.operations, 'getVideosOperation')
      .mockResolvedValueOnce({ name: 'op-tick', done: false })
      .mockResolvedValueOnce({ name: 'op-tick', done: false })
      .mockResolvedValueOnce({ name: 'op-tick', done: false })
      .mockResolvedValueOnce({ name: 'op-tick', done: true, response: {} });

    const promise = pollVideoOperation({
      client: makeClient(mock),
      operationName: 'op-tick',
      intervalMs: 1000,
      maxAttempts: 10,
    });

    // Advance through 3 intervals
    await vi.advanceTimersByTimeAsync(3000);

    const result = await promise;
    expect(result.attempts).toBe(3);
    expect(spy).toHaveBeenCalledTimes(4); // 1 initial + 3 ticks
  });

  it('timeout: never done within maxAttempts=3 → throws PollingError', async () => {
    vi.spyOn(mock.client.operations, 'getVideosOperation').mockResolvedValue({
      name: 'op-timeout',
      done: false,
    });

    const promise = pollVideoOperation({
      client: makeClient(mock),
      operationName: 'op-timeout',
      intervalMs: 1000,
      maxAttempts: 3,
    });

    // Set up assertion promise FIRST (registers rejection handler before timers fire)
    const assertion = expect(promise).rejects.toBeInstanceOf(PollingError);

    // Advance past all 3 intervals
    await vi.advanceTimersByTimeAsync(4000);

    // Now await the assertion
    await assertion;
  });

  it('operation.error set after done=true → throws ApiError', async () => {
    vi.spyOn(mock.client.operations, 'getVideosOperation').mockResolvedValueOnce({
      name: 'op-err',
      done: true,
      error: { code: 500, message: 'internal' },
    });

    await expect(
      pollVideoOperation({
        client: makeClient(mock),
        operationName: 'op-err',
        intervalMs: 1000,
        maxAttempts: 5,
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('abortSignal aborts mid-poll → throws with "aborted"', async () => {
    vi.spyOn(mock.client.operations, 'getVideosOperation')
      .mockResolvedValueOnce({ name: 'op-abort', done: false })
      .mockResolvedValue({ name: 'op-abort', done: false });

    const controller = new AbortController();

    const promise = pollVideoOperation({
      client: makeClient(mock),
      operationName: 'op-abort',
      intervalMs: 5000,
      maxAttempts: 10,
      abortSignal: controller.signal,
    });

    // Set up assertion FIRST to register rejection handler
    const assertion = expect(promise).rejects.toThrow(/aborted/);

    // Let initial call resolve, then abort while waiting in the sleep
    await Promise.resolve(); // flush microtasks so initial getVideosOperation resolves
    controller.abort(); // fires abort event synchronously into the pending sleep promise

    await assertion;
  });

  it('passes a real GenerateVideosOperation instance to getVideosOperation', async () => {
    let capturedArg: unknown;
    vi.spyOn(mock.client.operations, 'getVideosOperation').mockImplementation(async (req) => {
      capturedArg = req;
      return { name: 'op-stub', done: true, response: {} };
    });

    await pollVideoOperation({
      client: makeClient(mock),
      operationName: 'op-stub',
      intervalMs: 1000,
      maxAttempts: 5,
    });

    // The operation handle must be a real SDK class instance carrying the original name
    const handle = (capturedArg as { operation: GenerateVideosOperation }).operation;
    expect(handle).toBeInstanceOf(GenerateVideosOperation);
    expect(handle.name).toBe('op-stub');

    // The prototype _fromAPIResponse must be a function (SDK's real normalizer, not a stub)
    expect(typeof handle._fromAPIResponse).toBe('function');
  });

  it('intervalMs override is respected (mock called at correct cadence)', async () => {
    const spy = vi.spyOn(mock.client.operations, 'getVideosOperation')
      .mockResolvedValueOnce({ name: 'op-interval', done: false })
      .mockResolvedValueOnce({ name: 'op-interval', done: true, response: {} });

    const promise = pollVideoOperation({
      client: makeClient(mock),
      operationName: 'op-interval',
      intervalMs: 2000,
      maxAttempts: 5,
    });

    // After 1999ms, second call should NOT have happened yet
    await vi.advanceTimersByTimeAsync(1999);
    // Only the initial call happened
    expect(spy).toHaveBeenCalledTimes(1);

    // Advance past 2000ms to trigger the first tick
    await vi.advanceTimersByTimeAsync(1);
    await promise;

    expect(spy).toHaveBeenCalledTimes(2);
  });
});
