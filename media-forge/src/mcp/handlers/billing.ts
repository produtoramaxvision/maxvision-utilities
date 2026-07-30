import type { MediaForgeClient } from '../../core/client.js';
import type { MediaForgeConfig } from '../../core/config.js';
import type { OutputManager } from '../../output/output-manager.js';
import type { OutputStorageClient } from '../../output/storage.js';
import type { Tier } from '../../http/auth.js';
import type { GalleryStore } from '../../gallery/gallery-store.js';
import type { SpendPurpose } from '../../core/cost-guard.js';
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
  /**
   * T11/T14: marca esta requisição como um **retake** do reviewer, não trabalho
   * novo. Retakes podem consumir a fatia do cap diário reservada por
   * `MEDIA_FORGE_BUDGET_RESERVE_PCT`; trabalho novo não pode.
   *
   * Fica em `HandlersDeps` e não no schema de cada tool de propósito: `deps` é
   * construído fresco por requisição (`app-internal.ts:19`), então quem despacha
   * o retake marca uma vez e **todas** as tools guardadas passam a enxergar —
   * em vez de replicar um campo `isRetake` em mais de dez schemas e depender de
   * cada call site lembrar de repassá-lo.
   *
   * `undefined` = trabalho novo. Default conservador: um despachante que ainda
   * não conhece este campo nunca ganha acesso à reserva por omissão.
   */
  spendPurpose?: SpendPurpose;
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
 * A5 (2026-07-30) UPDATE: Kling, Higgsfield, and Seedance now ALSO reserve
 * credit for real BEFORE the network submit, via the `ledgerHooks.
 * beforeSubmit` hook invoked from inside each provider's `generate()` (see
 * `VideoLedgerHooks` in base.ts and `reserveVideoSubmit` below). That closes
 * the reserve-after-submit race this function used to only narrow. This
 * preflight is kept as a cheap, redundant fast-fail: it is a single balance
 * READ (no write, no credit-core mutation), so running it before the
 * request body is even built avoids that work for the common case (balance
 * already too low) without waiting on the heavier reserve() call. The
 * remaining race it does NOT close — balance dropping between this read and
 * the real reserve a moment later, e.g. a concurrent generation from the
 * same tenant — is caught by `beforeSubmit`'s own reserve, which 402s
 * exactly like this function does.
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

/** Reserva crédito para um submit de VÍDEO (assíncrono), usando o jobId que o
 *  provider já mintou para essa geração. No-op se billing off. reserve/capture
 *  só reconciliam quando ambos usam o MESMO id (res-{jobId}/cap-{jobId}).
 *  402 propaga (convertido em tool-error pelo wrap).
 *
 *  A5 (2026-07-30): chamada de dois lugares agora — `submitVeoWithLedger`
 *  (register.ts) chama diretamente ANTES do submit do Veo; Kling, Higgsfield
 *  e Seedance chamam via `ledgerHooks.beforeSubmit` (também register.ts),
 *  invocado de DENTRO de cada provider's `generate()` — depois que o jobId
 *  próprio existe, mas ANTES do fetch de rede — ao invés de depois que
 *  `register.ts` recebia o retorno do handler. `recordJob` continua adiado
 *  até o submit ter sucesso (nenhuma linha 'pending' permanente em falha);
 *  só a RESERVA de crédito passou a rodar antes. */
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
