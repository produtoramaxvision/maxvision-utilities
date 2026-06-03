# Pendências — media-forge infoproduto (vivo)

> Acumulado durante a implementação. Revisar ao final. Atualizado conforme as fases avançam.

## 🔴 Ações suas — segurança/config (destravam o produto)

| # | Item | Por quê |
|---|---|---|
| S1 | **Rotacionar a senha admin do Portainer** | Vazou em texto plano no chat desta sessão. |
| S2 | Preencher `GOOGLE_API_KEY` no Portainer (stack 69) | Sem ela o handshake MCP autentica mas retorna 500 (`buildServer`→ConfigError). Com ela, a forja gera. Opcionais: `ANTHROPIC_API_KEY` (review), `FAL_KEY`/`HF_*`/`BYTEPLUS_ARK_API_KEY` (vídeo), `MEDIA_FORGE_OCR_GOOGLE_VISION_KEY` (OCR). |
| S3 | Guardar a key creator `mfk_0e49…` com segurança | Primeira API key do produto (tier creator). Revogável/reemitível, não recuperável. |
| S4 | **Rotacionar a `sk_live` do Stripe** (Dashboard → Developers → API keys → Roll) | A secret LIVE (`sk_live_…Tj4I4`) foi colada em texto plano no chat. Queimada. A CLI usa `sk_test`/`rk_live` próprios — F-E nunca usa a `sk_live` colada. |
| S5 | **Regenerar a chave PROD do Asaas** (Config → Integrações → API) | A chave de produção (`$aact_prod_…1YjVi`) foi colada em texto plano. A sandbox (`$aact_hmlg_…`) é a usada no dev. |

## ⚖️ Decisões que preciso de você

| # | Decisão | Contexto |
|---|---|---|
| D1 | **F-F licença: Cloudflare Worker (recomendado) vs Keygen** | Cliente de licença é agnóstico → escrevo o código já; o deploy do Worker precisa das creds CF (Account ID, Wrangler token, KV). |
| D2 | **Relicenciar o core MIT → AGPL-3.0?** | Spec §5 pede AGPL+EULA; o core hoje é MIT. O EULA do F-F cobre só a licença comercial self-host, NÃO relicencia o core sozinho. Decisão do dono. |
| D3 | **F-E catálogo: moeda do Stripe (intl) + fluxo de metadata** | CÓDIGO F-E PRONTO (ver bloco abaixo). Falta criar os produtos/planos. O webhook do Stripe concede créditos lendo `event.data.object.metadata.credits` + `creditValueUsd` → a iniciação do checkout (Payment Link/Session) PRECISA carregar esses metadados. Decisão: prices intl em USD ou BRL? Asaas sandbox já tem a chave (`$aact_hmlg_`). |

## ✅ F-E — Pagamentos & Billing: CÓDIGO ENTREGUE (2026-06-03)

Tasks 1–10 implementadas, testadas e commitadas na `homolog` (10 commits `feat(billing)`). Suite **1546 passed / 0 failed**. Versão mantida **0.2.0** (sem bump). **Billing dorme** no deploy hosted até as envs serem setadas — zero impacto no que já roda.

- **Entregue:** cliente credit-core (retry, 402 no-retry) · orquestrador reserve→capture/release (`external_id` determinístico) · catálogo de packs + gate de margem regra-de-ouro#3 (corrigido bug do plano — gate por pack inteiro) · store `payments`/`billing_customers` (idempotência por payment_id) · veo-cap puro (regras #1/#2/#3) · reconcile sweep (F1) · webhook Asaas (token estático) · webhook Stripe (`constructEvent`) · rotas montadas no app + reconcile loop no entrypoint · débito reserve→capture em IMAGEM (`generate_image`/`generate_imagen`) e VÍDEO Kling.
- **Chaves Stripe TEST:** a Stripe CLI já está logada na conta MaxVision (`acct_1SWXI9…`) e tem `sk_test`/`pk_test` provisionadas localmente — **não precisa de login** pra testar.

### Gates restantes do F-E (ordem)
1. **EXT1** — ✅ FEITO (credit-core v0.1.1 deployado, ver gate de dinheiro abaixo). Débito-na-geração desbloqueado.
2. **Provisionar sandbox:** criar produtos/prices Stripe TEST (+ metadata credits/creditValueUsd) + endpoint de webhook TEST (→ `whsec`) + assinatura/packs no Asaas sandbox. Depende de D3.
3. **Iniciação de checkout:** não há tool/frontend que crie a Checkout Session/Payment Link ainda (parte do F-H landing ou um tool dedicado). Sem isso o smoke e2e não roda fim-a-fim.
4. **Ativar billing no VPS (test):** setar no Portainer `CREDIT_API_URL`/`CREDIT_API_KEY` + `ASAAS_*` + `STRIPE_*` → as rotas montam e o débito liga. Só após EXT1.

### Seams deferidos no F-E (TODO markers explícitos no código, não silenciosos)
- **Veo/Higgsfield/Seedance débito:** só Kling é ciclo totalmente reconciliável em `handlers.ts` (submit jobId == download jobId + `actualUsd`). Os outros capturam em provider modules / webhook-router → wiring maior, deferido.
- **Veo cycle-cap (Task 6 Step 4):** funções puras prontas+testadas; integração (acopla handlers a PaymentsStore+Redis) deferida pra pós-EXT1.
- **`media_edit_image`/`media_compose_scene`:** geração de imagem ainda não cobrada (`estimateImageCost` não precifica limpo).
- **F1 sweep sem caller em produção (gap do credit-core):** `runSweep` está corrigido (EXT1) e testado mas NÃO é invocado por nenhum cron/endpoint no deploy. Consequência prática: o ciclo Kling reserva APÓS o submit e captura no download — se o user nunca faz poll/download (ou o processo morre entre reserve e capture), os créditos ficam **presos pra sempre** sem nada pra reivindicá-los (a rede de segurança de TTL da spec F1 não pega nada). Imagem é segura (`runWithDebit` síncrono sempre settla via try/catch). **Próximo gate credit-core:** wire `runSweep` num caller periódico (HTTP cron/intervalo) com `StatusProbe` + `reserveMeta` reais. EXT1 endureceu a função ANTES de ligá-la (pré-requisito correto), mas NÃO fechou uma cobrança-dupla ativa (o sweep não rodava).
- **Critério 3 (saldo insuficiente bloqueia) — parcial:** vale pra IMAGEM (reserve precede o exec → 402 bloqueia antes da chamada ao provider). NÃO vale pra Kling (reserve dispara DEPOIS do submit → o job já está enfileirado quando o 402 chega; o user fica corretamente sem cobrança, mas o host absorve aquele render). Inerente ao jobId-vindo-do-dispatch; nomear, não esconder.

## 💰 Gate de dinheiro (bloqueia go-live do F-E)

- **EXT1 — ✅ RESOLVIDO (2026-06-03, credit-core v0.1.1 deployado).** O sweep agora emite `cap-{reservationId}`/`rel-{reservationId}`, idêntico ao live (`cap-{jobId}`). Settle duplo (sweep + callback tardio) colide em `ON CONFLICT (kind, external_id)` → 1 débito só. Teste de integração de prova adicionado (sweep capture + late live capture → saldo inalterado). Imagem `ghcr.io/produtoramaxvision/credit-core:0.1.1` (arm64) publicada + serviço `credit-core_credit-core` atualizado na VPS (1/1, /health ok, healthcheck OPS1 corrigido junto). Re-tag permitido (freeze v0.2.0 é só media-forge).

## 🧩 Seams a fechar (a maioria no F-E)

- **SE1** — Observabilidade de margem usa créditos placeholder (`0`/`$0.01`) até o credit-core ser ligado ao fluxo de geração (F-E).
- **SE2** — Galeria grava só no `kling_download`; outros providers/webhooks não têm `tenantId` no contexto. Precisa propagar `galleryStore`+`tenantId` aos webhook handlers.
- **SE3** — Vídeo parcial: Kling exige `MEDIA_FORGE_KLING_WEBHOOK_INSECURE=true` (sem HMAC); Higgsfield nunca usa MinIO (stub sem buffer); Seedance sobe pro MinIO mas não há tool de poll que devolva a signed URL.
- **SE4** — `buildServer` cria o client Google eagerly → handshake 500 sem `GOOGLE_API_KEY`. Poderia ser lazy (handshake OK, tool falha só na chamada). Melhoria de UX, não bloqueia.

## 🛠️ Follow-ups de infra/ops

- **OPS1** — credit-core Dockerfile healthcheck já corrigido no repo (`127.0.0.1`) mas imagem não re-publicada (roda ok via dual-stack); entra no próximo tag do credit-core.
- **OPS2** — credit-core (ledger) ainda **sem serviço de backup**. F-I adicionou backup só ao stack do media-forge. Adicionar `postgres-backup-local` ao stack do credit-core.
- **OPS3** — Migrations do media-forge (`001`, `002`) aplicadas **manualmente** (sem runner no startup). credit-core tem `scripts/migrate.mjs` + boot-migration. Considerar runner automático no media-forge.
- **OPS4** — Actions Docker no CI usam Node 20 (deprecação jun/2026) — pinar/atualizar `docker/*-action`.
- **OPS5** — Worktree leftover (`.claude/worktrees/agent-a439…`) fisicamente no disco (gitignored, node_modules travado no Windows) — `git worktree prune` + remover dir.
- **OPS6** — F-G: confirmar que o loader tolera header `X-MaxVision-License` vazio (perfil B); smoke real de `claude plugin install` com a key; decidir hosting do marketplace (repo próprio vs atual).
- **OPS7** — Build **multi-arch** (amd64+arm64): a primeira tentativa via QEMU **travou >2h**. Refeito com o padrão oficial Docker — runners **nativos** por arch (amd64 em `ubuntu-latest`, arm64 em `ubuntu-24.04-arm`), push por digest + merge de manifest, `timeout-minutes:30`. Dependência: o runner hosted `ubuntu-24.04-arm` precisa estar habilitado no plano do org (privado). Se a fila do job arm64 travar, validar disponibilidade ou cair pra QEMU-com-timeout. Validado neste deploy: ver run da tag.

## 🌐 Gates externos de go-live comercial (seus/terceiros)

- **EXT-A** — Confirmar pricing Vertex AI / Veo ao vivo (precisão do COGS).
- **EXT-B** — Validar imposto (Simples ~6%) com contador.
- **EXT-C** — Construir a landing (F-H) no Claude Design (prompt pronto em `.maxvision/specs/`).
- **EXT-D** — Se distribuir via npm: confirmar schema do `marketplace.json` source npm.

## 🔑 F-F — deploy do Worker de licença (quando você decidir CF vs Keygen)

Código pronto e testado (`license-worker/` + `media-forge/src/license/*`). Hospedado já roda com a licença **desligada** (`LICENSE_CHECK_ENABLED=false`). O abaixo é só pra ativar o self-host C1 (agências):

| # | Gate | Comando/valor |
|---|---|---|
| LIC1 | Cloudflare Account ID | dash.cloudflare.com (canto sup. direito) |
| LIC2 | Wrangler API token | permissões `Workers Scripts:Edit` + `Workers KV Storage:Edit` |
| LIC3 | KV namespace | `wrangler kv:namespace create LICENSES` → por o ID em `license-worker/wrangler.toml` |
| LIC4 | Admin secret | `cd license-worker && wrangler secret put LICENSE_ADMIN_SECRET` |
| LIC5 | Deploy do Worker | `cd license-worker && pnpm deploy` → URL `https://media-forge-license.<acct>.workers.dev` |
| LIC6 | Emitir 1ª licença agência | `POST /admin/issue` com Bearer admin secret, body `{"tier":"agency"}` → `{licenseKey:"MFK-…"}` |
| LIC7 | Config da agência on-prem | `LICENSE_CHECK_ENABLED=true` + `MAXVISION_LICENSE_SERVER_URL=<worker>/validate` + `MEDIA_FORGE_LICENSE_KEY=MFK-…` + `MEDIA_FORGE_LICENSE_INSTANCE_ID=<id estável>` |

Alternativa Keygen: cliente é agnóstico — troca só o transporte em `src/license/client.ts`. (Decisão D2 do relicenciamento MIT→AGPL segue aberta acima.)
