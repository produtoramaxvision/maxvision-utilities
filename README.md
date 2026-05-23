# MaxVision Claude

[![License](https://img.shields.io/badge/license-MIT%20%26%20BSD--3--Clause-blue.svg)](#licenses)
[![Validate](https://github.com/produtoramaxvision/maxvision-claude/actions/workflows/validate.yml/badge.svg)](https://github.com/produtoramaxvision/maxvision-claude/actions/workflows/validate.yml)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-yellow.svg)](https://conventionalcommits.org)
[![Plugins](https://img.shields.io/badge/plugins-3-success)](#plugins)

> **MaxVision's curated Claude Code marketplace.** Production-grade skills, packaged for reliable consumption.

A self-hosted Claude Code marketplace bundling expert skill packs from across the MaxVision stack — n8n workflow automation, Google Tag Manager API operations, and top-tier Google AI media generation.

---

## Why this marketplace

The Claude Code ecosystem has hundreds of skill repos scattered across GitHub. `maxvision-claude` is opinionated curation: each plugin is sourced from a high-quality upstream, packaged with full repository scaffolding (CI, schemas, attribution), and version-pinned for reproducibility.

- **Verbatim upstream content.** No silent edits. Skill text comes directly from the source repo.
- **Strict mode marketplace.** `marketplace.json` is the authoritative manifest — Claude Code only loads what's listed.
- **Per-plugin licensing preserved.** MIT and BSD 3-Clause boundaries respected. See [Licenses](#licenses).
- **Self-hosted, no proxy.** You install directly from GitHub. No middleware.

---

## Plugins

| Plugin | Purpose | Skills | License | Upstream |
|---|---|---|---|---|
| [`n8n-skills`](./n8n-skills/) | Build flawless n8n workflows — JavaScript/Python Code nodes, expression syntax, validation, MCP tools, workflow patterns | 7 | MIT | [czlonkowski/n8n-skills](https://github.com/czlonkowski/n8n-skills) v1.6.0 |
| [`gtm-skills`](./gtm-skills/) | Execute Google Tag Manager API operations — tags, triggers, variables, container versions, programmatic publishing | 1 (with 9 reference docs) | BSD 3-Clause | [paolobietolini/gtm-api-for-llms](https://github.com/paolobietolini/gtm-api-for-llms) |
| [`media-forge`](./media-forge/) | Image and video generation via Google's top-tier AI (Nano Banana Pro, Imagen 4 Ultra, Veo 3.1 Pro). 10 domain agents, 22 MCP tools, smart-routing review, dual surface (plugin + MCP + CLI) | 11 (+ 10 agents, 10 commands) | MIT | Native to maxvision-utilities |

Each plugin has its own `README.md`, `LICENSE`, `NOTICE`, and `CHANGELOG.md` inside its folder.

---

## Install in 30 seconds

In Claude Code:

```text
/plugin marketplace add produtoramaxvision/maxvision-claude
/plugin install n8n-skills@maxvision-claude
/plugin install gtm-skills@maxvision-claude
/plugin install media-forge@maxvision-claude
```

Restart Claude Code. The skills appear automatically and trigger by description matching when you mention relevant tasks.

### Verify install

```bash
ls ~/.claude/plugins/cache/maxvision-claude/n8n-skills/0.1.0/
ls ~/.claude/plugins/cache/maxvision-claude/gtm-skills/0.1.0/
ls ~/.claude/plugins/cache/maxvision-claude/media-forge/0.1.0/
```

Or in Claude Code:

```text
/plugin
```

You should see all three plugins listed under marketplace `maxvision-claude`.

---

## Usage

Skills activate automatically by description matching. No manual invocation required. Examples:

| Say this... | Skill that activates |
|---|---|
| *"Write JavaScript for an n8n Code node that aggregates webhook data"* | `n8n-code-javascript` |
| *"Validate this n8n expression: `{{ $json.user.email }}`"* | `n8n-expression-syntax` |
| *"Build an n8n workflow that hits an API on schedule"* | `n8n-workflow-patterns` |
| *"Create a GA4 tag in my GTM container"* | `gtm-api` |
| *"Publish a GTM container version"* | `gtm-api` |
| *"Generate a cinematic product shot of a coffee mug in 4K"* | `media-forge:create` → `product-photographer` agent |
| *"Build a campaign with 3 lifestyle stills + 1 hero video"* | `media-forge:campaign` |
| *"Extend this 8-second clip by 14 more seconds"* | `media-forge:extend-video` |

Each skill ships with reference documents (data access patterns, error catalogs, examples, schemas) that Claude Code loads on demand.

---

## Requirements

- **Claude Code ≥ 2.0** — for plugin support
- **Optional MCPs:**
  - [`n8n-mcp`](https://github.com/czlonkowski/n8n-mcp) — makes the `n8n-mcp-tools-expert` skill fully actionable
  - GTM API credentials — for the `gtm-skills` to execute calls (the skill drafts API requests; execution requires your own auth setup)
- **For `media-forge`:**
  - `GOOGLE_API_KEY` (AI Studio) or Vertex AI credentials — required for image/video generation
  - `ANTHROPIC_API_KEY` — optional, only for standalone MCP LLM judge (not needed inside Claude Code)
  - `GOOGLE_APPLICATION_CREDENTIALS` (Cloud Vision service account) — optional, enables OCR text validation in reviewer Stage 1

---

## Versioning

| Layer | Versioning policy |
|---|---|
| Marketplace (this repo) | Tracks structural changes — schema updates, new plugins added, breaking install paths. Bumps as a whole on `main` releases. |
| Plugin (`n8n-skills`, `gtm-skills`) | Independent semver per plugin — bumps when its skills change or upstream sync lands. |
| Upstream | Tracked per-plugin in `*/NOTICE` and `*/CHANGELOG.md`. Synced on demand, never silently. |

See [`CHANGELOG.md`](./CHANGELOG.md) for the marketplace history and per-plugin changelogs in each plugin folder.

---

## Roadmap

Planned future plugins (not yet shipped):

- `supabase-skills` — Postgres + RLS rules + Edge Functions patterns
- `telegram-skills` — Bot architecture, webhook patterns, deployment
- `mcp-server-skills` — MCP server design and implementation patterns

Tracking via [issues](https://github.com/produtoramaxvision/maxvision-claude/issues) — open one if you want a specific domain.

---

## Contributing

PRs are welcome for:

- New plugins (must include upstream attribution + license preservation)
- Updates of existing plugins to newer upstream versions
- Repository tooling and CI improvements

**Not accepted:** edits to `*/skills/**` content, since those are verbatim from upstream. To change skill content, contribute to the corresponding upstream first.

See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

---

## Licenses

Each plugin retains its upstream license. Marketplace packaging is MIT.

- `n8n-skills/LICENSE` — **MIT** (original work © Romuald Członkowski; packaging © 2026 Produtora MaxVision)
- `gtm-skills/LICENSE` — **BSD 3-Clause** (original work © Paolo Bietolini; packaging © 2026 Produtora MaxVision)
- `media-forge/LICENSE` — **MIT** (original work © 2026 Produtora MaxVision; native plugin, no upstream)
- Root `LICENSE` — **MIT**, covering marketplace packaging only

See root [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE) for complete attribution.

---

## Authors

**Produtora MaxVision** — [github.com/produtoramaxvision](https://github.com/produtoramaxvision)

This marketplace would not exist without the upstream authors:

- **Romuald Członkowski** — [czlonkowski/n8n-skills](https://github.com/czlonkowski/n8n-skills)
- **Paolo Bietolini** — [paolobietolini/gtm-api-for-llms](https://github.com/paolobietolini/gtm-api-for-llms)

---

## Links

- **Issues / feature requests:** [github.com/produtoramaxvision/maxvision-claude/issues](https://github.com/produtoramaxvision/maxvision-claude/issues)
- **Security:** [`SECURITY.md`](./SECURITY.md)
- **Code of Conduct:** [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)
