# n8n-skills

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Marketplace: maxvision-claude](https://img.shields.io/badge/marketplace-maxvision--claude-blueviolet)](https://github.com/produtoramaxvision/maxvision-claude)
[![Upstream: czlonkowski/n8n-skills](https://img.shields.io/badge/upstream-czlonkowski%2Fn8n--skills%20v1.6.0-green)](https://github.com/czlonkowski/n8n-skills)

> 7 expert skills for building flawless n8n workflows in Claude Code.

Plugin inside the [`maxvision-claude`](https://github.com/produtoramaxvision/maxvision-claude) marketplace, packaging [czlonkowski/n8n-skills](https://github.com/czlonkowski/n8n-skills) by Romuald Członkowski.

---

## Skills Included

| Skill | Purpose |
|---|---|
| `n8n-code-javascript` | Write JavaScript in n8n Code nodes (data access, helpers, DateTime, error prevention) |
| `n8n-code-python` | Write Python in n8n Code nodes (standard library, patterns, errors) |
| `n8n-expression-syntax` | Validate `{{ }}` expression syntax, `$json`/`$node` access, webhook body structure |
| `n8n-mcp-tools-expert` | Use n8n-mcp MCP tools effectively (search, validate, templates, workflows) |
| `n8n-node-configuration` | Configure nodes correctly (operation patterns, dependencies) |
| `n8n-validation-expert` | Interpret validation errors and fix them (error catalog, false positives) |
| `n8n-workflow-patterns` | Proven architectural patterns (webhooks, APIs, DBs, AI agents, scheduled tasks) |

---

## Installation

In Claude Code:

```text
/plugin marketplace add produtoramaxvision/maxvision-claude
/plugin install n8n-skills@maxvision-claude
```

Restart Claude Code — the 7 skills load automatically.

---

## Usage

Skills activate by description matching when you mention n8n tasks:

- *"Write JavaScript for an n8n Code node that..."* → `n8n-code-javascript`
- *"Validate this n8n expression..."* → `n8n-expression-syntax`
- *"Build an n8n workflow that..."* → `n8n-workflow-patterns`

No manual invocation required.

---

## Requirements

- Claude Code ≥ 2.0
- Optional: [n8n-mcp](https://github.com/czlonkowski/n8n-mcp) MCP server for `n8n-mcp-tools-expert` to be fully actionable

---

## Attribution

Derivative of [czlonkowski/n8n-skills](https://github.com/czlonkowski/n8n-skills) v1.6.0 (commit `1530f09`) by **Romuald Członkowski**, MIT.

All `skills/` content is verbatim from upstream. Modifications by MaxVision are limited to plugin packaging. See [NOTICE](NOTICE) and [LICENSE](LICENSE).

---

## License

Dual-copyright MIT. See [LICENSE](LICENSE).

- Original work © Romuald Członkowski
- Plugin packaging © 2026 Produtora MaxVision
