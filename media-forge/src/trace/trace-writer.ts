import * as fs from 'node:fs';
import { z } from 'zod';
import { safeJoin } from '../utils/paths.js';
import { ValidationError } from '../core/errors.js';
import { prettyZodError } from '../core/zod-formatter.js';
import { logger } from '../core/logger.js';

export const TraceEntry = z
  .object({
    ts: z.string().datetime(),
    stage: z.enum([
      'intent-routing',
      'prompt-refinement',
      'image-generate',
      'image-edit',
      'image-compose',
      'video-generate',
      'video-extend',
      'video-poll',
      'video-download',
      'review-ocr',
      'review-brand',
      'review-judge',
      'fix-dispatch',
    ]),
    inputHash: z.string().min(16),
    outputPath: z.string().optional(),
    model: z.string().optional(),
    params: z.record(z.unknown()).optional(),
    durationMs: z.number().nonnegative(),
    costUsd: z.number().nonnegative().optional(),
    verdict: z.enum(['pass', 'fail', 'partial']).optional(),
    rootCause: z.string().optional(),
  })
  .strict();

export type TraceEntryT = z.infer<typeof TraceEntry>;

export interface TraceAppendOpts {
  jobId: string;
  jobDir: string;
  entry: Omit<TraceEntryT, 'ts'> & { ts?: string };
}

export async function appendTrace(opts: TraceAppendOpts): Promise<void> {
  const tracePath = safeJoin(opts.jobDir, 'trace.jsonl');

  // Build input for Zod, filling ts if absent
  const ts = opts.entry.ts ?? new Date().toISOString();
  const raw: Record<string, unknown> = { ts };

  // Copy only defined properties to avoid strict() failing on explicit undefined keys
  const entry = opts.entry as Record<string, unknown>;
  for (const [k, v] of Object.entries(entry)) {
    if (k !== 'ts' && v !== undefined) {
      raw[k] = v;
    }
  }

  let validated: TraceEntryT;
  try {
    validated = TraceEntry.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new ValidationError(
        `TraceEntry validation failed:\n${prettyZodError(err)}`,
        { issues: err.issues },
      );
    }
    throw err;
  }

  await fs.promises.appendFile(tracePath, JSON.stringify(validated) + '\n', 'utf8');
  logger.debug('appendTrace: entry written', { jobId: opts.jobId, stage: validated.stage });
}

// ---------------------------------------------------------------------------
// Refs selection trace — separate schema so it doesn't pollute the main
// TraceEntry strict enum. Lines with `type: 'refs_selection'` live in the
// same trace.jsonl file but are skip-warned by readTrace (tolerable for now).
// ---------------------------------------------------------------------------

export const RefsChosenItem = z
  .object({
    category: z.string(),
    objectKey: z.string(),
    rank: z.number().int().nonnegative().optional(),
    cosineDistance: z.number().optional(),
  })
  .strict();

export type RefsChosenItemT = z.infer<typeof RefsChosenItem>;

export const RefsSelectionTraceEntry = z
  .object({
    type: z.literal('refs_selection'),
    ts: z.string().datetime(),
    jobId: z.string(),
    refMode: z.enum(['tag', 'semantic']),
    seedUsed: z.number().int(),
    refsChosen: z.array(RefsChosenItem),
    refsSkipped: z.number().int().nonnegative(),
    searchLatencyMs: z.number().nonnegative(),
  })
  .strict();

export type RefsSelectionTraceEntryT = z.infer<typeof RefsSelectionTraceEntry>;

export interface RefsSelectionTraceAppendOpts {
  jobId: string;
  jobDir: string;
  entry: Omit<RefsSelectionTraceEntryT, 'ts'> & { ts?: string };
}

export async function appendRefsSelectionTrace(opts: RefsSelectionTraceAppendOpts): Promise<void> {
  const tracePath = safeJoin(opts.jobDir, 'trace.jsonl');

  const ts = opts.entry.ts ?? new Date().toISOString();
  const raw: Record<string, unknown> = { ts };
  const entry = opts.entry as Record<string, unknown>;
  for (const [k, v] of Object.entries(entry)) {
    if (k !== 'ts' && v !== undefined) {
      raw[k] = v;
    }
  }

  let validated: RefsSelectionTraceEntryT;
  try {
    validated = RefsSelectionTraceEntry.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new ValidationError(
        `RefsSelectionTraceEntry validation failed:\n${prettyZodError(err)}`,
        { issues: err.issues },
      );
    }
    throw err;
  }

  await fs.promises.appendFile(tracePath, JSON.stringify(validated) + '\n', 'utf8');
  logger.debug('appendRefsSelectionTrace: entry written', { jobId: opts.jobId });
}

export async function readTrace(opts: { jobDir: string }): Promise<TraceEntryT[]> {
  const tracePath = safeJoin(opts.jobDir, 'trace.jsonl');

  let raw: string;
  try {
    raw = await fs.promises.readFile(tracePath, 'utf8');
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const lines = raw.split('\n').filter((l) => l.trim() !== '');
  const entries: TraceEntryT[] = [];

  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line);
      const validated = TraceEntry.parse(parsed);
      entries.push(validated);
    } catch {
      logger.warn('readTrace: skipping malformed line', { preview: line.slice(0, 80) });
    }
  }

  return entries;
}
