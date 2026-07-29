# Higgsfield + Kling — atualização para os padrões oficiais de 2026-07-29

Status: T0 concluído em 2026-07-29 — base pronta, PR0 liberado.
Branch base: `feat/media-forge-refresh`, ramificada de **`origin/homolog`** (927293f).

### T0 — Preparar a base — CONCLUÍDO

**Correção de premissa (2026-07-29).** A versão anterior deste T0 mandava fazer
`cherry-pick 97cb0b9` para `homolog`. Estava **errado**: o check original usou
`git branch --contains`, que só olha branches **locais**, e o `homolog` local
estava desatualizado (682e2e3) frente ao `origin/homolog` (927293f).

Verificado: `git merge-base --is-ancestor 97cb0b9 origin/homolog` retorna 0 —
o oracle de job-status que T15 consome **já está em `origin/homolog`**. Nenhum
cherry-pick é necessário. Não reintroduzir esse passo.

Segunda correção: as modificações não commitadas em `credit-core/` e nos 2 specs
**não eram trabalho novo**. `git diff origin/homolog -- credit-core/` e
`-- .maxvision/` retornaram vazio: o conteúdo já estava em `origin/homolog`
(credit-core 0.1.3 com `isProbeUrlAllowed`). Eram artefato de working tree numa
branch atrasada. Descartadas com perda zero, provada pelo diff vazio.

Executado:

- [x] Os 12 `.md` untracked (planos n8n + prompts de landing) commitados em
      `feat/n8n-mcp-alignment` (`d65cd2d`) — pertencem àquele trabalho, não a este
- [x] `git restore` nos 5 arquivos tracked (idênticos a `origin/homolog`)
- [x] `git checkout -b feat/media-forge-refresh origin/homolog`
- [x] `git cherry-pick 088f694` (traz este plano + `TODOS.md`) → `96e4fdc`

**Terceira correção, a que mais importa.** Este plano inteiro foi escrito lendo
`feat/n8n-mcp-alignment`, que está **80 arquivos / +2134 / −3867 atrás** de
`origin/homolog`. Todos os números de linha citados no plano estão defasados.
Os achados de substância foram re-verificados em `origin/homolog` e **sobrevivem**
(ver "Baseline real" abaixo), mas trate qualquer `arquivo.ts:NNN` do plano como
aproximado até reconferir.

### Baseline real (medido em `feat/media-forge-refresh`, 2026-07-29)

Executado por subagent Sonnet e **reconferido pessoalmente** — as duas execuções
bateram exatamente.

```
 Test Files  169 passed | 4 skipped (173)
      Tests  1587 passed | 8 skipped (1595)
```

- `pnpm test` (config default, com embedded-postgres via `globalSetup`): **0 falhas**
- `pnpm typecheck`: limpo, exit 0, sem output
- `pnpm lint` (`eslint . --max-warnings=0`): limpo, exit 0, sem output
- 185 arquivos `*.test.ts` tracked; 173 coletados pela config default
- media-forge na `origin/homolog` está em **v0.2.8** (o plano dizia 0.2.2)

**`pnpm test:evals` NÃO entra no gate.** Falha com 2/2 testes por credencial
ausente, não por defeito de código:
- `tests/evals/refs-match-eval.test.ts:100` — `reason: VOYAGE_API_KEY not set`
- `tests/evals/reviewer-calibration.test.ts:50` — `Could not resolve authentication
  method` vindo de `src/review/llm-judge.ts:296` (chamada ao SDK da Anthropic)

Ou seja: o número do plano ("181 testes") estava errado nas duas leituras — não são
181 testes nem 181 arquivos. **O gate de regressão é `1587 passed | 8 skipped`,
com typecheck e lint limpos.**

### Achados re-verificados em `origin/homolog` (todos continuam válidos)

| Achado | Onde, agora | Status |
|---|---|---|
| Cost guard prometido e não implementado | `src/core/config.ts:71` e `:179` (era `:187`) — só 2 ocorrências de `dailyCapUsd` em `src/`, nenhum handler consulta | confirmado |
| Modelo de judge desatualizado | `src/review/llm-judge.ts:297` — `model: 'claude-opus-4-7'` | confirmado |
| Kling só tem auth legacy | `src/video/providers/auth/kling-jwt.ts:82` usa `KLING_ACCESS_KEY`; `KLING_API_KEY` não existe em `src/` | confirmado |
| `NOTICE` não é publicado | `media-forge/package.json` → array `files` sem `NOTICE` | confirmado |
| T15 é estrutural, não trivial | `src/mcp/handlers.ts:2061` (era `:2057`) + 5 outros pontos `DEFERRED` (2075, 2085, 2095, 2702, 2988) | confirmado |
| T5 precisa ser transporte, não Provider | `src/core/models.ts` tem **10** specs `provider: 'higgsfield'`; `PROVIDERS` na linha 62 | confirmado |
| Não reinventar pricing/billing | `src/core/pricing.ts:10` já tem `usdPerCredit` + `credits-per-video`; `src/billing/debit.ts:13` já exporta `reserveForJob` | confirmado |
| T12 fica adiado | `src/video/providers/base.ts:57` — `multiReferenceImages?: ReadonlyArray<string>`, ainda sem campo de papel | confirmado |
| `handlers.ts` grande o bastante pra justificar PR0 | 3092 linhas (era 3049); `ADAPTED_PROVIDERS_BASE` na linha 169 (era 163) | confirmado |

## Contexto

O media-forge não é atualizado desde ~2026-05-27. Nesse intervalo:

1. **Kling lançou a API 2.0** com autenticação por API Key estática (Bearer) e
   endpoints por versão de modelo no path. AccessKey/SecretKey + JWT foi
   reclassificado pela própria Kling como *"legacy version design standards"*.
   O media-forge está inteiramente no legacy.
2. **Higgsfield publicou CLI oficial + MCP remoto**, ambos com OAuth (PKCE / OAuth
   no cliente), consumindo os créditos do plano. O adapter atual do media-forge
   usa `@higgsfield/client` com API key — caminho de billing não confirmado.
3. O catálogo de modelos do Higgsfield é **server-authoritative**
   (`higgsfield model list`), então manter cópia tipada à mão gera drift recorrente.

## Evidência coletada (2026-07-29)

| Fato | Fonte |
|---|---|
| Kling domain `https://api-singapore.klingai.com` | doc oficial, aba Authentication |
| Kling: "API Key (for all models)" vs "Access Key / Secret Key (legacy)" | doc oficial |
| Distinção novo/legacy: versão no **path** = novo; `model_name` no body = legacy | doc oficial |
| media-forge usa `model_name` no body em 6 endpoints | `src/video/providers/kling.ts:470,513,556,578,591,606` |
| media-forge assina JWT HS256 (legacy) | `src/video/providers/auth/kling-jwt.ts:59` |
| media-forge já usa o domínio correto | `src/video/providers/kling.ts:16` |
| Higgsfield CLI v1.1.20, build 2026-07-27, binário Windows amd64 | `higgsfield version` |
| Higgsfield CLI auth = OAuth 2.0 PKCE, credenciais em arquivo local | `higgsfield auth --help` |
| Higgsfield MCP = `https://mcp.higgsfield.ai/mcp`, sem API key | higgsfield.ai/mcp FAQ |
| MCP/CLI usam créditos do plano | higgsfield.ai/mcp FAQ |
| Unlimited/Free generations NÃO valem em MCP/CLI | higgsfield.ai/pricing, nota de rodapé |

## Decisões tomadas (confirmadas pelo usuário)

- **Kling**: dual-mode. API 2.0 como padrão, JWT legacy como fallback.
- **Higgsfield**: novo provider que envelopa o CLI oficial. Adapter API-key atual
  permanece intacto.
- Chave Kling exposta em texto plano → **rotacionar antes de usar**.

## Tarefas

### T1 — Rotacionar e provisionar credenciais (bloqueante, manual)

- [ ] Usuário rotaciona a API Key do Kling no console (a antiga vazou no chat)
- [ ] Gravar em `.env` (já em `.gitignore`), nunca hardcoded:
      `KLING_API_KEY=...`
- [ ] `higgsfield auth login` (interativo, OAuth PKCE)
- [ ] `higgsfield account` → registrar se o saldo bate com o dashboard do plano

Critério: `higgsfield account --json` retorna saldo; `.env` contém `KLING_API_KEY`;
`git status` não mostra `.env`.

### T2 — Kling dual-mode auth

Arquivo: `src/video/providers/auth/kling-jwt.ts`

- [ ] Estender `KlingEnvSubset` com `KLING_API_KEY?: string`
- [ ] Em `getKlingAuthHeader`: se `KLING_API_KEY` presente e não-vazia →
      `{ Authorization: 'Bearer ' + KLING_API_KEY }`, sem cache, sem assinatura
- [ ] Só cair no caminho JWT quando `KLING_API_KEY` ausente
- [ ] Mensagem do `KlingAuthConfigError` passa a citar as duas opções
- [ ] Erro NUNCA ecoa valor de chave (invariante atual, manter e testar)

Testes (`tests/`): API-key vence JWT quando ambos presentes; JWT preservado quando
só AccessKey/SecretKey; erro lista as duas alternativas; nenhum segredo na mensagem.

### T3 — Kling endpoints API 2.0

Arquivo: `src/video/providers/kling.ts`

- [ ] Mapear, na doc oficial, o path 2.0 de cada um dos 6 endpoints
- [ ] `pickEndpoint`/`pollPathFor` ganham variante 2.0 (versão no path) mantendo a
      legacy selecionável por flag
- [ ] Body 2.0 sem `model_name` (a versão vai no path)
- [ ] Flag `MEDIA_FORGE_KLING_API_VERSION` = `2` (default) | `legacy`

Bloqueio: exige leitura de cada página de endpoint na doc (bloqueia WebFetch com
HTTP 446 — usar browser-harness autenticado).

### T4 — Refresh do registry Kling

Arquivo: `src/core/models.ts`

- [ ] Substituir as rates PLACEHOLDER de `kling-v3-master` e `kling-v3-omni` por
      valores verificados na página oficial de pricing da API
- [ ] `updatedAt: '2026-07-29'` em toda entrada tocada
- [ ] **Não** cruzar com os créditos do plano Higgsfield — são unidades distintas
      (crédito de assinatura ≠ USD de API)

### T5 — Provider `higgsfield-cli`

Arquivos novos: `src/video/providers/higgsfield-cli.ts`, testes

- [ ] `'higgsfield-cli'` entra em `PROVIDERS` (`src/core/models.ts:62`)
- [ ] Entra em `ADAPTED_PROVIDERS_BASE` (`src/mcp/handlers.ts:163`) atrás da flag
      `MEDIA_FORGE_HF_CLI_ENABLED` (default `false`)
- [ ] Implementa a interface de `src/video/providers/base.ts` com
      `HiggsfieldCliExtras { providerKind: 'higgsfield-cli' }`
- [ ] Executa `higgsfield generate create <model> --json --wait` via spawn
      (argumentos como array, nunca string concatenada — sem shell injection)
- [ ] Preflight: binário no PATH e sessão válida; erro acionável se faltar
- [ ] Custo: ler de `higgsfield generate cost` antes de submeter, alimentar o
      cost-guard existente em créditos (nova unit `credits-per-job`)
- [ ] Trace/lineage por cima, igual aos demais providers

### T6 — Expor soul-id no media-forge

- [ ] MCP tool `media_higgsfield_soul_id_train` → `higgsfield soul-id create`
- [ ] Persistir o id retornado via `soul-id-cache.ts` (schema já existe:
      `migrations/sqlite/002-soul-ids.sql`)
- [ ] `media_higgsfield_soul_id_list` reconcilia cache local com `soul-id list`

### T7 — Registrar o MCP remoto do Higgsfield

- [ ] `.mcp.json`: entrada `higgsfield` apontando para `https://mcp.higgsfield.ai/mcp`
      (transporte HTTP, OAuth no cliente — sem env var de segredo)
- [ ] Adicionar `KLING_API_KEY` ao bloco env do server `media-forge`
- [ ] Documentar em `README.md` que unlimited/free generations não valem via MCP

### T8 — Verificação

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm exec fallow audit --format json --quiet` → verdict `pass`
- [ ] Smoke real: 1 imagem barata via CLI (Soul 2.0, 0,12 crédito) e 1 job Kling
      com a key nova
- [ ] `gitleaks` / conferir que nenhuma chave entrou em commit

---

# Fase 2 — Absorção de upstream (T9–T13)

## Auditoria de licença (verificada via API do GitHub, 2026-07-29)

| Repo | Licença | Veredicto | Motivo |
|---|---|---|---|
| `Emily2040/seedance-2.0` | MIT | **VENDORIZAR** | compatível; atribuição obrigatória |
| `hkuds/vimax` | MIT | **REIMPLEMENTAR** | Python; só o padrão migra, não o código |
| `anil-matcha/open-generative-ai` | MIT | adiado | só inferência local interessa; bloqueado por disco |
| `mifi/lossless-cut` | GPL-2.0 | **NÃO VENDORIZAR** | copyleft; técnica pode ser reimplementada |
| `calesthio/OpenMontage` | AGPL-3.0 | **PROIBIDO** | §13 rede contaminaria `src/billing/` comercial |

Regra dura para T9–T13: **nenhuma linha copiada de OpenMontage ou lossless-cut.**
Ideias derivadas deles devem ser reimplementadas do zero e citar a doc primária,
nunca o arquivo copyleft.

### Política de rebranding (aplica-se a T9–T14)

Tudo que entrar no media-forge sai com identidade media-forge. O limite é legal,
não estético.

**Permitido pela MIT** — renomear skills, reescrever prosa, mudar estrutura de
arquivos, adaptar ao nosso tom, integrar ao nosso namespace, remover o que não
serve.

**Obrigatório pela MIT** — preservar o aviso de copyright e o texto da licença em
"all copies or substantial portions". Remover a atribuição rescinde a licença e
transforma o uso em violação de copyright. Não é negociável e não conflita com o
rebranding: o `NOTICE` fica num arquivo próprio, não no nome das skills nem na
prosa que o usuário lê.

Convenção de nomes:

| Origem | Destino no media-forge |
|---|---|
| `seedance-prompt` | `mf-video-prompt` |
| `seedance-camera` | `mf-camera` |
| `seedance-lighting` | `mf-lighting` |
| `seedance-motion` | `mf-motion` |
| `seedance-characters` | `mf-characters` |
| `seedance-continuation` | `mf-continuation` |
| `seedance-sequence` | `mf-sequence` |
| `seedance-antislop` | `mf-antislop` |
| `seedance-troubleshoot` | `mf-troubleshoot` |
| `seedance-copyright` / `seedance-filter` | `mf-safety-rewrite` (fundir) |
| `seedance-vocab-*` | `mf-vocab-*` |
| `seedance-recipes` | `mf-recipes` |
| `seedance-pipeline` | `mf-pipeline` |

Motivo de fundo: as skills de origem são específicas de Seedance, mas o media-forge
tem 4 providers. Rebranding para `mf-*` é também **generalização de escopo** — a
skill de câmera passa a servir Veo, Kling e Higgsfield, não só Seedance. Onde o
conteúdo for genuinamente específico de um modelo, isolar em bloco marcado por
provider, não no nome da skill.

### T9 — Absorver `seedance-2.0` (MIT) com rebranding para media-forge

Origem: `Emily2040/seedance-2.0` v6.6.0, 28 sub-skills, todas `license: MIT`.

- [ ] Criar `media-forge/NOTICE` (ou estender o existente) com copyright original,
      texto MIT integral e commit SHA de origem
- [ ] Absorver as 28 sub-skills renomeando conforme a tabela acima
- [ ] Reescrever cada `description` do frontmatter para linguagem media-forge e
      escopo multi-provider (hoje dizem "Seedance 2.0" em todas)
- [ ] Absorver `references/` (56 arquivos) e `schemas/` (5), removendo referências
      cruzadas `[skill:seedance-*]` → `[skill:mf-*]`
- [ ] **NÃO** absorver `references/migrated/v5.2-legacy-skill-bodies/` — código morto upstream
- [ ] Substituir `skills/seedance-prompting/SKILL.md` (arquivo único) por `mf-video-prompt`
- [ ] Verificar colisão contra as 14 skills existentes antes do merge

Critério: `claude plugin validate . --strict` passa; nenhuma skill duplicada;
nenhuma string "seedance-" sobrando em nome de skill ou referência cruzada;
`NOTICE` presente e correto.

### T10 — Portar os 5 schemas para Zod

Os schemas do seedance são JSON Schema; o media-forge valida com Zod
(`src/video/video-schemas.ts`, `src/image/image-schemas.ts`).

- [ ] `clip-contract` → `src/narrative/clip-contract.ts`
- [ ] `project-state` → `src/narrative/project-state.ts`
      (campos auditados: `story{logline, story_promise, objective, initial_condition,
      final_outcome, target_duration_sec, tone, medium}`,
      `references{tag, role, preserve_exact_tag}`,
      `scenes{scene_id, scene_index, narrative_function, arc_position, location,
      time_of_day, anchor_source, max_chain_depth, audio_plan, assigned_clip_ids,
      transition_out, status}`,
      `beats{beat_id, description, narrative_function, status, assigned_clip_id,
      dependencies}`)
- [ ] `prompt-spec` → `src/narrative/prompt-spec.ts`
- [ ] `take-review` → `src/review/take-review.ts`
- [ ] `generation-run` → reconciliar com o `trace.jsonl` já existente
- [ ] Migration SQLite para persistir `project-state` entre sessões

Cuidado: `generation-run` e o `trace/lineage` atual se sobrepõem. Reconciliar,
não duplicar — dois registros do mesmo evento divergem e corrompem o custo.

### T11 — Retake Protocol no reviewer existente

O reviewer atual (`src/review/`) faz 3 estágios com `max 3 attempts`, mas retenta
sem disciplina de variável.

- [ ] Implementar as 5 saídas de triagem: `keep | fix-in-post | edit | re-roll | rewrite`
- [ ] **Uma variável por retake** — registrar qual mudou em `take-review`
- [ ] Orçamento de tentativas explícito, não só contador
- [ ] Ligar ao `router.ts` existente (que já classifica causa-raiz)

Ganho direto: hoje um retry cego pode queimar crédito repetindo o mesmo erro.

### T12 — Reference Authority Resolver

Do Operating Loop passo 7 do seedance (conceito MIT, reimplementado em TS).

- [ ] Papéis: `identity | first-frame | last-frame | product | environment | motion |
      camera | timing | audio | style`
- [ ] Invariante: cada dimensão controlada tem **exatamente um** dono, ou é marcada
      não-aplicável. Um asset pode ter várias dimensões; nenhuma dimensão tem dois donos.
- [ ] Rejeitar asset que não é dono de nada
- [ ] **Proibido inferir autoridade** de tipo de mídia, ordem de upload, nome de
      arquivo ou ordem de menção
- [ ] Encaixe: `HiggsfieldExtras.multiReferenceImages`, `SeedanceExtras` (9 image refs,
      3 video, 3 audio), Veo `with-refs` (3 assets)

### T13 — Narrative Planner (padrão vimax, código próprio)

Reimplementação em TypeScript do padrão de decomposição do `hkuds/vimax` (MIT).
**Nenhum código Python copiado** — só a arquitetura de agentes.

- [ ] `character-extractor` → elenco a partir do brief
- [ ] `screenwriter` → roteiro a partir da história
- [ ] `script-planner` → 3 modos confirmados no upstream: narrative / motion / montage
- [ ] `storyboard-artist` → decomposição em shots
- [ ] `reference-image-selector` + `best-image-selector` → seleção por consistência
- [ ] Saída alimenta `project-state` do T10
- [ ] Adotar o cap defensivo do upstream: `event_extractor` limita eventos extraídos
      porque `is_last` vem só do LLM e sem bound o loop nunca termina

**Fora de escopo em T13:** `novel2movie`. O upstream marca
`pipelines/novel2movie_pipeline.py` com `# TODO: NOT IMPLEMENTED YET` — não se
planeja em cima de código inacabado de terceiro.

### T14 — Cost-guard: reserve_pct

Lacuna real encontrada ao comparar com o `config.yaml` do OpenMontage (ideia, não código).

- [ ] `MEDIA_FORGE_BUDGET_RESERVE_PCT` (default `0.10`) — retém parte do cap diário
      para as tentativas de correção do reviewer
- [ ] Hoje o cap de $25/dia pode ser consumido por gerações, deixando zero para os
      retries do T11 — o job morre no meio
- [ ] `mode: observe | warn | cap` explicitando o comportamento atual

**T14 depende de T14-pre. Não existe cap diário para reservar percentual.**

### T14-pre — Implementar os cost guards que o README já vende (PR3a, BLOQUEANTE)

Descoberto em 2026-07-29 re-verificando em `origin/homolog`. **Pior que o achado
C7 original**, que falava só do cap diário. Os três thresholds existem apenas como
config morta:

| Campo | Declarado | Lido em `envFloat` | Consultado por algum handler |
|---|---|---|---|
| `dailyCapUsd` | `config.ts:71` | `:179` (default 25) | **não** |
| `confirmThresholdUsd` | `config.ts:72` | `:180` (default 0.5) | **não** |
| `blockThresholdUsd` | `config.ts:73` | `:181` (default 2.0) | **não** |

Evidência: `grep -rn "<campo>" src/` retorna **só** as duas linhas de `config.ts`
para cada um dos três. `grep -rniE "hard.?block|blockAbove|maxCostUsd|costCeiling"`
em `src/` retorna **zero**. `src/core/cost.ts` tem `dailyTotal()`, mas é função de
relatório: `handlers.ts` importa `queryReport` (ferramenta de report) e
`recordActualCost`, nunca um guard. Os testes que citam `blockThresholdUsd`
(`config.test.ts:62` e 7 outros) só verificam que o valor foi *parseado* — nenhum
testa enforcement.

Dos 4 tiers anunciados, **só o dry-run existe** (`dryRun`: 100 ocorrências em `src/`).

O `README.md` vende os outros três como funcionalidade entregue:

> `README.md:21` — "Cost guards (dry-run default, confirmation prompt above $0.50,
> hard block above $2.00, daily cap at $25) mitigate budget exposure"
>
> `README.md:159` — "media-forge applies a four-tier guard to every generation call"
>
> `README.md:167` — "Daily cap | $25 / day (configurable) | Blocks all spending past
> the cap; requires `--override-daily-cap`"

A flag `--override-daily-cap` documentada não existe no código.

Isso é promessa não cumprida a quem paga pelo plugin, e é o item que mais pesa
contra "apto para produção". Escopo:

- [ ] Guard consultado no caminho de geração (imagem e vídeo), antes do submit
- [ ] `blockThresholdUsd`: erro duro, não prompt
- [ ] `confirmThresholdUsd`: exige confirmação explícita
- [ ] `dailyCapUsd`: soma via `dailyTotal()` + custo estimado; bloqueia ao exceder
- [ ] `--override-daily-cap` implementada, ou removida do README — não as duas coisas
- [ ] Teste de enforcement por tier (hoje só existe teste de parsing)
- [ ] README reconciliado com o que o código faz de fato

## Delegação de testes e validação

Por instrução do usuário, **toda validação e teste vai para subagentes Sonnet 5.0**,
não para o thread principal:

| Tarefa | Subagente | Modelo |
|---|---|---|
| Testes unitários T2/T10/T11/T12 | `maxvision:maxvision-executor` | sonnet |
| Auditoria de licença/atribuição T9 | `maxvision:maxvision-security-auditor` | sonnet |
| Review pré-merge de cada tarefa | `maxvision:maxvision-code-reviewer` | sonnet |
| Verificação de cobertura T13 | `maxvision:maxvision-verifier` | sonnet |

Máximo 3–4 subagentes em paralelo (regra do CLAUDE.md). Sem nesting.

---

# Decisões do CEO Review (2026-07-29)

Modo: **SELECTIVE EXPANSION**. Abordagem: **3 PRs encadeados por risco**.

| # | Proposta | Esforço | Decisão | Razão |
|---|---|---|---|---|
| D3 | Reconciliar os 8 TODOs de billing | CC ~40min | **ACEITO** → T15 | T14 calcula reserva sobre medição quebrada |
| D4 | Absorver suíte de evals do seedance | CC ~30min | **ACEITO** → T9-b | 28 skills sem gate contradiz "bem testado é inegociável" |
| D5 | Adapter MuAPI | CC ~30min | **PR4** (depois) | aditivo puro, não desbloqueia nada do plano |
| D6 | Provider Wan2GP local | CC ~1h | **ACEITO** → T16 | ver nota abaixo — escopo redefinido pelo usuário |
| D7 | Smartcut (corte sem reencode) | CC ~1h | **TODOS.md P3** | sem consumidor: nada no plano monta timeline |

**Nota sobre D6 (redefinido pelo usuário):** o provider Wan2GP entra como
**código opcional no plugin**, com setup guiado que o usuário final decide rodar
ou não. **Nenhuma instalação ocorre na máquina do mantenedor.** Isso remove o
bloqueio de disco (C: com 3 GB) do caminho crítico — ele deixa de ser
pré-requisito de desenvolvimento e passa a ser responsabilidade de quem ativa.

### T15 — Reconciliar billing dos 4 providers (PR2, antes de T14)

- [ ] Fechar `TODO(F-E veo-cap)` em `src/mcp/handlers.ts:1717`
- [ ] Fechar `TODO(F-E veo-billing)` em `:2057, :2071, :2081, :2091`
- [ ] Fechar `TODO(F-E higgsfield-billing)` em `:2697`
- [ ] Fechar `TODO(F-E seedance-billing)` em `:2965`
- [ ] `recordActualCostUSD` chamado em todo caminho de submit, não só nos felizes
- [ ] Teste: custo estimado vs custo reconciliado diverge menos que tolerância

Sem isso, T14 reserva percentual de um número que não reflete gasto real.

### T9-b — Absorver a suíte de evals (PR2, junto com T9)

- [ ] Absorver `evals/evals.json`, `evals/generation-benchmark.json`,
      `references/eval-rubric.md` (MIT, mesma atribuição do T9)
- [ ] Portar validadores Python para Vitest, ligados ao `pnpm test:evals` existente:
      `prompt_lint.py` → `prompt-lint.test.ts`,
      `schema_check.py` → `schema.test.ts`,
      `behavior_contract_check.py` → `contract.test.ts`
- [ ] Gate: as 42 skills passam a ter verificação a cada edição

### T5-guard — CLI Higgsfield restrito a single-tenant (D8, CRITICAL GAP)

O CLI grava credencial OAuth **única por máquina**. O media-forge tem HTTP
multi-tenant (`src/http/auth.ts`, `key-store.ts`, `tier-gates.ts`). Sem guarda,
tenant A gera vídeo debitando crédito do tenant B — vazamento de custo
irreconciliável, o oposto do que T15 existe para resolver.

- [ ] `isHostedMultiTenant()` — detecta modo hospedado
- [ ] Boot falha alto se `MEDIA_FORGE_HF_CLI_ENABLED` e multi-tenant coexistem
- [ ] `'higgsfield-cli'` **nunca** entra em `ADAPTED_PROVIDERS` no modo hospedado
- [ ] Adapter API-key existente continua servindo o modo hospedado (por tenant)
- [ ] Teste: boot rejeita a combinação; mensagem cita a alternativa

Roteamento resultante: local/MCP → CLI (créditos do plano do mantenedor);
hospedado → API key (por tenant).

### T9-c — Scan de prompt injection nas skills absorvidas (D9, gate do PR2)

T9 absorve ~90 arquivos markdown de terceiro. Skill é texto que o modelo
**obedece**. Distribuir isso num plugin comercial sem ler é herdar risco.

- [ ] Subagente Sonnet varre os 90 arquivos procurando: instrução de exfiltração,
      referência a env var ou credencial, override de cost-guard ou guardrail,
      unicode invisível, URL externa, instrução de ignorar contexto anterior
- [ ] Arquivos sinalizados vão para revisão humana antes do merge
- [ ] Converter o scan em `tests/skills-injection.test.ts` — gate permanente
- [ ] Re-executa a cada sync com upstream

Bloqueia o merge do T9. Não é opcional.

### T16 — Provider Wan2GP opt-in (PR5)

- [ ] `'wan2gp'` em `PROVIDERS`, atrás de `MEDIA_FORGE_WAN2GP_ENABLED` (default `false`)
- [ ] Cliente HTTP para servidor Gradio; `pricing.rate: 0` (passa limpo no cost-guard)
- [ ] Comando `media-forge setup wan2gp` — guia o usuário final pela instalação,
      detecta VRAM e espaço em disco, **avisa antes de baixar pesos**
- [ ] Nunca instala automaticamente; nunca assume que o servidor existe
- [ ] Erro acionável quando a flag está ligada e o servidor não responde
- [ ] Documentar requisito real: 6 GB VRAM mínimo, 30–80 GB de disco

## Ordem de execução

Resequenciada em 2026-07-29 após a voz externa. A ordem anterior colocava T15
dentro do PR2 com base numa estimativa de 40min que se mostrou errada (ver C1).

**PR0 — Refatoração pura** (zero mudança de comportamento)
1. Extrair `handlers.ts` (3.092 linhas) em módulos por domínio
2. `src/core/llm-models.ts` — registry de modelo por papel (corrige `claude-opus-4-7`)
3. `src/core/llm-invoke.ts` — extrair o dual-mode `subagent | sdk` de `llm-judge.ts`
   - Gate: `pnpm test` continua em **`1587 passed | 8 skipped (1595)`** e
     **`169 passed | 4 skipped (173)`** arquivos, **sem uma linha de teste alterada**,
     com `pnpm typecheck` e `pnpm lint` limpos. Qualquer desvio nesses números
     reprova o PR — inclusive testes *a mais*, que indicariam mudança de escopo.

**PR1 — Kling + sonda de crédito** (risco baixo, urgente)
4. **T1** — credenciais em `.env` (manual, bloqueante)
5. **T7** — config MCP. **Sobe para cá como sonda**: prova o caminho de crédito e a
   superfície de parâmetros *antes* de construir qualquer wrapper com preflight,
   parsing e cinco caminhos de erro
6. **T2** / **T3** — auth e endpoints, **default `legacy`**, versão derivada do
   modo de auth (C4)
7. **T4** — registry: verificar **todas** as rates Kling, não só as 2 PLACEHOLDER
8. **T8** — smoke test. Fecha o PR com verificação real, em vez de ficar no fim de tudo

**PR2 — Absorção mecânica** (5/5 reversível, zero rede)
9. **T9** + **T9-b** + **T9-c** — skills com rebranding, suíte de evals, scan de injection
   - Nada além disso. PR puramente mecânico, revertível por `git revert`

**PR3a — Cost ledger** (pré-requisito real de T14 e T15, ver C7/C8)
10. Ledger autoritativo de gasto + gate atômico contra concorrência
11. Reserva **antes** do submit, com ID interno próprio
12. Captura/liberação via poll, webhook e sweep — mesmo ID
13. Os 4 tiers passam a ser consultados de verdade
14. Alinhar `README.md` com a realidade do enforcement

**PR3b — Reconciliação de billing** (projeto próprio)
15. **T15** sozinho — consome o ledger do PR3a (C1)

**PR4 — Schemas e qualidade**
16. **T10** — schemas Zod
17. **T11** — retake protocol (precisa de executor transacional, não só classificação)
18. **T14** — reserva, consumindo o ledger e reusando `usdPerCredit` (C3)
19. ~~T12~~ — **adiado** até `base.ts` ter campo de papel (C5)

**PR5 — Narrativa**
20. **T13** — narrative planner (o maior)

**PR6** — T5/T6 como transporte no provider `higgsfield` (C2).
**PR7** — adapter MuAPI. **PR8** — T16 Wan2GP opt-in.
**PR9** — T17 provider de imagem via Codex CLI `image_gen`, começando pelo spike.

Razão da inversão T7↔T5: T7 é configuração barata que valida a hipótese central
(créditos do plano funcionam via MCP). Construir o wrapper do CLI antes de provar
isso é construir sobre suposição. **Ressalva C10:** T7 fica como sonda manual e
superfície não governada, nunca como caminho de produção por default.

## Fora de escopo

Revisado após o CEO review de 2026-07-29.

- **Qualquer código de OpenMontage (AGPL-3.0) ou lossless-cut (GPL-2.0)** — a
  cláusula §13 de rede da AGPL contaminaria `src/billing/` comercial. Regra dura.
- **Migração do adapter Higgsfield API-key existente** — fica intacto, e após D8
  passa a ser o único caminho suportado no modo hospedado.
- **`novel2movie` do vimax** — upstream marca `# TODO: NOT IMPLEMENTED YET`.
  Registrado em `TODOS.md` P3.
- **Smartcut do lossless-cut** — sem consumidor: nada no plano monta timeline.
  Registrado em `TODOS.md` P3.
- **CLI Higgsfield no modo hospedado** — arquiteturalmente impossível (credencial
  OAuth única por máquina). Ver T5-guard.

Saíram de "fora de escopo" neste review: adapter MuAPI (agora PR4) e provider
Wan2GP (agora T16 / PR5, como opção instalável pelo usuário final).

---

# Correções da voz externa (2026-07-29, verificadas no código)

Uma leitura independente com contexto limpo encontrou 15 problemas. Seis foram
confirmados por leitura direta do código, não aceitos de confiança. Três deles
invalidavam estimativas minhas que sustentavam decisões já aprovadas.

### C1 — T15 é projeto, não tarefa (era "CC ~40min")

`src/mcp/handlers.ts:2057` documenta que o deferral é **estrutural**:

> "Reserve would key on `operationName`, but completion runs through
> `media_poll_video_operation` / `media_download_video` (id = resolved URI,
> changes; no actualUsd; no recordActualCost). Reserving here without a matching
> capture would leak the reservation until TTL → free Veo."

Fechar isso exige um **store de correlação submit→poll** que não existe. T15 passa
a ser PR próprio, dimensionado como projeto. Estimativa anterior descartada.

### C2 — T5 estava no eixo errado: transporte, não vendor

`src/core/models.ts:91` define `readonly provider: Provider`, e **10 specs** usam
`provider: 'higgsfield'`. Criar `'higgsfield-cli'` em `PROVIDERS` forçaria duplicar
os 10 specs ou registrar um provider sem modelo nenhum.

- [ ] **Remover** a mudança em `PROVIDERS` de T5
- [ ] Adicionar campo de **transporte** no provider `higgsfield` existente:
      `transport: 'api-key' | 'cli'`
- [ ] T5-guard passa a chavear no transporte, não no nome do provider
- [ ] T6 encolhe junto (dependia da forma antiga de T5)

### C3 — T14 duplicava mecanismo existente e colidia em nome

`src/core/pricing.ts:10` já tem `usdPerCredit`, e `:56` já trata
`credits-per-video`. `src/billing/debit.ts:13` já exporta **`reserveForJob`**.

- [ ] **Não** criar a unit `credits-per-job` — usar `credits-per-video` + `usdPerCredit`
- [ ] Renomear `reserve_pct` para evitar colisão com `reserveForJob`
- [ ] Declarar explicitamente **qual** das três moedas é reservada: USD de API,
      crédito de plano Higgsfield, ou crédito de billing de tenant (`billing/debit.ts`)
- [ ] Revisar o default: `$25 × 0,10 = $2,50`, mas um retake de `kling-v3-master`
      custa `0,18 × 10s = $1,80` — financia 1 tentativa enquanto T11 orça 3

### C4 — T2/T3 embutiam um default que quebra deployment existente

Dois interruptores tratados como independentes que não são: `KLING_API_KEY`
ausente cai no JWT legacy, mas `MEDIA_FORGE_KLING_API_VERSION=2` (default) monta
paths v2. Deployment com só ACCESS/SECRET recebe **401 em tudo**.

- [ ] **Derivar** a versão do modo de auth, não expor flag paralela
- [ ] Default `legacy` quando só ACCESS/SECRET estiverem presentes
- [ ] Teste explícito: ACCESS+SECRET sem API_KEY resolve para paths legacy

### C5 — T12 valida contabilidade que nenhum provider consome

`src/video/providers/base.ts:57` é `multiReferenceImages?: ReadonlyArray<string>`
— strings puras, **sem campo de papel**. O resolver produziria atribuição de
autoridade que nunca chega ao provider.

- [ ] **Adiar T12** até algum provider aceitar papel no wire
- [ ] Registrar em `TODOS.md` com o gatilho: "quando `base.ts` tiver campo de role"

### C6 — NOTICE não existe

`media-forge/` tem `LICENSE` e `LICENSE-COMMERCIAL/EULA.md`. Não há `NOTICE`.
T9 dizia "ou estender o existente" — errado.

- [ ] T9 **cria** `media-forge/NOTICE` do zero

### Aberto, sem decisão ainda

- **Colisão de skills:** `skills/` já tem `higgsfield-prompting` e `kling-prompting`.
  T9 substitui só `seedance-prompting`. As duas sobreviventes competem com
  `mf-video-prompt` e `mf-camera` por ativação via description. Falta regra.
- **T9 rebranding:** renomear `seedance-camera` → `mf-camera` assume que o
  vocabulário de câmera do Seedance transfere para Kling e Veo. Não validado.
- **T16 (Wan2GP):** a voz externa recomenda cortar (provider para servidor que o
  mantenedor não instala nem testa). Você aprovou explicitamente como opção
  instalável pelo usuário final — **mantido**, recomendação registrada.

---

# Correções da segunda voz externa — Codex 0.146 (2026-07-29)

14 achados. Os quatro abaixo verificados por leitura direta do código.

### C7 — CRÍTICO: o cost-guard não existe como enforcement

`dailyCapUsd` aparece em **exatamente dois lugares**: `src/core/config.ts:71`
(declaração de tipo) e `:187` (leitura de env com default 25). **Nenhum handler de
geração consulta.** Existem estimadores e relatórios; não existem os quatro tiers
de bloqueio que o `README.md` descreve.

Consequência: T14 dizia "estender o cost-guard". Não há o que estender. E o
`README.md` promete ao comprador do plugin um freio de gasto que o código não aplica.

- [ ] **PR3a (novo)** — construir o cost ledger de verdade, antes de T15 e T14
- [ ] Ledger autoritativo de gasto por período
- [ ] Gate **atômico** contra concorrência (8 gerações paralelas no plano Ultra)
- [ ] Os 4 tiers passam a ser realmente consultados no caminho de geração
- [ ] **Alinhar `README.md` com a realidade** enquanto o enforcement não existir

### C8 — CRÍTICO: a reserva acontece depois do gasto

`src/mcp/handlers.ts:2807`, comentário literal no código:

> `// F-E: reserve AFTER submit, keyed on the returned jobId`

Saldo insuficiente rejeita o usuário **depois** que o job pago já foi criado.
Fechar os 8 TODOs sem corrigir isso preserva o defeito central.

- [ ] Gerar **ID interno próprio** antes do submit
- [ ] Reservar **antes** do submit, com esse ID
- [ ] Capturar ou liberar via poll, webhook **e** sweep — todos com o mesmo ID
- [ ] `recordActualCostUSD` só no terminal: custo real não existe no submit

### C9 — ALTO: a atribuição MIT não chegaria ao pacote publicado

`media-forge/package.json` → `files` contém `LICENSE`, **não contém `NOTICE`**.
T9 criaria o NOTICE no repositório, mas o artefato npm sairia sem ele — violação
da MIT no que é efetivamente distribuído.

- [ ] Adicionar `"NOTICE"` ao array `files` do `package.json` como parte do T9
- [ ] Teste: `npm pack --dry-run` lista `NOTICE`

### C10 — ALTO: T7 contorna todos os controles

Registrar o MCP remoto do Higgsfield permite gerar **fora** do adapter, do cost
ledger, da reserva, do trace, do lineage e dos tenant gates. Isso conflita com a
promoção de T7 a "sonda" no PR1.

- [ ] T7 permanece como sonda de validação **manual**, não como caminho de produção
- [ ] Documentar explicitamente como **superfície não governada**
- [ ] Não registrar por default; opt-in separado e nomeado

### Achados do Codex ainda não verificados arquivo a arquivo

Raciocínio se sustenta, verificação pendente. Tratar como hipótese a confirmar
durante a tarefa correspondente, não como fato:

- `pickEndpoint` recebe modo/extras mas **não `modelId`** (`kling.ts:376`) — uma
  flag global "2.0" não resolveria Standard/Pro/Master/Omni. T3 precisa de matriz
  explícita modelo × capability × submit path × poll path.
- `cost-tracker.ts:17` persiste só `endpoint_kind`. Sem persistir a versão efetiva
  por job, jobs em voo ficam impoláveis se a flag mudar.
- T10/T12/T13 produzem estado que **nenhuma tarefa consome** — falta CRUD de
  project-state, invocação do planner e conversão de autoridade em `ProviderExtras`.
- T16 sem model specs com preço zero **venceria todo roteamento** quando habilitado,
  mesmo com o servidor offline.
- `--wait` do CLI bloqueia a requisição MCP inteira e não encaixa no lifecycle
  assíncrono `generate/poll/download` de `base.ts:265`.

---

### T17 — Provider de imagem via Codex CLI `image_gen` (PR9)

Aprovado pelo usuário em 2026-07-29. Terceira fonte de imagem, sem custo marginal:
já paga dentro da assinatura ChatGPT, não consome crédito Higgsfield nem API Google.

**Fonte:** `openai/codex`, `codex-rs/skills/src/assets/samples/imagegen/SKILL.md`.
Verificado em 2026-07-29 com `codex-cli 0.146.0` instalado.

| Capacidade | Valor |
|---|---|
| Tool | `image_gen`, built-in do Codex CLI |
| Modelo | `gpt-image-2` |
| Credencial | login ChatGPT — **não** requer `OPENAI_API_KEY` |
| Gera | texto→imagem, com imagens de referência para estilo e composição |
| Edita | inpainting, troca de fundo, remoção de objeto, mudança de luz e clima |
| Resoluções | 1024×1024, 1536×1024, 1024×1536, 2048×1152, 3840×2160, 2160×3840 |
| Limites | borda máx 3.840px; 655.360 a 8.294.400 pixels totais |
| Qualidade | `low` / `medium` / `high` / `auto` |

**Decisões do usuário (2026-07-29):**

- **`gpt-image-1.5` está fora.** Só `gpt-image-2`, na melhor qualidade disponível.
- **Sem multi-tenant.** O Codex CLI é pré-requisito de instalação do usuário final:
  quem quiser usar o provider instala e autentica na própria máquina. Não é
  limitação a contornar, é o modelo de distribuição.
- **Ativo por padrão para o mantenedor** (já tem Codex 0.146 instalado e autenticado).

**Configuração de qualidade máxima:**

| Parâmetro | Valor |
|---|---|
| Modelo | `gpt-image-2` (único) |
| Qualidade | `high` — nunca `low` nem `medium` |
| Resolução padrão | `3840×2160` (16:9) e `2160×3840` (9:16) — 4K nativo |
| Quadrado | `1024×1024`; para máximo, `2048×1152` em 16:9 |
| Referências | usar sempre que houver asset de identidade disponível |

**Duas restrições reais que mudam o desenho:**

1. **Não é endpoint, é agente.** `image_gen` é tool interna do Codex, acessível só
   via `codex exec`. O Codex decide como responder; não há contrato de request
   determinístico como numa API REST. O adapter trata saída variável e **falha alto**
   quando o formato não vier como esperado — nunca infere sucesso.
2. **Bloqueia a requisição.** `codex exec` roda até o fim, como o `--wait` do
   Higgsfield CLI criticado em C10. Não encaixa no lifecycle assíncrono
   `generate/poll/download` de `base.ts:265` sem uma camada de job local.

**Transparência fica explicitamente fora de escopo.** Sem `gpt-image-1.5`, o
`image_gen` não produz PNG com alpha nativo. O caminho oficial deles seria gerar
sobre chroma-key e remover por script — isso é workaround, não qualidade, e foi
descartado. Quando o trabalho exigir alpha real, a rota é **Nano Banana Pro** ou
**Imagen 4 Ultra**, que já estão no plugin e fazem isso nativamente. Um provider
por necessidade, em vez de forçar um a fazer o que não faz bem.

**Tarefas:**

- [ ] Preflight de instalação: binário no PATH, `codex --version` compatível, sessão
      autenticada. Se faltar qualquer um, erro acionável dizendo o que instalar
- [ ] `MEDIA_FORGE_CODEX_IMAGE_ENABLED` — default `true` no modo local/MCP pessoal
- [ ] Bloquear no modo hospedado multi-tenant, reusando a guarda do T5-guard: não é
      incompatibilidade a resolver, é escopo declarado
- [ ] Sandbox de escrita: `-s read-only` **não** grava a imagem. Definir diretório de
      saída explícito e o modo de sandbox mínimo que permita gravar só ali
- [ ] Argumentos como array, nunca string concatenada — mesma invariante do T5
- [ ] Forçar `quality: high` no adapter; não expor `low`/`medium` na superfície MCP
- [ ] Custo: `pricing.rate: 0` (já pago na assinatura). **Aplicar a mitigação do C13**
      — preço zero faria o modelo vencer todo roteamento; a seleção precisa ser
      explícita, nunca por heurística de custo
- [ ] stdout/stderr do processo → `trace.jsonl`
- [ ] Documentar no README: requer Codex CLI instalado; não faz alpha nativo

**Não validado:** o formato exato de invocação de `image_gen` via `codex exec`
não-interativo. A doc descreve a tool em contexto de sessão; não testei a chamada
programática. **Primeira tarefa do T17 é um spike de 1 geração** confirmando forma
de chamada e formato de saída, antes de escrever qualquer adapter.

## O que já existe e é reaproveitado

| Já no media-forge | Tarefa que reusa |
|---|---|
| `soul-id-cache.ts` + `migrations/sqlite/002-soul-ids.sql` | T6 (não recria) |
| Reviewer 3 estágios, máx 3 tentativas (`src/review/`) | T11 estende |
| `trace.jsonl` + `lineage.json` | T10 reconcilia |
| Cost-guard 4 tiers (o cap diário **não** existe de fato — ver PR3a) | T14 estende |
| `ADAPTED_PROVIDERS` como gate (`handlers.ts:169`) | T5, T16 reusam |
| `vitest.evals.config.ts` + `pnpm test:evals` (hoje 2/2 falhando por credencial) | T9-b liga a suíte |
| `ffmpeg-static` + `src/core/ffmpeg.ts` | smartcut, se um dia |
| 185 arquivos `*.test.ts` tracked; 173 coletados; 1587 testes verdes | base para toda validação nova |

## MAXVISION ORCHESTRATION REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | clean | SELECTIVE EXPANSION; 5 propostas, 3 aceitas, 2 diferidas; 2 CRITICAL GAPS mitigados |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean | 7 findings; PR0 de refatoração adicionado; 47 codepaths especificados |
| Outside Voice | independent challenge | blind spots | 1 | issues_found | 15 achados; 6 confirmados no código; resequenciamento aplicado |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | n/a | sem escopo de UI |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | não executado |

**ENG REVIEW — FINDINGS:**

| Seção | Resultado |
|---|---|
| 0 Escopo | complexity check disparou (24 arquivos de código) → PR0 de refatoração pura |
| 1 Arquitetura | 2 P1: model ID `claude-opus-4-7` hardcoded; T12 no diretório errado |
| 2 Qualidade | 2 P1: dual-mode preso em `llm-judge.ts`; link rot em 90 arquivos do T9 |
| 3 Testes | diagrama produzido — 47 codepaths, 47 testes especificados, 3 invariantes de segurança |
| 4 Performance | 1 P2 corrigido: custo das 42 skills era irrelevante; risco real é o teto de 5.000 tokens/skill na recompactação |

**VOZ EXTERNA — CONFIRMADO NO CÓDIGO (6 de 15):**

| # | Achado | Evidência |
|---|---|---|
| C1 | T15 é projeto, não tarefa de 40min | `handlers.ts:2057` — deferral estrutural, falta correlação submit→poll |
| C2 | T5 no eixo errado (vendor vs transporte) | `models.ts:91` + 10 specs com `provider: 'higgsfield'` |
| C3 | T14 duplicava mecanismo e colidia em nome | `pricing.ts:10` `usdPerCredit`; `debit.ts:13` `reserveForJob` |
| C4 | T2/T3 com default que quebra deployment | versão v2 + JWT legacy = 401 |
| C5 | T12 sem representação no wire | `base.ts:57` strings puras, sem role |
| C6 | NOTICE não existe para "estender" | só `LICENSE` e `LICENSE-COMMERCIAL/` |

**SEGUNDA VOZ EXTERNA — Codex 0.146, CONFIRMADO NO CÓDIGO (4 de 14):**

| # | Achado | Evidência |
|---|---|---|
| C7 | **Cost-guard não existe como enforcement** | `config.ts:71,179` são os únicos usos de `dailyCapUsd`; nenhum handler consulta. `README.md` promete 4 tiers inexistentes |
| C8 | Reserva acontece **depois** do gasto | `handlers.ts` — `// reserve AFTER submit` |
| C9 | Atribuição MIT não chegaria ao pacote | `package.json` `files` tem `LICENSE`, não tem `NOTICE` |
| C10 | T7 contorna adapter, ledger, trace e tenant gates | MCP remoto gera fora de todo controle |
| ~~—~~ | ~~Base de branch errada~~ **RETRATADO** | O check usou `git branch --contains` (só branches locais) com `homolog` local defasado. `git merge-base --is-ancestor 97cb0b9 origin/homolog` = 0: o oracle **já estava** em `origin/homolog`. Nenhum cherry-pick era necessário |
| — | **Plano medido na branch errada** | Todo o plano foi escrito lendo `feat/n8n-mcp-alignment`, 80 arquivos atrás de `origin/homolog`. Achados de substância re-verificados e mantidos; números de linha e o baseline de testes corrigidos (ver T0) |

**CROSS-MODEL:** Codex 0.128.0 falhou (`gpt-5.6-sol requires newer version`);
migrado npm→pnpm e atualizado para 0.146.0, então re-executado. As duas vozes
convergiram independentemente em três pontos — `higgsfield-cli` é o eixo errado
(S4/C2 e Codex #7), a unidade de custo proposta não encaixa (S5/C3 e Codex #8), e
T15 é maior que o declarado (S2/C1 e Codex #5). Convergência entre modelos
diferentes elevou a confiança nesses três de "plausível" para "tratado como fato".

Divergência: a voz Claude afirmou que o eng review não rodou (S1) — incorreto,
rodou nesta sessão, e as 11 seções que ela viu eram do CEO review.

**ESCOPO FINAL:** 20 tarefas em 12 PRs. Adicionadas por review: T0 (base),
PR0 (refatoração), PR3a (cost ledger), T5-guard, T9-b, T9-c, T15, T16, T17.
Adiada: T12. Diferidas para `TODOS.md`: smartcut, novel2movie, reconciliação
`generation-run`.

**CRITICAL GAPS:** 2 do CEO review (mitigados), 6 da primeira voz externa
(corrigidos), 4 do Codex (corrigidos), 1 de base de branch (T0). 0 em aberto.

**RISCO COMERCIAL REGISTRADO:** o `README.md` do media-forge descreve um cost-guard
de 4 tiers que o código não aplica. Enquanto PR3a não existir, isso é promessa não
cumprida ao comprador do plugin. Correção do README é item do PR3a.

**UNRESOLVED:** 3 pontos registrados sem decisão — regra de colisão entre
`higgsfield-prompting`/`kling-prompting` e as skills `mf-*`; validação de que o
vocabulário Seedance transfere para Kling e Veo; recomendação de corte do T16
(mantido por decisão explícita do usuário).

**VERDICT:** CEO + ENG CLEARED, com duas vozes externas aplicadas. Pronto para
implementação a partir do T0. Nenhum crédito Higgsfield consumido durante os reviews.
