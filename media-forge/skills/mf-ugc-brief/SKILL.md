---
name: media-forge:mf-ugc-brief
description: "Use when the user wants UGC content from scratch — a creator-style ad, testimonial, unboxing, product demo, or short-form spot — and has a product but no reference video. Builds the brief that mf-ugc-script and mf-ugc-produce consume."
triggers:
  - "ugc from scratch"
  - "creator style ad"
  - "make me a ugc video"
  - "no reference video"
  - "brief for a product ad"
allowedTools: [Read, Grep]
---

# media-forge:mf-ugc-brief

Turn a product and an audience into a brief concrete enough that the next step
has nothing left to invent. This is the entry point when there is no reference to
copy — for reverse-engineering something that already works, use
`[skill:mf-ugc-decode]`.

## Intent

A UGC ad fails in the first second or not at all. Everything here exists to make
that second earned rather than lucky: a specific person, doing a specific thing,
for a reason the viewer recognises before they decide to keep watching.

Generic input produces generic output, and the model cannot tell the difference.
So the brief is not filled in silently — it is asked for, one question at a time,
and a vague answer is pushed back on before it becomes a vague video.

## Ask before building

One at a time, in this order. Stop and ask if the answer is thin.

1. **What is the product, and what does it visibly do?** Not the category — the
   observable change. "Blender" is a category; "ice becomes drinkable in nine
   seconds" is a shot.
2. **Who is talking, and why would they own this?** Not demographics. The
   situation that makes them credible: someone who just moved, someone whose
   knees hurt, someone who cooks at 1am.
3. **Where does this happen?** A named room beats an adjective. Bedroom at
   night, car in a parking lot, kitchen mid-mess.
4. **What is the single objection this ad answers?** Price, effort, skepticism,
   "I already have one". One. An ad that answers three answers none.
5. **Platform and length.** TikTok / Reels / Shorts, and seconds. This decides
   pacing and aspect ratio, not just export settings.
6. **What must NOT appear?** Competitor names, claims the brand cannot make,
   people the brand cannot show.

## What a finished brief contains

```
PRODUCT      what it is · the visible change · the one objection answered
SPEAKER      the situation that makes them credible · energy · how they hold it
SETTING      named place · time of day · what is visible in frame besides them
HOOK         first 3 seconds, as a shot — not a slogan
BEATS        3-5 beats, each one thing happening
CTA          what the viewer does next, stated once
CONSTRAINTS  aspect ratio · duration · forbidden content
```

## Rules that survive contact with the model

- **Never a brand name in a prompt.** Models trained on the open web will render
  a logo that is not the product's. Describe the object.
- **Never demographic descriptors for the speaker.** Age, ethnicity and body
  descriptors either get ignored or get stereotyped. Describe visible markers:
  hair, clothing, posture, energy, what they are holding.
- **Separate who they are from how they are styled.** Identity in one clause,
  wardrobe in another, so either can change without disturbing the other.
- **Realism markers are explicit or absent.** "Visible skin texture, natural
  imperfections, no AI smoothing" — without them the render drifts to plastic.
- **Camera matches the claim.** Handheld phone for a testimonial; anything
  smoother reads as an ad and loses the credibility the format is for.

## Where this brief goes

- `[skill:mf-ugc-script]` turns the beats into a timed script.
- `[skill:mf-ugc-produce]` maps SPEAKER, SETTING and HOOK onto the real
  Marketing Studio assets in the signed-in account and submits.
- `[skill:mf-antislop]` should run over any generated copy before it ships.

Resolve the ids first with `media_higgsfield_ms_assets` — the account already
holds avatars, hooks and settings, and picking from them beats describing a
person from nothing.
