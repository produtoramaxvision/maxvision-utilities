// src/billing/veo-cap.ts
import type { Tier } from '../http/auth.js';

export const DEFAULT_CREDIT_VALUE_USD = 0.01;

/** Regra de ouro #3: usa o MENOR creditValueUsd entre os lotes pagos ativos
 *  (mais conservador → débito de Veo maior → margem garantida). Sem lote → base. */
export function effectiveVeoCreditValue(paidLotValuesUsd: readonly number[]): number {
  if (paidLotValuesUsd.length === 0) return DEFAULT_CREDIT_VALUE_USD;
  return Math.min(...paidLotValuesUsd);
}

export interface VeoAllowanceArgs {
  tier: Tier; usedThisCycle: number; included: number; hardCap: number | undefined;
}
export interface VeoAllowance { allowed: boolean; includedUse: boolean; }

/** Regras #1/#2: free nunca; creator usa incluso até `included`, depois débito
 *  recalculado até hardCap (se definido). */
export function veoAllowance(a: VeoAllowanceArgs): VeoAllowance {
  if (a.tier === 'free') return { allowed: false, includedUse: false };
  if (a.hardCap !== undefined && a.usedThisCycle >= a.hardCap) return { allowed: false, includedUse: false };
  if (a.usedThisCycle < a.included) return { allowed: true, includedUse: true };
  return { allowed: true, includedUse: false };
}
