import * as fs from 'node:fs';
import * as path from 'node:path';

export interface CostEstimate {
  usd: number;
  breakdown: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface CostWithRetries extends CostEstimate {
  baseUsd: number;
  maxTotalUsd: number;
  retryMultiplier: number;
}

export interface EstimateImageOpts {
  model: 'gemini-3-pro-image-preview' | 'imagen-4.0-ultra-generate-001';
  imageSize?: '1K' | '2K' | '4K';
  numberOfImages?: number;
}

export interface EstimateVideoOpts {
  model: 'veo-3.1-generate-preview';
  resolution?: '720p' | '1080p' | '4k';
  durationSeconds?: 4 | 6 | 8;
  generateAudio?: boolean;
}

// Pricing reference: research/2026-05-21-research-summary.md §1
const NANO_BANANA_PRO_PRICE: Record<'1K' | '2K' | '4K', number> = {
  '1K': 0.134,
  '2K': 0.134,
  '4K': 0.24,
};

const IMAGEN_4_ULTRA_PRICE = 0.06; // per image

// Veo 3.1 Pro pricing
const VEO_PRICE: Record<'720p' | '1080p' | '4k', { withAudio: number; videoOnly: number }> = {
  '720p': { withAudio: 0.4, videoOnly: 0.2 },
  '1080p': { withAudio: 0.4, videoOnly: 0.2 },
  '4k': { withAudio: 0.6, videoOnly: 0.4 },
};

export function estimateImageCost(opts: EstimateImageOpts): CostEstimate {
  if (opts.model === 'gemini-3-pro-image-preview') {
    const size = opts.imageSize ?? '4K';
    const usd = NANO_BANANA_PRO_PRICE[size];
    return {
      usd,
      breakdown: `Nano Banana Pro ${size}: $${usd.toFixed(3)}/image`,
      confidence: 'high',
    };
  }
  // Imagen 4 Ultra
  const count = opts.numberOfImages ?? 1;
  const usd = IMAGEN_4_ULTRA_PRICE * count;
  return {
    usd,
    breakdown: `Imagen 4 Ultra × ${count}: $${usd.toFixed(3)}`,
    confidence: 'high',
  };
}

export function estimateVideoCost(opts: EstimateVideoOpts): CostEstimate {
  const resolution = opts.resolution ?? '720p';
  const withAudio = opts.generateAudio ?? true;
  const tier = VEO_PRICE[resolution];
  const usd = withAudio ? tier.withAudio : tier.videoOnly;
  return {
    usd,
    breakdown: `Veo 3.1 Pro ${resolution} ${withAudio ? 'with audio' : 'video only'}: $${usd.toFixed(2)}`,
    confidence: 'high',
  };
}

export function estimateWithRetries(base: CostEstimate, multiplier: number): CostWithRetries {
  const maxTotalUsd = base.usd * multiplier;
  return {
    ...base,
    baseUsd: base.usd,
    maxTotalUsd,
    retryMultiplier: multiplier,
    breakdown: `${base.breakdown} (max ${multiplier}x retries = $${maxTotalUsd.toFixed(3)})`,
  };
}

export interface DailyTotalOpts {
  logPath: string;
  date?: string; // YYYY-MM-DD, defaults to today UTC
}

export function dailyTotal(opts: DailyTotalOpts): { usd: number; entries: number } {
  const target = opts.date ?? new Date().toISOString().slice(0, 10);
  if (!fs.existsSync(opts.logPath)) return { usd: 0, entries: 0 };
  const lines = fs.readFileSync(opts.logPath, 'utf8').split('\n').filter((l) => l.trim() !== '');
  let usd = 0;
  let entries = 0;
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as { date?: string; usd?: number };
      if (obj.date === target && typeof obj.usd === 'number') {
        usd += obj.usd;
        entries++;
      }
    } catch {
      // skip malformed lines
    }
  }
  return { usd, entries };
}

export function appendCostLogEntry(
  logPath: string,
  entry: { ts?: string; date?: string; usd: number; model: string; breakdown: string },
): void {
  const dir = path.dirname(logPath);
  fs.mkdirSync(dir, { recursive: true });
  const full = {
    ts: entry.ts ?? new Date().toISOString(),
    date: entry.date ?? new Date().toISOString().slice(0, 10),
    model: entry.model,
    usd: entry.usd,
    breakdown: entry.breakdown,
  };
  fs.appendFileSync(logPath, JSON.stringify(full) + '\n');
}
