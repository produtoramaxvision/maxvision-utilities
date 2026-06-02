// Auth mínima do transporte HTTP (F-A). F-C troca por keys hasheadas + tenant.
export type Tier = 'free' | 'creator' | 'pro';

export interface AuthContext {
  apiKey: string;
  // F-C adiciona: tenantId, tier, scopes
}
export type AuthResult = { ok: true; ctx: AuthContext } | { ok: false; reason: string };

export function resolveAuth(
  authHeader: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): AuthResult {
  if (!authHeader) return { ok: false, reason: 'missing Authorization header' };
  const m = /^Bearer\s+(.+)$/.exec(authHeader.trim());
  if (!m) return { ok: false, reason: 'expected Bearer scheme' };
  const key = (m[1] ?? '').trim();
  const allowed = (env['MEDIA_FORGE_API_KEYS'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (allowed.length === 0) return { ok: false, reason: 'no API keys configured' };
  if (!allowed.includes(key)) return { ok: false, reason: 'unknown API key' };
  return { ok: true, ctx: { apiKey: key } };
}
