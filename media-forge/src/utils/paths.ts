import * as path from 'node:path';
import { FileSystemError } from '../core/errors.js';

export function safeJoin(base: string, ...parts: string[]): string {
  const absBase = path.resolve(base);
  const joined = path.resolve(absBase, ...parts);
  // Normalize for cross-platform safety
  const relative = path.relative(absBase, joined);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new FileSystemError(
      `Path traversal rejected: ${joined} is outside ${absBase}`,
      { base: absBase, joined, relative },
    );
  }
  return joined;
}

export function slug(text: string, maxLen = 40): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      // Strip combining diacritical marks (U+0300..U+036F)
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, maxLen) || 'untitled'
  );
}

let jobIdCounter = 0;

export function jobId(prefix?: string): string {
  const ts =
    new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
  // Combine random + monotonic counter to guarantee no collision under tight loops
  const rand = Math.random().toString(36).slice(2, 6);
  const counter = (jobIdCounter++).toString(36).padStart(2, '0').slice(-2);
  const suffix = prefix ? `-${slug(prefix, 30)}` : '';
  return `${ts}-${rand}${counter}${suffix}`;
}
