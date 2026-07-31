# TODOS

Trabalho identificado e deliberadamente adiado. Cada item tem contexto suficiente
para alguém retomar em 3 meses sem reconstruir o raciocínio.

Criado em 2026-07-29 pelo `/maxvision:plan-ceo-review` sobre
[`.maxvision/plans/2026-07-29-higgsfield-kling-api-refresh.md`](.maxvision/plans/2026-07-29-higgsfield-kling-api-refresh.md).

---

## (fechado) P1 — MuAPI submetia e nunca devolvia: caminho só de ida

**FECHADO em 2026-07-31.** O MuAPI tinha tools desde a leva anterior e ainda assim
não era usável de ponta a ponta. Quatro defeitos, nenhum visível numa suíte verde:

| Defeito | Por que passou despercebido |
|---|---|
| `handleMuapiGenerate` devolvia só o `jobId` local (`muapi-{ts}-{rand}`) | o endpoint do MuAPI é chaveado no `request_id` **dele** — o id devolvido não consultava nada |
| `pollStatus` e `download` existiam, testados, **sem nenhum chamador** | `fallow audit --production` não enxerga método órfão em classe alcançável |
| `generate()` era chamado **sem** `ledgerHooks` | único provider pago sem reserva, sem cost guard e sem contribuir para o cap diário |
| nenhum `recordJob` | job invisível no cost report, e `recordActualCost` sem linha para dar UPDATE — liquidação seria no-op silencioso |

Além disso, dois comentários afirmavam comportamento inexistente: o gate
`MEDIA_FORGE_MUAPI_ENABLED` (string lida em lugar nenhum, tools sempre
registravam) e "recordActualCostUSD here is real" (método não existia).

**Liquidação agora é fato, não derivação.** Verificado via `context7-mcp` sobre
`muapi.ai/docs/api-reference` e `/docs/credits`: tanto o corpo do submit quanto o
do poll trazem `cost { amount_usd, amount_credits, bonus_credits_used, refunded }`.
A liquidação acontece no **poll terminal**, não no submit — `refunded` é campo
documentado e o MuAPI estorna task falhada, então o valor do submit é provisório.
Task estornada liquida em 0.

**Continua não exercitado contra endpoint real** — precisa de `MUAPI_API_KEY`.
Todo teste injeta `fetch`. O que está verificado é o contrato de fio, lido da doc,
não adivinhado.

---

## (fechado) P1 — Executor de plano: os 5 módulos T10/T13 sem consumidor

**FECHADO em 2026-07-31.** Órfãos desde **2026-07-30** (`8576d20` T10, `466a144` T13).

Nunca foi entregável perdido. O T10 diz "portar os schemas", o T13 diz "a saída
alimenta o project-state do T10" — **nenhuma tarefa do plano especificou o
runner**. Cinco módulos testados, zero importadores em `src/`.

Três tools em `src/mcp/handlers/narrative-execute.ts`:

| Tool | O que faz |
|---|---|
| `media_narrative_execute_clip` | escolhe o clip, valida, monta contrato + prompt spec, devolve a tool e os argumentos para despachar. Só leitura |
| `media_narrative_record_run` | registra o despacho real (por jobId) e avança o plano |
| `media_narrative_record_take` | aplica o veredito do reviewer; opcionalmente ranqueia takes |

**O executor não despacha, de propósito.** Todo provider já tem tool de submit com
cost guard, preflight de crédito e ledger hooks. Um caminho de despacho aqui seria
um **segundo** submit por provider — a duplicação que este repo já identificou
como defeito — e mais um lugar para rotear spec a adapter que rejeita. Provider e
modelo são sempre entrada do chamador, nunca inferidos.

**O que construir o consumidor achou:** o `buildClip` descartava três campos do
storyboard — `shot_structure`, `camera` e `duration_sec`. O storyboard não é
persistido, então eram perda definitiva; e `shot_structure` é **obrigatório** no
`ClipContract`, ou seja, plano salvo não virava contrato nenhum. Só visível
tentando construir o consumidor.

**Não exercitado contra geração paga.** Por design (o despacho é das tools de
provider) e por circunstância (esta branch não gasta). Dito no cabeçalho do
handler, não deixado para supor de suíte verde.

---

## (declinado) Comprar pacote Kling para validar geração de vídeo

**DECLINADO pelo usuário em 2026-07-31:** "nao vamos comprar pacotes do kling".

Não é pendência — é decisão tomada. Registrado aqui para não voltar como item
aberto em toda auditoria.

Consequência aceita: a geração de vídeo do Kling continua validada só por teste
com `fetch` injetado. O que **foi** validado ao vivo contra a API real do Kling
são os endpoints de billing e o saldo da conta (`GET /account/costs` → `packs: 0`).
Submeter geração exige pacote pré-pago; o menor é o Trial Package a $9,80 por 100
unidades (~125s de Kling 3.0 Turbo 720p).

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

**FECHADO em 2026-07-31 — decisão: remover.** O subsistema `cost.jsonl` inteiro
saiu: escritor (`OutputManager.appendCostLog`), leitor (`getCostSummary`) e
helpers (`appendCostLogEntry`, `dailyTotal`, `monthlyTotal`, `allTimeTotal`),
mais os testes que os cobriam.

**Por que remover e não manter:** nenhum tinha caller de produção. O `bbc857b` já
tinha repontado o CLI para o SQLite porque o arquivo estava sempre vazio e o
`cost --today` reportava $0,00 sempre. Deixar uma segunda fonte de custo dormente
ao lado da viva é justamente como um caller futuro pega a errada — e esse é o
risco que este TODO levantou desde o começo.

Nenhum dos removidos estava no `src/index.ts`, então não é quebra de API pública.

**Item fechado por inteiro.**

---

## P1 — O transporte `higgsfield-cli` não alcança nenhum modelo do registry

**Achado em 2026-07-31, só por execução real.** O T5 estava marcado "feito"; o
caminho de `generate` nunca funcionou. Três defeitos empilhados:

| # | Defeito | Estado |
|---|---|---|
| 1 | `spawn('higgsfield', …, {shell:false})` não alcança a CLI no Windows — npm/pnpm instalam **shim**, e o Node responde `ENOENT` (nome puro) ou `EINVAL` (`.CMD`, desde CVE-2024-27980) | **corrigido** (`61a2651`) |
| 2 | stdin aberto: a CLI pode bloquear esperando EOF | **corrigido** (`61a2651`) |
| 3 | **Os `job_type` da CLI não existem no registry** | **aberto — e não tem correção por mapa** |

**Sobre o (3).** Os catálogos são disjuntos, não dois nomes para a mesma coisa:

| | |
|---|---|
| Registry `higgsfield` | `higgsfield-soul2`, `-dop`, `-speak`, `-recast`, `-cinema-studio-3.5`, `-marketing-studio` — produtos **próprios** do Higgsfield, modos `t2v`/`i2v` |
| CLI `--video` | `veo3_1`, `kling3_0`, `seedance_2_0`, `wan2_7` — modelos de terceiros que ele **revende**, mais utilitários |
| CLI `--image` | `text2image_soul_v2`, `soul_cast`, `soul_cinematic` — Soul existe, como tipo de **imagem** |

Nenhum id do registry é `job_type` da CLI. Prova ao vivo:
`exit 4: No model with job_type "higgsfield-soul2"`.

**Tabela de mapeamento não é a correção.** `higgsfield-soul2` é spec de vídeo,
`text2image_soul_v2` é job type de imagem — não são o mesmo modelo com dois
nomes. Inventar essa correspondência seria pior que a flag inerte.

**O que foi feito:** `providerServesSpec` voltou a ser identidade (`5899644`). A
flag `MEDIA_FORGE_HF_CLI_ENABLED` está inerte de novo — mas agora **inerte e
documentada**, com a comparação de catálogos escrita na função. Nomear
`higgsfield-cli` falha no roteador com "no model supporting mode", que é verdade,
em vez de falhar na CLI depois do cost guard já ter rodado.

**O que o transporte poderia legitimamente servir** é o catálogo revendido
(`kling3_0_turbo`, `seedance_2_0`…), mas esses estão registrados sob
`kling`/`bytedance`. Alcançá-los exige o roteador assíncrono ciente de catálogo,
já registrado neste arquivo.

**T6 (soul-id) não é afetado e está validado:** `soul-id create|list` não usa
`job_type`; `higgsfield soul-id list --json` rodou ao vivo e devolveu `[]`.

---

## (fechado) P1 — Geração de imagem do Codex nunca alcançava a CLI

**FECHADO e VALIDADO AO VIVO em 2026-07-31.** Primeira validação real de provider
desta branch: `handleCodexImage` gerou `validation-circle.png` (838 KB, modo
`builtin`, `estimateUsd: 0`), aberto e conferido — círculo vermelho em fundo
branco, exatamente o pedido.

Dois defeitos, invisíveis para teste com runner injetado:

1. **Spawn.** Mesmo bug do Higgsfield: `spawn('codex')` → `ENOENT`,
   `spawn('…\\codex.CMD')` → `EINVAL`. `shell: true` **não** é opção — o prompt é
   texto de usuário e o `cmd.exe` reinterpreta `&`, `|`, `^`, `%VAR%`.
   `src/utils/cli-binary.ts` resolve mantendo `shell:false` e o array de argv.
2. **stdin.** `codex exec` imprime *"Reading additional input from stdin…"* e
   trava para sempre num pipe que nunca chega a EOF. Medido: a mesma chamada
   passa de 600 s com pipe e sai `exit 0` em **16 s** com stdin fechado.

---

## (referência) Créditos grátis por provider — levantado em 2026-07-31

Levantado porque surgiu a lembrança de "66 créditos grátis por dia" em algum
provider.

**A origem foi encontrada, e o número é real — mas de outra coisa.** Eu disse
isso num trecho anterior desta sessão, citando uma **busca web** (fonte terceira:
`checkthat.ai/brands/kling-ai/pricing`, não a doc do Kling):

> "The Free plan gives you 66 Kling AI free credits per day — enough to generate
> roughly 6 standard-mode clips daily. Credits reset every 24 hours and do not
> roll over."

Três coisas a fixar:

1. **É Kling, não Seedance.**
2. **É o app de consumo** (`app.klingai.com/.../membership-plan`), não a API de
   desenvolvedor. São carteiras e unidades **diferentes**: o app conta em
   "credits" (6–12 por segundo, conforme o texto acima); a API conta em "units"
   a $0,14, 0,8 unidade/s em 720p. Nada converte uma na outra.
3. **O media-forge não gasta esses créditos.** Ele autentica na API de
   desenvolvedor com `KLING_API_KEY`. Os 66/dia podem ser verdade e continuam
   não financiando nada que o plugin faz.

O número **não foi conferido na fonte primária** — veio de um agregador de preços,
e a página de assinatura do Kling exige login. Fica registrado como citação de
terceiro, não como fato verificado.

O levantamento abaixo é da **API**, que é o que decide se uma geração roda.

| Provider | Grátis? | Como foi verificado |
|---|---|---|
| **Kling (API)** | **Não.** Só pacote pré-pago. O "Trial Package" é compra com 30% off ($9,80 = 100 unidades; $98 = 1.000), validade 30 dias | `kling.ai/dev/pricing`, sessão de browser |
| **Higgsfield** | **Sem concessão diária.** Uma única `grant` de 600 créditos de assinatura | `higgsfield account transactions --size 50`, conta real |
| **MuAPI** | **Nenhum crédito grátis** | `muapi.ai/docs/pricing` |
| **BytePlus (rota ARK do Seedance)** | **Trial único, não diário:** 2M tokens de vídeo + 500K por modelo, sem expirar. Existe campanha "5M tokens **diários** por modelo", mas exige verificação corporativa e o prazo era 2026-03-31 | `byteplus.com/en/activity/free` |
| **fal.ai (rota default do Seedance)** | **não resolvido** — HTTP 429 na leitura, render vazio | — |
| **Wan2GP** | N/A — roda na GPU do usuário, não existe crédito | por construção |

**Saldo real da conta de API do Kling: zero pacotes.**

```
GET /account/costs → HTTP 200, code 0, packs: 0
```

Não é questão de custo: hoje uma geração pelo Kling **falha por falta de saldo**.
A validação ponta-a-ponta precisa de um pacote comprado antes — o menor é o Trial
de $9,80 por 100 unidades, ~125 segundos de Kling 3.0 Turbo em 720p
(0,8 unidade/s).

**O que falta para fechar:** a rota fal.ai (429 na leitura) e, se houver conta
Dreamina/CapCut, o saldo diário do app de consumo — que é carteira separada e o
media-forge não gasta de qualquer forma.

---

# Bugs herdados encontrados em 2026-07-29

Achados ao implementar os cost guards. Todos verificados no código, nenhum é
suposição. Ordenados por impacto financeiro.

## P2 — Não existe executor de plano: 4 schemas do T10 seguem sem consumidor

**FECHADO em parte.** O planner narrativo passou a ser alcançável via
`media_narrative_plan` e `media_narrative_assemble` (`src/mcp/handlers/narrative.ts`).
Medido: `fallow audit --base origin/homolog --production` caiu de **20 para 10**
arquivos novos sem uso, e todo o pipeline de planejamento (`invoke`, `bounds`,
os 4 agentes de decomposição, `planner`, `project-state`, `project-state-store`,
`enums`) saiu da lista.

**O que sobrou, e por quê.** Estes 4 continuam sem consumidor:

| Arquivo | Quando seria usado |
|---|---|
| `narrative/clip-contract.ts` | ao converter um clipe do plano em pedido de geração |
| `narrative/prompt-spec.ts` | ao compilar o prompt daquele clipe |
| `narrative/generation-run.ts` | ao registrar a tentativa |
| `review/take-review.ts` | ao revisar o take gerado |
| `narrative/agents/image-selector.ts` | escolher referências antes, e o melhor take depois |

Todos pertencem ao laço **executar um plano**, não a **fazer um plano**. Nenhuma
PR deste plano especifica um executor — o T13 termina no `ProjectState` e o T11
estendeu o `router.ts`, não um executor. Então não é regressão nem esquecimento:
é uma etapa que nunca foi pedida.

**Como fechar:** uma ferramenta que pegue um `ProjectState` e execute clipe a
clipe — `clip-contract` → `prompt-spec` → submit no provider → `generation-run`
→ `take-review` → protocolo de retake do T11. É o próximo item natural, e
grande o bastante para ser uma PR própria.

**Esforço:** L (human ~2 dias / CC ~2h)
**Depende de:** decidir se o executor vive no plugin ou no orquestrador.

---

## P1 — (histórico) O planner narrativo não tinha consumidor de produção

**O quê:** 15 arquivos em `src/narrative/` e `src/review/take-review.ts` são
biblioteca testada sem ponto de entrada. **Nenhuma ferramenta MCP e nenhum
comando de CLI os invoca.** Um usuário do plugin não consegue alcançar o
narrative planner de forma alguma hoje.

**Como foi provado (2026-07-30, não suposição):**

```
pnpm exec fallow audit --base origin/homolog --production
  verdict: fail · dead_code_introduced: 134 · 20 unused_files introduzidos
```

Confirmado à mão depois: `grep -rn "from '.*narrative/" src/ | grep -v "^src/narrative/"`
retorna **uma** linha, e ela é intra-feature (`take-review.ts` importando `enums.ts`).

**O que NÃO é isso:** `src/cli/commands/setup.ts` também aparece na lista, mas é
artefato — está registrado em `cli.ts:12,30` e o comando
`node bin/media-forge setup wan2gp` foi **executado com sucesso**. O `fallow` não
rastreia o entry `bin/media-forge`, e por isso marca `cli.ts`, `cost.ts` e
`video.ts` como não-usados também, os três com `introduced: false` — ou seja, o
padrão é anterior a este trabalho.

**Por que aconteceu:** o T13 no plano especifica os 6 agentes e a saída
alimentando `project-state`, mas **não** especifica superfície de invocação.
Foi entregue conforme escrito; o que falta nunca foi pedido em lugar nenhum.

**Como fechar:** uma ferramenta MCP (ex.: `media_narrative_plan`) que receba
brief + alvo e devolva um `ProjectState`, despachando os agentes pelo caminho
`subagent | sdk` que `invoke.ts` já implementa. É o par natural do
`project-state-store` que já persiste o resultado.

**Esforço:** M (human ~3h / CC ~40min)
**Depende de:** nada. Todas as peças existem e estão testadas.

---

## (fechado) P2 — MuAPI e Wan2GP: acesso direto, ainda não roteáveis

**FECHADO em 2026-07-31** — com uma correção de enquadramento.

Os dois adapters já estavam prontos (PR7 `5aeb25a`, PR8 `cf6f19b`). O que faltava
não era roteamento: era **porta de entrada**. Nenhum dos dois tinha tool MCP, então
nenhum era alcançável pela superfície que o usuário chama. Mesmo defeito do planner
narrativo, do adapter de imagem do Codex e dos dois métodos de billing do Kling.

Cinco tools em `src/mcp/handlers/opt-in-video.ts` (três na primeira leva, mais duas
quando o MuAPI foi fechado por completo em 2026-07-31 — ver bloco abaixo):

| Tool | O que faz |
|---|---|
| `media_muapi_models` | lista o catálogo com preço e endpoint — **única** fonte de preço do MuAPI |
| `media_muapi_generate` | submete por nome exato do catálogo; devolve `jobId` **e** `requestId` |
| `media_muapi_poll` | consulta por `requestId` e liquida o custo real reportado |
| `media_muapi_download` | baixa o output pronto |
| `media_wan2gp_generate` | submete ao servidor local do usuário |

**Acesso direto continua sendo o certo, não uma limitação.** Para provider opt-in,
seleção explícita é o comportamento desejado: um servidor local a $0 vence
qualquer ordenação ascendente de custo, e quem ligou o Wan2GP para testar não
pediu que o pipeline inteiro mudasse para a GPU dele. A guarda
`isOptInOnlyProvider` existe exatamente por isso, e estas tools são a porta que
ela deliberadamente deixa aberta.

O roteamento automático continua fora, e o motivo é o mesmo de antes: os dois têm
catálogo **dinâmico** (MuAPI lista por HTTP em runtime, Wan2GP depende dos pesos
baixados na máquina). O `handleVideoRoute` ordena um registry estático de forma
síncrona. Torná-lo assíncrono e ciente de catálogo mexe em todo teste de
roteamento — PR própria, não enxerto.

**Nenhum dos dois foi exercitado contra endpoint real.** MuAPI precisa de
`MUAPI_API_KEY`; Wan2GP precisa do servidor local que o usuário optou por não
instalar. Todo teste injeta `fetch`. Afirmação mais fraca que a do Kling, onde a
API real respondeu — dita, não deixada para alguém supor de uma suíte verde.

## (histórico) P2 — MuAPI e Wan2GP: acesso direto, ainda não roteáveis

**`higgsfield-cli` FECHADO.** Era o caso com correção limpa e foi feito: ele é um
segundo **transporte** para a mesma plataforma Higgsfield, então
`providerServesSpec` (`src/mcp/handlers/shared.ts`) o mapeia sobre as specs
`higgsfield`. Antes disso a flag `MEDIA_FORGE_HF_CLI_ENABLED` **não mudava nada** —
o roteador filtrava por identidade de `spec.provider` e nenhuma spec é registrada
sob `higgsfield-cli`. Flag que não faz nada é pior que flag ausente.

Dois bugs vizinhos caíram junto, ambos achados pelo teste da correção:
- O enum de `preferProvider` estava hardcoded com os 4 providers originais
  enquanto `PROVIDERS` tinha 6, então `higgsfield-cli` era rejeitado no schema
  antes do roteador ver. Agora é derivado de `PROVIDERS`.
- Com a flag **desligada**, nomear `higgsfield-cli` ainda resolvia, porque as
  specs que ele mapeia pertencem a um provider habilitado. A preferência agora
  exige o adapter ativo.

Provado por `tests/mcp/higgsfield-cli-routing.test.ts`: mesma chamada passa com a
flag ligada e falha com ela desligada.

**O que continua aberto:** `muapi` e `wan2gp`. Não é o mesmo problema — o catálogo
dos dois é genuinamente dinâmico:

| Provider | Origem do catálogo |
|---|---|
| `muapi` | `GET /api/v1/models` em runtime — hardcodar preço de agregador é o bug que o adapter evita |
| `wan2gp` | depende de quais pesos o usuário baixou na máquina dele |

O roteador é síncrono sobre `VIDEO_MODELS`. Torná-lo assíncrono e ciente de
catálogo dinâmico mexe no caminho que **todos** os testes de roteamento cobrem —
é PR própria, não enxerto. Os dois seguem usáveis por acesso direto à classe.

**Esforço:** M (human ~4h / CC ~1h)
**Depende de:** decidir se o roteador ganha catálogo assíncrono ou se os dois
ficam como acesso direto por design.

---

## (fechado) P1 — Três providers novos não eram alcançáveis pelo roteador MCP

**O quê:** `higgsfield-cli` (T5), `muapi` (PR7) e `wan2gp` (T16) foram implementados,
testados e registrados em `PROVIDERS`, mas **nenhum** está em
`ADAPTED_PROVIDERS_BASE` (`src/mcp/handlers/shared.ts:16`, hoje
`['google', 'higgsfield', 'kling']` + `bytedance` condicional). `handleVideoRoute`
filtra candidatos por `getAdaptedProviders().has(spec.provider)`, então os três
são invisíveis para o roteamento — inclusive com `preferProvider` explícito.

**Estado real:** são clientes funcionais e cobertos por teste, usáveis de forma
direta pela classe. **Não** são usáveis pela superfície MCP de vídeo. Isso não
foi declarado nos commits de T5/PR7/T16 e está sendo corrigido aqui.

**Por que não foi só adicionar ao set:** o roteador escolhe entre entradas de
`VIDEO_MODELS`, e os três não têm entrada lá — deliberadamente:

| Provider | Por que não tem entrada estática |
|---|---|
| `muapi` | catálogo e preços vêm de `GET /api/v1/models` em runtime; hardcodar preço de agregador é justamente o bug que o adapter evita |
| `wan2gp` | os modelos dependem de quais pesos o usuário baixou na máquina dele |
| `higgsfield-cli` | mesma plataforma do adapter HTTP, mas `spec.provider` é `'higgsfield'`, então o filtro do roteador não os associa ao transporte CLI |

**Como fechar (3 caminhos, decisão pendente):**
1. Roteador passa a aceitar catálogo dinâmico por provider, não só `VIDEO_MODELS`.
2. `higgsfield-cli` reusa as specs de `higgsfield` via um campo de transporte no
   spec, em vez de um `provider` separado.
3. Manter os três como acesso direto e documentar que não são roteáveis.

**Nota:** a mitigação de custo-zero (`isOptInOnlyProvider`) está **armada mas
inerte** hoje pelo mesmo motivo — nenhum modelo roteável tem `rate: 0`. Existe um
teste que prova isso, para que ela deixe de ser inerte no instante em que um
modelo $0 for registrado.

**Esforço:** M (human ~4h / CC ~45min)
**Depende de:** escolher entre os 3 caminhos acima.

---

## (fechado) P2 — MuAPI: shape do endpoint de estimativa não verificado

**FECHADO em 2026-07-31**, via `context7-mcp` sobre `muapi.ai/docs/pricing`.

```
POST https://api.muapi.ai/api/v1/models/{model_name}/estimate-cost
{ "model": "veo3-fast", "cost": 0.64, "currency": "USD",
  "dynamic_pricing": true, "cost_strategy": "veo3-fast-t2v" }
```

**O que estava certo:** o campo `cost`. A suposição por simetria com o catálogo
acertou.

**O que estava errado, e saiu:** `cost_usd` não existe. Era um "segundo palpite
defensivo" — e fallback para uma chave que a API nunca manda não é defesa, é uma
segunda forma de errar que nenhum teste ia exercitar.

**O que faltava, e é a parte que importa:** a resposta traz `currency` e o código
**não lia**. Só o `cost_currency` do **catálogo** era conferido. São duas respostas
distintas, e a da estimativa é a que decide o que vai ser cobrado — supor que ela
herda a moeda do catálogo é como um número não-USD chega num ledger em USD. Mesma
classe do ramo `cash` do Kling. Agora recusa, nomeando a moeda.

**Continua não exercitado contra endpoint real** — precisa de `MUAPI_API_KEY` que
este repo não tem. Shape documentado é mais forte que palpite e mais fraco que
resposta.

## (histórico) P2 — MuAPI: shape do endpoint de estimativa não verificado ao vivo

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

## (fechado) P2 — Erros MCP perdiam todos os campos estruturados

**FECHADO em 2026-07-30** (`3efb6a8`). `src/mcp/handlers/plumbing.ts` agora
serializa `MediaForgeError.context` + `code` + `name` em `structuredContent`.
O texto continua byte-idêntico em `content[0]`, então nada que já lia dali
quebrou — a mudança é aditiva.

Efeito imediato: `tests/mcp/cost-guard-retake-reserve.test.ts` deixou de casar
substring e passou a afirmar `kind` e `limitUsd` direto. Era esse teste que tinha
sido enfraquecido por causa deste gap.

Registro do que era, para auditoria:

---

## (histórico) P2 — Erros MCP perdem todos os campos estruturados na serialização

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

## (fechado) P2 — `maybeStoreImageArtifact` cunha um segundo jobId

**FECHADO em 2026-07-31.** A função recebe o `jobId` do caller em vez de cunhar o
próprio, então o `job_id` devolvido nomeia a linha de `image_jobs` daquela mesma
chamada.

**Meia lacuna a mais, achada na auditoria:** `media_edit_image` e
`media_compose_scene` tinham a metade oposta do mesmo defeito — não um id errado,
**nenhum id**. As duas gravam linha no ledger e debitam crédito sob `jobId` e não
devolviam nada com que achar aquilo. Dinheiro registrado contra um id que o caller
nunca viu. As quatro tools de imagem agora devolvem `job_id`.

O teste afirma que o id **resolve para a linha** no `image_jobs` (mais
`COUNT(*) = 1`), não que duas strings são iguais: um bug que trocasse os dois ids
por um terceiro valor passaria numa igualdade simples. Provado vermelho com
`git stash` do fix: 4 falharam.

## (histórico) P2 — `maybeStoreImageArtifact` cunha um segundo jobId

**O quê:** o `job_id` devolvido ao caller não é o mesmo usado na linha de
`image_jobs`. Impossível correlacionar o que o usuário vê com o ledger.

**Onde:** `src/mcp/handlers/register.ts`.
**Esforço:** S (CC ~15min)

## (registro corrigido) P3 — Complexidade de `generate()` no Kling e Higgsfield

**A resolução declarada não aconteceu.** O texto abaixo dizia "absorvido pela
migração da API 2.0". A migração entrou (`27af171`) como `kling-v2.ts` **ao lado**
do caminho legado — o `generate()` do `kling.ts` não foi reescrito. Registro
corrigido em vez de repetido.

**Remedido em 2026-07-31** (`fallow audit --base origin/homolog`):

| Métrica | Antes | Agora |
|---|---|---|
| `dead_code_introduced` | 0 | **0** |
| `complexity_introduced` | 4 | **0** |
| `max_cyclomatic` (herdado) | 55 | 55 |

O `complexity_introduced` chegou a 2 com o `kling-deduction.ts` novo e voltou a 0
depois de limpar o que era clumsy de verdade no meu próprio código: `parseRow`
chamava `numberOrUndefined` duas vezes por campo, e o parse de envelope estava
dentro da função de transporte.

**Herdado e intocado, de propósito:** `kling.ts:785 buildRequestBody` CC=55,
`kling.ts:213 generate` CC=28. Continuam fora de escopo — a razão do texto
original vale: relocação misturada com mudança semântica piora a revisão.

**Achado novo, não construído:** `duplication_introduced: 21`, e quase tudo é
harness de teste — `makeFakeConfig` / `makeMockServer` / `getCapturedTools` /
`spyCreditClient` repetidos em 13 arquivos de `tests/mcp/`. É pré-existente; os
arquivos novos só entraram no padrão. Extrair para helper compartilhado é limpeza
legítima e mexe em 13 arquivos de teste de uma vez — PR própria, não enxerto.

## (histórico) P3 — Complexidade de `generate()` no Kling e Higgsfield subiu com o A5

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

## (parcial) P2 — Perda limitada e conhecida: erro após submit bem-sucedido

**DETECÇÃO FECHADA em 2026-07-31.** `findOrphanCharges` nomeia toda cobrança do
Kling sem linha de ledger local — que é exatamente a assinatura desta perda: o
submit passou, o provider começou a cobrar, e a escrita do ledger estourou antes
da linha existir.

**A perda em si não fecha, e não deve.** A linha falta porque escrevê-la falhou;
inventar uma coloca no histórico de custo um job sem procedência local. O relato
é deliberadamente ambíguo entre "perdemos a escrita" e "foi submetido de outra
máquina com a mesma chave" — só o operador sabe qual dos dois está olhando, e o
código diz isso em vez de escolher.

## (histórico) P2 — Perda limitada e conhecida: erro após submit bem-sucedido

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

## (fechado) P1 — media-forge fala a API legada do Kling, não a documentada (T3 reaberto)

**FECHADO em 2026-07-30 por `27af171`.** `src/video/providers/kling-v2.ts` fala o
esquema 2.0 atrás da flag `MEDIA_FORGE_KLING_V2`, com o legado intocado como
default — os dois esquemas respondem, então dá para migrar sem virada única. O
`kling-3.0-turbo` deixou de ser inalcançável, com guarda de roteamento para
modelos que só existem na 2.0.

O texto original abaixo é o diagnóstico, mantido para auditoria.

---

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

## (fechado) P1 — Os dois métodos de billing do Kling não tinham caller

**FECHADO em 2026-07-31.** `media_kling_billing_reconcile` e
`media_kling_billing_audit`, registradas e exercitadas ao vivo (0 créditos).

**O que aconteceu:** `reconcileBillingWindow` (`64c2edb`) e `auditBillingWindow`
(`8743e48`) foram entregues com teste e **nenhum caller de produção**. Eu
reportei o primeiro como fechando um P1 — ele não liquidava nada, porque nada o
chamava.

**Por que não apareceu na medição:** `fallow audit --production` deu
`dead_code_introduced: 0`, sem arquivo nem export sem uso — e estava certo. São
**métodos de uma classe que o roteador já alcança**. A ferramenta não tem como
sinalizar isso, e uma suíte verde sobre um caminho de liquidação inalcançável se
parece exatamente com um ledger funcionando.

**A regra já estava escrita** em `src/mcp/handlers/optional-providers.ts`: uma
tool, ou o código não é feature. O que faltava é que a checagem que a sustenta é
`grep` por caller fora de `tests/`, **não** o número da auditoria. Em código de
dinheiro é pior, porque "o ledger reconcilia" é o tipo de afirmação que ninguém
reconfere.

---

## (fechado) P1 — APIs de dedução e uso do Kling não são usadas

**FECHADO em 2026-07-30.** `src/video/providers/kling-billing.ts` +
`KlingProvider.reconcileBillingWindow`. O custo do Kling deixa de ser derivado do
registry e passa a vir do que o provider **efetivamente cobrou**.

**FECHADO DE VERDADE em `64c2edb`, não em `64c319f`.** O commit anterior reportou
o fecho, mas a reconciliação **nunca alcançou a API**: mandava
`GET /tasks?start_time=…`, e o `GET /tasks` aceita só `task_ids` /
`external_task_ids`. A API real responde `HTTP 400 code 1201 "task_ids or
external_task_ids is required"`. A forma de listagem é `POST /tasks` com corpo
JSON, a lista fica em `data.result[]` e a paginação em `data.next_cursor` /
`data.has_more` — os três estavam errados. Provado ao vivo, 0 créditos, antes e
depois.

Os 35 testes passavam porque cada um injetava `fetchImpl` e conferia contra uma
fixture escrita a partir do mesmo snapshot errado que o código. Fixture e fonte
concordavam; a suíte só podia confirmar que concordavam. Agora o formato da
chamada (verbo, URL, corpo) é afirmado diretamente.

**Eu estava errado sobre `/api/assets/billing-deduction`.** Escrevi que o endpoint
não existia na doc, com base numa falha do `context7-mcp`. Ele existe:

| Endpoint | Verbo | O que dá |
|---|---|---|
| `/tasks` (listagem) | `POST` | `billing[]` por tarefa: `charge_type` (`cash`/`unit`), `amount`, `package_type`, `list_price` |
| `/tasks` (por id) | `GET` | só `task_ids`/`external_task_ids`; **não** aceita janela |
| `/account/costs` | `GET` | pacotes de recurso: `total_quantity`, `remaining_quantity` |
| `/account/billing/balance` | `POST` | dedução de saldo por tarefa, **com `currency`** (`CNY`/`USD`), `list_price`, saldo antes/depois |
| `/account/billing/package` | `POST` | dedução de unidades por tarefa, com filtro por pacote |

Os dois últimos respondem `HTTP 200 code 0` nesta conta. A premissa original do
TODO estava certa e minha retratação estava errada — **segunda ocorrência** da
lição já registrada em `2026-07-30`: context7 não achar não é a doc não ter.
`https://kling.ai/document-api/llms.txt` é o índice primário de páginas e é como
essa pergunta se responde daqui em diante.

**O risco central:** `amount` não significa nada sem `charge_type`. Tarefa cobrada
em 8 **unidades** custa $1,12; o mesmo número lido como `cash` vira $8,00 — erro de
~7x, e o ledger pareceria autoritativo nas duas direções por ter vindo do provider.
`chargeToUsd` **recusa** `charge_type` desconhecido em vez de escolher um ramo.

`/account/costs` **não** é usado para liquidar job individual: a doc diz que
`remaining_quantity` atrasa 12h, então comparar cobrança fresca com saldo velho
reportaria deriva inexistente. O retorno carrega `remainingIsDelayed: true`.

**Dois bugs meus, achados no test pass:**
- `findJobByNativeTaskId` abria o banco sem `runMigrations`. Processo que só
  reconcilia (cron que nunca submete) batia em banco novo e estourava
  `no such table: video_jobs`.
- A reconciliação buscava **uma página só** e reportava sucesso. Com `has_more`
  verdadeiro, tudo além da primeira página ficava sem liquidar para sempre. Agora
  segue `next_cursor`, com teto de 50 páginas e aviso alto se truncar.

Ambos provados: RED com o bug reintroduzido, GREEN sem.

**Deriva:** divergência acima de 1% entra em `drift` e vai para `warn`. Deriva
significa que `src/core/models.ts` discorda do provider — o que torna errada também
toda **estimativa** futura, inclusive a que o cap diário usa antes do submit.

---

## (fechado) P2 — A cobrança `cash` do Kling é assumida em USD, sem confirmação

**FECHADO em 2026-07-31.** `src/video/providers/kling-deduction.ts` +
`KlingProvider.auditBillingWindow`. A suposição deixou de ser invisível: o
`auditDeductions` reporta `currenciesSeen` e `usdAssumptionHolds`, e o provider
levanta warning quando as deduções em dinheiro **não** são todas USD.

`balanceRowToUsd` **recusa** CNY em vez de aplicar câmbio — não existe fonte de FX
neste repo, e gravar CNY como dólar erra por ~7x com número do provider colado.

Dois casos de verdade-vazia foram fechados junto, os dois reportariam
"verificado" sem ter verificado nada: janela sem linha nenhuma (`[].every()` é
`true`), e janela cujas linhas **todas** omitem `currency` (filtram para fora e
sobra `[]`, também `true`). O segundo era o pior: suprimia justamente o warning
que existe para pegar esse caso. Provado vermelho reintroduzindo o bug.

## (histórico) P2 — A cobrança `cash` do Kling é assumida em USD, sem confirmação

**O quê:** `billing[]` do `POST /tasks` **não traz moeda**. `chargeToUsd` devolve o
`amount` do ramo `cash` como se fosse dólar. O enum de moeda do saldo do Kling é
`CNY` **ou** `USD` — está documentado na página Balance Deduction Detail, que
retorna `currency` justamente porque a informação não é óbvia.

**Impacto:** conta faturada em CNY grava CNY em `actual_usd` como se fosse dólar.
Erro de ~7x na direção oposta ao risco de `charge_type`, e igualmente autoritativo
por vir do provider.

**Por que ficou assim:** a conta não teve nenhuma dedução na janela sondada
(0 gerações), então a suposição é **não testada**, não confirmada. Preferi nomear
a lacuna a inventar conversão.

**Como fechar:** ler `currency` de `POST /account/billing/balance` e cruzar com o
`task_id`, em vez de assumir no `chargeToUsd`. O endpoint já responde
`HTTP 200 code 0` nesta conta.

**Esforço:** S (CC ~30min), depois da primeira geração paga.

## (fechado) P3 — `/account/billing/{balance,package}` não são usados

**FECHADO em 2026-07-31.** Os dois estão implementados em `kling-deduction.ts` e
alcançáveis por `KlingProvider.auditBillingWindow`.

**Uma armadilha que quase entrou:** os corpos de requisição dos dois endpoints
**parecem** iguais aos do `POST /tasks`, e o detector de duplicação do `fallow`
apontou isso. Unifiquei — e estava errado. Os contratos **diferem** na doc:

| | cursor sobrepõe | default de `limit` |
|---|---|---|
| `POST /tasks` | `start_time`, `end_time` | 100 |
| `POST /account/billing/*` | `start_time`, `end_time`, `filters`, **`limit`** | 500 |

Unificar mandava `limit` onde a doc chama de inválido e paginava em blocos 5x
menores. Revertido, com o motivo escrito no código. Duplicação aparente não é
duplicação quando os contratos divergem.

## (histórico) P3 — `/account/billing/{balance,package}` não são usados

**O quê:** as duas APIs de dedução existem e respondem, mas o media-forge só usa
`POST /tasks`. Elas dão o que o `/tasks` não dá: `currency`, `list_price`,
`balance_before_deduction`/`balance_after_deduction`, filtro por `api_key_name` e
por pacote de recurso.

**Por que não foi feito junto:** é um trabalho **diferente** — auditoria por conta,
não liquidação de uma tarefa que a gente já tem `native_task_id`. Construir os dois
ao mesmo tempo seria duas fontes para o mesmo número sem ninguém decidir qual manda.

**Esforço:** M (CC ~1h)

## (histórico) P1 — APIs de dedução e uso do Kling não são usadas

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

## (parcial) P1 — Roteador não sabe que o Higgsfield revende Kling e Seedance

**METADE FECHADA em 2026-07-30.** `src/video/aggregator-routes.ts` +
`alternatePaths` no `VideoRouteResult`. O roteador passou a **saber** que os dois
caminhos são o mesmo modelo e reporta o alternativo na unidade nativa dele.
`describeAlternatePaths` diz explicitamente que crédito **não** foi convertido em
dólar e que aquilo não é afirmação de mais barato — quem lê crédito ao lado de
dólar compara sozinho se o texto não recusar.

**O que continua aberto, e é decisão do usuário, não minha:** a escolha automática
entre as duas unidades. Precisa de `MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT`
declarado — o mecanismo já existe e spec em crédito sem ele já pontua Infinity e
nunca vence o sort. Enquanto não for declarado, o roteador informa em vez de
escolher.

Ficaram de fora do mapa `kling2_6` e `seedance1_5`: medidos, mas sem entrada
direta em `src/core/models.ts`, então não há segundo caminho para comparar.

**Comportamento verificado ao vivo** (`handleVideoRoute`, modo `i2v`, 5s):

| Flag | Resolução | Escolha | Alternativo reportado |
|---|---|---|---|
| V2 off | 720p | `kling/kling-v3-standard` $0,630 | higgsfield `kling3_0`, 10 créditos |
| V2 off | 1080p | `kling/kling-v3-omni` $0,700 | — (Higgsfield não revende o Omni) |
| V2 on | 720p | `kling/kling-3.0-turbo` $0,560 | higgsfield `kling3_0_turbo`, 7,5 créditos |
| V2 on | 1080p | `kling/kling-3.0-turbo` $0,700 | higgsfield `kling3_0_turbo`, 10 créditos |

**Lacuna conhecida e deliberada:** com `MEDIA_FORGE_KLING_API_V2` desligado, o
`kling-3.0-turbo` é filtrado dos candidatos (não tem endpoint legado), então o
caminho Higgsfield **dele** não aparece — mesmo o Higgsfield rodando `kling3_0_turbo`
sem depender da flag do Kling. O caller ainda vê o alternativo do modelo que foi
escolhido, então não fica cego; só não vê essa rota específica. Reportar
alternativo de candidato descartado seria oferecer uma rota que o roteador não
tomaria. Fica registrado em vez de construído.

Texto original abaixo.

---

## (histórico) P1 — Roteador não sabe que o Higgsfield revende Kling e Seedance

**O quê:** confirmado na doc oficial (`docs.higgsfield.ai/guides/video`) que a
plataforma do Higgsfield expõe modelos de terceiros nos próprios paths:
`POST /kling-video/v2.1/pro/image-to-video` e
`POST /bytedance/seedance/v1/pro/image-to-video`.

**Impacto:** o mesmo modelo subjacente é alcançável por **dois** caminhos com
preços diferentes — direto pela API do provider, ou via Higgsfield. O
`handleVideoRoute` (`src/mcp/handlers/video.ts`) ordena por custo tratando cada
provider como uma fonte distinta, então ele pode escolher o caminho mais caro para
o mesmo modelo sem perceber que são o mesmo modelo.

**Levantamento de tarifas — FEITO em 2026-07-30, 0 créditos.** `higgsfield model
list --video` e `higgsfield generate cost`, que é leitura. Confirma a revenda e dá
o preço **desta conta**:

| Modelo (job_type) | Config | Higgsfield | Kling direto |
|---|---|---|---|
| `kling3_0_turbo` | 720p 5s | 7,5 créditos | 4,0 unidades = $0,56 |
| `kling3_0_turbo` | 1080p 5s | 10 créditos | 5,0 unidades = $0,70 |
| `kling3_0_turbo` | 1080p 10s | 20 créditos | 10,0 unidades = $1,40 |
| `kling3_0` | std 5s | 10 créditos | 3,0 unidades = $0,42 |
| `kling3_0` | pro 5s | 12,5 créditos | 4,0 unidades = $0,56 |
| `kling3_0` | 4k 5s | 30 créditos | 15,0 unidades = $2,10 |
| `kling2_6` | 5s | 10 créditos | 1,5–5,0 unidades conforme áudio |
| `seedance1_5` | 720p 4s | 4,8 créditos | — |
| `seedance1_5` | 1080p 12s | 36 créditos | — |

Tarifas diretas do Kling: `kling.ai/document-api/pricing/base/video.md`
(1 unidade = $0,14, confirmado na própria tabela). Conta Higgsfield: plano `pro`,
concessão de 600 créditos/mês, 610 em saldo.

**O que continua bloqueado, e por quê:** falta o **preço em USD do crédito** no
tier `pro` — a página pública de preços só lista Starter/Plus/Ultra, e `pro` é
plano legado. Mas o bloqueio real é outro, e mais fundo: crédito Higgsfield é
**bucket pré-pago que expira todo mês**; Kling direto é **gasto medido**. O plano
(linha 369) já decidiu explicitamente **não cruzar as duas unidades**. Converter
crédito em dólar e ordenar junto é uma escolha de modelagem, não um fato — e é
exatamente a escolha que o plano proibiu.

**O que dá para fazer sem isso:** o defeito real não é o roteador escolher errado,
é ele **não saber que são o mesmo modelo**. Consciência de agregador — expor os
dois caminhos com suas unidades nativas em vez de escolher um em silêncio — fecha
isso sem dado de preço novo e sem violar a linha 369. A escolha automática entre
unidades diferentes é decisão do usuário, com conversão declarada, não inferência
minha.

**Contexto:** registrado no perfil do Higgsfield em
`skills/_shared/references/surface-prompt-profiles.md` — quando o caller pediu
Kling explicitamente, vale o perfil direto. Falta o roteador saber.

**Esforço:** M (CC ~45min) para a consciência; a ordenação cross-unidade depende de
decisão do usuário.

## (parcial) P2 — Orçamento de prompt do Seedance não verificado

**ROTA DEFAULT FECHADA em 2026-07-31.** A fal.ai publica um OpenAPI por endpoint.
Para `bytedance/seedance-2.0/text-to-video` — o slug que o adapter realmente
submete — `prompt` é `string` **sem `maxLength` e sem `minLength`**, e nenhuma
outra string de entrada tem restrição de tamanho.

`promptMaxChars: null` deixou de significar "ninguém checou" e passa a significar
"a superfície não publica limite", com `verifiedAt: '2026-07-31'`. Schema gerado
vale mais que página de prosa: é contra ele que o endpoint valida.

**Continua aberto:** a rota `ARK`-direta (`ark.ap-southeast.bytepluses.com`). A
referência de API dela não abriu em 2026-07-31. São dois publishers diferentes
servindo o mesmo modelo — o schema de um não fala pelo outro.

## (histórico) P2 — Orçamento de prompt do Seedance não verificado

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

## (fechado) P3 — `veo-interpolate` e `veo-with-refs` aceitam `negativePrompt` e nunca enviam

**FECHADO em 2026-07-30.** As duas passaram a enviar `negativePrompt` no config e
a checar o orçamento de prompt dele, igual ao `veo-t2v`/`veo-i2v`. Dois testes por
serviço: um afirma que o valor chega no config, outro que a chave fica **ausente**
quando não foi passada — enviar string vazia seria outra forma de mentir. Provados
vermelhos antes.

**Texto original:**

**O quê:** os schemas Zod das duas aceitam `negativePrompt`, mas o código nunca
repassa o campo para o config do `generateVideos`.

**Impacto:** o usuário escreve uma negativa, ela é aceita sem erro, e não tem
efeito nenhum na geração. Parâmetro que mente, mesma classe do campo `dryRun` do
request logo abaixo.

**Contexto:** achado ao ligar o enforcement de orçamento de prompt (T18) — as duas
foram os únicos caminhos do Veo onde não havia o que checar, porque nada é
submetido. Pré-existente.

**Esforço:** XS (CC ~10min)

## (fechado) P2 — O campo `dryRun` do request é ignorado por todos os serviços

**FECHADO em 2026-07-30.** `clientFor()` em `register.ts` resolve o dry-run
**efetivo** da requisição e alimenta os 4 sites de imagem e os 4 do Veo.

**Decisão tomada:** os serviços passam a ler o campo, em vez de tirá-lo dos
schemas. Tirar deixaria o caller sem o pedido; ler dá a ele o que o nome promete.

**A regra é assimétrica de propósito:** a requisição só pode **acrescentar**
dry-run, nunca remover. O campo tem `default(false)`, então toda requisição contra
um servidor em dry-run carrega `dryRun: false` — se a requisição ganhasse, um
servidor `--dry-run` geraria de verdade em toda chamada. Tem teste afirmando os
dois lados.

**Resolve para um cliente dry-run de verdade** (`createClient({dryRun:true})`), não
`{...client, dryRun:true}`: o `createClient` também instala o proxy do SDK, então
um caminho que escape de uma checagem de flag ainda assim não alcança o provider.
O `ai` é preguiçoso, então construir um não custa nada.

Provado vermelho antes: com `dryRun: true` num cliente normal e billing ligado, o
provider **era chamado** e o crédito **era reservado**.

**Texto original:**

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

## (fechado) P3 — Comentário de `handleKlingElementDelete` está incompleto

**FECHADO em 2026-07-30**, e **o TODO estava parcialmente errado**: o campo
`confirm` **existe** — `z.literal(true)` em `KlingElementDeleteInput`
(`src/mcp/schemas.ts:531`). Nada no corpo do handler o checa porque o zod barra na
validação; requisição sem ele nunca chega lá.

O que o comentário de fato omitia é a parte perigosa: `alsoDeleteRemote` tem
**default `true`**, e é ele que ramifica o delete remoto. Local é soft-delete
(`deleted_at`), remoto é irreversível. Confirmar **não** é a mesma coisa que optar
pelo delete remoto, e o default é o destrutivo. O comentário agora diz isso.

**Onde:** `src/mcp/handlers/kling.ts`.

## (fechado) P3 — `releaseVideoFailed` era export morto no call-site

**FECHADO pelo T15**, confirmado por leitura em 2026-07-30: `registerAllTools` o
invoca em **4 sites** (`register.ts:322`, `495`, `861`, `1619`). Aconteceu o que o
próprio TODO previa — o T15 é quem passou a ter a estimativa no momento da falha.
Nada a deletar.

**Texto original:**

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
