# CLAUDE.md - media-forge

## fallow - codebase intelligence (TS/JS)

Analise deterministica do repo (sem IA): dead code, duplicacao, complexidade, deps, arquitetura. Engine Rust, sub-segundo. Package manager: **pnpm** - use `pnpm exec` para rodar.

Apos editar TS/TSX:

```bash
pnpm exec fallow audit --format json --quiet      # gate de PR: verdict pass/warn/fail
pnpm exec fallow health --score                   # score 0-100 do repo
pnpm exec fallow dead-code --format json --quiet  # cleanup candidates
pnpm exec fallow fix --dry-run                     # preview auto-fix
```

Regras: aplicar fixes `auto_fixable` do array `actions[]`; gate de PR = verdict `pass`; suppression sempre estreita (`// fallow-ignore-next-line <regra>`) + motivo; nunca subir threshold global pra esconder hotspot. MCP server (`.mcp.json`) e skill (`.claude/skills/fallow/`) configurados; reabrir o CC carrega ambos.
