// credit-core/src/store.ts
import { Pool } from 'pg';
import { availableBalance, type LedgerEntry } from './accounting.js';
import type { ReserveEntry } from './reservations.js';

/** Postgres SQLSTATE codes that are safe to retry: serialization failure + deadlock. */
const RETRYABLE_SQLSTATES = new Set(['40001', '40P01']);

function isRetryablePgError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code?: unknown }).code === 'string' &&
    RETRYABLE_SQLSTATES.has((err as { code: string }).code)
  );
}

export class Store {
  constructor(private pool: Pool) {}

  async entriesFor(tenantId: string): Promise<LedgerEntry[]> {
    const r = await this.pool.query(
      'SELECT id, tenant_id, kind, amount, reservation_id, created_at FROM ledger_entries WHERE tenant_id=$1 ORDER BY id',
      [tenantId],
    );
    return r.rows.map((x) => ({
      id: String(x.id), tenantId: x.tenant_id, kind: x.kind,
      amount: Number(x.amount), reservationId: x.reservation_id, createdAt: x.created_at.toISOString(),
    }));
  }

  /** Igual a entriesFor, mas inclui ttl_at (mapeado como ttlAt) — usado pelo sweep. */
  async entriesForWithTtl(tenantId: string): Promise<ReserveEntry[]> {
    const r = await this.pool.query(
      'SELECT id, tenant_id, kind, amount, reservation_id, ttl_at, created_at FROM ledger_entries WHERE tenant_id=$1 ORDER BY id',
      [tenantId],
    );
    return r.rows.map((x) => ({
      id: String(x.id), tenantId: x.tenant_id, kind: x.kind,
      amount: Number(x.amount), reservationId: x.reservation_id,
      ttlAt: x.ttl_at ? x.ttl_at.toISOString() : null,
      createdAt: x.created_at.toISOString(),
    }));
  }

  /** Append idempotente: retorna a linha existente se external_id já visto. */
  async append(e: { tenantId: string; kind: LedgerEntry['kind']; amount: number; reservationId?: string | null; ttlAt?: string | null; statusUrl?: string | null; externalId: string }): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO ledger_entries (tenant_id, kind, amount, reservation_id, ttl_at, status_url, external_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (kind, external_id) DO NOTHING`,
        [e.tenantId, e.kind, e.amount, e.reservationId ?? null, e.ttlAt ?? null, e.statusUrl ?? null, e.externalId],
      );
    } catch (err) {
      const code = typeof err === 'object' && err !== null ? (err as { code?: string }).code : undefined;
      // 23505 = unique_violation (first-settle-wins partial index): swallow as no-op.
      if (code === '23505') return;
      // 42703 = undefined_column (status_url not yet in schema): retry without it.
      if (code === '42703') {
        await this.pool.query(
          `INSERT INTO ledger_entries (tenant_id, kind, amount, reservation_id, ttl_at, external_id)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (kind, external_id) DO NOTHING`,
          [e.tenantId, e.kind, e.amount, e.reservationId ?? null, e.ttlAt ?? null, e.externalId],
        );
        return;
      }
      throw err;
    }
  }

  /**
   * Reserve atômico: SERIALIZABLE + checagem de saldo. Lança InsufficientBalanceError se insuficiente.
   * Reservas concorrentes que abortam por serialization_failure (40001) ou deadlock (40P01) são
   * reexecutadas até 3 vezes — o erro de saldo insuficiente NUNCA é reexecutado.
   */
  async reserveAtomic(args: { tenantId: string; amount: number; reservationId: string; ttlAt: string; externalId: string }): Promise<void> {
    const maxAttempts = 3;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.runReserveTxn(args);
        return;
      } catch (err) {
        lastErr = err;
        if (isRetryablePgError(err) && attempt < maxAttempts) continue;
        throw err;
      }
    }
    throw lastErr;
  }

  private async runReserveTxn(args: { tenantId: string; amount: number; reservationId: string; ttlAt: string; externalId: string }): Promise<void> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const r = await c.query('SELECT kind, amount, reservation_id FROM ledger_entries WHERE tenant_id=$1', [args.tenantId]);
      const entries: LedgerEntry[] = r.rows.map((x) => ({ id: '', tenantId: args.tenantId, kind: x.kind, amount: Number(x.amount), reservationId: x.reservation_id, createdAt: '' }));
      if (availableBalance(entries) < args.amount) {
        await c.query('ROLLBACK');
        throw new InsufficientBalanceError(args.tenantId, args.amount);
      }
      await c.query(
        `INSERT INTO ledger_entries (tenant_id, kind, amount, reservation_id, ttl_at, external_id)
         VALUES ($1,'reserve',$2,$3,$4,$5) ON CONFLICT (kind, external_id) DO NOTHING`,
        [args.tenantId, args.amount, args.reservationId, args.ttlAt, args.externalId],
      );
      await c.query('COMMIT');
    } catch (err) {
      await c.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      c.release();
    }
  }
}

export class InsufficientBalanceError extends Error {
  constructor(tenantId: string, amount: number) {
    super(`insufficient balance: tenant=${tenantId} needs ${amount}`);
    this.name = 'InsufficientBalanceError';
  }
}
