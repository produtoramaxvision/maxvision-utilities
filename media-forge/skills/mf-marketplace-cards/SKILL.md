---
name: media-forge:mf-marketplace-cards
description: "Use when the user needs marketplace listing images — Amazon-style main image, secondary product images, A+ content modules. Covers the four scopes and how to chain secondaries off an approved main."
triggers:
  - "marketplace listing images"
  - "amazon main image"
  - "A+ content"
  - "product listing photos"
  - "secondary images"
allowedTools: [Read, Grep, Bash]
---

# media-forge:mf-marketplace-cards

Listing imagery has rules that ordinary product photography does not — a main
image with a white background and no props, secondaries that answer objections
in order, A+ modules that are laid out rather than shot. Higgsfield keeps the
marketplace references and prompt templates on its side and returns
`nano_banana_2` prompts; this covers choosing the scope and chaining the set.

## Intent

A listing is a sequence, not a gallery. The main image earns the click, the
secondaries answer the objections that stop the purchase, the A+ modules close
the ones that survive. Generating them independently produces a set that looks
assembled by different people — which is exactly how it reads to a buyer.

That is why `mainJobId` exists: approve the main image, then chain the rest off
it so the product is the same object at the same angle throughout.

## The four scopes

| Scope | Produces | Use |
|---|---|---|
| `main` | The primary listing image | Start here, always |
| `product-images` | Secondaries — angles, details, in-use | After the main is approved |
| `aplus` | A+ / enhanced-content modules | Brand-registered listings |
| `full-set` | All three at once | Only when the product is well understood |

`full-set` is convenient and worse: it decides the main image and everything
downstream in one pass, so a main you would have rejected propagates through the
set. Prefer `main` → approve → chain.

## Chaining

```
1. media_higgsfield_marketplace_cards { scope: "main", prompt, imagePaths }
   → enhanceOnly by default; review, then generate

2. media_higgsfield_marketplace_cards {
     scope: "product-images",
     mainJobId: "<the completed main image job>",
     prompt, imagePaths
   }
```

`mainJobId` with `scope: "main"` is refused locally — chaining secondaries off a
main while asking for a new main is asking to regenerate the thing being chained
from, which cannot be what was meant.

## Inputs that matter here

- **`category`** — marketplace category. Drives the compliance rules the backend
  applies (background, props, text overlay allowances). Supply it; the rules
  differ enough between categories to be visible.
- **`visualStyle`** — constraints on the look. Use for brand consistency across
  listings, not for art direction.
- **`productUrl`** — an existing listing to pull context from.
- **`brandContext` / `productContext`** — as in `[skill:mf-product-photo]`;
  productContext prevents scale errors, which on a listing become returns.

## Preview is the default

`enhanceOnly: true` returns the assembled prompts and spends nothing. For a
full-set that is four or more images, previewing first is the difference
between one paid pass and two.

## When this is the wrong tool

- Campaign or social imagery → `[skill:mf-product-photo]`.
- A person demonstrating the product → `[skill:mf-ugc-produce]`.
- Video for a listing → `media_higgsfield_marketing_studio` with
  `specificMode: "web_product"`.
