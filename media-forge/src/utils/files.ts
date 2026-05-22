import * as fs from 'node:fs';
import * as path from 'node:path';
import { FileSystemError } from '../core/errors.js';

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function readBase64(filePath: string): string {
  try {
    return fs.readFileSync(filePath).toString('base64');
  } catch (err) {
    throw new FileSystemError(`Failed to read file: ${filePath}`, {
      cause: err instanceof Error ? err.message : String(err),
    });
  }
}

export function writeFromBase64(filePath: string, base64: string): void {
  ensureDir(path.dirname(filePath));
  try {
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
  } catch (err) {
    throw new FileSystemError(`Failed to write file: ${filePath}`, {
      cause: err instanceof Error ? err.message : String(err),
    });
  }
}

export function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch (err) {
    throw new FileSystemError(`Failed to stat file: ${filePath}`, {
      cause: err instanceof Error ? err.message : String(err),
    });
  }
}
