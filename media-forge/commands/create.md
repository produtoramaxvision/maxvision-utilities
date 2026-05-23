---
description: "Generate image/video from a brief — orchestrated end-to-end with quality review"
argument-hint: "<brief>"
allowed-tools: Read, Write, Bash, Grep, Glob
---

# /media-forge:create

End-to-end media generation. Takes a user brief and runs the full pipeline: prompt refinement, domain routing, generation, quality review, and retry.

## Instructions

1. Take the user's brief from $ARGUMENTS.
2. Invoke the `media-forge:create` skill with the brief as input.
3. Report progress at each stage: refinement, routing decision, generation, review verdict.
4. On completion, display the final asset paths, quality scores, and cost summary.
5. If the verdict fails after 3 retries, display the final error class and fix directive so the user can adjust their brief.
