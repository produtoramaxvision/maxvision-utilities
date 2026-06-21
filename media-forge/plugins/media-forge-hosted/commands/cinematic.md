---
description: "Generate a cinematic short: storyboard, key frames, and video chain"
argument-hint: "<brief>"
allowed-tools: Read, Write, Bash, Grep, Glob
---

# /media-forge:cinematic

Cinematic short film workflow. Takes a narrative brief and produces: storyboard breakdown, 4K key frame images, and Veo 3.1 video clips chained into a short film.

## Instructions

1. Take the narrative brief from $ARGUMENTS.
2. Invoke the `media-forge:cinematic-short` skill with the brief.
3. Report progress per scene: frame generation, video clip generation, quality review.
4. On completion, display the cinematic manifest: ordered clip paths, total duration, and cost.
5. Provide the concatenation order for the user to assemble clips with their video editor of choice.
