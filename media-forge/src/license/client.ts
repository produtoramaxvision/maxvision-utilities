// src/license/client.ts
import type { LicenseStatus, LicenseTier } from './types.js';

export interface ValidateParams {
  url: string;
  licenseKey: string;
  instanceId: string;
  timeoutMs?: number;
}
export interface ValidateDeps {
  fetchFn?: typeof fetch;
}

interface RawResponse {
  valid?: boolean;
  revoked?: boolean;
  tier?: LicenseTier;
  expiresAt?: string | null;
  reason?: string;
}

export async function validateLicense(
  params: ValidateParams,
  deps: ValidateDeps = {},
): Promise<LicenseStatus> {
  const fetchFn = deps.fetchFn ?? fetch;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), params.timeoutMs ?? 5000);
  try {
    const res = await fetchFn(params.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ licenseKey: params.licenseKey, instanceId: params.instanceId }),
      signal: ctrl.signal,
    });
    if (!res.ok) return { status: 'unreachable', reason: `HTTP ${res.status}` };
    const body = (await res.json()) as RawResponse;
    if (body.valid === true) {
      return { status: 'ok', tier: body.tier ?? 'agency', expiresAt: body.expiresAt ?? null };
    }
    if (body.revoked === true) return { status: 'revoked', reason: 'license revoked' };
    return { status: 'invalid', reason: body.reason ?? 'license invalid' };
  } catch (err) {
    return { status: 'unreachable', reason: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(t);
  }
}
