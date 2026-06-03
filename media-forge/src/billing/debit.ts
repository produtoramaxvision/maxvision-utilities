// src/billing/debit.ts
// Ciclo de débito de uma geração. reservationId = jobId (contrato anti-double-settle).
// external_id determinístico: res-/cap-/rel- + jobId → idempotente em retry/replay.
import type { CreditClient } from './credit-client.js';

export interface ReserveForJobArgs {
  client: CreditClient; tenantId: string; jobId: string; estimateCredits: number; ttlAt: string;
}
export interface SettleForJobArgs {
  client: CreditClient; tenantId: string; jobId: string;
}

export async function reserveForJob(a: ReserveForJobArgs): Promise<void> {
  await a.client.reserve({
    tenantId: a.tenantId, amount: a.estimateCredits, reservationId: a.jobId,
    ttlAt: a.ttlAt, externalId: `res-${a.jobId}`,
  });
}

/** Captura o CUSTO REAL (não a estimativa). Settla a reserva; a diferença
 *  estimativa-vs-real cai fora corretamente no ledger append-only. */
export async function captureJob(a: SettleForJobArgs & { actualCredits: number }): Promise<void> {
  await a.client.capture({
    tenantId: a.tenantId, reservationId: a.jobId, amount: a.actualCredits, externalId: `cap-${a.jobId}`,
  });
}

export async function releaseJob(a: SettleForJobArgs & { reservedCredits: number }): Promise<void> {
  await a.client.release({
    tenantId: a.tenantId, reservationId: a.jobId, amount: a.reservedCredits, externalId: `rel-${a.jobId}`,
  });
}

export interface RunWithDebitArgs {
  client: CreditClient; tenantId: string; jobId: string; estimateCredits: number; ttlAt: string;
}

/** Ciclo SÍNCRONO completo (imagem): reserve → executa → capture(real) | release(estimativa). */
export async function runWithDebit<T>(
  a: RunWithDebitArgs,
  exec: () => Promise<{ result: T; actualCredits: number }>,
): Promise<{ result: T; actualCredits: number }> {
  await reserveForJob(a);
  let out: { result: T; actualCredits: number };
  try {
    out = await exec();
  } catch (err) {
    await releaseJob({ client: a.client, tenantId: a.tenantId, jobId: a.jobId, reservedCredits: a.estimateCredits });
    throw err;
  }
  await captureJob({ client: a.client, tenantId: a.tenantId, jobId: a.jobId, actualCredits: out.actualCredits });
  return out;
}
