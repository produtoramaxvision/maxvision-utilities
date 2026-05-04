# Changelog

All notable changes to the **maxvision-claude** marketplace are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/spec/v2.0.0.html).

Per-plugin changelogs live inside each plugin folder:

- [`n8n-skills/CHANGELOG.md`](./n8n-skills/CHANGELOG.md)
- [`gtm-skills/CHANGELOG.md`](./gtm-skills/CHANGELOG.md)

---

## [0.1.0] - 2026-05-04

### Added

- Initial monorepo marketplace release.
- Two plugins bundled:
  - `n8n-skills@0.1.0` — 7 skills from [czlonkowski/n8n-skills v1.6.0](https://github.com/czlonkowski/n8n-skills) (MIT)
  - `gtm-skills@0.1.0` — 1 skill from [paolobietolini/gtm-api-for-llms](https://github.com/paolobietolini/gtm-api-for-llms) commit `11e563f` (BSD 3-Clause)
- Marketplace manifest (`.claude-plugin/marketplace.json`) listing both plugins with `strict: true`.
- Per-plugin manifests (`*/. claude-plugin/plugin.json`) with attribution-correct licensing.
- Unified CI (`validate.yml`) covering both plugins:
  - Markdown lint
  - JSON syntax + schema validation (plugin.json + marketplace.json)
  - Skills structure check (frontmatter `name:` + `description:` for every `*/skills/*/SKILL.md`)
  - Secret scan (gitleaks)
- Root scaffolding: README (infoproduct framing), LICENSE, NOTICE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.
- GitHub templates: issue templates, PR template, Dependabot for Actions.

### Migration from previous repos

Replaces and supersedes:

- `produtoramaxvision/claude-code-n8n-skills` (marketplace `maxvision-skills`)
- `produtoramaxvision/claude-code-gtm-skills` (marketplace `maxvision-gtm-skills`)

The old repositories will be deleted after this marketplace is verified working in production. Plugin **names** (`n8n-skills`, `gtm-skills`) are unchanged — only the marketplace wrapper changed from two repos to one.

### Install

```text
/plugin marketplace add produtoramaxvision/maxvision-claude
/plugin install n8n-skills@maxvision-claude
/plugin install gtm-skills@maxvision-claude
```
