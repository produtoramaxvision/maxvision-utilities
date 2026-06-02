# Prompt Claude Design — Landing MaxVision X

> Cole o bloco entre `=====` no Claude Design com o design system MaxVision (incl. `fx.js`, `chrome.js`, `site-base.css`, `site-chrome.css`) carregado. Conceito-assinatura travado: **STREAM/RADAR DE SINAIS EM TEMPO REAL (leitura Grok ao vivo)**. Integração: `2026-06-02-suite-landings-integration-spec.md`. Preço: EDITÁVEL.

=====

# PAPEL E MANDATO

Você é diretor de arte premiado + engenheiro front-end sênior. Construa o **corpo de uma landing page de produto** (conteúdo de `<main>`) para o site da Produtora MaxVision, production-grade, em **português do Brasil**. Comprometa-se 100% com uma visão cinematográfica distinta; criatividade máxima em composição, movimento e **componentes inéditos** — sem quebrar o sistema visual da marca. Sistema imóvel, criatividade livre dentro dele.

**Não autora header, footer, menu, dropdown nem WhatsApp** — injetados pelo `chrome.js` nos slots `data-mv-*`. Entregue o esqueleto + `<main>` + CSS/JS próprios.

**NÃO COPIE minhas páginas nem as outras landings da suíte.** O conceito desta página é STREAM/RADAR EM TEMPO REAL — não use a forja (media-forge), o grafo de rede (LinkedIn), o ritmo vertical (TikTok) nem a timeline de retenção (YouTube). Reuse só o vocabulário visual da marca.

# O PRODUTO

**MaxVision X** — o assistente de X (Twitter) nativo do Claude Code, arquitetura **Grok-first**. A leitura é nativa e ToS-safe via Grok da xAI (busca de posts, detalhes, perfis, busca de pessoas, feed de um handle e análise multidimensional de um handle: sentimento, tópicos, padrões de postagem, melhores horários) — **sem navegador, sem cookie para ler**. A escrita (publicar, DM, curtir, repostar) é fallback humanizado, **sempre com aprovação**. Custo transparente: cada consulta Grok tem preço explícito; orçamento por tier.

**Ângulo central:** "Lê tudo em tempo real (via Grok). Publica com inteligência (e aprovação)." Pesquisa + escuta + timing, não bot que dispara sozinho.

**Conceito criativo central — RADAR DE SINAIS.** Posts e sinais correm num stream vivo com profundidade; o Grok "varre" e destila (um sinal acende em brasa quando é relevante). O scroll é a varredura. Segundo momento: um **leitor de handle ao vivo** que mostra sentimento/tópicos/melhores horários se desenhando como um instrumento. Proponha refinamento em 2 linhas se houver algo mais forte.

# PÚBLICO

Dev/founder usando X como canal; ghostwriter (coleta contexto e escreve com Claude sem abrir o X); agência de social listening (monitora handles, digests, alertas); community manager (busca menções, analisa sentimento, agenda com aprovação).

# SISTEMA VISUAL — HONRE EXATAMENTE (já carregado)

- Canvas **preto verdadeiro** em tudo. **`#A93636` é o ÚNICO acento** — o pulso do sinal, CTA, foco, eyebrow, barra. **Zero segunda cor.**
- **Bebas Neue** display (MAIÚSCULA + tracking ~0.02em) · **Inter** corpo · **JetBrains Mono** receipts (`GROK · TOS-SAFE · APROVAÇÃO`). O mono combina muito com o tema de stream/terminal — explore, mas sem virar "tudo monoespaçado".
- **Barra diagonal** `skewX(-8deg)`, máx 2/tela. Grão + vinheta + scanline em blocos cinema/terminal.
- `text-wrap:balance` em h1/h2. Raio ≤ 20px. Hover card: `translateY(-2px)` + borda vermelha + glow. Avatar `maxvision-avatar-hero.png`, logo `maxvision-roda.png`.

# VOZ — RÍGIDA

pt-BR, frases curtas, presente. Sem emoji, sem exclamação, sem hype. Banidas: "incrível", "inovador", "revolucionário", "transformar", "supercharge", "seamless". MAIÚSCULAS só display/eyebrow. Receipts em mono. Tom: instrumento de leitura precisa, ToS-safe, transparente no custo.

# ESQUELETO DE SAÍDA (obrigatório)

```html
<!DOCTYPE html>
<html lang="pt-BR" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MaxVision X · Pesquisa Grok e publicação no Claude Code · Produtora MaxVision</title>
  <meta name="description" content="Leitura ToS-safe via Grok (busca, perfis, análise de handle) e publicação com aprovação — nativo do Claude Code." />
  <link rel="canonical" href="https://www.produtoramaxvision.com.br/x" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="../colors_and_type.css" />
  <link rel="stylesheet" href="site-base.css" />
  <link rel="stylesheet" href="site-chrome.css" />
  <style> /* CSS da pagina */ </style>
  <script>window.MV_ASSETS='../assets/';window.MV_BASE='';</script>
  <!-- Schema.org: Organization + Product/SoftwareApplication + BreadcrumbList -->
</head>
<body data-page="x" data-theme="dark" data-grain="on" data-motion="on" data-cursor="on" data-density="regular" data-accent="brand" data-mood="cinema">
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

1. **Hero** — headline Bebas pôster (clip-reveal) + sub + CTA "Conectar ao Claude Code" + receipt mono. Atrás: o stream/radar de sinais corre em profundidade (ver Motion). Momento-assinatura.
2. **A varredura** — componente-assinatura: o stream de posts/sinais corre; o Grok destila; um sinal relevante acende em brasa e "sobe" da corrente. Mostra busca + escuta sem texto expositivo.
3. **Leitor de handle ao vivo** — segundo componente: um instrumento que desenha, ao entrar na viewport, sentimento + tópicos + melhores horários de um handle (placeholders), como um painel de bordo cinematográfico.
4. **Grok-first, ToS-safe** — bloco que explica o diferencial: leitura nativa via Grok (sem navegador/cookie), escrita com aprovação. Custo transparente por consulta (receipts mono).
5. **O que ela faz** — capacidades: busca de posts, detalhes/threads, perfis, busca de pessoas, feed, análise de handle, publicação/DM/curtir/repostar com aprovação, tracking de engajamento. Composição inesperada.
6. **Para quem é** — dev/founder, ghostwriter, social listening, community manager.
7. **Preços** — Free (leitura via Grok, limite diário) / Pro / Agência. (EDITÁVEL — referência: Pro ~US$29/mês com orçamento Grok diário, Agência ~US$99/mês; confirme e localize R$.) Custo por consulta em 1 frase honesta ("você vê o custo da consulta Grok antes").
8. **CTA final** — Bebas pôster + barra diagonal longa + receipt de fechamento.

# MOTION / INTERAÇÃO (integra, não duplica)

**Herde:** `[data-reveal]`, `[data-parallax="0.2"]`, `[data-magnetic]`, `.counter[data-to]`, `section[id]`+`data-screen-label`. Não reimplemente cursor/header/drone.

**Wow 3D/profundidade (o stream) — aditivo e isolado:**
- **Three.js** (cdnjs, no shell) num **canvas isolado de fundo**: uma corrente de fragmentos/tokens monoespaçados (ou linhas/partículas) fluindo verticalmente em **várias camadas de profundidade** (z-depth), com leve névoa; o scroll altera a velocidade/densidade da varredura; um pulso em brasa percorre quando há "sinal". **Preto + brasa `#A93636`** somente.
- GSAP ScrollTrigger **opcional** só para pin/scrub do "leitor de handle". Depois do `fx.js`, seletores `.fx-*`, sem tocar `[data-parallax]`/`[data-reveal]`.
- **PROIBIDO Lenis** / segundo smooth-scroll.
- Canvas checa `body[data-motion="off"]` + `prefers-reduced-motion` → fallback estático (stream congelado/gradiente). Limpa rAF no `pagehide`. Só `transform`/`opacity`; menos partículas no mobile. Conteúdo crítico visível por padrão sem fx.js.

# INOVAÇÃO DE COMPONENTES (≥2 inéditos, on-brand)

(a) o **stream/radar 3D reativo ao scroll** com pulso de sinal; (b) o **leitor de handle ao vivo** (sentimento/tópicos/horários como instrumento). Pode propor um terceiro (ex: medidor de custo Grok em tempo real). Supere as direções.

# RESTRIÇÕES TÉCNICAS

- HTML completo com o shell; `<style>`/`<script>` inline; sem build/backend/`fetch`/`localStorage`.
- Libs só de `cdnjs.cloudflare.com` (Three.js r128 incluso). **Nunca Lenis.** (Integração: adicionar `integrity`/`crossorigin`.)
- Posts/avatares no stream: placeholders (texto/cor sólida/gradiente brand + label), comentados pra trocar.
- Responsivo mobile-first, sem overflow.

# ACESSIBILIDADE

Semântico, `:focus-visible` ring vermelho, contraste ≥ AA, `prefers-reduced-motion`, alvos ≥ 44px, `aria-*` no leitor de handle e counters. Stream decorativo `aria-hidden="true"`.

# PROIBIÇÕES ABSOLUTAS (anti-slop)

Sem Inter/Roboto/system como display. Sem gradiente arco-íris/pastel/roxo. Sem texto em gradiente. Sem glassmorphism default. Sem cantos >20px. Sem grade de cards idênticos. Sem eyebrow tracked em toda seção. Sem `01/02/03` clichê. Sem tudo-centralizado. Sem emoji/hype. Sem logo SVG. Sem barra sem skew -8deg. **Sem segunda cor de acento.** **Sem header/footer/dropdown próprios.** **Sem Lenis.** **Sem copiar minhas páginas ou as outras landings.** Cuidado: tema "terminal/stream" não vira tudo-monoespaçado nem matrix-clichê verde — é preto + brasa, cinema.

# AUTO-TESTE ANTES DE ENTREGAR

1. Anti-slop. 2. Não-cópia: conceito é stream/radar, não forja/grafo/ritmo/timeline. 3. Tokens: acento só `#A93636`. 4. Voz sem emoji/hype. 5. ≥2 componentes inéditos. 6. Sem chrome próprio. 7. Motion: Three.js isolado, sem Lenis, honra `data-motion=off`+reduced-motion com fallback, só transform/opacity. 8. Esqueleto exato.

Antes de construir, proponha em 3–4 linhas: direção estética, momento-assinatura, os 2+ componentes inéditos e a técnica-herói. Depois construa a página completa.

=====

## Notas de uso (fora do prompt)
- Preço: confirmar valores/moeda antes de publicar.
- Dropdown Downloads: global no `chrome.js`.
- Integração: `2026-06-02-suite-landings-integration-spec.md`.
