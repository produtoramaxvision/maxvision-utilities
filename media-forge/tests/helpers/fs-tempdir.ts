import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface TempDirHandle {
  path: string;
  cleanup: () => void;
}

export function makeTempDir(prefix = 'media-forge-test-'): TempDirHandle {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    path: p,
    cleanup: () => fs.rmSync(p, { recursive: true, force: true }),
  };
}

/**
 * Vitest-friendly tempdir factory.
 * Usage:
 *   let tmp: TempDirHandle;
 *   beforeEach(() => { tmp = makeTempDir(); });
 *   afterEach(() => { tmp.cleanup(); });
 */
