import type { Command } from 'commander';

export interface CommonFlags {
  dryRun: boolean;
  json: boolean;
  estimateCost: boolean;
  strict: boolean;
  outputDir?: string;
}

/**
 * Sentinel error thrown by exitOk/exitErr instead of calling process.exit
 * directly. runCli catches this and calls process.exit(code).
 * Tests catch this to assert exit code and payload without triggering
 * vitest's process.exit guard.
 */
export class CliExit extends Error {
  constructor(
    public readonly code: number,
    public readonly payload?: unknown,
  ) {
    super(`cli exit ${code}`);
    this.name = 'CliExit';
  }
}

export function addCommonFlags(cmd: Command): Command {
  return cmd
    .option('-d, --dry-run', 'Assemble and print payload without API call', false)
    .option('-j, --json', 'Emit JSON only (machine-readable)', false)
    .option('--estimate-cost', 'Print cost estimate and exit', false)
    .option('--strict', 'Reject any non-default value (zero ambiguity)', false)
    .option('--output-dir <path>', 'Override default outputs directory');
}

function humanFormat(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

export function exitOk(payload: unknown, opts: { json?: boolean } = {}): never {
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`${humanFormat(payload)}\n`);
  }
  throw new CliExit(0, payload);
}

export function exitErr(err: unknown, opts: { json?: boolean } = {}): never {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ error: msg }, null, 2)}\n`);
  } else {
    process.stderr.write(`error: ${msg}\n`);
  }
  throw new CliExit(1, err);
}
