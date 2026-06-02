# Execution Orchestration — Fases restantes (F-B em voo; F-C/F-E/F-F/F-G/F-I)

> Como executar as fases restantes do media-forge infoproduto com **economia de modelo** (sonnet por padrão, opus só no crítico) e **paralelização conflict-aware** (não colidir em arquivos quentes), mantendo gates de qualidade pra evitar bugs no deploy.

## 1. Roteamento de modelo (economia — classificação de complexidade estilo orchestrate)

| Fase | Modelo | Racional |
|---|---|---|
| F-B | **opus** (em voo) | reconciliação de handlers de provider + path de entrega; já despachado |
| F-C | **sonnet** | padrão: hash de API key (`node:crypto`) + rate-limit Redis + gating por tier — totalmente especificado |
| F-F | **sonnet** | CF Worker + cliente de licença; sensível mas padrão e bem especificado |
| F-G | **sonnet** | declarativo: `plugin.json` / `marketplace.json` (schema JSON) |
| F-I | **sonnet** | galeria CRUD + `pg_dump` cron — padrão |
| F-E | **opus** | dinheiro: reserve/capture/release idempotente, reconciliação de `external_id`, grant por webhook — correção crítica |

Default = **sonnet**. Opus reservado a **F-E (dinheiro)** e ao F-B já em execução. Economia: 4 de 6 fases em sonnet.

## 2. Matriz de conflito de arquivos (por que a paralelização é limitada)

Arquivos QUENTES (tocados por múltiplas fases → NÃO paralelizar, conflito de merge/lógica):

| Arquivo | F-B | F-C | F-F | F-E | F-I |
|---|---|---|---|---|---|
| `media-forge/src/http/app.ts` | rotas webhook | middleware auth/tenant | middleware licença | — | — |
| `media-forge/src/mcp/handlers.ts` | upload/entrega | gating tier | débito | — | galeria write |
| `media-forge/src/http/auth.ts` | — | resolveAuth async | — | — | — |
| `.maxvision/deploy/media-forge-mcp.stack.yml` | MINIO_* | redis/REDIS_URL/DB | licença envs | — | backup svc |

Conflict-FREE (seguro paralelizar):
- **F-G**: `media-forge/.claude-plugin/plugin.json`, `marketplace.json`, dir novo do plugin fino, docs de onboarding. **Zero** overlap com src/http / handlers / stack.

## 3. Plano de paralelização (correto + conflict-aware)

- **Paralelo-seguro AGORA (junto com F-B):** **F-G** (sonnet) — arquivos disjuntos. Paralelismo real, sem colisão.
- **Trilha sequencial (arquivos quentes compartilhados), com integrar+deploy+verificar ENTRE cada:**
  `F-B → F-C → F-F → F-I → F-E`
  - Cada fase: executa no homolog (já tem as anteriores), TDD, gates verdes, integra, deploy via Portainer, **verifica em produção**, só então a próxima. Evita conflito nos arquivos quentes E impede bug composto (cada deploy provado antes do próximo construir em cima).
- **F-E por último:** precisa F-C (tenant) + F-D (vivo) + fix de `external_id` + credenciais (Asaas/Stripe).

Wall-clock: trilha sequencial é mais lenta que N worktrees paralelos, mas worktrees paralelos colidiriam em `app.ts`/`handlers.ts`/`stack.yml` → merge hell + conflitos lógicos sutis = exatamente os "bugs na implantação" a evitar. Sequencial-com-verificação é o trade correto. F-G recupera o único paralelismo limpo.

## 4. Gates de qualidade (evitar bug no deploy)

- **Por fase:** `pnpm typecheck && lint && test` verde antes de integrar; deploy via Portainer; verificar `/health` + comportamento real pós-deploy; env-contract enxuto (sem env morta); healthcheck `127.0.0.1`; media-forge fixo em **v0.2.0** (force-move da tag).
- **Dinheiro (F-E):** unificar `external_id` → `cap-{reservationId}` / `rel-{reservationId}` em AMBOS (cliente F-E + sweep do credit-core); testes de concorrência/idempotência DEVEM rodar (embedded-postgres), não skip.
- **APIs externas:** S3 presigner (F-B), Asaas/Stripe (F-E), CF Workers/KV (F-F) confirmados via context7/sandbox no início de cada fase (context7 não estava acessível no planejamento).
- **Worktree base:** dispatch direto no homolog (não `isolation:worktree`) porque a base de worktree saiu antiga (pré-F-A) e as fases dependem do código já integrado.

## 5. Sequência de dispatch concreta

1. **Agora:** F-G (sonnet, homolog) em paralelo com F-B (opus, em voo). Disjuntos.
2. F-B termina → integrar + provisionar MinIO (bucket+key no MinIO existente) + deploy + verificar signed URL.
3. F-C (sonnet) → integrar + deploy (redis volta) + verificar.
4. F-F (sonnet) → integrar + deploy multi-arch + Worker de licença + verificar 403-em-revogação. (decisão Worker vs Keygen do dono).
5. F-I (sonnet) → integrar + deploy (backup cron) + verificar galeria.
6. F-E (opus) → fix external_id + credenciais do dono + integrar + deploy + smoke sandbox.

## 6. Decisão D1 (plan-eng-review) — isolamento de lanes paralelas

Lanes paralelas usam **worktree manual da base homolog HEAD**: `git worktree add <path> homolog`. NÃO usar `isolation:worktree` (pega base antiga pré-F-A) NEM homolog concorrente (corrida em `node_modules`/índice git/`dist` + commits intercalados + testes flaky). Worktree manual dá base CORRETA (tem F-A/F-D) + isolamento real.

- F-B: segue solo no homolog (single writer, sem corrida).
- F-G: roda AGORA num worktree próprio criado da HEAD atual do homolog; merge limpo depois (arquivos disjuntos de F-B). Branch `lane-f-g`.
- Demais paralelos futuros (se houver): mesma regra.

## MAXVISION ORCHESTRATION REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 1 P1 (parallel-lane isolation race) resolvido via worktree manual; money-gate external_id confirmado |

- **UNRESOLVED:** 0
- **Failure modes (critical gaps):** 0 — o risco de corrida (P1) foi fechado pré-dispatch (D1 → worktree manual); o risco de captura dobrada (dinheiro) está travado como gate de go-live do F-E (`external_id = cap-{reservationId}` / `rel-{reservationId}` em F-E e no sweep do credit-core).
- **Model routing (economia):** sonnet default (F-C/F-F/F-G/F-I); opus só em F-E (dinheiro) e no F-B em voo. 4/6 fases em sonnet.
- **VERDICT:** ENG CLEARED — estratégia de execução travada. Paralelo via worktree manual; trilha sequencial com deploy+verificação entre fases; F-E gated pelo fix external_id + credenciais Asaas/Stripe.
