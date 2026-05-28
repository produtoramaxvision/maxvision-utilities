/**
 * Seedance 2.0 live E2E test — real fal.ai API calls.
 *
 * GATED: ALL tests skip when MEDIA_FORGE_RUN_LIVE_TESTS != 'true'.
 * An inner guard skips individual tests when FAL_KEY is absent.
 *
 * Run with:
 *   FAL_KEY=<real_key> MEDIA_FORGE_RUN_LIVE_TESTS=true pnpm vitest run tests/integration/seedance-live.test.ts
 *
 * Estimated cost per full run:
 *   T2V smoke: seedance-2.0-fast, 5s @ $0.2419/s ≈ $1.21
 *   I2V smoke: seedance-2.0-fast, 5s @ $0.2419/s ≈ $1.21
 *   R2V smoke: seedance-2.0-fast, 5s @ $0.2419/s ≈ $1.21
 *   Total:                                         ≈ $3.63
 *
 * Public test image (small, stable CDN, no copyright concerns):
 *   https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Camponotus_flavomarginatus_ant.jpg/400px-Camponotus_flavomarginatus_ant.jpg
 *   Wikimedia Commons — CC BY-SA 2.5 — macro photo of an ant. Chosen because
 *   it is perennially cached, has no Disney/celebrity copyright exposure, and
 *   its subject (an insect outdoors) is safe for Seedance motion prompting.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BytedanceSeedanceProvider,
  __resetBytedanceSeedanceSingleton,
} from '../../src/video/providers/bytedance-seedance.js';
import { getJobRecord } from '../../src/core/cost-tracker.js';
import type { JobStatus } from '../../src/video/providers/base.js';

// ---------------------------------------------------------------------------
// Gate constants
// ---------------------------------------------------------------------------

const RUN_LIVE = process.env['MEDIA_FORGE_RUN_LIVE_TESTS'] === 'true';
const HAS_FAL_KEY = Boolean(process.env['FAL_KEY']);

/**
 * Public test image: Wikimedia Commons ant macro photo.
 * Perennially cached; no IP concerns; stable URL since 2006.
 */
const PUBLIC_TEST_IMAGE_URL =
  'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Camponotus_flavomarginatus_ant.jpg/400px-Camponotus_flavomarginatus_ant.jpg';

const FAST_RATE = 0.2419; // $/sec, per models.ts 'seedance-2.0-fast'
const TEST_DURATION_SEC = 5;
const EXPECTED_COST = FAST_RATE * TEST_DURATION_SEC; // ≈ $1.21

/** Poll until completed/failed or 5-minute wall clock deadline. */
async function pollUntilDone(
  provider: BytedanceSeedanceProvider,
  jobId: string,
): Promise<JobStatus> {
  const deadline = Date.now() + 5 * 60_000;
  let status = await provider.pollStatus(jobId);
  while (status.state === 'pending' || status.state === 'in_progress') {
    if (Date.now() > deadline) throw new Error('live poll timeout: 5 min exceeded');
    await new Promise((r) => setTimeout(r, 5_000));
    status = await provider.pollStatus(jobId);
  }
  return status;
}

// ---------------------------------------------------------------------------
// Outer gate: entire describe block skipped unless MEDIA_FORGE_RUN_LIVE_TESTS=true
// ---------------------------------------------------------------------------

describe.skipIf(!RUN_LIVE)(
  'Seedance LIVE E2E (gated by MEDIA_FORGE_RUN_LIVE_TESTS=true + FAL_KEY)',
  () => {
    // -----------------------------------------------------------------------
    // T2V smoke — base text-to-video, Fast tier, 5s 720p
    // -----------------------------------------------------------------------
    it.skipIf(!HAS_FAL_KEY)(
      'T2V smoke: seedance-2.0-fast 5s 720p returns video URL + records cost',
      async () => {
        __resetBytedanceSeedanceSingleton();
        const tmpDir = mkdtempSync(join(tmpdir(), 'mf-seedance-t2v-live-'));
        const dbPath = join(tmpDir, 'cost.db');

        try {
          const provider = new BytedanceSeedanceProvider({ dbPath });

          const handle = await provider.generate({
            modelId: 'seedance-2.0-fast',
            mode: 't2v',
            prompt:
              'A calm wave on a quiet beach at sunset, gentle slow motion, ' +
              'natural golden light, wide-angle, no people',
            durationSec: TEST_DURATION_SEC,
            resolution: '720p',
          });

          expect(handle.jobId).toBeTruthy();
          expect(handle.providerNativeId).toBeTruthy();
          expect(handle.provider).toBe('bytedance');

          const status = await pollUntilDone(provider, handle.jobId);

          expect(status.state).toBe('completed');
          expect(status.assetUrls?.[0]).toMatch(/^https?:\/\//);

          // Cost invariant: Fast rate × duration_seconds, persisted by pollStatus
          // recordActualCost is called atomically inside pollStatus on transition to 'completed'.
          // FIX (Codex P2 round 5, PR#12): JobRecord field is `actualUsd`, not raw `actual_usd`.
          const row = getJobRecord({ dbPath, jobId: handle.jobId });
          expect(row?.actualUsd).not.toBeNull();
          // Tolerate ±10% drift in case fal.ai rounds differently
          expect(row!.actualUsd).toBeGreaterThan(EXPECTED_COST * 0.9);
          expect(row!.actualUsd).toBeLessThan(EXPECTED_COST * 1.1);
        } finally {
          rmSync(tmpDir, { recursive: true, force: true });
        }
      },
      5 * 60_000 + 30_000, // 5 min poll + 30s buffer
    );

    // -----------------------------------------------------------------------
    // I2V smoke — image-to-video, Fast tier, 5s 720p
    // -----------------------------------------------------------------------
    it.skipIf(!HAS_FAL_KEY)(
      'I2V smoke: seedance-2.0-fast i2v with public image returns video URL',
      async () => {
        __resetBytedanceSeedanceSingleton();
        const tmpDir = mkdtempSync(join(tmpdir(), 'mf-seedance-i2v-live-'));
        const dbPath = join(tmpDir, 'cost.db');

        try {
          const provider = new BytedanceSeedanceProvider({ dbPath });

          // I2V: pass imageUrl via firstFrameImagePath (provider reads it in buildFalInput)
          const handle = await provider.generate({
            modelId: 'seedance-2.0-fast',
            mode: 'i2v',
            prompt: 'the ant slowly walks across the leaf, macro, smooth motion',
            durationSec: TEST_DURATION_SEC,
            resolution: '720p',
            firstFrameImagePath: PUBLIC_TEST_IMAGE_URL,
          });

          expect(handle.jobId).toBeTruthy();
          expect(handle.providerNativeId).toBeTruthy();

          const status = await pollUntilDone(provider, handle.jobId);

          expect(status.state).toBe('completed');
          expect(status.assetUrls?.[0]).toMatch(/^https?:\/\//);
        } finally {
          rmSync(tmpDir, { recursive: true, force: true });
        }
      },
      5 * 60_000 + 30_000,
    );

    // -----------------------------------------------------------------------
    // R2V smoke — reference-to-video, Fast tier, 5s 720p, @Image1 mention
    // -----------------------------------------------------------------------
    it.skipIf(!HAS_FAL_KEY)(
      'R2V smoke: seedance-2.0-fast with-refs + @Image1 mention returns video URL',
      async () => {
        __resetBytedanceSeedanceSingleton();
        const tmpDir = mkdtempSync(join(tmpdir(), 'mf-seedance-r2v-live-'));
        const dbPath = join(tmpDir, 'cost.db');

        try {
          const provider = new BytedanceSeedanceProvider({ dbPath });

          // R2V (with-refs): reference images passed via extras.referenceImageUrls;
          // prompt uses @Image1 @-mention syntax per Seedance r2v spec (A0.6).
          const handle = await provider.generate({
            modelId: 'seedance-2.0-fast',
            mode: 'with-refs',
            prompt:
              '@Image1 the insect moves slowly under a leaf, macro, 5 seconds, smooth camera',
            durationSec: TEST_DURATION_SEC,
            resolution: '720p',
            extras: {
              providerKind: 'bytedance',
              referenceImageUrls: [PUBLIC_TEST_IMAGE_URL],
            },
          });

          expect(handle.jobId).toBeTruthy();
          expect(handle.providerNativeId).toBeTruthy();

          const status = await pollUntilDone(provider, handle.jobId);

          expect(status.state).toBe('completed');
          expect(status.assetUrls?.[0]).toMatch(/^https?:\/\//);
        } finally {
          rmSync(tmpDir, { recursive: true, force: true });
        }
      },
      5 * 60_000 + 30_000,
    );
  },
);
