// src/video/reference-authority.ts
// T12 — Reference Authority Resolver, scoped to a wire that actually carries roles.
//
// ## Why this was deferred, and what changed
//
// T12 was deferred at the C5 eng review with a precise reason: every reference
// on every provider was a bare URL string (`multiReferenceImages?: ReadonlyArray<string>`
// in base.ts), so a resolver would produce authority assignments that never
// reached a provider — "internal accounting no side of the wire consumes." The
// TODO named its own unblock condition: "when some provider accepts a role per
// reference in the payload."
//
// BytePlus ModelArk does. Verified via context7 on 2026-08-01:
//
//   doc 1520757  "The 'role' field specifies the purpose of the image. Scenarios
//                 like 'image to video - first frame', 'image to video - first
//                 and last frames', and 'multimodal reference video generation'
//                 are MUTUALLY EXCLUSIVE."
//                 first frame  -> one image_url with role 'first_frame'
//                 first+last   -> two image_url with 'first_frame' + 'last_frame'
//   doc 2291680  reference roles 'reference_image' | 'reference_video' |
//                'reference_audio'; input counts images 0-9, video 0-3, audio 0-3
//
// That is T12's invariant published by the vendor: a dimension has exactly one
// owner, and the scenarios cannot be combined.
//
// ## The bug this exists to stop
//
// `submitViaArk` merged three different things into one flat list:
//
//   imageUrls: [ ...firstFrameImagePath, ...lastFrameImagePath, ...referenceImageUrls ]
//
// Every entry then went out tagged `role: 'reference_image'`. So a caller asking
// for "start on THIS frame" got that frame demoted to a loose style reference,
// and a caller supplying both a start frame and a reference set silently
// requested two mutually exclusive scenarios at once. Neither fails loudly —
// the model returns a plausible video that ignores the constraint, which reads
// as a model quality problem.
//
// ## Deliberately NOT the original seven-dimension vocabulary
//
// T12's source concept lists identity / first-frame / last-frame / product /
// environment / motion / camera / timing / audio / style. No wire accepts most
// of those. Emitting owners for `camera` or `timing` would recreate exactly the
// unconsumed bookkeeping C5 rejected. This models only what ARK reads, and grows
// when another provider publishes more.

import { ValidationError } from '../core/errors.js';

/**
 * The dimensions ARK actually lets a caller control, and their role strings.
 *
 * `first_frame` doubles as the "blank role" case: doc 1520757 says a lone
 * first-frame image may set the role or leave it empty. It is set explicitly
 * here — an omitted role is a default someone else gets to change.
 */
export const ARK_ROLES = {
  firstFrame: 'first_frame',
  lastFrame: 'last_frame',
  referenceImage: 'reference_image',
  referenceVideo: 'reference_video',
  referenceAudio: 'reference_audio',
} as const;

export type ArkRole = (typeof ARK_ROLES)[keyof typeof ARK_ROLES];

/** ARK's published input caps (doc 2291680): images 0-9, video 0-3, audio 0-3. */
export const ARK_INPUT_CAPS = { images: 9, videos: 3, audios: 3 } as const;

export interface ReferenceAssignment {
  readonly url: string;
  readonly role: ArkRole;
}

export interface ResolveReferenceAuthorityInput {
  /** The frame the clip must open on. */
  readonly firstFrameUrl?: string | undefined;
  /** The frame the clip must close on. Requires a first frame — see below. */
  readonly lastFrameUrl?: string | undefined;
  /** Loose references for multimodal generation. */
  readonly referenceImageUrls?: ReadonlyArray<string> | undefined;
  readonly referenceVideoUrls?: ReadonlyArray<string> | undefined;
  readonly referenceAudioUrls?: ReadonlyArray<string> | undefined;
}

/**
 * The scenario a set of inputs resolves to. Named because the three are
 * mutually exclusive and the caller deserves to know which one they asked for.
 */
export type ArkScenario = 'text-only' | 'first-frame' | 'first-and-last-frame' | 'multimodal-reference';

export interface ReferenceAuthorityResult {
  readonly scenario: ArkScenario;
  readonly assignments: ReadonlyArray<ReferenceAssignment>;
}

/**
 * Every reason a reference set cannot be sent, collected rather than thrown one
 * at a time — a caller fixing an ambiguous set usually has more than one thing
 * to fix, and discovering them one paid request apart is the failure mode.
 */
export function findAuthorityConflicts(input: ResolveReferenceAuthorityInput): string[] {
  const problems: string[] = [];

  const refImages = input.referenceImageUrls ?? [];
  const refVideos = input.referenceVideoUrls ?? [];
  const refAudios = input.referenceAudioUrls ?? [];
  const hasFrames = input.firstFrameUrl !== undefined || input.lastFrameUrl !== undefined;
  const hasRefs = refImages.length > 0 || refVideos.length > 0 || refAudios.length > 0;

  // The mutual exclusivity the vendor publishes. This is the check that used to
  // be absent: both sets were merged and every entry sent as a loose reference,
  // so the frame constraint was silently dropped.
  if (hasFrames && hasRefs) {
    problems.push(
      'first/last frame and multimodal references cannot be combined: BytePlus ModelArk ' +
        'documents them as mutually exclusive scenarios. Send frames for strict frame ' +
        'consistency, or references for style/subject guidance — not both.',
    );
  }

  // A closing frame with no opening frame is not a scenario ARK defines. Sending
  // a lone `last_frame` is a request the model resolves however it likes.
  if (input.lastFrameUrl !== undefined && input.firstFrameUrl === undefined) {
    problems.push(
      'a last frame was given with no first frame. ModelArk defines "first and last frames" ' +
        'as a two-image scenario; there is no last-frame-only mode.',
    );
  }

  // One owner per dimension. The same URL owning both ends is almost always a
  // copy-paste, and it asks the model to travel from a state to itself.
  if (
    input.firstFrameUrl !== undefined &&
    input.lastFrameUrl !== undefined &&
    input.firstFrameUrl === input.lastFrameUrl
  ) {
    problems.push(
      'the first and last frame are the same asset, so the clip is asked to open and close ' +
        'on one state. If that is intended, send it as a first frame alone.',
    );
  }

  // Duplicates inside one dimension: two identical references are two owners of
  // the same guidance, and ARK counts both against its input cap.
  for (const [name, urls] of [
    ['referenceImageUrls', refImages],
    ['referenceVideoUrls', refVideos],
    ['referenceAudioUrls', refAudios],
  ] as const) {
    const seen = new Set<string>();
    for (const url of urls) {
      if (seen.has(url)) problems.push(`${name} contains "${url}" more than once`);
      seen.add(url);
    }
  }

  // Published caps. Checked here rather than at the provider so an over-long set
  // fails while it is still editable, before the cost guard has run.
  const imageCount = refImages.length + (input.firstFrameUrl ? 1 : 0) + (input.lastFrameUrl ? 1 : 0);
  if (imageCount > ARK_INPUT_CAPS.images) {
    problems.push(`${imageCount} images exceeds ModelArk's published cap of ${ARK_INPUT_CAPS.images}`);
  }
  if (refVideos.length > ARK_INPUT_CAPS.videos) {
    problems.push(`${refVideos.length} videos exceeds ModelArk's published cap of ${ARK_INPUT_CAPS.videos}`);
  }
  if (refAudios.length > ARK_INPUT_CAPS.audios) {
    problems.push(`${refAudios.length} audios exceeds ModelArk's published cap of ${ARK_INPUT_CAPS.audios}`);
  }

  return problems;
}

/**
 * Assigns exactly one role to every asset, or refuses.
 *
 * Authority is never inferred from media type, upload order or filename — the
 * caller states which asset owns the opening frame by putting it in
 * `firstFrameUrl`, and anything ambiguous is an error rather than a guess. That
 * prohibition is the whole point of the original T12 rule and it survives here
 * even though the vocabulary shrank to what ARK reads.
 */
export function resolveReferenceAuthority(
  input: ResolveReferenceAuthorityInput,
): ReferenceAuthorityResult {
  const problems = findAuthorityConflicts(input);
  if (problems.length > 0) {
    throw new ValidationError(`reference authority is ambiguous:\n- ${problems.join('\n- ')}`);
  }

  const assignments: ReferenceAssignment[] = [];

  if (input.firstFrameUrl !== undefined) {
    assignments.push({ url: input.firstFrameUrl, role: ARK_ROLES.firstFrame });
  }
  if (input.lastFrameUrl !== undefined) {
    assignments.push({ url: input.lastFrameUrl, role: ARK_ROLES.lastFrame });
  }
  for (const url of input.referenceImageUrls ?? []) {
    assignments.push({ url, role: ARK_ROLES.referenceImage });
  }
  for (const url of input.referenceVideoUrls ?? []) {
    assignments.push({ url, role: ARK_ROLES.referenceVideo });
  }
  for (const url of input.referenceAudioUrls ?? []) {
    assignments.push({ url, role: ARK_ROLES.referenceAudio });
  }

  return { scenario: scenarioFor(input), assignments };
}

function scenarioFor(input: ResolveReferenceAuthorityInput): ArkScenario {
  if (input.firstFrameUrl !== undefined) {
    return input.lastFrameUrl !== undefined ? 'first-and-last-frame' : 'first-frame';
  }
  const hasRefs =
    (input.referenceImageUrls?.length ?? 0) > 0 ||
    (input.referenceVideoUrls?.length ?? 0) > 0 ||
    (input.referenceAudioUrls?.length ?? 0) > 0;
  return hasRefs ? 'multimodal-reference' : 'text-only';
}
