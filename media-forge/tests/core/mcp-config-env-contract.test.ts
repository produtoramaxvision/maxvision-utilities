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
import { readFileSync, readdirSync } from 'node:fs';
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
    // Opt-in providers. These were absent, and the effect was the exact defect
    // this file was written for, one provider later: MuAPI's tools registered,
    // documented and gated on nothing but MUAPI_API_KEY — which could not reach
    // the server process, so every call refused with "MUAPI_API_KEY is not set"
    // for a user who had set it correctly.
    'MUAPI_API_KEY',
    'OPENAI_API_KEY',
    // Embedding + vector store for semantic search. Read by the runtime, absent
    // from the env block until 2026-07-31 — the same shape of defect as MuAPI's.
    'VOYAGE_API_KEY',
    'PGVECTOR_URL',
  ] as const;

  // Read by the runtime but NOT credentials. Kept out of REQUIRED_CREDENTIALS so
  // the "must be a ${ENV} interpolation, never a literal secret" assertion below
  // keeps meaning what it says.
  //
  // HIGGSFIELD_API_KEY is the pointed case: no auth code reads it.
  // `higgsfield-headers.ts` reads HF_API_KEY/HF_API_SECRET. This name appears
  // only in server.ts as the "is Higgsfield configured?" boot heuristic, so
  // someone who sets ONLY this name passes boot validation and then fails on the
  // first call with `Missing required environment variable(s): HF_API_KEY,
  // HF_API_SECRET`. Forwarded so the heuristic still works for an operator who
  // set it; named here so nobody reads it as a working credential.
  const REQUIRED_NON_CREDENTIALS = ['HIGGSFIELD_API_KEY'] as const;

  // Not credentials — switches and path overrides. Same whitelist, same
  // consequence when omitted: `MEDIA_FORGE_WAN2GP_ENABLED=true` set by the user
  // never arrives, and the provider reports itself disabled. Kept separate
  // because the "must be an ${ENV} interpolation, never a literal" rule below is
  // about secrets.
  const REQUIRED_SETTINGS = [
    'MEDIA_FORGE_WAN2GP_ENABLED',
    'MEDIA_FORGE_WAN2GP_URL',
    'MEDIA_FORGE_HF_CLI_ENABLED',
    'MEDIA_FORGE_CODEX_IMAGE_ENABLED',
    'MEDIA_FORGE_CODEX_IMAGE_MODE',
    'MEDIA_FORGE_CODEX_IMAGE_USD_PER_IMAGE',
    // Windows: npm/pnpm install CLIs as shims Node cannot spawn without a
    // shell. These point the resolver at a real executable, and are useless if
    // they cannot be set from outside.
    'MEDIA_FORGE_CODEX_BIN',
    'MEDIA_FORGE_HF_BIN',
    // Required AT BOOT whenever Higgsfield auth is present:
    // validateHiggsfieldPricingAtBoot() throws and server.ts calls process.exit(2)
    // when it is unset. It was absent from the env block while HF_API_KEY was
    // forwarded, so — if the block is a whitelist, which is this file's premise —
    // no Higgsfield operator could start the server at all.
    'MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT',
    // The CLI transport's rate. Optional, but forwarded for the same reason as
    // every other setting here: an operator who sets it and sees no effect has
    // no way to tell that from the rate simply not mattering. Unforwarded, every
    // `higgsfield-cli` spec prices as unpriced no matter what the host env says.
    'MEDIA_FORGE_HIGGSFIELD_CLI_USD_PER_CREDIT',
    'MEDIA_FORGE_HF_SPEAK_AUDIO_MODE',
    'MEDIA_FORGE_HF_WEBHOOK_ENABLE',
    'MEDIA_FORGE_LOG_LEVEL',
    'MEDIA_FORGE_LOG_FORMAT',
    'MEDIA_FORGE_OUTPUTS_DIR',
    'MEDIA_FORGE_CONFIG_HOME',
    'MEDIA_FORGE_ARTIFACT_TTL_SECONDS',
    'MEDIA_FORGE_SKIP_OCR_WHEN_NO_TEXT_INTENT',
    'MEDIA_FORGE_MAX_OBJECTS_PER_CATEGORY',
    // Codex CLI keeps its OAuth credentials under CODEX_HOME. Without it the
    // spawned CLI looks in the default location, which is not necessarily the
    // one the operator authenticated.
    'CODEX_HOME',
  ] as const;

  for (const name of REQUIRED_NON_CREDENTIALS) {
    it(`forwards ${name} to the media-forge server`, () => {
      expect(mediaForgeEnv[name]).toBeDefined();
    });
  }

  for (const name of REQUIRED_SETTINGS) {
    it(`forwards ${name} to the media-forge server`, () => {
      expect(
        mediaForgeEnv[name],
        `${name} is read by the runtime but absent from the .mcp.json env block, ` +
          `so a user who sets it gets no effect and no error`,
      ).toBeDefined();
    });
  }

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

  // The lists above are hand-maintained, so they only catch what someone
  // remembered to add. This sweeps src/ instead and fails on anything new.
  //
  // It was written after a sweep found 18 variables read by the runtime and
  // absent from the env block, including MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT —
  // which server.ts requires at boot and exits(2) without.
  it('every env var read under src/ is forwarded or explicitly excluded', () => {
    // Deliberately not forwarded. Each entry needs a reason, not just a name.
    const EXCLUDED: Record<string, string> = {
      // Provided by the OS. `"HOME": "${HOME}"` would set it to the empty string
      // on a Windows host, where HOME is frequently unset.
      HOME: 'set by the operating system',
      CLAUDE_CODE_SESSION_ID: 'set by Claude Code in the spawned server environment',
      // The standalone HTTP service (src/http), not this stdio MCP server.
      MEDIA_FORGE_HTTP_PORT: 'HTTP service mode only',
      MEDIA_FORGE_INTERNAL_URL: 'HTTP service mode only',
      // Not operator config: the process writes it to itself when the Higgsfield
      // auth fallback scheme succeeds (higgsfield.ts:142, :261) and reads it back
      // to stop retrying. Forwarding it would let an outside value pre-declare a
      // fallback that never happened.
      MEDIA_FORGE_HF_AUTH_FALLBACK_USED: 'internal in-process flag, written by the runtime',
      // Test-runner detection for the guard that stops `pnpm test` spawning the
      // real Higgsfield CLI. Set by vitest / the harness, never by an operator.
      VITEST: 'set by the test runner',
      NODE_ENV: 'set by the toolchain',
      // The escape hatch for that guard. DELIBERATELY not forwarded and
      // deliberately absent from .env.example: forwarding it would let an
      // outside value re-enable real, billable CLI submits from inside a test
      // run — which is exactly how 350 credits were spent on 2026-08-01.
      MEDIA_FORGE_ALLOW_REAL_CLI_IN_TESTS:
        'test-only escape hatch; forwarding it would re-arm billable submits under test',
    };

    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts')) files.push(full);
      }
    };
    walk(resolve(REPO_ROOT, 'src'));

    const read = new Set<string>();
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const m of source.matchAll(/process\.env\[['"]([A-Z0-9_]{3,})['"]\]/g)) {
        read.add(m[1]!);
      }
    }

    const missing = [...read].filter((name) => !(name in mediaForgeEnv) && !(name in EXCLUDED));
    expect(
      missing,
      `read under src/ but neither forwarded in .mcp.json nor listed in EXCLUDED. ` +
        `Add it to the env block, or to EXCLUDED with the reason it must not be forwarded.`,
    ).toEqual([]);
  });
});
