import type { JobStatus } from './sweep.js';
export interface ProbeResult { status: JobStatus; actualCredits?: number }
export type TenantAwareProbe = (tenantId: string, reservationId: string) => Promise<ProbeResult>;
export interface HttpProbeOpts {
  statusUrlFor: (tenantId: string, reservationId: string) => Promise<string | null>;
  secret: string;
  timeoutMs: number;
  /** Exact hostname allowlist. The shared secret is attached ONLY to a URL whose
   *  hostname is in this list — closes SSRF + secret-exfiltration via a caller-
   *  supplied status_url (a reserve caller could otherwise point status_url at
   *  its own listener and harvest the secret, or at 169.254.169.254 for SSRF).
   *  Empty allowlist = deny all (fail safe → release). */
  allowedHosts: readonly string[];
  fetchImpl?: typeof fetch;
}

const IP_LITERAL = /^(\d{1,3}\.){3}\d{1,3}$/; // IPv4 literal; IPv6 literals carry ':' (also rejected)
const UNSAFE_HOST = /^(localhost|.*\.local|0\.0\.0\.0)$/i;

/** Validate a caller-supplied status_url before the secret is attached. Rejects
 *  non-http(s), embedded credentials (userinfo), IP literals, loopback/link-local
 *  names, and any hostname not in the exact allowlist. */
export function isProbeUrlAllowed(rawUrl: string, allowedHosts: readonly string[]): boolean {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username !== '' || u.password !== '') return false; // reject userinfo (user:pass@host)
  const host = u.hostname.toLowerCase();
  if (host === '' || host.includes(':')) return false;       // IPv6 literal or malformed
  if (IP_LITERAL.test(host)) return false;                   // no IP literals (metadata/RFC1918 vectors)
  if (UNSAFE_HOST.test(host)) return false;                  // loopback / .local
  return allowedHosts.includes(host);                        // exact-match allowlist
}

/** Generic oracle: GET {status_url} with shared-secret. ANY non-completed/failed
 *  outcome (disallowed url, missing url, timeout, network error, non-2xx,
 *  redirect, malformed body) → 'unknown' so the sweep RELEASES (never charges on
 *  uncertainty, never leaks the secret to an unapproved host). */
export function httpStatusProbe(opts: HttpProbeOpts): TenantAwareProbe {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return async (tenantId, reservationId) => {
    const url = await opts.statusUrlFor(tenantId, reservationId);
    if (!url) return { status: 'unknown' };
    if (!isProbeUrlAllowed(url, opts.allowedHosts)) return { status: 'unknown' };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
    try {
      // redirect:'manual' so a 3xx from an allowed host can't bounce the secret
      // to an unapproved host on the second hop (a redirect is not res.ok → unknown).
      const res = await fetchImpl(url, { headers: { 'x-mf-status-secret': opts.secret }, signal: ctrl.signal, redirect: 'manual' });
      if (!res.ok) return { status: 'unknown' };
      const j = (await res.json()) as { status?: string; actualCredits?: number };
      if (j.status === 'completed') return { status: 'completed', actualCredits: j.actualCredits };
      if (j.status === 'failed') return { status: 'failed' };
      return { status: 'unknown' };
    } catch { return { status: 'unknown' }; }
    finally { clearTimeout(timer); }
  };
}
