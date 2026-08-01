---
name: media-forge:mf-product-photo
description: "Use when the user needs product images — hero shots, lifestyle scenes, ad creative packs, moodboard pins, virtual try-on, restyles. Covers Higgsfield Product Photoshoot's ten modes and the free preview path."
triggers:
  - "product photo"
  - "hero shot"
  - "product photoshoot"
  - "lifestyle product image"
  - "ad creative pack"
allowedTools: [Read, Grep, Bash]
---

# media-forge:mf-product-photo

Ten named modes, a reference image, and a sentence of intent. Higgsfield's
backend assembles the structured prompt; the choice that matters is the mode.

## Intent

The prompt is not where the work is here. The backend already knows what a hero
banner looks like and what a moodboard pin looks like, and it writes a better
prompt for those than a generic description will. The work is picking the mode
that matches the deliverable, and looking at the assembled prompt before paying
for it.

## The ten modes

| Mode | Produces | Reach for it when |
|---|---|---|
| `product_shot` | Clean product on a controlled surface | Catalogue, PDP, the default |
| `hero_banner` | Wide, negative space for copy | Site header, email banner |
| `lifestyle_scene` | Product in a lived environment | Social, "in use" |
| `closeup_product_with_person` | Hands or partial figure with the product | Scale, tactility, texture |
| `virtual_model_tryout` | Product worn or held by a model | Apparel, accessories, wearables |
| `social_carousel` | A coherent multi-image set | Instagram carousel, a swipe sequence |
| `ad_creative_pack` | Several ad-shaped variations | Paid testing, a batch to choose from |
| `moodboard_pin` | Editorial, styled, Pinterest-shaped | Brand direction, aspirational |
| `conceptual_product` | Product rendered as an idea | Campaign, launch, abstract |
| `restyle` | Same product, different art direction | Refresh without a reshoot |

Mode drives aspect ratio, composition and lighting. Overriding `aspectRatio`
fights the mode; do it only when a placement demands it.

## Preview first — it is free

```
media_higgsfield_product_photoshoot {
  prompt: "sparkling lemonade can for a summer campaign",
  mode: "lifestyle_scene",
  imagePaths: ["./can.png"],
  enhanceOnly: true          // the default
}
```

Returns the prompts the backend built, `submitted: false`, no credits spent.
Compare two or three modes this way before generating any of them — the
assembled prompt tells you what the mode will actually do, which a name cannot.

Then `enhanceOnly: false` and `count` for variants. `count` maxes at 10 and
multiplies the cost linearly.

## Inputs that change the result

- **`imagePaths`** — the product reference. Local paths are uploaded
  automatically; no separate upload step. More angles help; up to 10.
- **`brandContext`** — palette, tone, what the brand is not. Cheap to add,
  materially changes styling.
- **`productContext`** — material, size, what it does. Prevents the model
  guessing scale wrong, which is the most common visible failure.

## When this is the wrong tool

- Marketplace listings with A+ modules → `[skill:mf-marketplace-cards]`.
- A person talking about the product → `[skill:mf-ugc-produce]`.
- Full art direction over a scene rather than a product →
  `media_higgsfield_cinema_studio`, or Nano Banana Pro / Imagen 4 Ultra through
  the image tools.

## Note on cost

Credits come from the subscription pool. `media_higgsfield_product_photoshoot`
does not go through the video cost guard — it is an image path — so the discipline
is the `enhanceOnly` default rather than a threshold. Check
`higgsfield account status` before a large `count`.
