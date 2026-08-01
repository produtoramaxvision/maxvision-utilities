// tests/video/reference-authority.test.ts
//
// Gate for T12 — the Reference Authority Resolver.
//
// T12 sat deferred because no provider carried a role per reference, so any
// resolver would have produced bookkeeping the wire never consumed. BytePlus
// ModelArk does carry one, and documents the scenarios as mutually exclusive
// (doc 1520757), which is why this is scoped to ARK's vocabulary rather than
// T12's original seven-dimension one.
//
// The failure these rules exist to stop is quiet: a merged reference set
// produces a plausible video that ignores the frame constraint, and that reads
// as a model quality problem rather than a request the adapter mangled.

import { describe, it, expect } from 'vitest';
import {
  resolveReferenceAuthority,
  findAuthorityConflicts,
  ARK_INPUT_CAPS,
} from '../../src/video/reference-authority.js';
import { ValidationError } from '../../src/core/errors.js';

describe('resolveReferenceAuthority — scenarios', () => {
  it('no references at all is text-only, not an error', () => {
    const result = resolveReferenceAuthority({});
    expect(result.scenario).toBe('text-only');
    expect(result.assignments).toEqual([]);
  });

  it('a lone opening frame gets role first_frame, explicitly', () => {
    const result = resolveReferenceAuthority({ firstFrameUrl: 'https://cdn/a.png' });
    expect(result.scenario).toBe('first-frame');
    // ModelArk allows the role to be blank for a lone first frame. Setting it is
    // deliberate: an omitted role is a default somebody else gets to change.
    expect(result.assignments).toEqual([{ url: 'https://cdn/a.png', role: 'first_frame' }]);
  });

  it('opening + closing frames get distinct roles, in order', () => {
    const result = resolveReferenceAuthority({
      firstFrameUrl: 'https://cdn/a.png',
      lastFrameUrl: 'https://cdn/b.png',
    });
    expect(result.scenario).toBe('first-and-last-frame');
    expect(result.assignments).toEqual([
      { url: 'https://cdn/a.png', role: 'first_frame' },
      { url: 'https://cdn/b.png', role: 'last_frame' },
    ]);
  });

  it('loose references get their own per-medium roles', () => {
    const result = resolveReferenceAuthority({
      referenceImageUrls: ['https://cdn/i.png'],
      referenceVideoUrls: ['https://cdn/v.mp4'],
      referenceAudioUrls: ['https://cdn/a.mp3'],
    });
    expect(result.scenario).toBe('multimodal-reference');
    expect(result.assignments).toEqual([
      { url: 'https://cdn/i.png', role: 'reference_image' },
      { url: 'https://cdn/v.mp4', role: 'reference_video' },
      { url: 'https://cdn/a.mp3', role: 'reference_audio' },
    ]);
  });
});

describe('resolveReferenceAuthority — the ambiguities it refuses', () => {
  it('frames and multimodal references cannot be combined', () => {
    // THE defect. The adapter used to merge these into one list and send every
    // entry as `reference_image`, so the frame constraint vanished silently and
    // two mutually exclusive scenarios were requested at once.
    expect(() =>
      resolveReferenceAuthority({
        firstFrameUrl: 'https://cdn/frame.png',
        referenceImageUrls: ['https://cdn/style.png'],
      }),
    ).toThrow(ValidationError);

    expect(() =>
      resolveReferenceAuthority({
        firstFrameUrl: 'https://cdn/frame.png',
        referenceImageUrls: ['https://cdn/style.png'],
      }),
    ).toThrow(/mutually exclusive/);
  });

  it('a closing frame with no opening frame is not a mode ARK defines', () => {
    expect(() => resolveReferenceAuthority({ lastFrameUrl: 'https://cdn/z.png' })).toThrow(
      /no last-frame-only mode/,
    );
  });

  it('one asset cannot own both ends of the clip', () => {
    expect(() =>
      resolveReferenceAuthority({
        firstFrameUrl: 'https://cdn/same.png',
        lastFrameUrl: 'https://cdn/same.png',
      }),
    ).toThrow(/open and close on one state/);
  });

  it('a duplicated reference is two owners of the same guidance', () => {
    expect(() =>
      resolveReferenceAuthority({
        referenceImageUrls: ['https://cdn/x.png', 'https://cdn/x.png'],
      }),
    ).toThrow(/more than once/);
  });

  it('reports every conflict at once rather than one per paid request', () => {
    const problems = findAuthorityConflicts({
      lastFrameUrl: 'https://cdn/z.png',
      referenceImageUrls: ['https://cdn/d.png', 'https://cdn/d.png'],
    });
    // last-frame-without-first, frames-with-references, and the duplicate.
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });
});

describe('resolveReferenceAuthority — published input caps', () => {
  it('refuses more images than ModelArk accepts, counting the frames', () => {
    const urls = Array.from({ length: ARK_INPUT_CAPS.images + 1 }, (_, i) => `https://cdn/${i}.png`);
    // Checked here rather than at the provider, so an over-long set fails while
    // it is still editable and before the cost guard has run.
    expect(() => resolveReferenceAuthority({ referenceImageUrls: urls })).toThrow(
      /exceeds ModelArk's published cap of 9/,
    );
  });

  it('refuses more videos than the cap', () => {
    const urls = Array.from({ length: ARK_INPUT_CAPS.videos + 1 }, (_, i) => `https://cdn/${i}.mp4`);
    expect(() => resolveReferenceAuthority({ referenceVideoUrls: urls })).toThrow(/cap of 3/);
  });

  it('accepts exactly the cap', () => {
    const urls = Array.from({ length: ARK_INPUT_CAPS.images }, (_, i) => `https://cdn/${i}.png`);
    expect(resolveReferenceAuthority({ referenceImageUrls: urls }).assignments).toHaveLength(9);
  });
});
