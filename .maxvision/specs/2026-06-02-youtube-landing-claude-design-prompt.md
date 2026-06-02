# Prompt Claude Design — Landing MaxVision YouTube

> Cole o bloco entre `=====` no Claude Design com o design system MaxVision (incl. `fx.js`, `chrome.js`, `site-base.css`, `site-chrome.css`) carregado. Conceito-assinatura travado: **CURVA DE RETENÇÃO / TIMELINE-SCRUB**. Integração: `2026-06-02-suite-landings-integration-spec.md`. Preço: EDITÁVEL.

=====

# PAPEL E MANDATO

Você é diretor de arte premiado + engenheiro front-end sênior. Construa o **corpo de uma landing page de produto** (conteúdo de `<main>`) para o site da Produtora MaxVision, production-grade, em **português do Brasil**. Comprometa-se 100% com uma visão cinematográfica distinta; criatividade máxima em composição, movimento e **componentes inéditos** — sem quebrar o sistema visual da marca. Sistema imóvel, criatividade livre dentro dele.

**Não autora header, footer, menu, dropdown nem WhatsApp** — injetados pelo `chrome.js` nos slots `data-mv-*`. Entregue o esqueleto + `<main>` + CSS/JS próprios.

**NÃO COPIE minhas páginas nem as outras landings.** O conceito desta página é CURVA DE RETENÇÃO / TIMELINE-SCRUB — não use a forja (media-forge), o grafo (LinkedIn), o stream/radar (X) nem o ritmo/BPM (TikTok). Reuse só o vocabulário visual da marca.

# O PRODUTO

**MaxVision YouTube** — suíte de inteligência para YouTube nativa do Claude Code, **API-first** (YouTube Data v3 oficial, sem scraping) somada a **Transcript Intelligence** (o Claude indexa transcrições para busca semântica, repurposing e previsão de retenção). Faz analytics de canal, sugestão de metadados (título/descrição/tags), análise de thumbnail (visão), demografia de audiência, comparação de períodos (YoY/MoM), tracking de palavra-chave, busca de concorrentes, relatório cross-channel (agência) e setup de teste A/B. Substitui TubeBuddy + VidIQ + planilha. Pagamento BR nativo (PIX/R$, nota fiscal).

**Ângulo central:** "A curva de retenção conta a história. Você lê e age." Decisão baseada em dado oficial + transcrição inteligente, não achismo de dashboard cru.

**Conceito criativo central — A CURVA E A LINHA DO TEMPO.** Uma linha do tempo de vídeo que se "scrubba": ao arrastar/rolar, ela revela a curva de retenção (onde a audiência fica e onde cai), CTR e a transcrição com timestamps buscáveis. A curva é uma crista em brasa sobre preto. Proponha refinamento em 2 linhas se houver algo mais forte.

# PÚBLICO

Criador solo (analytics + transcript + metadados), criador multi-canal, agências/MCNs (cross-channel, reconciliação), especialista de SEO (keyword + audiência).

# SISTEMA VISUAL — HONRE EXATAMENTE (já carregado)

- Canvas **preto verdadeiro** em tudo. **`#A93636` é o ÚNICO acento** — a curva de retenção, CTA, foco, eyebrow, barra. **PROIBIDO o vermelho-puro do YouTube (`#ff0000`)** — use SEMPRE o vermelho da marca `#A93636`. Zero segunda cor.
- **Bebas Neue** display (MAIÚSCULA + tracking ~0.02em) · **Inter** corpo · **JetBrains Mono** receipts (`API-FIRST · TRANSCRIPT · YoY`).
- **Barra diagonal** `skewX(-8deg)`, máx 2/tela. Grão + vinheta + scanline em blocos cinema.
- `text-wrap:balance` em h1/h2. Raio ≤ 20px. Hover card: `translateY(-2px)` + borda vermelha + glow. Avatar `maxvision-avatar-hero.png`, logo `maxvision-roda.png`.

# VOZ — RÍGIDA

pt-BR, frases curtas, presente. Sem emoji, sem exclamação, sem hype. Banidas: "incrível", "inovador", "revolucionário", "transformar", "supercharge", "seamless". MAIÚSCULAS só display/eyebrow. Receipts em mono. Tom: instrumento de leitura de dados sério, decisão proposta, não "bombar no algoritmo".

# ESQUELETO DE SAÍDA (obrigatório)

```html
<!DOCTYPE html>
<html lang="pt-BR" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MaxVision YouTube · Analytics e transcript intelligence no Claude Code · Produtora MaxVision</title>
  <meta name="description" content="Analytics API-first, transcript intelligence, sugestão de metadados, análise de thumbnail e relatório cross-channel — nativo do Claude Code." />
  <link rel="canonical" href="https://www.produtoramaxvision.com.br/youtube" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="../colors_and_type.css" />
  <link rel="stylesheet" href="site-base.css" />
  <link rel="stylesheet" href="site-chrome.css" />
  <style> /* CSS da pagina */ </style>
  <script>window.MV_ASSETS='../assets/';window.MV_BASE='';</script>
  <!-- Schema.org: Organization + Product/SoftwareApplication + BreadcrumbList -->
</head>
<body data-page="youtube" data-theme="dark" data-grain="on" data-motion="on" data-cursor="on" data-density="regular" data-accent="brand" data-mood="cinema">
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

1. **Hero** — headline Bebas pôster (clip-reveal) + sub + CTA "Conectar ao Claude Code" + receipt mono. Atrás: a curva de retenção se desenha em brasa sobre uma malha de timeline em profundidade (ver Motion). Momento-assinatura.
2. **A linha do tempo que se lê** — componente-assinatura: uma timeline de vídeo scrubável; ao arrastar/rolar, revela a curva de retenção (picos e quedas), CTR e marcadores. Mostra o analytics sem dashboard cru.
3. **Transcript inteligente** — segundo componente: a transcrição com timestamps buscáveis; busca semântica acende o trecho; repurposing (vira thread/blog) sugerido. Mostra a Transcript Intelligence.
4. **API-first, dado oficial** — bloco que explica: dado vem da API oficial (não scraping), com estratégia de quota; sugestão de metadados e análise de thumbnail por visão.
5. **O que ela faz** — capacidades: analytics de canal, metadados, thumbnail (visão), demografia, comparação YoY/MoM, keyword tracking, concorrentes, cross-channel (agência), teste A/B. Composição inesperada.
6. **Para quem é** — criador solo, multi-canal, agência/MCN, SEO.
7. **Preços** — Free / Pro / Agência / Enterprise. (EDITÁVEL — referência: Pro US$19 (R$99)/mês, Agência US$79 (R$399)/mês, Enterprise sob consulta; PIX/NF BR; confirme antes de publicar.) Canais + quota em 1 frase honesta.
8. **CTA final** — Bebas pôster + barra diagonal longa + receipt de fechamento.

# MOTION / INTERAÇÃO (integra, não duplica)

**Herde:** `[data-reveal]`, `[data-parallax="0.2"]`, `[data-magnetic]`, `.counter[data-to]`, `section[id]`+`data-screen-label`. Não reimplemente cursor/header/drone.

**Wow 3D/profundidade (a curva) — aditivo e isolado:**
- **Three.js** (cdnjs, no shell) num **canvas isolado de fundo**: uma malha/grade de linha do tempo em **profundidade** (camadas z, leve perspectiva) com a **curva de retenção como uma crista 3D em brasa** que se desenha conforme o scroll; vales/picos com leve glow. **Preto + brasa `#A93636`** somente — **nunca `#ff0000`**.
- GSAP ScrollTrigger **recomendado aqui** para o scrub da timeline (pin + scrub liga o scroll ao desenho da curva). Carregue **depois** do `fx.js`, seletores `.fx-*`, **sem tocar** `[data-parallax]`/`[data-reveal]`.
- **PROIBIDO Lenis** / segundo smooth-scroll (o scrub usa scroll nativo + ScrollTrigger).
- Canvas/scrub checam `body[data-motion="off"]` + `prefers-reduced-motion` → fallback estático (curva desenhada parada). Limpa rAF/ScrollTrigger no `pagehide`. Só `transform`/`opacity`; simplifica a malha no mobile. Conteúdo crítico visível por padrão sem fx.js.

# INOVAÇÃO DE COMPONENTES (≥2 inéditos, on-brand)

(a) a **timeline scrubável com curva de retenção 3D** ligada ao scroll; (b) o **transcript inteligente** com busca semântica e timestamps acendendo. Pode propor um terceiro (ex: comparador YoY de duas curvas sobrepostas). Supere as direções.

# RESTRIÇÕES TÉCNICAS

- HTML completo com o shell; `<style>`/`<script>` inline; sem build/backend/`fetch`/`localStorage`.
- Libs só de `cdnjs.cloudflare.com` (Three.js r128 incluso; GSAP/ScrollTrigger se usar). **Nunca Lenis.** (Integração: `integrity`/`crossorigin`.)
- Thumbs/curvas/transcrição: placeholders (dados fake plausíveis + cor sólida/gradiente brand + label), comentados pra trocar.
- Responsivo mobile-first, sem overflow. A timeline funciona com toque no mobile.

# ACESSIBILIDADE

Semântico, `:focus-visible` ring vermelho, contraste ≥ AA, `prefers-reduced-motion`, alvos ≥ 44px, `aria-*` na timeline/scrubber e counters; a timeline scrubável é operável por teclado (setas). Malha decorativa `aria-hidden="true"`.

# PROIBIÇÕES ABSOLUTAS (anti-slop)

Sem Inter/Roboto/system como display. Sem gradiente arco-íris/pastel/roxo. Sem texto em gradiente. Sem glassmorphism default. Sem cantos >20px. Sem grade de cards idênticos. Sem eyebrow tracked em toda seção. Sem `01/02/03` clichê. Sem tudo-centralizado. Sem emoji/hype. Sem logo SVG. Sem barra sem skew -8deg. **Sem vermelho-puro `#ff0000` nem segunda cor — só `#A93636`.** **Sem header/footer/dropdown próprios.** **Sem Lenis.** **Sem copiar minhas páginas ou as outras landings.**

# AUTO-TESTE ANTES DE ENTREGAR

1. Anti-slop. 2. Não-cópia: conceito é curva/timeline, não forja/grafo/stream/ritmo. 3. Tokens: acento só `#A93636`, nunca `#ff0000`. 4. Voz sem emoji/hype. 5. ≥2 componentes inéditos. 6. Sem chrome próprio. 7. Motion: Three.js isolado + ScrollTrigger escopado, sem Lenis, honra `data-motion=off`+reduced-motion com fallback, só transform/opacity. 8. Esqueleto exato.

Antes de construir, proponha em 3–4 linhas: direção estética, momento-assinatura, os 2+ componentes inéditos e a técnica-herói. Depois construa a página completa.

=====

## Notas de uso (fora do prompt)
- Preço: confirmar valores/moeda (R$/PIX) antes de publicar.
- Dropdown Downloads: global no `chrome.js`.
- Integração: `2026-06-02-suite-landings-integration-spec.md`.
