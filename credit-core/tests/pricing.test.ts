// credit-core/tests/pricing.test.ts
import { describe, it, expect } from 'vitest';
import { priceCredits } from '../src/pricing.js';

describe('priceCredits', () => {
  it('imagem: $0.02 × 10 ÷ $0.01 = 20 créditos', () => {
    expect(priceCredits({ costUsd: 0.02, markup: 10, creditValueUsd: 0.01 })).toBe(20);
  });
  it('Veo 8s: $4 × 4 ÷ $0.01 = 1600 créditos', () => {
    expect(priceCredits({ costUsd: 4, markup: 4, creditValueUsd: 0.01 })).toBe(1600);
  });
  it('arredonda pra cima (ceil)', () => {
    expect(priceCredits({ costUsd: 0.025, markup: 4, creditValueUsd: 0.01 })).toBe(10); // 0.1/0.01=10
    expect(priceCredits({ costUsd: 0.0251, markup: 4, creditValueUsd: 0.01 })).toBe(11);
  });

  // PROPERTY (regra de ouro #3): em qualquer caminho/pack, a receita-em-créditos
  // cobre custo×markup. Grid determinístico de casos.
  it('margem garantida: debito × creditValue ≥ custo × markup', () => {
    const costs = [0.02, 0.13, 0.63, 4, 74];
    const markups = [4, 10];
    const creditValues = [0.01, 0.005, 0.00196]; // inclui pack descontado
    for (const costUsd of costs)
      for (const markup of markups)
        for (const creditValueUsd of creditValues) {
          const credits = priceCredits({ costUsd, markup, creditValueUsd });
          expect(credits * creditValueUsd).toBeGreaterThanOrEqual(costUsd * markup - 1e-9);
        }
  });

  it('rejeita parâmetros inválidos', () => {
    expect(() => priceCredits({ costUsd: -1, markup: 4, creditValueUsd: 0.01 })).toThrow();
    expect(() => priceCredits({ costUsd: 1, markup: 0, creditValueUsd: 0.01 })).toThrow();
    expect(() => priceCredits({ costUsd: 1, markup: 4, creditValueUsd: 0 })).toThrow();
  });
});
