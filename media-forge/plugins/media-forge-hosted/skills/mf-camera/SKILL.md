---
name: media-forge:mf-camera
description: "Use when the user asks for camera movement, shot scale, lens feel, framing, one-take direction, dolly, pan, tilt, push-in, handheld, aerial, macro, or camera-transfer guidance for any media-forge video provider (Veo, Kling, Higgsfield, Seedance)."
triggers:
  - "camera movement"
  - "dolly"
  - "shot scale"
  - "lens"
  - "framing"
  - "handheld"
  - "camera reference"
allowedTools: [Read, Grep]
---

# media-forge:mf-camera

Use one clear camera idea per short clip unless the user asks for a multi-shot sequence. The best camera direction has a start frame, movement, speed, subject relationship, and endpoint. Avoid stacking moves that fight each other, such as drone rise, dolly-in, handheld shake, and orbit in the same five-second shot. This camera grammar is provider-agnostic craft language — it applies whether the underlying call goes to Veo, Kling, Higgsfield, or Seedance. For Kling's own DoP-verb cheatsheet and Higgsfield's Cinema Studio lens dictionary, see `kling-prompting` and `higgsfield-prompting`; this skill is the shared vocabulary underneath both.

Load `[ref:quick-ref]` for prompt assembly, `[ref:cinematography-shot-language]` for professional shot contracts, `[ref:directing-engine]` to derive the move from the scene's one intention so it reinforces light, performance, and sound instead of competing, and `[ref:vocab/zh]` or `[ref:vocab/ru]` when camera wording must be multilingual.

## Intent

When a user asks about camera, they are really asking where the viewer's body stands and what the viewer is made to feel from there. Camera grammar is empathy mechanics: a push-in is leaning closer, a locked frame is holding your breath. Choose the move that puts the audience where the user's feeling lives.

## Camera Contract

State: shot scale, angle, movement, speed, subject relationship, and endpoint. A prompt-ready camera phrase should be physically possible and tied to the subject's action.

| Need | Strong phrase | Avoid |
|---|---|---|
| Emotional realization | `slow dolly-in from medium close-up to tight close-up as Character A lowers the envelope` | `dramatic cinematic zoom` |
| Product reveal | `controlled slider move from silhouette to front three-quarter hero angle, ending on the label` | `dynamic product camera` |
| Scale | `low-angle crane up from boots to skyline, ending behind the character's shoulder` | `epic wide moving shot` |
| Instability | `subtle handheld shoulder camera, small breathing sway, subject kept centered` | `shaky chaotic camera everywhere` |
| Precision detail | `locked macro shot, focus stays on the watch gears while the second hand clicks once` | `cool close-up details` |

## Lens and Framing Anchors

Use lens anchors only when they improve direction: `24mm wide lens for spatial energy`, `35mm natural street perspective`, `50mm portrait compression`, `85mm shallow close-up`, or `macro lens for material detail`. Pair lens words with subject distance and motion; do not stack lens numbers as decoration.

## Move Selection

Use **locked-off** shots for lip-sync, product identity, and delicate VFX. Use **dolly-in** for discovery or realization. Use **tracking** for travel, pursuit, and product motion. Use **orbit** only when the subject can remain clear from all sides. Use **crane or drone** for scale, arrival, or reveal. Use **handheld** only when realism matters more than precision.

## Continuity Rules

For multi-character scenes, anchor the camera to named tags: `camera holds Character A in foreground while Character B crosses behind`. For I2V, preserve the image composition unless the user explicitly wants a reframing. For a video reference, state whether it transfers camera movement, action rhythm, or blocking; do not let it transfer identity unless authorized.

For complex camera movement, a video reference often works better than a long verbal stack. **Seedance-specific:** `@Video1 controls camera rhythm only; do not transfer performer, room, logo, or identity` is Seedance's reference-binding syntax (see `[skill:mf-video-prompt]`); Kling Elements and Higgsfield's reference flows use their own binding mechanisms.

## Conflict Rule

If the user gives several incompatible moves, choose one primary camera move and put the rest into optional variants. If the shot needs multiple beats, recommend splitting into separate clips or a time-segmented prompt.

## Sequence State

When sequence state is present, inherit the observed camera phase, screen direction, current clip scope, continuity locks, exact reference tags, and reserved future beats before choosing a move. A continuation camera phrase must begin from the accepted source frame or observed end state; do not restart a pan, focus pull, or tracking move unless an intentional next shot declares the reset.

## Output Contract

Return the selected camera phrase, why it fits the shot, conflicts removed, fragile anchors, endpoint, and a prompt-ready integrated sentence.
