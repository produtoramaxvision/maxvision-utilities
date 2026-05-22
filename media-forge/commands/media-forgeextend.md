---
description: Extend an existing video via Veo 3.1 +7s extension hops (max 20 hops / 148s)
argument-hint: "<jobId|videoPath> <directive>"
allowed-tools: Read, Write, Bash, Grep, Glob
---

# /media-forge:extend

Video extension. Takes an existing video (by job ID or file path) and a continuation directive, then extends it using Veo 3.1 extension chains (+7s per hop at 720p).

## Instructions

1. Parse $ARGUMENTS: first token is job ID or video path; remainder is the continuation directive.
2. Invoke the `media-forge:extend-video` skill with the source video and directive.
3. Report progress per hop: hop index, new duration, download status.
4. Warn the user if the requested total duration exceeds 148s (20 hops maximum).
5. On completion, display the extension manifest: hop chain, durations, and cost per hop.
6. Remind the user of the 2-day TTL — download the final video immediately.
