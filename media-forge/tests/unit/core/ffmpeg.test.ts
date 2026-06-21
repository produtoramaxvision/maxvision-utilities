import { describe, it, expect, vi, beforeEach } from 'vitest';

// child_process is mocked so tests never depend on a real ffmpeg install.
vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
import { spawnSync } from 'node:child_process';
import {
  resolveFfmpegPath,
  resolveFfmpegPathOrNull,
  FfmpegNotFoundError,
  __resetFfmpegCache,
} from '../../../src/core/ffmpeg.js';

beforeEach(() => {
  __resetFfmpegCache();
  vi.mocked(spawnSync).mockReset();
});

describe('resolveFfmpegPath', () => {
  it('returns MEDIA_FORGE_FFMPEG_PATH when it points to an existing file', () => {
    // process.execPath (the node binary) always exists — use it as a stand-in.
    const env = { MEDIA_FORGE_FFMPEG_PATH: process.execPath } as NodeJS.ProcessEnv;
    expect(resolveFfmpegPath(env)).toBe(process.execPath);
    expect(spawnSync).not.toHaveBeenCalled(); // override short-circuits PATH probe
  });

  it('falls back to system PATH via which/where', () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: `${process.execPath}\n`,
      stderr: '',
    } as never);
    const env = {} as NodeJS.ProcessEnv;
    expect(resolveFfmpegPath(env)).toBe(process.execPath);
  });

  it('throws FfmpegNotFoundError when no override and PATH probe fails', () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 1, stdout: '', stderr: '' } as never);
    expect(() => resolveFfmpegPath({} as NodeJS.ProcessEnv)).toThrow(FfmpegNotFoundError);
  });

  it('resolveFfmpegPathOrNull returns null instead of throwing', () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 1, stdout: '', stderr: '' } as never);
    expect(resolveFfmpegPathOrNull({} as NodeJS.ProcessEnv)).toBeNull();
  });
});
