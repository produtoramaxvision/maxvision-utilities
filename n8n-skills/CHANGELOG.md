# Changelog

All notable changes to this plugin are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/spec/v2.0.0.html).

**Note:** Skill content comes verbatim from upstream. Upstream version is tracked separately from plugin version.

## [0.3.0] - 2026-06-20

Plugin retargeted to its native MCP server (`czlonkowski/n8n-mcp`); enforcement layer completed.

### Added

- PreToolUse hooks `autofix-workflow.sh` and `deploy-template.sh` — close coverage gaps for `n8n_autofix_workflow` and `n8n_deploy_template` (original to this pack, not adapted from upstream).
- `scripts/check-marketplace-sync.sh` — asserts `marketplace.json` skills[] matches `skills/` dirs.
- `scripts/check-upstream-drift.sh` + `.upstream-pin` — detects when `czlonkowski/n8n-skills` advances past the pinned commit.
- `.gitattributes` — enforces LF on `*.sh` so hook shebangs never break under CRLF.

### Changed

- Hook matchers verified 1:1 against `czlonkowski/n8n-mcp` v2.59.2 tool names.

### Removed

- `pre-tool-use/instances.sh` + its matcher — `n8n_instances` confirmed absent from the live `czlonkowski/n8n-mcp` v2.59.2 tool surface. The `n8n-multi-instance` skill is retained; the `manage-credentials.sh` reminder already references the tool defensively ("if present"), so it self-suppresses.

## [0.2.0] - 2026-06-20

Upstream sync to [czlonkowski/n8n-skills v1.21.0](https://github.com/czlonkowski/n8n-skills) (commit `29d3c31`, from v1.6.0).

### Added

- 7 new skills imported verbatim from upstream:
  - `n8n-agents` — AI Agent workflows (LangChain nodes, tools, memory)
  - `n8n-error-handling` — error handling, retries, `continueOnFail`, error workflows
  - `n8n-binary-and-data` — binary data, files, streams
  - `n8n-subworkflows` — sub-workflows / Execute Workflow node
  - `n8n-code-tool` — Code node as an AI agent tool
  - `n8n-multi-instance` — operate across multiple n8n instances
  - `n8n-self-hosting` — self-hosting, deployment, instance config
- `using-n8n-mcp-skills` — router / entry-point skill with non-negotiable rules.
- Hooks enforcement layer (`hooks/hooks.json` + `session-start.sh` + `pre-tool-use/*` + `post-tool-use/*`): SessionStart priming and PreToolUse/PostToolUse reminders on high-impact n8n-mcp calls.
- `NOTICES-UPSTREAM` and `NOTICES-APACHE-2.0.txt` — upstream attribution for material adapted from n8n-io/skills (Apache-2.0).

### Changed

- All 7 existing skills updated verbatim to v1.21.0 (includes the `$helpers` → `this.helpers` correctness fix for Code-node skills, plus broad content improvements).
- `plugin.json` version 0.1.0 → 0.2.0; description updated to 14 skills + router + hooks.
- README and NOTICE updated for the new skill set, hooks layer, and Apache-2.0 sub-attribution.

### Not included

- `felipfr/awesome-n8n-workflows` (2000+ workflow JSON exports): evaluated and **not bundled** — redundant with the n8n-mcp template DB already reached via `n8n-mcp-tools-expert`, internet-aggregated/unvetted, and not skill-shaped (raw data, not guidance).

## [0.1.0] - 2026-04-23

### Added

- Initial plugin release.
- 7 skills imported verbatim from [czlonkowski/n8n-skills v1.6.0](https://github.com/czlonkowski/n8n-skills/releases/tag/v1.6.0):
  - `n8n-code-javascript`
  - `n8n-code-python`
  - `n8n-expression-syntax`
  - `n8n-mcp-tools-expert`
  - `n8n-node-configuration`
  - `n8n-validation-expert`
  - `n8n-workflow-patterns`
- Plugin manifest (`.claude-plugin/plugin.json`).
- Self-hosted marketplace (`.claude-plugin/marketplace.json`, name: `maxvision-skills`).
- Professional repository scaffolding (CI validation, issue templates, Dependabot, security policy).

### Attribution

All `skills/` content: © Romuald Członkowski, MIT.
Packaging: © 2026 Produtora MaxVision, MIT.
