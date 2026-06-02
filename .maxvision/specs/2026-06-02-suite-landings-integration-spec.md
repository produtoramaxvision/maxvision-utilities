# Spec de Integração — Suíte de Landings no design-system MaxVision

> Alvo: `C:\Users\MaxVision\Downloads\design-system_produtora-maxvision`. Motor de motion: **100% vanilla JS+CSS** (fx.js + tweaks.js + chrome.js). Sem GSAP/Lenis/Three hoje. Este doc define COMO integrar as 5 páginas sem bug e sem derrubar produção.

---

## 1. Esqueleto da página (verbatim — espelhar `site/Audiovisual.html`)

Toda página nova vive em `site/` e usa exatamente este boilerplate. Caminhos verificados em `Audiovisual.html`.

```html
<!DOCTYPE html>
<html lang="pt-BR" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{TITULO} · Produtora MaxVision</title>
  <meta name="description" content="{DESC}" />
  <link rel="canonical" href="https://www.produtoramaxvision.com.br/{ROTA}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="{OG_TITULO}" />
  <meta property="og:description" content="{OG_DESC}" />
  <meta property="og:locale" content="pt_BR" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />

  <!-- Tokens + base + chrome (compartilhados) -->
  <link rel="stylesheet" href="../colors_and_type.css" />
  <link rel="stylesheet" href="site-base.css" />
  <link rel="stylesheet" href="site-chrome.css" />
  <!-- CSS da página: arquivo proprio OU <style> inline (ver secao 3) -->
  <link rel="stylesheet" href="{pagina}.css" />

  <script>
    window.MV_ASSETS = '../assets/';
    window.MV_BASE = '';
  </script>

  <!-- Schema.org JSON-LD: Organization + Service/Product + BreadcrumbList (+ FAQPage) -->
</head>

<body data-page="{KEY}" data-theme="dark"
      data-grain="on" data-motion="on" data-cursor="on"
      data-density="regular" data-accent="brand" data-mood="cinema">

  <div data-mv-header></div>          <!-- chrome.js injeta o header global -->

  <main id="main">
    <!-- CORPO DA PAGINA — unica coisa que o Claude Design autora -->
  </main>

  <div data-mv-footer></div>          <!-- chrome.js injeta o footer -->
  <div data-mv-whatsapp></div>        <!-- chrome.js injeta o botao WhatsApp -->
  <div data-mv-tweaks-mount></div>    <!-- tweaks.js monta o painel -->

  <!-- Scripts compartilhados (relativos a site/) -->
  <script src="fx.js"></script>
  <script src="chrome.js"></script>
  <script src="tweaks.js"></script>
  <!-- JS da pagina: arquivo proprio OU <script> inline (ver secao 3) -->
  <script src="{pagina}.js"></script>
</body>
</html>
```

Regra de ouro: **o Claude Design NÃO autora header, footer, dropdown nem WhatsApp.** Só o `<main>` + CSS/JS da própria página.

---

## 2. Dropdown "Downloads" — mudança ÚNICA e GLOBAL no `chrome.js`

Hoje (`site/chrome.js`, array `NAV`, ~linha 43-82) "Downloads" é link simples:
```js
{ label: 'Downloads', href: 'Downloads.html', key: 'downloads' },
```

Trocar por um item com `children` (mesma forma do "Soluções"):
```js
{
  label: 'Downloads',
  href: 'Downloads.html',
  key: 'downloads',
  children: [
    {
      label: 'Suíte de produtos',
      href: 'Downloads.html',
      key: 'suite',
      desc: 'MCPs, plugins e ferramentas',
      submenu: [
        { label: 'Media Forge',  href: 'MediaForge.html', key: 'mediaforge', desc: 'Geração de imagem e vídeo com IA' },
        { label: 'LinkedIn',     href: 'LinkedIn.html',   key: 'linkedin',   desc: 'Carreira e outreach no Claude Code' },
        { label: 'X',            href: 'X.html',          key: 'x',          desc: 'Pesquisa Grok + publicação' },
        { label: 'TikTok',       href: 'TikTok.html',     key: 'tiktok',     desc: 'Trends, Shop e publicação' },
        { label: 'YouTube',      href: 'YouTube.html',    key: 'youtube',    desc: 'Analytics + transcript intelligence' }
      ]
    },
    { label: 'Catálogo completo', href: 'Downloads.html', key: 'catalogo', desc: 'Todos os downloads, filtros e licenças' }
  ]
},
```
Nomes de arquivo `MediaForge.html`, `LinkedIn.html`, `X.html`, `TikTok.html`, `YouTube.html` (sem espaço, evita encoding de URL). A renderização desktop/mobile e a11y (Esc/setas/`aria-expanded`) já são genéricas em `chrome.js` — herdam automaticamente. **Nenhuma página individual mexe nisso.**

---

## 3. Integração do MOTION (o ponto que quebrou o v2)

### 3.1 Herdar o motion do site (consistência de marca)
A página usa os hooks que o `fx.js` já arma:
- `[data-reveal]` — fade-up on-scroll (stagger via `--reveal-delay`).
- `[data-parallax="0.2"]` — parallax acoplado a scroll (set `--py`). Valores menores = mais lento/fundo.
- `[data-magnetic]` (+ `data-magnetic-strength`) — CTA magnético.
- `.counter[data-to]` (+ `data-duration/from/decimals`) — rollup de números.
- `section[id]` + `data-screen-label` — rail lateral automático.
- Cursor-obturador, drone de fundo, header-shrink: globais, não precisam de nada na página.

### 3.2 O wow criativo (3D / profundidade / scroll) — ADITIVO e ISOLADO
fx.js não faz WebGL/3D. Para a espinha-assinatura de cada página:
- **Three.js** (de `cdnjs.cloudflare.com`) num **canvas isolado** de fundo. É a via SEGURA (não disputa scroll). Monocromático: **preto + brasa `#A93636`**, nada de segunda cor.
- **GSAP + ScrollTrigger** (cdnjs) OPCIONAL, só se precisar de pin/scrub fino. Se usar: carregar **depois** do fx.js, escopar em seletores dedicados (`.fx-*`), **nunca** tocar em `[data-parallax]`/`[data-reveal]` (deixa pro fx.js).
- **PROIBIDO Lenis** e qualquer smooth-scroll novo: já existe `scroll-behavior: smooth` global em `site-base.css:15` + listeners do fx.js. Lenis brigaria com ambos.
- O canvas/animação custom **deve checar** `document.body.dataset.motion === 'off'` e `matchMedia('(prefers-reduced-motion: reduce)')` — e cair pra um **fallback estático** (poster/gradiente brand) quando qualquer um for verdadeiro.
- Performance: só `transform`/`opacity`; `will-change` nos elementos animados; matar rAF/ScrollTrigger/IO no `pagehide`. Reduzir contagem de partículas no mobile.

### 3.3 Auto-contido para o preview do Claude Design
No preview do Claude Design o `fx.js`/`chrome.js` podem não rodar. Então:
- O conteúdo do `<main>` **anima sozinho** (CSS + JS inline próprios), visível por padrão, sem depender do fx.js pra aparecer.
- Se a página usar `[data-reveal]` (que começa escondido via `site-base.css`), incluir um fallback: `<noscript>`-safe ou um observer inline próprio. Recomendado: usar a animação inline da própria página para o conteúdo crítico e tratar `[data-reveal]` como enriquecimento.
- Para preview fiel COM o chrome global, o usuário pode carregar `fx.js`, `chrome.js`, `tweaks.js`, `site-base.css`, `site-chrome.css` no projeto Claude Design.

---

## 4. Rotas e Cloudflare (nada sai do ar)

- Rotas em path: `/media-forge`, `/linkedin`, `/x`, `/tiktok`, `/youtube`. `/downloads` continua a página-catálogo (pai), igual `/solucoes`.
- Os subdomínios `linkedin.produtoramaxvision.com.br` etc são **Workers de validação de licença** dos MCPs — **não** são as landings. Adicionar landings em path é puramente aditivo; os Workers de licença seguem intactos.
- No deploy do design-system, mapear cada arquivo HTML para sua rota amigável (regra de rewrite no Worker/Pages: `/media-forge` → `site/MediaForge.html`, etc.) sem tocar nas rotas existentes.
- Migração subdomínio→path (se desejada depois): adicionar 301 dos subdomínios de marketing para os paths novos, mantendo os Workers de licença nos seus hostnames. Fase separada — não bloqueia.

---

## 5. Passo-a-passo de integração por página (pós Claude Design)

1. Salvar o output como `site/{Pagina}.html`.
2. Trocar o header/footer próprios (se o Claude Design tiver gerado algum) pelos slots `data-mv-*` — **não deve haver** se o prompt foi seguido.
3. Conferir includes (seção 1) e `window.MV_ASSETS`/`MV_BASE`.
4. Trocar placeholders de mídia pelos assets reais (`maxvision-intro-fpv-16x9.mp4`, `maxvision-avatar-hero.png`, `maxvision-roda.png`, gerações reais).
5. Extrair CSS/JS inline grande para `site/{pagina}.css` / `site/{pagina}.js` se preferir (opcional).
6. Conferir que o canvas custom respeita `data-motion="off"` + reduced-motion.
7. Adicionar o item ao `NAV` do `chrome.js` (seção 2) — **uma vez só** cobre as 5.
8. Testar: header injeta, dropdown abre/teclado, rail aparece, reveals disparam, sem erro no console, sem duplo scroll/jank, mobile sem overflow.
9. Validar 1 página end-to-end ANTES de gerar as outras 4.

---

## 6. Conflitos a evitar (checklist anti-bug)

- [ ] Sem header/footer/dropdown próprios na página (só slots).
- [ ] Sem Lenis / sem segundo smooth-scroll.
- [ ] GSAP (se houver) carregado após fx.js, escopo dedicado, não toca `[data-parallax]`/`[data-reveal]`.
- [ ] Canvas Three.js isolado; honra `data-motion="off"` + `prefers-reduced-motion`; fallback estático.
- [ ] Só `transform`/`opacity` animados; rAF/observers limpos no `pagehide`.
- [ ] Único acento = `#A93636`. Zero segunda cor (sem azul LinkedIn, rosa TikTok, vermelho-puro YouTube como acento).
- [ ] Libs só de `cdnjs.cloudflare.com`; React/Babel (se usar o modo React) de `unpkg` como nas landings atuais.
- [ ] `window.MVFX.refresh()` chamado após qualquer mount dinâmico.
- [ ] **SRI (hardening):** na integração, adicionar `integrity="sha384-..."` + `crossorigin="anonymous"` aos `<script>` de CDN (Three.js/GSAP). As landings atuais (Drones FPV) usam unpkg sem SRI — então é melhoria, não bloqueio; pegar o hash correto da versão exata no cdnjs.
