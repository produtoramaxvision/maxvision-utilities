/**
 * Reading environment variables that may arrive blank.
 *
 * `.mcp.json` forwards variables as `"NAME": "${NAME}"`. What an unset `${NAME}`
 * expands to is not specified by the Claude Code docs — it may drop the key or it
 * may set the empty string. `process.env['X'] ?? fallback` only rejects
 * `undefined`, so under the second behaviour every such read silently takes `''`
 * instead of its default:
 *
 *   MEDIA_FORGE_OUTPUTS_DIR -> mkdirSync('') throws ENOENT
 *   MEDIA_FORGE_MAX_OBJECTS_PER_CATEGORY -> Number('') is 0, not 10000
 *
 * Treating blank as absent is correct under either behaviour, so callers do not
 * have to know which one is in force.
 */

/** The variable's value, or undefined when unset, empty, or whitespace-only. */
export function envOrUndefined(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
