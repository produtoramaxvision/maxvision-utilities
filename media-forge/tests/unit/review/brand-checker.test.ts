import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { ImageAnnotatorClient } from '@google-cloud/vision';
import { checkBrand } from '../../../src/review/brand-checker.js';
import { ValidationError } from '../../../src/core/errors.js';
import { TINY_PNG_BASE64 } from '../../helpers/fixtures.js';

// ---------------------------------------------------------------------------
// Mock extractPalette to avoid real image processing on 1×1 fixture
// ---------------------------------------------------------------------------

vi.mock('../../../src/image/extract-palette.js', () => ({
  extractPalette: vi.fn(async (input: { imagePath: string; colorCount: number; format: string }) => ({
    colors: [],
    colorCount: input.colorCount,
    format: input.format,
    imagePath: input.imagePath,
  })),
}));

import { extractPalette } from '../../../src/image/extract-palette.js';
const mockExtractPalette = vi.mocked(extractPalette);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): { dir: string; imgPath: string; guidelinesPath: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-test-'));
  const imgPath = path.join(dir, 'asset.png');
  fs.writeFileSync(imgPath, Buffer.from(TINY_PNG_BASE64, 'base64'));
  const guidelinesPath = path.join(dir, 'brand-guidelines.yml');
  return {
    dir,
    imgPath,
    guidelinesPath,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

function makeVisionClient(logos: { score: number }[]): ImageAnnotatorClient {
  return {
    logoDetection: vi.fn(async () => [
      {
        logoAnnotations: logos,
      },
    ]),
  } as unknown as ImageAnnotatorClient;
}

function writeGuidelines(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, 'utf8');
}

const GUIDELINES_COLORS_ONLY = `
colors:
  primary: "#FF6B35"
  accent: "#004E89"
`;

const GUIDELINES_WITH_LOGO = `
colors:
  primary: "#FF6B35"
logo:
  referenceImage: ./brand/logo.png
  minConfidence: 0.8
`;

const GUIDELINES_WITH_FONTS = `
fonts:
  approved:
    - Inter
    - Roboto
`;

const GUIDELINES_FULL = `
colors:
  primary: "#FF6B35"
logo:
  referenceImage: ./brand/logo.png
  minConfidence: 0.8
fonts:
  approved:
    - Inter
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkBrand', () => {
  let tmp: ReturnType<typeof makeTmpDir>;

  beforeEach(() => {
    tmp = makeTmpDir();
    mockExtractPalette.mockClear();
  });

  afterEach(() => {
    tmp.cleanup();
    vi.restoreAllMocks();
  });

  // 1. No guidelines file → ok=true, guidelinesFound=false
  it('returns ok=true with guidelinesFound=false when no guidelines file exists', async () => {
    const result = await checkBrand({
      imagePath: tmp.imgPath,
      guidelinesPath: path.join(tmp.dir, 'nonexistent.yml'),
    });
    expect(result.ok).toBe(true);
    expect(result.guidelinesFound).toBe(false);
    expect(result.violations).toHaveLength(0);
  });

  // 2. Color match within ΔE=5 → ok=true
  it('passes color check when palette contains brand color within ΔE=5', async () => {
    writeGuidelines(tmp.guidelinesPath, GUIDELINES_COLORS_ONLY);
    // Return the exact brand color from palette → ΔE=0
    mockExtractPalette.mockResolvedValueOnce({
      colors: ['#FF6B35', '#004E89', '#FFFFFF'],
      colorCount: 8,
      format: 'hex',
      imagePath: tmp.imgPath,
    });
    const result = await checkBrand({
      imagePath: tmp.imgPath,
      guidelinesPath: tmp.guidelinesPath,
    });
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.guidelinesFound).toBe(true);
  });

  // 3. Color mismatch ΔE=10 → violation class='color'
  it('records color violation when palette diverges by ΔE>5', async () => {
    writeGuidelines(tmp.guidelinesPath, GUIDELINES_COLORS_ONLY);
    // Return colors that are very different from brand colors
    mockExtractPalette.mockResolvedValueOnce({
      colors: ['#000000', '#111111', '#222222'],
      colorCount: 8,
      format: 'hex',
      imagePath: tmp.imgPath,
    });
    const result = await checkBrand({
      imagePath: tmp.imgPath,
      guidelinesPath: tmp.guidelinesPath,
    });
    expect(result.ok).toBe(false);
    const colorViolations = result.violations.filter((v) => v.class === 'color');
    expect(colorViolations.length).toBeGreaterThan(0);
    expect(colorViolations[0]?.severity).toBe('major');
  });

  // 4. Logo detection enabled + mock returns logo with confidence 0.9 → ok=true (for logo)
  it('passes logo check when confident logo detected', async () => {
    writeGuidelines(tmp.guidelinesPath, GUIDELINES_WITH_LOGO);
    // extractPalette returns matching color
    mockExtractPalette.mockResolvedValueOnce({
      colors: ['#FF6B35'],
      colorCount: 8,
      format: 'hex',
      imagePath: tmp.imgPath,
    });
    const client = makeVisionClient([{ score: 0.9 }]);
    const result = await checkBrand({
      imagePath: tmp.imgPath,
      guidelinesPath: tmp.guidelinesPath,
      enableLogoDetection: true,
      _visionClient: client,
    });
    const logoViolations = result.violations.filter((v) => v.class === 'logo');
    expect(logoViolations).toHaveLength(0);
  });

  // 5. Logo detection enabled + mock returns no logos → violation class='logo'
  it('records logo violation when no logos detected above threshold', async () => {
    writeGuidelines(tmp.guidelinesPath, GUIDELINES_WITH_LOGO);
    mockExtractPalette.mockResolvedValueOnce({
      colors: ['#FF6B35'],
      colorCount: 8,
      format: 'hex',
      imagePath: tmp.imgPath,
    });
    const client = makeVisionClient([]);
    const result = await checkBrand({
      imagePath: tmp.imgPath,
      guidelinesPath: tmp.guidelinesPath,
      enableLogoDetection: true,
      _visionClient: client,
    });
    expect(result.ok).toBe(false);
    const logoViolations = result.violations.filter((v) => v.class === 'logo');
    expect(logoViolations).toHaveLength(1);
    expect(logoViolations[0]?.severity).toBe('critical');
  });

  // 6. Logo detection NOT enabled → logo check skipped
  it('skips logo check when enableLogoDetection=false (default)', async () => {
    writeGuidelines(tmp.guidelinesPath, GUIDELINES_WITH_LOGO);
    mockExtractPalette.mockResolvedValueOnce({
      colors: ['#FF6B35'],
      colorCount: 8,
      format: 'hex',
      imagePath: tmp.imgPath,
    });
    // No _visionClient provided; if logo detection ran, it'd try to call real SDK
    const result = await checkBrand({
      imagePath: tmp.imgPath,
      guidelinesPath: tmp.guidelinesPath,
      enableLogoDetection: false,
    });
    const logoViolations = result.violations.filter((v) => v.class === 'logo');
    expect(logoViolations).toHaveLength(0);
  });

  // 7. Font check: ocrText contains approved font name → no violation
  it('passes font check when OCR text contains approved font name', async () => {
    writeGuidelines(tmp.guidelinesPath, GUIDELINES_WITH_FONTS);
    const result = await checkBrand({
      imagePath: tmp.imgPath,
      guidelinesPath: tmp.guidelinesPath,
      ocrText: 'Hello World (Inter)',
    });
    const fontViolations = result.violations.filter((v) => v.class === 'font');
    expect(fontViolations).toHaveLength(0);
  });

  // 8. Font check: ocrText non-empty but no approved font names found → minor violation
  it('records minor font violation when OCR text has no approved font names', async () => {
    writeGuidelines(tmp.guidelinesPath, GUIDELINES_WITH_FONTS);
    const result = await checkBrand({
      imagePath: tmp.imgPath,
      guidelinesPath: tmp.guidelinesPath,
      ocrText: 'Hello World',
    });
    expect(result.ok).toBe(false);
    const fontViolations = result.violations.filter((v) => v.class === 'font');
    expect(fontViolations).toHaveLength(1);
    expect(fontViolations[0]?.severity).toBe('minor');
  });

  // 9. Invalid YAML → throws ValidationError
  it('throws ValidationError on invalid YAML content', async () => {
    // Zod violation: color value doesn't match hex regex
    const invalidYaml = `
colors:
  primary: "not-a-hex-color"
`;
    writeGuidelines(tmp.guidelinesPath, invalidYaml);
    await expect(
      checkBrand({ imagePath: tmp.imgPath, guidelinesPath: tmp.guidelinesPath })
    ).rejects.toThrow(ValidationError);
  });

  // 10. CIEDE2000 sanity: ΔE(black, black) ≈ 0; ΔE(black, white) >> 50
  it('CIEDE2000 sanity: black-to-black ΔE≈0, black-to-white ΔE is large', async () => {
    // Guidelines with black as brand color
    const blackGuidelines = `
colors:
  bg: "#000000"
`;
    writeGuidelines(tmp.guidelinesPath, blackGuidelines);

    // Palette = exactly black → ΔE=0 → no violation
    mockExtractPalette.mockResolvedValueOnce({
      colors: ['#000000'],
      colorCount: 8,
      format: 'hex',
      imagePath: tmp.imgPath,
    });
    const resultBlack = await checkBrand({
      imagePath: tmp.imgPath,
      guidelinesPath: tmp.guidelinesPath,
    });
    expect(resultBlack.ok).toBe(true);
    expect(resultBlack.violations).toHaveLength(0);

    // Palette = white → ΔE is very large → violation
    mockExtractPalette.mockResolvedValueOnce({
      colors: ['#FFFFFF'],
      colorCount: 8,
      format: 'hex',
      imagePath: tmp.imgPath,
    });
    const resultWhite = await checkBrand({
      imagePath: tmp.imgPath,
      guidelinesPath: tmp.guidelinesPath,
    });
    expect(resultWhite.ok).toBe(false);
    expect(resultWhite.violations[0]?.class).toBe('color');
  });

  // Extra: font check skipped when ocrText is empty
  it('skips font check when ocrText is empty string', async () => {
    writeGuidelines(tmp.guidelinesPath, GUIDELINES_FULL);
    mockExtractPalette.mockResolvedValueOnce({
      colors: ['#FF6B35'],
      colorCount: 8,
      format: 'hex',
      imagePath: tmp.imgPath,
    });
    const result = await checkBrand({
      imagePath: tmp.imgPath,
      guidelinesPath: tmp.guidelinesPath,
      ocrText: '',
      enableLogoDetection: false,
    });
    const fontViolations = result.violations.filter((v) => v.class === 'font');
    expect(fontViolations).toHaveLength(0);
  });
});
