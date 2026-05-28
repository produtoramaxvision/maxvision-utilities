# media-forge — Usage Cookbook

This document covers the core 22 image / video / utility MCP tools, all CLI subcommands, and 5 real-world recipes with full invocation examples. The registry has grown to **54 tools** (50 with Seedance disabled); the 32 multi-provider + reference-library tools (refs, video routing, Higgsfield, Kling, Seedance) are summarized at the end of the MCP Tools section — for the full parameter reference of any tool use `media_help` or `docs/specification.md` §3.

---

## MCP Tools

### Image tools (6)

---

#### `media_generate_image`

Generate an image via Nano Banana Pro (`gemini-3-pro-image-preview`).

```json
{
  "prompt": "professional product photo of a white sneaker on clean studio background, 4K",
  "aspectRatio": "1:1",
  "imageSize": "4K",
  "thinkingLevel": "High",
  "dryRun": false
}
```

**Key parameters:**
- `prompt` (required): text prompt, 1–8000 chars
- `aspectRatio`: `1:1` | `16:9` | `9:16` | `3:4` | `4:3` | `2:3` | `3:2` | `4:5` | `5:4` | `21:9` (default: `1:1`)
- `imageSize`: `1K` | `2K` | `4K` (default: `4K`)
- `thinkingLevel`: `minimal` | `low` | `medium` | `High` (default: `High`)
- `referenceImages`: array of `{path, role_label?}`, max 14 items
- `useGoogleSearch`: boolean (incompatible with caching/code-execution)
- `dryRun`: return payload + cost estimate without API call

**Output shape:**
```json
{
  "outputPath": ".media-forge/jobs/2026-05-22T120000Z-abc/v1/output.png",
  "jobId": "2026-05-22T120000Z-abc",
  "costUsd": 0.24,
  "model": "gemini-3-pro-image-preview",
  "dryRun": false
}
```

**Gotcha:** `useGoogleSearch: true` cannot be combined with other tools like caching or function-calling. The capability validator will throw `CapabilityError` if you try.

---

#### `media_generate_imagen`

Generate an image via Imagen 4 Ultra (`imagen-4.0-ultra-generate-001`). Use this path when you need seed control, negative prompts, or multiple images per call.

```json
{
  "prompt": "a photorealistic espresso cup on marble, dramatic side lighting",
  "aspectRatio": "1:1",
  "seed": 42,
  "negativePrompt": "blurry, oversaturated, cartoon",
  "numberOfImages": 2
}
```

**Key parameters:**
- `aspectRatio`: `1:1` | `9:16` | `16:9` | `3:4` | `4:3` (default: `1:1`)
- `seed`: integer for reproducible output
- `negativePrompt`: text describing what to exclude
- `numberOfImages`: 1–4 (default: 1)

**Gotcha:** `imageSize` input is accepted by the schema but the SDK does not expose this field in `GenerateImagesConfig` (DEBT-006). The plugin logs a warning and proceeds; the server uses its own default resolution.

---

#### `media_edit_image`

Semantic image editing: add, remove, or replace elements via natural language.

```json
{
  "sourceImage": "/path/to/product.png",
  "prompt": "replace the wooden table with a white marble surface",
  "editMode": "edit"
}
```

**Key parameters:**
- `sourceImage` (required): path to source image
- `prompt` (required): edit instruction
- `editMode`: `edit` | `inpaint` | `outpaint` | `remove` | `replace` (default: `edit`)
- `maskImage`: path to mask PNG (required for `inpaint` mode)

**Gotcha:** Inpainting requires a mask image. Without a mask, use `editMode: "edit"` and describe the change in the prompt.

---

#### `media_compose_scene`

Compose a scene from multiple reference images with role labels.

```json
{
  "prompt": "place the character in the forest scene wearing the hiking outfit",
  "referenceImages": [
    {"path": "/refs/character.png", "role_label": "character"},
    {"path": "/refs/forest.png", "role_label": "scene"},
    {"path": "/refs/outfit.png", "role_label": "outfit"}
  ],
  "aspectRatio": "16:9",
  "imageSize": "4K"
}
```

**Key parameters:**
- `referenceImages`: array of `{path, role_label?}`, max 14 items
- `role_label` hints: `"character"` | `"person"` (counts against character quota ≤5) vs any other label (counts against object quota ≤6)

**Gotcha:** Exceeding sub-quotas (5 character refs or 6 object refs) triggers a `CapabilityError` from the validator, even if total count is ≤14.

---

#### `media_describe_image`

Describe an image using Gemini vision.

```json
{
  "imagePath": "/path/to/image.png",
  "detailLevel": "detailed"
}
```

**Key parameters:**
- `detailLevel`: `brief` | `detailed` | `technical` (default: `detailed`)

**Output shape:**
```json
{
  "description": "A professional product photograph showing a white ceramic coffee mug...",
  "imagePath": "/path/to/image.png"
}
```

---

#### `media_extract_palette`

Extract the dominant color palette from an image (local processing — no API call).

```json
{
  "imagePath": "/path/to/brand-photo.png",
  "colorCount": 5,
  "format": "hex"
}
```

**Key parameters:**
- `colorCount`: 2–16 (default: 5)
- `format`: `hex` | `rgb` | `hsl` (default: `hex`)

**Cost:** Zero — uses node-vibrant locally.

---

### Video tools (7)

All video generation tools return an `operationName` for async polling. Videos have a **2-day TTL** on Google's servers. Use `media_poll_video_operation` to check completion, then `media_download_video` to save immediately.

---

#### `media_generate_video_t2v`

Text-to-video via Veo 3.1 Pro.

```json
{
  "prompt": "a slow-motion pour of golden honey from a wooden spoon, macro lens, warm backlight, cinematic",
  "aspectRatio": "16:9",
  "durationSeconds": "8",
  "resolution": "4k",
  "generateAudio": true
}
```

**Key parameters:**
- `durationSeconds`: `"4"` | `"6"` | `"8"` (string enum; default: `"8"`)
- `resolution`: `"720p"` | `"1080p"` | `"4k"` (default: `"720p"`; `1080p` and `4k` require `durationSeconds=8`)
- `generateAudio`: boolean (default: true)
- `seed`: optional integer

**Output shape:**
```json
{
  "operationName": "projects/myproject/locations/us-central1/operations/abc123",
  "model": "veo-3.1-generate-preview",
  "dryRun": false
}
```

**Gotcha:** `resolution: "4k"` only works with `durationSeconds: "8"`. The capability validator enforces this.

---

#### `media_generate_video_i2v`

Image-to-video: anchor the first frame to a provided image.

```json
{
  "prompt": "the sneaker slowly rotates 360 degrees on the pedestal, product reveal",
  "firstFrameImage": "/path/to/frame.png",
  "aspectRatio": "16:9",
  "durationSeconds": "8",
  "resolution": "4k"
}
```

**Key parameters:**
- `firstFrameImage` (required): path to the anchor image
- Same resolution/duration constraints as T2V

---

#### `media_generate_video_interpolate`

Frame interpolation: provide first and last frame; Veo fills the motion between them.

```json
{
  "prompt": "smooth camera push-in on the product, luxurious feel",
  "firstFrameImage": "/path/to/start.png",
  "lastFrameImage": "/path/to/end.png",
  "durationSeconds": "8",
  "resolution": "4k"
}
```

Both frame images are required.

---

#### `media_generate_video_with_refs`

Video generation with up to 3 asset references (ASSET type).

```json
{
  "prompt": "the character walks through the urban street scene at golden hour",
  "referenceImages": [
    {"path": "/refs/character.png", "referenceType": "ASSET"},
    {"path": "/refs/street.png", "referenceType": "ASSET"}
  ],
  "durationSeconds": "8",
  "resolution": "4k"
}
```

**Gotcha:** Maximum 3 reference images. Only `referenceType: "ASSET"` is supported. Exceeding 3 triggers a `CapabilityError`.

---

#### `media_extend_video`

Extend an existing video by one +7s hop.

```json
{
  "sourceVideoPath": "https://storage.googleapis.com/.../output.mp4",
  "prompt": "continue the scene: camera slowly pulls back to reveal the full product lineup",
  "hopIndex": 0
}
```

**Key parameters:**
- `sourceVideoPath`: HTTPS or GCS URI to the source video (must already be downloaded or accessible)
- `hopIndex`: 0–19; track which hop this is in a multi-hop chain (max 20 hops total)

**Gotcha:** Extension hops always output at 720p regardless of original resolution. This is a Google API constraint.

---

#### `media_poll_video_operation`

Poll a long-running Veo operation until completion.

```json
{
  "operationName": "projects/myproject/locations/us-central1/operations/abc123",
  "intervalMs": 10000,
  "timeoutMs": 900000
}
```

**Output when done:**
```json
{
  "operation": {
    "done": true,
    "response": {
      "generateVideoResponse": {
        "generatedSamples": [{"video": {"uri": "https://..."}}]
      }
    }
  }
}
```

**Timeout:** Default 15 minutes (900000ms). PollingError is thrown on timeout.

---

#### `media_download_video`

Download a completed video from a resolved HTTPS or GCS URI.

```json
{
  "operationName": "https://storage.googleapis.com/.../output.mp4",
  "outputDir": "./outputs",
  "filename": "hero-video.mp4"
}
```

**Gotcha:** The parameter is named `operationName` but it must contain a **resolved video URI** (starting with `https://` or `gs://`), not an operation name string. Re-poll first with `media_poll_video_operation` to get the URI from the response, then call this tool.

---

### Pipeline / utility tools (8)

---

#### `media_dry_run_payload`

Return the assembled API payload without calling the API. Shows exactly what would be sent.

```json
{
  "op": "nano-banana-pro",
  "params": {
    "prompt": "product hero shot, white background",
    "imageSize": "4K",
    "aspectRatio": "1:1"
  }
}
```

**Output:** `{ dryRun: true, payload: <the assembled params> }`

---

#### `media_estimate_cost`

Batch cost estimation for multiple operations.

```json
{
  "items": [
    {"op": "generate_image", "params": {"imageSize": "4K"}},
    {"op": "video t2v", "params": {"resolution": "4k", "generateAudio": true}}
  ]
}
```

**Output:** `{ totalUsd: 2.44, perItem: [{op, usd, breakdown}, ...] }`

---

#### `media_validate_environment`

Check that the required API key is configured and accessible.

```json
{}
```

**Output:** `{ ok: true, missing: [] }` or `{ ok: false, missing: ["GOOGLE_API_KEY ..."] }`

---

#### `media_capability_matrix`

Return the full model × parameter capability table. Filter by model with the optional `model` parameter.

```json
{"model": "gemini-3-pro-image-preview"}
```

---

#### `media_list_outputs`

List jobs in `.media-forge/jobs/`. Returns an empty list in v0.1.0 (full implementation deferred to v0.2.0). Use `media-forge audit all` CLI command instead.

---

#### `media_get_job_metadata`

Read a job's full metadata, trace, and lineage by job ID.

```json
{"jobId": "2026-05-22T120000Z-abc"}
```

**Output:** `{ jobId, jobDir, metadata, trace: [...entries], lineage: [...attempts] }`

---

#### `media_run_ocr`

Run OCR over an image and return detected text.

```json
{
  "imagePath": "/path/to/ad-banner.png",
  "languages": ["en"]
}
```

**Output:** `{ imagePath, detectedText, backend: "cloud-vision", skipped: false }`

**Gotcha:** Requires `GOOGLE_APPLICATION_CREDENTIALS` for Cloud Vision backend. Without it, OCR is skipped (`skipped: true`).

---

#### `media_check_brand_compliance`

Run brand compliance check: palette ΔE2000, logo presence, font keywords.

```json
{
  "imagePath": "/path/to/output.png",
  "brandGuidelinesPath": ".media-forge/brand-guidelines.yml"
}
```

**Output:** `{ pass: false, violations: [{type: "color_delta", detail: "ΔE=7.2 > 5.0 on dominant color #E53E3E"}] }`

---

#### `media_help`

List all tools or get help for a specific tool.

```json
{"topic": "media_generate_video_t2v"}
```

No topic: returns the full tool list. With topic: returns description and parameter hints.

---

### Help tool (1)

See `media_help` above.

---

### Multi-provider + reference tools (32) — summary

Added in refs-integration + P13–P16. Full parameter reference via `media_help` / `docs/specification.md` §3. Quick map:

- **Reference library (4):** `media_refs_search`, `media_refs_compose_moodboard`, `media_refs_presign`, `media_refs_index`.
- **Video routing & cost (4):** `media_video_route`, `media_video_cost_estimate`, `media_video_cost_report`, `media_video_webhook_status`.
- **Higgsfield (10):** `media_higgsfield_generate` / `_soul_id` / `_dop` / `_cinema_studio` / `_speak` / `_marketing_studio` / `_recast` / `_virality_predictor` / `_poll` / `_download`.
- **Kling 3.0 (10):** `media_kling_motion_brush` / `_element_create` / `_element_list` / `_element_delete` / `_elements` / `_lip_sync` / `_omni_multishot` / `_video_extend` / `_poll` / `_download`.
- **Seedance 2.0 (4, feature-flagged):** `media_seedance_text_to_video` / `_image_to_video` / `_multishot` / `_reference_fusion`.

> Full per-tool recipes for these families are a documentation follow-up; the entries above + `media_help` cover invocation in the meantime.

---

## CLI Subcommands

### `media-forge doctor`

```bash
media-forge doctor
```

Checks: GOOGLE_API_KEY present, model IDs resolvable, output directory writable, MCP server binary exists. Returns `ok` or a list of failures with fix hints.

---

### `media-forge models`

```bash
media-forge models
```

Lists the three locked model IDs with capability summaries. No API call.

---

### `media-forge config`

```bash
media-forge config set apiKey=AIza...
media-forge config get apiKey
media-forge config list
```

Reads/writes `~/.media-forge/config.json`. Values here are overridden by environment variables.

---

### `media-forge image generate`

```bash
media-forge image generate "product photo of coffee mug, white background, 4K" \
  --aspect-ratio 1:1 \
  --image-size 4K \
  --thinking-level HIGH \
  --dry-run \
  --json
```

**Key flags:** `--aspect-ratio`, `--image-size`, `--thinking-level`, `--person-generation`, `--reference-images <path...>`, `--use-google-search`, `--dry-run`, `--json`, `--estimate-cost`, `--output-dir`

---

### `media-forge image imagen`

```bash
media-forge image imagen "espresso cup on marble, dramatic lighting" \
  --seed 42 \
  --negative-prompt "blurry, oversaturated"
```

**Key flags:** `--aspect-ratio`, `--image-size`, `--seed`, `--negative-prompt`, `--person-generation`

---

### `media-forge image edit`

```bash
media-forge image edit /path/to/product.png "replace wooden table with white marble surface"
media-forge image edit /path/to/product.png "add company logo" --edit-mode inpaint --mask /path/to/mask.png
```

**Key flags:** `--edit-mode` (`edit` | `inpaint` | `outpaint` | `remove` | `replace`), `--mask`, `--aspect-ratio`

---

### `media-forge image compose`

```bash
media-forge image compose "character in forest scene wearing hiking outfit" \
  --ref character.png \
  --ref forest.png \
  --ref outfit.png \
  --aspect-ratio 16:9 \
  --image-size 4K
```

**Key flags:** `--ref <path>` (repeat for each reference), `--aspect-ratio`, `--image-size`

---

### `media-forge image describe`

```bash
media-forge image describe /path/to/product.png --detail-level detailed
```

**Key flags:** `--detail-level` (`brief` | `detailed` | `technical`)

---

### `media-forge image palette`

```bash
media-forge image palette /path/to/brand-photo.png --color-count 6 --format hex
```

**Key flags:** `--color-count` (2–16), `--format` (`hex` | `rgb` | `hsl`)

Zero API cost — local processing.

---

### `media-forge video t2v`

```bash
media-forge video t2v "slow-motion honey pour, macro, warm backlight, cinematic" \
  --duration-seconds 8 \
  --resolution 4k \
  --aspect-ratio 16:9
```

**Key flags:** `--duration-seconds` (4 | 6 | 8), `--resolution` (720p | 1080p | 4k), `--aspect-ratio` (16:9 | 9:16), `--no-generate-audio`, `--seed`, `--negative-prompt`, `--bg`

Returns an operation name. Use `video wait <opname>` to poll and download.

---

### `media-forge video i2v`

```bash
media-forge video i2v "sneaker rotates 360 degrees, product reveal" \
  --image /path/to/frame.png \
  --duration-seconds 8 \
  --resolution 4k
```

**Required flag:** `--image <path>` (first frame anchor)

---

### `media-forge video interpolate`

```bash
media-forge video interpolate "smooth camera push-in, luxurious feel" \
  --first /path/to/start.png \
  --last /path/to/end.png \
  --duration-seconds 8
```

**Required flags:** `--first <path>`, `--last <path>`

---

### `media-forge video refs`

```bash
media-forge video refs "character walks through urban street at golden hour" \
  --ref /refs/character.png \
  --ref /refs/street.png \
  --duration-seconds 8 \
  --resolution 4k
```

**Key flag:** `--ref <path>` (repeat, max 3)

---

### `media-forge video extend`

```bash
media-forge video extend "continue: camera pulls back to reveal full product lineup" \
  --source-uri "https://storage.googleapis.com/.../output.mp4" \
  --hop-index 0
```

**Required flag:** `--source-uri <uri>` (HTTPS or GCS URI)
**Key flag:** `--hop-index` (0–19)

Output resolution is always 720p for extension hops.

---

### `media-forge video poll`

```bash
media-forge video poll "projects/myproject/locations/us-central1/operations/abc123" \
  --interval-ms 10000 \
  --timeout-ms 900000
```

Returns the raw operation response when `done: true`.

---

### `media-forge video download`

```bash
media-forge video download "https://storage.googleapis.com/.../output.mp4" \
  --output-dir ./outputs \
  --filename hero-video.mp4
```

Argument must be a resolved HTTPS or GCS URI, not an operation name.

---

### `media-forge video wait`

```bash
media-forge video wait "projects/myproject/locations/us-central1/operations/abc123" \
  --filename hero-video.mp4
```

Combined poll + download in one command. Convenience shortcut for the common case.

---

### `media-forge cost estimate`

```bash
media-forge cost estimate --command "media-forge video t2v 'hero shot' --resolution 4k"
```

Dry-runs the given command and returns USD estimate. No API call.

---

### `media-forge audit`

```bash
media-forge audit 2026-05-22T120000Z-abc --json
media-forge audit all --json
```

Reads `.media-forge/cost-log.jsonl` + per-job trace + lineage. Returns aggregated spending and verdict history.

---

### `media-forge prompts list`

```bash
media-forge prompts list
media-forge prompts list --domain product
```

Lists all templates in `prompts/_index.json`. Filter by domain with `--domain`.

---

### `media-forge prompts show`

```bash
media-forge prompts show product/ecommerce-white-bg
```

Displays the template with its variable slots and default values.

---

## 5 Real-World Recipes

### Recipe 1 — Cinematic Product Shot

**Goal:** Generate a cinematic 8s product reveal video for a premium sneaker.

```bash
# Step 1: generate hero image (first frame)
media-forge image generate \
  "premium white sneaker floating on black velvet, dramatic rim lighting, 4K" \
  --aspect-ratio 16:9 --image-size 4K --output-dir ./recipe-1/

# Step 2: use hero image as first frame for video
media-forge video i2v \
  "camera slowly orbits the sneaker 180 degrees, dramatic rim lighting, cinematic" \
  --image ./recipe-1/output.png \
  --resolution 4k --duration-seconds 8

# Step 3: wait for completion and download
media-forge video wait <operation-name> --filename sneaker-reveal.mp4
```

**Skill equivalent:** `/media-forge:cinematic "premium sneaker product reveal, dramatic rim lighting, 4K"` — uses `media-forge:cinematic-short` which handles these three steps automatically.

---

### Recipe 2 — Product Photo with Brand Check

**Goal:** Generate an e-commerce product image and validate it against brand colors.

```bash
# Step 1: generate product photo
media-forge image generate \
  "professional e-commerce photo of blue sports drink bottle, white background, centered" \
  --aspect-ratio 1:1 --image-size 4K

# Step 2: check brand compliance
# (via MCP tool — provides structured violation list)
```

MCP call:
```json
{
  "tool": "media_check_brand_compliance",
  "params": {
    "imagePath": ".media-forge/jobs/.../v1/output.png",
    "brandGuidelinesPath": ".media-forge/brand-guidelines.yml"
  }
}
```

If `pass: false`, the `enterprise-corrector` agent re-runs with the violation details.

---

### Recipe 3 — Character Sheet

**Goal:** Generate an identity-locked character sheet with portrait, turnaround, and expression variants.

```bash
# Step 1: generate identity-lock portrait
media-forge image generate \
  "character design: young female astronaut, short red hair, freckles, silver suit, white background, front view, character sheet style" \
  --aspect-ratio 2:3 --image-size 4K --output-dir ./character/v1/

# Step 2: use portrait as reference for turnaround
media-forge image compose \
  "same character, 3/4 back view, identical appearance: red hair, freckles, silver suit" \
  --ref ./character/v1/output.png \
  --aspect-ratio 2:3 --image-size 4K

# Step 3: expression sheet
media-forge image compose \
  "same character 4-panel expression sheet: happy, angry, surprised, neutral" \
  --ref ./character/v1/output.png \
  --aspect-ratio 2:1 --image-size 4K
```

**Skill equivalent:** `/media-forge:character astronaut "young female, short red hair, freckles, silver suit"` — uses `media-forge:character-sheet` for the full 5-step consistency workflow.

---

### Recipe 4 — 24s Extended Video Chain

**Goal:** Generate a 24-second branded video via three consecutive extension hops.

```bash
# Hop 0: generate initial 8s segment
media-forge video t2v \
  "outdoor adventure scene: hiker reaches mountain summit, golden hour" \
  --resolution 4k --duration-seconds 8

media-forge video wait <op-0> --filename segment-0.mp4

# Hop 1: extend by +7s
media-forge video extend \
  "hiker looks out over the vast valley, breathing deeply, wonder on face" \
  --source-uri https://storage.googleapis.com/.../segment-0.mp4 \
  --hop-index 0

media-forge video wait <op-1> --filename segment-1.mp4

# Hop 2: extend by another +7s
media-forge video extend \
  "drone shot pulls back slowly to reveal the brand logo etched on the summit marker" \
  --source-uri https://storage.googleapis.com/.../segment-1.mp4 \
  --hop-index 1

media-forge video wait <op-2> --filename segment-2.mp4
```

All three segments are now in `./outputs/`. Use FFmpeg or the `veo-director` agent to concatenate.

**Skill equivalent:** `/media-forge:extend <job_id> "continue the mountain summit story"` — uses `media-forge:extend-video` which manages the hop chain automatically.

---

### Recipe 5 — OCR-Validated Ad Creative

**Goal:** Generate a banner ad with required text and validate that it rendered correctly.

```bash
# Step 1: generate ad with required text
media-forge image generate \
  "clean display ad: blue background, centered text 'SUMMER SALE 50% OFF', white sans-serif font, brand product hero on the right" \
  --aspect-ratio 16:9 --image-size 4K
```

Then via MCP:
```json
{
  "tool": "media_run_ocr",
  "params": {
    "imagePath": ".media-forge/jobs/.../v1/output.png"
  }
}
```

If `detectedText` does not include "SUMMER SALE 50% OFF" (fuzzy ≤2 edits), the reviewer routes back to the generator with a stronger text-anchoring directive (`negative_prompt` for filler text + explicit font size instruction).

**Skill equivalent:** `/media-forge:create "display ad: SUMMER SALE 50% OFF, blue background"` — the `quality-reviewer` runs OCR automatically when `required_text` is declared in the refined spec.

---

## Cross-Reference: Skills

| Use case | Skill / command |
|---|---|
| Any image or video (one-shot) | `/media-forge:create` → `media-forge:create` |
| Multi-asset campaign | `/media-forge:campaign` → `media-forge:campaign` |
| Character consistency sheet | `/media-forge:character` → `media-forge:character-sheet` |
| Multi-image scene assembly | MCP `media_compose_scene` or `media-forge:scene-compose` skill |
| Cinematic short video | `/media-forge:cinematic` → `media-forge:cinematic-short` |
| Extend video chain | `/media-forge:extend` → `media-forge:extend-video` |
| Job audit / cost log | `media-forge audit all` CLI or `media-forge:audit` skill |
| Model capabilities reference | `media-forge:capability-matrix` skill |
