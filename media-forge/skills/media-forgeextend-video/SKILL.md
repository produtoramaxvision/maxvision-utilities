---
name: media-forge:extend-video
description: Extend existing video via Veo 3.1 +7s hops. Triggers: extend video, longer video, continuation.
allowed-tools: Read, Write, Bash, Grep, Glob
preamble-tier: 1
user-invocable: true
---

# media-forge:extend-video

Video extension workflow. Extends an existing video clip using Veo 3.1 extension chains (+7s per hop, 720p, max 20 hops).

## Workflow

1. Receive source video path and continuation directive from $ARGUMENTS.
2. Validate source video exists. Check current duration to calculate hops needed.
3. Guard: if requested total duration > 148s (20 hops), warn user and cap at 20 hops.
4. For each extension hop: dispatch `media-forge:video-editor` in `extend` mode with `hopIndex`.
5. Download each hop result immediately (2-day TTL — warn if operation age >36h).
6. Return extended video path chain and `extension-manifest.json`.

## When to use

Invoke when user has a video and wants to extend its duration. Each hop adds +7s at 720p. Maximum 20 hops = 148s total.

## Outputs

- Extended video paths (one per hop)
- `extension-manifest.json` with hop chain, durations, and total length
- Cost per hop and aggregate
