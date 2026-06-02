# media-forge → Infoproduto — Design Spec

**Data:** 2026-06-01 · **Status:** aprovado (brainstorming) · **Branch:** homolog
**Autor:** Produtora MaxVision

> Documento de design (spec). Próximo passo após aprovação do usuário: `writing-plans` para o plano de implementação por fases. Não é código.

## 1. Objetivo

Transformar o `media-forge` (plugin Claude Code + MCP server de geração de imagem/vídeo com IA) no 4º produto comercial da suíte MaxVision (depois de linkedin/x/tiktok), seguindo o mesmo padrão **plugin fino + MCP hospedado + API key + license**, com a peça nova exigida pelo custo alto de vídeo: **créditos pré-pagos path-priced**. Rentável por construção, seguro, e distribuído pelo marketplace próprio.

## 2. Modelo de distribuição (híbrido)

| Caminho | Público | Como roda | Chave de IA | Monetização |
|---|---|---|---|---|
| **B — Hospedado + créditos** (primário) | criadores BR não-técnicos | plugin fino → MCP hospedado seu | **suas** (no server) | assinatura BRL + créditos pré-pagos |
| **C1 — Self-hosted licenciado** (secundário) | agências/devs técnicos | imagem Docker na infra deles | **deles** | licença (Keygen/Worker) |

- **Distribuição:** marketplace próprio (`marketplace.json` em GitHub/URL). Anthropic não proíbe backend pago nem cobra — você fatura fora dela. Inclusão nos marketplaces oficiais/comunidade é opcional, não necessária. ([code.claude.com/docs/en/discover-plugins])
- **Plugin fino:** só `commands`/`skills`/`agents`/`hooks` + `plugin.json` com `mcpServers` `type:http`. Mesmo shape dos plugins maxvision-{linkedin,x,tiktok} já em produção:
```jsonc
{
  "mcpServers": {
    "media-forge": {
      "type": "http",
      "url": "${MEDIA_FORGE_URL:-https://media-forge.produtoramaxvision.com.br/mcp}",
      "headers": {
        "Authorization": "Bearer ${MEDIA_FORGE_API_KEY}",
        "X-MaxVision-License": "${MEDIA_FORGE_LICENSE}"
      }
    }
  }
}
```

## 3. Arquitetura técnica

Não é rewrite — o `buildServer(opts)` já é injetável, e `webhook-router` + `MINIO_*` + `cost-tracker` já existem.

### 3.1 stdio → Streamable HTTP
- Novo entrypoint `startHttpServer()` paralelo ao `startStdioServer()`, usando **Hono + `@hono/node-server` + `WebStandardStreamableHTTPServerTransport`** (SDK `@modelcontextprotocol/sdk` 1.29; **pinar `^1.29.0`**, hoje está `^1.0.4`).
- **Stateless** (`sessionIdGenerator: undefined`, `enableJsonResponse: true`); **McpServer fresco por request** → escala horizontal trivial, isolamento de tenant limpo.
- Endpoints: `POST /mcp` (auth), `GET /health` (liveness, leve), `GET /metrics` (Prometheus).
- Validar `Origin` (anti DNS-rebinding); CORS restrito (M2M não precisa CORS permissivo).

### 3.2 Jobs assíncronos (obrigatório)
Claude Code tem timeout duro por tool (≥60s first-byte, progress não estende). Vídeo leva minutos → **qualquer tool >~30s retorna `job_id` na hora**, completa via webhook, cliente faz poll num `*_status` tool. Promover o `webhook-router` de side-channel localhost para **endpoint hospedado de primeira classe** (mantendo a verificação HMAC/Ed25519 que já existe).

### 3.3 Entrega de mídia
Resultado servido por **URL assinada MinIO/S3 com expiração**, nunca proxiar bytes pela VPS (egress Oracle). Já há suporte `MINIO_*` no `.mcp.json`.

### 3.4 Uma base, dois modos
- `MEDIA_FORGE_MODE = hosted | self`.
- **hosted:** middleware Hono resolve `{tenantId, tier, scopes, saldo}` pela API key ANTES do `buildServer()`; injeta no contexto das tools.
- **self:** tenant implícito (operador); lê `tier` de um JWT de licença assinado (`MEDIA_FORGE_LICENSE`).
- `registerAllTools` registra tools pagas condicionalmente pelo `ctx.tier` (mesma função gateia os dois modos). Transport idêntico nos dois.
- Self-host também **exige API key** por default (spec recomenda nunca rodar aberto).

### 3.5 ffmpeg / native deps (já resolvido na Fase 1)
O resolver de ffmpeg do sistema (Fase 1, já commitada) encaixa: no Docker, `COPY --from=mwader/static-ffmpeg`; sharp prebuilt arm64. Build nativo na própria VPS ARM64 (sem QEMU).

## 4. Billing & créditos (o núcleo da rentabilidade)

### 4.1 Mecanismo: crédito path-priced (anti-prejuízo por construção)
**Nunca taxa de crédito única mesclada.** Cada geração desconta:
```
créditos = teto( custo_real_USD × markup ÷ valor_do_crédito_do_saldo )
```
O markup está embutido em cada débito → margem garantida em qualquer caminho (imagem barata ou Veo caro). O `cost-tracker.ts`/`cost.ts` já é o medidor de `custo_real`.

### 4.2 Ledger reserve → capture → release (anti bill-shock)
Com Veo até $74/chamada, requests concorrentes não podem correr contra saldo esgotado:
1. **Reserve** (estimativa do custo máximo) em transação atômica com **lock pessimista** ANTES de despachar pro Google/fal.
2. **Capture** o custo real na conclusão; **Release** o excedente se o job falhar (falha **não** debita o usuário; buffer cobre).
3. Ledger double-entry, **idempotência** por external id, trilha de auditoria.

> Stripe **não** bloqueia em tempo real (aplica crédito só na fatura) — **o gate de saldo é seu**, no seu banco. Stripe/Asaas só faturam.

### 4.3 Números travados (decisão do usuário, 2026-06-01)
- **1 crédito = $0,01 de custo-base.** Markup **4x vídeo / 10x imagem**. Câmbio com buffer **R$5,55/USD**.

| Geração | COGS | Desconta | Receita-crédito |
|---|---|---|---|
| 1 imagem | $0,02 | 20 cr | $0,20 |
| Kling 5s | $0,63 | ~250 cr | $2,52 |
| Veo 8s | $4,00 | ~1.600 cr | $16,00 |

- **Plano base "Criador" — R$37,90/mês**: ~2.500 créditos inclusos + acesso + **cap rígido de Veo por ciclo** (0–1 incluso).
- **Packs avulsos (Pix one-time):** R$19,90 (1.500 cr) · R$49,90 (4.200 cr) · R$99,90 (9.000 cr).
- **Free tier:** micro-refill diário (~50–100 cr/dia), watermark, sem uso comercial, **só caminho imagem**.

### 4.4 As 3 regras de ouro (margem)
1. **Crédito grátis/promocional só gera imagem, nunca Veo** (senão 1 cadastro = −$74).
2. **Cap de Veo no plano base + nos packs** (Veo só por débito recalculado em tempo real).
3. **O débito de Veo usa o valor-de-crédito do SALDO gasto** (pack descontado recalcula: ex. no pack Grande o crédito vale ~$0,00196 → Veo 8s debita ~8.164 cr, não 1.600). Roda a **checagem de segurança** em todo pack antes de publicar: `$/crédito_do_pack × créditos_Veo ≥ COGS_Veo × (1+margem) + fee`.

### 4.5 UX anti-abuso
**Quote-before-run:** mostrar débito em créditos ANTES de confirmar ("Este Veo 8s = 1.600 créditos"). Transparência + trava acidental do caminho caro.

### 4.6 Rails de pagamento
| Job | Rail | Taxa |
|---|---|---|
| Assinatura recorrente + packs (BR) | **Asaas** (Pix recorrente, regulado BACEN; `asaas-mcp` disponível) | ~R$1,99 fixo |
| Internacional / C1 / cartão | **Stripe** | 2,99%+ |
| Funil one-time / afiliados | Hotmart/Kiwify | 9–10% |

Asaas Pix preserva ~6 pontos de margem vs Hotmart. **Margem líquida realista (mix imagem-pesado): ~64–70%.**

### 4.7 Hardening + expansões (CEO review 2026-06-02, SELECTIVE EXPANSION)

**F1 — Reconciliação de reserva presa (CRÍTICO):** o webhook do provedor pode nunca chegar (job despachado, créditos reservados, sem callback). Sem tratamento, a reserva trava pra sempre.
- Cada reserva carrega um **TTL** (ex: 2× o tempo máximo esperado do job).
- **Sweep de reconciliação** periódico (cron interno): para cada reserva vencida, consulta o status do job no provedor (Veo/fal/Kling) → se concluído, faz `capture`; se falhou/inexistente, faz `release` (devolve créditos). Loga cada decisão (audit).
- Estado do job persiste em Postgres; o sweep é idempotente.

**F2 — Idempotência + autenticidade do capture (CRÍTICO):** o webhook que dispara `capture`/`release` precisa de (a) verificação de assinatura (HMAC/Ed25519 — `webhook-router` já tem) E (b) **idempotência por `provider_job_id` + `event_id`**: um replay do mesmo evento é recusado (linha duplicada no ledger rejeitada), nunca dobra capture nem refund.

**F5 — Observabilidade de margem (must-have antes de cobrar):** dashboard/alerta operacional de **custo e margem por tenant e por caminho**. Alerta quando: COGS de um tenant dispara, margem de um caminho fica negativa, ou um tenant aproxima do hard cap. Métricas via `/metrics` Prometheus + alerta (email/Telegram). Sem isso você revende compute caro às cegas.

**Credit-core = SERVIÇO compartilhado (eng review A3):** o ledger é um **serviço de crédito standalone** (`credit-core`, próprio DB Postgres + API HTTP/interna), NÃO uma lib embutida. media-forge/linkedin/x/tiktok chamam o serviço por rede (`reserve`/`capture`/`release`/`balance`/`grant`) → **carteira única real por cliente**, gasta cross-produto desde o início. É a "moeda MaxVision" da suíte. Custo: +1 serviço a operar; retorno: carteira unificada de verdade, sem refactor.

**Modelo de concorrência = tabela de reservas append-only (eng review A1):** o saldo NÃO é uma linha mutável travada. Cada movimento (grant/reserve/capture/release) é uma **linha imutável** numa tabela append-only; `saldo = soma das linhas` (query indexada por tenant). Reservas paralelas do mesmo tenant não brigam por uma linha quente — escala + auditável. Reserva = linha com `status=reserved` + TTL; capture/release = nova linha referenciando a reserva. Idempotência por `external_id` único (replay rejeitado por constraint). Guard de saldo: `SELECT sum(...) ... WHERE balance >= custo` numa transação serializável OU advisory lock por-tenant de granularidade fina (não global).

**Redis desde já (eng review A2):** rate-limit, quota, idempotência e concorrência cross-instância usam Redis desde o início (pronto pra 2+ réplicas). Operado na mesma VPS inicialmente; isolável depois.

**Test mandate do ledger (eng review — money-correctness):** suite obrigatória cobrindo: (a) **concorrência** — N reservas em corrida na mesma carteira não permitem saldo negativo (teste de race com transações paralelas); (b) **idempotência** — webhook/evento replayado não dobra capture nem refund; (c) **reconciliação** — reserva vencida sem callback é capturada/liberada corretamente; (d) **margem (property test)** — para qualquer caminho/pack, `débito × valor_crédito ≥ COGS × (1+markup)`. Sem essa suite, o caminho de dinheiro não vai pra produção.

**Galeria persistente de gerações (expansão + corrige resultado-órfão):** toda geração concluída é persistida (metadado em Postgres + asset em MinIO/S3) e exposta por uma tool `list_my_generations` / galeria hospedada. Se o cliente fecha o Claude Code no meio do job, o resultado **não se perde** — fica na galeria. Resolve o órfão de resultado e vira gancho de retenção/showcase.

## 5. Licença C1 (self-hosted)
- Validate-by-key (Keygen ou Cloudflare Worker JWT): boot check + re-check periódico, **403 em revogação**, grace period offline.
- Core **AGPL-3.0** + **EULA comercial** (modelo n8n SUL / Sidekiq Pro): agência usa interno, não revende como serviço.

## 6. Segurança (antes de cobrar)
- API keys **hasheadas** em repouso (nunca plaintext); rotação sem downtime (`headersHelper` do Claude Code para tokens rotativos); revogação = deletar linha.
- **Nunca repassar o token do cliente pro upstream** (chaves Google/fal separadas no server) — regra MUST da spec MCP.
- Rate-limit por tenant (Redis token bucket), quota/concorrência por tenant, idempotência em tools caras.
- **Cost-gate server-side** antes de despachar (defesa real contra abuso via prompt-injection das tools caras).
- Audit hash-only (`tenantId`, tool, `job_id`, custo, outcome — nunca input cru/PII). Segredos em vault no hosted. Redação `****<últimos4>`.
- **Gating sempre server-side** — o plugin é não-confiável.

## 7. O que o media-forge já tem (encaixa)
`buildServer(opts)` injetável · `webhook-router` + handlers fal/Kling/Higgsfield · `MINIO_*` · `cost-tracker.ts`/`cost.ts`/`pricing.ts` (medidor de COGS) · `doctor` · resolver ffmpeg sistema (Fase 1). O design é **evolução, não rewrite**.

## 8. Roadmap por fases (alto nível — detalhe via writing-plans)
1. **F-A — HTTP server:** `startHttpServer()` Hono stateless + auth middleware + /health + /mcp; pinar SDK 1.29. (Self-host já utilizável com 1 API key.)
2. **F-B — Async + storage:** promover webhook-router a endpoint hospedado; URLs assinadas MinIO/S3 nas tool results.
3. **F-C — Tenancy + tiers:** API keys hasheadas, resolução de tenant/tier, gating de tools, rate-limit Redis.
4. **F-D — Serviço `credit-core`:** serviço standalone (Postgres próprio + API), append-only (reserve/capture/release/balance/grant), débito path-priced, quote-before-run, regras de ouro, idempotência por external_id, Redis. **F1**: TTL de reserva + sweep de reconciliação. **F2**: capture idempotente + assinatura verificada. **Test mandate**: suite concorrência + idempotência + reconciliação + margem (property).

**Estratégia de implementação (eng review):** apesar do build completo (A), implementar **estagiado** — cada fase F-A→F-I independentemente shippável e testável (strangler-fig, não big-bang). Lanes paraleláveis: **Lane 1** F-A/F-B/F-C (server HTTP + async + tenancy, mesmo módulo `src/mcp` + `src/http`) sequencial; **Lane 2** `credit-core` (serviço separado, repo/módulo próprio) em paralelo; **Lane 3** F-H landing (entregável separado, já pronto) independente. F-E (pagamentos) depende de credit-core; F-G (marketplace) depende de F-A.
5. **F-E — Pagamentos:** Asaas (assinatura+packs Pix) + Stripe (intl/C1); webhooks de reconciliação.
6. **F-F — Licença C1:** Worker/Keygen + gating self-host + imagem Docker (multi-arch) + EULA.
7. **F-G — Marketplace + plugin fino:** publicar plugin no marketplace próprio; onboarding (chave→env→install).
8. **F-H — Landing:** (entregável separado — ver prompt do Claude Design).
9. **F-I — Galeria + ops (CEO review):** galeria persistente de gerações (`list_my_generations`); **backup automático Postgres** (pg_dump cron → MinIO/S3) + runbook de recovery; **observabilidade de margem (F5)** — dashboard/alerta de custo/margem por tenant e caminho.

Fase 1 (ffmpeg LGPL) já commitada; Fases 2/3 do plano local anterior ficam **obsoletas** no modelo hospedado (CLAUDE_PLUGIN_DATA/npm/sharp-na-máquina-do-user só serviam ao stdio local).

## 9. Riscos / open items
- Confirmar pricing Vertex AI / Gemini ao vivo antes do go-live (COGS de agregador para alguns modelos).
- Confirmar schema npm-source / nome do pacote do plugin no marketplace.
- Validar tributação (Simples ~6% Anexo III) com contábil — abate da margem.
- Confirmar preços BRL Asaas/concorrentes de IP brasileiro.
- Auth: API key estática Bearer é **alternativa permitida** (não o modelo OAuth 2.1 da spec) — documentar honestamente; OAuth/RFC9728 opcional depois.

## 10. Fontes-chave
MCP/Claude Code: code.claude.com/docs/en/{mcp,discover-plugins} · modelcontextprotocol.io/specification/2025-11-25/{transports,authorization,security_best_practices} · SDK 1.29 (`WebStandardStreamableHTTPServerTransport`). Billing: docs.stripe.com/billing/.../billing-credits · asaas.com/precos-e-taxas. COGS: ai.google.dev/gemini-api/docs/pricing (Veo 3.1 $0,40/s, Imagen 4 $0,02–0,06, Nano Banana $0,039/Pro $0,134) · fal.ai (Kling/Seedance). Licença: keygen.sh/docs · n8n SUL. Margem: metronome.com (path-priced credits, PostHog markup).

## MAXVISION ORCHESTRATION REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | issues_resolved | SELECTIVE EXPANSION; build completo (A); 2 expansões (galeria, credit-core) + 2 fixes críticos (F1 reserva presa, F4 backup); F2/F5 folded |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_resolved | 3 decisões de arquitetura (A3 credit-core=serviço, A1 ledger append-only, A2 Redis já); test mandate do ledger; staging de implementação |
| Codex/Outside Voice | `/codex review` | Independent 2nd opinion | 0 | skipped | offered, deferido |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | n/a | landing é entregável separado (prompt Claude Design pronto) |

- **UNRESOLVED:** 0 — todas as decisões respondidas (sequenciamento A, SELECTIVE EXPANSION, F1, F4, galeria, credit-core; A3 serviço, A1 append-only, A2 Redis).
- **CRITICAL GAPS:** 0 abertos — F1 (reserva presa) → reconciliação; F2 (capture) → idempotente+assinado; F4 (SPOF) → backup Postgres; test mandate do ledger trava correção de dinheiro.
- **VERDICT:** CEO + ENG CLEARED — spec pronta pra implementar. Gates manuais antes do go-live: confirmar pricing Vertex AI ao vivo; validar tributação (Simples ~6%) com contábil; confirmar schema npm-source do marketplace.
