# Prompt Claude Design — Landing MaxVision n8n Skills (v2 — marketing/SEO)

> v2 do prompt n8n Skills. Mantém o conceito CANVAS DE EXECUÇÃO e todo o sistema visual/motion da v1; adiciona camada de **marketing digital, SEO técnico/on-page, CRO e mensuração** (marketing-skills: seo-audit, copywriting, cro, schema). v1 preservado. Cole o bloco entre `=====` no Claude Design com o design system MaxVision (incl. `fx.js`, `chrome.js`, `site-base.css`, `site-chrome.css`) carregado.

=====

# PAPEL E MANDATO

Você é diretor de arte premiado + engenheiro front-end sênior + copywriter de conversão. Construa o **corpo de uma landing page de produto** (conteúdo de `<main>`) para o site da Produtora MaxVision, production-grade, em **português do Brasil**. Criatividade cinematográfica máxima na composição, no movimento e em **componentes inéditos** — dentro do sistema visual da marca e otimizada para **conversão e busca orgânica**. Sistema imóvel, criatividade livre dentro dele.

**Não autora header, footer, menu, dropdown nem WhatsApp** — injetados pelo `chrome.js` nos slots `data-mv-*`. Entregue o esqueleto + `<main>` + CSS/JS próprios.

**NÃO COPIE minhas páginas nem as outras landings.** Conceito: CANVAS DE EXECUÇÃO (fluxo direcional de nodes que executam). Diferencie do GRAFO DE REDE SOCIAL do LinkedIn (constelação social) — aqui é circuito direcional wired com estados de execução — e de forja, stream, ritmo, timeline, gatilho/disparo (GTM) e fan-out (Orchestrator). Reuse só o vocabulário visual da marca.

# O PRODUTO

**MaxVision n8n Skills** — 7 skills expert para construir workflows n8n impecáveis dentro do Claude Code. Ativam automaticamente por contexto. Cobrem: JavaScript e Python em Code nodes (`$input`/`$json`/`$node`, DateTime, error handling, SplitInBatches, pairedItem), sintaxe de expressões `{{ }}`, configuração de nodes, 6 padrões arquiteturais (webhook, HTTP API, database, AI agent, batch, scheduled), validação iterativa e uso do n8n-mcp. Cobre produção: queue mode, self-host, scaling. Licença MIT, gratuito.

**Ângulo central:** "Workflows n8n impecáveis, com expert guidance no editor." Construir, validar e otimizar sem sair do Claude Code.

**Conceito criativo — CANVAS DE EXECUÇÃO.** Workflow wired: nodes ligados por arestas direcionais; um **pulso de execução** percorre node a node; estados acendem (rodando/sucesso/erro) em brasa; o webhook de entrada dispara tudo. O scroll conduz o pulso.

# PÚBLICO

Devs n8n intermediário-avançado no Claude Code, DevOps/SRE em self-host (queue mode, scaling), automation engineers (AI agents, batch), data engineers (APIs, databases). Chegam por busca ("workflows n8n no Claude Code", "n8n Code node JavaScript"), GitHub, comunidade de automação.

# SEO — ALVO DE PALAVRAS-CHAVE (on-page)

- **Keyword primária:** "workflows n8n no Claude Code".
- **Secundárias:** "n8n Code node JavaScript/Python", "skills n8n Claude Code", "expressões n8n `{{ }}`", "n8n queue mode self-host".
- Keyword primária **no H1, `<title>`, meta description e nos primeiros 100 caracteres de texto visível** — natural. Secundárias em H2/corpo.
- 1 (um) `<h1>` (headline do hero). Cada seção com `<h2>` descritivo; subitens `<h3>`. Hierarquia lógica, sem pular níveis.

# VOZ (copy) — RÍGIDA + CONVERSÃO

pt-BR, frases curtas, presente. **Sem emoji, sem exclamação, sem hype.** Banidas: "incrível", "inovador", "revolucionário", "transformar", "supercharge", "seamless". **A regra sem-hype VENCE qualquer punch genérico de marketing.** Persuada por especificidade e benefício.
- Benefício > feature ("o workflow passa na validação em 2-3 iterações, sem caçar erro de expressão na mão").
- Especificidade: nomeie coisas reais (`{{ $json.x }}`, SplitInBatches, queue mode, 400+ nodes, 6 padrões).
- **Anti-AI-tell:** evite travessão (—) em excesso, "no mundo de hoje", "imagine", "desbloqueie", listas genéricas de três. Tom de automation engineer.
- MAIÚSCULAS só display/eyebrow. Receipts em mono.

# ESQUELETO DE SAÍDA (obrigatório — title/meta otimizados + schema)

```html
<!DOCTYPE html>
<html lang="pt-BR" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>n8n Skills · Workflows n8n no Claude Code · MaxVision</title>
  <meta name="description" content="7 skills expert para construir workflows n8n impecáveis no Claude Code: Code nodes JS/Python, expressões, 6 padrões e validação iterativa. MIT, grátis." />
  <link rel="canonical" href="https://www.produtoramaxvision.com.br/n8n-skills" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="MaxVision n8n Skills · Workflows n8n no Claude Code" />
  <meta property="og:description" content="Code nodes JS/Python, expressões {{ }}, 6 padrões, validação iterativa, queue mode. MIT, grátis." />
  <meta property="og:locale" content="pt_BR" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="../colors_and_type.css" />
  <link rel="stylesheet" href="site-base.css" />
  <link rel="stylesheet" href="site-chrome.css" />
  <style> /* CSS da pagina */ </style>
  <script>window.MV_ASSETS='../assets/';window.MV_BASE='';</script>
  <!-- Schema.org @graph: Organization + SoftwareApplication (offers price 0 BRL, MIT) + BreadcrumbList (Início > Downloads > n8n Skills) + FAQPage (mesmas perguntas da seção FAQ) -->
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

# ESTRUTURA DO `<main>` (ordem otimizada para funil; interior é seu — inove)

Cada `<section>` com `id` + `data-screen-label` + `<h2>` descritivo.

1. **Hero (acima da dobra)** — `<h1>` com keyword primária + sub específica + **CTA primário "Instalar no Claude Code"** (comando `/plugin install n8n-skills@maxvision-claude` em mono, copy-to-clipboard) + CTA secundário "Ver no GitHub". Value prop em 5s. Atrás: o pulso percorrendo o canvas (ver Motion). Momento-assinatura.
2. **Prova social** — confiança HONESTA perto do CTA: estrelas GitHub (placeholder a confirmar — ex: ~22), "deriva do upstream líder czlonkowski/n8n-skills", licença MIT. **Nunca invente** — placeholders `data-confirm`.
3. **O canvas vivo** — componente-assinatura: pulso de execução viajando node a node; estados acendem; webhook dispara.
4. **Problema → solução** — a dor (erro de expressão, validação que falha, código de Code node frágil) e como as skills resolvem (padrões + validação iterativa). Benefício-led.
5. **As 7 skills** — JS Code, Python Code, expressões `{{ }}`, configuração de node, validação, padrões, n8n-mcp. Não como grade idêntica; cada uma com 1 linha real.
6. **6 padrões** — webhook, HTTP API, database, AI agent, batch, scheduled — como variações do canvas (mini-circuitos distintos).
7. **Validação iterativa (objeção "n8n já valida")** — receipt mono erro→fix→ok; reconhece false positives; mostra que validação é ciclo (2-3 iterações).
8. **Produção** — queue mode, self-host, scaling, 400+ nodes. Receipt técnico.
9. **Instalar** — comando do marketplace em mono. MIT gratuito. Atribuição: deriva de Romuald Członkowski, packaging MaxVision.
10. **FAQ (objeções + AEO/featured snippets)** — 5-7 perguntas reais curtas (ex: "Precisa do n8n-mcp?", "Funciona com self-host e cloud?", "Cobre JS e Python?", "É grátis?", "Ativa sozinho ou eu invoco?"). Espelhe no `FAQPage` schema.
11. **CTA final** — recap + **mesmo CTA primário** + barra diagonal longa + receipt + GitHub.

# CONVERSÃO + MENSURAÇÃO (CRO)

- **Um objetivo primário:** instalar. Um CTA primário repetido (hero + fim); secundário = GitHub. Sem CTAs competindo.
- CTA copy = ação + valor: "Instalar no Claude Code". Comando exato em mono + botão copiar (`navigator.clipboard`; sem `fetch`/`localStorage`).
- Trust signals perto de cada CTA; objeções na FAQ; hierarquia visual: o pulso/estado de sucesso e o CTA primário são os pontos mais quentes (brasa).
- **Mensuração:** `data-mv-cta="install"`, `data-mv-cta="github"`, `data-mv-event="copy_command"` nos CTAs/eventos — o GTM/GA4 do site captura. Não duplique GTM na página.

# MOTION / INTERAÇÃO (integra, não duplica)

**Herde:** `[data-parallax="0.2"]`, `[data-magnetic]` no CTA, `.counter[data-to]`, `section[id]`+`data-screen-label`. Não reimplemente cursor/header/drone.

**Wow 3D/profundidade (o canvas) — aditivo e isolado:**
- **Three.js** (cdnjs, no shell) num **canvas isolado de fundo**: circuito direcional de nodes ligados por arestas, com profundidade (camadas z, leve perspectiva), e um **pulso de luz em brasa** que viaja pelas arestas executando node a node; o scroll avança o pulso. Direcional (entrada → saída), NÃO constelação social. **Preto + brasa `#A93636`** somente.
- GSAP ScrollTrigger **opcional** só para pin/scrub do canvas vivo. Depois do `fx.js`, seletores `.fx-*`, sem tocar `[data-parallax]`/`[data-reveal]`.
- **PROIBIDO Lenis** / segundo smooth-scroll.
- Canvas checa `body[data-motion="off"]` + `prefers-reduced-motion` → fallback estático (circuito parado). Limpa rAF no `pagehide`. Só `transform`/`opacity`; menos nodes no mobile.
- **Reveal (crítico para o preview):** `[data-reveal]` fica ESCONDIDO via `site-base.css` até o `fx.js` revelar — e o `fx.js` pode não rodar no preview do Claude Design. Implemente seu PRÓPRIO reveal inline (IntersectionObserver, conteúdo **visível por padrão**). Use `[data-parallax]`/`[data-magnetic]`/`.counter` como enriquecimento; **NÃO** use `[data-reveal]` em conteúdo crítico.

# INOVAÇÃO DE COMPONENTES (≥2 inéditos, on-brand)

(a) o **canvas de execução com pulso direcional** reativo ao scroll; (b) o **receipt de validação iterativa** (erro→fix→ok). Terceiro opcional: seletor dos 6 padrões que reconfigura o mini-circuito. Supere as direções.

# RESTRIÇÕES TÉCNICAS

- HTML completo com o shell; `<style>`/`<script>` inline; sem build/backend/`fetch`/`localStorage` (clipboard copy ok).
- Libs só de `cdnjs.cloudflare.com` (Three.js r128 incluso). **Nunca Lenis.** (Integração: `integrity`/`crossorigin`.)
- Código/expressões real plausível (`{{ $json.x }}`, JS Code node) em mono; sem segredos.
- Core Web Vitals: LCP < 2.5s, CLS < 0.1 (reserve espaço), INP < 200ms. Imagens com alt + lazy + formato moderno.
- Responsivo mobile-first, sem overflow.

# ACESSIBILIDADE

Semântico, `:focus-visible` ring vermelho, contraste ≥ AA, `prefers-reduced-motion`, alvos ≥ 44px, `aria-*` em interativos, FAQ em `<details>`/`<summary>`. Canvas decorativo `aria-hidden="true"`.

# PROIBIÇÕES ABSOLUTAS (anti-slop)

Sem Inter/Roboto/system como display. Sem gradiente arco-íris/pastel/roxo. Sem texto em gradiente. Sem glassmorphism default. Sem cantos >20px. Sem grade de cards idênticos. Sem eyebrow tracked em toda seção. Sem `01/02/03` clichê. Sem tudo-centralizado. Sem emoji/hype. **Sem número/depoimento inventado.** Sem logo SVG. Sem barra sem skew -8deg. **Sem segunda cor (nem verde de sucesso, nem rosa/vermelho n8n) — só `#A93636`.** **Sem header/footer/dropdown próprios.** **Sem Lenis.** **Sem virar grafo social (é circuito direcional).** **Sem copiar minhas páginas ou as outras landings.**

# AUTO-TESTE ANTES DE ENTREGAR

1. Anti-slop + anti-AI-tell. 2. Não-cópia: canvas de execução direcional. 3. Tokens: acento só `#A93636`. 4. Voz sem emoji/hype. 5. ≥2 componentes inéditos. 6. Sem chrome próprio. 7. Motion seguro. 8. **SEO:** 1 H1 com keyword, title 50-60, meta 150-160, hierarquia H2/H3, keyword nos 1ºs 100 chars, internal links, alt text, `@graph` com SoftwareApplication+FAQPage+BreadcrumbList. 9. **CRO:** 1 CTA primário repetido, value prop em 5s, prova social honesta, FAQ. 10. **Mensuração:** `data-mv-cta`/`data-mv-event`.

Antes de construir, proponha em 3–4 linhas: direção estética, momento-assinatura, os 2+ componentes inéditos, a técnica-herói E a keyword primária no H1/title/meta. Depois construa a página completa.

=====

## Notas de uso (fora do prompt)
- CTA = instalar via marketplace + GitHub. MIT grátis.
- Internal links: `Downloads.html` (catálogo), `Orchestrator.html`/`GtmSkills.html` (relacionados), `DevOps.html` (departamento infra/automação), `Home.html`.
- Dropdown Downloads + rota: spec de integração. Validar schema no Rich Results Test.
