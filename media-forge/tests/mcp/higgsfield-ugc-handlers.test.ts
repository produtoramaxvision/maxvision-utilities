// The Marketing Studio UGC surface — catalogue + the two backend-enhanced
// image products.
//
// None of this was reachable before 2026-08-01. The Cloud API does not resell
// Marketing Studio (its endpoint answers 404), so the whole surface — 40
// avatars, 9 hooks, 14 settings, 42 ad formats, product photoshoot, marketplace
// cards — was invisible to the plugin while the tool that claimed to cover it
// pointed at a dead URL.
//
// Every assertion below is about ARGV, because argv is what reaches the
// platform. The seam is the CLI runner for the same reason the Studio tests use
// it: a stubbed fetch cannot stand in for a spawned binary, and finding that out
// the expensive way is what these tests exist to prevent.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  handleHiggsfieldMarketingAssets,
  handleHiggsfieldProductPhotoshoot,
  handleHiggsfieldMarketplaceCards,
} from '../../src/mcp/handlers/higgsfield-ugc.js';
import { HiggsfieldCliProvider } from '../../src/video/providers/higgsfield-cli.js';
import {
  _resetHiggsfieldCliProviderForTests,
  _setHiggsfieldCliProviderForTests,
} from '../../src/mcp/handlers/shared.js';

let calls: string[][] = [];
let nextStdout = '{}';

beforeEach(() => {
  calls = [];
  nextStdout = '{}';
  _setHiggsfieldCliProviderForTests(
    new HiggsfieldCliProvider({
      runner: async (args) => {
        calls.push([...args]);
        return { stdout: nextStdout, stderr: '', exitCode: 0 };
      },
    }),
  );
});

afterEach(() => {
  _resetHiggsfieldCliProviderForTests();
});

describe('media_higgsfield_ms_assets', () => {
  // The two response shapes the CLI actually uses. `avatars` and `ad-formats`
  // answer with a bare array; the rest wrap in `{items}`. A tool that only
  // understood one of them would return an empty catalogue for half its enum
  // and look like an empty account.
  it('reads a bare-array group (avatars)', async () => {
    nextStdout = JSON.stringify([
      { id: 'a1', name: 'Jayden', gender: 'male' },
      { id: 'a2', name: 'Stefan', gender: 'male' },
    ]);
    const out = await handleHiggsfieldMarketingAssets({ kind: 'avatars' });
    expect(calls[0]).toEqual(['marketing-studio', 'avatars', 'list', '--json']);
    expect(out.count).toBe(2);
    expect(out.assets[0]!.name).toBe('Jayden');
    // The untouched row is kept so nothing the platform said is thrown away.
    expect(out.assets[0]!.raw['gender']).toBe('male');
  });

  it('reads an {items}-wrapped group (hooks)', async () => {
    nextStdout = JSON.stringify({
      cursor: null,
      has_more: false,
      items: [{ id: 'h1', name: 'Product Hit', prompt: 'Object flies into frame' }],
    });
    const out = await handleHiggsfieldMarketingAssets({ kind: 'hooks' });
    expect(out.count).toBe(1);
    expect(out.assets[0]!.id).toBe('h1');
  });

  it('falls back to display_name where the group has no name field', async () => {
    nextStdout = JSON.stringify([{ id: 'f1', display_name: 'Special Offer', type: 'headline' }]);
    const out = await handleHiggsfieldMarketingAssets({ kind: 'ad-formats' });
    expect(out.assets[0]!.name).toBe('Special Offer');
  });

  it('filters by query and caps at limit', async () => {
    nextStdout = JSON.stringify([
      { id: '1', name: 'Bedroom' },
      { id: '2', name: 'Bathroom' },
      { id: '3', name: 'Kitchen' },
    ]);
    const out = await handleHiggsfieldMarketingAssets({ kind: 'settings', query: 'room' });
    expect(out.assets.map((a) => a.name)).toEqual(['Bedroom', 'Bathroom']);

    const capped = await handleHiggsfieldMarketingAssets({ kind: 'settings', limit: 1 });
    expect(capped.count).toBe(1);
  });

  it('refuses a group the platform does not have', async () => {
    await expect(handleHiggsfieldMarketingAssets({ kind: 'storyboards' })).rejects.toThrow();
  });
});

describe('media_higgsfield_product_photoshoot', () => {
  // enhanceOnly defaults to TRUE. A tool that spends money on its default
  // setting spends money by accident, and this one has ten modes a caller will
  // reasonably want to compare before paying for any of them.
  it('previews without submitting by default', async () => {
    nextStdout = JSON.stringify({ prompts: [{ enhanced_prompt: 'hero shot, softbox left' }] });
    const out = await handleHiggsfieldProductPhotoshoot({
      prompt: 'bottle for IG',
      mode: 'lifestyle_scene',
      imagePaths: ['./bottle.jpg'],
    });

    expect(out.submitted).toBe(false);
    expect(out.jobIds).toEqual([]);
    expect(out.enhancedPrompts).toEqual(['hero shot, softbox left']);
    expect(calls[0]).toEqual(
      expect.arrayContaining(['product-photoshoot', 'create', '--enhance-only']),
    );
  });

  it('submits only when the caller asks for it, and says that it did', async () => {
    nextStdout = JSON.stringify({ jobs: [{ id: 'job-9' }] });
    const out = await handleHiggsfieldProductPhotoshoot({
      prompt: 'x',
      mode: 'product_shot',
      imagePaths: ['./a.png'],
      enhanceOnly: false,
    });
    expect(out.submitted).toBe(true);
    expect(out.jobIds).toEqual(['job-9']);
    expect(calls[0]).not.toContain('--enhance-only');
  });

  it('repeats --image once per reference', async () => {
    await handleHiggsfieldProductPhotoshoot({
      prompt: 'x',
      mode: 'product_shot',
      imagePaths: ['./a.png', './b.png'],
    });
    expect(calls[0]!.filter((a) => a === '--image')).toHaveLength(2);
  });

  it('refuses a mode outside the platform list', async () => {
    await expect(
      handleHiggsfieldProductPhotoshoot({
        prompt: 'x',
        mode: 'cinematic_hero',
        imagePaths: ['./a.png'],
      }),
    ).rejects.toThrow();
  });
});

describe('media_higgsfield_marketplace_cards', () => {
  it('previews by default and passes the scope through', async () => {
    nextStdout = JSON.stringify({ main: { prompt: 'peach lemonade can, white sweep' } });
    const out = await handleHiggsfieldMarketplaceCards({
      prompt: 'peach lemonade can',
      scope: 'full-set',
      imagePaths: ['./can.png'],
    });
    expect(out.submitted).toBe(false);
    expect(out.enhancedPrompts).toEqual(['peach lemonade can, white sweep']);
    expect(calls[0]).toEqual(expect.arrayContaining(['--scope', 'full-set', '--enhance-only']));
  });

  // --main-job chains secondary and A+ assets off an existing main image. Asking
  // for scope 'main' at the same time is asking to regenerate the thing being
  // chained FROM, which the caller cannot have meant.
  it('refuses mainJobId together with scope=main', async () => {
    await expect(
      handleHiggsfieldMarketplaceCards({
        prompt: 'x',
        scope: 'main',
        imagePaths: ['./a.png'],
        mainJobId: 'job-1',
      }),
    ).rejects.toThrow(/scope must be/);
  });
});
