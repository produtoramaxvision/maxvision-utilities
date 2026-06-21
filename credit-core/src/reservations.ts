// credit-core/src/reservations.ts
import type { LedgerEntry } from './accounting.js';

// Reserves carregam ttlAt opcional (Postgres preenche). Tipo local estendido.
export type ReserveEntry = LedgerEntry & { ttlAt?: string | null };

/** IDs de reservas vencidas (ttlAt < now) que NÃO têm capture nem release. */
export function expiredReservationIds(entries: readonly ReserveEntry[], nowIso: string): string[] {
  const now = Date.parse(nowIso);
  const settled = new Set<string>();
  for (const e of entries) {
    if ((e.kind === 'capture' || e.kind === 'release') && e.reservationId) settled.add(e.reservationId);
  }
  const out: string[] = [];
  for (const e of entries) {
    if (e.kind !== 'reserve' || !e.reservationId || settled.has(e.reservationId)) continue;
    if (e.ttlAt && Date.parse(e.ttlAt) < now) out.push(e.reservationId);
  }
  return out;
}
