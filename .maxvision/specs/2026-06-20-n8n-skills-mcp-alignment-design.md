# Design — Alinhamento do plugin n8n-skills ao MCP czlonkowski/n8n-mcp

- **Data:** 2026-06-20
- **Autor:** orchestrate + brainstorming (MaxVision)
- **Escopo:** NÚCLEO apenas (migração MCP + revival do plugin + gaps de hook + guarda anti-drift)
- **Fora de escopo:** rotação de secrets (adjacente A), limpeza de RAM do fleet MCP (adjacente B)

---

## 1. Problema

O plugin `n8n-skills` v0.2.0 (14 skills + router + hooks enforcement layer) está em paridade
verbatim perfeita com o upstream `czlonkowski/n8n-skills` v1.21.0 (commit `29d3c31`). Conteúdo
limpo: zero tool-names stale, zero refs de companion-file quebradas, `marketplace.json` sincronizado.

O gap real é **mismatch de ambiente**, não de fidelidade ao upstream:

- O servidor MCP conectado (`n8n-mcp` em `~/.claude.json`) é um **wrapper custom** em
  `agente-maxvision/mcp-servers/n8n/dist/index.js` — 13 tools em português (`criar_workflow`,
  `atualizar_workflow`...), cliente fino da API REST de um n8n **remoto** (VPS
  `https://n8n.meuagente.api.br`).
- As skills e os hooks foram construídos para `czlonkowski/n8n-mcp` (tool-names ingleses:
  `get_node`, `n8n_create_workflow`, `validate_workflow`...).

Consequências medidas:

- **Hooks 100% inertes**: os 7 matchers PreToolUse (`^mcp__.*__n8n_create_workflow$` etc.) nunca
  casam com os nomes PT do server custom → a camada de enforcement, diferencial do plugin, está morta.
- **Skills tool-specific apontam para tools inexistentes** no server custom (`get_node`,
  `validate_node`, templates — o custom não tem nenhum).
- Skills de conhecimento n8n (expressions, code, patterns, error-handling, agents, binary,
  subworkflows) seguem válidas — são verdades MCP-agnósticas.

## 2. Decisão

Trocar o servidor MCP custom pelo `czlonkowski/n8n-mcp` (npm, v2.59.2), instalado via **npx
(online)**, apontando para a mesma VPS. O plugin inteiro revive sem edição de conteúdo de skill.

### Justificativa de completude (custom vs czlonkowski)

| Critério | custom `mcp-n8n` v1.0.0 | czlonkowski/n8n-mcp v2.59.2 |
|---|---|---|
| Tools / classes | 13 / 1 (Management API) | ≈20+ / 5 classes |
| Discovery (`search_nodes`, `get_node`) | ❌ | ✓ DB SQLite 500+ nodes |
| Validação pré-deploy | ❌ (POST cego) | ✓ `validate_node`/`validate_workflow` |
| Templates | ❌ | ✓ 2.700+ (`search/get/deploy_template`) |
| Management | ✓ (subconjunto) | ✓ superset (17 op types, smart params, autofix, audit) |
| n8n local necessário | ❌ (remoto) | ❌ (DB embarcado offline + management na VPS) |
| Alinha com skills+hooks | ❌ | ✓ alvo nativo |

A metade de node-knowledge/validação/templates roda do SQLite **embarcado no pacote MCP** — não
requer n8n local. A metade de management chama a VPS via `N8N_API_URL`/`N8N_API_KEY`. Resultado vs
hoje: **estritamente superior, zero degradação**.

### Validações já executadas (2026-06-20)

1. `npm view n8n-mcp` → v2.59.2, bin `dist/mcp/stdio-wrapper.js`, npx-able. ✓
2. VPS `GET /api/v1/workflows?limit=1` com a key → **HTTP 200**, workflow real retornado. Key válida. ✓
3. 22 tool-names canônicos do czlonkowski extraídos e cruzados contra os 7 hooks (ver §4.3). ✓

## 3. RAM (contexto, fora de escopo de correção)

Investigação destapou o culpado real de RAM: **158 processos MCP node ≈ 10 GB**, resultado de ~30
MCP servers × 6 sessões Claude simultâneas (+ órfãos vazados). O n8n MCP é irrelevante (1 processo
fino). A migração para czlonkowski adiciona ~1 processo node com SQLite embarcado (~80-120 MB) —
rounding error. **A migração é RAM-neutra/positiva.** A limpeza do fleet é o adjacente B, adiado.

## 4. Componentes da mudança (núcleo)

### 4.1 Migrar config MCP (`~/.claude.json`)

Substituir o entry `n8n-mcp` custom por:

```jsonc
"n8n-mcp": {
  "command": "npx",
  "args": ["-y", "n8n-mcp"],
  "env": {
    "N8N_API_URL": "https://n8n.meuagente.api.br/api/v1",
    "N8N_API_KEY": "<JWT atual — em env, nunca em argv>",
    "MCP_MODE": "stdio",
    "LOG_LEVEL": "error",
    "DISABLE_CONSOLE_OUTPUT": "true"
  }
}
```

A key vai no bloco `env` (não em `args`) → não aparece em command line, ao contrário dos vazamentos
de `magic`/`shadcn`/`stitch`. `~/.claude.json` é home-scoped, não é repositório versionado.

Nota: o JWT atual já está exposto (estava em source committada). Rotacioná-lo é o adjacente A
(adiado). Reusá-lo aqui mantém a paridade funcional com hoje.

### 4.2 Remoção completa do custom (sem resquícios)

- Entry de config: removido em 4.1 → o server custom para de carregar (some das 6 sessões).
- Dir órfão `agente-maxvision/mcp-servers/n8n/` (projeto separado, fora deste repo): a deleção é
  **destrutiva e opcional**, exige confirmação explícita do usuário no plano. Não é deletado
  automaticamente.

### 4.3 Reviver + validar hooks (pós-restart da sessão)

Hooks que casam com tools reais do czlonkowski (validado estaticamente):

| Hook (matcher suffix) | Tool real | Veredito |
|---|---|---|
| `get_node` | `get_node` | OK |
| `n8n_create_workflow` | `n8n_create_workflow` | OK |
| `n8n_update_partial_workflow`\|`n8n_update_full_workflow` | ambos | OK |
| `validate_workflow`\|`n8n_validate_workflow` | ambos | OK |
| `n8n_test_workflow` | `n8n_test_workflow` | OK |
| `n8n_manage_credentials` | `n8n_manage_credentials` | OK |
| `n8n_instances` | **não consta nas 22 tools** | **verificar ao vivo; se morto, remover** |
| PostToolUse `validate_workflow` | `validate_workflow` | OK |

Ação `n8n_instances`: confirmar contra a tool-list ao vivo após o restart. Se inexistente, remover
o hook `pre-tool-use/instances.sh` + seu matcher de `hooks.json`. A skill `n8n-multi-instance`
(conhecimento) permanece — apenas o hook morto sai.

### 4.4 Fechar gaps de cobertura de hook

Adicionar PreToolUse reminders para tools de alto impacto sem cobertura:

- `n8n_autofix_workflow` → reminder: não confiar cego no autofix; re-validar (`validate_workflow`)
  e inspecionar `connections` depois.
- `n8n_deploy_template` → reminder: revisar estrutura do template + credenciais exigidas antes de
  deploy; usar `autoFix`/`autoUpgradeVersions` conscientemente.
- `n8n_audit_instance` → read-only, baixa prioridade. **Opcional** — incluir só se trivial.

Cada novo hook reusa o padrão one-shot `_emit.sh` existente. Matcher: `^mcp__.*__<tool>$`.

### 4.5 Guarda anti-drift (correção permanente "sem gaps")

- `scripts/check-marketplace-sync` (bash): assert que `marketplace.json` `skills[]` == dirs em
  `skills/` (conjunto + contagem). Fecha o gap que [[n8n-skills-sync]] avisa. Exit ≠ 0 em divergência.
- Check de drift upstream: compara o pin local v1.21.0 (commit `29d3c31`) com
  `czlonkowski/n8n-skills` HEAD via `gh api`; alerta se avançou. Pode rodar no CI ou on-demand.

## 5. Validação final (critério de aceite)

Após restart da sessão com o MCP novo carregado, provar as 3 classes vivas, zero degradação:

1. **Management**: `n8n_health_check` (ou `n8n_list_workflows`) retorna OK contra a VPS.
2. **Discovery/docs**: `get_node({nodeType:"nodes-base.httpRequest"})` retorna schema do DB embarcado.
3. **Validação**: `validate_workflow` num workflow real puxado da VPS retorna veredito estruturado.
4. **Hooks vivos**: ao menos 1 PreToolUse reminder dispara numa chamada `get_node`/`n8n_create_workflow`.
5. **Anti-drift**: `check-marketplace-sync` exit 0; drift-check reporta "em paridade" ou o delta real.

## 6. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Versão do n8n da VPS difere do DB embarcado | `get_node`/validação ao vivo cobrem drift; skills já mandam "confie no tool ao vivo" |
| Hooks não recarregam mid-session | Restart de sessão obrigatório após editar `~/.claude.json` (CC não hot-reloada MCP/agents) |
| `n8n_instances` na verdade existe (README incompleto) | Verificação ao vivo antes de remover — não remover às cegas |
| npx baixa pacote a cada cold start (latência) | Aceitável; alternativa `install local` fica para depois se incomodar |
| Deleção do dir custom apaga algo útil | Confirmação explícita; deleção não automática |

## 7. Não incluído

- Rotação dos 4 secrets expostos (n8n JWT, Magic API key, GitHub token, Google API key) — adjacente A.
- Limpeza de RAM do fleet MCP (podar servers, reduzir sessões, matar órfãos) — adjacente B.
- Qualquer edição de conteúdo verbatim das skills (mantém política de espelho do upstream).
