// credit-core/src/pricing.ts
export interface PriceInput {
  costUsd: number;       // COGS do provedor pra esta geração
  markup: number;        // 4 (vídeo) / 10 (imagem) — multiplicador
  creditValueUsd: number;// valor de 1 crédito no saldo SENDO gasto
}

/** créditos = ceil(custo × markup ÷ valor_credito). Margem garantida por construção. */
export function priceCredits({ costUsd, markup, creditValueUsd }: PriceInput): number {
  if (!(costUsd >= 0)) throw new Error('costUsd must be >= 0');
  if (!(markup >= 1)) throw new Error('markup must be >= 1');
  if (!(creditValueUsd > 0)) throw new Error('creditValueUsd must be > 0');
  return Math.ceil((costUsd * markup) / creditValueUsd);
}
