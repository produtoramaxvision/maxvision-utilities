import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  estimateImageCost,
  estimateVideoCost,
  estimateWithRetries,
  estimateRefsCost,
  dailyTotal,
  appendCostLogEntry,
} from '../../../src/core/cost.js';

describe('estimateImageCost', () => {
  it('Nano Banana Pro 4K = $0.24', () => {
    const e = estimateImageCost({ model: 'gemini-3-pro-image-preview', imageSize: '4K' });
    expect(e.usd).toBe(0.24);
    expect(e.confidence).toBe('high');
    expect(e.breakdown).toMatch(/Nano Banana Pro 4K/);
  });

  it('Nano Banana Pro 2K = $0.134', () => {
    expect(estimateImageCost({ model: 'gemini-3-pro-image-preview', imageSize: '2K' }).usd).toBe(
      0.134,
    );
  });

  it('Nano Banana Pro 1K = $0.134', () => {
    expect(estimateImageCost({ model: 'gemini-3-pro-image-preview', imageSize: '1K' }).usd).toBe(
      0.134,
    );
  });

  it('Nano Banana Pro defaults to 4K', () => {
    expect(estimateImageCost({ model: 'gemini-3-pro-image-preview' }).usd).toBe(0.24);
  });

  it('Imagen 4 Ultra single = $0.06', () => {
    expect(estimateImageCost({ model: 'imagen-4.0-ultra-generate-001' }).usd).toBe(0.06);
  });

  it('Imagen 4 Ultra × 4 = $0.24', () => {
    expect(
      estimateImageCost({ model: 'imagen-4.0-ultra-generate-001', numberOfImages: 4 }).usd,
    ).toBeCloseTo(0.24, 5);
  });
});

describe('estimateVideoCost', () => {
  it('Veo 720p with audio = $0.40', () => {
    expect(estimateVideoCost({ model: 'veo-3.1-generate-preview', resolution: '720p' }).usd).toBe(
      0.4,
    );
  });

  it('Veo 720p video-only = $0.20', () => {
    expect(
      estimateVideoCost({
        model: 'veo-3.1-generate-preview',
        resolution: '720p',
        generateAudio: false,
      }).usd,
    ).toBe(0.2);
  });

  it('Veo 4k with audio = $0.60', () => {
    expect(estimateVideoCost({ model: 'veo-3.1-generate-preview', resolution: '4k' }).usd).toBe(
      0.6,
    );
  });

  it('Veo 4k video-only = $0.40', () => {
    expect(
      estimateVideoCost({
        model: 'veo-3.1-generate-preview',
        resolution: '4k',
        generateAudio: false,
      }).usd,
    ).toBe(0.4);
  });

  it('defaults to 720p with audio', () => {
    expect(estimateVideoCost({ model: 'veo-3.1-generate-preview' }).usd).toBe(0.4);
  });
});

describe('estimateWithRetries (C4 fix — retry budget visible)', () => {
  it('multiplies base cost', () => {
    const base = { usd: 0.24, breakdown: 'foo', confidence: 'high' as const };
    const r = estimateWithRetries(base, 3);
    expect(r.baseUsd).toBe(0.24);
    expect(r.maxTotalUsd).toBeCloseTo(0.72, 5);
    expect(r.retryMultiplier).toBe(3);
    expect(r.breakdown).toContain('max 3x retries');
  });
});

describe('estimateRefsCost (R6)', () => {
  it('MOODBOARD mode returns non-zero moodboardComposeUsd', () => {
    const est = estimateRefsCost({ mode: 'MOODBOARD', refCount: 5, subjectCount: 1, outputSize: '2048' });
    expect(est.mode).toBe('MOODBOARD');
    expect(est.moodboardComposeUsd).toBeGreaterThan(0);
    expect(est.refsLookupUsd).toBe(0); // tag mode, no voyage query
    expect(est.totalUsd).toBeCloseTo(est.refsLookupUsd + est.moodboardComposeUsd, 5);
  });

  it('TEXT_ONLY mode returns zero compose cost', () => {
    const est = estimateRefsCost({ mode: 'TEXT_ONLY', refCount: 0, subjectCount: 0, outputSize: '2048' });
    expect(est.moodboardComposeUsd).toBe(0);
    expect(est.totalUsd).toBe(0);
  });

  it('semantic search mode adds voyage query cost', () => {
    const est = estimateRefsCost({ mode: 'TEXT_ONLY', refCount: 0, subjectCount: 0, outputSize: '2048', searchMode: 'semantic' });
    expect(est.refsLookupUsd).toBeGreaterThan(0);
  });

  it('4096 output size costs more than 2048', () => {
    const est2k = estimateRefsCost({ mode: 'MOODBOARD', refCount: 3, subjectCount: 1, outputSize: '2048' });
    const est4k = estimateRefsCost({ mode: 'MOODBOARD', refCount: 3, subjectCount: 1, outputSize: '4096' });
    expect(est4k.moodboardComposeUsd).toBeGreaterThan(est2k.moodboardComposeUsd);
  });
});

describe('dailyTotal + appendCostLogEntry', () => {
  let tmpDir: string;
  let logPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-test-'));
    logPath = path.join(tmpDir, 'cost-log.jsonl');
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns {0, 0} when log missing', () => {
    expect(dailyTotal({ logPath })).toEqual({ usd: 0, entries: 0 });
  });

  it('aggregates entries by date', () => {
    appendCostLogEntry(logPath, { date: '2026-05-22', usd: 0.24, model: 'nano', breakdown: 'x' });
    appendCostLogEntry(logPath, { date: '2026-05-22', usd: 0.4, model: 'veo', breakdown: 'y' });
    appendCostLogEntry(logPath, { date: '2026-05-21', usd: 1.0, model: 'old', breakdown: 'z' });
    const r22 = dailyTotal({ logPath, date: '2026-05-22' });
    expect(r22.entries).toBe(2);
    expect(r22.usd).toBeCloseTo(0.64, 5);
    expect(dailyTotal({ logPath, date: '2026-05-21' })).toEqual({ usd: 1.0, entries: 1 });
  });

  it('skips malformed lines gracefully', () => {
    fs.writeFileSync(logPath, 'not json\n{"date":"2026-05-22","usd":0.5}\n{}\n');
    expect(dailyTotal({ logPath, date: '2026-05-22' })).toEqual({ usd: 0.5, entries: 1 });
  });

  it('creates parent dirs on append', () => {
    const deep = path.join(tmpDir, 'a', 'b', 'log.jsonl');
    appendCostLogEntry(deep, { usd: 0.1, model: 'x', breakdown: 'y' });
    expect(fs.existsSync(deep)).toBe(true);
  });
});
