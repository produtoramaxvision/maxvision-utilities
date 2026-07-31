// T4-b regression coverage: media-forge routed 4K requests to kling-v3-master
// (the only registered 4K-native provider) but the request body's derived
// `mode` collapsed 'master' into 'pro', so Kling delivered 1080P while the
// job was billed at the 4K rate. Per Kling's docs (api/video/2-6), `mode` is a
// three-value enum: std=720P, pro=1080P, 4k=4K.
//
// Every pre-existing Kling test asserts routing (video-route-handler) or the
// registry (models-registry) — none assert the actual `mode` value that hits
// the wire. This file closes that gap by asserting on the parsed JSON body
// handed to the injected fetch mock, matching the pattern already used in
// tests/video/providers/kling.test.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KlingProvider } from '../../../src/video/providers/kling.js';
import { __resetKlingJwtCache } from '../../../src/video/providers/auth/kling-jwt.js';
import { closeDb } from '../../../src/core/db.js';

describe('KlingProvider — klingMode derivation (T4-b)', () => {
  let tmpDir: string;
  let dbPath: string;
  const env = {
    KLING_ACCESS_KEY: 'ak_test',
    KLING_SECRET_KEY: 'sk_test',
  } as const;

  beforeEach(() => {
    __resetKlingJwtCache();
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-kling-mode-test-'));
    dbPath = join(tmpDir, 'cost.db');
  });

  afterEach(() => {
    try {
      closeDb(dbPath);
    } catch {
      /* ignore — handle may have been closed already */
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* tempdir may already be gone on a retry; ignore Windows EPERM stragglers */
    }
    vi.restoreAllMocks();
  });

  it('kling-v3-master sends mode: "4k" in the actual request body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { task_id: 'kling-master-4k-1' } }),
    });
    const p = new KlingProvider({ dbPath, env, fetchImpl });
    await p.generate({
      modelId: 'kling-v3-master',
      mode: 't2v',
      prompt: 'aerial drone shot over mountains',
      durationSec: 5,
      resolution: '4k',
      aspectRatio: '16:9',
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.mode).toBe('4k');
  });

  it('kling-v3-pro still sends mode: "pro" in the actual request body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { task_id: 'kling-pro-1' } }),
    });
    const p = new KlingProvider({ dbPath, env, fetchImpl });
    await p.generate({
      modelId: 'kling-v3-pro',
      mode: 't2v',
      prompt: 'city skyline at dusk',
      durationSec: 5,
      resolution: '1080p',
      aspectRatio: '16:9',
    });
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.mode).toBe('pro');
  });

  it('kling-v3-standard still sends mode: "std" in the actual request body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { task_id: 'kling-std-1' } }),
    });
    const p = new KlingProvider({ dbPath, env, fetchImpl });
    await p.generate({
      modelId: 'kling-v3-standard',
      mode: 't2v',
      prompt: 'a peaceful lake at dawn',
      durationSec: 5,
      resolution: '720p',
      aspectRatio: '16:9',
    });
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.mode).toBe('std');
  });

  it('an explicit extras.klingMode overrides the derived value even for kling-v3-master', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { task_id: 'kling-master-override-1' } }),
    });
    const p = new KlingProvider({ dbPath, env, fetchImpl });
    await p.generate({
      modelId: 'kling-v3-master',
      mode: 't2v',
      prompt: 'downgraded output on purpose',
      durationSec: 5,
      resolution: '4k',
      aspectRatio: '16:9',
      extras: {
        providerKind: 'kling',
        klingMode: 'std',
      },
    });
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.mode).toBe('std');
  });
});
