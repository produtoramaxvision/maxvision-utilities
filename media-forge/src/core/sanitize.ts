const SECRET_KEYS = new Set([
  'api_key',
  'apikey',
  'gemini_api_key',
  'google_api_key',
  'authorization',
  'auth_token',
  'access_token',
  'bearer',
  'bearer_token',
  'password',
  'secret',
  'gcs_credentials',
  'service_account_key',
  'private_key',
  'client_secret',
]);

export function redactSecrets(value: string): string {
  if (value.length <= 4) return '****';
  return '****' + value.slice(-4);
}

export function sanitizePayload<T>(payload: T): T {
  return sanitizeInternal(payload) as T;
}

function sanitizeInternal(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeInternal(item));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const isSecret = SECRET_KEYS.has(k.toLowerCase());
    if (isSecret && typeof v === 'string') {
      out[k] = redactSecrets(v);
    } else {
      out[k] = sanitizeInternal(v);
    }
  }
  return out;
}
