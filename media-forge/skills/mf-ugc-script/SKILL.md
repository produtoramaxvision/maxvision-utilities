---
name: media-forge:mf-ugc-script
description: "Use when the user needs a timed short-form script — TikTok, Reels, Shorts, UGC ad — with beats, visual cues and spoken lines. Turns a brief into something producible."
triggers:
  - "write the script"
  - "short form script"
  - "reel script"
  - "tiktok script"
  - "script for my ad"
allowedTools: [Read, Grep]
---

# media-forge:mf-ugc-script

Turn a brief into a timed script where every line has a picture attached. If
there is no brief yet, run `[skill:mf-ugc-brief]` or `[skill:mf-ugc-decode]`
first — scripting from nothing produces the generic thing both of those exist to
prevent.

## Intent

A short-form script is not prose with timestamps. It is a sequence of visual
states, and the words are what a person says while the picture changes. Written
the other way round — copy first, visuals bolted on — the result reads as an
advertisement being performed, which is the one thing UGC must not be.

## Shape

```
[0:00-0:03]  HOOK
             VISUAL: what is on screen, as a shot
             AUDIO:  what is said, if anything

[0:03-0:XX]  BEAT n
             VISUAL:
             AUDIO:
```

Rules that make the shape hold:

- **One thing per beat.** If a beat needs "and", it is two beats.
- **VISUAL before AUDIO, always.** Writing the line first is how a script ends
  up unshootable.
- **A beat with no visual change is a beat that gets cut.**
- **The product is on screen before the CTA**, not simultaneously with it.

Lengths that work: 15s = hook + 2 beats + CTA. 30s = hook + 4 beats + CTA.
60s only when there is a real demonstration to watch; otherwise it is a 30s
script with padding.

## Anti-slop — the part that decides whether it sounds human

`[skill:mf-antislop]` is the authority and this must not diverge from it. Load
it rather than re-deriving. What matters most here:

**Never:** "Let's dive in" · "In this video" · "Game changer" · "Trust me" ·
three-word rhythmic lists · a rhetorical question the speaker answers
immediately · adjectives doing the work a demonstration should do.

**Instead:** connectors that carry logic — "so", "which means", "that is why".
Contrast — "not X, but Y". Mechanism — say WHY it works, once, concretely.

If a line could be said about a competitor's product without changing a word, it
is not a line about this product.

## Two registers

- **Punchy (15-30s)** — short sentences, one idea each, cuts on the beat. Best
  when the product's value is visible.
- **Deep dive (45-60s)** — one continuous take feel, the speaker builds an
  argument. Best when the value needs explaining, and only worth it if there is
  something to explain.

Pick before writing, not after. They are different scripts, not different
lengths of one.

## Self-check before handing off

- Read the first line alone. Does it work with no context? If not, the hook is
  in beat two and the video starts late.
- Remove the product. Does anything remain interesting? If yes, the hook is
  doing the work and that is correct.
- Read only the VISUAL lines. Is it a video? If not, this is a voiceover.

## Then

`[skill:mf-ugc-produce]` maps the beats onto `marketing_studio_video`. Long
sequences that exceed one generation go through `[skill:mf-sequence]`.
