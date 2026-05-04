# gtm-skills

[![License: BSD-3-Clause](https://img.shields.io/badge/License-BSD--3--Clause-blue.svg)](LICENSE)
[![Marketplace: maxvision-claude](https://img.shields.io/badge/marketplace-maxvision--claude-blueviolet)](https://github.com/produtoramaxvision/maxvision-claude)
[![Upstream: paolobietolini/gtm-api-for-llms](https://img.shields.io/badge/upstream-paolobietolini%2Fgtm--api--for--llms-green)](https://github.com/paolobietolini/gtm-api-for-llms)

> Google Tag Manager API expert skill for Claude Code.

Plugin inside the [`maxvision-claude`](https://github.com/produtoramaxvision/maxvision-claude) marketplace, packaging [paolobietolini/gtm-api-for-llms](https://github.com/paolobietolini/gtm-api-for-llms) by Paolo Bietolini.

---

## Skill Included

| Skill | Purpose |
|---|---|
| `gtm-api` | Execute Google Tag Manager API operations — create, update, delete, and manage tags, triggers, variables, and containers; validate configurations; publish container versions; automate tag management workflows |

**Reference files bundled:** 9 detailed references covering API endpoints, schemas, validation rules, request templates, workflows, examples, step-by-step instructions, context/architecture, and quick-reference lookups.

---

## Installation

In Claude Code:

```text
/plugin marketplace add produtoramaxvision/maxvision-claude
/plugin install gtm-skills@maxvision-claude
```

Restart Claude Code — the `gtm-api` skill loads automatically.

---

## Usage

The `gtm-api` skill activates by description matching when you mention GTM tasks:

- *"Create a GA4 tag in my GTM container..."*
- *"Update the firing trigger on tag X..."*
- *"Publish the current GTM workspace..."*
- *"List all triggers in container Y..."*
- *"Generate a GTM API request to audit my tags"*

---

## Requirements

- Claude Code ≥ 2.0
- GTM API access: a Google Cloud project with the Tag Manager API enabled, OAuth 2.0 credentials with scopes such as `tagmanager.readonly`, `tagmanager.edit.containers`, and `tagmanager.publish` depending on your use case
- Optional: [paolobietolini/gtm-mcp-server](https://github.com/paolobietolini/gtm-mcp-server) for direct MCP-level access to execute GTM calls from Claude

---

## Attribution

Derivative of [paolobietolini/gtm-api-for-llms](https://github.com/paolobietolini/gtm-api-for-llms) commit `11e563f` by **Paolo Bietolini**, BSD 3-Clause.

All `skills/gtm-api/` content is verbatim from upstream. Modifications by MaxVision are limited to plugin packaging. See [NOTICE](NOTICE) and [LICENSE](LICENSE).

Per BSD 3-Clause Clause 3, attribution above is provided for provenance only and is **not** an endorsement by or affiliation with the upstream author.

---

## License

Dual-copyright BSD 3-Clause. See [LICENSE](LICENSE).

- Original work © Paolo Bietolini
- Plugin packaging © 2026 Produtora MaxVision
