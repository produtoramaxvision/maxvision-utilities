import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GoogleGenAI } from '@google/genai';
import { describeImage } from '../../../src/image/describe-image.js';
import { ValidationError } from '../../../src/core/errors.js';
import { createMockGenAI } from '../../helpers/mock-genai.js';
import { makeTempDir } from '../../helpers/fs-tempdir.js';
import type { DescribeImageInputT } from '../../../src/image/image-schemas.js';
import type { MediaForgeClient } from '../../../src/core/client.js';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

let tmpDir: ReturnType<typeof makeTempDir>;
let imagePath: string;

function makeInput(overrides: Partial<DescribeImageInputT> = {}): DescribeImageInputT {
  return {
    op: 'describe-image',
    imagePath,
    model: 'gemini-3-pro-image-preview',
    detailLevel: 'detailed',
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

const VALID_DESCRIPTION = JSON.stringify({
  subject: 'A handbag',
  style: 'modern',
  lighting: 'soft',
  composition: 'centered',
  palette_hint: '#FFFFFF',
});

describe('describeImage', () => {
  let mock: ReturnType<typeof createMockGenAI>;

  beforeEach(() => {
    tmpDir = makeTempDir('describe-image-test-');
    imagePath = join(tmpDir.path, 'test.png');
    writeFileSync(imagePath, TINY_PNG);
    mock = createMockGenAI();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    tmpDir.cleanup();
  });

  it('happy path: returns structured object with all fields', async () => {
    vi.spyOn(mock.client.models, 'generateContent').mockResolvedValueOnce({
      candidates: [
        {
          finishReason: 'STOP',
          content: { parts: [{ text: VALID_DESCRIPTION }] },
        },
      ],
      text: VALID_DESCRIPTION,
    });
    const result = await describeImage(makeInput(), makeClient(mock));
    expect(result.subject).toBe('A handbag');
    expect(result.style).toBe('modern');
    expect(result.lighting).toBe('soft');
    expect(result.composition).toBe('centered');
    expect(result.palette_hint).toBe('#FFFFFF');
  });

  it('malformed JSON in response → throws ValidationError', async () => {
    vi.spyOn(mock.client.models, 'generateContent').mockResolvedValueOnce({
      candidates: [
        {
          finishReason: 'STOP',
          content: { parts: [{ text: 'not valid json' }] },
        },
      ],
      text: 'not valid json',
    });
    await expect(describeImage(makeInput(), makeClient(mock))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('dryRun=true → returns placeholder without calling SDK', async () => {
    const spy = vi.spyOn(mock.client.models, 'generateContent');
    const result = await describeImage(makeInput(), makeClient(mock, true));
    expect(spy).not.toHaveBeenCalled();
    expect(result.subject).toBe('dry-run');
  });
});
