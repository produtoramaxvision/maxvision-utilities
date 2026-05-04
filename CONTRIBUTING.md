# Contributing

Thanks for your interest in contributing to **maxvision-claude**.

## Repository Layout

This repo is a multi-plugin Claude Code marketplace. Plugins live in subdirectories at the repo root:

```
maxvision-claude/
├── .claude-plugin/marketplace.json   ← marketplace manifest (root, single source of truth)
├── n8n-skills/                       ← plugin: n8n workflows (MIT, upstream czlonkowski)
└── gtm-skills/                       ← plugin: GTM API (BSD-3-Clause, upstream paolobietolini)
```

Each plugin has its own `LICENSE`, `NOTICE`, `README.md`, `CHANGELOG.md`, and `.claude-plugin/plugin.json`.

## Scope

**In scope:**

- Marketplace packaging (`.claude-plugin/marketplace.json`, root scaffolding)
- Per-plugin packaging (`<plugin>/.claude-plugin/plugin.json`, READMEs, CHANGELOGs)
- CI / tooling / repository hygiene
- Documentation fixes
- Bug reports about plugin installation or discovery
- Adding new plugins (must include upstream attribution + license preservation)

**Out of scope (upstream):**

- Changes to content under `*/skills/`. These are imported verbatim from upstream repos. Open issues/PRs at:
  - `n8n-skills/skills/` → [czlonkowski/n8n-skills](https://github.com/czlonkowski/n8n-skills)
  - `gtm-skills/skills/` → [paolobietolini/gtm-api-for-llms](https://github.com/paolobietolini/gtm-api-for-llms)

## Commit Convention

We follow [Conventional Commits 1.0](https://www.conventionalcommits.org/):

```text
<type>(<scope>): <description>
```

**Types:** `feat`, `fix`, `docs`, `chore`, `ci`, `refactor`, `test`, `perf`.

**Scopes:** `marketplace`, `n8n-skills`, `gtm-skills`, `ci`, `docs`, `deps`.

**Examples:**

```text
feat(marketplace): add new plugin slot for supabase-skills
fix(n8n-skills): correct broken link in README
docs(readme): clarify install instructions
chore(n8n-skills): sync skills to czlonkowski/n8n-skills v1.7.0
ci: tighten manifest consistency check
```

## Semver

Marketplace and each plugin version independently:

- Marketplace bumps when structural changes affect install paths or schema.
- Each plugin bumps when its own content/manifest changes.
- `feat` → MINOR (`0.1.0` → `0.2.0`)
- `fix` → PATCH (`0.1.0` → `0.1.1`)
- `BREAKING CHANGE:` footer → MAJOR (`0.9.0` → `1.0.0`)

## Pull Request Process

1. Fork and create a feature branch off `main`: `git checkout -b feat/short-description`
2. Make your changes.
3. Ensure CI passes locally (see `.github/workflows/validate.yml`).
4. Update `CHANGELOG.md` (root for marketplace-level, per-plugin for plugin-level changes) under an `## [Unreleased]` section.
5. Open a PR with a clear description. Link any related issue.

## Code of Conduct

All contributors are expected to follow the [Contributor Covenant](CODE_OF_CONDUCT.md).
