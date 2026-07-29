// T9-d: ffmpeg-missing behavior, isolated in its own file so mocking
// core/ffmpeg.ts here cannot bleed into tests/unit/video/last-frame.test.ts,
// which needs the real resolver.
import { describe, it, expect, vi } from 'vitest';
import type * as FfmpegModule from '../../../src/core/ffmpeg.js';

vi.mock('../../../src/core/ffmpeg.js', async (importOriginal) => {
  const actual = await importOriginal<typeof FfmpegModule>();
  return {
    ...actual,
    resolveFfmpegPath: () => {
      throw new actual.FfmpegNotFoundError();
    },
  };
});

import { extractLastFrame } from '../../../src/video/last-frame.js';
import { FfmpegNotFoundError } from '../../../src/core/ffmpeg.js';

describe('extractLastFrame -- ffmpeg unavailable', () => {
  it('propagates the existing FfmpegNotFoundError (no bespoke second error type)', async () => {
    // Path need not even exist: ffmpeg resolution happens before any filesystem
    // check, mirroring src/refs/keyframe-extractor.ts's own ordering.
    await expect(
      extractLastFrame({ videoPath: 'Z:/does/not/matter.mp4' }),
    ).rejects.toThrow(FfmpegNotFoundError);
  });
});
