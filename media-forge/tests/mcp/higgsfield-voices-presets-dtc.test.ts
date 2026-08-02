// The last three CLI surfaces: voices, presets, dtc-ads.
//
// All three go through HiggsfieldCliProvider, so the runner is the seam — no
// real binary is spawned. The payloads below are verbatim shapes read from the
// installed CLI on 2026-08-01, not invented ones: `voices list` wraps in
// `{cursor,items,total}`, `preset list video-explainer` wraps in `{items}` with
// uuid ids, `preset list animation-action` wraps in `{items}` with INTEGER ids,
// and `dtc-ads generate --cost-only` answers a bare `{credits}`.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  handleHiggsfieldVoices,
  handleHiggsfieldPresets,
  handleHiggsfieldDtcAd,
  handleHiggsfieldUpload,
  handleHiggsfieldMsAvatarCreate,
  handleHiggsfieldMsImage,
} from '../../src/mcp/handlers/higgsfield-ugc.js';
import { HiggsfieldCliProvider } from '../../src/video/providers/higgsfield-cli.js';
import {
  _setHiggsfieldCliProviderForTests,
  _resetHiggsfieldCliProviderForTests,
} from '../../src/mcp/handlers/shared.js';

let calls: string[][] = [];

function fakeCli(responses: Record<string, unknown>): HiggsfieldCliProvider {
  return new HiggsfieldCliProvider({
    runner: async (args) => {
      calls.push([...args]);
      if (args[0] === 'auth') return { stdout: '{"token":"t"}', stderr: '', exitCode: 0 };
      const key = args.slice(0, 3).join(' ');
      const body = responses[key];
      if (body === undefined) {
        return { stdout: '', stderr: `no stub for: ${key}`, exitCode: 4 };
      }
      return { stdout: JSON.stringify(body), stderr: '', exitCode: 0 };
    },
  });
}

const VOICES_PAYLOAD = {
  cursor: null,
  total: 57,
  items: [
    { id: 'v-emily', name: 'Emily', voice_type: 'preset', category: 'voice', status: 'completed' },
    { id: 'v-john', name: 'John', voice_type: 'preset', category: 'voice', status: 'completed' },
    { id: 'v-mine', name: 'Cloned Me', voice_type: 'element', category: 'voice', status: 'completed' },
  ],
};

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  _resetHiggsfieldCliProviderForTests();
});

describe('media_higgsfield_voices', () => {
  it('returns the id/voiceType pair, and the platform total alongside the filtered count', async () => {
    _setHiggsfieldCliProviderForTests(fakeCli({ 'voices list --json': VOICES_PAYLOAD }));

    const result = await handleHiggsfieldVoices({});

    expect(result.count).toBe(3);
    // `total` is the catalogue size, `count` is what survived the filters. With
    // one number a typo'd query is indistinguishable from an empty catalogue.
    expect(result.total).toBe(57);
    expect(result.voices[0]).toMatchObject({ id: 'v-emily', name: 'Emily', voiceType: 'preset' });
  });

  it('filters by voiceType, which is a separate CLI argument and not derivable from the id', async () => {
    _setHiggsfieldCliProviderForTests(fakeCli({ 'voices list --json': VOICES_PAYLOAD }));

    const result = await handleHiggsfieldVoices({ voiceType: 'element' });

    expect(result.voices.map((v) => v.id)).toEqual(['v-mine']);
    expect(result.total).toBe(57);
  });
});

describe('media_higgsfield_presets', () => {
  it('filters video-explainer locally — that catalogue has no server-side search', async () => {
    _setHiggsfieldCliProviderForTests(
      fakeCli({
        'preset list video-explainer': {
          items: [
            { id: 'p-1', name: 'Editorial Motion Graphics' },
            { id: 'p-2', name: 'Stickman Cartoon' },
          ],
        },
      }),
    );

    const result = await handleHiggsfieldPresets({ type: 'video-explainer', query: 'stickman' });

    expect(result.count).toBe(1);
    // The filter flags are animation-action's. Forwarding --query here earns an
    // `Unknown params` refusal on a call that would otherwise have worked.
    expect(calls.at(-1)).toEqual(['preset', 'list', 'video-explainer', '--json']);
  });

  it('pushes group and category filters server-side for animation-action', async () => {
    _setHiggsfieldCliProviderForTests(
      fakeCli({
        'preset list animation-action': {
          items: [{ id: 0, name: 'Idle', group: 'DailyActions', category: 'Idle' }],
        },
      }),
    );

    await handleHiggsfieldPresets({
      type: 'animation-action',
      query: 'punch',
      group: 'Fighting',
      category: 'Punching',
      limit: 50,
    });

    expect(calls.at(-1)).toEqual([
      'preset', 'list', 'animation-action',
      '--query', 'punch',
      '--group', 'Fighting',
      '--category', 'Punching',
      '--limit', '50',
      '--json',
    ]);
  });

  it('resolves a video-explainer preset into its generation input', async () => {
    _setHiggsfieldCliProviderForTests(
      fakeCli({ 'preset resolve video-explainer': { media_input_id: 'mi-9' } }),
    );

    const result = await handleHiggsfieldPresets({
      type: 'video-explainer',
      resolveId: 'p-1',
    });

    expect(result.resolved).toBe(true);
    expect(calls.at(-1)).toEqual(['preset', 'resolve', 'video-explainer', 'p-1', '--json']);
  });

  it('refuses resolve on animation-action rather than silently listing', async () => {
    // The CLI documents resolve for video-explainer only. Degrading to a list
    // would return a plausible payload for a call that never happened.
    _setHiggsfieldCliProviderForTests(fakeCli({}));

    await expect(
      handleHiggsfieldPresets({ type: 'animation-action', resolveId: '3' }),
    ).rejects.toThrow(/video-explainer only/);
  });
});

describe('media_higgsfield_dtc_ad', () => {
  it('defaults to costOnly — a tool that spends on its default spends by accident', async () => {
    _setHiggsfieldCliProviderForTests(
      fakeCli({ 'marketing-studio dtc-ads generate': { credits: 0.5 } }),
    );

    const result = await handleHiggsfieldDtcAd({ prompt: 'hero shot', formatId: 'fmt-1' });

    expect(result.submitted).toBe(false);
    expect(result.credits).toBe(0.5);
    expect(calls.at(-1)).toContain('--cost-only');
  });

  it('prices without a brand kit — brandKitId is optional on this endpoint', async () => {
    // Measured against the real CLI on an account with ZERO brand kits:
    //   dtc-ads generate --prompt "test" --format-id <uuid> --cost-only
    //   -> {"credits": 0.5}
    // TODOS.md had recorded this surface as blocked on a brand kit. It is not.
    _setHiggsfieldCliProviderForTests(
      fakeCli({ 'marketing-studio dtc-ads generate': { credits: 0.5 } }),
    );

    await handleHiggsfieldDtcAd({ prompt: 'hero shot', formatId: 'fmt-1' });

    expect(calls.at(-1)).not.toContain('--brand-kit-id');
  });

  it('forwards the optional account references when given', async () => {
    _setHiggsfieldCliProviderForTests(
      fakeCli({ 'marketing-studio dtc-ads generate': { credits: 2 } }),
    );

    await handleHiggsfieldDtcAd({
      prompt: 'hero shot',
      formatId: 'fmt-1',
      brandKitId: 'bk-1',
      avatarId: 'av-1',
      productId: 'pr-1',
      quality: 'high',
      resolution: '4k',
    });

    const args = calls.at(-1)!;
    expect(args).toEqual(expect.arrayContaining(['--brand-kit-id', 'bk-1']));
    expect(args).toEqual(expect.arrayContaining(['--avatar', 'av-1']));
    expect(args).toEqual(expect.arrayContaining(['--product', 'pr-1']));
    expect(args).toEqual(expect.arrayContaining(['--quality', 'high']));
    expect(args).toEqual(expect.arrayContaining(['--resolution', '4k']));
  });
});

describe('media_higgsfield_upload + media_higgsfield_ms_avatar_create', () => {
  it('upload returns the id everything downstream references', async () => {
    // Verbatim shape from the real CLI (2026-08-02, a 152-byte local PNG):
    //   { "id": "...", "type": "image", "url": "https://d2ol7oe...png" }
    _setHiggsfieldCliProviderForTests(
      fakeCli({
        'upload create C:/tmp/face.png': {
          id: 'up-1',
          type: 'image',
          url: 'https://cdn.example.com/up-1.png',
        },
      }),
    );

    const result = await handleHiggsfieldUpload({ filePath: 'C:/tmp/face.png' });

    expect(result).toMatchObject({ id: 'up-1', type: 'image' });
  });

  it('refuses an upload response with no id instead of returning an empty one', async () => {
    // An empty id propagates into `avatars create --image ""` and fails there,
    // one call later, with an error about the avatar rather than the upload.
    _setHiggsfieldCliProviderForTests(
      fakeCli({ 'upload create C:/tmp/face.png': { type: 'image' } }),
    );

    await expect(handleHiggsfieldUpload({ filePath: 'C:/tmp/face.png' })).rejects.toThrow(
      /returned no id/,
    );
  });

  it('avatar create passes name and image through', async () => {
    _setHiggsfieldCliProviderForTests(
      fakeCli({ 'marketing-studio avatars create': { id: 'av-new', name: 'MV Presenter 01' } }),
    );

    const result = await handleHiggsfieldMsAvatarCreate({
      name: 'MV Presenter 01',
      image: 'up-1',
    });

    expect(result).toMatchObject({ id: 'av-new', name: 'MV Presenter 01' });
    expect(calls.at(-1)).toEqual([
      'marketing-studio', 'avatars', 'create',
      '--name', 'MV Presenter 01',
      '--image', 'up-1',
      '--json',
    ]);
  });

  it('requires a name — the CLI has no delete, so an unnamed mistake is unfindable', async () => {
    _setHiggsfieldCliProviderForTests(fakeCli({}));
    await expect(handleHiggsfieldMsAvatarCreate({ image: 'up-1' })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Argv flag smuggling.
//
// Not shell injection — the runner spawns with shell:false and an argv array.
// The hazard is narrower and real: a POSITIONAL that begins with `-` stops
// being data and is parsed as a flag. Measured against the installed CLI:
//
//   $ higgsfield upload create "--version" --json
//   Error: unknown flag: --version
//
// Flag VALUES are safe on this CLI, also measured:
//
//   $ higgsfield preset list animation-action --query "--limit" --limit 1
//   -> ran, empty result, no error
//
// So the guard is on positionals only. Guarding --name/--prompt/--query too
// would reject a legitimate prompt that opens with a dash to fix a non-issue.
// ---------------------------------------------------------------------------
describe('argv flag smuggling — positionals only', () => {
  it('refuses an upload path that would be parsed as a flag', async () => {
    _setHiggsfieldCliProviderForTests(fakeCli({}));
    await expect(handleHiggsfieldUpload({ filePath: '--version' })).rejects.toThrow();
    // The CLI is never reached: rejection happens at schema parse.
    expect(calls).toHaveLength(0);
  });

  it('refuses a preset id that would be parsed as a flag', async () => {
    _setHiggsfieldCliProviderForTests(fakeCli({}));
    await expect(
      handleHiggsfieldPresets({ type: 'video-explainer', resolveId: '--help' }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('still accepts an ordinary path', async () => {
    _setHiggsfieldCliProviderForTests(
      fakeCli({ 'upload create ./face.png': { id: 'up-2', type: 'image', url: 'u' } }),
    );
    await expect(handleHiggsfieldUpload({ filePath: './face.png' })).resolves.toMatchObject({
      id: 'up-2',
    });
  });

  it('does NOT reject a flag VALUE that starts with a dash', async () => {
    // A prompt legitimately beginning with a dash reaches the CLI intact,
    // because measurement C showed the CLI takes it as the flag's value.
    _setHiggsfieldCliProviderForTests(
      fakeCli({ 'marketing-studio dtc-ads generate': { credits: 0.5 } }),
    );
    await handleHiggsfieldDtcAd({ prompt: '-- minimal, high key', formatId: 'fmt-1' });
    expect(calls.at(-1)).toEqual(expect.arrayContaining(['--prompt', '-- minimal, high key']));
  });
});

// ---------------------------------------------------------------------------
// ms_image — one avatar, both halves.
//
// Swept all 71 job types the CLI publishes and read which accept a Soul-ID
// versus an avatar:
//
//   custom_reference_id  text2image_soul_v2 · soul_cinematic · soul_cinema_studio
//   avatars              ms_image · marketing_studio_video
//
// DISJOINT. A Soul-ID drives no video; an avatar drives no Soul model. But
// ms_image takes avatars and returns an image, so one custom avatar already
// covers the ad AND the still — Soul-ID is for the Soul family's look, not for
// keeping one face consistent.
// ---------------------------------------------------------------------------
describe('media_higgsfield_ms_image', () => {
  it('sends arrays as ONE JSON flag and media as a repeated flag', async () => {
    // Two shapes, both measured: `--avatars '["id"]'` priced at 7 credits, while
    // the repeated form is what --image-references takes. Getting them backwards
    // earns "Invalid types: avatars" at submit time.
    _setHiggsfieldCliProviderForTests(fakeCli({ 'generate cost ms_image': { credits: 7 } }));

    await handleHiggsfieldMsImage({
      prompt: 'brand hero',
      avatarIds: ['av-1', 'av-2'],
      productIds: ['pr-1'],
      imagePaths: ['a.png', 'b.png'],
      quality: 'high',
      resolution: '2k',
    });

    const args = calls.at(-1)!;
    expect(args).toEqual(expect.arrayContaining(['--avatars', '["av-1","av-2"]']));
    expect(args).toEqual(expect.arrayContaining(['--product_ids', '["pr-1"]']));
    expect(args.filter((a) => a === '--image-references')).toHaveLength(2);
  });

  it('defaults to costOnly and reads the price', async () => {
    // 0.5 credits at low/1k — the CLI's own answer, measured.
    _setHiggsfieldCliProviderForTests(fakeCli({ 'generate cost ms_image': { credits: 0.5 } }));

    const result = await handleHiggsfieldMsImage({ prompt: 'x' });

    expect(result.submitted).toBe(false);
    expect(result.credits).toBe(0.5);
    // `generate create` has no --cost-only; the read is a different subcommand.
    expect(calls.at(-1)!.slice(0, 3)).toEqual(['generate', 'cost', 'ms_image']);
  });

  it('switches to the create subcommand when costOnly is off', async () => {
    _setHiggsfieldCliProviderForTests(fakeCli({ 'generate create ms_image': { id: 'job-1' } }));

    const result = await handleHiggsfieldMsImage({ prompt: 'x', costOnly: false });

    expect(result.submitted).toBe(true);
    expect(calls.at(-1)!.slice(0, 3)).toEqual(['generate', 'create', 'ms_image']);
  });

  it('runs without a brand kit — brandKitId is optional here too', async () => {
    _setHiggsfieldCliProviderForTests(fakeCli({ 'generate cost ms_image': { credits: 0.5 } }));
    await handleHiggsfieldMsImage({ prompt: 'x' });
    expect(calls.at(-1)).not.toContain('--brand_kit_id');
  });
});
