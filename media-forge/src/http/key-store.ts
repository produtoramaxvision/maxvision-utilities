// media-forge/src/http/key-store.ts
// KeyStore: adapter Postgres para lookup de API key hasheada → AuthContext.
// hashKey e puro (testavel sem DB). KeyStore requer Pool do Postgres.
import { createHmac } from 'node:crypto';
import type { Pool } from 'pg';
import type { Tier } from './auth.js';

/** HMAC-SHA256(pepper, rawKey) → hex 64 chars. Deterministico + indexavel. */
export function hashKey(rawKey: string, pepper: string): string {
  return createHmac('sha256', pepper).update(rawKey).digest('hex');
}

export interface KeyRecord {
  tenantId: string;
  tier: Tier;
  scopes: string[];
}

export interface IKeyStore {
  /** Resolve uma raw key para o tenant/tier/scopes. null = key invalida ou revogada. */
  resolve(rawKey: string): Promise<KeyRecord | null>;
}

export class KeyStore implements IKeyStore {
  private pepper: string;

  constructor(
    private pool: Pool,
    pepper: string,
  ) {
    if (!pepper || pepper.length < 16) throw new Error('MEDIA_FORGE_KEY_PEPPER must be >=16 chars');
    this.pepper = pepper;
  }

  async resolve(rawKey: string): Promise<KeyRecord | null> {
    const kh = hashKey(rawKey, this.pepper);
    const r = await this.pool.query<{ tenant_id: string; tier: string; scopes: string[] }>(
      `SELECT t.id AS tenant_id, t.tier, k.scopes
         FROM api_keys k
         JOIN tenants t ON t.id = k.tenant_id
        WHERE k.key_hash = $1
          AND k.revoked_at IS NULL`,
      [kh],
    );
    if (r.rowCount === 0) return null;
    const row = r.rows[0]!;
    return {
      tenantId: row.tenant_id,
      tier: row.tier as Tier,
      scopes: row.scopes ?? [],
    };
  }
}

/** FlatKeyStore: backward-compat para MEDIA_FORGE_API_KEYS (lista plana).
 *  Usado em self-host sem Postgres e em testes unitarios.
 *  Tier sempre 'pro'; tenantId = 'self'. */
export class FlatKeyStore implements IKeyStore {
  private keys: Set<string>;

  constructor(apiKeys: string) {
    this.keys = new Set(
      apiKeys
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    );
  }

  async resolve(rawKey: string): Promise<KeyRecord | null> {
    if (!this.keys.has(rawKey)) return null;
    return { tenantId: 'self', tier: 'pro', scopes: [] };
  }
}
