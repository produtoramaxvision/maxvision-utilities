// credit-core/src/accounting.ts
export type EntryKind = 'grant' | 'reserve' | 'capture' | 'release';

export interface LedgerEntry {
  id: string;
  tenantId: string;
  kind: EntryKind;
  amount: number; // magnitude positiva, em créditos
  reservationId: string | null;
  createdAt: string;
}

/** Disponível = Σgrant − Σcapture − Σ(reservas ativas, i.e. sem capture/release). */
export function availableBalance(entries: readonly LedgerEntry[]): number {
  let grants = 0;
  let captures = 0;
  const settled = new Set<string>(); // reservation_ids com capture OU release
  for (const e of entries) {
    if (e.kind === 'capture' || e.kind === 'release') {
      if (e.reservationId) settled.add(e.reservationId);
    }
  }
  let activeReserves = 0;
  for (const e of entries) {
    if (e.kind === 'grant') grants += e.amount;
    else if (e.kind === 'capture') captures += e.amount;
    else if (e.kind === 'reserve' && e.reservationId && !settled.has(e.reservationId)) {
      activeReserves += e.amount;
    }
  }
  return grants - captures - activeReserves;
}

export function canReserve(entries: readonly LedgerEntry[], amount: number): boolean {
  return amount > 0 && availableBalance(entries) >= amount;
}
