---
name: media-forge:scene-compose
description: Multi-image scene composition with role-labeled refs (up to 14). Triggers: scene compose, composition, multi-image scene.
allowed-tools: Read, Write, Bash, Grep, Glob
preamble-tier: 1
user-invocable: true
---

# media-forge:scene-compose

Multi-image scene composition workflow. Merges up to 14 role-labeled reference images into a single coherent scene using Nano Banana Pro.

## Workflow

1. Collect reference images from $ARGUMENTS (paths or URLs) and user's scene description.
2. Validate reference count <= 14. Reject with guidance if exceeded.
3. Assign role labels to each reference: `character`, `outfit`, `scene`, `lighting`, `prop`, `texture`, or `style`.
4. Dispatch `media-forge:prompt-engineer` for scene composition prompt. Receive `refined_spec.json`.
5. Dispatch `media-forge:scene-composer` with role-labeled references and spec. Receive composed scene.
6. Dispatch `media-forge:quality-reviewer`. Return verdict and final asset.

## When to use

Invoke when user provides multiple source images and wants them composited into a single scene. Ideal for character-in-scene placement, product-in-environment, and multi-element compositions.

## Outputs

- Composed scene image (4K)
- Quality verdict
- Cost in USD
