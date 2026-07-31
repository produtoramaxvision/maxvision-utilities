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

    // T11. Optional so entries written before the retake protocol still parse —
    // lineage.jsonl is append-only and historical files must stay readable.
    /** Router triage for this attempt. See src/review/router.ts. */
    triage: z.enum(['keep', 'fix-in-post', 'edit', 're-roll', 'rewrite']).optional(),
    /**
     * The single variable this attempt changed. Reading the column down a job's
     * lineage shows whether the retries were actually exploring different
     * hypotheses or repeating one that had already failed.
     */
    changedVariable: z
      .enum(['prompt', 'negative-prompt', 'seed', 'reference-set', 'model', 'duration', 'post-processing'])
      .nullable()
      .optional(),
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
  /** T11: router triage for this attempt. Omitted by pre-T11 callers. */
  triage?: LineageEntryT['triage'];
  /** T11: the single variable this attempt changed. */
  changedVariable?: LineageEntryT['changedVariable'];
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
    // Spread conditionally: LineageEntry is .strict(), and writing an explicit
    // `undefined` for a caller that never had these fields would be a different
    // record shape than the one those callers produced before T11.
    ...(opts.triage !== undefined ? { triage: opts.triage } : {}),
    ...(opts.changedVariable !== undefined ? { changedVariable: opts.changedVariable } : {}),
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
