// credit-core/src/sweep.ts
import { Store } from './store.js';
import { CreditService } from './service.js';
import { expiredReservationIds, type ReserveEntry } from './reservations.js';
import type { TenantAwareProbe } from './probe.js';

export type JobStatus = 'completed' | 'failed' | 'unknown';
export type StatusProbe = (reservationId: string) => Promise<JobStatus>;

/** Para cada reserva vencida: completed→capture, failed/unknown→release.
 *
 * EXT1 (anti cobrança em dobro): o external_id de settle é determinístico por reserva
 * — `cap-{reservationId}` / `rel-{reservationId}` — IDÊNTICO ao que o caminho "live"
 * emite (media-forge F-E usa reservationId=jobId → `cap-{jobId}`). Assim, se o sweep
 * settla uma reserva vencida E o callback tardio settla a MESMA reserva, ambos colidem
 * em `ON CONFLICT (kind, external_id) DO NOTHING` → 1 débito só. O esquema antigo
 * `sweep-cap-{suffix}` divergia do live → dois capture entries → débito dobrado. */
export async function runSweep(opts: {
  store: Store; service: CreditService; tenantId: string; nowIso: string; probe: StatusProbe;
  reserveMeta: (rid: string) => { amount: number };
  captureAmount?: (rid: string) => Promise<number>;
}): Promise<{ captured: string[]; released: string[] }> {
  const rows = await opts.store.entriesForWithTtl(opts.tenantId);
  const expired = expiredReservationIds(rows as ReserveEntry[], opts.nowIso);
  const captured: string[] = []; const released: string[] = [];
  for (const rid of expired) {
    const status = await opts.probe(rid);
    if (status === 'completed') {
      const amount = opts.captureAmount ? await opts.captureAmount(rid) : opts.reserveMeta(rid).amount;
      await opts.service.capture({ tenantId: opts.tenantId, reservationId: rid, amount, externalId: `cap-${rid}` });
      captured.push(rid);
    } else {
      const { amount } = opts.reserveMeta(rid);
      await opts.service.release({ tenantId: opts.tenantId, reservationId: rid, amount, externalId: `rel-${rid}` });
      released.push(rid);
    }
  }
  return { captured, released };
}

export async function runSweepAllTenants(opts: {
  store: Store; service: CreditService; nowIso: string; probe: TenantAwareProbe;
}): Promise<{ captured: string[]; released: string[] }> {
  const tenants = await opts.store.tenantsWithExpiredReservations(opts.nowIso);
  const captured: string[] = []; const released: string[] = [];
  for (const tenantId of tenants) {
    const rows = await opts.store.entriesForWithTtl(tenantId);
    const amountByRid = new Map<string, number>();
    for (const e of rows) if (e.kind === 'reserve' && e.reservationId) amountByRid.set(e.reservationId, e.amount);
    const probeCache = new Map<string, Awaited<ReturnType<TenantAwareProbe>>>();
    const probeOnce = async (rid: string) => { let p = probeCache.get(rid); if (!p) { p = await opts.probe(tenantId, rid); probeCache.set(rid, p); } return p; };
    const r = await runSweep({
      store: opts.store, service: opts.service, tenantId, nowIso: opts.nowIso,
      probe: async (rid) => (await probeOnce(rid)).status,
      reserveMeta: (rid) => ({ amount: amountByRid.get(rid) ?? 0 }),
      captureAmount: async (rid) => { const p = await probeOnce(rid); return p.status === 'completed' && typeof p.actualCredits === 'number' ? p.actualCredits : (amountByRid.get(rid) ?? 0); },
    });
    captured.push(...r.captured); released.push(...r.released);
  }
  return { captured, released };
}
