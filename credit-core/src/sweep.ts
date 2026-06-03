// credit-core/src/sweep.ts
import { Store } from './store.js';
import { CreditService } from './service.js';
import { expiredReservationIds, type ReserveEntry } from './reservations.js';

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
}): Promise<{ captured: string[]; released: string[] }> {
  const rows = await opts.store.entriesForWithTtl(opts.tenantId);
  const expired = expiredReservationIds(rows as ReserveEntry[], opts.nowIso);
  const captured: string[] = []; const released: string[] = [];
  for (const rid of expired) {
    const status = await opts.probe(rid);
    const { amount } = opts.reserveMeta(rid);
    if (status === 'completed') {
      await opts.service.capture({ tenantId: opts.tenantId, reservationId: rid, amount, externalId: `cap-${rid}` });
      captured.push(rid);
    } else {
      await opts.service.release({ tenantId: opts.tenantId, reservationId: rid, amount, externalId: `rel-${rid}` });
      released.push(rid);
    }
  }
  return { captured, released };
}
