# Prompt Claude Design — Landing MaxVision n8n Skills

> Cole o bloco entre `=====` no Claude Design com o design system MaxVision (incl. `fx.js`, `chrome.js`, `site-base.css`, `site-chrome.css`) carregado. Conceito-assinatura travado: **CANVAS DE EXECUÇÃO (pulso viaja por nodes ligados)**. Integração: `2026-06-02-suite-landings-integration-spec.md`. Licença/preço: free/open-source (MIT).

=====

# PAPEL E MANDATO

Você é diretor de arte premiado + engenheiro front-end sênior. Construa o **corpo de uma landing page de produto** (conteúdo de `<main>`) para o site da Produtora MaxVision, production-grade, em **português do Brasil**. Comprometa-se 100% com uma visão cinematográfica distinta; criatividade máxima em composição, movimento e **componentes inéditos** — sem quebrar o sistema visual da marca. Sistema imóvel, criatividade livre dentro dele.

**Não autora header, footer, menu, dropdown nem WhatsApp** — injetados pelo `chrome.js` nos slots `data-mv-*`. Entregue o esqueleto + `<main>` + CSS/JS próprios.

**NÃO COPIE minhas páginas nem as outras landings.** O conceito é CANVAS DE EXECUÇÃO (fluxo direcional de nodes que executam). Diferencie do GRAFO DE REDE SOCIAL do LinkedIn (lá é constelação social simétrica; aqui é circuito direcional wired com estados de execução) e dos demais (forja, stream, ritmo, timeline, gatilho/disparo do GTM, fan-out do Orchestrator). Reuse só o vocabulário visual da marca.

# O PRODUTO

**MaxVision n8n Skills** — 7 skills expert para construir workflows n8n impecáveis dentro do Claude Code. Ativam automaticamente por contexto (sem invocação manual). Cobrem: JavaScript e Python em Code nodes (data access `$input`/`$json`/`$node`, DateTime, error handling, SplitInBatches, pairedItem), sintaxe de expressões `{{ }}`, configuração de nodes, 6 padrões arquiteturais comprovados (webhook, HTTP API, database, AI agent, batch, scheduled), validação iterativa (catálogo de erros, false positives) e uso do n8n-mcp. Cobre produção: queue mode, self-host, scaling.

**Ângulo central:** "Workflows n8n impecáveis, com expert guidance no editor." Construir, validar e otimizar sem sair do Claude Code.

**Conceito criativo central — CANVAS DE EXECUÇÃO.** Um workflow wired: nodes conectados por arestas direcionais; um **pulso de execução** percorre node a node (recebe → processa → emite); estados acendem (rodando/sucesso/erro) em brasa; o webhook de entrada dispara tudo. O scroll conduz o pulso pelo canvas. Proponha refinamento em 2 linhas se houver algo mais forte.

# PÚBLICO

Devs n8n intermediário-avançado no Claude Code, DevOps/SRE em self-host (queue mode, scaling), automation engineers (AI agents, batch), data engineers (APIs, databases).

# SISTEMA VISUAL — HONRE EXATAMENTE (já carregado)

- Canvas **preto verdadeiro** em tudo. **`#A93636` é o ÚNICO acento** — o pulso de execução, estados, CTA, foco, eyebrow, barra. **Zero segunda cor** (sem o vermelho/rosa do n8n nem verde de "sucesso" — estado de sucesso é brasa cheia, erro é brasa apagada/contorno; sem segunda cor).
- **Bebas Neue** display (MAIÚSCULA + tracking ~0.02em) · **Inter** corpo · **JetBrains Mono** receipts (`QUEUE MODE · {{ $json }} · 400+ NODES`). Mono encaixa em código/expressões — use com intenção.
- **Barra diagonal** `skewX(-8deg)`, máx 2/tela. Grão + vinheta + scanline em blocos cinema.
- `text-wrap:balance` em h1/h2. Raio ≤ 20px. Hover card: `translateY(-2px)` + borda vermelha + glow. Avatar `maxvision-avatar-hero.png`, logo `maxvision-roda.png`.

# VOZ — RÍGIDA

pt-BR, frases curtas, presente. Sem emoji, sem exclamação, sem hype. Banidas: "incrível", "inovador", "revolucionário", "transformar", "supercharge", "seamless". MAIÚSCULAS só display/eyebrow. Receipts em mono. Tom: engenharia de automação séria, validada.

# ESQUELETO DE SAÍDA (obrigatório)

```html
<!DOCTYPE html>
<html lang="pt-BR" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MaxVision n8n Skills · Workflows n8n no Claude Code · Produtora MaxVision</title>
  <meta name="description" content="7 skills expert para construir workflows n8n impecáveis no Claude Code: Code nodes JS/Python, expressões, padrões e validação iterativa." />
  <link rel="canonical" href="https://www.produtoramaxvision.com.br/n8n-skills" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="../colors_and_type.css" />
  <link rel="stylesheet" href="site-base.css" />
  <link rel="stylesheet" href="site-chrome.css" />
  <style> /* CSS da pagina */ </style>
  <script>window.MV_ASSETS='../assets/';window.MV_BASE='';</script>
  <!-- Schema.org: Organization + SoftwareApplication (n8n Skills) + BreadcrumbList -->
</head>
<body data-page="n8nskills" data-theme="dark" data-grain="on" data-motion="on" data-cursor="on" data-density="regular" data-accent="brand" data-mood="cinema">
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

1. **Hero** — headline Bebas pôster (clip-reveal) + sub + CTA "Instalar no Claude Code" (comando `/plugin install n8n-skills@maxvision-claude` em receipt mono) + CTA secundário GitHub. Atrás: o pulso percorrendo o canvas (ver Motion). Momento-assinatura.
2. **O canvas vivo** — componente-assinatura: um workflow wired onde o pulso de execução viaja node a node; estados acendem (rodando/sucesso/erro em brasa); webhook de entrada dispara. Sem texto expositivo.
3. **As 7 skills** — apresentadas não como grade idêntica: JS Code, Python Code, expressões `{{ }}`, configuração de node, validação, padrões de workflow, n8n-mcp. Cada uma com 1 linha real.
4. **6 padrões** — webhook, HTTP API, database, AI agent, batch, scheduled — como variações do canvas (mini-circuitos distintos), não cards repetidos.
5. **Validação iterativa** — diferencial: validação é ciclo (2-3 iterações), false positives reconhecidos; mostra um receipt mono de erro→fix→ok.
6. **Produção** — queue mode, self-host, scaling, 400+ nodes. Receipt técnico.
7. **Instalar** — comando do marketplace em mono. Licença **MIT, open-source, gratuito**. Atribuição: derivado de Romuald Członkowski (czlonkowski/n8n-skills), packaging MaxVision.
8. **CTA final** — Bebas pôster + barra diagonal longa + receipt de fechamento + link GitHub.

# MOTION / INTERAÇÃO (integra, não duplica)

**Herde:** `[data-parallax="0.2"]`, `[data-magnetic]` no CTA, `.counter[data-to]`, `section[id]`+`data-screen-label`. Não reimplemente cursor/header/drone.

**Wow 3D/profundidade (o canvas) — aditivo e isolado:**
- **Three.js** (cdnjs, no shell) num **canvas isolado de fundo**: um circuito direcional de nodes (caixas/pontos) ligados por arestas, com **profundidade** (camadas z, leve perspectiva), e um **pulso de luz em brasa** que viaja pelas arestas executando node a node; o scroll avança o pulso. Direcional (entrada → saída), NÃO constelação social. **Preto + brasa `#A93636`** somente.
- GSAP ScrollTrigger **opcional** só para o pin/scrub do "canvas vivo". Depois do `fx.js`, seletores `.fx-*`, sem tocar `[data-parallax]`/`[data-reveal]`.
- **PROIBIDO Lenis** / segundo smooth-scroll.
- Canvas checa `body[data-motion="off"]` + `prefers-reduced-motion` → fallback estático (circuito parado). Limpa rAF no `pagehide`. Só `transform`/`opacity`; menos nodes no mobile.
- **Reveal (crítico para o preview):** `[data-reveal]` fica ESCONDIDO via `site-base.css` até o `fx.js` revelar — e o `fx.js` pode não rodar no preview do Claude Design (seções em branco). Implemente seu PRÓPRIO reveal inline (IntersectionObserver, conteúdo **visível por padrão**, JS só adiciona o fade). Use `[data-parallax]`/`[data-magnetic]`/`.counter` como enriquecimento; **NÃO** use `[data-reveal]` em conteúdo crítico. Conteúdo sempre visível por padrão sem fx.js.

# INOVAÇÃO DE COMPONENTES (≥2 inéditos, on-brand)

(a) o **canvas de execução com pulso direcional** reativo ao scroll; (b) o **receipt de validação iterativa** (erro→fix→ok como instrumento). Pode propor um terceiro (ex: seletor dos 6 padrões que reconfigura o mini-circuito). Supere as direções.

# RESTRIÇÕES TÉCNICAS

- HTML completo com o shell; `<style>`/`<script>` inline; sem build/backend/`fetch`/`localStorage`.
- Libs só de `cdnjs.cloudflare.com` (Three.js r128 incluso). **Nunca Lenis.** (Integração: `integrity`/`crossorigin`.)
- Código/expressões: texto real plausível (JS Code node, `{{ $json.x }}`) em bloco mono; sem segredos.
- Responsivo mobile-first, sem overflow.

# ACESSIBILIDADE

Semântico, `:focus-visible` ring vermelho, contraste ≥ AA, `prefers-reduced-motion`, alvos ≥ 44px, `aria-*` em componentes interativos e counters. Canvas decorativo `aria-hidden="true"`.

# PROIBIÇÕES ABSOLUTAS (anti-slop)

Sem Inter/Roboto/system como display. Sem gradiente arco-íris/pastel/roxo. Sem texto em gradiente. Sem glassmorphism default. Sem cantos >20px. Sem grade de cards idênticos. Sem eyebrow tracked em toda seção. Sem `01/02/03` clichê. Sem tudo-centralizado. Sem emoji/hype. Sem logo SVG. Sem barra sem skew -8deg. **Sem segunda cor (nem verde de sucesso, nem rosa/vermelho n8n) — só `#A93636`.** **Sem header/footer/dropdown próprios.** **Sem Lenis.** **Sem virar grafo social (é circuito direcional).** **Sem copiar minhas páginas ou as outras landings.**

# AUTO-TESTE ANTES DE ENTREGAR

1. Anti-slop. 2. Não-cópia: conceito é canvas de execução direcional, não grafo social/forja/stream/ritmo/timeline/gatilho/fan-out. 3. Tokens: acento só `#A93636`. 4. Voz sem emoji/hype. 5. ≥2 componentes inéditos. 6. Sem chrome próprio. 7. Motion: Three.js isolado, sem Lenis, honra `data-motion=off`+reduced-motion com fallback, só transform/opacity. 8. Esqueleto exato.

Antes de construir, proponha em 3–4 linhas: direção estética, momento-assinatura, os 2+ componentes inéditos e a técnica-herói. Depois construa a página completa.

=====

## Notas de uso (fora do prompt)
- CTA primário = instalar via marketplace + GitHub (não WhatsApp). Free/MIT.
- Dropdown Downloads: global no `chrome.js` (adicionar item `n8n-skills` → `N8nSkills.html`).
- Integração: `2026-06-02-suite-landings-integration-spec.md`.
