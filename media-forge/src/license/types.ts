// src/license/types.ts
export type LicenseTier = 'self' | 'agency' | 'enterprise';

/** Resultado normalizado de uma chamada de validação. */
export type LicenseStatus =
  | { status: 'ok'; tier: LicenseTier; expiresAt: string | null }
  | { status: 'invalid'; reason: string }
  | { status: 'revoked'; reason: string }
  | { status: 'unreachable'; reason: string };

/** Estado de gate que o middleware lê (derivado do cache + grace). */
export interface LicenseState {
  /** true → /mcp permitido; false → 403 */
  allowed: boolean;
  reason: string;
  tier: LicenseTier | null;
  lastCheckedAt: number;
}
