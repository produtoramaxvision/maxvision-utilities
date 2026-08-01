# Prompt Claude Design — Landing MaxVision GTM Skills (v2 — marketing/SEO)

> v2 do prompt GTM Skills. Mantém o conceito GATILHO E DISPARO e todo o sistema visual/motion da v1; adiciona camada de **marketing digital, SEO técnico/on-page, CRO e mensuração** (marketing-skills: seo-audit, copywriting, cro, schema). v1 preservado. Cole o bloco entre `=====` no Claude Design com o design system MaxVision (incl. `fx.js`, `chrome.js`, `site-base.css`, `site-chrome.css`) carregado.

=====

# PAPEL E MANDATO

Você é diretor de arte premiado + engenheiro front-end sênior + copywriter de conversão. Construa o **corpo de uma landing page de produto** (conteúdo de `<main>`) para o site da Produtora MaxVision, production-grade, em **português do Brasil**. Criatividade cinematográfica máxima na composição, no movimento e em **componentes inéditos** — dentro do sistema visual da marca e otimizada para **conversão e busca orgânica**. Sistema imóvel, criatividade livre dentro dele.

**Não autora header, footer, menu, dropdown nem WhatsApp** — injetados pelo `chrome.js` nos slots `data-mv-*`. Entregue o esqueleto + `<main>` + CSS/JS próprios.

**NÃO COPIE minhas páginas nem as outras landings.** Conceito: GATILHO E DISPARO (evento → trigger → tag dispara em brasa → versão/snapshot). Diferencie de forja (media-forge), grafo social (LinkedIn), stream (X), ritmo (TikTok), timeline (YouTube), canvas de execução de nodes (n8n) e fan-out de roteamento (Orchestrator). Reuse só o vocabulário visual da marca.

# O PRODUTO

**MaxVision GTM Skills** — skill expert de Google Tag Manager para o Claude Code. Encapsula a GTM API v2 como conhecimento executável: cria, atualiza, valida e publica tags, triggers, variáveis e containers; entende a hierarquia Account → Container → Workspace → Entidades; trata OAuth 2.0, rate limits (exponential backoff), fingerprints e conflito de workspace; cobre GA4 e server-side container. Expertise embutida (algoritmos validados, validação pré-execução, tratamento de erro 400/401/403/409/429/500). Licença BSD-3, gratuito.

**Ângulo central:** "GTM por conversa, com a engenharia certa por baixo." Tag management com rigor de produção, dentro do Claude Code.

**Conceito criativo — GATILHO E DISPARO.** Evento entra; passa por um trigger (porta condicional); quando a condição bate, a tag **dispara** (lampejo em brasa); a config é versionada (snapshot imutável). A página encena evento → trigger → disparo → versão.

# PÚBLICO

Marketing technologists / tag managers, analytics engineers, plataforma/DevOps (server-side), consultores GTM, data engineers (dataLayer). Usuários de Claude Code. Chegam por busca ("GTM API no Claude Code", "automatizar Google Tag Manager"), GitHub, conteúdo de analytics.

# SEO — ALVO DE PALAVRAS-CHAVE (on-page)

- **Keyword primária:** "Google Tag Manager no Claude Code".
- **Secundárias:** "automação da GTM API", "skill GTM Claude Code", "GTM server-side / GA4", "criar tags e triggers via API".
- Keyword primária **no H1, `<title>`, meta description e nos primeiros 100 caracteres de texto visível** — natural, sem stuffing. Secundárias em H2/corpo.
- 1 (um) `<h1>` (headline do hero). Cada seção com `<h2>` descritivo; subitens `<h3>`. Hierarquia lógica, sem pular níveis.

# VOZ (copy) — RÍGIDA + CONVERSÃO

pt-BR, frases curtas, presente. **Sem emoji, sem exclamação, sem hype.** Banidas: "incrível", "inovador", "revolucionário", "transformar", "supercharge", "seamless". **A regra sem-hype VENCE qualquer punch genérico de marketing.** Persuada por especificidade e benefício.
- Benefício > feature ("publica um container versionado sem abrir a UI da GTM", não só "usa a API").
- Especificidade: nomeie entidades/erros reais (GA4 tag, trigger condicional, backoff 1s→2s→4s, 409 conflict).
- **Anti-AI-tell:** evite travessão (—) em excesso, "no mundo de hoje", "imagine", "desbloqueie", listas genéricas de três. Tom de engenheiro de analytics.
- MAIÚSCULAS só display/eyebrow. Receipts em mono.

# ESQUELETO DE SAÍDA (obrigatório — title/meta otimizados + schema)

```html
<!DOCTYPE html>
<html lang="pt-BR" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>GTM Skills · Google Tag Manager no Claude Code · MaxVision</title>
  <meta name="description" content="Skill expert de Google Tag Manager para Claude Code: crie, valide e publique tags, triggers e variáveis via API, com OAuth, GA4 e server-side. BSD-3, grátis." />
  <link rel="canonical" href="https://www.produtoramaxvision.com.br/gtm-skills" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="MaxVision GTM Skills · Google Tag Manager no Claude Code" />
  <meta property="og:description" content="Automatize a GTM API v2 no Claude Code: tags, triggers, variáveis, GA4, server-side. Validação e versionamento. BSD-3, grátis." />
  <meta property="og:locale" content="pt_BR" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="../colors_and_type.css" />
  <link rel="stylesheet" href="site-base.css" />
  <link rel="stylesheet" href="site-chrome.css" />
  <style> /* CSS da pagina */ </style>
  <script>window.MV_ASSETS='../assets/';window.MV_BASE='';</script>
  <!-- Schema.org @graph: Organization + SoftwareApplication (offers price 0 BRL, BSD-3) + BreadcrumbList (Início > Downloads > GTM Skills) + FAQPage (mesmas perguntas da seção FAQ) -->
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

# ESTRUTURA DO `<main>` (ordem otimizada para funil; interior é seu — inove)

Cada `<section>` com `id` + `data-screen-label` + `<h2>` descritivo.

1. **Hero (acima da dobra)** — `<h1>` com keyword primária + sub específica + **CTA primário "Instalar no Claude Code"** (comando `/plugin install gtm-skills@maxvision-claude` em mono, copy-to-clipboard) + CTA secundário "Ver no GitHub". Value prop em 5s. Atrás: o ciclo de disparo em brasa (ver Motion). Momento-assinatura.
2. **Prova social** — confiança HONESTA perto do CTA: estrelas GitHub (placeholder a confirmar — ex: ~11), "expertise embutida, não wrapper genérico", licença BSD-3. **Nunca invente** — placeholders `data-confirm`.
3. **O disparo** — componente-assinatura: evento → trigger → tag dispara → snapshot versionado.
4. **Problema → solução** — a dor (GTM API crua, rate limits, conflito de workspace, erro mudo) e como a skill resolve com validação + backoff. Benefício-led.
5. **As 4 camadas** — Account → Container → Workspace → Entidades com profundidade.
6. **O que a skill faz** — criar/atualizar/deletar tags-triggers-variáveis, validação pré-execução, publicação versionada, OAuth + backoff, server-side, GA4.
7. **Engenharia embutida (objeção "não é só a API pública?")** — receipt mono de validação/erro tratado (409, 429 backoff) como prova de rigor.
8. **Instalar** — comando do marketplace em mono, passos curtos. BSD-3 gratuito. Atribuição: deriva de Paolo Bietolini, packaging MaxVision.
9. **FAQ (objeções + AEO/featured snippets)** — 5-7 perguntas reais curtas (ex: "Precisa de conta Google/OAuth?", "Mexe em produção sem confirmar?", "Cobre server-side e GA4?", "É grátis?", "Substitui a UI da GTM?"). Espelhe no `FAQPage` schema.
10. **CTA final** — recap + **mesmo CTA primário** + barra diagonal longa + receipt + GitHub.

# CONVERSÃO + MENSURAÇÃO (CRO)

- **Um objetivo primário:** instalar. Um CTA primário repetido (hero + fim); secundário = GitHub. Sem CTAs competindo.
- CTA copy = ação + valor: "Instalar no Claude Code". Comando exato em mono + botão copiar (`navigator.clipboard`; sem `fetch`/`localStorage`).
- Trust signals perto de cada CTA; objeções na FAQ; hierarquia visual: o disparo da tag e o CTA primário são os pontos mais quentes (brasa).
- **Mensuração:** `data-mv-cta="install"`, `data-mv-cta="github"`, `data-mv-event="copy_command"` nos CTAs/eventos — o GTM/GA4 do site captura (apropriado, já que o produto é GTM). Não duplique GTM na página.

# MOTION / INTERAÇÃO (integra, não duplica)

**Herde:** `[data-parallax="0.2"]`, `[data-magnetic]` no CTA, `.counter[data-to]`, `section[id]`+`data-screen-label`. Não reimplemente cursor/header/drone.

**Wow 3D/profundidade (o disparo) — aditivo e isolado:**
- **Three.js** (cdnjs, no shell) num **canvas isolado de fundo**: partículas-evento atravessam em profundidade e, ao cruzar um trigger, emitem um lampejo/disparo em brasa que se propaga (pipeline de eventos com gates). **Preto + brasa `#A93636`** somente.
- GSAP ScrollTrigger **opcional** só para pin/scrub do ciclo de disparo. Depois do `fx.js`, seletores `.fx-*`, sem tocar `[data-parallax]`/`[data-reveal]`.
- **PROIBIDO Lenis** / segundo smooth-scroll.
- Canvas checa `body[data-motion="off"]` + `prefers-reduced-motion` → fallback estático. Limpa rAF no `pagehide`. Só `transform`/`opacity`; menos partículas no mobile.
- **Reveal (crítico para o preview):** `[data-reveal]` fica ESCONDIDO via `site-base.css` até o `fx.js` revelar — e o `fx.js` pode não rodar no preview do Claude Design. Implemente seu PRÓPRIO reveal inline (IntersectionObserver, conteúdo **visível por padrão**). Use `[data-parallax]`/`[data-magnetic]`/`.counter` como enriquecimento; **NÃO** use `[data-reveal]` em conteúdo crítico.

# INOVAÇÃO DE COMPONENTES (≥2 inéditos, on-brand)

(a) o **ciclo de disparo evento→trigger→tag→versão** reativo ao scroll; (b) o **receipt de validação/erro ao vivo** (backoff e conflict como instrumento). Terceiro opcional: as 4 camadas com profundidade interativa. Supere as direções.

# RESTRIÇÕES TÉCNICAS

- HTML completo com o shell; `<style>`/`<script>` inline; sem build/backend/`fetch`/`localStorage` (clipboard copy ok).
- Libs só de `cdnjs.cloudflare.com` (Three.js r128 incluso). **Nunca Lenis.** (Integração: `integrity`/`crossorigin`.)
- JSON/comando real plausível (GA4 tag, trigger) em mono; sem segredos/tokens.
- Core Web Vitals: LCP < 2.5s, CLS < 0.1 (reserve espaço), INP < 200ms. Imagens com alt + lazy + formato moderno.
- Responsivo mobile-first, sem overflow.

# ACESSIBILIDADE

Semântico, `:focus-visible` ring vermelho, contraste ≥ AA, `prefers-reduced-motion`, alvos ≥ 44px, `aria-*` em interativos, FAQ em `<details>`/`<summary>`. Canvas decorativo `aria-hidden="true"`.

# PROIBIÇÕES ABSOLUTAS (anti-slop)

Sem Inter/Roboto/system como display. Sem gradiente arco-íris/pastel/roxo. Sem texto em gradiente. Sem glassmorphism default. Sem cantos >20px. Sem grade de cards idênticos. Sem eyebrow tracked em toda seção. Sem `01/02/03` clichê. Sem tudo-centralizado. Sem emoji/hype. **Sem número/depoimento inventado.** Sem logo SVG. Sem barra sem skew -8deg. **Sem azul Google/GTM nem segunda cor.** **Sem header/footer/dropdown próprios.** **Sem Lenis.** **Sem copiar minhas páginas ou as outras landings.**

# AUTO-TESTE ANTES DE ENTREGAR

1. Anti-slop + anti-AI-tell. 2. Não-cópia: gatilho/disparo. 3. Tokens: acento só `#A93636`. 4. Voz sem emoji/hype. 5. ≥2 componentes inéditos. 6. Sem chrome próprio. 7. Motion seguro. 8. **SEO:** 1 H1 com keyword, title 50-60, meta 150-160, hierarquia H2/H3, keyword nos 1ºs 100 chars, internal links, alt text, `@graph` com SoftwareApplication+FAQPage+BreadcrumbList. 9. **CRO:** 1 CTA primário repetido, value prop em 5s, prova social honesta, FAQ. 10. **Mensuração:** `data-mv-cta`/`data-mv-event`.

Antes de construir, proponha em 3–4 linhas: direção estética, momento-assinatura, os 2+ componentes inéditos, a técnica-herói E a keyword primária no H1/title/meta. Depois construa a página completa.

=====

## Notas de uso (fora do prompt)
- CTA = instalar via marketplace + GitHub. BSD-3 grátis.
- Internal links: `Downloads.html` (catálogo), `Orchestrator.html`/`N8nSkills.html` (relacionados), `Marketing.html` (departamento marketing/analytics), `Home.html`.
- Dropdown Downloads + rota: spec de integração. Validar schema no Rich Results Test.
