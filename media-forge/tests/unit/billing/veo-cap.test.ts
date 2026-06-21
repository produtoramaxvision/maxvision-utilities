// tests/unit/billing/veo-cap.test.ts
import { describe, it, expect } from 'vitest';
import { effectiveVeoCreditValue, veoAllowance } from '../../../src/billing/veo-cap.js';

describe('veo-cap', () => {
  it('creditValueUsd conservador = menor lote pago ativo', () => {
    expect(effectiveVeoCreditValue([0.0024, 0.00196, 0.005])).toBeCloseTo(0.00196);
  });
  it('sem lote pago → fallback 0.01 (valor-base do crédito)', () => {
    expect(effectiveVeoCreditValue([])).toBe(0.01);
  });

  it('dentro do incluso (count < included) → allowed, includedUse=true', () => {
    const r = veoAllowance({ tier: 'creator', usedThisCycle: 0, included: 1, hardCap: undefined });
    expect(r).toEqual({ allowed: true, includedUse: true });
  });
  it('além do incluso → allowed por débito recalculado, includedUse=false', () => {
    const r = veoAllowance({ tier: 'creator', usedThisCycle: 1, included: 1, hardCap: undefined });
    expect(r).toEqual({ allowed: true, includedUse: false });
  });
  it('hard cap atingido → bloqueado', () => {
    const r = veoAllowance({ tier: 'creator', usedThisCycle: 3, included: 1, hardCap: 3 });
    expect(r.allowed).toBe(false);
  });
  it('free → Veo sempre bloqueado (regra de ouro #1; reforço além do tier-gate F-C)', () => {
    expect(veoAllowance({ tier: 'free', usedThisCycle: 0, included: 0, hardCap: undefined }).allowed).toBe(false);
  });
});
