// T7 — the shipped .mcp.json must forward every credential the code actually reads.
//
// This exists because of a real defect, not as a formality. `.mcp.json` carried
// KLING_ACCESS_KEY and KLING_SECRET_KEY but not KLING_API_KEY, while
// src/video/providers/auth/kling-jwt.ts:93 reads KLING_API_KEY *first* and treats
// it as the preferred API 2.0 scheme. A user who configured the new-style key had
// it silently dropped at the MCP boundary and fell back to legacy JWT signing —
// or failed outright with "Kling auth not configured" while staring at a key they
// had set correctly.
//
// The env block is a whitelist: anything not listed does not reach the server
// process. So every credential name the source reads has to be echoed here, and
// nothing enforces that except this test.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../..');

interface McpConfig {
  readonly mcpServers: Record<string, { readonly env?: Record<string, string> }>;
}

function readMcpConfig(): McpConfig {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, '.mcp.json'), 'utf8')) as McpConfig;
}

describe('.mcp.json env contract', () => {
  const config = readMcpConfig();
  const mediaForgeEnv = config.mcpServers['media-forge']?.env ?? {};

  // Every provider credential the runtime reads. Adding a provider means adding
  // its variable here and to .mcp.json in the same change.
  const REQUIRED_CREDENTIALS = [
    'GOOGLE_API_KEY',
    'ANTHROPIC_API_KEY',
    'KLING_API_KEY',
    'KLING_ACCESS_KEY',
    'KLING_SECRET_KEY',
    'HF_API_KEY',
    'HF_API_SECRET',
    'FAL_KEY',
    'BYTEPLUS_ARK_API_KEY',
  ] as const;

  for (const name of REQUIRED_CREDENTIALS) {
    it(`forwards ${name} to the media-forge server`, () => {
      expect(
        mediaForgeEnv[name],
        `${name} is read by the runtime but absent from the .mcp.json env block, ` +
          `so it never reaches the server process`,
      ).toBeDefined();
    });
  }

  it('interpolates credentials from the host environment rather than hardcoding them', () => {
    for (const name of REQUIRED_CREDENTIALS) {
      const value = mediaForgeEnv[name];
      expect(value, `${name} must be an \${ENV} interpolation, never a literal secret`).toMatch(
        /^\$\{[A-Z_]+(:-[^}]*)?\}$/,
      );
    }
  });

  it('KLING_API_KEY is forwarded because kling-jwt.ts prefers it over the legacy pair', () => {
    // Pins the reason, not just the fact. If the auth module ever stops reading
    // KLING_API_KEY this assertion is the breadcrumb explaining why it was added.
    const authSource = readFileSync(
      resolve(REPO_ROOT, 'src/video/providers/auth/kling-jwt.ts'),
      'utf8',
    );
    expect(authSource).toContain('KLING_API_KEY');
    expect(mediaForgeEnv['KLING_API_KEY']).toBe('${KLING_API_KEY}');
  });

  it('does not ship the Higgsfield remote MCP server (C10: probe only, never a default path)', () => {
    // A second surface to the same Higgsfield account would bypass the credit
    // ledger entirely: no reserve, no capture, no sweep. The daily cap would then
    // be enforced against an incomplete record of spend. README documents it as a
    // manual, temporary opt-in; it must not be active in the shipped config.
    expect(Object.keys(config.mcpServers)).not.toContain('higgsfield');
  });
});
