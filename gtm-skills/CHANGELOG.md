# Changelog

All notable changes to this plugin are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/spec/v2.0.0.html).

**Note:** Skill content comes verbatim from upstream. Upstream version is tracked separately from plugin version.

## [0.1.0] - 2026-04-23

### Added

- Initial plugin release.
- 1 skill imported verbatim from [paolobietolini/gtm-api-for-llms](https://github.com/paolobietolini/gtm-api-for-llms) at commit `11e563f` (2026-02-07):
  - `gtm-api` — Google Tag Manager API operations (SKILL.md + 9 reference files covering API endpoints, schemas, validation rules, request templates, workflows, examples, step-by-step instructions, context, and quick-reference lookups)
- Plugin manifest (`.claude-plugin/plugin.json`).
- Self-hosted marketplace (`.claude-plugin/marketplace.json`, name: `maxvision-gtm-skills`).
- Professional repository scaffolding (CI validation, issue templates, Dependabot, security policy).

### Attribution

All `skills/` content: © Paolo Bietolini, BSD 3-Clause.
Packaging: © 2026 Produtora MaxVision, BSD 3-Clause.
