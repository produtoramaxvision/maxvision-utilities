// credit-core/src/service.ts
import { Store } from './store.js';
import { availableBalance } from './accounting.js';

export class CreditService {
  constructor(private store: Store) {}

  async grant(a: { tenantId: string; amount: number; externalId: string }): Promise<void> {
    await this.store.append({ ...a, kind: 'grant', externalId: a.externalId });
  }
  async balance(tenantId: string): Promise<number> {
    return availableBalance(await this.store.entriesFor(tenantId));
  }
  async reserve(a: { tenantId: string; amount: number; reservationId: string; ttlAt: string; externalId: string }): Promise<void> {
    await this.store.reserveAtomic(a);
  }
  async capture(a: { tenantId: string; reservationId: string; amount: number; externalId: string }): Promise<void> {
    await this.store.append({ tenantId: a.tenantId, kind: 'capture', amount: a.amount, reservationId: a.reservationId, externalId: a.externalId });
  }
  async release(a: { tenantId: string; reservationId: string; amount: number; externalId: string }): Promise<void> {
    await this.store.append({ tenantId: a.tenantId, kind: 'release', amount: a.amount, reservationId: a.reservationId, externalId: a.externalId });
  }
}
