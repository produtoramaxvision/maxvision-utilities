// license-worker/src/store.ts
export interface LicenseRecord {
  licenseKey: string;
  tier: 'self' | 'agency' | 'enterprise';
  /** ISO date; undefined = perpétua */
  expiresAt?: string;
  revoked: boolean;
  /** preso à primeira instância que validar (anti-compartilhamento) */
  boundInstanceId?: string;
  issuedAt: string;
}

export interface LicenseStore {
  get(licenseKey: string): Promise<LicenseRecord | null>;
  put(rec: LicenseRecord): Promise<void>;
}

export class KVStore implements LicenseStore {
  constructor(private kv: KVNamespace) {}

  async get(licenseKey: string): Promise<LicenseRecord | null> {
    return this.kv.get<LicenseRecord>(licenseKey, 'json');
  }

  async put(rec: LicenseRecord): Promise<void> {
    await this.kv.put(rec.licenseKey, JSON.stringify(rec));
  }
}
