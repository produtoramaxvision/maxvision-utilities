// credit-core/tests/accounting.test.ts
import { describe, it, expect } from 'vitest';
import { availableBalance, canReserve, type LedgerEntry } from '../src/accounting.js';

const E = (e: Partial<LedgerEntry> & Pick<LedgerEntry, 'kind' | 'amount'>): LedgerEntry => ({
  id: Math.random().toString(36).slice(2),
  tenantId: 't1',
  reservationId: null,
  createdAt: '2026-06-02T00:00:00Z',
  ...e,
});

describe('availableBalance', () => {
  it('grants somam', () => {
    expect(availableBalance([E({ kind: 'grant', amount: 100 }), E({ kind: 'grant', amount: 50 })])).toBe(150);
  });

  it('reserva ativa reduz disponível', () => {
    const es = [E({ kind: 'grant', amount: 100 }), E({ kind: 'reserve', amount: 30, reservationId: 'R1' })];
    expect(availableBalance(es)).toBe(70);
  });

  it('capture mantém o gasto permanente (reserva já estava fora)', () => {
    const es = [
      E({ kind: 'grant', amount: 100 }),
      E({ kind: 'reserve', amount: 30, reservationId: 'R1' }),
      E({ kind: 'capture', amount: 30, reservationId: 'R1' }),
    ];
    expect(availableBalance(es)).toBe(70);
  });

  it('release devolve a reserva pro disponível', () => {
    const es = [
      E({ kind: 'grant', amount: 100 }),
      E({ kind: 'reserve', amount: 30, reservationId: 'R1' }),
      E({ kind: 'release', amount: 30, reservationId: 'R1' }),
    ];
    expect(availableBalance(es)).toBe(100);
  });

  it('canReserve respeita o disponível', () => {
    const es = [E({ kind: 'grant', amount: 50 })];
    expect(canReserve(es, 50)).toBe(true);
    expect(canReserve(es, 51)).toBe(false);
    expect(canReserve(es, 0)).toBe(false);
  });
});
