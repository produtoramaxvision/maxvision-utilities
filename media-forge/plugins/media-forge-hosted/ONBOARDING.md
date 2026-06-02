# media-forge hosted - Primeiros Passos

## O que e

Plugin Claude Code que conecta no server hospedado MaxVision. Voce usa as ferramentas de geracao
(imagem + video) diretamente no Claude Code, sem instalar nada pesado (sem Node, sharp ou ffmpeg).

## Pre-requisito

Claude Code instalado (https://claude.ai/download).

## Passo 1 - Obter sua Bearer key

1. Acesse https://media-forge.produtoramaxvision.com.br
2. Crie sua conta (plano free disponivel: 50-100 creditos/dia, so imagem, watermark).
3. No dashboard -> **API Keys** -> **Gerar nova chave**.
4. Copie a chave (formato: `mfk_...`). Guarde em local seguro - nao e recuperavel.

## Passo 2 - Configurar a variavel de ambiente

Adicione ao seu perfil de shell (`~/.bashrc`, `~/.zshrc` ou equivalente):

```bash
export MEDIA_FORGE_API_KEY="mfk_sua_chave_aqui"
```

Recarregue o shell: `source ~/.bashrc` (ou abra um terminal novo).

Verificar:

```bash
echo $MEDIA_FORGE_API_KEY   # deve imprimir mfk_...
```

## Passo 3 - Instalar o plugin

```bash
claude plugin install media-forge-hosted@maxvision-utilities
```

Ou, se o marketplace maxvision-utilities ja estiver adicionado:

```bash
claude plugin add maxvision-utilities
claude plugin install media-forge-hosted
```

## Passo 4 - Verificar conexao

Abra o Claude Code em qualquer projeto e rode:

```
/media-forge:setup
```

O comando deve retornar as capacidades disponiveis para sua chave e o saldo de creditos.

## Perfil C1 (self-hosted licenciado)

Se voce opera seu proprio server media-forge e tem uma licenca, o plugin fino conecta no server
hospedado MaxVision por padrao (URL hardcoded). Para apontar para seu proprio server, voce tem
duas opcoes:

**Opcao A (a verificar):** defina `MEDIA_FORGE_URL` como variavel de ambiente do sistema antes
de abrir o Claude Code. Se o loader suportar interpolacao de env no campo `url`, o plugin fino
usara seu server. Verifique na documentacao do Claude Code se interpolacao de env em campos
`url` de mcpServers e suportado na versao instalada.

**Opcao B (garantida):** instale o plugin pesado stdio (`media-forge@maxvision-utilities`, que
usa `.mcp.json` com `command: node`) e configure seu server localmente. O plugin pesado nao
requer o server hospedado.

Em ambos os casos, configure `MEDIA_FORGE_LICENSE` para autenticar no seu server licenciado:

```bash
export MEDIA_FORGE_LICENSE="sua_licenca_jwt"
```

## Planos e creditos

| Plano | Preco | Creditos | Acesso |
|---|---|---|---|
| Free | Gratis | ~50-100 cr/dia | So imagem, watermark |
| Criador | R$37,90/mes | 2.500 cr/ciclo | Imagem + video (cap Veo) |
| Pack 1.500 cr | R$19,90 (Pix) | +1.500 | Avulso |
| Pack 4.200 cr | R$49,90 (Pix) | +4.200 | Avulso |
| Pack 9.000 cr | R$99,90 (Pix) | +9.000 | Avulso |

1 credito = ~$0,01 de custo base. Cada geracao mostra o debito antes de confirmar.

## Suporte

produtoramaxvision@gmail.com | https://media-forge.produtoramaxvision.com.br/suporte
