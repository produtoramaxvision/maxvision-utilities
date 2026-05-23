/**
 * E2E integration test for video generation pipeline (mocked SDK).
 * Exercises: generateVideoT2V → pollVideoOperation → downloadVideo
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import { makeTempDir, type TempDirHandle } from '../helpers/fs-tempdir.js';
import { createMockGenAI } from '../helpers/mock-genai.js';
import { generateVideoT2V, generateVideoI2V, pollVideoOperation, downloadVideo } from '../../src/video/video-service.js';
import { GenerateVideoT2VInput, GenerateVideoI2VInput } from '../../src/video/video-schemas.js';
import { TINY_PNG_BASE64 } from '../helpers/fixtures.js';
import type { MediaForgeClient } from '../../src/core/client.js';

// ---------------------------------------------------------------------------
// Helper: 1 KB binary blob for mock video response
// ---------------------------------------------------------------------------

const MOCK_VIDEO_BYTES = crypto.randomBytes(1024);

function buildMockFetch(bytes: Buffer): typeof fetch {
  return async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'video/mp4' },
    });
  };
}

function buildMockedClient(mockAi: ReturnType<typeof createMockGenAI>): MediaForgeClient {
  return {
    mode: 'gemini',
    dryRun: false,
    ai: mockAi.client as unknown as MediaForgeClient['ai'],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('E2E video pipeline (mocked SDK)', () => {
  let tmp: TempDirHandle;

  beforeEach(() => {
    tmp = makeTempDir('e2e-video-');
  });

  afterEach(() => {
    tmp.cleanup();
  });

  it('T2V happy path: generate → poll (2 ticks → done) → download, bytes stable', async () => {
    const mock = createMockGenAI();

    // generateVideos returns the operation name
    mock.queueVideoOperation('op-t2v-test-1');
    // 1st poll: not done yet
    mock.queueVideoOperation('op-t2v-test-1');
    // 2nd poll: done
    mock.queueVideoComplete('op-t2v-test-1', 'https://video.test/t2v-result.mp4');

    const client = buildMockedClient(mock);

    const input = GenerateVideoT2VInput.parse({
      op: 't2v',
      prompt: 'A calm blue ocean pan, daylight',
      aspectRatio: '16:9',
      durationSeconds: 4,
      resolution: '720p',
      generateAudio: false,
    });

    // Generate → operation name returned
    const genResult = await generateVideoT2V(input, client);
    expect(genResult.operationName).toBe('op-t2v-test-1');

    // Poll with intervalMs: 1 — no fake timers needed, resolves immediately
    const pollResult = await pollVideoOperation({
      client,
      operationName: genResult.operationName,
      intervalMs: 1,
      maxAttempts: 10,
    });
    expect(pollResult.operation).toBeTruthy();

    const op = pollResult.operation as {
      done?: boolean;
      response?: { generatedVideos?: Array<{ video?: { uri?: string } }> };
    };
    const videoUri = op.response?.generatedVideos?.[0]?.video?.uri;
    expect(videoUri).toBe('https://video.test/t2v-result.mp4');

    // Download with injected fetch
    const dlResult = await downloadVideo({
      client,
      videoUri: videoUri!,
      outputDir: tmp.path,
      filename: 'result.mp4',
      fetchImpl: buildMockFetch(MOCK_VIDEO_BYTES),
    });

    expect(dlResult.bytes).toBe(1024);
    expect(fs.existsSync(dlResult.outputPath)).toBe(true);

    // SHA256 stability: same bytes → same hash on re-read
    const onDisk = fs.readFileSync(dlResult.outputPath);
    const expectedSha = crypto.createHash('sha256').update(MOCK_VIDEO_BYTES).digest('hex');
    expect(dlResult.sha256).toBe(expectedSha);
    const reHash = crypto.createHash('sha256').update(onDisk).digest('hex');
    expect(reHash).toBe(expectedSha);
  });

  it('I2V happy path: generate with first-frame image → operation name returned', async () => {
    const mock = createMockGenAI();
    mock.queueVideoOperation('op-i2v-test-1');
    // poll: done immediately
    mock.queueVideoComplete('op-i2v-test-1', 'https://video.test/i2v-result.mp4');

    // Write a fake first-frame PNG
    const firstFramePath = `${tmp.path}/first-frame.png`;
    fs.writeFileSync(firstFramePath, Buffer.from(TINY_PNG_BASE64, 'base64'));

    const client = buildMockedClient(mock);

    const input = GenerateVideoI2VInput.parse({
      op: 'i2v',
      prompt: 'Camera slowly zooms in on the product',
      firstFrameImage: firstFramePath,
      aspectRatio: '16:9',
      durationSeconds: 4,
      resolution: '720p',
      generateAudio: false,
      personGeneration: 'allow_adult',
    });

    const genResult = await generateVideoI2V(input, client);
    expect(genResult.operationName).toBe('op-i2v-test-1');

    const pollResult = await pollVideoOperation({
      client,
      operationName: genResult.operationName,
      intervalMs: 1,
      maxAttempts: 5,
    });

    const op = pollResult.operation as {
      done?: boolean;
      response?: { generatedVideos?: Array<{ video?: { uri?: string } }> };
    };
    const videoUri = op.response?.generatedVideos?.[0]?.video?.uri;
    expect(videoUri).toBe('https://video.test/i2v-result.mp4');

    const dlResult = await downloadVideo({
      client,
      videoUri: videoUri!,
      outputDir: tmp.path,
      filename: 'i2v-result.mp4',
      fetchImpl: buildMockFetch(MOCK_VIDEO_BYTES),
    });

    expect(dlResult.bytes).toBe(1024);
    expect(fs.existsSync(dlResult.outputPath)).toBe(true);
  });

  it('extension chain: T2V → poll done → download → extendVideo (dry-run hop)', async () => {
    const mock = createMockGenAI();
    mock.queueVideoOperation('op-extend-base-1');
    mock.queueVideoComplete('op-extend-base-1', 'https://video.test/base.mp4');

    const client = buildMockedClient(mock);

    // Base T2V
    const baseInput = GenerateVideoT2VInput.parse({
      op: 't2v',
      prompt: 'Character walks through forest, golden hour',
      aspectRatio: '16:9',
      durationSeconds: 4,
      resolution: '720p',
      generateAudio: false,
    });

    const genResult = await generateVideoT2V(baseInput, client);
    const pollResult = await pollVideoOperation({
      client,
      operationName: genResult.operationName,
      intervalMs: 1,
      maxAttempts: 5,
    });

    const op = pollResult.operation as {
      response?: { generatedVideos?: Array<{ video?: { uri?: string } }> };
    };
    const videoUri = op.response?.generatedVideos?.[0]?.video?.uri;
    expect(videoUri).toBeTruthy();

    // Download base
    const dlResult = await downloadVideo({
      client,
      videoUri: videoUri!,
      outputDir: tmp.path,
      filename: 'base.mp4',
      fetchImpl: buildMockFetch(MOCK_VIDEO_BYTES),
    });
    expect(fs.existsSync(dlResult.outputPath)).toBe(true);

    // Extension hop via extendVideo (dryRun client to avoid SDK call)
    const { extendVideo } = await import('../../src/video/video-service.js');
    const dryClient: MediaForgeClient = { ...client, dryRun: true };

    const extResult = await extendVideo({
      client: dryClient,
      sourceVideoUri: videoUri!,
      sourceMimeType: 'video/mp4',
      originalPrompt: 'Character walks through forest, golden hour',
      extensionDirective: 'Continue the walk, character reaches a clearing',
      hopIndex: 0,
    });

    expect(extResult.dryRun).toBe(true);
    expect(extResult.hopIndex).toBe(0);
    expect(extResult.forcedResolution).toBe('720p');
  });
});
