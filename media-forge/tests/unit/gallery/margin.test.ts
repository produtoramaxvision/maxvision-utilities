// media-forge/tests/unit/gallery/margin.test.ts
import { describe, it, expect } from 'vitest';
import {
  computeMargin,
  marginBelowThreshold,
} from '../../../src/gallery/margin.js';
import type { GenerationRecord } from '../../../src/gallery/schema.js';

const makeRow = (
  o: Partial<GenerationRecord> & {
    costUsd: number;
    creditsDebited: number;
    creditValueUsd: number;
    model: string;
  },
): GenerationRecord => ({
  generationId: Math.random().toString(36).slice(2),
  tenantId: 't1',
  provider: 'google',
  minioKey: null,
  signedUrl: null,
  status: 'completed',
  createdAt: '2026-06-02T00:00:00Z',
  ...o,
});

describe('computeMargin', () => {
  it('margem basica: receita - custo', () => {
    const rows = [
      makeRow({ costUsd: 4.0, creditsDebited: 1600, creditValueUsd: 0.01, model: 'veo-3-1-pro' }),
      makeRow({ costUsd: 0.02, creditsDebited: 20, creditValueUsd: 0.01, model: 'imagen-4-ultra' }),
    ];
    // receita = 1600*0.01 + 20*0.01 = 16+0.2 = 16.2
    // custo = 4.0 + 0.02 = 4.02
    // margem = 16.2 - 4.02 = 12.18; margem% = 12.18/16.2 ~ 75.2%
    const r = computeMargin(rows);
    expect(r.revenueUsd).toBeCloseTo(16.2, 4);
    expect(r.costUsd).toBeCloseTo(4.02, 4);
    expect(r.marginUsd).toBeCloseTo(12.18, 4);
    expect(r.marginPct).toBeCloseTo(75.185, 1);
  });

  it('sem geracoes: margem 0, nao NaN', () => {
    const r = computeMargin([]);
    expect(r.revenueUsd).toBe(0);
    expect(r.marginUsd).toBe(0);
    expect(r.marginPct).toBe(0);
  });

  it('por modelo: agrega por model key', () => {
    const rows = [
      makeRow({ costUsd: 4.0, creditsDebited: 1600, creditValueUsd: 0.01, model: 'veo-3-1-pro' }),
      makeRow({ costUsd: 4.0, creditsDebited: 1600, creditValueUsd: 0.01, model: 'veo-3-1-pro' }),
      makeRow({
        costUsd: 0.02,
        creditsDebited: 20,
        creditValueUsd: 0.01,
        model: 'imagen-4-ultra',
      }),
    ];
    const r = computeMargin(rows);
    expect(r.byModel['veo-3-1-pro'].count).toBe(2);
    expect(r.byModel['imagen-4-ultra'].count).toBe(1);
  });

  // PROPERTY (regra de ouro): para qualquer combinacao valida de COGS/markup/creditValue,
  // a margem calculada deve ser >= 0 quando o preco foi calculado por priceCredits.
  it('property: receita >= custo quando creditos = ceil(custo*markup/creditValue)', () => {
    const costs = [0.02, 0.13, 0.63, 4.0, 74];
    const markups = [4, 10];
    const creditValues = [0.01, 0.005, 0.00196];
    for (const costUsd of costs)
      for (const markup of markups)
        for (const creditValueUsd of creditValues) {
          const creditsDebited = Math.ceil((costUsd * markup) / creditValueUsd);
          const rows = [makeRow({ costUsd, creditsDebited, creditValueUsd, model: 'any' })];
          const r = computeMargin(rows);
          expect(r.marginUsd).toBeGreaterThanOrEqual(-1e-9); // tolerancia float
        }
  });
});

describe('marginBelowThreshold', () => {
  it('alerta quando pct < limiar', () => {
    const report = { marginPct: 20 } as ReturnType<typeof computeMargin>;
    expect(marginBelowThreshold(report, 30)).toBe(true);
    expect(marginBelowThreshold(report, 10)).toBe(false);
  });
});
