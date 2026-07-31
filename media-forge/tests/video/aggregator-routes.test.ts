// tests/video/aggregator-routes.test.ts
// Covers src/video/aggregator-routes.ts — the map of models reachable through
// more than one provider, and the guarantee that the router reports the second
// path instead of silently picking one.
import { describe, it, expect } from 'vitest';
import {
  RESOLD_VIDEO_MODELS,
  alternatePathsFor,
  describeAlternatePaths,
  AGGREGATOR_RATES_MEASURED_ON,
} from '../../src/video/aggregator-routes.js';
import { VIDEO_MODELS } from '../../src/core/models.js';

describe('RESOLD_VIDEO_MODELS', () => {
  // The map is keyed by the DIRECT path's model id. A key naming no registered
  // model is a relation to nothing — it would never match a routing decision and
  // nothing would ever notice, so the invariant has to be a test.
  it('every key names a model that exists in the registry', () => {
    for (const modelId of Object.keys(RESOLD_VIDEO_MODELS)) {
      expect(VIDEO_MODELS, `${modelId} is not a registered model`).toHaveProperty(modelId);
    }
  });

  // Recording a resolution the direct model cannot produce would offer the
  // caller a comparison between two different things.
  it('every measured resolution is one the direct model actually offers', () => {
    for (const [modelId, paths] of Object.entries(RESOLD_VIDEO_MODELS)) {
      const spec = VIDEO_MODELS[modelId]!;
      const offered = spec.resolutions as readonly string[] | undefined;
      if (offered === undefined || offered.length === 0) continue;
      for (const path of paths) {
        for (const resolution of Object.keys(path.creditsPerSecond)) {
          if (resolution === 'default') continue;
          expect(offered, `${modelId} does not offer ${resolution}`).toContain(resolution);
        }
      }
    }
  });

  it('prices are positive — a zero would read as free rather than unmeasured', () => {
    for (const paths of Object.values(RESOLD_VIDEO_MODELS)) {
      for (const path of paths) {
        for (const perSecond of Object.values(path.creditsPerSecond)) {
          expect(perSecond).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('alternatePathsFor', () => {
  it('kling-3.0-turbo at 720p for 5s: 7.5 credits via higgsfield, the measured figure', () => {
    const paths = alternatePathsFor({
      modelId: 'kling-3.0-turbo',
      durationSec: 5,
      resolution: '720p',
    });
    expect(paths).toEqual([
      {
        provider: 'higgsfield',
        jobType: 'kling3_0_turbo',
        credits: 7.5,
        measuredOn: AGGREGATOR_RATES_MEASURED_ON,
      },
    ]);
  });

  it('kling-3.0-turbo at 1080p costs more credits than at 720p', () => {
    const at720 = alternatePathsFor({ modelId: 'kling-3.0-turbo', durationSec: 5, resolution: '720p' });
    const at1080 = alternatePathsFor({ modelId: 'kling-3.0-turbo', durationSec: 5, resolution: '1080p' });
    expect(at1080[0]!.credits).toBeGreaterThan(at720[0]!.credits);
  });

  it('a model with no measured alternate returns empty, not a guess', () => {
    expect(alternatePathsFor({ modelId: 'veo-3.1-pro', durationSec: 8, resolution: '720p' })).toEqual([]);
  });

  // The important negative. seedance-2.0-fast has no 1080p price because the
  // provider refuses 1080p for it. Falling back to the 720p figure would report
  // a number for a configuration that cannot exist.
  it('an unmeasured resolution returns empty rather than falling back to another one', () => {
    expect(
      alternatePathsFor({ modelId: 'seedance-2.0-fast', durationSec: 5, resolution: '1080p' }),
    ).toEqual([]);
    // ...while a measured one on the same model still answers.
    expect(
      alternatePathsFor({ modelId: 'seedance-2.0-fast', durationSec: 5, resolution: '720p' }),
    ).toHaveLength(1);
  });

  it('`default` covers models whose price does not vary by resolution', () => {
    const std = alternatePathsFor({ modelId: 'kling-v3-standard', durationSec: 10, resolution: '1080p' });
    expect(std[0]!.credits).toBe(20);
  });
});

describe('describeAlternatePaths', () => {
  it('empty in, empty out — no dangling sentence on the rationale', () => {
    expect(describeAlternatePaths([])).toBe('');
  });

  // The whole risk of showing a credit figure next to a USD figure is that a
  // reader compares them. The text has to refuse the comparison explicitly.
  it('names the unit and refuses to call either path cheaper', () => {
    const text = describeAlternatePaths(
      alternatePathsFor({ modelId: 'kling-3.0-turbo', durationSec: 5, resolution: '720p' }),
    );
    expect(text).toContain('higgsfield');
    expect(text).toContain('7.5 credits');
    expect(text).toContain('NOT converted to USD');
  });
});
