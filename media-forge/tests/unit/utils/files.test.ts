import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ensureDir, readBase64, writeFromBase64, fileSize } from '../../../src/utils/files.js';
import { FileSystemError } from '../../../src/core/errors.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-forge-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ensureDir', () => {
  it('creates nested dirs', () => {
    const nested = path.join(tmpDir, 'a', 'b', 'c');
    ensureDir(nested);
    expect(fs.existsSync(nested)).toBe(true);
  });

  it('is idempotent', () => {
    const dir = path.join(tmpDir, 'x');
    ensureDir(dir);
    ensureDir(dir);
    expect(fs.existsSync(dir)).toBe(true);
  });
});

describe('writeFromBase64 + readBase64 roundtrip', () => {
  it('writes and reads bytes', () => {
    const data = Buffer.from('hello world').toString('base64');
    const filePath = path.join(tmpDir, 'sub', 'out.bin');
    writeFromBase64(filePath, data);
    expect(fs.existsSync(filePath)).toBe(true);
    const readBack = readBase64(filePath);
    expect(readBack).toBe(data);
  });
});

describe('fileSize', () => {
  it('returns size in bytes', () => {
    const filePath = path.join(tmpDir, 'sized.txt');
    fs.writeFileSync(filePath, 'abcdefghij');
    expect(fileSize(filePath)).toBe(10);
  });

  it('throws FileSystemError on missing file', () => {
    expect(() => fileSize(path.join(tmpDir, 'nope.txt'))).toThrow(FileSystemError);
  });
});

describe('readBase64 errors', () => {
  it('throws FileSystemError on missing file', () => {
    expect(() => readBase64(path.join(tmpDir, 'missing.txt'))).toThrow(FileSystemError);
  });
});
