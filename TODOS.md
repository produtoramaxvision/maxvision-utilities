# TODOS

Trabalho identificado e deliberadamente adiado. Cada item tem contexto suficiente
para alguém retomar em 3 meses sem reconstruir o raciocínio.

Criado em 2026-07-29 pelo `/maxvision:plan-ceo-review` sobre
[`.maxvision/plans/2026-07-29-higgsfield-kling-api-refresh.md`](.maxvision/plans/2026-07-29-higgsfield-kling-api-refresh.md).

---

## P3 — Smartcut: corte preciso em keyframe sem reencode total

**O quê:** cortar vídeo no keyframe e reencodar apenas os fragmentos das bordas,
em vez de reencodar o clipe inteiro.

**Por quê:** quando o media-forge passar a montar vários clipes num anúncio final,
reencodar tudo a cada corte custa tempo e perde qualidade geracional.

**Prós:** corte rápido, sem perda no miolo do clipe.
**Contras:** hoje não existe consumidor — nenhuma tarefa do plano monta timeline.
Construir agora é abstração para um problema que ainda não apareceu.

**Contexto:** técnica observada em `mifi/lossless-cut` (`src/renderer/src/smartcut.ts`).
O repo é **GPL-2.0** — nenhum código pode ser copiado para o media-forge (MIT com
billing comercial). A técnica precisa ser reimplementada do zero sobre o
`ffmpeg-static` e o `src/core/ffmpeg.ts` que já existem.

**Esforço:** M (human ~2 dias / CC ~1h)
**Depende de:** existir um passo de montagem/concatenação no pipeline. Não começar antes.

---

## P3 — novel2movie: adaptação de texto longo para vídeo episódico

**O quê:** pipeline que transforma ficção longa em narrativa visual episódica, com
compressão narrativa e rastreamento de personagem.

**Por quê:** amplia o narrative planner (T13) de brief curto para obra longa.

**Prós:** desbloqueia conteúdo serializado.
**Contras:** o upstream de referência não terminou.

**Contexto:** `hkuds/vimax` (MIT) tem `pipelines/novel2movie_pipeline.py`, mas o
arquivo abre com `# TODO: NOT IMPLEMENTED YET`. Os agentes de apoio existem
(`novel_compressor.py`, `character_extractor.py`, `event_extractor.py`), só a
orquestração final não. Não planejar em cima de código inacabado de terceiro —
reavaliar quando o upstream fechar, ou desenhar a orquestração do zero.

**Esforço:** L (human ~1 semana / CC ~3h)
**Depende de:** T13 (narrative planner) entregue e estável.

---

## P2 — T12: Reference Authority Resolver (adiado no eng review)

**O quê:** resolver que atribui exatamente um asset dono por dimensão controlada
(identity, first-frame, product, motion, camera, audio, style) e rejeita ambiguidade.

**Por quê adiado:** verificado em `media-forge/src/video/providers/base.ts:57` —
`multiReferenceImages?: ReadonlyArray<string>` são strings puras, **sem campo de
papel**. O resolver produziria atribuição de autoridade que nunca chega ao provider.
Seria contabilidade interna que nenhum lado do wire consome.

**Gatilho para retomar:** quando algum provider aceitar papel por referência no
payload. Checar `base.ts` — se `multiReferenceImages` virar array de objeto com
`role`, ou se surgir campo equivalente em Higgsfield/Seedance/Veo, a tarefa
destrava e vale o trabalho.

**Contexto:** conceito vem do Operating Loop passo 7 do `Emily2040/seedance-2.0`
(MIT). A regra é: cada dimensão tem exatamente um dono ou é marcada não-aplicável;
um asset pode ter várias dimensões; nenhuma dimensão tem dois donos; proibido
inferir autoridade de tipo de mídia, ordem de upload ou nome de arquivo.

**Esforço:** S (human ~4h / CC ~25min)
**Depende de:** campo de papel no wire de algum provider.

---

## P2 — Reconciliar `generation-run` com `trace.jsonl`

**O quê:** decidir se o schema `generation-run` absorvido do seedance substitui,
complementa ou é descartado frente ao `trace.jsonl` que o media-forge já grava.

**Por quê:** dois registros do mesmo evento divergem com o tempo e corrompem o
cálculo de custo — que é exatamente o problema que T15 existe para fechar.

**Contexto:** T10 já sinaliza "reconciliar, não duplicar". Este TODO existe para o
caso de T10 entregar os dois convivendo por conveniência de prazo. Se isso
acontecer, é dívida a pagar antes do PR3.

**Esforço:** S (human ~2h / CC ~15min)
**Depende de:** T10 concluída.
