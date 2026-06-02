// src/license/cache.ts
import { logger } from '../core/logger.js';
import { validateLicense, type ValidateParams } from './client.js';
import type { LicenseState, LicenseStatus } from './types.js';

export interface LicenseCacheOpts {
  url: string;
  licenseKey: string;
  instanceId: string;
  revalidateMs: number;
  graceMs: number;
}
export interface LicenseCacheDeps {
  /** override para testes; default = validateLicense */
  validate?: (p: ValidateParams) => Promise<LicenseStatus>;
}

export class LicenseCache {
  private state: LicenseState;
  private lastGoodAt = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly validate: (p: ValidateParams) => Promise<LicenseStatus>;

  constructor(private opts: LicenseCacheOpts, deps: LicenseCacheDeps = {}) {
    this.validate = deps.validate ?? validateLicense;
    // fail-closed até o primeiro check
    this.state = { allowed: false, reason: 'license not yet validated', tier: null, lastCheckedAt: 0 };
  }

  getState(): LicenseState {
    return this.state;
  }

  async start(): Promise<void> {
    await this.revalidateNow();
    this.timer = setInterval(() => {
      void this.revalidateNow();
    }, this.opts.revalidateMs);
    // não segurar o event loop do processo
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Revalida (ou aplica um status injetado em teste) e recomputa o gate. */
  async revalidateNow(injected?: LicenseStatus): Promise<void> {
    const status =
      injected ??
      (await this.validate({
        url: this.opts.url,
        licenseKey: this.opts.licenseKey,
        instanceId: this.opts.instanceId,
      }));
    const now = Date.now();
    this.state = this.derive(status, now);
    logger.info('license revalidated', { status: status.status, allowed: this.state.allowed });
  }

  private derive(status: LicenseStatus, now: number): LicenseState {
    switch (status.status) {
      case 'ok':
        this.lastGoodAt = now;
        return { allowed: true, reason: 'ok', tier: status.tier, lastCheckedAt: now };
      case 'revoked':
        return { allowed: false, reason: 'license revoked', tier: null, lastCheckedAt: now };
      case 'invalid':
        return { allowed: false, reason: status.reason, tier: null, lastCheckedAt: now };
      case 'unreachable': {
        const withinGrace = this.lastGoodAt > 0 && now - this.lastGoodAt < this.opts.graceMs;
        return withinGrace
          ? { allowed: true, reason: 'grace period (server unreachable)', tier: this.state.tier, lastCheckedAt: now }
          : { allowed: false, reason: 'license server unreachable, grace expired', tier: null, lastCheckedAt: now };
      }
    }
  }
}
