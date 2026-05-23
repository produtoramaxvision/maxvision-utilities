import * as fs from 'node:fs';
import { z } from 'zod';
import { safeJoin } from '../utils/paths.js';
import { ValidationError } from '../core/errors.js';
import { prettyZodError } from '../core/zod-formatter.js';
import { logger } from '../core/logger.js';

export const LineageEntry = z
  .object({
    attempt: z.number().int().min(1),
    ts: z.string().datetime(),
    rootCause: z.string().min(1),
    fixTargetAgent: z.string().min(1),
    fixDirective: z.string().min(1),
    verdict: z.enum(['pass', 'fail', 'partial']),
  })
  .strict();

export type LineageEntryT = z.infer<typeof LineageEntry>;

export interface RecordLineageOpts {
  jobDir: string;
  attempt: number;
  rootCause: string;
  fixTargetAgent: string;
  fixDirective: string;
  verdict: 'pass' | 'fail' | 'partial';
  ts?: string;
}

export async function recordLineage(opts: RecordLineageOpts): Promise<void> {
  const lineagePath = safeJoin(opts.jobDir, 'lineage.jsonl');

  const raw = {
    attempt: opts.attempt,
    ts: opts.ts ?? new Date().toISOString(),
    rootCause: opts.rootCause,
    fixTargetAgent: opts.fixTargetAgent,
    fixDirective: opts.fixDirective,
    verdict: opts.verdict,
  };

  let validated: LineageEntryT;
  try {
    validated = LineageEntry.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new ValidationError(
        `LineageEntry validation failed:\n${prettyZodError(err)}`,
        { issues: err.issues },
      );
    }
    throw err;
  }

  await fs.promises.appendFile(lineagePath, JSON.stringify(validated) + '\n', 'utf8');
  logger.debug('recordLineage: entry written', { jobDir: opts.jobDir, attempt: opts.attempt });
}

export async function readLineage(opts: { jobDir: string }): Promise<LineageEntryT[]> {
  const lineagePath = safeJoin(opts.jobDir, 'lineage.jsonl');

  let raw: string;
  try {
    raw = await fs.promises.readFile(lineagePath, 'utf8');
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const lines = raw.split('\n').filter((l) => l.trim() !== '');
  const entries: LineageEntryT[] = [];

  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line);
      const validated = LineageEntry.parse(parsed);
      entries.push(validated);
    } catch {
      logger.warn('readLineage: skipping malformed line', { preview: line.slice(0, 80) });
    }
  }

  // Sort by attempt number ascending
  entries.sort((a, b) => a.attempt - b.attempt);
  return entries;
}
