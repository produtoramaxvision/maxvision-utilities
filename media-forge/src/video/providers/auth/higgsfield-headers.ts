/**
 * Higgsfield auth header builder.
 *
 * Auth format verified from @higgsfield/client@0.2.1 source
 * (node_modules/@higgsfield/client/dist/client.js, lines 30-32):
 *
 *   The SDK does NOT use a "Bearer" Authorization header.
 *   It sends two custom headers:
 *     'hf-api-key': apiKey
 *     'hf-secret':  apiSecret
 *
 * This module is pure env-read + header-object-build. Zero API calls.
 * Error messages NEVER include the secret value.
 */

const KEY_ENV = 'HF_API_KEY';
const SECRET_ENV = 'HF_API_SECRET';

export class HiggsfieldAuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HiggsfieldAuthConfigError';
  }
}

export interface HiggsfieldHeaders {
  'hf-api-key': string;
  'hf-secret': string;
}

/**
 * Reads HF_API_KEY and HF_API_SECRET from the environment and returns
 * the two custom request headers required by the Higgsfield platform API.
 *
 * @throws {HiggsfieldAuthConfigError} when either env var is missing or blank.
 */
export function buildHiggsfieldHeaders(): HiggsfieldHeaders {
  const key = process.env[KEY_ENV];
  const secret = process.env[SECRET_ENV];

  const missing: string[] = [];
  if (!key) missing.push(KEY_ENV);
  if (!secret) missing.push(SECRET_ENV);

  if (missing.length > 0) {
    throw new HiggsfieldAuthConfigError(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        `Set ${KEY_ENV} and ${SECRET_ENV} before calling Higgsfield.`
    );
  }

  // Trim to guard against accidental whitespace in .env files.
  const trimmedKey = key!.trim();
  const trimmedSecret = secret!.trim();

  if (trimmedKey.length === 0) {
    throw new HiggsfieldAuthConfigError(
      `${KEY_ENV} is set but empty. Provide a valid API key.`
    );
  }
  if (trimmedSecret.length === 0) {
    throw new HiggsfieldAuthConfigError(
      `${SECRET_ENV} is set but empty. Provide a valid API secret.`
    );
  }

  return {
    'hf-api-key': trimmedKey,
    'hf-secret': trimmedSecret,
  };
}
