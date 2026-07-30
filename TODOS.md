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

**Atualização 2026-07-29:** não são dois registros, são **três**. Mapeados ao
implementar o cost guard:

| Escritor | Onde grava | Quem lê |
|---|---|---|
| `cost-tracker.recordJob` (4 providers de vídeo) | SQLite `video_jobs` | `queryReport`, `dailySpendUsd`, sweep do credit-core |
| `cost-tracker.recordImageJob` (novo, 3 tools de imagem) | SQLite `image_jobs` | `dailySpendUsd` |
| `OutputManager.appendCostLog` | `<jobDir>/cost.jsonl` | **ninguém** — nenhum caller de produção. O CLI foi repontado para o SQLite em `bbc857b`; o helper e seus testes ficaram de pé aguardando esta decisão de manter-ou-remover |

Além do `trace.jsonl`. Quem for fechar este TODO parte daqui, não precisa
re-derivar.

**Atualização 2026-07-30 — a parte do `generation-run` está FECHADA pelo T10.**
Não ficaram dois registros convivendo. A divisão foi feita por granularidade e
propriedade, não escolhendo um vencedor:

- `trace.jsonl` é por **estágio** e é dono do dinheiro (`costUsd`) e do tempo.
- `GenerationRun` (`src/narrative/generation-run.ts`) é por **tentativa** e é dono
  da identidade narrativa: projeto, clipe, versão do prompt, referências, desfecho.

`GenerationRun` **não tem** campo de custo e não pode ganhar um: `assertNoCostFields()`
mais um teste que varre o shape Zod atrás de `/cost|price|credit|usd/i` transformam
isso em falha de CI. A junção com o dinheiro é `run_id`, que é o mesmo id em que o
trace e o ledger já são chaveados.

**O que continua aberto neste item:** só o `OutputManager.appendCostLog` →
`cost.jsonl`. Reverificado em 2026-07-30: segue com **zero callers de produção**
(`src/output/output-manager.ts:273`, chamado apenas de testes). Decisão de
manter-ou-remover ainda pendente — não bloqueia nada.

**Esforço restante:** S (human ~30min / CC ~10min)
**Depende de:** nada. T10 entregue.

---

# Bugs herdados encontrados em 2026-07-29

Achados ao implementar os cost guards. Todos verificados no código, nenhum é
suposição. Ordenados por impacto financeiro.

## P2 — MuAPI: shape do endpoint de estimativa não verificado ao vivo

**O quê:** `src/video/providers/muapi.ts` lê o custo de um modelo com
`dynamic_pricing: true` chamando o `estimate_endpoint` do próprio MuAPI e aceita
`{ cost }` ou `{ cost_usd }`. As docs lidas via `context7-mcp` em 2026-07-30
documentam o shape do **catálogo** (`GET /api/v1/models`), não o da resposta do
endpoint de estimativa. As duas chaves são suposição por simetria.

**Por que não bloqueia:** o modo de falha é seguro. Shape desconhecido **lança**
em vez de produzir número, então um palpite errado vira erro visível, não uma
estimativa fabricada passando pelo cost guard e entrando no ledger. Não existe
tabela de preço local do MuAPI para servir de fallback silencioso — isso é
deliberado (agregador tem markup próprio).

**Por que não foi verificado:** exige `MUAPI_API_KEY`, que este repo não tem.
Uma chamada a `GET /api/v1/models` já resolveria — é leitura, não gasta crédito.

**Como fechar:** com uma chave, chamar `estimate_endpoint` de um modelo de vídeo
e conferir as chaves reais. Se divergir, corrigir e apontar aqui.

**Esforço:** XS (human ~10min / CC ~5min)
**Depende de:** uma credencial MuAPI.

---

## P2 — Erros MCP perdem todos os campos estruturados na serialização

**O quê:** `src/mcp/handlers/plumbing.ts:61` monta a resposta de erro como
`${err.name}: ${err.message}` e descarta o objeto `details` de `MediaForgeError`.
Vale para **todo** erro, não só o cost guard.

**Por quê importa:** `CostGuardError` carrega `estimateUsd`, `limitUsd` e `kind`
(`'block' | 'daily-cap' | 'retake-reserve'`) exatamente para o cliente poder
distinguir programaticamente qual limite bateu e oferecer a ação certa. Nada disso
chega ao cliente. Hoje a única forma de distinguir é casar substring da mensagem,
que é frágil e quebra em qualquer reescrita de texto.

**Contexto:** encontrado em 2026-07-30 ao escrever
`tests/mcp/cost-guard-retake-reserve.test.ts` para o T14 — o teste tentou afirmar
`kind: 'retake-reserve'` na wire e falhou. **Pré-existente, não introduzido pelo
T14.** O teste foi ajustado para afirmar o texto da mensagem, que é o único canal
que o cliente realmente recebe, com o motivo escrito no ponto da asserção.

**Por que não foi corrigido junto:** muda o shape de resposta de erro de todas as
ferramentas MCP. É mudança transversal e não pertence a um commit de cost guard.

**Esforço:** S (human ~1h / CC ~20min)
**Depende de:** decidir o contrato — `structuredContent` no erro, ou `details`
embutido no texto como JSON.

---

## P2 — `maybeStoreImageArtifact` cunha um segundo jobId

**O quê:** o `job_id` devolvido ao caller não é o mesmo usado na linha de
`image_jobs`. Impossível correlacionar o que o usuário vê com o ledger.

**Onde:** `src/mcp/handlers/register.ts`.
**Esforço:** S (CC ~15min)

## P3 — Complexidade de `generate()` no Kling e Higgsfield subiu com o A5

**O quê:** auditado com `fallow audit --base origin/homolog`. Contra a base correta a
branch tem **`dead_code_introduced: 0`** e `complexity_introduced: 4`:

| Arquivo | Função | Ciclomática | Nota |
|---|---|---|---|
| `src/mcp/handlers/register.ts:842` | `<arrow>` | 24 | artefato de atribuição — arquivo novo do split do PR0, o código veio do monolito |
| `src/mcp/handlers/register.ts:924` | `<arrow>` | 16 | idem |
| `src/video/providers/kling.ts:185` | `generate` | 19 | **real**, subiu com os hooks do A5 |
| `src/video/providers/higgsfield.ts:89` | `generate` | 15 | **real**, idem |

**Julgado no código, não na métrica.** O que o A5 adicionou é a forma mínima do
contrato: `if (ledgerHooks) await beforeSubmit(...)` antes da rede, `try` em volta
do submit com `onSubmitFailed` no `catch` e re-throw do erro original, e um segundo
`try` para o bookkeeping pós-submit. Cada branch tem uma razão declarada. Não é
complexidade acidental.

**Por que não reduzi agora:** extrair submit+parse para método privado derrubaria a
contagem, mas é refactor além do escopo do A5, e o PR0 já ensinou que misturar
relocação com mudança semântica torna a revisão pior. Além disso a **migração para a
API 2.0** (P1 acima) reescreve exatamente essas funções — o momento certo de
simplificar é lá, de uma vez, não agora e de novo depois.

**Contexto:** o veredito global do `fallow` é `fail` desde antes desta branch
(`max_cyclomatic: 55` num arquivo que ela não toca). Ver A11 no plano.

**Esforço:** absorvido pela migração da API 2.0.

## P2 — Perda limitada e conhecida: erro após submit bem-sucedido

**O quê:** entre um submit que deu certo e o `recordJob`, existe código que pode
lançar — `res.json()`, o próprio `recordJob`, `recordRequestMapping` no Higgsfield,
o `recordOnSuccess` da rota ARK do Seedance.

**Nesse caso:** o provider **aceitou** o job (ele vai rodar e custar), o crédito
**está** reservado, e não existe linha de ledger. O oracle responde `unknown`, o
sweep libera, e uma geração que aconteceu de verdade fica **sem cobrança**.

**O que foi feito:** o hook `onPostSubmitError` (A5, commit `59b9ea9`) loga jobId,
id nativo e estimativa para reconciliação manual. Deliberadamente **não** libera,
porque o job está rodando. O erro original continua propagando.

**Por que não foi fechado:** não dá para criar a linha de ledger quando foi
justamente ela que falhou. É perda limitada, conhecida e logada — melhor que cobrar
errado em silêncio ou não cobrar em silêncio.

**O fecho real** é a API de dedução do Kling (P1 acima): se o provider informa o
débito, a gente descobre a cobrança pelo lado dele em vez de depender da nossa
própria escrita ter dado certo.

**Esforço:** depende da API de dedução.

## P1 — media-forge fala a API legada do Kling, não a documentada (T3 reaberto)

**O quê:** verificado ao vivo em 2026-07-30 na doc autenticada. Todas as páginas de
modelo do Kling documentam o esquema **API 2.0**:

```
POST /image-to-video/kling-3.0-turbo      POST /omni-video/kling-o1
POST /image-to-video/kling-3.0            POST /motion-control/kling-3.0
POST /image-to-video/kling-2.6            GET|POST /tasks
```

`POST /{operação}/{versão-do-modelo}`, **sem `/v1/`**, **sem `model_name` no body**,
poll unificado em `/tasks`. O media-forge usa `/v1/videos/{tipo}` com `model_name`
no body — que **não é mais documentado em lugar nenhum**.

**Nada está quebrado.** Sonda de custo zero com a chave real:

```
legado  GET /v1/videos/text2video/{id}   HTTP 400  code 1201 "Task not found"
novo    GET /tasks?external_task_ids=... HTTP 200  code 0 SUCCEED
```

Os dois respondem. O legado funciona, só não é documentado.

**Impacto real:** os modelos novos são **inalcançáveis** — Kling 3.0 Turbo, O1,
2.6, 2.5 Turbo, Motion Control, Avatar, Audio Generation, Effect Templates. O
plugin está preso à geração anterior de modelos do provider.

**Como fazer:** os dois esquemas estão vivos, então dá para migrar atrás de flag
com o legado como default, em vez de virada única. Não é troca de string: o corpo
da requisição muda (parâmetros "fully decoupled" segundo o anúncio deles) e o poll
deixa de ser por tipo.

**Por que não foi feito antes:** eu retratei o T3 em `e35ae72` afirmando que a API
2.0 não existia, baseado num snapshot **defasado** servido pelo `context7-mcp`. A
retratação está revertida no plano, com o erro documentado. Lição: context7 é
cache; para afirmar que algo não existe na doc, abrir a doc.

**Esforço:** L (CC ~3h) — superfície inteira do provider.

## P1 — APIs de dedução e uso do Kling não são usadas

**O quê:** a doc expõe `/api/assets/billing-deduction` (Deduction Query) e
`/api/assets/account-usage` (Account Usage). O anúncio da API 2.0 as descreve como
*"Retrieve unit and balance deduction records via API, with filtering and
cursor-based pagination for reconciliation and automation."*

**Por que importa:** hoje o custo real do Kling é **derivado** — `rate × multiplier ×
duração` a partir do registry. Essas APIs dão o valor que o Kling **efetivamente
debitou**. Isso fecha de verdade a reconciliação que o T15 só aproxima, e detecta
deriva de tarifa sem depender de alguém reler a página de preços.

**Contexto:** conecta com o TODO de reconciliação de ledger e com o P2 do sweep do
Seedance. Se o provider informa o débito real, a estimativa deixa de ser a fonte.

**Esforço:** M (CC ~1h)

## P1 — Roteador não sabe que o Higgsfield revende Kling e Seedance

**O quê:** confirmado na doc oficial (`docs.higgsfield.ai/guides/video`) que a
plataforma do Higgsfield expõe modelos de terceiros nos próprios paths:
`POST /kling-video/v2.1/pro/image-to-video` e
`POST /bytedance/seedance/v1/pro/image-to-video`.

**Impacto:** o mesmo modelo subjacente é alcançável por **dois** caminhos com
preços diferentes — direto pela API do provider, ou via Higgsfield. O
`handleVideoRoute` (`src/mcp/handlers/video.ts`) ordena por custo tratando cada
provider como uma fonte distinta, então ele pode escolher o caminho mais caro para
o mesmo modelo sem perceber que são o mesmo modelo.

**Por que não corrigi junto:** precisa das tarifas do Higgsfield para os modelos
revendidos, que não estão no registry. Sem elas, comparar os dois caminhos é
chute. Depende do mesmo levantamento de preço do A8.

**Contexto:** registrado no perfil do Higgsfield em
`skills/_shared/references/surface-prompt-profiles.md` — quando o caller pediu
Kling explicitamente, vale o perfil direto. Falta o roteador saber.

**Esforço:** M (CC ~45min) depois das tarifas.

## P2 — Orçamento de prompt do Seedance não verificado

**O quê:** `src/core/prompt-budget.ts` tem `promptMaxChars: null` para
`bytedance`, com `verifiedAt: 'unverified'`. Kling é o único dos quatro que
publica limite (2.500 chars).

**Impacto:** baixo hoje — `assertPromptWithinBudget` é no-op quando o limite é
null, então nada é rejeitado indevidamente. Mas um prompt longo demais para o
Seedance só falha no provider.

**Como fechar:** ler a doc da superfície ativa — fal.ai na rota default, BytePlus
ModelArk na rota `ARK`-direta — e gravar o número com a data em
`prompt-budget.ts` **e** na tabela de `surface-prompt-profiles.md`. O teste
doc-vs-código já garante que os dois não divirjam.

**Não copiar o 2.500 do Kling.** São plataformas sem relação, que o media-forge
apenas roteia lado a lado.

**Esforço:** S (CC ~20min)

## P3 — `veo-interpolate` e `veo-with-refs` aceitam `negativePrompt` e nunca enviam

**O quê:** os schemas Zod das duas aceitam `negativePrompt`, mas o código nunca
repassa o campo para o config do `generateVideos`.

**Impacto:** o usuário escreve uma negativa, ela é aceita sem erro, e não tem
efeito nenhum na geração. Parâmetro que mente, mesma classe do campo `dryRun` do
request logo abaixo.

**Contexto:** achado ao ligar o enforcement de orçamento de prompt (T18) — as duas
foram os únicos caminhos do Veo onde não havia o que checar, porque nada é
submetido. Pré-existente.

**Esforço:** XS (CC ~10min)

## P2 — O campo `dryRun` do request é ignorado por todos os serviços

**O quê:** todo schema de imagem tem `dryRun: z.boolean().default(false)`, mas
nenhum serviço lê esse campo. Só `client.dryRun`, definido na construção do
cliente, controla alguma coisa.

**Impacto:** quem chamar uma tool passando `dryRun: true` contra um cliente normal
recebe geração **real** e é cobrado por ela. O parâmetro parece uma proteção e não é.

**Contexto:** achado ao corrigir o P1 do dry-run cobrando crédito. Aquele fix
fechou o caso do `client.dryRun` (guard, ledger e débito agora respeitam). Este
aqui é a outra ponta e continua aberta.

**Decisão a tomar:** ou os serviços passam a ler o campo do request, ou ele sai
dos schemas. Manter um parâmetro que mente é pior que não ter.

**Esforço:** S (CC ~20min)

## P3 — Comentário de `handleKlingElementDelete` mente sobre o contrato

**O quê:** o banner diz "Requires confirm:true — irreversible on backend". O código
ramifica em `input.alsoDeleteRemote`. Não existe campo `confirm`.

**Onde:** `src/mcp/handlers/kling.ts`.
**Esforço:** XS (CC ~5min)

## P3 — `releaseVideoFailed` é export morto no call-site

**O quê:** definido e exportado em `src/mcp/handlers/billing.ts`, nunca invocado por
`registerAllTools`. O caminho de release em falha de vídeo não existe de fato.

**Contexto:** provavelmente vira vivo com T15, que é quem passa a ter a estimativa
no momento da falha. Se T15 fechar e ele continuar sem caller, deletar.
**Depende de:** T15.

---
# Fechados e verificados

Cada linha reconferida no código, não propagada do relatório que a levantou.

| Item | Commit | Prova |
|---|---|---|
| P1 — Dry-run cobra créditos por geração que nunca acontece | `bbc857b` | withImageDebit agora gated em `client.dryRun` (register.ts:269, 333, 401). |
| P1 — `media_edit_image` e `media_compose_scene` geram sem debitar | `bbc857b` | as duas passam por withImageDebit; 6 sites no total em register.ts. |
| P1 — `media-forge cost --today` sempre reporta $0.00 | `bbc857b` | o CLI lê `cost.db` via dailySpendReport/monthlySpendUsd/allTimeSpendUsd, não mais o cost.jsonl que ninguém escreve. |
| P2 — Veo, Higgsfield generate e Seedance submetem sem reserva | `c0415f9 + 13d3d37` | 21 sites de reserveVideoSubmit; Veo reserva ANTES do submit (submitVeoWithLedger); o poll do Higgsfield captura/libera. |
| P2 — Sweep do Seedance captura sem valor de crédito | `pendente de commit` | recordActualCost passa actualCredits via videoActualCredits(); o oracle devolve o valor; 5 testes, 4 ficam vermelhos se a linha sair. |
