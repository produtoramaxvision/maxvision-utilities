---
name: media-forge:mf-avatar-forge
description: "Use when the user wants their OWN recurring on-camera presenter instead of one of Higgsfield's 40 preset avatars — generating a consistent face, uploading it, and registering it as a Marketing Studio avatar and/or a trained Soul-ID."
triggers:
  - "criar meu avatar"
  - "custom avatar"
  - "meu proprio apresentador"
  - "avatar da marca"
  - "train a soul id"
  - "consistent character across shots"
allowedTools: [Read, Grep, Bash]
---

# media-forge:mf-avatar-forge

The 40 avatars `media_higgsfield_ms_assets { kind: "avatars" }` returns are
Higgsfield's presets — Jayden, Mei, Clara. Good enough to test a format, wrong
for a brand that shows up weekly with the same face. This builds one you own.

## Intent

A custom avatar is not one good image. It is **one identity that survives being
re-rendered**, which is a different problem and the reason most attempts fail:
five separate generations of "a woman in her 30s, brown hair, studio light"
produce five different women, and nobody notices until the third ad.

So the pipeline is built around the consistency step, not around the prompt.

## The step that decides everything: gpt-image-2 cannot do this alone

`media_image_codex` runs **gpt-image-2**, and its input is `prompt`, `size`,
`outputDir`, `fileName`. **There is no reference-image parameter.** Every call
starts from nothing. So N calls give N different people, no matter how detailed
the prompt is.

`media_generate_image` runs **Nano Banana Pro** and takes up to **14
`referenceImages`**. That is the identity carrier.

Which means the split is not a preference:

| Step | Tool | Why that one |
|---|---|---|
| The **anchor** — one canonical frontal portrait | `media_image_codex` **or** `media_generate_image` | Either can invent a face |
| Every **variation** of that same face | `media_generate_image` with the anchor in `referenceImages` | Only this one can be shown who the person is |

Use `media_image_codex` for the anchor when the account is on the OAuth path
(no `OPENAI_API_KEY`), where it costs nothing beyond the ChatGPT plan. With
`OPENAI_API_KEY` set it is metered and needs
`MEDIA_FORGE_CODEX_IMAGE_USD_PER_IMAGE`.

`gpt-image-2` also has **no transparency** — it does not support transparent
backgrounds, and gpt-image-1.5 is excluded from this repo. If the avatar needs
real alpha, the anchor has to come from Nano Banana Pro or Imagen 4 Ultra.

## Pipeline

### 1. Write the identity, once

One paragraph, reused verbatim in every prompt from here on. Copy-paste it —
paraphrasing it is how the face drifts.

Rules that come from `[skill:mf-ugc-brief]` and apply with more force here:

- **No demographic descriptors.** Age, ethnicity and body labels get ignored or
  stereotyped. Visible markers only: hair length and colour, facial structure in
  concrete terms, posture, what they habitually wear.
- **Identity and styling in separate clauses.** The wardrobe changes per ad; the
  face must not. Two clauses means one can be edited without disturbing the
  other.
- **Realism markers explicit**: visible skin texture, natural imperfections, no
  AI smoothing. Absent, the render drifts to plastic — and plastic reads as an
  ad, which is the one thing a UGC presenter cannot afford.
- **No brand names anywhere.** Models trained on the open web will render a logo
  that is not yours.

### 2. Generate the anchor

One frontal portrait, neutral expression, even light, plain background. Neutral
is not a style choice — it is what makes the anchor usable as a reference for
poses that are not neutral.

```
media_image_codex { prompt: <identity>, size: "1024x1024", outputDir: "./outputs/avatar" }
```

Look at it before continuing. Everything downstream inherits this face, and the
cheapest moment to reject it is now.

### 3. Fan out, referencing the anchor

```
media_generate_image {
  op: "nano-banana-pro",
  prompt: <identity> + <this shot's angle, expression, wardrobe>,
  referenceImages: [<the anchor>],
  personGeneration: "ALLOW_ADULT",
  outputDir: "./outputs/avatar"
}
```

Vary **angle, expression and wardrobe**. Do not vary the identity paragraph.

Aim for coverage rather than count: frontal neutral, frontal speaking,
three-quarter left, three-quarter right, slight downward, one with a different
top. Soul-ID training takes **5 to 20** images and a set that is six copies of
one angle teaches the model one angle.

### 4. Upload — the bridge

Nothing on the platform accepts a local path from this repo's image tools. Every
file becomes an id first.

```
media_higgsfield_upload { filePath: "./outputs/avatar/anchor.png" }
  -> { id, type, url }
```

**Free.** Measured 2026-08-02: balance 260 before and after, no transaction row.

### 5. Register — two destinations, different jobs

They are not alternatives to choose between; they answer different questions.

#### 5a. Marketing Studio avatar — for VIDEO

```
media_higgsfield_ms_avatar_create { name: "MV Presenter 01", image: <upload id> }
```

One image. The resulting id goes into `avatarIds` on
`media_higgsfield_marketing_studio`, exactly where a preset id would.

**Two things to say out loud before running it:**

- **There is no delete.** `higgsfield marketing-studio avatars` has `create` and
  `list`, and nothing else. A mistake is permanent, so name it findably —
  "MV Presenter 01", not "test".
- **The cost is NOT measured.** `upload create` and `brand-kits fetch` both
  turned out free, but there is no `--cost-only` on this subcommand and no probe
  was run *because* of the missing delete. Do not infer free from its siblings.
  Read `higgsfield account status` before and after the first one.

#### 5b. Soul-ID — for IMAGES

```
media_higgsfield_soul_id_train {
  name: "MV Presenter 01",
  imagePaths: [<5 to 20 paths>],
  variant: "soul-2"
}
```

**Costs 40 credits**, and that is the one number on this page that is known
rather than assumed. Ask before spending it.

The trained id goes in `media_higgsfield_generate { soulId }`, which the provider
sends as **`custom_reference_id`** — the field the Soul family actually
validates. It used to be sent as `soul_id`, which the endpoint discards in
silence, so a 40-credit training was never applied to the generation it was
trained for. That is fixed; it is worth knowing because a 200 response proved
nothing about it.

## Which destination for which ask

| The user wants | Path |
|---|---|
| A presenter in UGC ads, weekly | 5a. Marketing Studio avatar |
| The same character across generated stills | 5b. Soul-ID |
| Both | Both — one upload set feeds each |
| To test whether a face works at all | Neither. Pick a preset from `kind: "avatars"` and ship one ad first |

That last row is the one to actually say. A custom avatar is permanent (5a) or
costs 40 credits (5b); a preset costs nothing and answers "does this format
work" just as well.

## Cost, in one place

| Step | Cost | How that is known |
|---|---|---|
| `media_image_codex` | 0 on OAuth; metered with `OPENAI_API_KEY` | The adapter detects which and says so |
| `media_generate_image` | Google billing, per image | Priced by the image service |
| `media_higgsfield_upload` | **0** | Measured — balance unchanged |
| `ms_avatar_create` | **UNKNOWN** | No `--cost-only`, no probe, no delete to undo one |
| `soul_id_train` | **40 credits** | Known |

## Then

- `[skill:mf-ugc-brief]` for the brief the avatar performs.
- `[skill:mf-ugc-produce]` submits with `avatarIds` resolved.
- `[skill:mf-characters]` if the character needs a sheet rather than a face.
- `[skill:mf-antislop]` over any copy the avatar speaks.
