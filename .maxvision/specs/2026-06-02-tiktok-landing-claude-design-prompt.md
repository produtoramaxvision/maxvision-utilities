# Prompt Claude Design — Landing MaxVision TikTok

> Cole o bloco entre `=====` no Claude Design com o design system MaxVision (incl. `fx.js`, `chrome.js`, `site-base.css`, `site-chrome.css`) carregado. Conceito-assinatura travado: **RITMO VERTICAL / BPM (9:16 pulsando no beat)**. Integração: `2026-06-02-suite-landings-integration-spec.md`. Preço: EDITÁVEL.

=====

# PAPEL E MANDATO

Você é diretor de arte premiado + engenheiro front-end sênior. Construa o **corpo de uma landing page de produto** (conteúdo de `<main>`) para o site da Produtora MaxVision, production-grade, em **português do Brasil**. Comprometa-se 100% com uma visão cinematográfica distinta; criatividade máxima em composição, movimento e **componentes inéditos** — sem quebrar o sistema visual da marca. Sistema imóvel, criatividade livre dentro dele.

**Não autora header, footer, menu, dropdown nem WhatsApp** — injetados pelo `chrome.js` nos slots `data-mv-*`. Entregue o esqueleto + `<main>` + CSS/JS próprios.

**NÃO COPIE minhas páginas nem as outras landings.** O conceito desta página é RITMO VERTICAL/BPM — não use a forja (media-forge), o grafo (LinkedIn), o stream/radar (X) nem a timeline de retenção (YouTube). Reuse só o vocabulário visual da marca.

# O PRODUTO

**MaxVision TikTok** — automação de TikTok + TikTok Shop nativa do Claude Code. Para criadores: trends de sons e hashtags em tempo real, busca de vídeos, perfil e estatísticas, publicação e agendamento de posts, análise de sons/hashtags, monitoramento de concorrentes. Para vendedores (Shop): produtos, pedidos, fulfillment, devoluções, repasses, links e performance de afiliado. Para agências: multi-tenant com white-label. Backend híbrido OAuth (criador autenticado) + Apify (dados públicos).

**Ângulo central:** "Trend, loja e publicação no mesmo ritmo." Operação de TikTok no compasso da plataforma — vertical, rápido, no beat.

**Conceito criativo central — RITMO VERTICAL.** A página pulsa num BPM: trends, sons e métricas batem no compasso; o conteúdo é enquadrado em 9:16; uma coluna-ritmo desce com o scroll. Movimento no tempo, não no espaço aleatório. Proponha refinamento em 2 linhas se houver algo mais forte.

# PÚBLICO

Criadores solo (descoberta de trend + otimização), vendedores de TikTok Shop (catálogo, pedidos, fulfillment), afiliados (links + performance), agências/MCNs (multi-cliente, white-label).

# SISTEMA VISUAL — HONRE EXATAMENTE (já carregado)

- Canvas **preto verdadeiro** em tudo. **`#A93636` é o ÚNICO acento** — o pulso do beat, CTA, foco, eyebrow, barra. **PROIBIDO o rosa/magenta do TikTok** ou qualquer segunda cor. O ritmo bate em brasa vermelha sobre preto.
- **Bebas Neue** display (MAIÚSCULA + tracking ~0.02em) · **Inter** corpo · **JetBrains Mono** receipts (`OAUTH + APIFY · 9:16 · SHOP`).
- **Barra diagonal** `skewX(-8deg)`, máx 2/tela. Grão + vinheta + scanline em blocos cinema.
- `text-wrap:balance` em h1/h2. Raio ≤ 20px. Hover card: `translateY(-2px)` + borda vermelha + glow. Avatar `maxvision-avatar-hero.png`, logo `maxvision-roda.png`.

# VOZ — RÍGIDA

pt-BR, frases curtas, presente. Sem emoji, sem exclamação, sem hype. Banidas: "incrível", "inovador", "revolucionário", "transformar", "supercharge", "seamless". MAIÚSCULAS só display/eyebrow. Receipts em mono. Tom: operação no compasso, não "viralize fácil".

# ESQUELETO DE SAÍDA (obrigatório)

```html
<!DOCTYPE html>
<html lang="pt-BR" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MaxVision TikTok · Trends, Shop e publicação no Claude Code · Produtora MaxVision</title>
  <meta name="description" content="Trends de som e hashtag, publicação e agendamento, TikTok Shop e afiliados — nativo do Claude Code, OAuth + Apify." />
  <link rel="canonical" href="https://www.produtoramaxvision.com.br/tiktok" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="../colors_and_type.css" />
  <link rel="stylesheet" href="site-base.css" />
  <link rel="stylesheet" href="site-chrome.css" />
  <style> /* CSS da pagina */ </style>
  <script>window.MV_ASSETS='../assets/';window.MV_BASE='';</script>
  <!-- Schema.org: Organization + Product/SoftwareApplication + BreadcrumbList -->
</head>
<body data-page="tiktok" data-theme="dark" data-grain="on" data-motion="on" data-cursor="on" data-density="regular" data-accent="brand" data-mood="cinema">
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

1. **Hero** — headline Bebas pôster (clip-reveal no compasso) + sub + CTA "Conectar ao Claude Code" + receipt mono. Atrás: pulso vertical no BPM (ver Motion). Momento-assinatura. Considere um enquadramento 9:16 como motivo do hero.
2. **A coluna-ritmo** — componente-assinatura: trends de som/hashtag descem numa coluna que pulsa no beat; cada item bate em brasa quando "sobe" em relevância. Mostra descoberta de trend sem texto expositivo.
3. **Do trend ao post** — fluxo: trend detectada → vídeo enquadrado 9:16 → agendamento. Componente que mostra publicação/agendamento no compasso.
4. **TikTok Shop** — bloco distinto para o lado comércio: catálogo, pedidos, fulfillment, afiliados. Mostra que não é só conteúdo — é loja.
5. **O que ela faz** — capacidades: trends de som/hashtag, busca de vídeos, perfil/stats, publicar/agendar, análise de hashtag/som, concorrentes, Shop (produtos/pedidos/fulfillment/devoluções/repasses/afiliados), agência multi-tenant white-label. Composição inesperada.
6. **Para quem é** — criador solo, vendedor Shop, afiliado, agência/MCN.
7. **Preços** — Free / Pro / Shop+ / Agência. (EDITÁVEL — referência: Pro ~US$39, Shop+ ~US$79, Agência ~US$199/mês, trial 7 dias; confirme e localize R$.) Limites de leitura/escrita em 1 frase honesta.
8. **CTA final** — Bebas pôster + barra diagonal longa + receipt de fechamento.

# MOTION / INTERAÇÃO (integra, não duplica)

**Herde:** `[data-reveal]`, `[data-parallax="0.2"]`, `[data-magnetic]`, `.counter[data-to]`, `section[id]`+`data-screen-label`. Não reimplemente cursor/header/drone.

**Wow 3D/profundidade (o ritmo) — aditivo e isolado:**
- **Three.js** (cdnjs, no shell) num **canvas isolado de fundo**: barras/pulsos verticais que batem num BPM constante com **profundidade** (camadas z, parallax no scroll), como um equalizador cinematográfico em brasa sobre preto; o scroll modula a amplitude. Um feixe de varredura vertical (motivo 9:16) percorre. **Preto + brasa `#A93636`** somente — **nada de rosa**.
- GSAP ScrollTrigger **opcional** só para pin/scrub da "coluna-ritmo". Depois do `fx.js`, seletores `.fx-*`, sem tocar `[data-parallax]`/`[data-reveal]`.
- **PROIBIDO Lenis** / segundo smooth-scroll.
- O "beat" deve ter um tempo constante mas **discreto** (não estroboscópico — risco de epilepsia): pulsos suaves, sem flashes rápidos de alto contraste. Canvas checa `body[data-motion="off"]` + `prefers-reduced-motion` → fallback estático (equalizador congelado). Limpa rAF no `pagehide`. Só `transform`/`opacity`; menos barras no mobile. Conteúdo crítico visível por padrão sem fx.js.

# INOVAÇÃO DE COMPONENTES (≥2 inéditos, on-brand)

(a) a **coluna-ritmo 3D no BPM** reativa ao scroll; (b) o **fluxo trend→post 9:16** (enquadramento vertical que agenda). Pode propor um terceiro (ex: painel Shop com pedidos pulsando no beat). Supere as direções.

# RESTRIÇÕES TÉCNICAS

- HTML completo com o shell; `<style>`/`<script>` inline; sem build/backend/`fetch`/`localStorage`.
- Libs só de `cdnjs.cloudflare.com` (Three.js r128 incluso). **Nunca Lenis.** (Integração: `integrity`/`crossorigin`.)
- Vídeos/thumbs 9:16: placeholders (cor sólida/gradiente brand + label), comentados pra trocar.
- Responsivo mobile-first, sem overflow. O motivo 9:16 deve funcionar bem no próprio mobile.

# ACESSIBILIDADE

Semântico, `:focus-visible` ring vermelho, contraste ≥ AA, `prefers-reduced-motion`, alvos ≥ 44px, `aria-*` em componentes interativos e counters. Equalizador decorativo `aria-hidden="true"`. **Sem flashes rápidos** (segurança fotossensível).

# PROIBIÇÕES ABSOLUTAS (anti-slop)

Sem Inter/Roboto/system como display. Sem gradiente arco-íris/pastel/roxo. Sem texto em gradiente. Sem glassmorphism default. Sem cantos >20px. Sem grade de cards idênticos. Sem eyebrow tracked em toda seção. Sem `01/02/03` clichê. Sem tudo-centralizado. Sem emoji/hype. Sem logo SVG. Sem barra sem skew -8deg. **Sem rosa/magenta do TikTok nem segunda cor.** **Sem header/footer/dropdown próprios.** **Sem Lenis.** **Sem flashes estroboscópicos.** **Sem copiar minhas páginas ou as outras landings.**

# AUTO-TESTE ANTES DE ENTREGAR

1. Anti-slop. 2. Não-cópia: conceito é ritmo/BPM, não forja/grafo/stream/timeline. 3. Tokens: acento só `#A93636`, zero rosa. 4. Voz sem emoji/hype. 5. ≥2 componentes inéditos. 6. Sem chrome próprio. 7. Motion: Three.js isolado, sem Lenis, sem flashes, honra `data-motion=off`+reduced-motion com fallback, só transform/opacity. 8. Esqueleto exato.

Antes de construir, proponha em 3–4 linhas: direção estética, momento-assinatura, os 2+ componentes inéditos e a técnica-herói. Depois construa a página completa.

=====

## Notas de uso (fora do prompt)
- Preço: confirmar valores/moeda antes de publicar.
- Dropdown Downloads: global no `chrome.js`.
- Integração: `2026-06-02-suite-landings-integration-spec.md`.
