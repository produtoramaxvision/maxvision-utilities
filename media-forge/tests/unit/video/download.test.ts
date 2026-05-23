import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { GoogleGenAI } from '@google/genai';
import { downloadVideo } from '../../../src/video/download.js';
import { ApiError, FileSystemError } from '../../../src/core/errors.js';
import { logger } from '../../../src/core/logger.js';
import { createMockGenAI } from '../../helpers/mock-genai.js';
import type { MediaForgeClient } from '../../../src/core/client.js';

function makeClient(mock: ReturnType<typeof createMockGenAI>): MediaForgeClient {
  return {
    mode: 'gemini',
    dryRun: false,
    ai: mock.client as unknown as GoogleGenAI,
  };
}

/** Creates a mock fetch returning the given bytes with status 200. */
function mockFetchOk(bytes: Buffer): typeof fetch {
  return async (_url: string | URL | Request) =>
    ({
      ok: true,
      status: 200,
      statusText: 'OK',
      // Use slice to return exactly the bytes in this Buffer (not the full backing store)
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    }) as unknown as Response;
}

/** Creates a mock fetch returning a failure response. */
function mockFetchFail(status: number, statusText: string): typeof fetch {
  return async (_url: string | URL | Request) =>
    ({
      ok: false,
      status,
      statusText,
      arrayBuffer: async () => new ArrayBuffer(0) as ArrayBuffer,
    }) as unknown as Response;
}

let tmpDir: string;
let mock: ReturnType<typeof createMockGenAI>;

describe('downloadVideo', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'download-test-'));
    mock = createMockGenAI();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('happy: returns {outputPath, bytes, sha256} matching mocked response', async () => {
    const content = Buffer.from('fake video bytes');
    const result = await downloadVideo({
      client: makeClient(mock),
      videoUri: 'https://example.com/video.mp4',
      outputDir: tmpDir,
      fetchImpl: mockFetchOk(content),
    });
    expect(result.bytes).toBe(content.length);
    expect(result.outputPath).toBe(path.join(tmpDir, 'video.mp4'));
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    // File should exist on disk
    expect(fs.existsSync(result.outputPath)).toBe(true);
  });

  it('sha256 is stable for known input bytes', async () => {
    const content = Buffer.from('deterministic content');
    // Compute expected hash using the same approach as the implementation
    const expected = crypto.createHash('sha256').update(content).digest('hex');

    const result = await downloadVideo({
      client: makeClient(mock),
      videoUri: 'https://example.com/v.mp4',
      outputDir: tmpDir,
      fetchImpl: mockFetchOk(content),
    });
    expect(result.sha256).toBe(expected);
  });

  it('apiKey appended with & when URI already has a query string', async () => {
    let capturedUrl = '';
    const captureFetch: typeof fetch = async (url) => {
      capturedUrl = url.toString();
      const buf = Buffer.from('x');
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () =>
          buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
      } as unknown as Response;
    };

    await downloadVideo({
      client: makeClient(mock),
      videoUri: 'https://example.com/video.mp4?foo=bar',
      apiKey: 'MY_API_KEY',
      outputDir: tmpDir,
      fetchImpl: captureFetch,
    });
    expect(capturedUrl).toBe('https://example.com/video.mp4?foo=bar&key=MY_API_KEY');
  });

  it('apiKey appended with ? when URI has no query string', async () => {
    let capturedUrl = '';
    const captureFetch: typeof fetch = async (url) => {
      capturedUrl = url.toString();
      const buf = Buffer.from('x');
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () =>
          buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
      } as unknown as Response;
    };

    await downloadVideo({
      client: makeClient(mock),
      videoUri: 'https://example.com/video.mp4',
      apiKey: 'MY_API_KEY',
      outputDir: tmpDir,
      fetchImpl: captureFetch,
    });
    expect(capturedUrl).toBe('https://example.com/video.mp4?key=MY_API_KEY');
  });

  it('createTime >36h ago → logger.warn fired', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    const oldTime = new Date(Date.now() - 37 * 3_600_000).toISOString();

    await downloadVideo({
      client: makeClient(mock),
      videoUri: 'https://example.com/old.mp4',
      createTime: oldTime,
      outputDir: tmpDir,
      fetchImpl: mockFetchOk(Buffer.from('old')),
    });
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]?.[0]).toContain('36h');
  });

  it('createTime <36h ago → no warn', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    const recentTime = new Date(Date.now() - 1 * 3_600_000).toISOString();

    await downloadVideo({
      client: makeClient(mock),
      videoUri: 'https://example.com/recent.mp4',
      createTime: recentTime,
      outputDir: tmpDir,
      fetchImpl: mockFetchOk(Buffer.from('recent')),
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('fetch returns 403 → throws ApiError', async () => {
    await expect(
      downloadVideo({
        client: makeClient(mock),
        videoUri: 'https://example.com/forbidden.mp4',
        outputDir: tmpDir,
        fetchImpl: mockFetchFail(403, 'Forbidden'),
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('path traversal on filename → throws FileSystemError (via safeJoin)', async () => {
    await expect(
      downloadVideo({
        client: makeClient(mock),
        videoUri: 'https://example.com/v.mp4',
        outputDir: tmpDir,
        filename: '../evil.mp4',
        fetchImpl: mockFetchOk(Buffer.from('x')),
      }),
    ).rejects.toBeInstanceOf(FileSystemError);
  });
});
