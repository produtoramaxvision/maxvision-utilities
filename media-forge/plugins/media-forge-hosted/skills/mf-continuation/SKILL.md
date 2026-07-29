---
name: media-forge:mf-continuation
description: "Use when the user asks to continue, extend, make the next part, repair the tail, bridge between known frames, re-anchor drift, or create a successor prompt from accepted footage, on any media-forge video provider (Veo, Kling, Higgsfield, Seedance)."
triggers:
  - "continue this clip"
  - "extend the video"
  - "next part"
  - "bridge clip"
  - "re-anchor drift"
  - "repair the tail"
allowedTools: [Read, Grep]
---

# media-forge:mf-continuation

Use this for seamless continuation, intentional next shots, bridge clips, tail repair, and re-anchoring after drift. A continuation prompt must be grounded in accepted footage, not only in the old plan. This applies across providers — Kling's `media_kling_video_extend` and Seedance's chained i2v calls are two different mechanisms for the same underlying discipline described here.

Load `[ref:continuation-handoff]`, `[ref:sequence-project-state]`, `[ref:prompt-compiler]`, `[ref:reference-transfer-contract]`, and `[ref:continuity-qc]`. Load `[ref:failure-atlas]` when the continuation failed or drift is visible. Load `[ref:directing-engine]` so the next clip inherits the project's directorial voice and its position on the long-form spine; the look never re-rolls between clips.

## Intent

The user already made something they accepted, and now they are trusting the story to continue from exactly where it really landed — not where the plan hoped it would. The soul of this skill is fidelity to what actually happened: honor the accepted footage as the only truth, refuse to invent the bridge, and ask for the real ending rather than guess it. Continuity is a promise that the film the user already has will not be quietly contradicted.

## Required Input Gate

Before writing any continuation prompt, require:

- `project_id`;
- current `clip_id`;
- valid `parent_clip_id`;
- `scene_id`, and whether the next clip stays inside the scene or crosses a scene boundary;
- full-story objective;
- final story outcome;
- next planned narrative job;
- next clip `felt_intent` — what the viewer should feel or notice;
- accepted previous clip or accepted final frame;
- `observed_end_state`;
- continuity locks;
- inherited directorial voice and arc position;
- exact reference registry;
- active provider or conservative provider profile.

If the source is unavailable, say: "I have the story plan, but I do not have the actual ending of the previous generation. Upload the clip or its final frame, or describe exactly what is visible at the end. I should not invent the continuation state."

**Capability gap:** media-forge does not currently provide a last-frame extraction command. It bundles `ffmpeg-static` (resolved via `src/core/ffmpeg.ts`) but today only *consumes* a `lastFrameImagePath` as continuation input — it does not extract one from a video. Until this gap closes (tracked as T9-d), extract the last frame with your own local ffmpeg install (e.g. `ffmpeg -sseof -1 -i <take>.mp4 -update 1 -q:v 1 last-frame.jpg`) or another tool, then supply the resulting image path.

Once a frame or clip is attached **and this client can actually open it**, run the Observation Fast Path from `[ref:continuation-handoff]`: the agent fills the observation record from what is visible and asks only about what the attachment cannot show (for a still: open motion, camera movement phase, audio phase). Never hand the sensing work back to the user when the pixels are genuinely in hand.

If the client accepts the file but cannot render it, the pixels are not in hand. Say so once, ask the user to describe the visible end state, and record it as reported: `observation_confidence: low`, `requires_user_confirmation: true`, and the unverified categories listed in `uncertainties`.

Do not hide this uncertainty by writing a speculative prompt.

## Continuation Types

`seamless_continuation`: same shot, same geography, same open motion, same or motivated camera continuation, and accepted previous footage as the source.

`intentional_next_shot`: an editorial cut is appropriate. Story continuity matters, but exact frame continuity is not promised. Do not call it seamless.

`bridge_between_known_states`: a defined start state and end state must be connected, often with first/last-frame generation when the active provider supports it.

`repair_tail`: the previous final seconds failed. Repair, edit, or regenerate the tail before continuing because continuing from a failed tail amplifies the error.

`reanchor_after_drift`: identity, detail, geography, motion, audio, or world continuity degraded. Return to canonical identity, the strongest accepted final frame, a stable source clip, or a new intentional shot using canonical references.

## Scene Boundary Rule

Crossing a scene boundary defaults to `intentional_next_shot` opening from canonical references. Do not promise `seamless_continuation` across a scene boundary; if the user explicitly asks for one, record the reason and treat the result as high drift risk.

## Canon Rule

Accepted observed footage overrides planned state. If the plan says the subject reached the car door but the accepted clip ends two steps away, the next prompt begins two steps away. It does not replay the terminal exit, and it does not assume the subject is inside the car.

Rejected footage never updates canon and never becomes a parent source.

Track `extension_depth` as consecutive output-sourced generations since the last canonical re-anchor; it resets to 0 when a clip opens from canonical references. At the scene's `max_chain_depth` (default 2, hard ceiling 3), re-anchor by schedule instead of extending again. Visible drift before the cap is an immediate `reanchor_after_drift`.

## Output Contract

Return:

1. Continuation type.
2. Source evidence used.
3. Observed end state.
4. Next clip contract.
5. Intent echo: one line — "this clip exists so the viewer feels X" — confirmed before generation spends money.
6. Continuity locks and allowed changes.
7. Completed beats to exclude.
8. Reserved future beats to exclude.
9. Final natural-language video prompt for the current clip only.
10. Updated Project State Capsule or a request for missing source evidence.
