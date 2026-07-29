import type { MediaForgeClient } from '../../core/client.js';
import type { MediaForgeConfig } from '../../core/config.js';
import type { OutputManager } from '../../output/output-manager.js';
import type { OutputStorageClient } from '../../output/storage.js';
import type { Tier } from '../../http/auth.js';
import type { GalleryStore } from '../../gallery/gallery-store.js';
import { runWithDebit, reserveForJob, captureJob, releaseJob } from '../../billing/debit.js';
import {
  priceCredits,
  IMAGE_MARKUP,
  VIDEO_MARKUP,
  DEFAULT_CREDIT_VALUE_USD,
} from '../../billing/pricing.js';
import { InsufficientCreditError, type CreditClient } from '../../billing/credit-client.js';

export interface HandlersDeps {
  client: MediaForgeClient;
  config: MediaForgeConfig;
  outputManager?: OutputManager;
  /** F-B: quando presente, artefatos sao enviados para MinIO; resultado retorna url + expires_at. */
  storage?: OutputStorageClient;
  /** F-C: tier do tenant — controla quais tools sao registradas. undefined = 'pro' (backward compat). */
  tier?: Tier;
  /** F-I: gallery store para list_my_generations. undefined = gallery desabilitada (self-host sem Postgres). */
  galleryStore?: GalleryStore;
  /** F-I: tenantId do AuthContext (F-C). undefined = 'default' (self-host / stdio). */
  tenantId?: string;
  /** F-E: credit-core HTTP client para débito. undefined = billing OFF (self-host / hosted-sem-billing) → no-op. */
  creditClient?: CreditClient;
}

// ---------------------------------------------------------------------------
// F-E billing — débito de geração (imagem síncrona + vídeo assíncrono).
//
// Invariante no-op: TODA função de débito abaixo retorna o caminho original
// inalterado quando `creditClient` ou `tenantId` é undefined (self-host /
// hosted-sem-billing). Billing é OPCIONAL por construção — zero chamadas de
// billing quando o client não foi injetado.
//
// 402 (InsufficientCreditError de reserve) propaga como exceção: como cada
// débito roda DENTRO do callback de `wrap()`, o catch de wrap o converte no
// tool-error estruturado padrão ({ isError: true, ... }) — nunca um 500 cru.
// ---------------------------------------------------------------------------
// IMAGE_MARKUP / VIDEO_MARKUP / DEFAULT_CREDIT_VALUE_USD now live in billing/pricing.ts
// so the webhook-first capture path (kling-webhook-handler) bills identically to this
// live path. Imported at the top of this file.
/** Imagem: ciclo síncrono curto → TTL de 2 min para o sweep liberar reserva presa. */
const IMAGE_TTL_MS = 120_000;
/** Vídeo: render assíncrono pode levar minutos → TTL folgado (2h) cobre o pior caso
 *  antes do sweep do credit-core liberar a reserva. O capture na conclusão é o caminho
 *  primário; o TTL é só a rede de segurança caso o callback nunca chegue. */
const VIDEO_TTL_MS = 2 * 60 * 60 * 1000;

/** Embrulha uma geração de IMAGEM (síncrona) com reserve→capture. No-op se billing off.
 *  `actualCostUSD` raramente vem do serviço de imagem (custo é determinístico por size);
 *  o fallback para a estimativa é o caminho de produção e é exato. */
export async function withImageDebit<T extends object>(
  deps: HandlersDeps,
  jobId: string,
  estimateUsd: number,
  exec: () => Promise<T>,
): Promise<T> {
  if (!deps.creditClient || !deps.tenantId) return exec(); // self-host / billing off
  const estimateCredits = priceCredits({
    costUsd: estimateUsd,
    markup: IMAGE_MARKUP,
    creditValueUsd: DEFAULT_CREDIT_VALUE_USD,
  });
  const ttlAt = new Date(Date.now() + IMAGE_TTL_MS).toISOString();
  const out = await runWithDebit(
    { client: deps.creditClient, tenantId: deps.tenantId, jobId, estimateCredits, ttlAt },
    async () => {
      const result = await exec();
      // `actualCostUSD` is rarely present on image results (cost is deterministic per
      // size). Read it defensively; fall back to the estimate (= exact in production).
      const actualUsd = (result as { actualCostUSD?: number }).actualCostUSD ?? estimateUsd;
      const actualCredits = priceCredits({
        costUsd: actualUsd,
        markup: IMAGE_MARKUP,
        creditValueUsd: DEFAULT_CREDIT_VALUE_USD,
      });
      return { result, actualCredits };
    },
  );
  return out.result;
}

/**
 * Credit preflight for VIDEO submits — checks the tenant's balance BEFORE the
 * handler runs (i.e. before the provider is ever called). No-op when billing
 * is off (same guard as the other F-E functions here).
 *
 * HONESTY NOTE (do not misrepresent this as closing the gap): every Kling
 * submit handler calls the provider FIRST and reserveVideoSubmit runs AFTER
 * (see the "F-E: reserve AFTER submit" comment at each call site) — so an
 * insufficient-balance tenant could still get a provider-side charge before
 * the post-submit reserve() ever 402s. This function only NARROWS that
 * window: it catches the common case (balance already too low right now),
 * but the balance can still drop between this check and the actual submit
 * (a concurrent generation from the same tenant, another call landing in
 * between). It does NOT close the reserve-after-submit race. The real fix is
 * the submit-to-poll correlation store tracked as task T15 — until that
 * lands, this is a mitigation, not a guarantee.
 */
export async function preflightVideoCredit(
  deps: HandlersDeps,
  estimateUsd: number,
): Promise<void> {
  if (!deps.creditClient || !deps.tenantId) return; // self-host / billing off
  const estimateCredits = priceCredits({
    costUsd: estimateUsd,
    markup: VIDEO_MARKUP,
    creditValueUsd: DEFAULT_CREDIT_VALUE_USD,
  });
  const bal = await deps.creditClient.balance(deps.tenantId);
  if (bal < estimateCredits) {
    throw new InsufficientCreditError(deps.tenantId, estimateCredits, bal);
  }
}

/** Reserva crédito para um submit de VÍDEO (assíncrono) usando o jobId/operationName
 *  retornado pelo submit. No-op se billing off. Chamada APÓS o submit obter o id —
 *  reserve/capture só reconciliam quando ambos usam o MESMO id (res-{jobId}/cap-{jobId}).
 *  402 propaga (convertido em tool-error pelo wrap). */
export async function reserveVideoSubmit(
  deps: HandlersDeps,
  jobId: string,
  estimateUsd: number,
): Promise<void> {
  if (!deps.creditClient || !deps.tenantId) return; // self-host / billing off
  // TODO(F-E veo-cap): wire veoAllowance + effectiveVeoCreditValue (Redis counter +
  // paidCreditValuesFor) when billing goes live (post-EXT1). As funções puras de
  // veo-cap já existem + testadas; só a integração (PaymentsStore/Redis) está deferida.
  const estimateCredits = priceCredits({
    costUsd: estimateUsd,
    markup: VIDEO_MARKUP,
    creditValueUsd: DEFAULT_CREDIT_VALUE_USD,
  });
  const ttlAt = new Date(Date.now() + VIDEO_TTL_MS).toISOString();
  // Task 10: derive statusUrl from MEDIA_FORGE_INTERNAL_URL so credit-core sweep
  // can query the oracle endpoint without an explicit caller parameter.
  const internalUrl = process.env['MEDIA_FORGE_INTERNAL_URL'];
  const statusUrl = internalUrl ? `${internalUrl}/job-status/${jobId}` : undefined;
  await reserveForJob({ client: deps.creditClient, tenantId: deps.tenantId, jobId, estimateCredits, ttlAt, statusUrl });
}

/** Captura o custo REAL de um vídeo concluído. Idempotente via external_id cap-{jobId}
 *  (replay do callback não dobra). No-op se billing off ou actualUsd ausente. */
export async function captureVideoComplete(
  deps: HandlersDeps,
  jobId: string,
  actualUsd: number,
): Promise<void> {
  if (!deps.creditClient || !deps.tenantId) return; // self-host / billing off
  const actualCredits = priceCredits({
    costUsd: actualUsd,
    markup: VIDEO_MARKUP,
    creditValueUsd: DEFAULT_CREDIT_VALUE_USD,
  });
  await captureJob({ client: deps.creditClient, tenantId: deps.tenantId, jobId, actualCredits });
}

/** Libera a reserva de um vídeo que falhou terminalmente. Idempotente via rel-{jobId}.
 *  No-op se billing off. */
export async function releaseVideoFailed(
  deps: HandlersDeps,
  jobId: string,
  estimateUsd: number,
): Promise<void> {
  if (!deps.creditClient || !deps.tenantId) return; // self-host / billing off
  const reservedCredits = priceCredits({
    costUsd: estimateUsd,
    markup: VIDEO_MARKUP,
    creditValueUsd: DEFAULT_CREDIT_VALUE_USD,
  });
  await releaseJob({ client: deps.creditClient, tenantId: deps.tenantId, jobId, reservedCredits });
}
