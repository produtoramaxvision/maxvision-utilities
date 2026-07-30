// tests/cli/setup-command.test.ts
// T16 — `media-forge setup wan2gp` (src/cli/commands/setup.ts).
//
// probeVramGb shells out to nvidia-smi; probeFreeDiskGb calls statfsSync. Both
// are machine-dependent, so these tests assert only the CONTRACT (number |
// null, never throws) rather than any specific hardware value — asserting a
// real VRAM/disk number would make the suite fail on every machine that
// differs from whichever box it was written on.
import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { probeVramGb, probeFreeDiskGb, registerSetupCommands } from '../../src/cli/commands/setup.js';

// ---------------------------------------------------------------------------
// 15. probeVramGb / probeFreeDiskGb — contract only, never hardware values.
// ---------------------------------------------------------------------------
describe('probeVramGb', () => {
  it('returns number | null and never throws', () => {
    let result: number | null = null;
    expect(() => {
      result = probeVramGb();
    }).not.toThrow();
    expect(result === null || typeof result === 'number').toBe(true);
  });
});

describe('probeFreeDiskGb', () => {
  it('returns number | null and never throws for a real, existing path', () => {
    let result: number | null = null;
    expect(() => {
      result = probeFreeDiskGb(process.cwd());
    }).not.toThrow();
    expect(result === null || typeof result === 'number').toBe(true);
  });

  it('returns null (not throw) for a nonexistent path — statfsSync would ENOENT', () => {
    const nonexistentPath = join(tmpdir(), `mf-wan2gp-does-not-exist-${Date.now()}`, 'nope');
    let result: number | null = 0; // sentinel distinct from both null and a real reading
    expect(() => {
      result = probeFreeDiskGb(nonexistentPath);
    }).not.toThrow();
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 16. registerSetupCommands — structural introspection only, action not run
// (running the action would invoke probeVramGb/probeFreeDiskGb + write to
// stdout, which is exactly the machine-dependent behavior tests 15 already
// isolate; here we only need to prove the command tree is wired correctly).
// ---------------------------------------------------------------------------
describe('registerSetupCommands', () => {
  it('adds a "setup" command with a "wan2gp" subcommand', () => {
    const program = new Command();
    registerSetupCommands(program);

    const setupCmd = program.commands.find((c) => c.name() === 'setup');
    expect(setupCmd).toBeDefined();

    const wan2gpCmd = setupCmd?.commands.find((c) => c.name() === 'wan2gp');
    expect(wan2gpCmd).toBeDefined();
  });
});
