/**
 * Feature flags for media-forge providers.
 *
 * Flags are evaluated at call time (never cached at module load) so that
 * test suites can toggle process.env per-test and get correct results.
 *
 * Convention for boolean flags:
 *   - Unset or empty string → default behaviour (described per flag)
 *   - 'false' | '0' | 'no' | 'off' (case-insensitive, trimmed) → explicitly OFF
 *   - Any other non-empty value → treated as ON
 *
 * Emergency use: a single env-var flip in production removes the entire
 * provider surface without multi-file surgery.
 */

/**
 * Returns true when the Seedance 2.0 (ByteDance) provider surface is enabled.
 *
 * Default: enabled (returns true when MEDIA_FORGE_SEEDANCE_ENABLED is unset or
 * empty/whitespace).
 *
 * Set MEDIA_FORGE_SEEDANCE_ENABLED=false (or '0'/'no'/'off') to suppress:
 *   - All 4 Seedance MCP tool registrations (text/image/multishot/reference-fusion)
 *   - 'bytedance' from the routing ADAPTED_PROVIDERS set
 *
 * @param env - process.env or a stub; defaults to process.env.
 */
export function isSeedanceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env['MEDIA_FORGE_SEEDANCE_ENABLED'];
  if (raw === undefined || raw === null) return true; // default-on
  const normalized = raw.trim().toLowerCase();
  if (normalized === '') return true; // empty string → default-on
  return normalized !== 'false' && normalized !== '0' && normalized !== 'no' && normalized !== 'off';
}
