---
name: fallow
description: Use when auditing TypeScript/JavaScript code quality in this repo — dead code, copy-paste duplication, complexity hotspots, circular dependencies, architecture boundary violations, or gating a PR. Triggers on "fallow", "codebase audit", "dead code", "find duplication", "complexity hotspots", "PR gate", "tech debt scan". Deterministic (no AI), Rust engine, sub-second. Run after editing TS/TSX.
---

# fallow — deterministic codebase intelligence (TS/JS)

Static analysis of this pnpm monorepo (no AI): dead code, duplication, complexity, dependency hygiene, architecture cycles. Run via `pnpm exec fallow` or the `fallow` MCP server (registered in `.mcp.json`).

## Commands

- `pnpm exec fallow audit --format json --quiet` — PR gate: verdict `pass` / `warn` / `fail` over changed files
- `pnpm exec fallow health --score` — repo health score 0–100
- `pnpm exec fallow dead-code --format json --quiet` — unused-code + dependency-hygiene candidates
- `pnpm exec fallow dupes` — copy-paste and structural duplication
- `pnpm exec fallow fix --dry-run` — preview safe unused-code auto-fixes

## Rules

- Apply only the `auto_fixable` actions from the `actions[]` array; review the rest.
- PR gate passes only on verdict `pass`.
- Suppress narrowly: `// fallow-ignore-next-line <rule>` plus a one-line reason. NEVER raise a global threshold to hide a hotspot.
- Config lives in `.fallowrc.jsonc` (workspaces: `media-forge`, `credit-core`). The MCP server and this skill load when the Claude Code session reopens in this repo.
