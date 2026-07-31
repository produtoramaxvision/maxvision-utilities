// tests/unit/version-consistency.test.ts
//
// The version this plugin reports has to be ONE number in every place that
// reports it. It was not, and the consequence was not cosmetic.
//
// `.claude-plugin/plugin.json` is what the Claude Code plugin installer keys on
// when resolving a version directory. It sat at 0.1.1 while package.json moved
// through 0.2.5, 0.2.6, 0.2.7 and 0.2.8 — so four releases were published, the
// marketplace clone dutifully fetched each one, and no installed plugin ever
// moved off `media-forge/0.1.1`. From the installer's point of view nothing had
// changed. Nobody would connect "I released it" to "it never installed",
// because every other signal (git log, CHANGELOG, package.json) said 0.2.8.
//
// Two other literals had drifted their own way: the CLI's `.version()` at 0.1.1
// and the McpServer's serverInfo at 0.2.0, which matched nothing at all.
//
// This test is the guard. It reads the files rather than trusting a convention,
// so the next bump fails loudly here instead of silently shipping nothing.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MEDIA_FORGE_VERSION } from '../../src/index.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

function readVersion(relPath: string): unknown {
  const raw = readFileSync(join(repoRoot, relPath), 'utf-8');
  return (JSON.parse(raw) as Record<string, unknown>)['version'];
}

describe('version consistency', () => {
  it('package.json matches MEDIA_FORGE_VERSION', () => {
    expect(readVersion('package.json')).toBe(MEDIA_FORGE_VERSION);
  });

  // The one that actually broke. An installer that reads a stale version here
  // resolves the old directory and reports success having installed nothing new.
  it('.claude-plugin/plugin.json matches — this is the file the installer reads', () => {
    expect(readVersion('.claude-plugin/plugin.json')).toBe(MEDIA_FORGE_VERSION);
  });

  it('the hosted plugin manifest matches too', () => {
    expect(readVersion('plugins/media-forge-hosted/.claude-plugin/plugin.json')).toBe(
      MEDIA_FORGE_VERSION,
    );
  });

  it('is a plain semver triple — an installer resolves a directory by this string', () => {
    expect(MEDIA_FORGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
