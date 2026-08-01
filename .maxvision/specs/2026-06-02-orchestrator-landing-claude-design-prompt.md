# Prompt Claude Design — Landing MaxVision Orchestrator

> Cole o bloco entre `=====` no Claude Design com o design system MaxVision (incl. `fx.js`, `chrome.js`, `site-base.css`, `site-chrome.css`) carregado. Conceito-assinatura travado: **FAN-OUT DE ROTEAMENTO / REGÊNCIA (1 tarefa → muitos agentes; ranking acende; ondas paralelas)**. Integração: `2026-06-02-suite-landings-integration-spec.md`. Licença: MIT (free) + serviços comerciais (EDITÁVEL).

=====

# PAPEL E MANDATO

Você é diretor de arte premiado + engenheiro front-end sênior. Construa o **corpo de uma landing page de produto** (conteúdo de `<main>`) para o site da Produtora MaxVision, production-grade, em **português do Brasil**. Comprometa-se 100% com uma visão cinematográfica distinta; criatividade máxima em composição, movimento e **componentes inéditos** — sem quebrar o sistema visual da marca. Sistema imóvel, criatividade livre dentro dele.

**Não autora header, footer, menu, dropdown nem WhatsApp** — injetados pelo `chrome.js` nos slots `data-mv-*`. Entregue o esqueleto + `<main>` + CSS/JS próprios.

**NÃO COPIE minhas páginas nem as outras landings.** O conceito é FAN-OUT DE ROTEAMENTO / REGÊNCIA (1 tarefa se ramifica e é roteada para os melhores agentes; candidatos acendem num ranking; ondas executam em paralelo). Diferencie do canvas direcional do n8n (lá é 1 fluxo sequencial; aqui é 1→muitos, seleção/ranking, dispatch paralelo) e do grafo social do LinkedIn (aqui não é conexão social — é seleção/regência) e dos demais (forja, stream, ritmo, timeline, gatilho/disparo). Reuse só o vocabulário visual da marca.

# O PRODUTO

**MaxVision Orchestrator** (plugin Claude Code, MIT) — roteia uma tarefa complexa para o(s) melhor(es) subagente(s) e skills entre **500+ agentes e 4.000+ skills** indexados em catálogo FTS5, sem o overhead de descrições acumuladas em cada sessão. Pipeline de roteamento em 4 estágios: extração de keywords (Haiku, cache) → BM25 sobre FTS5 → cap por fonte → juiz Sonnet (ranking + classificação de complexidade). Faz multi-task split, version-check de integridade upstream, síntese de skills complementares, dispatch paralelo (3-4, isolado em worktree) e ciclo de skills efêmeras (auto-promove em 5 usos, limpa no fim da sessão). Provisionamento sempre com **aprovação humana** (nunca instala em silêncio).

**Ângulo central:** "Uma tarefa. O agente certo, na hora certa. Sem overhead." Camada de inteligência que ouve a tarefa, entende, seleciona e rege.

**Conceito criativo central — REGÊNCIA / FAN-OUT.** Uma tarefa entra; ramifica (multi-task); cada ramo passa pelo pipeline (keyword → BM25 → juiz); candidatos **acendem num ranking** (o vencedor em brasa); o maestro dispara ondas paralelas de agentes; skills efêmeras brilham translúcidas e solidificam ao serem reusadas. O scroll é a regência. Proponha refinamento em 2 linhas se houver algo mais forte.

# PÚBLICO

Power users de Claude Code, times enterprise migrando em escala, times com CI/CD, indústrias reguladas (catálogos proprietários + trilha de auditoria), autores de skills/plugins, organizações escalando workflows de IA. Devs técnicos.

# SISTEMA VISUAL — HONRE EXATAMENTE (já carregado)

- Canvas **preto verdadeiro** em tudo. **`#A93636` é o ÚNICO acento** — o agente selecionado/ranking vencedor, CTA, foco, eyebrow, barra. Agentes não-selecionados ficam em neutro (cinza), o escolhido acende em brasa. **Zero segunda cor.**
- **Bebas Neue** display (MAIÚSCULA + tracking ~0.02em) · **Inter** corpo · **JetBrains Mono** receipts (`FTS5 · BM25 · 500+ AGENTS · 4000+ SKILLS`). Mono encaixa em roteamento/ranking/scores — use com intenção.
- **Barra diagonal** `skewX(-8deg)`, máx 2/tela. Grão + vinheta + scanline em blocos cinema.
- `text-wrap:balance` em h1/h2. Raio ≤ 20px. Hover card: `translateY(-2px)` + borda vermelha + glow. Avatar `maxvision-avatar-hero.png` (pode encarnar o "maestro"), logo `maxvision-roda.png`.

# VOZ — RÍGIDA

pt-BR, frases curtas, presente. Sem emoji, sem exclamação, sem hype. Banidas: "incrível", "inovador", "revolucionário", "transformar", "supercharge", "seamless". MAIÚSCULAS só display/eyebrow. Receipts em mono. Tom: infraestrutura de orquestração séria, com guardrails — não "IA mágica".

# ESQUELETO DE SAÍDA (obrigatório)

```html
<!DOCTYPE html>
<html lang="pt-BR" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MaxVision Orchestrator · Roteamento de skills e subagents no Claude Code · Produtora MaxVision</title>
  <meta name="description" content="Roteia 1 tarefa para 500+ agentes e 4.000+ skills via FTS5/BM25 + juiz Sonnet. Multi-task, version-check, síntese, dispatch paralelo. MIT." />
  <link rel="canonical" href="https://www.produtoramaxvision.com.br/orchestrator" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="../colors_and_type.css" />
  <link rel="stylesheet" href="site-base.css" />
  <link rel="stylesheet" href="site-chrome.css" />
  <style> /* CSS da pagina */ </style>
  <script>window.MV_ASSETS='../assets/';window.MV_BASE='';</script>
  <!-- Schema.org: Organization + SoftwareApplication (Orchestrator) + BreadcrumbList -->
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

# ESTRUTURA DO `<main>` (ordem; interior é seu — inove)

Cada `<section>` com `id` + `data-screen-label`.

1. **Hero** — headline Bebas pôster (clip-reveal) + sub + CTA "Instalar no Claude Code" (comando `/plugin install` em receipt mono) + CTA secundário GitHub. Atrás: o campo de 500 agentes com 1 tarefa ramificando (ver Motion). Momento-assinatura.
2. **O fan-out** — componente-assinatura: 1 tarefa entra, ramifica (multi-task), cada ramo roteia; candidatos acendem; o vencedor em brasa é despachado; ondas paralelas executam e reconvergem. Sem texto expositivo.
3. **Pipeline de 4 estágios** — keyword (Haiku) → BM25 (FTS5) → cap por fonte → juiz Sonnet (ranking). Mostrado como instrumento de roteamento, não lista. Receipts mono com scores.
4. **O que faz** — capacidades: multi-task split, version-check upstream, síntese de skills, dispatch paralelo isolado, ciclo efêmero (auto-promove em 5 usos), aprovação humana (sim/all/skip-N/none). Composição inesperada.
5. **Escala** — números reais em counters: 500+ agentes, 4.000+ skills, roteamento ~1-2s, max 3-4 paralelos. Sem overhead de 15k tokens por sessão.
6. **Guardrails** — diferencial sério: nada instala em silêncio (aprovação humana), version integrity por sidecar, sem fallback genérico, sem deletar arquivos do usuário. Confiança.
7. **Open-source + serviços** — MIT gratuito; depois, tiers comerciais opcionais (suporte premium, catálogo customizado, consultoria, treinamento). (Valores EDITÁVEIS — referência: Premium US$300-1.500/mês; Catálogo US$5-30K; Consultoria US$15-100K+; Treinamento US$3-8K/dia. Confirme/localize antes de publicar.)
8. **CTA final** — Bebas pôster + barra diagonal longa + receipt de fechamento + link GitHub.

# MOTION / INTERAÇÃO (integra, não duplica)

**Herde:** `[data-parallax="0.2"]`, `[data-magnetic]` no CTA, `.counter[data-to]` (perfeito para os números de escala), `section[id]`+`data-screen-label`. Não reimplemente cursor/header/drone.

**Wow 3D/profundidade (o fan-out) — aditivo e isolado:**
- **Three.js** (cdnjs, no shell) num **canvas isolado de fundo**: um campo 3D de muitos pontos (o catálogo de agentes/skills) em **profundidade**; ao rolar, 1 ponto-tarefa ramifica e "feixes" de roteamento percorrem até alguns pontos que **acendem em brasa** (selecionados), enquanto a maioria fica neutra; ondas pulsam ao despachar. Seleção/regência, NÃO conexão social nem fluxo sequencial. **Preto + brasa `#A93636`** somente.
- GSAP ScrollTrigger **opcional** só para o pin/scrub do "fan-out" e do pipeline de 4 estágios. Depois do `fx.js`, seletores `.fx-*`, sem tocar `[data-parallax]`/`[data-reveal]`.
- **PROIBIDO Lenis** / segundo smooth-scroll.
- Canvas checa `body[data-motion="off"]` + `prefers-reduced-motion` → fallback estático (campo parado, vencedores destacados). Limpa rAF no `pagehide`. Só `transform`/`opacity`; menos pontos no mobile.
- **Reveal (crítico para o preview):** `[data-reveal]` fica ESCONDIDO via `site-base.css` até o `fx.js` revelar — e o `fx.js` pode não rodar no preview do Claude Design (seções em branco). Implemente seu PRÓPRIO reveal inline (IntersectionObserver, conteúdo **visível por padrão**, JS só adiciona o fade). Use `[data-parallax]`/`[data-magnetic]`/`.counter` como enriquecimento; **NÃO** use `[data-reveal]` em conteúdo crítico. Conteúdo sempre visível por padrão sem fx.js.

# INOVAÇÃO DE COMPONENTES (≥2 inéditos, on-brand)

(a) o **fan-out de roteamento 3D** (tarefa→ramos→candidatos acendendo→ondas) reativo ao scroll; (b) o **pipeline de 4 estágios** como instrumento (keyword→BM25→cap→juiz com scores em mono). Pode propor um terceiro (ex: skill efêmera que solidifica ao chegar em 5 usos — contador + brilho). Supere as direções.

# RESTRIÇÕES TÉCNICAS

- HTML completo com o shell; `<style>`/`<script>` inline; sem build/backend/`fetch`/`localStorage`.
- Libs só de `cdnjs.cloudflare.com` (Three.js r128 incluso). **Nunca Lenis.** (Integração: `integrity`/`crossorigin`.)
- Scores/comandos/rankings: texto real plausível em mono; sem segredos.
- Performance: o campo de muitos pontos deve ser leve (instancing/THREE.Points, não milhares de meshes); reduzir no mobile.
- Responsivo mobile-first, sem overflow.

# ACESSIBILIDADE

Semântico, `:focus-visible` ring vermelho, contraste ≥ AA, `prefers-reduced-motion`, alvos ≥ 44px, `aria-*` em componentes interativos e counters. Campo decorativo `aria-hidden="true"`.

# PROIBIÇÕES ABSOLUTAS (anti-slop)

Sem Inter/Roboto/system como display. Sem gradiente arco-íris/pastel/roxo. Sem texto em gradiente. Sem glassmorphism default. Sem cantos >20px. Sem grade de cards idênticos. Sem eyebrow tracked em toda seção. Sem `01/02/03` clichê. Sem tudo-centralizado. Sem emoji/hype. Sem logo SVG. Sem barra sem skew -8deg. **Sem segunda cor de acento.** **Sem header/footer/dropdown próprios.** **Sem Lenis.** **Sem virar grafo social (LinkedIn) nem fluxo sequencial (n8n) — é fan-out/seleção/regência.** **Sem copiar minhas páginas ou as outras landings.**

# AUTO-TESTE ANTES DE ENTREGAR

1. Anti-slop. 2. Não-cópia: conceito é fan-out/regência, não forja/grafo-social/stream/ritmo/timeline/gatilho/canvas-n8n. 3. Tokens: acento só `#A93636`. 4. Voz sem emoji/hype. 5. ≥2 componentes inéditos. 6. Sem chrome próprio. 7. Motion: Three.js isolado e leve, sem Lenis, honra `data-motion=off`+reduced-motion com fallback, só transform/opacity. 8. Esqueleto exato.

Antes de construir, proponha em 3–4 linhas: direção estética, momento-assinatura, os 2+ componentes inéditos e a técnica-herói. Depois construa a página completa.

=====

## Notas de uso (fora do prompt)
- CTA primário = instalar via marketplace + GitHub (não WhatsApp). MIT free + serviços comerciais (confirmar valores).
- Dropdown Downloads: global no `chrome.js` (adicionar item `orchestrator` → `Orchestrator.html`).
- Integração: `2026-06-02-suite-landings-integration-spec.md`.
