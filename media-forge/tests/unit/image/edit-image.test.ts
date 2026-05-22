import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { GoogleGenAI } from '@google/genai';
import { editImage } from '../../../src/image/edit-image.js';
import { SafetyBlockError, ApiError } from '../../../src/core/errors.js';
import { createMockGenAI } from '../../helpers/mock-genai.js';
import type { EditImageInputT } from '../../../src/image/image-schemas.js';
import type { MediaForgeClient } from '../../../src/core/client.js';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

let testDir: string;
let sourcePath: string;
let maskPath: string;

function setupFiles() {
  testDir = join(tmpdir(), 'edit-image-test-' + Date.now());
  mkdirSync(testDir, { recursive: true });
  sourcePath = join(testDir, 'source.png');
  maskPath = join(testDir, 'mask.png');
  writeFileSync(sourcePath, TINY_PNG);
  writeFileSync(maskPath, TINY_PNG);
}

function makeInput(overrides: Partial<EditImageInputT> = {}): EditImageInputT {
  return {
    op: 'edit-image',
    model: 'gemini-3-pro-image-preview',
    prompt: 'Change the background to ocean',
    sourceImage: sourcePath,
    editMode: 'edit',
    personGeneration: 'ALLOW_ADULT',
    outputDir: './outputs',
    dryRun: false,
    ...overrides,
  };
}

function makeClient(mock: ReturnType<typeof createMockGenAI>, dryRun = false): MediaForgeClient {
  return {
    mode: 'gemini',
    dryRun,
    ai: mock.client as unknown as GoogleGenAI,
  };
}

describe('editImage', () => {
  let mock: ReturnType<typeof createMockGenAI>;

  beforeEach(() => {
    setupFiles();
    mock = createMockGenAI();
    vi.restoreAllMocks();
  });

  it('happy path edit: returns base64 from inlineData', async () => {
    mock.queueImageResponse({ base64: 'AAAA', mimeType: 'image/png' });
    const result = await editImage(makeInput(), makeClient(mock));
    expect(result.base64).toBe('AAAA');
    expect(result.mimeType).toBe('image/png');
  });

  it('inpaint with mask → call.contents has 3 parts (text + source + mask)', async () => {
    mock.queueImageResponse({ base64: 'BB', mimeType: 'image/png' });
    await editImage(
      makeInput({ editMode: 'inpaint', maskImage: maskPath }),
      makeClient(mock),
    );
    const call = mock.recordedCalls[0];
    const args = call!.args as { contents: unknown[] };
    expect(args.contents).toHaveLength(3);
  });

  it('outpaint mode → prompt prefix mentions outpainting', async () => {
    mock.queueImageResponse({ base64: 'CC', mimeType: 'image/png' });
    await editImage(makeInput({ editMode: 'outpaint' }), makeClient(mock));
    const call = mock.recordedCalls[0];
    const args = call!.args as { contents: Array<{ text?: string }> };
    const textPart = args.contents.find((p) => typeof p.text === 'string');
    expect(textPart?.text?.toLowerCase()).toContain('outpaint');
  });

  it('source image not found → wraps as FileSystemError or ApiError', async () => {
    const { FileSystemError } = await import('../../../src/core/errors.js');
    const input = makeInput({ sourceImage: '/nonexistent/image.png' });
    await expect(editImage(input, makeClient(mock))).rejects.toBeInstanceOf(FileSystemError);
  });

  it('safety block → throws SafetyBlockError', async () => {
    mock.queueSafetyBlock();
    await expect(editImage(makeInput(), makeClient(mock))).rejects.toBeInstanceOf(SafetyBlockError);
  });

  it('dryRun=true → returns dryRun:true without calling SDK', async () => {
    const spy = vi.spyOn(mock.client.models, 'generateContent');
    const result = await editImage(makeInput(), makeClient(mock, true));
    expect(spy).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.base64).toBe('');
    // rawPayload must mirror production generateContent shape: {model, contents, config}
    const payload = result.rawPayload as { model: string; contents: Array<{ text?: string; inlineData?: { data: string } }>; config: { imageConfig: object } };
    expect(payload.model).toBe('gemini-3-pro-image-preview');
    expect(payload.contents[0]).toHaveProperty('text');
    expect(payload.contents[1]?.inlineData?.data).toBe('<base64-elided-dryrun>');
    expect(payload.config).toHaveProperty('imageConfig');
  });

  it('no inlineData in response → throws ApiError', async () => {
    vi.spyOn(mock.client.models, 'generateContent').mockResolvedValueOnce({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'some text' }] } }],
    });
    await expect(editImage(makeInput(), makeClient(mock))).rejects.toBeInstanceOf(ApiError);
  });
});
