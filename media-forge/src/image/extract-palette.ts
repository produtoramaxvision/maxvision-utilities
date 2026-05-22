import { Vibrant } from 'node-vibrant/node';
import type { ExtractPaletteInputT } from './image-schemas.js';
import { logger } from '../core/logger.js';

export interface PaletteResult {
  colors: string[];
  colorCount: number;
  format: 'hex' | 'rgb' | 'hsl';
  imagePath: string;
  dryRun?: boolean;
}

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r ?? 0, g ?? 0, b ?? 0];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / d + 2) / 6;
    else h = ((rn - gn) / d + 4) / 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function formatColor(hex: string, format: 'hex' | 'rgb' | 'hsl'): string {
  if (format === 'hex') return hex;
  const [r, g, b] = hexToRgb(hex);
  if (format === 'rgb') return `rgb(${r}, ${g}, ${b})`;
  const [h, s, l] = rgbToHsl(r, g, b);
  return `hsl(${h}, ${s}%, ${l}%)`;
}

export async function extractPalette(input: ExtractPaletteInputT): Promise<PaletteResult> {
  if (input.dryRun) {
    return {
      colors: [],
      colorCount: input.colorCount,
      format: input.format,
      imagePath: input.imagePath,
      dryRun: true,
    };
  }

  logger.debug('extractPalette: processing', { imagePath: input.imagePath });

  const palette = await Vibrant.from(input.imagePath)
    .maxColorCount(Math.max(input.colorCount * 4, 64))
    .getPalette();

  // Collect non-null swatches sorted by population descending
  const swatches = Object.values(palette)
    .filter((s): s is NonNullable<typeof s> => s !== null && s !== undefined)
    .sort((a, b) => b.population - a.population)
    .slice(0, input.colorCount);

  const colors = swatches.map((s) => formatColor(s.hex, input.format));

  logger.info('extractPalette: success', { colorCount: colors.length });

  return {
    colors,
    colorCount: input.colorCount,
    format: input.format,
    imagePath: input.imagePath,
  };
}
