---
description: List the 3 LOCKED top-tier model IDs with capabilities
argument-hint: ""
allowed-tools: Read, Grep, Glob
---

# /media-forge:models

Display the three LOCKED model IDs used by media-forge with their capabilities. These model IDs are fixed and must never be substituted.

## Instructions

Display the following information exactly:

---

## media-forge — LOCKED Model IDs

These 3 model IDs are fixed. Never substitute or invent alternatives.

### gemini-3-pro-image-preview — Nano Banana Pro
- **Type:** Image generation
- **Aspect ratios:** 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9
- **Image sizes:** 1K, 2K, 4K
- **Reference images:** Up to 14 (role-labeled)
- **Person generation:** ALLOW_ALL, ALLOW_ADULT, ALLOW_NONE
- **Best for:** Creative work, 4K output, multi-ref compositions, text rendering

### imagen-4.0-ultra-generate-001 — Imagen 4 Ultra
- **Type:** Image generation
- **Aspect ratios:** 1:1, 3:4, 4:3, 9:16, 16:9
- **Image sizes:** 1K, 2K (no 4K)
- **Number of images:** 1 per request
- **Best for:** Seed-reproducible outputs

### veo-3.1-generate-preview — Veo 3.1 Pro
- **Type:** Video generation
- **Aspect ratios:** 16:9, 9:16
- **Durations:** 4s, 6s, 8s
- **Resolutions:** 720p, 1080p, 4k (4k requires 8s)
- **Extension:** +7s per hop, 720p only, max 20 hops (148s)
- **Reference images:** Up to 3, ASSET type only
- **TTL:** 2 days — download immediately after generation
- **Best for:** All video generation and extension chains

---
