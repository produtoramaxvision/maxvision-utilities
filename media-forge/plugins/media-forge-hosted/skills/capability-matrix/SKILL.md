---
name: capability-matrix
description: Model x params capability cheatsheet. Static reference; read by all media-forge agents.
allowed-tools: Read, Grep, Glob
preamble-tier: 1
user-invocable: true
---

# media-forge:capability-matrix

Static capability reference for all three LOCKED models. Read this before composing any API payload to ensure parameters are valid.

## Models

### gemini-3-pro-image-preview (Nano Banana Pro)

| Parameter         | Values                                                                 |
|-------------------|------------------------------------------------------------------------|
| Aspect ratios     | 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9                 |
| Image sizes       | 1K, 2K, 4K                                                             |
| Thinking levels   | MINIMAL, LOW, MEDIUM, HIGH                                             |
| Person generation | ALLOW_ALL, ALLOW_ADULT, ALLOW_NONE                                     |
| Reference images  | Up to 14 (role-labeled)                                                |
| Google Search     | Optional (`useGoogleSearch: true`)                                     |
| Notes             | Only model supporting 14 refs and 4K. Primary for creative work.      |

### imagen-4.0-ultra-generate-001 (Imagen 4 Ultra)

| Parameter         | Values                                                                 |
|-------------------|------------------------------------------------------------------------|
| Aspect ratios     | 1:1, 3:4, 4:3, 9:16, 16:9                                             |
| Image sizes       | 1K, 2K (NO 4K)                                                         |
| Person generation | ALLOW_ALL, ALLOW_ADULT, ALLOW_NONE                                     |
| Number of images  | 1 only                                                                 |
| Notes             | Use for seed-reproducible outputs. Cannot produce 4K.                 |

### veo-3.1-generate-preview (Veo 3.1 Pro)

| Parameter         | Values                                                                 |
|-------------------|------------------------------------------------------------------------|
| Aspect ratios     | 16:9, 9:16                                                             |
| Durations         | 4s, 6s, 8s                                                             |
| Resolutions       | 720p, 1080p, 4k                                                        |
| Number of videos  | 1 only                                                                 |
| Person generation | allow_all (t2v/extend only), allow_adult (all modes)                   |
| Reference images  | Up to 3, type ASSET only (no style refs)                               |
| Modes             | t2v, i2v, interpolate, references, extend                              |
| Extension hops    | +7s per hop, 720p only, max 20 hops (148s)                             |
| 4k constraint     | Requires durationSeconds=8                                             |
| 1080p constraint  | Requires durationSeconds=8                                             |
| TTL               | 2 days — download immediately                                          |

## When to use

Consult this skill before any model API call to validate parameters. All domain agents reference this skill.
