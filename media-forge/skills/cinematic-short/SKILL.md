---
name: cinematic-short
description: "Cinematic short video workflow: storyboard -> frame imagery -> video chain. Triggers: cinematic short, narrative video, short film."
allowed-tools: Read, Write, Bash, Grep, Glob
preamble-tier: 1
user-invocable: true
---

# media-forge:cinematic-short

Cinematic short film workflow. Converts a narrative brief into a storyboard, generates key frame images, then chains Veo 3.1 video clips into a cohesive short.

## Workflow

1. Dispatch `media-forge:prompt-engineer` with narrative brief. Receive `refined_spec.json` including scene breakdown.
2. For each scene in the storyboard: dispatch `media-forge:cinematic-director` to generate a key frame image (4K, 16:9).
3. For each key frame: dispatch `media-forge:video-editor` in `i2v` mode to create a video clip (6s or 8s).
4. Dispatch `media-forge:quality-reviewer` on each clip. Retry on fail (≤3 per clip).
5. Return ordered clip paths and `cinematic-manifest.json`.

## When to use

Invoke when user wants a short cinematic film, narrative video, or music video from a textual or visual brief.

## Outputs

- Ordered video clip paths
- Key frame images
- `cinematic-manifest.json` with scene breakdown and total duration
- Aggregate cost in USD
