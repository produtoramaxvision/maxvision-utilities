# Prompt Claude Design — Landing media-forge (v3)

> Revisa o v2. Mudanças: (1) REMOVE o header/dropdown próprios — a página agora gera só o `<main>` e herda header/footer/whatsapp do `chrome.js` compartilhado; o dropdown Downloads é mudança global no `chrome.js` (ver `2026-06-02-suite-landings-integration-spec.md`, seção 2). (2) Motion corrigido: herda os hooks do `fx.js` (vanilla) + Three.js isolado para o 3D; sem Lenis. (3) Preço mantido (Criador R$37,90/mês). Cole o bloco entre `=====` no Claude Design com o design system MaxVision (incl. `fx.js`, `chrome.js`, `site-base.css`, `site-chrome.css`) carregado no projeto.

=====

# PAPEL E MANDATO

Você é diretor de arte premiado + engenheiro front-end sênior. Construa o **corpo de uma landing page de produto** (o conteúdo de `<main>`) para o site da Produtora MaxVision, production-grade, em **português do Brasil**. Trabalho extraordinário: comprometa-se 100% com uma visão cinematográfica distinta. Criatividade máxima na composição, no movimento, na narrativa de scroll e em **componentes inéditos** — nunca em quebrar o sistema visual da marca. Sistema imóvel, criatividade livre dentro dele.

**Esta página NÃO autora header, footer, menu, dropdown nem botão de WhatsApp.** Tudo isso é injetado pelo `chrome.js` compartilhado do site nos slots `data-mv-*`. Você entrega o esqueleto MaxVision (abaixo) + o conteúdo de `<main>` + o CSS/JS próprios da página.

**NÃO COPIE minhas páginas existentes** (Home, Sobre, Labs, Drones FPV, IA, Audiovisual) nem as outras landings da suíte. Reuse só o vocabulário visual da marca (tokens, fontes, barra diagonal, texturas, avatar, hooks de motion); invente o resto. Esta é uma página de PRODUTO com linguagem própria.

# O PRODUTO

**media-forge** — geração de imagem e vídeo com IA de ponta (Google Veo 3.1 Pro, Imagen 4 Ultra, Nano Banana Pro; mais Kling, Higgsfield, Seedance), operada por linguagem natural dentro do Claude Code. Materialização da vertical **MaxVision Labs**. O criador descreve; a forja entrega mídia pronta. Multi-modelo: um pedido, vários motores. Roteamento inteligente + revisão de qualidade automática (validação de texto via OCR, conformidade de marca por cor/logo, juiz LLM) + controle de custo transparente (estimativa antes, dry-run, teto diário). Hospedado: o criador não instala nada pesado, não gerencia chave de API.

**Conceito criativo central — A FORJA.** Prompt entra como minério bruto; sai mídia forjada. Calor, pressão, precisão de estúdio. O vermelho da marca é a brasa. Se enxergar conceito mais forte que respeite o sistema, proponha em 2 linhas antes de construir.

# PÚBLICO

Criadores e produtoras de conteúdo brasileiros. Querem vídeo/imagem de qualidade de produtora, rápido, sem virar engenheiro de IA. Cena típica: madrugada, entrega amanhã, precisa de 8 variações de um take agora.

# SISTEMA VISUAL — HONRE EXATAMENTE (já carregado no projeto)

- Canvas **preto verdadeiro** (`--bg`, hsl 0 0% 0%) em tudo.
- **`#A93636` (`--brand`) é o ÚNICO acento estrutural** — CTA, link, foco, eyebrow, barra, brasa. **Zero segunda cor de destaque.**
- **Bebas Neue** display (SEMPRE MAIÚSCULA + tracking ~0.02em) · **Inter** UI/corpo · **JetBrains Mono** "receipts" (`4K · VEO 3.1 · SP`).
- **Barra diagonal** `skewX(-8deg)` sob títulos/eyebrows — a inclinação é a assinatura. Eyebrow = barra vermelha + texto mono MAIÚSCULO. Máx 2 barras por tela.
- Texturas **grão + vinheta + scanline** sobre blocos hero/cinema.
- `text-wrap:balance` em h1/h2. Imagery **full-bleed**. Raio de card **nunca > 20px**.
- Hover de card: `translateY(-2px)` + borda vermelha translúcida + glow leve.
- Use o **avatar** vinyl-toy cabeça-obturador (placeholder `maxvision-avatar-hero.png`) e o logo `maxvision-roda.png` onde fizer sentido.
- Se um token não estiver acessível, use os valores canônicos da marca — nunca substitutos genéricos.

# VOZ (copy) — RÍGIDA

Português do Brasil. Frases curtas, presente. **Sem emoji. Sem exclamação. Sem hype.** Proibidas: "incrível", "inovador", "revolucionário", "transformar", "supercharge", "seamless". MAIÚSCULAS só em display/eyebrow. Receipts em mono MAIÚSCULO. Tom: estúdio que entrega, não startup que promete.

# ESQUELETO DE SAÍDA (obrigatório — espelhe exatamente)

Entregue um HTML completo com este shell. Autore SÓ o interior de `<main>` + `<style>`/`<script>` da página.

```html
<!DOCTYPE html>
<html lang="pt-BR" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Media Forge · Geração de imagem e vídeo com IA · Produtora MaxVision</title>
  <meta name="description" content="Geração de imagem e vídeo com IA de ponta operada por linguagem natural no Claude Code. Veo 3.1, Imagen 4 Ultra, Nano Banana Pro." />
  <link rel="canonical" href="https://www.produtoramaxvision.com.br/media-forge" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="../colors_and_type.css" />
  <link rel="stylesheet" href="site-base.css" />
  <link rel="stylesheet" href="site-chrome.css" />
  <style> /* CSS da pagina aqui */ </style>
  <script>window.MV_ASSETS='../assets/';window.MV_BASE='';</script>
  <!-- Schema.org: Organization + Product (media-forge) + BreadcrumbList -->
</head>
<body data-page="mediaforge" data-theme="dark" data-grain="on" data-motion="on" data-cursor="on" data-density="regular" data-accent="brand" data-mood="cinema">
  <div data-mv-header></div>
  <main id="main">
    <!-- TODO O SEU CONTEUDO AQUI -->
  </main>
  <div data-mv-footer></div>
  <div data-mv-whatsapp></div>
  <div data-mv-tweaks-mount></div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
  <!-- opcional: GSAP/ScrollTrigger de cdnjs, carregado DEPOIS do fx.js -->
  <script src="fx.js"></script>
  <script src="chrome.js"></script>
  <script src="tweaks.js"></script>
  <script> /* JS da pagina aqui (IIFE) */ </script>
</body>
</html>
```

# ESTRUTURA DO `<main>` (ordem; interior é seu — inove)

Cada `<section>` com `id` e `data-screen-label` (alimenta o rail lateral automático).

1. **Hero** — vídeo FPV full-bleed (`<video autoplay muted loop playsinline>` com `src` PLACEHOLDER + `poster`) + grão/vinheta/scanline + headline Bebas escala pôster (clip-reveal escalonado) + sub curta + CTA "Entrar na forja" + receipt mono. **Momento-assinatura aqui.** Atrás de tudo, a forja em brasa (ver Motion).
2. **A forja** — o conceito prompt→mídia mostrado com MOVIMENTO/componente inédito, não texto. Texto digitado vira minério, esquenta (brasa), vira blocos de mídia forjados.
3. **Um pedido, vários motores** — componente-assinatura interativo, sticky/pinned enquanto os motores trocam: o MESMO prompt vira imagem E vídeo nos vários modelos (Veo / Imagen / Nano / Kling / Higgsfield / Seedance), cada um com receipt de custo/tempo/qualidade em mono. Algo que eu não tenho em nenhuma página.
4. **Showcase** — gerações reais (placeholders 9:16 e 16:9), composição não-grade-genérica.
5. **O que ela faz** — capacidades (roteamento inteligente, revisão de qualidade 3 estágios, controle de custo com receipts mono, geração assíncrona). Composição inesperada, não cards iguais enfileirados.
6. **Preços** — Free / **Criador R$37,90/mês** / Pro / Agência (self-host). Créditos em 1 frase ("você gasta o que gerar; vê o custo antes de cada job"). Destaque o Criador. (Preço travado no spec de infoproduto.)
7. **MaxVision Labs** — credibilidade: a casa, o avatar (drop-shadow cinematográfico), stack real em terminal mono. Sem vaporware.
8. **CTA final** — Bebas pôster + barra diagonal longa + receipt de fechamento.

# MOTION / INTERAÇÃO (integra com o site, não duplica)

**Herde os hooks do site (fx.js já existe):** use `[data-reveal]` (fade-up on-scroll), `[data-parallax="0.2"]` (parallax de fundo), `[data-magnetic]` no CTA, `.counter[data-to]` em stats, e `section[id]` + `data-screen-label` para o rail. NÃO reimplemente cursor, header-shrink nem drone — são globais.

**O wow 3D/profundidade (a forja) — aditivo e isolado:**
- Use **Three.js** (já no shell, de cdnjs) num **canvas de fundo isolado**: um campo de brasas/faíscas + heat-haze atrás do hero e da seção "A forja", reagindo ao scroll (profundidade por camadas, partículas que sobem como de uma fornalha). **Monocromático: preto + brasa `#A93636`.** Nada de segunda cor.
- GSAP + ScrollTrigger (cdnjs) **opcional**, só para o pin/scrub do componente "vários motores". Se usar: carregue **depois** do `fx.js`, escope em seletores `.fx-*` dedicados, **não toque** em `[data-parallax]`/`[data-reveal]`.
- **PROIBIDO Lenis** e qualquer smooth-scroll novo (já há `scroll-behavior:smooth` global).
- O canvas custom **deve checar** `document.body.dataset.motion === 'off'` e `matchMedia('(prefers-reduced-motion: reduce)').matches` → quando qualquer um for verdadeiro, **não anime**: mostre um fallback estático (poster/gradiente brasa). Limpe rAF/ScrollTrigger no `pagehide`.
- Anime só `transform`/`opacity`; `will-change` nos elementos animados; reduza partículas no mobile.
- A página deve animar seu conteúdo crítico por conta própria (inline) e ficar **visível por padrão** mesmo se o fx.js não rodar (preview do Claude Design).

# INOVAÇÃO DE COMPONENTES (≥2 inéditos, on-brand)

Pelo menos **2 componentes que eu ainda não tenho**, inventados pra este produto. Direções (supere, não copie): o "forjador" (texto digitado vira blocos de mídia com brasa); o seletor de motores com custo/tempo/qualidade em tempo real; uma timeline "minério → forja → master"; um comparador antes/depois cinematográfico. Proponha os seus.

# RESTRIÇÕES TÉCNICAS

- HTML completo com o shell acima. `<style>`/`<script>` da página inline. Sem build, sem backend, sem `fetch`/`localStorage`.
- Libs só de `cdnjs.cloudflare.com` (Three.js r128 já incluso; nomeie outras que usar). Nunca Lenis.
- Vídeo: `<video autoplay muted loop playsinline>` com `src` PLACEHOLDER + `poster`. Nunca som inicial.
- Showcase/thumbs: placeholders (gradiente brand-aware ou cor sólida + label), `src`/`data-` comentado pra eu trocar.
- Responsivo mobile-first, sem overflow de texto em nenhum breakpoint.

# ACESSIBILIDADE

HTML semântico, `:focus-visible` ring vermelho, contraste ≥ AA, `prefers-reduced-motion`, alvos ≥ 44px, `aria-*` em componentes interativos e counters.

# PROIBIÇÕES ABSOLUTAS (anti-slop)

Sem Inter/Roboto/Arial/system como **display** (hero é Bebas). Sem gradiente arco-íris/pastel/roxo. Sem texto em gradiente. Sem glassmorphism por default. Sem cantos >20px em card. Sem grade de cards idênticos ícone-título-texto. Sem eyebrow tracked em TODA seção. Sem scaffolding `01/02/03` clichê. Sem layout tudo-centralizado genérico. Sem emoji. Sem palavras de hype banidas. Sem desenhar logo em SVG (placeholder de imagem). Sem barra diagonal sem o skew -8deg. **Sem segunda cor de acento.** **Sem header/footer/dropdown próprios.** **Sem Lenis.** **Sem replicar minhas páginas.**

# AUTO-TESTE ANTES DE ENTREGAR

1. **Anti-slop:** se der pra dizer "uma IA fez isso", refaça mais ousado.
2. **Não-cópia:** nenhuma seção/componente replica minhas páginas ou as outras landings da suíte.
3. **Tokens honrados:** nada de cor/fonte/raio fora do sistema; acento só `#A93636`.
4. **Voz:** zero emoji, zero hype, zero exclamação; pt-BR presente.
5. **Componentes novos:** ≥2 inéditos e on-brand.
6. **Sem chrome próprio:** header/footer/whatsapp são só slots `data-mv-*`.
7. **Motion seguro:** Three.js isolado; sem Lenis; honra `data-motion="off"` + reduced-motion com fallback estático; só transform/opacity.
8. **Esqueleto:** shell exato, includes corretos, `<main>` é o único conteúdo autorado.

Antes de construir, proponha em 3–4 linhas: direção estética, o momento-assinatura, os 2 componentes inéditos e a técnica-herói de movimento. Depois construa a página completa.

=====

## Notas de uso (fora do prompt)
- **Assets:** trocar placeholders na integração (`maxvision-intro-fpv-16x9.mp4`, `maxvision-avatar-hero.png`, `maxvision-roda.png`, gerações reais).
- **Dropdown Downloads:** já entra global no `chrome.js` (spec de integração, seção 2) — não é responsabilidade desta página.
- **Preço:** R$37,90 travado no spec de infoproduto; sincronizar se mudar lá.
- **Integração:** seguir `2026-06-02-suite-landings-integration-spec.md`.
