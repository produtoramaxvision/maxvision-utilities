# Prompt Claude Design — Landing MaxVision Orchestrator (v2 — marketing/SEO)

> v2 do prompt Orchestrator. Mantém o conceito FAN-OUT/REGÊNCIA e todo o sistema visual/motion da v1; adiciona camada de **marketing digital, SEO técnico/on-page, CRO e mensuração** (revisão via marketing-skills: seo-audit, copywriting, cro, schema). v1 preservado. Cole o bloco entre `=====` no Claude Design com o design system MaxVision (incl. `fx.js`, `chrome.js`, `site-base.css`, `site-chrome.css`) carregado.

=====

# PAPEL E MANDATO

Você é diretor de arte premiado + engenheiro front-end sênior + copywriter de conversão. Construa o **corpo de uma landing page de produto** (conteúdo de `<main>`) para o site da Produtora MaxVision, production-grade, em **português do Brasil**. Criatividade cinematográfica máxima na composição, no movimento e em **componentes inéditos** — dentro do sistema visual da marca, e agora também otimizada para **conversão e busca orgânica**. Sistema imóvel, criatividade livre dentro dele.

**Não autora header, footer, menu, dropdown nem WhatsApp** — injetados pelo `chrome.js` nos slots `data-mv-*`. Entregue o esqueleto + `<main>` + CSS/JS próprios.

**NÃO COPIE minhas páginas nem as outras landings.** Conceito: FAN-OUT DE ROTEAMENTO / REGÊNCIA (1 tarefa → ramifica → roteia → candidatos acendem no ranking → ondas paralelas). Diferencie do canvas direcional do n8n (1 fluxo sequencial), do grafo social do LinkedIn (conexão social) e dos demais (forja, stream, ritmo, timeline, gatilho/disparo). Reuse só o vocabulário visual da marca.

# O PRODUTO

**MaxVision Orchestrator** (plugin Claude Code, MIT) — roteia uma tarefa complexa para o(s) melhor(es) subagente(s) e skills entre **500+ agentes e 4.000+ skills** indexados em catálogo FTS5, sem o overhead de descrições acumuladas por sessão. Pipeline de roteamento em 4 estágios (keyword Haiku → BM25 FTS5 → cap por fonte → juiz Sonnet). Multi-task split, version-check de integridade upstream, síntese de skills, dispatch paralelo (3-4, isolado em worktree), ciclo de skills efêmeras (auto-promove em 5 usos). Provisionamento com **aprovação humana** (nunca instala em silêncio).

**Ângulo central:** "Uma tarefa. O agente certo, na hora certa. Sem overhead." Camada de inteligência que ouve, entende, seleciona e rege.

**Conceito criativo — REGÊNCIA / FAN-OUT.** Tarefa entra; ramifica; cada ramo passa pelo pipeline; candidatos acendem num ranking (vencedor em brasa); o maestro dispara ondas paralelas; skills efêmeras brilham translúcidas e solidificam ao reusar. O scroll é a regência.

# PÚBLICO

Power users de Claude Code, times enterprise migrando em escala, times com CI/CD, indústrias reguladas (catálogos proprietários + auditoria), autores de skills/plugins. Devs técnicos. Chegam por busca ("orquestrador de skills Claude Code", "rotear subagents"), GitHub, indicação e conteúdo dev.

# SEO — ALVO DE PALAVRAS-CHAVE (on-page)

- **Keyword primária:** "orquestrador de skills e subagents no Claude Code".
- **Secundárias:** "roteamento de agentes Claude Code", "catálogo de skills MCP", "plugin de orquestração Claude Code", "FTS5/BM25 skill routing".
- Use a keyword primária **no H1, no `<title>`, na meta description e nos primeiros 100 caracteres de texto visível** — de forma natural, sem stuffing. Secundárias distribuídas em H2/corpo.
- 1 (um) `<h1>` na página (a headline do hero). Cada seção começa com `<h2>` descritivo (não decorativo); subitens em `<h3>`. Hierarquia lógica, sem pular níveis.

# VOZ (copy) — RÍGIDA + CONVERSÃO

pt-BR, frases curtas, presente. **Sem emoji, sem exclamação, sem hype.** Banidas: "incrível", "inovador", "revolucionário", "transformar", "supercharge", "seamless". **A regra sem-hype VENCE qualquer punch genérico de marketing.** Persuada por **especificidade e benefício**, não por adjetivo.
- Benefício > feature: traduza capacidade em resultado ("rotear 1 tarefa pra 500 agentes sem pagar 15k tokens por sessão"), não só o recurso.
- Especificidade: use números reais (500+ agentes, 4.000+ skills, roteamento ~1-2s, max 3-4 paralelos).
- **Anti-AI-tell:** evite travessão (—) em excesso, "no mundo de hoje", "seja você...", "imagine", "desbloqueie", listas genéricas de três. Escreva como engenheiro que entrega.
- MAIÚSCULAS só em display/eyebrow. Receipts em mono.

# ESQUELETO DE SAÍDA (obrigatório — title/meta otimizados + schema)

```html
<!DOCTYPE html>
<html lang="pt-BR" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <!-- TITLE 50-60 chars, keyword na frente, marca no fim -->
  <title>Orchestrator · Skills e Subagents no Claude Code · MaxVision</title>
  <!-- META 150-160 chars, keyword + benefício + CTA suave -->
  <meta name="description" content="Roteie 1 tarefa para 500+ agentes e 4.000+ skills no Claude Code, sem overhead por sessão. Pipeline FTS5/BM25 + juiz Sonnet. MIT. Instale e teste hoje." />
  <link rel="canonical" href="https://www.produtoramaxvision.com.br/orchestrator" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="MaxVision Orchestrator · Roteamento de skills no Claude Code" />
  <meta property="og:description" content="500+ agentes, 4.000+ skills, roteamento FTS5/BM25 + juiz Sonnet. Zero overhead por sessão. MIT." />
  <meta property="og:locale" content="pt_BR" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="../colors_and_type.css" />
  <link rel="stylesheet" href="site-base.css" />
  <link rel="stylesheet" href="site-chrome.css" />
  <style> /* CSS da pagina */ </style>
  <script>window.MV_ASSETS='../assets/';window.MV_BASE='';</script>
  <!-- Schema.org @graph: Organization + SoftwareApplication (offers price 0 BRL, MIT) + BreadcrumbList (Início > Downloads > Orchestrator) + FAQPage (mesmas perguntas da seção FAQ) -->
</head>
<body data-page="orchestrator" data-theme="dark" data-grain="on" data-motion="on" data-cursor="on" data-density="regular" data-accent="brand" data-mood="cinema">
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

1. **Hero (acima da dobra)** — `<h1>` com a keyword primária + sub específica + **CTA primário "Instalar no Claude Code"** (mostra o comando do marketplace em receipt mono, com copy-to-clipboard) + CTA secundário "Ver no GitHub". Value prop entendível em 5s. Atrás: o campo de 500 agentes ramificando (ver Motion). Momento-assinatura.
2. **Prova social (logo abaixo do hero)** — sinais de confiança HONESTOS perto do CTA: estrelas do GitHub, nº de commits (placeholders a confirmar — ex: 404 commits), "usado em produção", licença MIT. **Nunca invente número** — marque placeholder `data-confirm` para eu validar.
3. **O fan-out** — componente-assinatura: 1 tarefa → ramos → candidatos acendem → ondas paralelas reconvergem. Sem texto expositivo.
4. **Problema → solução** — a dor (overhead de 15k tokens, achar o agente certo) e como o roteamento resolve. Benefício-led.
5. **Pipeline de 4 estágios** — keyword → BM25 → cap por fonte → juiz Sonnet, como instrumento com scores em mono.
6. **O que faz** — multi-task split, version-check, síntese de skills, dispatch paralelo, ciclo efêmero, aprovação humana. Composição inesperada (não grade de cards iguais).
7. **Escala** — números reais em `.counter[data-to]` (500+, 4.000+, ~1-2s). Sem overhead por sessão.
8. **Guardrails (tratamento de objeção)** — nada instala em silêncio, version integrity, sem fallback genérico, sem deletar arquivos. Confiança.
9. **Open-source + serviços** — MIT gratuito; tiers comerciais opcionais (EDITÁVEL — Premium US$300-1.500/mês; Catálogo US$5-30K; Consultoria US$15-100K+; Treino US$3-8K/dia; confirmar/localizar R$). Plano recomendado destacado.
10. **FAQ (objeções + AEO/featured snippets)** — 5-7 perguntas reais respondidas de forma curta e direta (ex: "Funciona offline?", "Instala sozinho?", "Quanto custa?", "Precisa de quê?", "Como difere de usar subagents na mão?"). Espelhe no `FAQPage` schema.
11. **CTA final** — recap do valor + **mesmo CTA primário** "Instalar no Claude Code" + barra diagonal longa + receipt de fechamento + link GitHub.

# CONVERSÃO + MENSURAÇÃO (CRO)

- **Um objetivo primário:** instalar (comando do marketplace). Um único CTA primário, repetido no hero e no fim; secundário = GitHub. Sem CTAs competindo.
- CTA copy = ação + valor: "Instalar no Claude Code" (não "Saiba mais"/"Comece"). Mostre o comando exato em mono com botão copiar (afeição de baixa fricção; sem `fetch`/`localStorage` — copy via `navigator.clipboard` é ok).
- Trust signals perto de cada CTA. Objeções na FAQ. Hierarquia visual clara: o vencedor do ranking e o CTA primário são os pontos mais quentes (brasa).
- **Mensuração:** adicione hooks de tracking nos CTAs e eventos-chave para o GTM/GA4 do site capturar — atributos `data-mv-cta="install"`, `data-mv-cta="github"`, `data-mv-event="copy_command"` (sem disparar nada você mesmo; o container do site lê). Não duplique GTM na página.

# MOTION / INTERAÇÃO (integra, não duplica)

**Herde:** `[data-parallax="0.2"]`, `[data-magnetic]` no CTA, `.counter[data-to]`, `section[id]`+`data-screen-label`. Não reimplemente cursor/header/drone.

**Wow 3D/profundidade (o fan-out) — aditivo e isolado:**
- **Three.js** (cdnjs, no shell) num **canvas isolado de fundo**: campo 3D de muitos pontos (catálogo) em profundidade; ao rolar, 1 ponto-tarefa ramifica e feixes percorrem até alguns que **acendem em brasa**; ondas pulsam ao despachar. Seleção/regência, NÃO conexão social nem fluxo sequencial. **Preto + brasa `#A93636`** somente. Leve (THREE.Points/instancing, não milhares de meshes).
- GSAP ScrollTrigger **opcional** só para pin/scrub do fan-out e do pipeline. Depois do `fx.js`, seletores `.fx-*`, sem tocar `[data-parallax]`/`[data-reveal]`.
- **PROIBIDO Lenis** / segundo smooth-scroll.
- Canvas checa `body[data-motion="off"]` + `prefers-reduced-motion` → fallback estático. Limpa rAF no `pagehide`. Só `transform`/`opacity`; menos pontos no mobile.
- **Reveal (crítico para o preview):** `[data-reveal]` fica ESCONDIDO via `site-base.css` até o `fx.js` revelar — e o `fx.js` pode não rodar no preview do Claude Design. Implemente seu PRÓPRIO reveal inline (IntersectionObserver, conteúdo **visível por padrão**, JS só adiciona o fade). Use `[data-parallax]`/`[data-magnetic]`/`.counter` como enriquecimento; **NÃO** use `[data-reveal]` em conteúdo crítico.

# INOVAÇÃO DE COMPONENTES (≥2 inéditos, on-brand)

(a) o **fan-out de roteamento 3D** reativo ao scroll; (b) o **pipeline de 4 estágios** como instrumento com scores. Terceiro opcional: skill efêmera que solidifica em 5 usos (contador + brilho). Supere as direções.

# RESTRIÇÕES TÉCNICAS

- HTML completo com o shell; `<style>`/`<script>` inline; sem build/backend/`fetch`/`localStorage` (clipboard copy é permitido).
- Libs só de `cdnjs.cloudflare.com` (Three.js r128 incluso). **Nunca Lenis.** (Integração: `integrity`/`crossorigin`.)
- Imagens: alt text descritivo, lazy loading, formato moderno; placeholders comentados.
- Core Web Vitals: LCP < 2.5s (hero leve, sem vídeo pesado bloqueante), CLS < 0.1 (reserve espaço; sem layout shift), INP < 200ms.
- Responsivo mobile-first, sem overflow.

# ACESSIBILIDADE

Semântico, `:focus-visible` ring vermelho, contraste ≥ AA, `prefers-reduced-motion`, alvos ≥ 44px, `aria-*` em componentes interativos, FAQ em `<details>`/`<summary>` ou com `aria-expanded`. Campo decorativo `aria-hidden="true"`.

# PROIBIÇÕES ABSOLUTAS (anti-slop)

Sem Inter/Roboto/system como display. Sem gradiente arco-íris/pastel/roxo. Sem texto em gradiente. Sem glassmorphism default. Sem cantos >20px. Sem grade de cards idênticos. Sem eyebrow tracked em toda seção. Sem `01/02/03` clichê. Sem tudo-centralizado. Sem emoji/hype. **Sem número/depoimento inventado** (só prova social real/verificável; placeholders marcados). Sem logo SVG. Sem barra sem skew -8deg. **Sem segunda cor de acento.** **Sem header/footer/dropdown próprios.** **Sem Lenis.** **Sem virar grafo social ou fluxo sequencial.** **Sem copiar minhas páginas ou as outras landings.**

# AUTO-TESTE ANTES DE ENTREGAR

1. Anti-slop + anti-AI-tell (sem travessão em excesso, sem filler). 2. Não-cópia: fan-out/regência. 3. Tokens: acento só `#A93636`. 4. Voz sem emoji/hype; persuasão por especificidade. 5. ≥2 componentes inéditos. 6. Sem chrome próprio. 7. Motion seguro (Three isolado leve, sem Lenis, reduced-motion fallback, transform/opacity). 8. **SEO:** 1 H1 com keyword, title 50-60, meta 150-160, hierarquia H2/H3, keyword nos 1ºs 100 chars, internal links, alt text, `@graph` com SoftwareApplication+FAQPage+BreadcrumbList. 9. **CRO:** 1 CTA primário claro repetido, value prop em 5s, prova social honesta perto do CTA, FAQ de objeções. 10. **Mensuração:** `data-mv-cta`/`data-mv-event` nos CTAs.

Antes de construir, proponha em 3–4 linhas: direção estética, momento-assinatura, os 2+ componentes inéditos, a técnica-herói E a keyword primária no H1/title/meta. Depois construa a página completa.

=====

## Notas de uso (fora do prompt)
- CTA = instalar via marketplace + GitHub. MIT free + serviços comerciais (confirmar valores).
- Internal links sugeridos: `Downloads.html` (catálogo pai), `GtmSkills.html`/`N8nSkills.html` (relacionados dev), `Home.html`.
- Dropdown Downloads + rota: spec de integração.
- Validar schema no Rich Results Test após integrar.
