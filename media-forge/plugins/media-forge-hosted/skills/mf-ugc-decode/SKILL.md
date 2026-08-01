---
name: media-forge:mf-ugc-decode
description: "Use when the user has a reference UGC video or ad that works and wants it remade for their own product — reverse-engineer the hook, structure, performance and camera into a reusable brief."
triggers:
  - "reverse engineer this ad"
  - "remake this video for my product"
  - "analyze this ugc"
  - "why does this ad work"
  - "copy this format"
allowedTools: [Read, Grep]
---

# media-forge:mf-ugc-decode

Take something that already performs and extract the part that made it perform,
separated from the part that was just that product. Without a reference, use
`[skill:mf-ugc-brief]` instead.

## Intent

Most "remakes" copy the surface — same set, same shot, same cadence — and lose
the thing that worked, which is almost always a tension in the first two seconds.
The job is to name that tension explicitly, then rebuild it around a different
product rather than reskin the footage.

If the reference cannot be watched, say so and decode from the user's
description; do not narrate a video you have not seen.

## Decode in four passes

### 1. Hook — the first 3 seconds

- What is on screen at frame one, before any speech?
- What is unresolved? A scroll stops because something is incomplete: a mess, a
  claim, an odd object, an interrupted action.
- When does the product first appear? Early product is an ad; late product is a
  story that happens to sell.

### 2. Structure

Beat by beat, with timecodes. For each: what happens, what changes, why the
viewer stays. Mark the beat where attention would drop if it were removed — that
is the load-bearing one, and it is the one the remake must keep.

### 3. Performance

- Energy and pace, not personality adjectives.
- Where do they look — lens, off-camera, the product?
- What are the hands doing? UGC credibility lives in hands.
- Speech rhythm: continuous, or cut between sentences?

### 4. Camera and light

- Held how: hand, propped, tripod? Visible shake or not?
- Light source and direction, in plain terms: window left, overhead kitchen,
  phone screen, ring light.
- Cut density: how many cuts, and what motivates each one.

## Output

```
HOOK            what happens · what is unresolved · why it stops the scroll
STRUCTURE       beats with timecodes · which beat is load-bearing
PERFORMANCE     energy · gaze · hands · speech rhythm
CAMERA + LIGHT  hold · shake · source · direction · cut density
TRANSFERABLE    what carries to another product
PRODUCT-BOUND   what only worked because it was THAT product
```

The last two lines are the whole point. A remake that copies the
PRODUCT-BOUND column is a worse version of the original.

## Then

Feed TRANSFERABLE into `[skill:mf-ugc-brief]` as the starting shape, and use
`[skill:mf-ugc-hooks]` if the hook is the part being replaced. Produce through
`[skill:mf-ugc-produce]`.

The same rules from `mf-ugc-brief` apply to everything written here: no brand
names, no demographic descriptors, realism markers explicit, camera matched to
the claim.
