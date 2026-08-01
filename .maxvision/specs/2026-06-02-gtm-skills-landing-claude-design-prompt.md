# Prompt Claude Design — Landing MaxVision GTM Skills

> Cole o bloco entre `=====` no Claude Design com o design system MaxVision (incl. `fx.js`, `chrome.js`, `site-base.css`, `site-chrome.css`) carregado. Conceito-assinatura travado: **GATILHO E DISPARO (evento → trigger → tag dispara → versão)**. Integração: `2026-06-02-suite-landings-integration-spec.md`. Licença/preço: free/open-source (BSD-3).

=====

# PAPEL E MANDATO

Você é diretor de arte premiado + engenheiro front-end sênior. Construa o **corpo de uma landing page de produto** (conteúdo de `<main>`) para o site da Produtora MaxVision, production-grade, em **português do Brasil**. Comprometa-se 100% com uma visão cinematográfica distinta; criatividade máxima em composição, movimento e **componentes inéditos** — sem quebrar o sistema visual da marca. Sistema imóvel, criatividade livre dentro dele.

**Não autora header, footer, menu, dropdown nem WhatsApp** — injetados pelo `chrome.js` nos slots `data-mv-*`. Entregue o esqueleto + `<main>` + CSS/JS próprios.

**NÃO COPIE minhas páginas nem as outras landings.** O conceito desta página é GATILHO E DISPARO — não use: forja (media-forge), grafo de rede social (LinkedIn), stream/radar (X), ritmo/BPM (TikTok), curva/timeline (YouTube), canvas de execução de nodes (n8n) nem fan-out de roteamento (Orchestrator). Reuse só o vocabulário visual da marca.

# O PRODUTO

**MaxVision GTM Skills** — skill expert de Google Tag Manager para o Claude Code. Encapsula a GTM API v2 como conhecimento executável: cria, atualiza, valida e publica tags, triggers, variáveis e containers; entende a hierarquia Account → Container → Workspace → Entidades; trata OAuth 2.0, rate limits (exponential backoff), fingerprints e resolução de conflito de workspace; cobre GA4 e server-side container. Não é um wrapper genérico — é expertise embutida (algoritmos validados, validação pré-execução, tratamento de erro 400/401/403/409/429/500).

**Ângulo central:** "GTM por conversa, com a engenharia certa por baixo." Automação de tag management com rigor de produção, dentro do Claude Code.

**Conceito criativo central — GATILHO E DISPARO.** Um evento entra; passa por um trigger (porta condicional); quando a condição bate, a tag **dispara** (um lampejo em brasa); a configuração é versionada (snapshot imutável). A página encena esse ciclo evento → trigger → disparo → versão como sua espinha. Proponha refinamento em 2 linhas se houver algo mais forte.

# PÚBLICO

Marketing technologists / tag managers, analytics engineers, plataforma/DevOps configurando server-side, consultores GTM automatizando auditorias/migrações, data engineers validando dataLayer. Todos usuários de Claude Code.

# SISTEMA VISUAL — HONRE EXATAMENTE (já carregado)

- Canvas **preto verdadeiro** em tudo. **`#A93636` é o ÚNICO acento** — o disparo da tag, CTA, foco, eyebrow, barra. **Zero segunda cor** (sem azul GTM/Google).
- **Bebas Neue** display (MAIÚSCULA + tracking ~0.02em) · **Inter** corpo · **JetBrains Mono** receipts (`GTM API v2 · OAUTH · GA4`). O mono encaixa no tema técnico (paths, type codes, JSON) — use com intenção, sem virar tudo-mono.
- **Barra diagonal** `skewX(-8deg)`, máx 2/tela. Grão + vinheta + scanline em blocos cinema.
- `text-wrap:balance` em h1/h2. Raio ≤ 20px. Hover card: `translateY(-2px)` + borda vermelha + glow. Avatar `maxvision-avatar-hero.png`, logo `maxvision-roda.png`.

# VOZ — RÍGIDA

pt-BR, frases curtas, presente. Sem emoji, sem exclamação, sem hype. Banidas: "incrível", "inovador", "revolucionário", "transformar", "supercharge", "seamless". MAIÚSCULAS só display/eyebrow. Receipts em mono. Tom: engenharia de tag management séria, validada — não "marketing fácil".

# ESQUELETO DE SAÍDA (obrigatório)

```html
<!DOCTYPE html>
<html lang="pt-BR" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MaxVision GTM Skills · Google Tag Manager no Claude Code · Produtora MaxVision</title>
  <meta name="description" content="Skill expert de Google Tag Manager para Claude Code: criar, validar e publicar tags, triggers e variáveis com OAuth, server-side e GA4." />
  <link rel="canonical" href="https://www.produtoramaxvision.com.br/gtm-skills" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="../colors_and_type.css" />
  <link rel="stylesheet" href="site-base.css" />
  <link rel="stylesheet" href="site-chrome.css" />
  <style> /* CSS da pagina */ </style>
  <script>window.MV_ASSETS='../assets/';window.MV_BASE='';</script>
  <!-- Schema.org: Organization + SoftwareApplication (GTM Skills) + BreadcrumbList -->
</head>
<body data-page="gtmskills" data-theme="dark" data-grain="on" data-motion="on" data-cursor="on" data-density="regular" data-accent="brand" data-mood="cinema">
  <div data-mv-header></div>
  <main id="main"><!-- SEU CONTEUDO --></main>
  <div data-mv-footer></div>
  <div data-mv-whatsapp></div>
  <div data-mv-tweaks-mount></div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
  <script src="fx.js"></script>
  <script src="chrome.js"></script>
  <script src="tweaks.js"></script>
  <script> /* JS da pagina (IIFE) */ </script>
</body>
</html>
```

# ESTRUTURA DO `<main>` (ordem; interior é seu — inove)

Cada `<section>` com `id` + `data-screen-label`.

1. **Hero** — headline Bebas pôster (clip-reveal) + sub + CTA "Instalar no Claude Code" (mostra o comando `/plugin install gtm-skills@maxvision-claude` em receipt mono) + CTA secundário GitHub. Atrás: o ciclo de disparo em brasa (ver Motion). Momento-assinatura.
2. **O disparo** — componente-assinatura: encena evento → trigger (porta condicional) → tag dispara (lampejo brasa) → snapshot versionado. Sem texto expositivo: o movimento conta.
3. **As 4 camadas** — Account → Container → Workspace → Entidades, mostradas como camadas com profundidade (não lista chata). Expertise hierárquica.
4. **O que a skill faz** — capacidades: criar/atualizar/deletar tags-triggers-variáveis, validação pré-execução, publicação versionada, OAuth + rate-limit backoff, server-side container, GA4. Composição inesperada.
5. **Engenharia embutida** — diferencial: não é wrapper genérico; mostra um receipt mono de validação/erro tratado (409 conflict, 429 backoff 1s→2s→4s) como prova de rigor.
6. **Instalar** — comando do marketplace em mono, passo a passo curto. Licença **BSD-3, open-source, gratuito**. Atribuição: derivado de Paolo Bietolini, packaging MaxVision.
7. **CTA final** — Bebas pôster + barra diagonal longa + receipt de fechamento + link GitHub.

# MOTION / INTERAÇÃO (integra, não duplica)

**Herde:** `[data-parallax="0.2"]`, `[data-magnetic]` no CTA, `.counter[data-to]`, `section[id]`+`data-screen-label`. Não reimplemente cursor/header/drone.

**Wow 3D/profundidade (o disparo) — aditivo e isolado:**
- **Three.js** (cdnjs, no shell) num **canvas isolado de fundo**: partículas-evento sobem/atravessam em **profundidade** e, ao cruzar um "trigger", emitem um lampejo/disparo em brasa que se propaga; sensação de pipeline de eventos com gates. **Preto + brasa `#A93636`** somente.
- GSAP ScrollTrigger **opcional** só para o pin/scrub do "ciclo de disparo". Depois do `fx.js`, seletores `.fx-*`, sem tocar `[data-parallax]`/`[data-reveal]`.
- **PROIBIDO Lenis** / segundo smooth-scroll.
- Canvas checa `body[data-motion="off"]` + `prefers-reduced-motion` → fallback estático. Limpa rAF no `pagehide`. Só `transform`/`opacity`; menos partículas no mobile.
- **Reveal (crítico para o preview):** `[data-reveal]` fica ESCONDIDO via `site-base.css` até o `fx.js` revelar — e o `fx.js` pode não rodar no preview do Claude Design (seções em branco). Implemente seu PRÓPRIO reveal inline (IntersectionObserver, conteúdo **visível por padrão**, JS só adiciona o fade). Use `[data-parallax]`/`[data-magnetic]`/`.counter` como enriquecimento; **NÃO** use `[data-reveal]` em conteúdo crítico. Conteúdo sempre visível por padrão sem fx.js.

# INOVAÇÃO DE COMPONENTES (≥2 inéditos, on-brand)

(a) o **ciclo de disparo evento→trigger→tag→versão** animado/reativo ao scroll; (b) um **receipt de validação/erro ao vivo** (mostra backoff e conflict resolution como instrumento técnico). Pode propor um terceiro (ex: as 4 camadas com profundidade interativa). Supere as direções.

# RESTRIÇÕES TÉCNICAS

- HTML completo com o shell; `<style>`/`<script>` inline; sem build/backend/`fetch`/`localStorage`.
- Libs só de `cdnjs.cloudflare.com` (Three.js r128 incluso). **Nunca Lenis.** (Integração: `integrity`/`crossorigin`.)
- Trechos de JSON/comando: texto real plausível (GA4 tag, trigger) em bloco mono; sem expor segredos/tokens.
- Responsivo mobile-first, sem overflow.

# ACESSIBILIDADE

Semântico, `:focus-visible` ring vermelho, contraste ≥ AA, `prefers-reduced-motion`, alvos ≥ 44px, `aria-*` em componentes interativos e counters. Canvas decorativo `aria-hidden="true"`.

# PROIBIÇÕES ABSOLUTAS (anti-slop)

Sem Inter/Roboto/system como display. Sem gradiente arco-íris/pastel/roxo. Sem texto em gradiente. Sem glassmorphism default. Sem cantos >20px. Sem grade de cards idênticos. Sem eyebrow tracked em toda seção. Sem `01/02/03` clichê. Sem tudo-centralizado. Sem emoji/hype. Sem logo SVG. Sem barra sem skew -8deg. **Sem azul Google/GTM nem segunda cor.** **Sem header/footer/dropdown próprios.** **Sem Lenis.** **Sem copiar minhas páginas ou as outras landings.**

# AUTO-TESTE ANTES DE ENTREGAR

1. Anti-slop. 2. Não-cópia: conceito é gatilho/disparo, não forja/grafo/stream/ritmo/timeline/canvas-n8n/fan-out. 3. Tokens: acento só `#A93636`. 4. Voz sem emoji/hype. 5. ≥2 componentes inéditos. 6. Sem chrome próprio. 7. Motion: Three.js isolado, sem Lenis, honra `data-motion=off`+reduced-motion com fallback, só transform/opacity. 8. Esqueleto exato.

Antes de construir, proponha em 3–4 linhas: direção estética, momento-assinatura, os 2+ componentes inéditos e a técnica-herói. Depois construa a página completa.

=====

## Notas de uso (fora do prompt)
- CTA primário = instalar via marketplace + GitHub (não WhatsApp). Free/BSD-3.
- Dropdown Downloads: global no `chrome.js` (adicionar item `gtm-skills` → `GtmSkills.html`).
- Integração: `2026-06-02-suite-landings-integration-spec.md`.
