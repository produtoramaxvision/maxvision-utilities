# Pendências — media-forge infoproduto (vivo)

> Acumulado durante a implementação. Revisar ao final. Atualizado conforme as fases avançam.

## ✅ 2026-06-21 — Pivot Fase 1: MCP único tier-gated (SHIPPED, branch `pivot/phase1`)

Single hosted MCP, acesso por tier (free/creator/pro). Self-host distribuído **eliminado**. 17 commits, verde local (typecheck/lint 0, 1558 testes, tsup OK; CI sem quota — validado local).

- **D1 RESOLVED** — self-host C1 morto. `src/license/`, `license-worker/`, `LICENSE-COMMERCIAL/` deletados; gate desconectado de `app.ts`/`server.ts`/`config.ts`/stack yml.
- **D2 REVERSED** — licença AGPL-3.0 → **MIT** (repo vai privado). LICENSE + 3 manifests + README.
- **F-F (Worker de licença) OBSOLETO + removido** — camada self-host deletada no pivot; seção F-F, decisões D1/D2 (licença) e as partes F-G do OPS6 scrubadas deste doc em 2026-06-21.
- **Tier engine (approach B): wired + audited + reconciled, mas INERTE até o checkout self-serve (Fase 2 / gate EXT abaixo).** `setTenantTier` (tx atômica + audit `tier_changes`), `reconcileTiers` (source of truth `subscriptions`), webhooks Stripe/Asaas dirigem tier (sub→creator/pro, cancel→free), loop de reconcile endurecido (log estruturado + guard anti-overlap).
- **T12b — ✅ FEITO:** migrations `004_tier_changes.sql` + `005_subscriptions.sql` aplicadas manualmente no prod `media-forge-mcp_mcp-postgres` (db `media_forge`), em tx. Ambas tabelas confirmadas. **OPS3 RESOLVIDO** (runner pg automático shipped — ver OPS3 abaixo; ativa no próximo deploy do media-forge).

**Desvios do plano achados na execução (auditoria):**
1. Task 3 do plano não listava `tests/unit/license/` (4 testes do módulo deletado) — removidos junto, senão typecheck/test quebravam.
2. Comando de teste do plano (`--config vitest.integration.config.ts`) daria **falso-skip** (esse config não tem global-setup → sem `DATABASE_URL`). Os int tests rodam pelo config default (embedded-postgres). T9 validado pelo caminho correto.
3. `vitest.config.ts` referenciava o `license-gate.test.ts` deletado (include morto) — removido.
4. Import órfão `hostname` (node:os) em `server.ts` removido junto com o bootstrap de licença.

**Caveat pré-go-live (Fase 2):** o shape Stripe `invoice.subscription_details.metadata.tier` veio do plano (não re-checado ao vivo, inerte hoje). Confirmar via stripe-mcp antes de ligar o checkout `pro`. Asaas (`SUBSCRIPTION_DELETED`/`SUBSCRIPTION_INACTIVATED`, payload `subscription.{id,customer}`) **confirmado** na doc oficial.

**Fase 2 (não construída):** OAuth 2.1 via Supabase como AS + checkout self-serve. `pro`-tier depende do D3 (conta Stripe `acct_1SWXI9` ainda não conectada).

## 🔴 Ações suas — segurança/config (destravam o produto)

| # | Item | Por quê |
|---|---|---|
| S1 | **Rotacionar a senha admin do Portainer + o token de API** | Senha e token (`ptr_…HQD0=`) vazaram em texto plano no chat. Rotacionar ambos: Portainer → Users/admin (senha) + Account → Access tokens (revogar/reemitir o token usado no deploy OPS2). |
| S2 | Preencher `GOOGLE_API_KEY` no Portainer (stack 69) | Sem ela o handshake MCP autentica mas retorna 500 (`buildServer`→ConfigError). Com ela, a forja gera. Opcionais: `ANTHROPIC_API_KEY` (review), `FAL_KEY`/`HF_*`/`BYTEPLUS_ARK_API_KEY` (vídeo), `MEDIA_FORGE_OCR_GOOGLE_VISION_KEY` (OCR). |
| S3 | Guardar a key creator `mfk_0e49…` com segurança | Primeira API key do produto (tier creator). Revogável/reemitível, não recuperável. |
| S4 | **Rotacionar a `sk_live` do Stripe** (Dashboard → Developers → API keys → Roll) | A secret LIVE (`sk_live_…Tj4I4`) foi colada em texto plano no chat. Queimada. A CLI usa `sk_test`/`rk_live` próprios — F-E nunca usa a `sk_live` colada. |
| S5 | **Regenerar a chave PROD do Asaas** (Config → Integrações → API) | A chave de produção (`$aact_prod_…1YjVi`) foi colada em texto plano. A sandbox (`$aact_hmlg_…`) é a usada no dev. |
| S6 | **Rotacionar o token da API do Portainer + senha admin** (Portainer → My account → Access tokens; e trocar a senha) | Token (`ptr_…HQD0=`) e senha admin foram colados em texto plano no chat (sessão 2026-06-20). Token dá controle total do Swarm. Usado pra validar o deploy do F1; rotacionar após. |

## ⚖️ Decisões que preciso de você

| # | Decisão | Contexto |
|---|---|---|
| D3 | 🔴 **BLOQUEADO na sua ação: moeda decidida (Ambas BRL+USD), mas conta Stripe errada conectada.** | Decisão 2026-06-21: **multi-currency** (prices BRL + USD por pack). Modo TEST confirmado no MCP. PORÉM o stripe-mcp está conectado na `acct_1SWLoD` (Meu Agente), e o billing F-E usa `acct_1SWXI9` (MaxVision). **Pra eu provisionar:** reconecte o stripe-mcp na `acct_1SWXI9`. Catálogo pronto abaixo (gate 2). |

## ✅ F-E — Pagamentos & Billing: CÓDIGO ENTREGUE (2026-06-03)

Tasks 1–10 implementadas, testadas e commitadas na `homolog` (10 commits `feat(billing)`). Suite **1546 passed / 0 failed**. Versão mantida **0.2.0** (sem bump). **Billing dorme** no deploy hosted até as envs serem setadas — zero impacto no que já roda.

- **Entregue:** cliente credit-core (retry, 402 no-retry) · orquestrador reserve→capture/release (`external_id` determinístico) · catálogo de packs + gate de margem regra-de-ouro#3 (corrigido bug do plano — gate por pack inteiro) · store `payments`/`billing_customers` (idempotência por payment_id) · veo-cap puro (regras #1/#2/#3) · reconcile sweep (F1) · webhook Asaas (token estático) · webhook Stripe (`constructEvent`) · rotas montadas no app + reconcile loop no entrypoint · débito reserve→capture em IMAGEM (`generate_image`/`generate_imagen`) e VÍDEO Kling.
- **Chaves Stripe TEST:** a Stripe CLI já está logada na conta MaxVision (`acct_1SWXI9…`) e tem `sk_test`/`pk_test` provisionadas localmente — **não precisa de login** pra testar.

### Gates restantes do F-E (ordem)
1. **EXT1** — ✅ FEITO (credit-core v0.1.1 deployado, ver gate de dinheiro abaixo). Débito-na-geração desbloqueado.
2. **Provisionar sandbox:** criar produtos/prices Stripe TEST (+ metadata credits/creditValueUsd) + endpoint de webhook TEST (→ `whsec`) + assinatura/packs no Asaas sandbox. **🔴 BLOQUEADO (2026-06-21): stripe-mcp conectado na conta errada (`acct_1SWLoD`/Meu Agente); precisa `acct_1SWXI9`/MaxVision.** Catálogo pronto (FX 5.55, spec §4.3) — provisionar mecânico quando a conta certa conectar:

   | Pack | BRL | Créditos | creditValueUsd | USD (=brl/5.55) | metadata |
   |---|---|---|---|---|---|
   | Pack 1 (one-time) | R$19,90 | 1500 | 0.0023903 | $3,59 | `{credits:1500, creditValueUsd:0.0023903}` |
   | Pack 2 (one-time) | R$49,90 | 4200 | 0.0021403 | $8,99 | `{credits:4200, creditValueUsd:0.0021403}` |
   | Pack 3 (one-time) | R$99,90 | 9000 | 0.0020000 | $18,00 | `{credits:9000, creditValueUsd:0.0020000}` |
   | Assinatura (recurring/mês) | R$37,90 | 2500 | 0.0027315 | $6,83 | `{credits:2500, creditValueUsd:0.0027315}` |

   Cada pack = 1 product + 2 prices (BRL e USD), metadata IDÊNTICO nas duas moedas (creditValueUsd é valor interno, não muda com a moeda de exibição). USD = conversão matemática ao FX travado (5.55); arredondar pra "preço bonito" ($3,99 etc.) é decisão de marketing SUA, muda a margem — não fiz por conta própria.
3. **Iniciação de checkout:** não há tool/frontend que crie a Checkout Session/Payment Link ainda (parte do F-H landing ou um tool dedicado). Sem isso o smoke e2e não roda fim-a-fim.
4. **Ativar billing no VPS (test):** setar no Portainer `CREDIT_API_URL`/`CREDIT_API_KEY` + `ASAAS_*` + `STRIPE_*` → as rotas montam e o débito liga. Só após EXT1.

### Seams deferidos no F-E (TODO markers explícitos no código, não silenciosos)
- **Veo/Higgsfield/Seedance débito:** só Kling é ciclo totalmente reconciliável em `handlers.ts` (submit jobId == download jobId + `actualUsd`). Os outros capturam em provider modules / webhook-router → wiring maior, deferido.
- **Veo cycle-cap (Task 6 Step 4):** funções puras prontas+testadas; integração (acopla handlers a PaymentsStore+Redis) deferida pra pós-EXT1.
- **`media_edit_image`/`media_compose_scene`:** geração de imagem ainda não cobrada (`estimateImageCost` não precifica limpo).
- **F1 sweep — ✅ CÓDIGO PRONTO (2026-06-20, credit-core v0.1.2), ⏳ deploy+validação pendente.** Caller periódico implementado: scheduler `setInterval` com Redis-lock (`SET NX PX`, multi-replica-safe), anti-overlap, erro isolado, graceful shutdown (SIGTERM→server.close+stop+pool/redis cleanup), admin `POST /sweep`. Oráculo cross-service: cada reserva carrega `status_url`; o sweep faz GET (shared-secret) → `completed`→capture(custo real via `actualCredits`), `failed`/incerteza→release (fallback seguro). **Bug P0 cross-kind achado e corrigido junto:** `rel-{rid}`+`cap-{rid}` (kinds diferentes) burlavam o `ON CONFLICT (kind,external_id)` → late capture pós-release re-cobrava (overdraft). Fix = índice único parcial `uq_ledger_settle_per_reservation` (first-settle-wins, ≤1 settle/reserva) + `append` engole 23505. Plano: `.maxvision/plans/2026-06-20-credit-core-sweep-oracle.md`. media-forge: endpoint `/job-status/:jobId` (fonte `video_jobs.actual_credits`, persistido no capture live) + `reserveForJob` registra `statusUrl`. **Falta:** Task 11 (push→CI→Portainer force-update→validar `/health`+`POST /sweep`+seed reserva vencida na VPS).
- **SEAM (2026-06-20) — ✅ FECHADO (2026-06-21, commit `edfc246`).** `kling-webhook-handler.ts` agora computa e persiste `actualCredits` via o helper centralizado `videoActualCredits(actualUsd)` (em `billing/pricing.ts`), idêntico ao caminho live de download-capture (`mcp/handlers.ts`). As constantes `IMAGE_MARKUP`/`VIDEO_MARKUP`/`DEFAULT_CREDIT_VALUE_USD` foram centralizadas em `pricing.ts` (DRY) — webhook-first e live agora cobram igual. Jobs Kling completados via webhook não deixam mais `video_jobs.actual_credits=NULL`, então o oráculo `/job-status` sempre devolve o custo real (não o estimate). Teste adicionado em `kling-webhook-handler.test.ts`. Liberado no release pra `main`.
- **Critério 3 (saldo insuficiente bloqueia) — parcial:** vale pra IMAGEM (reserve precede o exec → 402 bloqueia antes da chamada ao provider). NÃO vale pra Kling (reserve dispara DEPOIS do submit → o job já está enfileirado quando o 402 chega; o user fica corretamente sem cobrança, mas o host absorve aquele render). Inerente ao jobId-vindo-do-dispatch; nomear, não esconder.

## 💰 Gate de dinheiro (bloqueia go-live do F-E)

- **EXT1 — ✅ RESOLVIDO (2026-06-03, credit-core v0.1.1 deployado).** O sweep agora emite `cap-{reservationId}`/`rel-{reservationId}`, idêntico ao live (`cap-{jobId}`). Settle duplo (sweep + callback tardio) colide em `ON CONFLICT (kind, external_id)` → 1 débito só. Teste de integração de prova adicionado (sweep capture + late live capture → saldo inalterado). Imagem `ghcr.io/produtoramaxvision/credit-core:0.1.1` (arm64) publicada + serviço `credit-core_credit-core` atualizado na VPS (1/1, /health ok, healthcheck OPS1 corrigido junto). Re-tag permitido (freeze v0.2.0 é só media-forge).

## 🧩 Seams a fechar (a maioria no F-E)

- **SE1** — Observabilidade de margem usa créditos placeholder (`0`/`$0.01`) até o credit-core ser ligado ao fluxo de geração (F-E).
- **SE2 — feature (precisa plano próprio, NÃO é quick fix).** Galeria grava só no `kling_download`. Investigação 2026-06-21 mostrou: (1) `handleHiggsfieldDownload` retorna `{bytes,contentType,cdnUrl?}` — **sem `actualUsd`/jobId**, então o bloco do kling NÃO é copy-paste (cada provider tem cost-shape diferente); (2) o path principal de conclusão de vídeo é o **webhook async**, e o `video_jobs` (sqlite cost-tracker) **não tem coluna `tenant_id`** → o webhook não consegue recuperar o tenant. Escopo real: migration `video_jobs.tenant_id` (008) + popular no submit + injetar `galleryStore` no webhook router + insert por-provider. Planejar à parte.
- **SE3** — Vídeo parcial: Kling exige `MEDIA_FORGE_KLING_WEBHOOK_INSECURE=true` (sem HMAC); Higgsfield nunca usa MinIO (stub sem buffer); Seedance sobe pro MinIO mas não há tool de poll que devolva a signed URL.
- **SE4 — ✅ FEITO (2026-06-21, media-forge v0.2.7, no main):** `createClient` agora cria o `GoogleGenAI` lazy (`get ai()` no 1º acesso); `mode`/`dryRun` ficam eager-puros (sem throw). `buildServer`/handshake MCP funcionam sem `GOOGLE_API_KEY` — só a tool que usa o SDK falha (`ConfigError`), não a sessão. Só `core/client.ts` + tests (10/10). Validado local (typecheck/lint/1562 testes). **Não deployado ainda** (defensivo; ativa no próximo deploy do media-forge).

## 🛠️ Follow-ups de infra/ops

- **OPS1 — ✅ RESOLVIDO (validado 2026-06-21):** healthcheck do credit-core já em prod. A imagem `0.1.3` rodando inspeciona `["CMD-SHELL","wget -qO- http://127.0.0.1:8080/health || exit 1"]` e está `healthy` (fix entrou desde a `0.1.1`, ver EXT1). Nota anterior estava stale — nenhum rebuild necessário.
- **OPS2 — ✅ FEITO (2026-06-21):** `postgres-backup-local:16` adicionado ao stack credit-core (serviço `credit_postgres_backup`, vol `credit_pgbackups`, cron 6h, retenção 14d/8w/12m). Deployado via Portainer API (stack 68, env preservado → credit-core intacto em 0.1.3). Verificado: dump real `credit_core-*.sql.gz` criado com sucesso.
- **OPS3 — ✅ DEPLOYADO (2026-06-21, media-forge v0.2.6):** runner pg automático no media-forge (`src/core/pg-migrate.ts` + boot wiring em server.ts + `scripts/migrate.mjs` + `db:migrate`). Aplica só migrations underscore `NNN_*.sql` (dash são track refs via psql var); idempotente + tracking `schema_migrations`. Ativado no boot da `0.2.6` na VPS (001-005 já existiam → no-op idempotente + seed do `schema_migrations`; futuras aplicam sozinhas).
- **OPS4** — Actions Docker no CI usam Node 20 (deprecação jun/2026) — pinar/atualizar `docker/*-action`.
- **OPS5** — Worktree leftover (`.claude/worktrees/agent-a439…`) fisicamente no disco (gitignored, node_modules travado no Windows) — `git worktree prune` + remover dir.
- **OPS6** — decidir hosting do marketplace do plugin (repo próprio vs atual). _(Partes F-G de licença removidas — camada de licença deletada no pivot 2026-06-21.)_
- **OPS7** — Build **multi-arch** (amd64+arm64): a primeira tentativa via QEMU **travou >2h**. Refeito com o padrão oficial Docker — runners **nativos** por arch (amd64 em `ubuntu-latest`, arm64 em `ubuntu-24.04-arm`), push por digest + merge de manifest, `timeout-minutes:30`. Dependência: o runner hosted `ubuntu-24.04-arm` precisa estar habilitado no plano do org (privado). Se a fila do job arm64 travar, validar disponibilidade ou cair pra QEMU-com-timeout. Validado neste deploy: ver run da tag.
- **OPS8 — ✅ FEITO (2026-06-21, commit `8775418`): Windows CI não-bloqueante.** O runner `windows-latest` não consegue bootstrapar o `embedded-postgres` (`pg_ctl` falha) → suites pg-backed jogam erro na coleta. Não é bug de código e não tem fix runner-side. `ci.yml` mantém Windows pra typecheck/lint/build (sinal real; dev box é Windows) mas marca o step **Test** `continue-on-error` só no Windows. Ubuntu segue como gate autoritativo. Para de bloquear todo merge.
- **OPS9 — ✅ FEITO (2026-06-21, commit `8775418`): stale-LB converge hardening.** Ambos serviços-app já têm `HEALTHCHECK` na imagem (wget `/health`) + `start-first`, então a saúde do task é gated. Endurecido `update_config` dos dois stacks com `monitor: 30s` + `failure_action: rollback` + `rollback_config` (converge observado e auto-revert). O resíduo do IPVS mantendo a task antiga por segundos pós-converge no overlay `net` é inerente do Swarm e money-safe (404 → sweep release); documentado inline com o remédio `docker service update --force <stack>_<svc>`.

## 🌐 Gates externos de go-live comercial (seus/terceiros)

- **EXT-A** — Confirmar pricing Vertex AI / Veo ao vivo (precisão do COGS).
- **EXT-B** — Validar imposto (Simples ~6%) com contador.
- **EXT-C** — Construir a landing (F-H) no Claude Design (prompt pronto em `.maxvision/specs/`).
- **EXT-D** — Se distribuir via npm: confirmar schema do `marketplace.json` source npm.
