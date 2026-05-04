# Security Policy

## Reporting a Vulnerability

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, email: **produtoramaxvision@gmail.com** with subject line:
`[SECURITY] maxvision-claude: <short description>`

Include:

- Description of the vulnerability
- Affected plugin (`n8n-skills`, `gtm-skills`, or marketplace-level)
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge receipt within **48 hours** and provide a timeline for a fix.

## Scope

This repository contains markdown documentation and JSON manifests — no executable plugin code. Security concerns typically fall into:

- Malicious content injected into a skill file that could influence Claude's behavior in harmful ways
- Supply-chain risks in CI/CD workflows
- Credential/PII exposure in committed files

For vulnerabilities in upstream skill content, also consider reporting to the original project:

- `n8n-skills` upstream: [czlonkowski/n8n-skills](https://github.com/czlonkowski/n8n-skills/security)
- `gtm-skills` upstream: [paolobietolini/gtm-api-for-llms](https://github.com/paolobietolini/gtm-api-for-llms/security)

## Supported Versions

| Marketplace version | Security fixes |
|---------------------|----------------|
| 0.x                 | Latest minor only |

## Disclosure Policy

We follow coordinated disclosure with a **90-day** window. Public announcement happens after a patch is released.
