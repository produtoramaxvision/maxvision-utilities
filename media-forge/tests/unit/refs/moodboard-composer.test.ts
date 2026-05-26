import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SafetyRejectedError } from '../../../src/refs/moodboard-composer.js';

// Single mock block covering both slot-logic and safety-path tests.
// ET1: spread actual so non-mocked exports remain intact.
const generateNbpMock = vi.fn();
vi.mock('../../../src/image/image-service.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../../src/image/image-service.js');
  return {
    ...actual,
    generateImageNanoBananaPro: (...args: unknown[]) => generateNbpMock(...args),
  };
});

import { composeMoodboard } from '../../../src/refs/moodboard-composer.js';

beforeEach(() => {
  generateNbpMock.mockReset();
});

// ---------------------------------------------------------------------------
// Slot logic tests (Task 1.5 Step 2)
// ---------------------------------------------------------------------------
describe('composeMoodboard', () => {
  it('passes up to 14 reference images to Nano Banana Pro', async () => {
    generateNbpMock.mockResolvedValueOnce({
      outputPath: '/tmp/moodboard.jpg',
      width: 2048,
      height: 2048,
      costUsd: 0.05,
    });
    const refs = Array.from({ length: 16 }, (_, i) => Buffer.from(`fake-jpeg-${i}`));
    const result = await composeMoodboard({
      refJpegs: refs,
      subjectJpegs: [],
      effectTags: ['dolly-zoom'],
      outputSize: '2048',
    });
    expect(result.outputPath).toBe('/tmp/moodboard.jpg');
    const callArg = generateNbpMock.mock.calls[0][0];
    // 14 cap (NBP max refs) — overflow silently truncated, subject preserved if any
    expect(callArg.referenceImages.length).toBeLessThanOrEqual(14);
  });

  it('reserves slots for subject images first', async () => {
    generateNbpMock.mockResolvedValueOnce({ outputPath: '/tmp/m.jpg', width: 1024, height: 1024, costUsd: 0.05 });
    const refs = Array.from({ length: 14 }, (_, i) => Buffer.from(`r-${i}`));
    const subjects = [Buffer.from('subject-1'), Buffer.from('subject-2')];
    await composeMoodboard({
      refJpegs: refs,
      subjectJpegs: subjects,
      effectTags: ['bullet-time'],
      outputSize: '1024',
    });
    const callArg = generateNbpMock.mock.calls[0][0];
    expect(callArg.referenceImages.length).toBe(14);
    // First two slots must be the subjects (preserved identity has priority)
    expect(callArg.referenceImages[0]).toEqual(subjects[0]);
    expect(callArg.referenceImages[1]).toEqual(subjects[1]);
  });
});

// ---------------------------------------------------------------------------
// Safety-path tests (ET1)
// ---------------------------------------------------------------------------
describe('composeMoodboard — safety path', () => {
  it('first call safety-rejected → retry with safe prefix succeeds', async () => {
    generateNbpMock
      .mockRejectedValueOnce(new Error('safety: prompt was blocked by safety filter'))
      .mockResolvedValueOnce({ outputPath: '/tmp/m.jpg', width: 2048, height: 2048, costUsd: 0.05 });
    const result = await composeMoodboard({
      refJpegs: [Buffer.from('r')], subjectJpegs: [], effectTags: ['datamosh'], outputSize: '1024',
    });
    expect(result.safetyRetryUsed).toBe(true);
    expect(generateNbpMock).toHaveBeenCalledTimes(2);
    const retryPrompt = (generateNbpMock.mock.calls[1][0] as { prompt: string }).prompt;
    expect(retryPrompt.toLowerCase()).toContain('abstract');
  });

  it('both attempts safety-rejected → throws SafetyRejectedError', async () => {
    generateNbpMock
      .mockRejectedValueOnce(new Error('safety: blocked'))
      .mockRejectedValueOnce(new Error('safety: blocked again'));
    await expect(
      composeMoodboard({
        refJpegs: [Buffer.from('r')], subjectJpegs: [], effectTags: ['datamosh'], outputSize: '1024',
      }),
    ).rejects.toThrow(SafetyRejectedError);
  });

  it('non-safety error propagates immediately without retry', async () => {
    generateNbpMock.mockRejectedValueOnce(new Error('network: ECONNRESET'));
    await expect(
      composeMoodboard({
        refJpegs: [Buffer.from('r')], subjectJpegs: [], effectTags: ['dolly-zoom'], outputSize: '1024',
      }),
    ).rejects.toThrow(/ECONNRESET/);
    expect(generateNbpMock).toHaveBeenCalledTimes(1);
  });
});
