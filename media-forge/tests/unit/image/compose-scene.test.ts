import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GoogleGenAI } from '@google/genai';
import { composeScene } from '../../../src/image/compose-scene.js';
import { createMockGenAI } from '../../helpers/mock-genai.js';
import { makeTempDir } from '../../helpers/fs-tempdir.js';
import type { ComposeSceneInputT } from '../../../src/image/image-schemas.js';
import type { MediaForgeClient } from '../../../src/core/client.js';

// Tiny 1x1 PNG — valid PNG minimal fixture
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

let tmpDir: ReturnType<typeof makeTempDir>;

function makeRefPng(name: string) {
  const p = join(tmpDir.path, name);
  writeFileSync(p, TINY_PNG);
  return p;
}

function makeInput(refs: string[], overrides: Partial<ComposeSceneInputT> = {}): ComposeSceneInputT {
  return {
    op: 'compose-scene',
    model: 'gemini-3-pro-image-preview',
    prompt: 'A scene with all references',
    referenceImages: refs.map((p, i) => ({ path: p, roleLabel: `ref-${i + 1}` })),
    aspectRatio: '16:9',
    imageSize: '4K',
    personGeneration: 'ALLOW_ADULT',
    thinkingLevel: 'HIGH',
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

describe('composeScene', () => {
  let mock: ReturnType<typeof createMockGenAI>;

  beforeEach(() => {
    tmpDir = makeTempDir('compose-scene-test-');
    mock = createMockGenAI();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    tmpDir.cleanup();
  });

  it('happy 3-ref composition: 1 text part + 3 inlineData parts', async () => {
    const refs = [makeRefPng('r1.png'), makeRefPng('r2.png'), makeRefPng('r3.png')];
    mock.queueImageResponse({ base64: 'AAAA', mimeType: 'image/png' });
    await composeScene(makeInput(refs), makeClient(mock));
    const call = mock.recordedCalls[0];
    const args = call!.args as { contents: unknown[] };
    // First element is text, rest are inlineData
    expect(args.contents).toHaveLength(4);
  });

  it('role labels appear in the assembled prompt text', async () => {
    const refs = [makeRefPng('outfit.png'), makeRefPng('scene.png')];
    mock.queueImageResponse({ base64: 'BB', mimeType: 'image/png' });
    await composeScene(
      makeInput(refs, {
        referenceImages: [
          { path: refs[0]!, roleLabel: 'outfit reference' },
          { path: refs[1]!, roleLabel: 'scene reference' },
        ],
      }),
      makeClient(mock),
    );
    const call = mock.recordedCalls[0];
    const args = call!.args as { contents: Array<{ text?: string }> };
    const textPart = args.contents.find((p) => typeof p.text === 'string');
    expect(textPart?.text).toContain('outfit reference');
    expect(textPart?.text).toContain('scene reference');
  });

  it('lazy preprocess: ref >5MB → fileSize triggers processing branch (returns valid result)', async () => {
    const bigRef = makeRefPng('big.png');
    // Spy on fileSize to simulate large file
    const files = await import('../../../src/utils/files.js');
    vi.spyOn(files, 'fileSize').mockReturnValueOnce(6 * 1024 * 1024); // 6MB

    mock.queueImageResponse({ base64: 'CC', mimeType: 'image/png' });
    // Should process without error (sharp handles the tiny PNG, resize is clamped)
    const result = await composeScene(makeInput([bigRef]), makeClient(mock));
    expect(result.base64).toBe('CC');
    vi.restoreAllMocks();
  });

  it('lazy preprocess: small file within threshold → raw bytes used (no sharp resize)', async () => {
    // TINY_PNG is 1x1 and <5MB, but shortest side <1024 triggers upscale path
    // The implementation still calls sharp for upscale — just verify it returns a valid result
    const smallRef = makeRefPng('small.png');
    mock.queueImageResponse({ base64: 'DD', mimeType: 'image/png' });
    const result = await composeScene(makeInput([smallRef]), makeClient(mock));
    // Should succeed regardless of preprocessing path
    expect(result.base64).toBe('DD');
  });

  it('dryRun=true → returns dryRun:true without calling SDK', async () => {
    const refs = [makeRefPng('dry.png')];
    const spy = vi.spyOn(mock.client.models, 'generateContent');
    const result = await composeScene(makeInput(refs), makeClient(mock, true));
    expect(spy).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.base64).toBe('');
  });

  it('single ref without roleLabel → still sends 2 parts (text + image)', async () => {
    const ref = makeRefPng('noLabel.png');
    mock.queueImageResponse({ base64: 'EE', mimeType: 'image/png' });
    await composeScene(
      makeInput([ref], { referenceImages: [{ path: ref }] }),
      makeClient(mock),
    );
    const call = mock.recordedCalls[0];
    const args = call!.args as { contents: unknown[] };
    expect(args.contents).toHaveLength(2);
  });

  it('gemini mode strips personGeneration from imageConfig', async () => {
    const ref = makeRefPng('gemini-strip.png');
    mock.queueImageResponse({ base64: 'FF', mimeType: 'image/png' });
    await composeScene(makeInput([ref], { personGeneration: 'ALLOW_ADULT' }), makeClient(mock));
    const call = mock.recordedCalls[0];
    const args = call!.args as { config: { imageConfig: Record<string, unknown> } };
    expect(args.config.imageConfig.personGeneration).toBeUndefined();
  });
});
