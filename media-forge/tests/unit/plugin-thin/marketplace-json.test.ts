import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
// marketplace.json is at repo root, 4 levels up from tests/unit/plugin-thin/
const repoRoot = join(__dir, '../../../..');
const raw = readFileSync(join(repoRoot, '.claude-plugin/marketplace.json'), 'utf-8');
const marketplace = JSON.parse(raw) as Record<string, unknown>;
const plugins = marketplace['plugins'] as Array<Record<string, unknown>>;

describe('marketplace.json -- schema', () => {
  it('has media-forge-hosted entry', () => {
    const entry = plugins.find((p) => p['name'] === 'media-forge-hosted');
    expect(entry).toBeDefined();
  });

  it('media-forge-hosted source points to media-forge/plugins/media-forge-hosted', () => {
    const entry = plugins.find((p) => p['name'] === 'media-forge-hosted');
    expect(entry?.['source']).toBe('./media-forge/plugins/media-forge-hosted');
  });

  it('media-forge-hosted has description', () => {
    const entry = plugins.find((p) => p['name'] === 'media-forge-hosted');
    expect(typeof entry?.['description']).toBe('string');
    expect((entry?.['description'] as string).length).toBeGreaterThan(10);
  });

  it('original media-forge entry still present (backward compat)', () => {
    const entry = plugins.find((p) => p['name'] === 'media-forge');
    expect(entry).toBeDefined();
  });

  it('marketplace name is maxvision-utilities', () => {
    expect(marketplace['name']).toBe('maxvision-utilities');
  });

  it('has at least 4 plugins (n8n-skills, gtm-skills, media-forge, media-forge-hosted)', () => {
    expect(plugins.length).toBeGreaterThanOrEqual(4);
  });

  it('all plugins have name and source fields', () => {
    for (const p of plugins) {
      expect(typeof p['name']).toBe('string');
      expect(typeof p['source']).toBe('string');
    }
  });
});
