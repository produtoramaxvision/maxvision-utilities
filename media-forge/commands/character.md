---
description: "Generate a full character sheet: identity-locked portrait, turnaround, and expression sheet"
argument-hint: "<name> <description>"
allowed-tools: Read, Write, Bash, Grep, Glob
---

# /media-forge:character

Full character sheet workflow. Takes a character name and description and produces: hero portrait (4K), turnaround grid (4 views), and expression sheet (5 expressions).

## Instructions

1. Take character name and description from $ARGUMENTS (format: `<name> <description>`).
2. Invoke the `media-forge:character-sheet` skill with the combined input.
3. Report progress as each asset is generated (hero -> turnaround -> expressions).
4. On completion, display the character sheet manifest: all asset paths organized by view/expression.
5. Include the identity-lock descriptor string so the user can reference it for future consistency.
