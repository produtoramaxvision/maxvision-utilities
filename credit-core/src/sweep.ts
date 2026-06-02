// credit-core/src/sweep.ts
import { Store } from './store.js';
import { CreditService } from './service.js';
import { expiredReservationIds, type ReserveEntry } from './reservations.js';

export type JobStatus = 'completed' | 'failed' | 'unknown';
export type StatusProbe = (reservationId: string) => Promise<JobStatus>;

/** Para cada reserva vencida: completed→capture, failed/unknown→release. */
export async function runSweep(opts: {
  store: Store; service: CreditService; tenantId: string; nowIso: string; probe: StatusProbe;
  reserveMeta: (rid: string) => { amount: number; externalSuffix: string };
}): Promise<{ captured: string[]; released: string[] }> {
  const rows = await opts.store.entriesForWithTtl(opts.tenantId);
  const expired = expiredReservationIds(rows as ReserveEntry[], opts.nowIso);
  const captured: string[] = []; const released: string[] = [];
  for (const rid of expired) {
    const status = await opts.probe(rid);
    const { amount, externalSuffix } = opts.reserveMeta(rid);
    if (status === 'completed') {
      await opts.service.capture({ tenantId: opts.tenantId, reservationId: rid, amount, externalId: `sweep-cap-${externalSuffix}` });
      captured.push(rid);
    } else {
      await opts.service.release({ tenantId: opts.tenantId, reservationId: rid, amount, externalId: `sweep-rel-${externalSuffix}` });
      released.push(rid);
    }
  }
  return { captured, released };
}
