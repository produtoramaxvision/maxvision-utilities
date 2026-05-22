---
description: "Generate a coordinated multi-asset campaign (hero + variations + sizes)"
argument-hint: "<brief>"
allowed-tools: Read, Write, Bash, Grep, Glob
---

# /media-forge:campaign

Multi-asset campaign generation. Takes a campaign brief and produces a coordinated set of assets: hero image, format variations (1:1, 4:5, 9:16, 16:9), and size adaptations.

## Instructions

1. Take the campaign brief from $ARGUMENTS.
2. Invoke the `media-forge:campaign` skill with the brief.
3. Report progress as each asset is generated (hero first, then variations).
4. On completion, display the campaign manifest: all asset paths organized by format/size.
5. Include aggregate cost and quality scores for each asset.
