// src/billing/credit-client.ts
// Cliente HTTP media-forge → credit-core. Idempotência é responsabilidade do
// caller (externalId determinístico por reserva); o client só repassa + retenta
// erros transitórios (5xx / rede). 402 (saldo insuficiente) é determinístico:
// NUNCA retenta. ON CONFLICT no credit-core torna o replay seguro mesmo em retry.

export interface CreditClientOpts {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  retry?: { retries: number; baseDelayMs: number };
}

export interface ReserveArgs {
  tenantId: string; amount: number; reservationId: string; ttlAt: string; externalId: string; statusUrl?: string;
}
export interface SettleArgs {
  tenantId: string; reservationId: string; amount: number; externalId: string;
}
export interface GrantArgs {
  tenantId: string; amount: number; externalId: string;
}

export class InsufficientCreditError extends Error {
  constructor(public tenantId: string, public amount: number) {
    super(`insufficient credit: tenant=${tenantId} needs ${amount}`);
    this.name = 'InsufficientCreditError';
  }
}
export class CreditServiceError extends Error {
  constructor(public status: number, body: string) {
    super(`credit-core ${status}: ${body.slice(0, 200)}`);
    this.name = 'CreditServiceError';
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class CreditClient {
  private fetchImpl: typeof fetch;
  private retries: number;
  private baseDelayMs: number;

  constructor(private opts: CreditClientOpts) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.retries = opts.retry?.retries ?? 3;
    this.baseDelayMs = opts.retry?.baseDelayMs ?? 200;
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.opts.apiKey}`, 'content-type': 'application/json' };
  }

  /** POST com retry-on-5xx. 402 lança InsufficientCreditError SEM retentar. */
  private async post(path: string, body: unknown): Promise<unknown> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const res = await this.fetchImpl(`${this.opts.baseUrl}${path}`, {
        method: 'POST', headers: this.headers(), body: JSON.stringify(body),
      });
      if (res.status === 402) throw new InsufficientCreditError((body as { tenantId: string }).tenantId, (body as { amount: number }).amount);
      if (res.ok) return res.json().catch(() => ({}));
      if (res.status >= 500 && attempt < this.retries) {
        lastErr = new CreditServiceError(res.status, await res.text().catch(() => ''));
        await sleep(this.baseDelayMs * 2 ** attempt);
        continue;
      }
      throw new CreditServiceError(res.status, await res.text().catch(() => ''));
    }
    throw lastErr ?? new CreditServiceError(0, 'retry exhausted');
  }

  async balance(tenantId: string): Promise<number> {
    const res = await this.fetchImpl(`${this.opts.baseUrl}/balance/${encodeURIComponent(tenantId)}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new CreditServiceError(res.status, await res.text().catch(() => ''));
    const j = (await res.json()) as { balance: number };
    return j.balance;
  }

  async reserve(a: ReserveArgs): Promise<void> { await this.post('/reserve', a); }
  async capture(a: SettleArgs): Promise<void> { await this.post('/capture', a); }
  async release(a: SettleArgs): Promise<void> { await this.post('/release', a); }
  async grant(a: GrantArgs): Promise<void> { await this.post('/grant', a); }
}
