// src/billing/packs.ts
// Números travados da spec §4.3 (decisão do usuário 2026-06-01).
// creditValueUsd = (brl / FX_BRL_PER_USD) / credits. Regra de ouro #3: o débito de
// Veo usa o creditValueUsd do SALDO gasto; a checagem de margem garante que mesmo o
// pack mais "barato por crédito" ainda cobre COGS_Veo×(1+markup)+fee.

export const FX_BRL_PER_USD = 5.55; // câmbio com buffer (spec §4.3)
export const VIDEO_MARKUP = 4;      // markup de vídeo (spec §4.3)
export const VEO_8S_COGS_USD = 4.0; // COGS Veo 8s (spec §4.3 tabela)
export const ASAAS_FEE_USD = 1.99 / FX_BRL_PER_USD; // ~R$1,99 fixo (spec §4.6)
// Margem mínima EXIGIDA do pack no gate de publicação (regra de ouro #3).
// O débito (veoDebitCredits) já embute VIDEO_MARKUP → a margem por-Veo é estrutural
// (revenue = COGS×markup). Este piso adicional garante que a economia do PACK INTEIRO
// ainda cobra a fee fixa do Pix com folga; só "morde" packs pequenos demais.
export const MIN_MARGIN = 1; // ≥100% sobre o COGS (markup estrutural 4× é folga adicional)

export interface Pack {
  readonly brl: number;
  readonly credits: number;
  readonly creditValueUsd: number;
}

function mkPack(brl: number, credits: number): Pack {
  return { brl, credits, creditValueUsd: brl / FX_BRL_PER_USD / credits };
}

export const PACKS: readonly Pack[] = [
  mkPack(19.9, 1500),
  mkPack(49.9, 4200),
  mkPack(99.9, 9000),
];

export const SUBSCRIPTION: Pack = mkPack(37.9, 2500);

export function packForBrl(brl: number): Pack | undefined {
  // tolerância de centavos pra ruído de ponto flutuante vindo do provedor
  return [...PACKS, SUBSCRIPTION].find((p) => Math.abs(p.brl - brl) < 0.005);
}

/** Quantos créditos um Veo 8s debitaria neste pack (regra de ouro #3, conservador). */
export function veoDebitCredits(creditValueUsd: number): number {
  return Math.ceil((VEO_8S_COGS_USD * VIDEO_MARKUP) / creditValueUsd);
}

/** Gate de publicação (regra de ouro #3) — economia do PACK INTEIRO.
 *
 * O débito por-Veo (`veoDebitCredits`) embute o markup → a receita por Veo é
 * estruturalmente `COGS×markup` ($16), CONSTANTE pra qualquer pack. Logo um gate
 * "por-Veo" não distingue um pack saudável de um absurdamente barato. O risco real
 * que sobra é a **fee fixa** do Pix engolir packs pequenos. Então o gate mede o pack
 * inteiro: gastando TODOS os créditos em Veo (pior caso de margem), a receita da venda
 * (`brl/FX = credits × creditValueUsd`) tem que cobrir `cogsTotal×(1+MIN_MARGIN) + fee`.
 * cogsTotal = (créditos ÷ débito_por_Veo) × COGS = saleRevenue ÷ markup. */
export function marginSafe(p: Pack): boolean {
  const saleRevenueUsd = p.credits * p.creditValueUsd; // = brl / FX_BRL_PER_USD
  const debitPerVeo = veoDebitCredits(p.creditValueUsd);
  const maxVeos = p.credits / debitPerVeo;
  const cogsTotalUsd = maxVeos * VEO_8S_COGS_USD;
  const floorUsd = cogsTotalUsd * (1 + MIN_MARGIN) + ASAAS_FEE_USD;
  return saleRevenueUsd >= floorUsd;
}
