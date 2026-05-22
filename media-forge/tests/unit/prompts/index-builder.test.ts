import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildIndex,
  writeIndex,
  searchTemplates,
  tryTemplate,
} from '../../../src/prompts/template-loader.js';
import type { PromptIndex } from '../../../src/prompts/template-loader.js';

// ---------------------------------------------------------------------------
// Locate the real prompts/ directory from the repo root
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const promptsDir = path.resolve(here, '..', '..', '..', 'prompts');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXPECTED_DOMAINS = [
  'product',
  'character',
  'cinematic',
  'ad-creative',
  'hyperrealistic',
  'enterprise',
  'video-t2v',
  'video-i2v',
  'video-extension',
  'food-product-crossover',
] as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('index-builder integration (live prompts/ dir)', () => {
  let index: PromptIndex;

  beforeAll(async () => {
    index = await buildIndex(promptsDir);
  });

  // 1. Build produces _index.json with count === 30
  it('buildIndex returns 30 entries from the live prompts/ dir', () => {
    expect(index.count).toBe(30);
    expect(index.entries).toHaveLength(30);
    expect(index.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // 2. Each domain has exactly 3 entries
  it.each(EXPECTED_DOMAINS)(
    'domain "%s" has exactly 3 entries',
    (domain) => {
      const entries = index.entries.filter((e) => e.domain === domain);
      expect(entries).toHaveLength(3);
    },
  );

  // 3. writeIndex writes _index.json with count === 30
  it('writeIndex writes _index.json to disk with correct count', async () => {
    const written = await writeIndex(promptsDir);
    expect(written.count).toBe(30);

    const onDisk = JSON.parse(
      fs.readFileSync(path.join(promptsDir, '_index.json'), 'utf-8'),
    ) as PromptIndex;
    expect(onDisk.count).toBe(30);
    expect(onDisk.entries).toHaveLength(30);
  });

  // 4. searchTemplates returns ≥1 entry for 'portrait'
  it('searchTemplates("portrait") returns at least 1 result', () => {
    const results = searchTemplates(index, 'portrait');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  // 5. tryTemplate renders product/ecommerce-white-bg without missing vars
  it('tryTemplate renders product/ecommerce-white-bg with subject provided', async () => {
    const result = await tryTemplate({
      promptsDir,
      id: 'product/ecommerce-white-bg',
      vars: { subject: 'a red bicycle' },
    });
    expect(result.rendered).toContain('a red bicycle');
    expect(result.templateId).toBe('product/ecommerce-white-bg');
    expect(result.missingRequired).toHaveLength(0);
  });

  // 6. All entries have required IndexEntry fields
  it('every IndexEntry has id, domain, path, description, and variables', () => {
    for (const entry of index.entries) {
      expect(entry.id).toBeTruthy();
      expect(entry.domain).toBeTruthy();
      expect(entry.path).toBeTruthy();
      expect(entry.description).toBeTruthy();
      expect(Array.isArray(entry.variables)).toBe(true);
    }
  });

  // 7. Entries are sorted alphabetically by id
  it('entries are sorted alphabetically by id', () => {
    const ids = index.entries.map((e) => e.id);
    const sorted = [...ids].sort((a, b) => a.localeCompare(b));
    expect(ids).toEqual(sorted);
  });

  // 8. searchTemplates for 'video' returns entries from video domains
  it('searchTemplates("video") returns entries from video domains', () => {
    const results = searchTemplates(index, 'video');
    expect(results.length).toBeGreaterThanOrEqual(1);
    const hasVideoEntry = results.some((r) => r.domain.startsWith('video'));
    expect(hasVideoEntry).toBe(true);
  });
});
