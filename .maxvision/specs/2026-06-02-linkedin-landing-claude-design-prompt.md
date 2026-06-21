# Prompt Claude Design — Landing MaxVision LinkedIn

> Cole o bloco entre `=====` no Claude Design com o design system MaxVision (incl. `fx.js`, `chrome.js`, `site-base.css`, `site-chrome.css`) carregado. Conceito-assinatura travado: **GRAFO DE REDE tecido pelo scroll + resume antes/depois**. Integração: ver `2026-06-02-suite-landings-integration-spec.md`. Preço: EDITÁVEL (confirmar antes de publicar).

=====

# PAPEL E MANDATO

Você é diretor de arte premiado + engenheiro front-end sênior. Construa o **corpo de uma landing page de produto** (conteúdo de `<main>`) para o site da Produtora MaxVision, production-grade, em **português do Brasil**. Comprometa-se 100% com uma visão cinematográfica distinta; criatividade máxima na composição, no movimento e em **componentes inéditos** — nunca quebrando o sistema visual da marca. Sistema imóvel, criatividade livre dentro dele.

**Esta página NÃO autora header, footer, menu, dropdown nem WhatsApp** — tudo injetado pelo `chrome.js` nos slots `data-mv-*`. Você entrega o esqueleto MaxVision + o `<main>` + CSS/JS próprios.

**NÃO COPIE minhas páginas** (Home, Sobre, Labs, Drones FPV, IA, Audiovisual) **nem as outras landings da suíte** (media-forge, X, TikTok, YouTube). Em especial: o conceito desta página é GRAFO DE REDE — não use a "forja" do media-forge, nem stream/feed do X, nem ritmo do TikTok, nem timeline do YouTube. Reuse só o vocabulário visual da marca.

# O PRODUTO

**MaxVision LinkedIn** — o assistente de LinkedIn nativo do Claude Code. Busca vagas em vários boards (LinkedIn, Indeed, Glassdoor, ZipRecruiter), faz tailoring de currículo por descrição de vaga, audita e otimiza o perfil, candidata-se com Easy Apply, e faz outreach por mensagem **sempre com aprovação humana**. Usa sua própria conta, com automação humanizada anti-detecção. Não é bot de spam em massa: você controla, aprova cada ação.

**Posicionamento / ângulo de confiança:** "Sua conta. Sua aprovação. Seu ritmo." Carreira e relacionamento profissional operados com precisão, sem terceirizar para um robô que age sozinho.

**Conceito criativo central — REDE QUE SE TECE.** Conexões profissionais como uma constelação que se forma conforme você rola: nós (pessoas, vagas, mensagens) ligados por arestas em brasa. O scroll tece a rede. Segundo momento: um comparador cinematográfico **currículo antes → depois** do tailoring. Proponha refinamento em 2 linhas se enxergar algo mais forte.

# PÚBLICO

Quatro perfis: dev/eng buscando vaga (inclusive remota internacional); founder/creator usando LinkedIn como canal de crescimento; recrutador/headhunter (Sales Navigator, outreach em escala com aprovação); agência de carreira multi-cliente.

# SISTEMA VISUAL — HONRE EXATAMENTE (já carregado no projeto)

- Canvas **preto verdadeiro** (`--bg`, hsl 0 0% 0%) em tudo.
- **`#A93636` (`--brand`) é o ÚNICO acento** — CTA, link, foco, eyebrow, barra, arestas do grafo. **PROIBIDO o azul do LinkedIn** ou qualquer segunda cor. A rede é preta com brasa vermelha.
- **Bebas Neue** display (MAIÚSCULA + tracking ~0.02em) · **Inter** UI/corpo · **JetBrains Mono** receipts (`MULTI-BOARD · APROVAÇÃO HUMANA`).
- **Barra diagonal** `skewX(-8deg)` sob títulos/eyebrows. Máx 2 por tela. Texturas grão + vinheta + scanline em blocos cinema.
- `text-wrap:balance` em h1/h2. Raio de card **nunca > 20px**. Hover de card: `translateY(-2px)` + borda vermelha translúcida + glow.
- Avatar cabeça-obturador (`maxvision-avatar-hero.png`) e logo `maxvision-roda.png` onde fizer sentido.

# VOZ (copy) — RÍGIDA

Português do Brasil, frases curtas, presente. **Sem emoji, sem exclamação, sem hype.** Proibidas: "incrível", "inovador", "revolucionário", "transformar", "supercharge", "seamless". MAIÚSCULAS só em display/eyebrow. Receipts em mono. Tom: ferramenta de precisão para profissional sério, não growth-hack mágico.

# ESQUELETO DE SAÍDA (obrigatório)

Entregue HTML completo com este shell; autore SÓ o interior de `<main>` + `<style>`/`<script>` da página.

```html
<!DOCTYPE html>
<html lang="pt-BR" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MaxVision LinkedIn · Assistente de carreira no Claude Code · Produtora MaxVision</title>
  <meta name="description" content="Busca de vagas multi-board, tailoring de currículo, auditoria de perfil e outreach com aprovação humana — nativo do Claude Code." />
  <link rel="canonical" href="https://www.produtoramaxvision.com.br/linkedin" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="../colors_and_type.css" />
  <link rel="stylesheet" href="site-base.css" />
  <link rel="stylesheet" href="site-chrome.css" />
  <style> /* CSS da pagina */ </style>
  <script>window.MV_ASSETS='../assets/';window.MV_BASE='';</script>
  <!-- Schema.org: Organization + Product/SoftwareApplication + BreadcrumbList -->
</head>
<body data-page="linkedin" data-theme="dark" data-grain="on" data-motion="on" data-cursor="on" data-density="regular" data-accent="brand" data-mood="cinema">
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

Cada `<section>` com `id` + `data-screen-label` (alimenta o rail).

1. **Hero** — headline Bebas pôster (clip-reveal) + sub curta + CTA "Conectar ao Claude Code" + receipt mono. Atrás: o grafo de rede em brasa começa esparso e vai adensando (ver Motion). Momento-assinatura.
2. **A rede que se tece** — o componente-assinatura: conforme rola, nós (vaga, perfil, mensagem) surgem e se ligam por arestas vermelhas; explica multi-board + descoberta de pessoas sem texto expositivo.
3. **Currículo antes → depois** — comparador cinematográfico do tailoring: o mesmo currículo reescrito para uma vaga específica, com os pontos que mudaram acendendo em brasa. Segundo componente inédito.
4. **O que ela faz** — capacidades: busca multi-board, Easy Apply com tailoring, auditoria/otimização de perfil, outreach com aprovação humana, anti-detecção humanizada, Sales Navigator (tier superior). Composição inesperada, não cards iguais.
5. **Confiança e controle** — bloco dedicado: sua conta, aprovação obrigatória em cada ação, ritmo humano. Diferencia de bots de spam.
6. **Para quem é** — os 4 perfis (job-seeker, founder/creator, recrutador, agência) em recortes distintos.
7. **Preços** — Free (self-host, conta única) / Pro / Agência. (Valores EDITÁVEIS — referência atual: Pro ~US$29/mês, Agência ~US$99/mês; confirme/locale em R$ antes de publicar.) Créditos/limites em 1 frase honesta.
8. **CTA final** — Bebas pôster + barra diagonal longa + receipt de fechamento.

# MOTION / INTERAÇÃO (integra, não duplica)

**Herde os hooks do site:** `[data-reveal]`, `[data-parallax="0.2"]`, `[data-magnetic]` no CTA, `.counter[data-to]` em métricas, `section[id]`+`data-screen-label` no rail. NÃO reimplemente cursor, header-shrink, drone.

**Wow 3D/profundidade (o grafo) — aditivo e isolado:**
- Use **Three.js** (cdnjs, no shell) num **canvas isolado de fundo**: uma constelação 3D de nós (pontos) ligados por arestas finas em brasa, com **profundidade real** (nós em camadas z diferentes, parallax ao rolar, leve rotação/drift). O scroll adensa a rede (mais arestas acendem conforme desce). **Monocromático: preto + brasa `#A93636`.**
- GSAP ScrollTrigger **opcional** só para o pin/scrub do comparador de currículo. Se usar: depois do `fx.js`, seletores `.fx-*`, sem tocar `[data-parallax]`/`[data-reveal]`.
- **PROIBIDO Lenis** / segundo smooth-scroll.
- O canvas checa `body[data-motion="off"]` e `prefers-reduced-motion` → fallback estático (constelação congelada como imagem/gradiente). Limpe rAF/observers no `pagehide`. Só `transform`/`opacity`; menos nós no mobile.
- Conteúdo crítico visível por padrão mesmo sem fx.js (preview).

# INOVAÇÃO DE COMPONENTES (≥2 inéditos, on-brand)

Mínimo 2 que eu não tenho: (a) o **grafo-rede 3D reativo ao scroll**; (b) o **comparador currículo antes/depois** cinematográfico com diffs em brasa. Pode propor um terceiro (ex: um "radar de vagas" multi-board pulsando). Supere as direções, não copie.

# RESTRIÇÕES TÉCNICAS

- HTML completo com o shell. `<style>`/`<script>` inline. Sem build/backend/`fetch`/`localStorage`.
- Libs só de `cdnjs.cloudflare.com` (Three.js r128 incluso). **Nunca Lenis.** (Na integração, adicionar `integrity`/`crossorigin` aos scripts.)
- Mídia/avatares de perfil no grafo: placeholders (cor sólida/gradiente brand + label), `src`/`data-` comentado pra trocar.
- Responsivo mobile-first, sem overflow.

# ACESSIBILIDADE

Semântico, `:focus-visible` ring vermelho, contraste ≥ AA, `prefers-reduced-motion`, alvos ≥ 44px, `aria-*` no comparador e em counters. O grafo decorativo recebe `aria-hidden="true"`.

# PROIBIÇÕES ABSOLUTAS (anti-slop)

Sem Inter/Roboto/system como display. Sem gradiente arco-íris/pastel/roxo. Sem texto em gradiente. Sem glassmorphism default. Sem cantos >20px. Sem grade de cards idênticos. Sem eyebrow tracked em toda seção. Sem `01/02/03` clichê. Sem tudo-centralizado. Sem emoji/hype. Sem logo desenhado em SVG. Sem barra sem skew -8deg. **Sem azul do LinkedIn nem segunda cor.** **Sem header/footer/dropdown próprios.** **Sem Lenis.** **Sem copiar minhas páginas ou as outras landings.**

# AUTO-TESTE ANTES DE ENTREGAR

1. Anti-slop: não dá pra adivinhar "IA genérica fez". 2. Não-cópia: nada replica minhas páginas nem as outras landings; conceito é grafo, não forja/stream/ritmo/timeline. 3. Tokens: acento só `#A93636`, zero azul. 4. Voz: sem emoji/hype/exclamação. 5. ≥2 componentes inéditos. 6. Sem chrome próprio (só slots). 7. Motion: Three.js isolado, sem Lenis, honra `data-motion=off`+reduced-motion com fallback, só transform/opacity. 8. Esqueleto exato.

Antes de construir, proponha em 3–4 linhas: direção estética, momento-assinatura, os 2+ componentes inéditos e a técnica-herói. Depois construa a página completa.

=====

## Notas de uso (fora do prompt)
- Preço: confirmar valores e moeda (R$) antes de publicar.
- Dropdown Downloads: global no `chrome.js` (spec, seção 2).
- Integração: `2026-06-02-suite-landings-integration-spec.md`.
