---
name: media-forge:mf-audio
description: "Use when the user asks for media-forge video audio, dialogue, lip-sync, music, sound effects, ambience, beat-sync, audio-reference mapping, desync troubleshooting, or sound-driven visual timing, on any of Veo, Kling, Higgsfield, or Seedance."
triggers:
  - "dialogue"
  - "lip-sync"
  - "sound design"
  - "audio desync"
  - "ambience"
  - "beat sync"
allowedTools: [Read, Grep]
---

# media-forge:mf-audio

Use this for dialogue, lip-sync, sound layers, music, ambience, beat-sync, audio-reference mapping, desync troubleshooting, or sound-driven visual timing. Audio should support the visible beat instead of becoming a second competing prompt. The craft rules below are provider-agnostic; where a provider has a dedicated audio mechanism (Kling's `media_kling_lip_sync` text/audio-driven modes, Seedance's native joint audio+video generation, Higgsfield Speak) it is marked **provider-specific**.

Load `[ref:audio-guide]` for per-language dialogue capacity, the voice-reference lip-sync path, beat-sync, desync repair, audio-reference conflicts, and multi-character workarounds. Load `[ref:audio-post-delivery]` when the user needs stems, M&E, dubbing, loudness, sync, mix, or delivery guidance.

## Intent

Half of every emotion enters through the ears, and users almost always forget sound until its absence makes the clip feel dead. The soul here is giving every scene its sound before being asked — the room's breath, the action's evidence, the line that lands. When they hear it, they realize it was always part of what they meant.

## Core Rules

Keep dialogue short, quote spoken lines, and assign every line to a named speaker. Prefer locked or stable framing for lip-sync. Remove head-turning, large face motion, extreme camera moves, or busy hand gestures while mouth accuracy matters. **Seedance-specific:** treat `@Audio1` as a rhythm, pacing, mood, voice-tone, or ambience reference unless the active provider documents exact playback behavior; on providers that accept a spoken-voice reference, field reports indicate an attached voice clip can drive lip-sync directly — the model syncs to your audio instead of synthesizing speech, the most reliable field-reported path for non-English dialogue. Use only rights-cleared voices.

Reliability is probabilistic and language-dependent: field reports rank Mandarin strongest for lip-sync, English a close second, with Japanese, Korean, Russian, and others weaker. Keep non-English lines very short or use a voice reference, and budget retakes rather than promising a clean voiced take. See `[ref:audio-guide]` for the field-observed per-language dialogue-capacity table.

## Sound Layer Pattern

Use compact layers: `Dialogue: ... Sound: ... SFX: ... Music: ... Silence: ...`. Include only the layers that matter. Silence is valid when it sharpens drama or avoids confusing lip-sync.

| Need | Stable audio direction |
|---|---|
| Lip-sync | `Character A, locked medium close-up, says "I found it." Clear dry dialogue, no head turn.` |
| Product ad | `Sound: low room tone. SFX: magnetic click on lid open, soft glass chime at final frame.` |
| Beat sync | `@Audio1 provides tempo only; light pulses and foot taps match the downbeat.` |
| Drama | `Distant rain and refrigerator hum; no music during the line.` |
| Action | `Breathing grows louder, shoe squeak at landing, metal door buzzer at endpoint.` |

## Multi-Character Dialogue

Use one speaker per short clip when reliability matters. If two characters must speak, separate turns and keep the camera stable: `Character A says... pause. Character B answers...`. For complex exchanges, recommend generating controlled single-speaker clips and compositing in post.

## Failure Fixes

If dialogue desyncs, shorten the line, lock the camera, remove head turns, clean the audio role, and reduce competing SFX. If the wrong speaker talks, assign tags and split lines by speaker. If audio is ignored, remove extra music/SFX instructions and make the reference role explicit.

If audio and video references fight each other, mute the reference video before upload when possible, or make the priority explicit: `@Video1 controls camera only; @Audio1 controls tempo and energy` (Seedance-specific reference-binding syntax — see `[skill:mf-video-prompt]`).

## Sequence State

When sequence state is present, inherit completed dialogue, active dialogue, ambience, music phase, SFX phase, current clip scope, continuity locks, exact reference tags, and reserved future beats. Do not repeat completed dialogue unless the user explicitly asks for a reprise. Continue or intentionally change the audio phase instead of restarting it by accident.

## Output Contract

Return speaker map, quoted dialogue, sound layers, audio reference role, lip-sync constraints, post/delivery notes if needed, and a compact prompt-ready audio block.
