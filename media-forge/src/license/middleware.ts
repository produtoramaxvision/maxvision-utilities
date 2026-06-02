// src/license/middleware.ts
import type { MiddlewareHandler } from 'hono';
import type { LicenseState } from './types.js';

export interface LicenseGateDeps {
  getState: () => LicenseState;
}

/** Hono middleware: 403 quando a licença não está válida. Leitura síncrona do cache. */
export function licenseGate(deps: LicenseGateDeps): MiddlewareHandler {
  return async (c, next) => {
    const state = deps.getState();
    if (!state.allowed) {
      return c.json({ error: 'license_invalid', reason: state.reason }, 403);
    }
    await next();
  };
}
