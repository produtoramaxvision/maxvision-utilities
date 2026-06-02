// credit-core/tests/reservations.test.ts
import { describe, it, expect } from 'vitest';
import { expiredReservationIds } from '../src/reservations.js';
import type { LedgerEntry } from '../src/accounting.js';

const E = (e: Partial<LedgerEntry> & Pick<LedgerEntry, 'kind' | 'amount'>): LedgerEntry & { ttlAt?: string } => ({
  id: Math.random().toString(36).slice(2), tenantId: 't1', reservationId: null,
  createdAt: '2026-06-02T00:00:00Z', ...e,
});

describe('expiredReservationIds', () => {
  const now = '2026-06-02T01:00:00Z';
  it('reserva vencida e não-settled é listada', () => {
    const es = [E({ kind: 'reserve', amount: 10, reservationId: 'R1', ttlAt: '2026-06-02T00:30:00Z' } as never)];
    expect(expiredReservationIds(es, now)).toEqual(['R1']);
  });
  it('reserva ainda válida não é listada', () => {
    const es = [E({ kind: 'reserve', amount: 10, reservationId: 'R2', ttlAt: '2026-06-02T02:00:00Z' } as never)];
    expect(expiredReservationIds(es, now)).toEqual([]);
  });
  it('reserva já capturada/liberada não é listada mesmo vencida', () => {
    const es = [
      E({ kind: 'reserve', amount: 10, reservationId: 'R3', ttlAt: '2026-06-02T00:30:00Z' } as never),
      E({ kind: 'capture', amount: 10, reservationId: 'R3' }),
    ];
    expect(expiredReservationIds(es, now)).toEqual([]);
  });
});
