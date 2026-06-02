# Pendências — media-forge infoproduto (vivo)

> Acumulado durante a implementação. Revisar ao final. Atualizado conforme as fases avançam.

## 🔴 Ações suas — segurança/config (destravam o produto)

| # | Item | Por quê |
|---|---|---|
| S1 | **Rotacionar a senha admin do Portainer** | Vazou em texto plano no chat desta sessão. |
| S2 | Preencher `GOOGLE_API_KEY` no Portainer (stack 69) | Sem ela o handshake MCP autentica mas retorna 500 (`buildServer`→ConfigError). Com ela, a forja gera. Opcionais: `ANTHROPIC_API_KEY` (review), `FAL_KEY`/`HF_*`/`BYTEPLUS_ARK_API_KEY` (vídeo), `MEDIA_FORGE_OCR_GOOGLE_VISION_KEY` (OCR). |
| S3 | Guardar a key creator `mfk_0e49…` com segurança | Primeira API key do produto (tier creator). Revogável/reemitível, não recuperável. |

## ⚖️ Decisões que preciso de você

| # | Decisão | Contexto |
|---|---|---|
| D1 | **F-F licença: Cloudflare Worker (recomendado) vs Keygen** | Cliente de licença é agnóstico → escrevo o código já; o deploy do Worker precisa das creds CF (Account ID, Wrangler token, KV). |
| D2 | **Relicenciar o core MIT → AGPL-3.0?** | Spec §5 pede AGPL+EULA; o core hoje é MIT. O EULA do F-F cobre só a licença comercial self-host, NÃO relicencia o core sozinho. Decisão do dono. |
| D3 | **F-E pagamentos: chaves Asaas (Pix) + Stripe (sandbox)** + criar produtos/planos (R$37,90/mês + packs R$19,90/49,90/99,90) | Sem isso o F-E não começa o deploy. Há `asaas-mcp`/`stripe-mcp` conectados — confirmar se já têm acesso. |

## 💰 Gate de dinheiro (bloqueia go-live do F-E)

- **EXT1 — Unificar `external_id` de capture.** O sweep do credit-core usa `sweep-cap-{suffix}`; o F-E proporá `cap-{jobId}`. IDs diferentes pra mesma reserva ⇒ idempotência não dedup ⇒ **cobrança em dobro**. Fix: `cap-{reservationId}`/`rel-{reservationId}` nos DOIS. Exige re-tag do credit-core (hoje v0.1.0 com `sweep-cap-`).

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

## 🌐 Gates externos de go-live comercial (seus/terceiros)

- **EXT-A** — Confirmar pricing Vertex AI / Veo ao vivo (precisão do COGS).
- **EXT-B** — Validar imposto (Simples ~6%) com contador.
- **EXT-C** — Construir a landing (F-H) no Claude Design (prompt pronto em `.maxvision/specs/`).
- **EXT-D** — Se distribuir via npm: confirmar schema do `marketplace.json` source npm.

---
_(F-F adicionará seus próprios gates de deploy ao final desta seção.)_
