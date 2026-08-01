---
name: media-forge:mf-ugc-produce
description: "Use when a UGC brief or script is ready and it is time to generate — maps the brief onto Higgsfield Marketing Studio avatars, hooks, settings and products, and submits with the cost known first."
triggers:
  - "generate the ugc video"
  - "produce this ad"
  - "submit to marketing studio"
  - "which avatar should I use"
  - "make the video now"
allowedTools: [Read, Grep, Bash]
---

# media-forge:mf-ugc-produce

The step that spends money. Everything upstream — `[skill:mf-ugc-brief]`,
`[skill:mf-ugc-decode]`, `[skill:mf-ugc-hooks]`, `[skill:mf-ugc-script]` —
exists so this step has nothing left to guess.

## Intent

Marketing Studio does not take a description of a person; it takes an **avatar
id**. Not a description of a room; a **setting id**. The brief has to be
resolved against the account's real catalogue before anything is submitted, and
resolving it is free. Submitting an unresolved brief is how a generation gets
paid for twice.

## Order of operations

### 1. Resolve the ids — free

```
media_higgsfield_ms_assets { kind: "avatars" }      → 40 presets, id + name + gender + preview
media_higgsfield_ms_assets { kind: "hooks" }        → 9 presets, id + the prompt each one renders
media_higgsfield_ms_assets { kind: "settings" }     → 14 named scenes
media_higgsfield_ms_assets { kind: "products" }     → the account's own products
media_higgsfield_ms_assets { kind: "ad-formats" }   → 42 DTC formats
```

Read-only, no credits. `query` filters by name.

Show the user what was picked and why before submitting. An avatar is a face
that will represent their brand; it is not a parameter to choose silently.

### 2. Know the price — free

`marketing_studio_video` is **5 credits per second** at 720p, with 480p at 0.7x
and 1080p at 2.0x. So the 15-second default is 75 credits at 720p, 150 at 1080p.

The handler asks `higgsfield generate cost` for the exact figure before
submitting, so the number the cost guard enforces is the platform's own, not a
table in this repo. If the guard blocks, the answer is a shorter or lower-res
generation — not raising the cap.

### 3. Submit

```
media_higgsfield_marketing_studio {
  prompt, durationSec, resolution,
  avatarIds, hookId, settingId, productIds,
  mode: "ugc", specificMode: "default", aspectRatio: "9:16"
}
```

Defaults are the platform's: `mode: ugc`, `9:16`, 720p, 15s.

**Two rules the platform enforces, checked locally so the CLI is not spent
learning them:**

- `adReferenceId` cannot be combined with `hookId` or `settingId` — an ad
  reference already carries both.
- `productIds` and `webProductIds` cannot both be set — one is uploaded, the
  other scraped from a URL; picking both leaves the model no way to choose.

### 4. Poll and download

`media_higgsfield_poll` then `media_higgsfield_download`. The job id returned is
this repo's; the mapping to Higgsfield's own is persisted, so poll takes the id
that was handed back.

## Choosing between the studios

- **`media_higgsfield_marketing_studio`** — a person selling something. Avatars,
  hooks, products, 9:16.
- **`media_higgsfield_cinema_studio`** — a scene with craft. Camera style, light
  scheme, colour grade, genre. No avatars.

Same price, same duration ceiling, different question being answered. A
testimonial in Cinema Studio loses the credibility that made it a testimonial.

## For images rather than video

- `media_higgsfield_product_photoshoot` — 10 modes, from `product_shot` to
  `ad_creative_pack` and `hero_banner`.
- `media_higgsfield_marketplace_cards` — main, secondary and A+ listing assets.

Both default to `enhanceOnly: true`, which returns the prompts Higgsfield's
backend assembles **without generating**. Use it: comparing three modes costs
nothing before one is chosen.

## Cost discipline

- Preview with `enhanceOnly` before spending on the image tools.
- 480p to check composition, 1080p once. 480p is 0.7x, so a check costs a third
  of a final pass.
- Credits come from the subscription pool, not the API pool — the two are
  separate balances with separate rates. `higgsfield account status` is the one
  that governs everything on this page.
