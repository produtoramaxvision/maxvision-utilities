import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import { extractPalette } from '../image/extract-palette.js';
import { readBase64 } from '../utils/files.js';
import { ValidationError, ApiError } from '../core/errors.js';
import { logger } from '../core/logger.js';

// ---------------------------------------------------------------------------
// Brand guidelines schema
// ---------------------------------------------------------------------------

const BrandGuidelinesSchema = z.object({
  colors: z.record(z.string(), z.string().regex(/^#[0-9A-Fa-f]{6}$/)).optional(),
  logo: z.object({
    referenceImage: z.string(),
    /**
     * Brand name as Cloud Vision logoDetection would report it (e.g. 'Nike',
     * 'Google'). When set, the check requires AT LEAST one detected logo
     * with matching description above minConfidence. When omitted, the
     * referenceImage filename (without extension) is used as the expected
     * name so a guideline like `referenceImage: assets/nike.png` enforces
     * identity automatically.
     */
    expectedName: z.string().optional(),
    minConfidence: z.number().min(0).max(1).default(0.8),
  }).optional(),
  fonts: z.object({
    approved: z.array(z.string()).min(1),
  }).optional(),
}).strict();

type BrandGuidelines = z.infer<typeof BrandGuidelinesSchema>;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BrandViolation {
  class: 'color' | 'logo' | 'font';
  severity: 'critical' | 'major' | 'minor';
  detail: string;
}

export interface BrandCheckResult {
  ok: boolean;
  violations: BrandViolation[];
  guidelinesFound: boolean;
}

export interface BrandCheckOpts {
  imagePath: string;
  guidelinesPath?: string;
  ocrText?: string;
  enableLogoDetection?: boolean;
  _visionClient?: ImageAnnotatorClient;
}

// ---------------------------------------------------------------------------
// CIEDE2000 color difference
// Implements Sharma, Wu, Dalal 2005 reference formula
// ---------------------------------------------------------------------------

function hexToLab(hex: string): [number, number, number] {
  // hex → sRGB [0..1]
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  // sRGB → linear RGB (inverse gamma)
  const lin = (c: number): number =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const rl = lin(r);
  const gl = lin(g);
  const bl = lin(b);

  // linear RGB → XYZ (D65 illuminant)
  const X = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
  const Y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750;
  const Z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041;

  // XYZ → Lab (D65: Xn=0.95047, Yn=1.00000, Zn=1.08883)
  const eps = 0.008856;
  const kappa = 903.3;
  const f = (t: number): number =>
    t > eps ? Math.cbrt(t) : (kappa * t + 16) / 116;

  const fx = f(X / 0.95047);
  const fy = f(Y / 1.00000);
  const fz = f(Z / 1.08883);

  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const b2 = 200 * (fy - fz);
  return [L, a, b2];
}

function ciede2000(hex1: string, hex2: string): number {
  const [L1, a1, b1] = hexToLab(hex1);
  const [L2, a2, b2] = hexToLab(hex2);

  const kL = 1, kC = 1, kH = 1;

  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const Cab = (C1 + C2) / 2;
  const Cab7 = Math.pow(Cab, 7);
  const g = 0.5 * (1 - Math.sqrt(Cab7 / (Cab7 + Math.pow(25, 7))));

  const ap1 = a1 * (1 + g);
  const ap2 = a2 * (1 + g);
  const Cp1 = Math.sqrt(ap1 * ap1 + b1 * b1);
  const Cp2 = Math.sqrt(ap2 * ap2 + b2 * b2);

  const deg = (rad: number): number => (rad * 180) / Math.PI;
  const rad = (d: number): number => (d * Math.PI) / 180;

  const hp = (b: number, ap: number): number => {
    if (b === 0 && ap === 0) return 0;
    const h = deg(Math.atan2(b, ap));
    return h >= 0 ? h : h + 360;
  };

  const hp1 = hp(b1, ap1);
  const hp2 = hp(b2, ap2);

  const dLp = L2 - L1;
  const dCp = Cp2 - Cp1;

  let dhp = 0;
  if (Cp1 * Cp2 === 0) {
    dhp = 0;
  } else if (Math.abs(hp2 - hp1) <= 180) {
    dhp = hp2 - hp1;
  } else if (hp2 - hp1 > 180) {
    dhp = hp2 - hp1 - 360;
  } else {
    dhp = hp2 - hp1 + 360;
  }

  const dHp = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(rad(dhp / 2));

  const Lpm = (L1 + L2) / 2;
  const Cpm = (Cp1 + Cp2) / 2;

  let hpm = 0;
  if (Cp1 * Cp2 === 0) {
    hpm = hp1 + hp2;
  } else if (Math.abs(hp1 - hp2) <= 180) {
    hpm = (hp1 + hp2) / 2;
  } else if (hp1 + hp2 < 360) {
    hpm = (hp1 + hp2 + 360) / 2;
  } else {
    hpm = (hp1 + hp2 - 360) / 2;
  }

  const T =
    1 -
    0.17 * Math.cos(rad(hpm - 30)) +
    0.24 * Math.cos(rad(2 * hpm)) +
    0.32 * Math.cos(rad(3 * hpm + 6)) -
    0.20 * Math.cos(rad(4 * hpm - 63));

  const SL = 1 + 0.015 * Math.pow(Lpm - 50, 2) / Math.sqrt(20 + Math.pow(Lpm - 50, 2));
  const SC = 1 + 0.045 * Cpm;
  const SH = 1 + 0.015 * Cpm * T;

  const Cpm7 = Math.pow(Cpm, 7);
  const RC = 2 * Math.sqrt(Cpm7 / (Cpm7 + Math.pow(25, 7)));
  const dtheta = 30 * Math.exp(-Math.pow((hpm - 275) / 25, 2));
  const RT = -Math.sin(rad(2 * dtheta)) * RC;

  const dE = Math.sqrt(
    Math.pow(dLp / (kL * SL), 2) +
    Math.pow(dCp / (kC * SC), 2) +
    Math.pow(dHp / (kH * SH), 2) +
    RT * (dCp / (kC * SC)) * (dHp / (kH * SH)),
  );

  return dE;
}

// ---------------------------------------------------------------------------
// Lazy vision client helper
// ---------------------------------------------------------------------------

let _lazyVisionClient: ImageAnnotatorClient | undefined;

function getVisionClient(injected?: ImageAnnotatorClient): ImageAnnotatorClient {
  if (injected) return injected;
  if (_lazyVisionClient) return _lazyVisionClient;
  // Lazy init — constructor probes GCP credentials, not the static import
  _lazyVisionClient = new ImageAnnotatorClient();
  return _lazyVisionClient;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function checkBrand(opts: BrandCheckOpts): Promise<BrandCheckResult> {
  const guidelinesPath =
    opts.guidelinesPath ?? path.join(process.cwd(), 'brand-guidelines.yml');

  // Stage 1: check if guidelines file exists
  if (!fs.existsSync(guidelinesPath)) {
    logger.debug('checkBrand: no guidelines file found', { guidelinesPath });
    return { ok: true, violations: [], guidelinesFound: false };
  }

  // Stage 2: parse and validate guidelines
  let guidelines: BrandGuidelines;
  try {
    const raw = fs.readFileSync(guidelinesPath, 'utf8');
    const parsed: unknown = parseYaml(raw);
    guidelines = BrandGuidelinesSchema.parse(parsed);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new ValidationError(
        `Invalid brand-guidelines.yml: ${err.message}`,
        { path: guidelinesPath },
      );
    }
    throw new ValidationError(
      `Failed to parse brand-guidelines.yml: ${err instanceof Error ? err.message : String(err)}`,
      { path: guidelinesPath },
    );
  }

  const violations: BrandViolation[] = [];

  // Stage 3: color check
  if (guidelines.colors && Object.keys(guidelines.colors).length > 0) {
    logger.debug('checkBrand: running color check', { imagePath: opts.imagePath });
    let palette: string[] = [];
    try {
      const result = await extractPalette({
        op: 'extract-palette',
        imagePath: opts.imagePath,
        colorCount: 8,
        format: 'hex',
        dryRun: false,
      });
      palette = result.colors;
    } catch (err) {
      logger.warn('checkBrand: extractPalette failed, skipping color check', {
        err: err instanceof Error ? err.message : String(err),
      });
    }

    if (palette.length > 0) {
      for (const [name, brandColor] of Object.entries(guidelines.colors)) {
        // Find closest palette color by CIEDE2000
        let minDelta = Infinity;
        let closestColor = '#000000';
        for (const paletteColor of palette) {
          const dE = ciede2000(brandColor, paletteColor);
          if (dE < minDelta) {
            minDelta = dE;
            closestColor = paletteColor;
          }
        }
        if (minDelta > 5) {
          violations.push({
            class: 'color',
            severity: 'major',
            detail: `brand color ${name} (${brandColor}) not present (closest palette color ${closestColor} has ΔE=${minDelta.toFixed(2)})`,
          });
        }
      }
    }
  }

  // Stage 4: logo check (only when explicitly enabled)
  if (opts.enableLogoDetection === true && guidelines.logo) {
    const { minConfidence, referenceImage, expectedName } = guidelines.logo;
    // Cloud Vision logoDetection returns a brand name string in `description`
    // ('Nike', 'Google', ...). We require BOTH a high-confidence detection
    // AND a matching name so an unrelated third-party logo cannot satisfy
    // the check. The expected name is the guideline's expectedName field
    // when set, otherwise derived from the referenceImage filename
    // (e.g. assets/nike.png → 'nike').
    const refBaseName = path.basename(referenceImage, path.extname(referenceImage));
    const expected = (expectedName ?? refBaseName).toLowerCase().trim();
    logger.debug('checkBrand: running logo detection', {
      imagePath: opts.imagePath,
      expected,
    });
    try {
      const bytes = readBase64(opts.imagePath);
      const client = getVisionClient(opts._visionClient);
      const [result] = await client.logoDetection({
        image: { content: bytes },
      });
      const logos = result?.logoAnnotations ?? [];
      const aboveConfidence = logos.filter((l) => (l.score ?? 0) >= minConfidence);
      const hasMatch = aboveConfidence.some(
        (l) => (l.description ?? '').toLowerCase().trim() === expected,
      );
      if (!hasMatch) {
        const detected = aboveConfidence
          .map((l) => l.description)
          .filter((d): d is string => Boolean(d))
          .join(', ');
        violations.push({
          class: 'logo',
          severity: 'critical',
          detail: aboveConfidence.length > 0
            ? `expected logo '${expected}' not detected (above-confidence detections: ${detected || 'unnamed'})`
            : `no logo detected above confidence threshold ${minConfidence}`,
        });
      }
    } catch (err) {
      throw new ApiError(
        `Cloud Vision logoDetection failed: ${err instanceof Error ? err.message : String(err)}`,
        'API',
        { imagePath: opts.imagePath },
      );
    }
  }

  // Stage 5: font check (low-fidelity heuristic)
  if (guidelines.fonts && opts.ocrText && opts.ocrText.trim().length > 0) {
    const ocrLower = opts.ocrText.toLowerCase();
    const hasApprovedFont = guidelines.fonts.approved.some((font) =>
      ocrLower.includes(font.toLowerCase()),
    );
    if (!hasApprovedFont) {
      violations.push({
        class: 'font',
        severity: 'minor',
        detail: `none of approved fonts [${guidelines.fonts.approved.join(', ')}] detected in OCR text (low-fidelity heuristic)`,
      });
    }
  }

  const ok = violations.length === 0;
  logger.info('checkBrand: complete', { ok, violationCount: violations.length });
  return { ok, violations, guidelinesFound: true };
}
