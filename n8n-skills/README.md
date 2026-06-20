# n8n-skills

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Marketplace: maxvision-claude](https://img.shields.io/badge/marketplace-maxvision--claude-blueviolet)](https://github.com/produtoramaxvision/maxvision-claude)
[![Upstream: czlonkowski/n8n-skills](https://img.shields.io/badge/upstream-czlonkowski%2Fn8n--skills%20v1.21.0-green)](https://github.com/czlonkowski/n8n-skills)

> 14 expert skills + a router and a hooks enforcement layer for building flawless n8n workflows in Claude Code.

Plugin inside the [`maxvision-claude`](https://github.com/produtoramaxvision/maxvision-claude) marketplace, packaging [czlonkowski/n8n-skills](https://github.com/czlonkowski/n8n-skills) by Romuald Członkowski.

---

## Skills Included

**Router (load first):**

| Skill | Purpose |
|---|---|
| `using-n8n-mcp-skills` | Entry-point router. Routes any n8n task to the right specialist skill, gives working knowledge of every n8n-mcp tool, and states the non-negotiable rules that keep workflows from breaking in production |

**Specialist skills:**

| Skill | Purpose |
|---|---|
| `n8n-code-javascript` | Write JavaScript in n8n Code nodes (data access, helpers, DateTime, error prevention) |
| `n8n-code-python` | Write Python in n8n Code nodes (standard library, patterns, errors) |
| `n8n-code-tool` | Use the Code node as an AI agent tool |
| `n8n-expression-syntax` | Validate `{{ }}` expression syntax, `$json`/`$node` access, webhook body structure |
| `n8n-mcp-tools-expert` | Use n8n-mcp MCP tools effectively (search, validate, templates, workflows) |
| `n8n-node-configuration` | Configure nodes correctly (operation patterns, dependencies) |
| `n8n-validation-expert` | Interpret validation errors and fix them (error catalog, false positives) |
| `n8n-workflow-patterns` | Proven architectural patterns (webhooks, APIs, DBs, AI agents, scheduled tasks) |
| `n8n-agents` | Build AI Agent workflows (LangChain nodes, tools, memory, structured output) |
| `n8n-error-handling` | Error handling, retries, `continueOnFail`, error workflows |
| `n8n-binary-and-data` | Binary data, files, streams, data transformation |
| `n8n-subworkflows` | Sub-workflows and the Execute Workflow node |
| `n8n-multi-instance` | Operate across multiple n8n instances |
| `n8n-self-hosting` | Self-hosting, deployment, and instance configuration |

---

## Hooks Enforcement Layer

When installed as a Claude Code plugin bundle, `hooks/hooks.json` registers:

- **SessionStart** — primes the session with the router skill.
- **PreToolUse** — reminds you to consult the matching skill on high-impact n8n-mcp
  calls (`get_node`, `n8n_create_workflow`, `n8n_update_*_workflow`, credentials,
  test, validate, multi-instance) before they run.
- **PostToolUse** — nudges validation after workflow changes.

The hooks are advisory reminders (they do not block). On Claude.ai (plain skill
uploads, no hooks) the same rules apply — consulting skills is then your responsibility.

---

## Installation

In Claude Code:

```text
/plugin marketplace add produtoramaxvision/maxvision-claude
/plugin install n8n-skills@maxvision-claude
```

Restart Claude Code — the 14 skills, the router, and the hooks load automatically.

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

Derivative of [czlonkowski/n8n-skills](https://github.com/czlonkowski/n8n-skills) v1.21.0 (commit `29d3c31`) by **Romuald Członkowski**, MIT.

All `skills/` and `hooks/` content is verbatim from upstream. Portions of the skill
content are adapted by upstream from [n8n-io/skills](https://github.com/n8n-io/skills)
(© n8n GmbH, Apache-2.0) — see [NOTICES-APACHE-2.0.txt](NOTICES-APACHE-2.0.txt) and
[NOTICES-UPSTREAM](NOTICES-UPSTREAM). Modifications by MaxVision are limited to plugin
packaging. See [NOTICE](NOTICE) and [LICENSE](LICENSE).

---

## License

Dual-copyright MIT. See [LICENSE](LICENSE).

- Original work © Romuald Członkowski
- Plugin packaging © 2026 Produtora MaxVision
