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
| `OutputManager.appendCostLog` | `<jobDir>/cost.jsonl` | **ninguém** (ver P1 abaixo) |

Além do `trace.jsonl`. Quem for fechar este TODO parte daqui, não precisa
re-derivar.

**Esforço:** S (human ~2h / CC ~15min)
**Depende de:** T10 concluída.

---

# Bugs herdados encontrados em 2026-07-29

Achados ao implementar os cost guards. Todos verificados no código, nenhum é
suposição. Ordenados por impacto financeiro.

## P1 — Dry-run cobra créditos por geração que nunca acontece

**O quê:** com billing ligado, `withImageDebit` roda incondicionalmente, inclusive
em dry-run. Reserva e captura crédito de uma chamada que nunca chega ao provider.

**Impacto:** o cliente paga por simulação. É cobrança indevida, não só desperdício.

**Contexto:** o cost guard novo já é pulado sob `client.dryRun` justamente para não
poluir o ledger com linha fantasma. O caminho de crédito ficou de fora porque já
era incondicional antes e estava fora do escopo daquele PR.

**Onde:** `src/mcp/handlers/register.ts`, os 3 sites de imagem.
**Esforço:** S (CC ~15min)

## P1 — `media_edit_image` e `media_compose_scene` geram sem debitar

**O quê:** nenhuma das duas chama `withImageDebit`. Geram, entregam o resultado,
não reservam nem capturam crédito.

**Impacto:** em modo hospedado é geração gratuita. Vazamento de receita direto.

**Onde:** `src/mcp/handlers/register.ts`. `media_edit_image` agora tem cost guard e
ledger (do PR dos guards), mas continua sem débito.
**Esforço:** S (CC ~20min)

## P1 — `media-forge cost --today` sempre reporta $0.00

**O quê:** três defeitos em cadeia:

1. `OutputManager.appendCostLog` (`src/output/output-manager.ts:273`) não tem
   nenhum caller de produção — só testes chamam
2. ele grava em `<jobDir>/cost.jsonl`, um arquivo por job
3. o CLI (`src/cli/commands/cost.ts:83,189`) lê `<projectDir>/cost.jsonl`, um
   caminho diferente que ninguém escreve

**Impacto:** comando documentado que sempre responde zero. O usuário conclui que
não gastou nada.

**Correção provável:** apontar o CLI para `dailySpendUsd` / `queryReport` no
SQLite, que agora tem imagem e vídeo, e decidir se o `cost.jsonl` continua
existindo. Ver o TODO de reconciliação acima.
**Esforço:** S (CC ~20min)

## P2 — Veo, Higgsfield generate e Seedance submetem sem reserva

**O quê:** só os 5 submits do Kling chamam `reserveVideoSubmit`. Os 4 tools do Veo,
o generate do Higgsfield e os 4 do Seedance carregam `TODO(F-E ...-billing):
DEFERRED` e não reservam nada.

**Impacto:** mesma classe do item acima, em modo hospedado. O preflight de crédito
novo também só cobre os 5 sites do Kling.

**Contexto:** o deferral é estrutural, não preguiça — `handlers.ts` documenta que a
reserva do Veo não é reconciliável sem um store de correlação submit→poll. É
exatamente o que T15 constrói.
**Depende de:** T15.

## P2 — `maybeStoreImageArtifact` cunha um segundo jobId

**O quê:** o `job_id` devolvido ao caller não é o mesmo usado na linha de
`image_jobs`. Impossível correlacionar o que o usuário vê com o ledger.

**Onde:** `src/mcp/handlers/register.ts`.
**Esforço:** S (CC ~15min)

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
