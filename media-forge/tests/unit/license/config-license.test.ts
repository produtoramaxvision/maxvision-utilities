import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../../src/core/config.js';

describe('loadConfig — license fields (F-F)', () => {
  it('default: license check desabilitado', () => {
    const c = loadConfig({} as NodeJS.ProcessEnv);
    expect(c.licenseCheckEnabled).toBe(false);
    expect(c.licenseServerUrl).toBeUndefined();
    expect(c.licenseKey).toBeUndefined();
    expect(c.licenseRevalidateMs).toBe(3_600_000); // 1h default
    expect(c.licenseGraceMs).toBe(259_200_000);     // 72h default
  });

  it('self-host: lê as 3 envs + instanceId', () => {
    const c = loadConfig({
      LICENSE_CHECK_ENABLED: 'true',
      MAXVISION_LICENSE_SERVER_URL: 'https://lic.example/validate',
      MEDIA_FORGE_LICENSE_KEY: 'MFK-abc123',
      MEDIA_FORGE_LICENSE_INSTANCE_ID: 'agency-001',
    } as NodeJS.ProcessEnv);
    expect(c.licenseCheckEnabled).toBe(true);
    expect(c.licenseServerUrl).toBe('https://lic.example/validate');
    expect(c.licenseKey).toBe('MFK-abc123');
    expect(c.licenseInstanceId).toBe('agency-001');
  });
});
