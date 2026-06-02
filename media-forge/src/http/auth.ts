// media-forge/src/http/auth.ts
// Autenticacao do transporte HTTP. F-C: AuthContext estendido + resolveAuth async.
// F-A: resolveAuth sync foi substituido; FlatKeyStore (key-store.ts) preserva a logica plana.
import type { IKeyStore } from './key-store.js';

export type Tier = 'free' | 'creator' | 'pro';

export interface AuthContext {
  apiKey: string;     // raw key apresentada (nunca persistida -- so usada no request)
  tenantId: string;   // F-C: id do tenant no Postgres (ou 'self' no modo flat/self-host)
  tier: Tier;         // F-C: tier do tenant
  scopes: string[];   // F-C: escopos da key (ex: ['image','video']) -- F-E usa; F-C propaga
}

export type AuthResult = { ok: true; ctx: AuthContext } | { ok: false; reason: string };

/** Extrai Bearer token do header Authorization. */
function extractBearer(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return m ? (m[1] ?? '').trim() : null;
}

/**
 * Resolve a raw key via store (Postgres ou plana).
 * Async -- o store pode fazer I/O (DB lookup).
 */
export async function resolveAuth(
  authHeader: string | undefined,
  store: IKeyStore,
): Promise<AuthResult> {
  const rawKey = extractBearer(authHeader);
  if (!rawKey) return { ok: false, reason: 'missing or malformed Authorization header' };

  const record = await store.resolve(rawKey);
  if (!record) return { ok: false, reason: 'unknown or revoked API key' };

  return {
    ok: true,
    ctx: {
      apiKey: rawKey,
      tenantId: record.tenantId,
      tier: record.tier,
      scopes: record.scopes,
    },
  };
}
