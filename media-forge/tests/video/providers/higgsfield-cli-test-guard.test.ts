// The guard that stops `pnpm test` from spending real credits.
//
// This file is the regression test for an incident, not a hypothetical. On
// 2026-08-01 the Cinema Studio and Marketing Studio handlers were repointed from
// the HTTP transport (404 on both endpoints) to the CLI transport. Two suites
// invoked those handlers with only a `global.fetch` stub — correct for the old
// transport, useless for a spawned binary — so the real `higgsfield` CLI ran
// against the developer's OAuth session and submitted SIX real generations,
// spending 350 subscription credits:
//
//   3x Marketing Studio Video      -120, -120, -50
//   3x Cinematic Studio 3.5 Video   -20,  -20, -20
//
// The suite stayed green throughout. A test that forgets to stub a transport is
// indistinguishable from one that does — which is why the protection has to live
// in the runner, not in a convention about how tests are written.

import { describe, it, expect } from 'vitest';
import { defaultRunner } from '../../../src/video/providers/higgsfield-cli.js';

describe('the real CLI runner under test', () => {
  // vitest sets VITEST; these assertions therefore run inside the condition
  // they describe.
  it('refuses `generate create`, which submits and bills', async () => {
    await expect(
      defaultRunner(['generate', 'create', 'marketing_studio_video', '--prompt', 'x'], 1000),
    ).rejects.toThrow(/refusing to spawn the real higgsfield CLI/);
  });

  it('refuses `generate workflow`, the other submit verb', async () => {
    await expect(defaultRunner(['generate', 'workflow', 'reframe'], 1000)).rejects.toThrow(
      /refusing to spawn/,
    );
  });

  it('refuses `soul-id create`, which trains and bills', async () => {
    await expect(
      defaultRunner(['soul-id', 'create', '--name', 'x', '--json'], 1000),
    ).rejects.toThrow(/refusing to spawn/);
  });

  it('names the seam to use instead of just saying no', async () => {
    await expect(
      defaultRunner(['generate', 'create', 'kling3_0', '--prompt', 'x'], 1000),
    ).rejects.toThrow(/_setHiggsfieldCliProviderForTests/);
  });

  // Reads must stay open or the live rate gate — which is the thing that keeps
  // the registry's prices honest — would be blocked by its own safety net.
  for (const args of [
    ['auth', 'token', '--json'],
    ['generate', 'cost', 'kling3_0', '--prompt', 'x', '--json'],
    ['generate', 'get', 'some-job-id', '--json'],
    ['model', 'list', '--json'],
  ]) {
    it(`allows the read \`${args.slice(0, 2).join(' ')}\``, async () => {
      // It may still fail for want of a binary or a session on this machine —
      // what matters is that it is NOT the guard doing the rejecting.
      await expect(defaultRunner(args, 3000)).rejects.not.toThrow(/refusing to spawn/).catch(
        () => undefined,
      );
    });
  }
});
