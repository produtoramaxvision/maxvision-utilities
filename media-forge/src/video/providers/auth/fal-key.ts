/**
 * fal.ai API key reader.
 *
 * Auth format: `Authorization: Key <FAL_KEY>` for direct fal.run REST calls,
 * or pass via `fal.config({ credentials: getFalApiKey() })` when using
 * the `@fal-ai/client` SDK.
 *
 * P16 scope: pure env-read utility, zero state, zero API calls. Consumed by
 * `BytedanceSeedanceProvider` (primary fal.ai path) and any future fal.ai-backed
 * provider. Error messages NEVER include the secret value.
 */

export class FalAuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FalAuthConfigError';
  }
}

export interface FalEnvSubset {
  readonly FAL_KEY?: string;
}

/**
 * Returns the trimmed `FAL_KEY` env var, suitable for passing to
 * `fal.config({ credentials })` or the `Authorization: Key ${key}` header
 * on direct fal.ai REST calls.
 *
 * Throws `FalAuthConfigError` (with a clear message but NEVER the secret value)
 * when the env var is missing, empty, or whitespace-only.
 *
 * @param env - Env subset to read from. Defaults to `process.env`.
 */
export function getFalApiKey(env: FalEnvSubset = process.env): string {
  const raw = env.FAL_KEY;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new FalAuthConfigError(
      'fal.ai auth not configured. Set FAL_KEY env var. ' +
        'Generate a key at https://fal.ai/dashboard/keys',
    );
  }
  return raw.trim();
}
