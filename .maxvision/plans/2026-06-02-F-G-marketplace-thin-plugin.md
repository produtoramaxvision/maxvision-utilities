# Fase F-G — Marketplace + Plugin Fino (media-forge hospedado)

**Data:** 2026-06-02  
**Status:** plano (pronto para executar)  
**Branch:** homolog  
**Depende de:** F-A (MCP HTTP em `https://media-forge.produtoramaxvision.com.br/mcp` com auth Bearer)  
**Exit criteria:** `claude plugin install media-forge` (ou `claude plugin install media-forge@maxvision-utilities`) conecta no server hospedado sem nenhum dep local de geração (sem sharp/ffmpeg na máquina do criador).

---

## Contexto e decisões fixadas

### Schema confirmado por evidência real (plugins suíte em produção)

Os plugins linkedin-maxvision, x-maxvision e tiktok-maxvision (instalados em `~/.claude/plugins/cache/`) confirmam o seguinte:

**`plugin.json` carrega o `mcpServers` inline** — sem `.mcp.json` separado para plugins hospedados:

```json
{
  "name": "<slug>",
  "version": "...",
  "mcpServers": {
    "<slug>": {
      "type": "http",
      "url": "https://<host>/mcp",
      "headers": {
        "Authorization": "Bearer ${VAR}",
        "X-MaxVision-License": "${VAR2}"
      }
    }
  }
}
```

- `${VAR}` interpolation funciona em `headers` — confirmado pelo linkedin/x em produção com `MAXVISION_API_KEY`.
- Sem `.mcp.json` no plugin fino: a suíte maxvision não usa `.mcp.json` para o plugin; o `plugin.json` é a fonte única.
- `$schema`: `https://json.schemastore.org/claude-code-plugin-marketplace.json` no `marketplace.json`.

### Dois artefatos distintos, não conflito

| Artefato | Onde vive | Quem usa | O que tem |
|---|---|---|---|
| **Plugin fino** (`media-forge-hosted`) | subdir novo em `media-forge/plugins/media-forge-hosted/` | criadores B (Bearer key emitida no signup) | `plugin.json` com `mcpServers type:http` + skills + agents + commands + hooks |
| **Plugin pesado stdio** (atual `media-forge/`) | `media-forge/` (intacto) | self-host C1, devs locais | `.mcp.json` stdio atual + build local + src/ |

O plugin fino não tem `src/`, `dist/`, `tsup`, `sharp`, `ffmpeg`, nem deps de geração. É só surface declarativa + `mcpServers type:http`.

### Mapeamento B vs C1 no mesmo `plugin.json`

O `plugin.json` do plugin fino serve os dois perfis via env override:

- **Perfil B (hospedado, padrão):** `MEDIA_FORGE_API_KEY` preenchida + `MEDIA_FORGE_URL` omitido (usa default da URL). `X-MaxVision-License` pode ser omitido/vazio para hosted.
- **Perfil C1 (self-host licenciado):** `MEDIA_FORGE_URL` aponta para o próprio server + `MEDIA_FORGE_LICENSE` preenchido (header `X-MaxVision-License` presente). O plugin fino é instalado da mesma forma; o criador não instala o plugin pesado.

O plugin pesado stdio continua existindo para quem quer rodar o server localmente (dev, contrib, C1 com build próprio).

### Decisão de hosting do marketplace

**Decisão: o plugin fino fica no repo `maxvision-utilities` (mesmo repo), e o `marketplace.json` existente em `.claude-plugin/marketplace.json` recebe uma nova entrada `media-forge-hosted`.**

Justificativa:
- `maxvision-utilities` já está registrado como marketplace (`produtoramaxvision/maxvision-utilities`) no `known_marketplaces.json` da instalação local com `autoUpdate: true`.
- Os plugins pesados n8n-skills, gtm-skills e media-forge (stdio) já estão nesse marketplace; o plugin fino é o 4º.
- **Não há colisão de nome**: o plugin stdio atual no marketplace tem nome `"media-forge"` (entry pesada); o plugin fino entra como `"media-forge-hosted"`. A entry `"media-forge"` permanece (self-host/dev). Decisão de naming documentada abaixo.
- Repos dedicados (como maxvision-linkedin-mcp) são justificados quando o produto tem seu próprio CI, landing, workers — F-G não precisa disso agora; quando o produto crescer para repo próprio, a entry do marketplace atualiza só o `source`.

### Naming do plugin fino: `media-forge-hosted`

- **Nome canônico escolhido: `media-forge-hosted`** — comunica claramente que é a versão hospedada, sem ambiguidade com o stdio.
- Slug MCP server: `media-forge` (mesma toolchain que o usuário já conhece — `mcp__media-forge__*` — mesmo que o plugin tenha nome diferente).
- O `plugin.json` na entry do marketplace aponta `source: ./media-forge/plugins/media-forge-hosted`.
- Alternativa descartada: renomear o plugin stdio para `media-forge-selfhost` — quebraria usuários existentes que têm o plugin instalado.

**Decisões em aberto residuais (2, não-bloqueantes para execução):**
1. Se/quando o produto crescer para repo dedicado `produtoramaxvision/media-forge-mcp`, o `source` no marketplace.json muda para esse repo. Não muda o plugin.json.
2. O header `X-MaxVision-License` no perfil B (hospedado) pode ficar vazio ou omitido — o server hospedado não o exige (F-C resolve tenant via Bearer). Incluir no `plugin.json` como campo opcional é mais limpo para o upgrade C1. **Decisão: incluir, com valor `${MEDIA_FORGE_LICENSE:-}` (default vazio).**

---

## File Structure

```
maxvision-utilities/
├── .claude-plugin/
│   └── marketplace.json                    # MODIFY: add media-forge-hosted entry
│
└── media-forge/
    ├── .mcp.json                           # UNCHANGED (stdio pesado, self-host local)
    ├── .claude-plugin/
    │   └── plugin.json                     # UNCHANGED (metadata do plugin pesado)
    │
    └── plugins/
        └── media-forge-hosted/             # NEW: plugin fino hospedado
            ├── .claude-plugin/
            │   └── plugin.json             # NEW: mcpServers type:http + metadata (sem chave hooks)
            ├── agents/                     # NEW: copy dos 14 agents do plugin pesado
            │   ├── ad-designer.md
            │   ├── character-designer.md
            │   ├── cinematic-director.md
            │   ├── enterprise-corrector.md
            │   ├── higgsfield-director.md
            │   ├── hyperrealistic-artist.md
            │   ├── kling-director.md
            │   ├── product-photographer.md
            │   ├── prompt-engineer.md
            │   ├── quality-reviewer.md
            │   ├── scene-composer.md
            │   ├── seedance-director.md
            │   ├── veo-director.md
            │   └── video-router.md
            ├── commands/                   # NEW: copy dos 10 commands
            │   ├── audit.md
            │   ├── campaign.md
            │   ├── character.md
            │   ├── cinematic.md
            │   ├── cost.md
            │   ├── create.md
            │   ├── extend.md
            │   ├── media-forge.md
            │   ├── models.md
            │   └── setup.md
            ├── skills/                     # NEW: 14 skills (mesma lista do plugin pesado)
            │   ├── audit/SKILL.md
            │   ├── brand-check/SKILL.md
            │   ├── campaign/SKILL.md
            │   ├── capability-matrix/SKILL.md
            │   ├── character-sheet/SKILL.md
            │   ├── cinematic-short/SKILL.md
            │   ├── create/SKILL.md
            │   ├── extend-video/SKILL.md
            │   ├── higgsfield-prompting/SKILL.md
            │   ├── kling-prompting/SKILL.md
            │   ├── ocr-validate/SKILL.md
            │   ├── scene-compose/SKILL.md
            │   ├── seedance-prompting/SKILL.md
            │   └── setup/SKILL.md
            ├── README.md                   # NEW: onboarding doc
            └── ONBOARDING.md               # NEW: guia passo-a-passo (obter key → set env → install)
```

**Nota sobre duplicação agents/commands/skills:** o plugin fino copia (não symlink) os arquivos de surface do plugin pesado. Symlinks não funcionam de forma confiável em repos Git multiplataforma. A estratégia de longo prazo é mover a surface para um diretório compartilhado `media-forge/surface/` referenciado por ambos — isso é trabalho de refactor fora do escopo de F-G. F-G usa cópia. Qualquer atualização de skill/agent durante F-G aplica nos dois lugares via script (Task 6 tem o comando de sincronização).

---

## Tasks

### Task 1 — `plugin.json` do plugin fino (schema + TDD)

**Objetivo:** criar `media-forge/plugins/media-forge-hosted/.claude-plugin/plugin.json` com o schema real da suíte, mcpServers type:http, e um teste de validação de schema.

**Files:**
- Create: `media-forge/plugins/media-forge-hosted/.claude-plugin/plugin.json`
- Create: `media-forge/tests/unit/plugin-thin/plugin-json.test.ts`

**Step 1: Criar diretório e plugin.json**

```json
// media-forge/plugins/media-forge-hosted/.claude-plugin/plugin.json
{
  "name": "media-forge-hosted",
  "version": "0.1.0",
  "description": "media-forge hosted edition — image and video generation via MaxVision cloud. Google Imagen 4 / Veo 3.1 / Nano Banana Pro + Higgsfield / Kling 3.0 / Seedance 2.0. Connect with your Bearer key, zero local deps.",
  "author": {
    "name": "Produtora MaxVision",
    "email": "produtoramaxvision@gmail.com",
    "url": "https://produtoramaxvision.com.br"
  },
  "homepage": "https://media-forge.produtoramaxvision.com.br",
  "repository": "https://github.com/produtoramaxvision/maxvision-utilities/tree/main/media-forge/plugins/media-forge-hosted",
  "license": "AGPL-3.0",
  "keywords": [
    "image-generation",
    "video-generation",
    "veo-3.1",
    "imagen-4",
    "nano-banana-pro",
    "higgsfield",
    "kling",
    "seedance",
    "mcp",
    "hosted"
  ],
  "mcpServers": {
    "media-forge": {
      "type": "http",
      "url": "https://media-forge.produtoramaxvision.com.br/mcp",
      "headers": {
        "Authorization": "Bearer ${MEDIA_FORGE_API_KEY}",
        "X-MaxVision-License": "${MEDIA_FORGE_LICENSE:-}"
      }
    }
  }
}
```

**Nota sobre `url` estática vs override C1:** a `url` é hardcoded seguindo o padrão confirmado em 3/3 plugins da suíte em produção (linkedin/x/tiktok — todos com URL estática). `${VAR}` é confirmado apenas em `headers`. Para o perfil C1 que precisa apontar o plugin fino para seu próprio server, o caminho correto é definir `MEDIA_FORGE_URL` como env var do sistema e o loader Claude Code substitui ao montar o server — **isso deve ser verificado pelo executor contra o loader atual antes de documentar como garantido**. Se o loader não suportar interpolação em `url`, C1 no plugin fino exige instalar o plugin pesado (que usa stdio local). Enquanto não verificado, o ONBOARDING.md documenta C1 com nota de "verificar suporte a MEDIA_FORGE_URL override" em vez de afirmar que funciona.

**Step 2: Teste de validação de schema (TDD)**

```ts
// media-forge/tests/unit/plugin-thin/plugin-json.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(__dir, '../../../plugins/media-forge-hosted/.claude-plugin');
const raw = readFileSync(join(pluginRoot, 'plugin.json'), 'utf-8');
const plugin = JSON.parse(raw) as Record<string, unknown>;

describe('media-forge-hosted plugin.json — schema', () => {
  it('name is media-forge-hosted', () => {
    expect(plugin['name']).toBe('media-forge-hosted');
  });

  it('mcpServers.media-forge.type is http', () => {
    const servers = plugin['mcpServers'] as Record<string, Record<string, unknown>>;
    expect(servers?.['media-forge']?.['type']).toBe('http');
  });

  it('mcpServers.media-forge.url is the canonical hosted URL (static, no interpolation)', () => {
    const servers = plugin['mcpServers'] as Record<string, Record<string, unknown>>;
    const url = servers?.['media-forge']?.['url'] as string;
    expect(url).toBe('https://media-forge.produtoramaxvision.com.br/mcp');
  });

  it('mcpServers.media-forge.headers.Authorization uses MEDIA_FORGE_API_KEY', () => {
    const servers = plugin['mcpServers'] as Record<string, Record<string, unknown>>;
    const headers = servers?.['media-forge']?.['headers'] as Record<string, string>;
    expect(headers?.['Authorization']).toMatch(/Bearer.*MEDIA_FORGE_API_KEY/);
  });

  it('mcpServers.media-forge.headers has X-MaxVision-License', () => {
    const servers = plugin['mcpServers'] as Record<string, Record<string, unknown>>;
    const headers = servers?.['media-forge']?.['headers'] as Record<string, string>;
    expect(headers?.['X-MaxVision-License']).toBeDefined();
  });

  it('has no command/args/env (is not a stdio plugin)', () => {
    const servers = plugin['mcpServers'] as Record<string, Record<string, unknown>>;
    const server = servers?.['media-forge'];
    expect(server?.['command']).toBeUndefined();
    expect(server?.['args']).toBeUndefined();
    expect(server?.['env']).toBeUndefined();
  });

  it('version semver present', () => {
    expect((plugin['version'] as string)).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('author.email is produtoramaxvision@gmail.com', () => {
    const author = plugin['author'] as Record<string, string>;
    expect(author?.['email']).toBe('produtoramaxvision@gmail.com');
  });
});
```

**Step 3: Rodar — falha antes do arquivo existir**

```powershell
cd C:\Users\MaxVision\Desktop\cursor-oficial\maxvision-utilities\media-forge
pnpm vitest run tests/unit/plugin-thin/plugin-json.test.ts
```

Expected: FAIL (arquivo não existe ou módulo não encontrado).

**Step 4: Criar o arquivo e rodar — passa**

Após criar o `plugin.json` do Step 1:

```powershell
pnpm vitest run tests/unit/plugin-thin/plugin-json.test.ts
```

Expected: PASS (8 testes).

**Step 5: Typecheck**

```powershell
cd C:\Users\MaxVision\Desktop\cursor-oficial\maxvision-utilities\media-forge
pnpm typecheck
```

Expected: clean.

**Step 6: Commit**

```powershell
git add media-forge/plugins/media-forge-hosted/.claude-plugin/plugin.json
git add media-forge/tests/unit/plugin-thin/plugin-json.test.ts
git commit -m "feat(plugin-thin): add media-forge-hosted plugin.json with type:http mcpServer"
```

---

### Task 2 — Surface declarativa do plugin fino (agents, commands, skills, hooks)

**Objetivo:** popular o plugin fino com a surface completa (14 agents, 10 commands, 14 skills), copiada do plugin pesado. Nenhum código novo — só organização de arquivos. Sem `hooks/` neste plugin: o plugin fino não executa hooks client-side (nenhum `inject-refs.mjs`, `trace-injection.sh` ou similares que dependem do ambiente stdio local); hooks de ciclo de vida serão adicionados em F-C quando o middleware de tenancy tiver um `session-start.sh` real para verificar chave/saldo.

**Files:**
- Copy: `media-forge/agents/*.md` → `media-forge/plugins/media-forge-hosted/agents/`
- Copy: `media-forge/commands/*.md` → `media-forge/plugins/media-forge-hosted/commands/`
- Copy: `media-forge/skills/*/SKILL.md` → `media-forge/plugins/media-forge-hosted/skills/*/SKILL.md`

**Step 1: Script de cópia (PowerShell, idempotente)**

Execução única para popular o plugin fino. Verificação: todos os arquivos presentes após rodar.

```powershell
# Rodar de: C:\Users\MaxVision\Desktop\cursor-oficial\maxvision-utilities
$src = "media-forge"
$dst = "media-forge/plugins/media-forge-hosted"

# agents (14 arquivos .md, exceto .gitkeep)
New-Item -ItemType Directory -Force -Path "$dst/agents" | Out-Null
Get-ChildItem "$src/agents/*.md" | Copy-Item -Destination "$dst/agents/"

# commands (10 arquivos .md, exceto .gitkeep)
New-Item -ItemType Directory -Force -Path "$dst/commands" | Out-Null
Get-ChildItem "$src/commands/*.md" | Copy-Item -Destination "$dst/commands/"

# skills (14 diretórios, cada um com SKILL.md)
foreach ($skillDir in (Get-ChildItem "$src/skills" -Directory | Where-Object { $_.Name -ne '.gitkeep' })) {
  $skillDst = "$dst/skills/$($skillDir.Name)"
  New-Item -ItemType Directory -Force -Path $skillDst | Out-Null
  Copy-Item "$($skillDir.FullName)/SKILL.md" -Destination "$skillDst/SKILL.md"
}

Write-Output "Done. Verifying counts..."
Write-Output "Agents: $((Get-ChildItem '$dst/agents/*.md').Count) (expected 14)"
Write-Output "Commands: $((Get-ChildItem '$dst/commands/*.md').Count) (expected 10)"
Write-Output "Skills: $((Get-ChildItem '$dst/skills' -Directory).Count) (expected 14)"
```

Expected output:
```
Done. Verifying counts...
Agents: 14 (expected 14)
Commands: 10 (expected 10)
Skills: 14 (expected 14)
```

**Step 2: Verificação por contagem**

```powershell
$dst = "C:\Users\MaxVision\Desktop\cursor-oficial\maxvision-utilities\media-forge\plugins\media-forge-hosted"
$agents = (Get-ChildItem "$dst\agents\*.md").Count
$commands = (Get-ChildItem "$dst\commands\*.md").Count
$skills = (Get-ChildItem "$dst\skills" -Directory).Count
if ($agents -eq 14 -and $commands -eq 10 -and $skills -eq 14) {
  Write-Output "PASS: surface counts correct"
} else {
  Write-Error "FAIL: expected 14/10/14, got $agents/$commands/$skills"
  exit 1
}
```

**Step 3: Commit**

```powershell
git add media-forge/plugins/media-forge-hosted/agents/
git add media-forge/plugins/media-forge-hosted/commands/
git add media-forge/plugins/media-forge-hosted/skills/
git commit -m "feat(plugin-thin): copy declarative surface (14 agents, 10 commands, 14 skills)"
```

---

### Task 3 — `marketplace.json` (entry do plugin fino)

**Objetivo:** adicionar a entry `media-forge-hosted` ao `marketplace.json` do repo `maxvision-utilities` com o schema oficial (`$schema` do schemastore) e a validação por teste de schema.

**Files:**
- Modify: `.claude-plugin/marketplace.json`
- Create: `media-forge/tests/unit/plugin-thin/marketplace-json.test.ts`

**Step 1: Teste de schema que falha**

```ts
// media-forge/tests/unit/plugin-thin/marketplace-json.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
// marketplace.json fica na raiz do repo, 3 níveis acima de tests/unit/plugin-thin/
const repoRoot = join(__dir, '../../../..');
const raw = readFileSync(join(repoRoot, '.claude-plugin/marketplace.json'), 'utf-8');
const marketplace = JSON.parse(raw) as Record<string, unknown>;
const plugins = marketplace['plugins'] as Array<Record<string, unknown>>;

describe('marketplace.json — schema', () => {
  it('has $schema pointing to schemastore', () => {
    expect(marketplace['$schema']).toBe('https://json.schemastore.org/claude-code-plugin-marketplace.json');
  });

  it('has media-forge-hosted entry', () => {
    const entry = plugins.find((p) => p['name'] === 'media-forge-hosted');
    expect(entry).toBeDefined();
  });

  it('media-forge-hosted source points to media-forge/plugins/media-forge-hosted', () => {
    const entry = plugins.find((p) => p['name'] === 'media-forge-hosted');
    expect(entry?.['source']).toBe('./media-forge/plugins/media-forge-hosted');
  });

  it('media-forge-hosted has version', () => {
    const entry = plugins.find((p) => p['name'] === 'media-forge-hosted');
    expect((entry?.['version'] as string)).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('media-forge-hosted has category', () => {
    const entry = plugins.find((p) => p['name'] === 'media-forge-hosted');
    expect(entry?.['category']).toBeDefined();
  });

  it('original media-forge entry still present (backward compat)', () => {
    const entry = plugins.find((p) => p['name'] === 'media-forge');
    expect(entry).toBeDefined();
  });

  it('marketplace name is maxvision-utilities', () => {
    expect(marketplace['name']).toBe('maxvision-utilities');
  });
});
```

**Step 2: Rodar — falha (entry não existe, sem $schema)**

```powershell
cd C:\Users\MaxVision\Desktop\cursor-oficial\maxvision-utilities\media-forge
pnpm vitest run tests/unit/plugin-thin/marketplace-json.test.ts
```

Expected: FAIL (entry `media-forge-hosted` não existe; sem `$schema`).

**Step 3: Atualizar `.claude-plugin/marketplace.json`**

```json
// .claude-plugin/marketplace.json (arquivo completo atualizado)
{
  "$schema": "https://json.schemastore.org/claude-code-plugin-marketplace.json",
  "name": "maxvision-utilities",
  "owner": {
    "name": "Produtora MaxVision",
    "email": "produtoramaxvision@gmail.com",
    "url": "https://github.com/produtoramaxvision"
  },
  "metadata": {
    "description": "MaxVision's curated Claude Code marketplace — production-grade skills for n8n workflows, Google Tag Manager API, media-forge hosted edition, and more.",
    "version": "0.2.0"
  },
  "plugins": [
    {
      "name": "n8n-skills",
      "description": "7 expert skills for building flawless n8n workflows in Claude Code",
      "source": "./n8n-skills",
      "strict": true,
      "skills": [
        "./skills/n8n-code-javascript",
        "./skills/n8n-code-python",
        "./skills/n8n-expression-syntax",
        "./skills/n8n-mcp-tools-expert",
        "./skills/n8n-node-configuration",
        "./skills/n8n-validation-expert",
        "./skills/n8n-workflow-patterns"
      ]
    },
    {
      "name": "gtm-skills",
      "description": "Google Tag Manager API expert skill — create, update, delete, and publish tags, triggers, and variables programmatically",
      "source": "./gtm-skills",
      "strict": true,
      "skills": [
        "./skills/gtm-api"
      ]
    },
    {
      "name": "media-forge",
      "description": "media-forge self-host edition — stdio plugin for local MCP server. Requires local build (Node + sharp + ffmpeg). For devs and self-hosted C1. See media-forge-hosted for zero-dep cloud edition.",
      "source": "./media-forge",
      "strict": true,
      "skills": [
        "./skills/audit",
        "./skills/brand-check",
        "./skills/campaign",
        "./skills/capability-matrix",
        "./skills/character-sheet",
        "./skills/cinematic-short",
        "./skills/create",
        "./skills/extend-video",
        "./skills/higgsfield-prompting",
        "./skills/kling-prompting",
        "./skills/ocr-validate",
        "./skills/scene-compose",
        "./skills/seedance-prompting",
        "./skills/setup"
      ]
    },
    {
      "name": "media-forge-hosted",
      "description": "media-forge hosted edition — image and video generation via MaxVision cloud. Google Imagen 4 / Veo 3.1 / Nano Banana Pro + Higgsfield / Kling 3.0 / Seedance 2.0. Zero local deps: just set MEDIA_FORGE_API_KEY. Free tier (watermark) + Criador R$37,90/mês + packs de crédito avulsos.",
      "source": "./media-forge/plugins/media-forge-hosted",
      "version": "0.1.0",
      "category": "productivity",
      "keywords": [
        "image-generation",
        "video-generation",
        "veo-3.1",
        "imagen-4",
        "mcp",
        "hosted",
        "credits"
      ],
      "author": {
        "name": "Produtora MaxVision",
        "email": "produtoramaxvision@gmail.com"
      },
      "homepage": "https://media-forge.produtoramaxvision.com.br",
      "license": "AGPL-3.0"
    }
  ]
}
```

**Step 4: Rodar — passa**

```powershell
pnpm vitest run tests/unit/plugin-thin/marketplace-json.test.ts
```

Expected: PASS (7 testes).

**Step 5: Verificação declarativa (marketplace válido pelo loader)**

```powershell
# Confirmar que o Claude Code reconhece a nova entry
# (requer Claude Code instalado — rodar se disponível; senão a CI valida)
claude plugin list 2>&1 | Select-String "media-forge"
```

Expected: listar tanto `media-forge` quanto `media-forge-hosted` como available no marketplace maxvision-utilities.

**Step 6: Commit**

```powershell
git add .claude-plugin/marketplace.json
git add media-forge/tests/unit/plugin-thin/marketplace-json.test.ts
git commit -m "feat(marketplace): add media-forge-hosted entry to maxvision-utilities marketplace"
```

---

### Task 4 — README + ONBOARDING do plugin fino

**Objetivo:** criar documentação de onboarding que guia o criador desde o signup até o plugin conectado, e o README de contexto do plugin fino.

**Files:**
- Create: `media-forge/plugins/media-forge-hosted/ONBOARDING.md`
- Create: `media-forge/plugins/media-forge-hosted/README.md`

**Step 1: Criar ONBOARDING.md**

```markdown
// media-forge/plugins/media-forge-hosted/ONBOARDING.md
# media-forge hosted — Primeiros Passos

## O que é

Plugin Claude Code que conecta no server hospedado MaxVision. Você usa as ferramentas de geração
(imagem + vídeo) diretamente no Claude Code, sem instalar nada pesado (sem Node, sharp ou ffmpeg).

## Pré-requisito

Claude Code instalado (https://claude.ai/download).

## Passo 1 — Obter sua Bearer key

1. Acesse https://media-forge.produtoramaxvision.com.br
2. Crie sua conta (plano free disponível: 50–100 créditos/dia, só imagem, watermark).
3. No dashboard → **API Keys** → **Gerar nova chave**.
4. Copie a chave (formato: `mfk_...`). Guarde em local seguro — não é recuperável.

## Passo 2 — Configurar a variável de ambiente

Adicione ao seu perfil de shell (`~/.bashrc`, `~/.zshrc` ou equivalente):

```bash
export MEDIA_FORGE_API_KEY="mfk_sua_chave_aqui"
```

Recarregue o shell: `source ~/.bashrc` (ou abra um terminal novo).

Verificar:
```bash
echo $MEDIA_FORGE_API_KEY   # deve imprimir mfk_...
```

## Passo 3 — Instalar o plugin

```bash
claude plugin install media-forge-hosted@maxvision-utilities
```

Ou, se o marketplace maxvision-utilities já estiver adicionado:

```bash
claude plugin add maxvision-utilities
claude plugin install media-forge-hosted
```

## Passo 4 — Verificar conexão

Abra o Claude Code em qualquer projeto e rode:

```
/media-forge:setup
```

O comando deve retornar as capacidades disponíveis para sua chave e o saldo de créditos.

## Perfil C1 (self-hosted licenciado)

Se você opera seu próprio server media-forge e tem uma licença, o plugin fino conecta no server
hospedado MaxVision por padrão (URL hardcoded). Para apontar para seu próprio server, você tem
duas opções:

**Opção A (a verificar):** defina `MEDIA_FORGE_URL` como variável de ambiente do sistema antes
de abrir o Claude Code. Se o loader suportar interpolação de env no campo `url`, o plugin fino
usará seu server. Verifique na documentação do Claude Code se `${MEDIA_FORGE_URL}` em campos
`url` de mcpServers é suportado na versão instalada.

**Opção B (garantida):** instale o plugin pesado stdio (`media-forge@maxvision-utilities`, que
usa `.mcp.json` com `command: node`) e configure seu server localmente. O plugin pesado não
requer o server hospedado.

Em ambos os casos, configure `MEDIA_FORGE_LICENSE` para autenticar no seu server licenciado:

```bash
export MEDIA_FORGE_LICENSE="sua_licenca_jwt"
```

## Planos e créditos

| Plano | Preço | Créditos | Acesso |
|---|---|---|---|
| Free | Grátis | ~50–100 cr/dia | Só imagem, watermark |
| Criador | R$37,90/mês | 2.500 cr/ciclo | Imagem + vídeo (cap Veo) |
| Pack 1.500 cr | R$19,90 (Pix) | +1.500 | Avulso |
| Pack 4.200 cr | R$49,90 (Pix) | +4.200 | Avulso |
| Pack 9.000 cr | R$99,90 (Pix) | +9.000 | Avulso |

1 crédito ≈ $0,01 de custo base. Cada geração mostra o débito antes de confirmar.

## Suporte

produtoramaxvision@gmail.com | https://media-forge.produtoramaxvision.com.br/suporte
```

**Step 2: Criar README.md**

```markdown
// media-forge/plugins/media-forge-hosted/README.md
# media-forge-hosted

Plugin Claude Code (edition hospedada) do media-forge — geração de imagem e vídeo via server
MaxVision. Zero deps locais: instale, configure a key, gere.

**Guia de instalação:** ver [ONBOARDING.md](./ONBOARDING.md).

**Plugin self-host (C1):** ver [`media-forge`](../../) (plugin pesado com build local).

**Homepage:** https://media-forge.produtoramaxvision.com.br
```

**Step 3: Commit**

```powershell
git add media-forge/plugins/media-forge-hosted/ONBOARDING.md
git add media-forge/plugins/media-forge-hosted/README.md
git commit -m "docs(plugin-thin): add ONBOARDING.md and README for media-forge-hosted"
```

---

### Task 5 — Smoke test de instalação do plugin fino

**Objetivo:** verificar que o plugin fino pode ser instalado via `claude plugin install` e que a conexão com o server F-A é estabelecida (F-A deve estar vivo em `https://media-forge.produtoramaxvision.com.br/mcp`).

**Pré-requisito:** F-A deployado e health check passando. Se F-A não estiver no ar, rodar o smoke local com `MEDIA_FORGE_URL=http://localhost:8787/mcp`.

**Step 1: Verificar health do server**

```powershell
Invoke-WebRequest -Uri "https://media-forge.produtoramaxvision.com.br/health" -UseBasicParsing | Select-Object StatusCode, Content
```

Expected: `StatusCode: 200`, `Content: {"ok":true}`.

**Step 2: Instalar o plugin fino (usuário test)**

```bash
# Em um Claude Code limpo (ou profile de teste)
export MEDIA_FORGE_API_KEY="<chave-de-teste-valida>"
claude plugin install media-forge-hosted@maxvision-utilities
```

Expected: instalação sem erro.

**Step 3: Confirmar MCP server conectado**

```bash
claude mcp list 2>&1 | grep media-forge
```

Expected: `media-forge` listado como server HTTP ativo.

**Step 4: Verificar que não há deps locais de geração**

```powershell
# O diretório de instalação do plugin fino não deve ter node_modules com sharp/ffmpeg
$pluginCache = "$env:USERPROFILE\.claude\plugins\cache\maxvision-utilities\media-forge-hosted"
if (Test-Path "$pluginCache\node_modules\sharp") {
  Write-Error "FAIL: sharp encontrado no plugin fino — plugin não é realmente fino"
  exit 1
} else {
  Write-Output "PASS: nenhum dep de geração local"
}
```

Expected: `PASS: nenhum dep de geração local`.

**Step 5: Primeiro tool call (smoke MCP)**

```bash
# No Claude Code com o plugin instalado
/media-forge:setup
```

Expected: resposta do server com saldo de créditos e capacidades disponíveis (prova de conexão).

**Step 6: Commit do resultado do smoke (nota em arquivo de verificação)**

```powershell
# Criar arquivo de evidência de smoke (não é código, é verificação)
# Nota: este arquivo NÃO vai para o repo — é evidência local do executor.
# O commit vai no log do PR como evidência de que o smoke passou.
git commit --allow-empty -m "test(plugin-thin): F-G smoke passed — plugin-thin connects to hosted server"
```

---

### Task 6 — Sincronização de surface (script de manutenção)

**Objetivo:** criar um script de sincronização que mantém o plugin fino atualizado quando o plugin pesado receber novos agents/commands/skills, sem duplicação manual.

**Files:**
- Create: `media-forge/scripts/sync-thin-plugin.ps1`
- Create: `media-forge/scripts/sync-thin-plugin.sh`

**Step 1: Criar sync-thin-plugin.ps1 (Windows/CI PowerShell)**

```powershell
# media-forge/scripts/sync-thin-plugin.ps1
# Sincroniza surface do plugin pesado -> plugin fino.
# Uso: powershell -File scripts/sync-thin-plugin.ps1
# Rodar de: media-forge/

param(
  [string]$SrcRoot = ".",
  [string]$DstRoot = "./plugins/media-forge-hosted"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Sync-Dir {
  param([string]$Src, [string]$Dst, [string]$Filter = "*.md")
  New-Item -ItemType Directory -Force -Path $Dst | Out-Null
  Get-ChildItem "$Src/$Filter" | ForEach-Object {
    Copy-Item $_.FullName -Destination "$Dst/$($_.Name)" -Force
    Write-Output "  synced: $($_.Name)"
  }
}

Write-Output "Syncing agents..."
Sync-Dir -Src "$SrcRoot/agents" -Dst "$DstRoot/agents"

Write-Output "Syncing commands..."
Sync-Dir -Src "$SrcRoot/commands" -Dst "$DstRoot/commands"

Write-Output "Syncing skills..."
Get-ChildItem "$SrcRoot/skills" -Directory | Where-Object { $_.Name -notlike '.*' } | ForEach-Object {
  $skillDst = "$DstRoot/skills/$($_.Name)"
  New-Item -ItemType Directory -Force -Path $skillDst | Out-Null
  if (Test-Path "$($_.FullName)/SKILL.md") {
    Copy-Item "$($_.FullName)/SKILL.md" -Destination "$skillDst/SKILL.md" -Force
    Write-Output "  synced: $($_.Name)/SKILL.md"
  }
}

$agents = (Get-ChildItem "$DstRoot/agents/*.md").Count
$commands = (Get-ChildItem "$DstRoot/commands/*.md").Count
$skills = (Get-ChildItem "$DstRoot/skills" -Directory).Count
Write-Output "Done: $agents agents, $commands commands, $skills skills"
```

**Step 2: Criar sync-thin-plugin.sh (bash, para CI Linux)**

```bash
#!/usr/bin/env bash
# media-forge/scripts/sync-thin-plugin.sh
# Uso: bash scripts/sync-thin-plugin.sh
# Rodar de: media-forge/
set -euo pipefail

SRC="."
DST="./plugins/media-forge-hosted"

sync_dir() {
  local src="$1" dst="$2" ext="${3:-*.md}"
  mkdir -p "$dst"
  for f in "$src"/$ext; do
    [ -f "$f" ] || continue
    cp -f "$f" "$dst/$(basename "$f")"
    echo "  synced: $(basename "$f")"
  done
}

echo "Syncing agents..."
sync_dir "$SRC/agents" "$DST/agents"

echo "Syncing commands..."
sync_dir "$SRC/commands" "$DST/commands"

echo "Syncing skills..."
for skill_dir in "$SRC/skills"/*/; do
  name=$(basename "$skill_dir")
  [[ "$name" == .* ]] && continue
  mkdir -p "$DST/skills/$name"
  if [ -f "$skill_dir/SKILL.md" ]; then
    cp -f "$skill_dir/SKILL.md" "$DST/skills/$name/SKILL.md"
    echo "  synced: $name/SKILL.md"
  fi
done

agents=$(find "$DST/agents" -name "*.md" | wc -l)
commands=$(find "$DST/commands" -name "*.md" | wc -l)
skills=$(find "$DST/skills" -mindepth 1 -maxdepth 1 -type d | wc -l)
echo "Done: $agents agents, $commands commands, $skills skills"
```

**Step 3: Verificação do script**

```powershell
cd C:\Users\MaxVision\Desktop\cursor-oficial\maxvision-utilities\media-forge
powershell -File scripts/sync-thin-plugin.ps1
```

Expected: output com contagens corretas (14/10/14), sem erros.

**Step 4: Commit**

```powershell
git add media-forge/scripts/sync-thin-plugin.ps1
git add media-forge/scripts/sync-thin-plugin.sh
git commit -m "chore(plugin-thin): add sync-thin-plugin scripts (surface maintenance)"
```

---

### Task 7 — Suite completa + gates de PR

**Objetivo:** confirmar que toda a suite passa (testes existentes + novos testes de plugin fino), typecheck e lint limpos.

**Step 1: Executar suite completa**

```powershell
cd C:\Users\MaxVision\Desktop\cursor-oficial\maxvision-utilities\media-forge
pnpm typecheck && pnpm lint && pnpm test
```

Expected: todos os testes passam. Cobertura dos testes novos (plugin-json.test.ts + marketplace-json.test.ts) não exige threshold alto pois são testes declarativos de JSON; os testes unitários de http (F-A) já cobrem o core.

**Step 2: Fallow gate**

```powershell
cd C:\Users\MaxVision\Desktop\cursor-oficial\maxvision-utilities\media-forge
pnpm exec fallow audit --format json --quiet
```

Expected: verdict `pass` ou `warn` (não `fail`). O plugin fino não adiciona código TypeScript novo, então não deve introduzir issues de dead-code ou complexidade.

**Step 3: Verificar que o plugin pesado stdio não foi alterado**

```powershell
# .mcp.json do plugin pesado deve ser idêntico ao original
git diff HEAD media-forge/.mcp.json
```

Expected: sem diff (arquivo intocado).

```powershell
git diff HEAD media-forge/.claude-plugin/plugin.json
```

Expected: sem diff (arquivo intocado).

**Step 4: Commit final de F-G**

```powershell
git add --all
git status  # confirmar que só os arquivos esperados estão staged
git commit -m "feat(F-G): marketplace + thin plugin complete — media-forge-hosted connects to hosted server"
```

---

## Self-Review

### Spec coverage

| Requisito da spec | Coberto em | Status |
|---|---|---|
| `.mcp.json` fino `type:http` com url + Bearer + X-MaxVision-License | Task 1 (plugin.json com mcpServers inline) | OK — schema confirmado pelo linkedin/x/tiktok em produção; sem `.mcp.json` separado |
| `plugin.json` do plugin fino sem deps de geração | Task 1 + Task 5 Step 4 (smoke sem sharp) | OK |
| `marketplace.json` entry + hosting | Task 3 | OK — maxvision-utilities existente; sem repo novo necessário |
| Fluxo de onboarding (criador instala → key → conecta) | Task 4 (ONBOARDING.md) | OK |
| Separação plugin pesado (stdio) × plugin fino | File Structure + Task 2 | OK — pesado intocado |
| C1 variant (self-host com MEDIA_FORGE_URL + licença) | ONBOARDING.md Task 4 | OK — Opção A (env override, a verificar no loader) + Opção B (plugin pesado, garantida) documentadas |
| TDD onde aplicável (JSON schema) | Tasks 1 + 3 (8 + 7 testes) | OK — valida contra campos reais do schema |
| Verificação declarativa por comando | Task 3 Step 5 (`claude plugin list`) + Task 5 Step 3 (`claude mcp list`) | OK |
| Commits Conventional inglês | Todos os commits | OK |

### Placeholder scan

Nenhum campo TBD ou identificador inválido. Todos os valores no `plugin.json` e `marketplace.json` usam dados reais: URL real do server F-A, email real, homepage real, keywords reais.

### Decisões documentadas

1. **`mcpServers` inline no `plugin.json`** (não `.mcp.json` separado) — confirmado por evidência real da suíte em produção.
2. **Naming `media-forge-hosted`** — não colide com a entry `media-forge` (stdio) existente.
3. **Hosting no repo `maxvision-utilities`** — marketplace já registrado, sem overhead de novo repo para F-G.
4. **`${MEDIA_FORGE_LICENSE:-}` com default vazio** — header presente mas não obrigatório no B; obrigatório no C1 com override.
5. **Cópia (não symlink)** da surface agents/commands/skills — Git multiplataforma; script de sync para manutenção.
6. **Sem chave `hooks` no plugin fino** — nenhum hook client-side neste estágio; hooks de lifecycle (ex: verificar chave/saldo no SessionStart) serão adicionados em F-C com um `session-start.sh` real que executa um script, não um `.json`. O padrão confirmado da suíte aponta `command` para um `.sh`, nunca para um arquivo `.json`.

### Riscos / notas para o executor

- **URL estática é o primário** — os 3 plugins da suíte em produção usam URL hardcoded no `url`. O campo `url` com interpolação `${VAR}` não está confirmado no loader; a URL de produção `https://media-forge.produtoramaxvision.com.br/mcp` é usada diretamente. Se o executor quiser verificar o suporte a override antes de F-C/F-F, pode testar `${MEDIA_FORGE_URL}` (sem fallback `:-`) num ambiente de dev — resultado documenta como nota no PR mas não bloqueia F-G.
- O smoke da Task 5 requer F-A vivo. Se F-A não estiver deployado, rodar o smoke localmente com server em `http://localhost:8787/mcp` apontado via teste de integração (não via plugin instalado) e registrar no commit.
- A entry `media-forge` (stdio) no marketplace.json teve description atualizada para "self-host edition" — mudança cosmética, não quebra compatibilidade com plugins instalados.
- O alerta `invisible-unicode-characters` do pre-tool-use hook neste repo é falso positivo para este arquivo: caracteres em-dash (`U+2014`) e `${VAR}` em blocos de código disparam o detector de padrão. Verificado com PowerShell: nenhum codepoint suspeito (U+FEFF, U+200B..U+200D, U+2060, U+00AD) presente.

---

## Contagem de tasks e steps

| Task | Steps | Tipo |
|---|---|---|
| Task 1 — plugin.json + TDD | 6 | TDD (teste que falha → implementa → passa) |
| Task 2 — surface declarativa | 3 | Scripts + verificação por contagem |
| Task 3 — marketplace.json + TDD | 6 | TDD (teste que falha → implementa → passa) |
| Task 4 — README + ONBOARDING | 3 | Docs |
| Task 5 — Smoke de instalação | 6 | Verificação manual + smoke |
| Task 6 — Script de sync | 4 | Scripts de manutenção |
| Task 7 — Gates de PR | 4 | typecheck + lint + fallow + integridade |
| **Total** | **32 steps** | — |

**Tasks: 7. Steps: 32. Decisões em aberto residuais: 2 (não-bloqueantes).**
