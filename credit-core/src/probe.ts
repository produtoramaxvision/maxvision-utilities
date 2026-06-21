import type { JobStatus } from './sweep.js';
export interface ProbeResult { status: JobStatus; actualCredits?: number }
export type TenantAwareProbe = (tenantId: string, reservationId: string) => Promise<ProbeResult>;
export interface HttpProbeOpts {
  statusUrlFor: (tenantId: string, reservationId: string) => Promise<string | null>;
  secret: string; timeoutMs: number; fetchImpl?: typeof fetch;
}
/** Generic oracle: GET {status_url} with shared-secret. ANY non-completed/failed
 *  outcome (missing url, timeout, network error, non-2xx, malformed body) →
 *  'unknown' so the sweep RELEASES (never charges on uncertainty). */
export function httpStatusProbe(opts: HttpProbeOpts): TenantAwareProbe {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return async (tenantId, reservationId) => {
    const url = await opts.statusUrlFor(tenantId, reservationId);
    if (!url) return { status: 'unknown' };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
    try {
      const res = await fetchImpl(url, { headers: { 'x-mf-status-secret': opts.secret }, signal: ctrl.signal });
      if (!res.ok) return { status: 'unknown' };
      const j = (await res.json()) as { status?: string; actualCredits?: number };
      if (j.status === 'completed') return { status: 'completed', actualCredits: j.actualCredits };
      if (j.status === 'failed') return { status: 'failed' };
      return { status: 'unknown' };
    } catch { return { status: 'unknown' }; }
    finally { clearTimeout(timer); }
  };
}
