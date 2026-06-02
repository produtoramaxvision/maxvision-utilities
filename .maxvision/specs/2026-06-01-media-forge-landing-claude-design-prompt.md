# Prompt para Claude Design — Landing media-forge (v2)

> Cole o bloco entre `=====` no Claude Design. O design system Produtora MaxVision **já está carregado no seu projeto Claude Design** — o prompt referencia, não recola. Depois de gerar, troque o `src` do vídeo hero pelo `maxvision-intro-fpv-16x9.mp4`. Base: best practices oficiais da skill `frontend-design` + `impeccable`.

=====

# PAPEL E MANDATO

Você é diretor de arte premiado + engenheiro front-end sênior. Construa **uma landing page de produto, single-file HTML/CSS/JS**, production-grade, pronta pra integrar no site da Produtora MaxVision. Idioma: **português do Brasil**.

Você é capaz de trabalho extraordinário. **Não se segure.** Mostre o limite do que dá pra criar comprometendo-se 100% com uma visão cinematográfica distinta. Quero **criatividade máxima e inovação real** — em layout, em composição, e principalmente em **componentes** que eu ainda não tenho. Esta página precisa de UM momento que ninguém esquece.

**Regra de ouro:** a criatividade mora na composição, no movimento, na narrativa de scroll e em **componentes inéditos** — nunca em quebrar o sistema visual da marca. Sistema imóvel, criatividade livre dentro dele. Fiel ao sistema E surpreendente.

**NÃO COPIE minhas páginas existentes.** Você já conhece minhas páginas (Home, Sobre, Labs, Drones FPV, IA) no projeto. **Não replique** o layout, a ordem de seções nem os componentes delas. Esta é uma página de PRODUTO com linguagem própria. Reuse só o vocabulário visual da marca (tokens, fontes, barra diagonal, texturas, avatar); invente tudo o mais. Se um componente seu parecer com algo que já existe nas minhas páginas, refaça diferente.

# O PRODUTO

**media-forge** — geração de imagem e vídeo com IA de ponta (Google Veo 3.1, Imagen 4 Ultra, Nano Banana Pro; mais Kling, Higgsfield, Seedance), operada por linguagem natural dentro do Claude Code. Materialização da vertical **MaxVision Labs**. O criador descreve; a forja entrega mídia pronta. Multi-modelo: um pedido, vários motores. Roteamento inteligente + revisão de qualidade automática. Hospedado — o criador não instala nada pesado, não gerencia chave de API, paga por créditos.

**Conceito criativo central (use, mas proponha refinamento próprio):** A FORJA. Prompt entra como minério bruto; sai mídia forjada. Calor, pressão, precisão de estúdio. O vermelho da marca é a brasa. Enxergou conceito mais forte que respeite o sistema? Proponha em 2 linhas antes de construir.

# PÚBLICO

Criadores e produtoras de conteúdo brasileiros. Querem vídeo/imagem de qualidade de produtora, rápido, sem virar engenheiro de IA. A cena: madrugada, entrega amanhã, precisa de 8 variações de um take agora.

# SISTEMA VISUAL — JÁ CARREGADO NO SEU PROJETO, HONRE EXATAMENTE

O design system Produtora MaxVision já está no contexto deste projeto Claude Design. Use os tokens, fontes e regras que já estão lá. **Não invente cor, fonte ou raio novo.** Âncoras inegociáveis pra reforçar:

- Canvas **preto verdadeiro** (`--bg`, hsl 0 0% 0%) em tudo.
- **`#A93636` (`--brand`, o vermelho) é o ÚNICO acento estrutural** — CTA, link, foco, eyebrow, barra. Nada de segunda cor de destaque.
- **Bebas Neue** display (SEMPRE MAIÚSCULA + tracking ~0.02em) · **Inter** UI/corpo · **JetBrains Mono** "receipts" (`4K · 60FPS · SP`).
- **Barra diagonal** com `skewX(-8deg)` sob títulos/eyebrows — a inclinação É a assinatura. Eyebrow = barra vermelha 28px + texto mono MAIÚSCULO.
- Texturas **grão + vinheta + scanline** sobre blocos hero/cinema.
- `text-wrap:balance` em h1/h2. Imagery **full-bleed** — vídeo é o produto. Raio de card **nunca > 20px**.
- Hover de card: `translateY(-2px)` + borda vermelha translúcida + glow leve.
- Use o **avatar** vinyl-toy de cabeça-obturador (placeholder `maxvision-avatar-hero.png`) e o logo `maxvision-roda.png` onde fizer sentido.

Se algum token não estiver acessível no contexto, use os valores canônicos da marca (preto verdadeiro, `#A93636`, Bebas/Inter/JetBrains Mono) — nunca substitutos genéricos.

# VOZ (copy da página) — RÍGIDA

Português do Brasil. Frases curtas, presente. **Sem emoji. Sem exclamação. Sem hype.** Proibidas: "incrível", "inovador", "revolucionário", "transformar", "supercharge", "seamless". MAIÚSCULAS só em display/eyebrow. Receipts em mono MAIÚSCULO. Tom: estúdio que entrega, não startup que promete.

# HEADER COM DROPDOWN "DOWNLOADS" (requisito específico)

Crie um **header sticky** (encolhe ao rolar) com nav. Um dos itens é um botão **"Downloads"** que, no hover/click, abre um **dropdown** (menu suspenso) — é por esse dropdown que se chega a esta página no site. Dentro do dropdown:
- **media-forge** (este produto) em destaque — ícone/thumb + nome + linha curta ("Geração de imagem e vídeo com IA").
- Mais 2–3 slots placeholder pros outros produtos da suíte (ex: "MaxVision LinkedIn", "MaxVision X", "MaxVision TikTok") — itens menores, com `data-href` comentado pra eu apontar depois.
- Dropdown cinematográfico, on-brand: fundo `--surface`/preto, borda sutil, barra diagonal vermelha como detalhe, item ativo (media-forge) com marca de seleção vermelha. Animação de abertura suave (não pop seco). Teclado-acessível (`aria-expanded`, `Esc` fecha, foco navegável). `prefers-reduced-motion` desliga a animação.

# ESTRUTURA DA PÁGINA (ordem; interior é seu — inove)

1. **Header** com nav + **dropdown Downloads** (acima) + CTA "Entrar na forja".
2. **Hero** — vídeo FPV full-bleed (placeholder `src`) + vinheta/grão/scanline + headline Bebas escala pôster (clip-reveal escalonado) + sub curta + CTA + receipt mono. Momento-assinatura aqui.
3. **A forja** — o conceito prompt→mídia mostrado com MOVIMENTO/componente inédito, não texto explicativo.
4. **Um pedido, vários motores** — componente-assinatura interativo: o MESMO prompt vira imagem E vídeo nos vários modelos (Veo/Imagen/Nano/Kling/Higgsfield/Seedance), sticky/pinned enquanto os motores trocam. Quero algo que eu não tenha em nenhuma página.
5. **Showcase** — gerações reais (placeholders 9:16), composição não-grade-genérica.
6. **O que ela faz** — capacidades (roteamento inteligente, revisão de qualidade, controle de custo com receipts mono, async). Componha de forma inesperada, não cards iguais enfileirados.
7. **Preços** — Free / **Criador R$37,90/mês** / Pro / Agência (self-host). Créditos em 1 frase ("você gasta o que gerar; vê o custo antes"). Destaque o Criador.
8. **MaxVision Labs** — credibilidade: a casa, o avatar (drop-shadow cinematográfico), stack real em terminal mono. Sem vaporware.
9. **CTA final** — Bebas pôster + barra diagonal longa + receipt de fechamento.
10. **Footer** — assinado, links, logo.

# MOVIMENTO / INTERAÇÃO

Escolha UMA técnica-herói (não empilhe tudo). Mais: entrada coreografada do hero (clip-reveal Bebas), reveal-on-scroll só onde merece, barra diagonal como motivo de transição, marquee de modelos pausando no hover, contador rollup em stats, CTA magnético, cursor com toque de obturador (leve, opcional). Bibliotecas só via `cdnjs.cloudflare.com` (GSAP/ScrollTrigger, Lenis; Three.js/canvas só se leve). **`prefers-reduced-motion` com fallback estático é obrigatório.** Anime só transform/opacity, ease-out.

# INOVAÇÃO DE COMPONENTES (o que eu quero de novo)

Pelo menos **2 componentes que eu ainda não tenho**, inventados pra este produto e on-brand. Exemplos de direção (não copie literalmente — supere): um "forjador" interativo onde o texto digitado vira blocos de mídia; um seletor de motores que mostra custo/tempo/qualidade de cada modelo em tempo real; uma timeline de "minério → forja → master"; um comparador antes/depois cinematográfico. Proponha os seus.

# RESTRIÇÕES TÉCNICAS (sandbox-aware)

- **Single file** HTML, `<style>`/`<script>` inline. Sem build, sem backend, sem `fetch`/`localStorage`.
- Libs só de `cdnjs.cloudflare.com` (nomeie as que usar).
- Vídeo: `<video autoplay muted loop playsinline>` com `src` PLACEHOLDER + `poster`. Nunca som inicial.
- Showcase/thumbs: placeholders (gradiente brand-aware ou cor sólida + label), `src`/`data-` comentado pra eu trocar.
- Responsivo mobile-first, sem overflow de texto em nenhum breakpoint. Dropdown funciona em mobile (vira acordeão/sheet).

# ACESSIBILIDADE

HTML semântico, `:focus-visible` ring vermelho, contraste ≥ AA, `prefers-reduced-motion`, alvos ≥ 44px, `aria-*` no dropdown e em counters/waitlist.

# PROIBIÇÕES ABSOLUTAS (anti-slop)

Sem Inter/Roboto/Arial/system como **display** (hero é Bebas). Sem gradiente arco-íris/pastel/roxo. Sem texto em gradiente. Sem glassmorphism por default. Sem cantos >20px em card. Sem grade de cards idênticos ícone-título-texto. Sem eyebrow tracked em TODA seção. Sem scaffolding `01/02/03`. Sem layout tudo-centralizado genérico. Sem emoji. Sem palavras de hype banidas. Sem desenhar logo em SVG (placeholder de imagem). Sem barra diagonal sem o skew -8deg. **Sem replicar minhas páginas existentes.**

# AUTO-TESTE ANTES DE ENTREGAR

1. **Anti-slop:** se der pra dizer "uma IA fez isso" ou adivinhar o tema só de "produto de IA de mídia", refaça mais ousado.
2. **Não-cópia:** nenhuma seção/componente replica minhas páginas existentes.
3. **Tokens honrados:** nada de cor/fonte/raio fora do sistema da marca.
4. **Voz:** zero emoji, zero hype, zero exclamação; pt-BR presente.
5. **Componentes novos:** ≥2 componentes inéditos e on-brand.
6. **Dropdown Downloads:** existe no header, acessível, on-brand, com media-forge em destaque.
7. **Reduced-motion:** tudo tem fallback estático.

Antes de construir, proponha em 3–4 linhas: a direção estética, o momento-assinatura, os 2 componentes inéditos e a técnica-herói de movimento. Depois construa a página completa.

=====

## Notas de uso (fora do prompt)

- **Design system no Claude Design:** este prompt assume que seu projeto Claude Design já tem o design system carregado. Se gerar fora dele, adicione o `colors_and_type.css` ao contexto antes.
- **Vídeo hero / assets:** entram como placeholder `src`; troque na integração (`maxvision-intro-fpv-16x9.mp4`, `maxvision-avatar-hero.png`, `maxvision-roda.png`).
- **Dropdown Downloads:** os outros produtos (LinkedIn/X/TikTok) entram como placeholders com `data-href` — aponte pras URLs reais depois.
- **Iteração:** um eixo por vez ("mantém estrutura; deixa o hero 3x mais dramático"). Bold = hierarquia/escala mais fortes, não mais efeitos.
- **Preço:** R$37,90 travado no spec de infoproduto; sincronize se mudar lá.
