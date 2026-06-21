# Plano — Suíte de Landing Pages MaxVision (Claude Design) + Integração

> Gerado via /orchestrate em 2026-06-02. Alvo confirmado: **design-system MaxVision** em `C:\Users\MaxVision\Downloads\design-system_produtora-maxvision` — site **rico em animações** (chrome.js + fx.js + tweaks.js + páginas React-mounted, parallax, drone flights). NÃO é site sem motion; "HTML servido direto" (não SPA React build). Preço media-forge confirmado: **tiers com Criador R$37,90/mês**. Os prompts devem ESTENDER o motor de motion existente (atributos `data-motion`/`data-grain`/`data-cursor`, fx.js), nunca importar stack paralelo que conflite.

## Objetivo

5 landing pages de produto (media-forge, LinkedIn, X, TikTok, YouTube), geradas no Claude Design, **integradas no site existente** (design-system `site/`), acessíveis por um **dropdown "Downloads"** no header (igual ao de "Soluções"). Rotas em path (`/media-forge`, `/linkedin`, `/x`, `/tiktok`, `/youtube`) — sem subdomínio, sem derrubar nada do Cloudflare.

## Diagnóstico do prompt v2 (por que saiu "separado")

O prompt v2 (`2026-06-01-media-forge-landing-claude-design-prompt.md`, seção "HEADER COM DROPDOWN") mandava o Claude Design **construir o próprio header sticky + dropdown** num single-file standalone. Resultado: página com chrome próprio, desconectada do `chrome.js` compartilhado que serve as outras 18 páginas. **Correção:** a página gera só o `<main>` + os slots `data-mv-*`; header/footer/whatsapp são injetados pelo `chrome.js`. O dropdown Downloads é mudança **única e global** na nav (não vai em página nenhuma).

## Princípios (todos os prompts)

1. **Não autorar header/footer/dropdown.** Emitir esqueleto MaxVision (slots + includes idênticos a `Audiovisual.html`) e só o corpo `<main>`.
2. **Sistema visual imóvel, criatividade livre dentro dele.** Preto verdadeiro + brasa `#A93636` como ÚNICO acento. Sem segunda cor (proíbe rosa TikTok, vermelho-puro YouTube, azul LinkedIn como acento estrutural — só o vermelho da marca).
3. **Diferenciação por CONCEITO DE INTERAÇÃO**, não por tema. Cada página tem uma espinha-assinatura travada (abaixo). Proibido clonar a estrutura das outras.
4. **Profundidade de background brand-locked** (preto + brasa): GSAP ScrollTrigger + Lenis sincronizados, parallax multi-camada, Three.js leve monocromático opcional. `prefers-reduced-motion` com fallback estático obrigatório.
5. **Fatos do produto qualitativos** (sem afirmar contagem exata de tools — READMEs divergem). README é canônico em dúvida.

## Conceito-assinatura travado por produto (anti-cópia)

| Produto | Rota | Conceito de interação (exclusivo) |
|---|---|---|
| media-forge | `/media-forge` | A FORJA — minério→forja→master; multi-motor pinned |
| LinkedIn | `/linkedin` | GRAFO DE REDE tecido pelo scroll + resume antes/depois |
| X | `/x` | STREAM TEMPO REAL — leitura Grok ao vivo / radar de sinais |
| TikTok | `/tiktok` | RITMO VERTICAL BPM — pulso 9:16, trends batendo no beat |
| YouTube | `/youtube` | CURVA DE RETENÇÃO / TIMELINE-SCRUB — analytics + transcript |

## Checklist de execução

- [x] P0 Orientação: prompt v2, repos da suíte, mecânica chrome.js, pesquisa Claude Design + técnicas
- [x] P0 Advisor + decision gate (alvo + preço)
- [x] P0 Boilerplate real do `Audiovisual.html` verificado
- [x] P0.1 Análise do motor de motion (vanilla fx.js, sem GSAP/Lenis/Three hoje) — corrige rumo
- [x] P1 Spec de integração (`...-integration-spec.md`) — edit do NAV chrome.js + esqueleto + motion + rotas + segurança + SRI
- [x] P2 Prompt media-forge v3 (revisão: remove header, integra motion, mantém núcleo FORJA + tiers R$37,90)
- [x] P3 Prompt LinkedIn (grafo de rede + resume antes/depois)
- [x] P4 Prompt X (stream/radar Grok tempo real)
- [x] P5 Prompt TikTok (ritmo vertical BPM, sem rosa, sem flashes)
- [x] P6 Prompt YouTube (curva de retenção / timeline-scrub)
- [ ] P7 (usuário) Gerar no Claude Design → integrar via spec → validar 1 página end-to-end antes das demais

## Pendências para o usuário confirmar na integração

- Preços dos outros 4 produtos: usei os dos READMEs (LinkedIn/X USD 29/99; TikTok $39/79/199; YouTube $19/79 + BR R$99/399). Marcados como **EDITÁVEL** nos prompts — confirme/ajuste por página.
- Subdomínios `*.produtoramaxvision.com.br` = Workers de licença (não landings). Migração subdomínio→path é aditiva.
