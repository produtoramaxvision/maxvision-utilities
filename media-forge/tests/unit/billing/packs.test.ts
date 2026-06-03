// tests/unit/billing/packs.test.ts
import { describe, it, expect } from 'vitest';
import { PACKS, SUBSCRIPTION, packForBrl, marginSafe } from '../../../src/billing/packs.js';

describe('packs', () => {
  it('mapeia os 3 packs Pix da spec', () => {
    expect(packForBrl(19.9)?.credits).toBe(1500);
    expect(packForBrl(49.9)?.credits).toBe(4200);
    expect(packForBrl(99.9)?.credits).toBe(9000);
    expect(packForBrl(7.77)).toBeUndefined();
  });

  it('assinatura Criador = R$37,90 / ~2500 cr', () => {
    expect(SUBSCRIPTION.brl).toBe(37.9);
    expect(SUBSCRIPTION.credits).toBe(2500);
  });

  it('creditValueUsd decresce com packs maiores (mais créditos por real)', () => {
    const small = packForBrl(19.9)!;
    const large = packForBrl(99.9)!;
    expect(large.creditValueUsd).toBeLessThan(small.creditValueUsd);
  });

  // REGRA DE OURO #3: em qualquer pack, Veo recalculado ainda cobre COGS×(1+markup)+fee.
  it('todos os packs passam na checagem de margem de Veo (gate de publicação)', () => {
    for (const p of [...PACKS, SUBSCRIPTION]) {
      expect(marginSafe(p), `pack ${p.brl} deve ser margin-safe`).toBe(true);
    }
  });

  it('marginSafe rejeita um pack hipotético barato demais', () => {
    expect(marginSafe({ brl: 1, credits: 1_000_000, creditValueUsd: 0.0000001 })).toBe(false);
  });
});
