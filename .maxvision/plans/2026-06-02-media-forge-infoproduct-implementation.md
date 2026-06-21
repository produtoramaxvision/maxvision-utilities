# media-forge Infoproduto — Implementation Plan (master + Fase F-A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use maxvision:subagent-driven-development (recommended) ou maxvision:executing-plans para executar task-by-task. Steps usam checkbox (`- [ ]`).

**Goal:** Implementar o media-forge como infoproduto hospedado (MCP HTTP multi-tenant + serviço de crédito + pagamentos + licença + galeria + ops), por fases independentemente shippáveis.

**Architecture:** Plugin fino → MCP server hospedado (Hono + Streamable HTTP stateless) com as chaves de IA no server; billing por crédito path-priced via serviço `credit-core` (append-only, Redis); rails Asaas/Stripe; self-host C1 licenciado da mesma base.

**Tech Stack:** TypeScript ESM, Node ≥22.5, `@modelcontextprotocol/sdk` ^1.29, Hono + @hono/node-server, Postgres (`pg`) + Redis, MinIO/S3, vitest, tsup, Docker (ARM64).

**Spec fonte:** `.maxvision/specs/2026-06-01-media-forge-infoproduct-design.md` (CEO + ENG CLEARED).

---

## Scope: este doc é DECOMPOSTO

A spec cobre múltiplos subsistemas independentes. Conforme o scope-check do writing-plans, **não** existe um megadoc único. Este doc é:
1. **Índice-mestre** das 9 fases (lanes, dependências, exit criteria) — abaixo.
2. **Plano detalhado da Fase F-A** (fundação HTTP) — executável agora, independentemente shippável.

Cada fase seguinte (F-B…F-I) recebe seu **próprio** plano via `writing-plans` quando alcançada (evita plano gigante que envelhece). O índice rastreia o status de cada plano.

## Índice-mestre de fases (lanes paralelas)

| Fase | O que entrega | Lane | Depende de | Exit criteria | Plano |
|---|---|---|---|---|---|
| **F-A** | MCP server HTTP (Hono stateless, /health /metrics /mcp, auth Bearer básica) | 1 | — | self-host conecta via `type:http`; `pnpm test` verde | **DETALHADO abaixo** |
| **F-B** | Async hospedado: webhook-router como endpoint público + URLs assinadas MinIO/S3 nas tool results | 1 | F-A | job longo retorna job_id; result via signed URL | a planejar |
| **F-C** | Tenancy + tiers: API keys hasheadas, resolução tenant/tier, gating de tools, rate-limit Redis | 1 | F-A | tool paga gated por tier; rate-limit por tenant | a planejar |
| **F-D** | Serviço `credit-core` (Postgres + API, append-only, path-priced, TTL+sweep, idempotência, **test mandate**) | 2 (paralela) | — (serviço próprio) | suite money (concorrência+idemp+reconc+margem) verde | a planejar |
| **F-E** | Pagamentos: Asaas (assinatura+packs Pix) + Stripe (intl/C1); webhooks de reconciliação | 1 | F-C, F-D | compra de pack credita carteira; idempotente | a planejar |
| **F-F** | Licença C1: Worker/Keygen validate-by-key + gating self-host + imagem Docker multi-arch + EULA | 3 (paralela) | F-A | self-host gated por licença; 403 em revogação | a planejar |
| **F-G** | Marketplace + plugin fino: plugin.json type:http, marketplace.json, onboarding | 1 | F-A | install do plugin conecta no server | a planejar |
| **F-H** | Landing | 3 (paralela) | — | **PRONTO**: prompt Claude Design em `.maxvision/specs/2026-06-01-media-forge-landing-claude-design-prompt.md` |
| **F-I** | Galeria persistente + backup Postgres + observabilidade de margem | 1 | F-B, F-C | `list_my_generations`; pg_dump cron; alerta de margem | a planejar |

**Ordem de execução recomendada:** Lane 1 (F-A → F-B/F-C → F-E → F-G → F-I) sequencial; Lane 2 (`credit-core` F-D) em paralelo desde já (serviço separado); Lane 3 (F-F licença, F-H landing) em paralelo. F-E junta as lanes 1+2 (precisa de credit-core).

---

## FASE F-A — MCP server HTTP (fundação)

**Objetivo:** adicionar um entrypoint HTTP paralelo ao stdio, usando Hono + `WebStandardStreamableHTTPServerTransport` (SDK 1.29), stateless, McpServer por request, com auth Bearer mínima. Não remove o stdio. Trabalhar de `C:\Users\MaxVision\Desktop\cursor-oficial\maxvision-utilities\media-forge`.

**Arquivos:**
- Modify: `package.json` (deps + pin SDK + script)
- Create: `src/http/app.ts` (Hono app: /health, /metrics, /mcp)
- Create: `src/http/auth.ts` (middleware Bearer)
- Create: `src/http/server.ts` (`startHttpServer()` — serve via @hono/node-server)
- Test: `tests/unit/http/app.test.ts`, `tests/unit/http/auth.test.ts`
- Test: `tests/integration/http-mcp.test.ts`

### Task 1: Dependências + pin do SDK

- [ ] **Step 1: Adicionar deps e pinar SDK**

Em `package.json`: pinar `"@modelcontextprotocol/sdk": "^1.29.0"` (estava `^1.0.4`) e adicionar em `dependencies`:
```json
"hono": "^4.6.0",
"@hono/node-server": "^1.13.0"
```

- [ ] **Step 2: Instalar**

Run: `pnpm install`
Expected: lockfile atualizado, sem erro. `node -e "import('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js').then(m=>console.log(!!m.WebStandardStreamableHTTPServerTransport))"` imprime `true` (confirma símbolo SDK 1.29).

- [ ] **Step 3: Commit**

```bash
set -euo pipefail
cd media-forge
git add package.json pnpm-lock.yaml
git commit -m "build(deps): pin MCP SDK ^1.29; add hono + @hono/node-server for HTTP transport"
```

### Task 2: Auth middleware (Bearer mínima)

**Files:** Create `src/http/auth.ts`, Test `tests/unit/http/auth.test.ts`

> F-A usa uma checagem mínima: `MEDIA_FORGE_API_KEYS` = lista separada por vírgula de chaves aceitas (bootstrap). F-C substitui por keys hasheadas + resolução de tenant. A interface (`resolveAuth`) já retorna um contexto extensível pra F-C plugar tenant/tier.

- [ ] **Step 1: Test que falha**

```ts
// tests/unit/http/auth.test.ts
import { describe, it, expect } from 'vitest';
import { resolveAuth } from '../../../src/http/auth.js';

describe('resolveAuth', () => {
  const env = { MEDIA_FORGE_API_KEYS: 'key-aaa,key-bbb' } as NodeJS.ProcessEnv;

  it('aceita Bearer com chave válida', () => {
    const r = resolveAuth('Bearer key-aaa', env);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ctx.apiKey).toBe('key-aaa');
  });

  it('rejeita header ausente', () => {
    expect(resolveAuth(undefined, env).ok).toBe(false);
  });

  it('rejeita chave desconhecida', () => {
    expect(resolveAuth('Bearer nope', env).ok).toBe(false);
  });

  it('rejeita esquema não-Bearer', () => {
    expect(resolveAuth('Basic key-aaa', env).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar — falha**

Run: `pnpm vitest run tests/unit/http/auth.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```ts
// src/http/auth.ts
// Auth mínima do transporte HTTP (F-A). F-C troca por keys hasheadas + tenant.
export interface AuthContext {
  apiKey: string;
  // F-C adiciona: tenantId, tier, scopes
}
export type AuthResult = { ok: true; ctx: AuthContext } | { ok: false; reason: string };

export function resolveAuth(
  authHeader: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): AuthResult {
  if (!authHeader) return { ok: false, reason: 'missing Authorization header' };
  const m = /^Bearer\s+(.+)$/.exec(authHeader.trim());
  if (!m) return { ok: false, reason: 'expected Bearer scheme' };
  const key = m[1].trim();
  const allowed = (env['MEDIA_FORGE_API_KEYS'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (allowed.length === 0) return { ok: false, reason: 'no API keys configured' };
  if (!allowed.includes(key)) return { ok: false, reason: 'unknown API key' };
  return { ok: true, ctx: { apiKey: key } };
}
```

- [ ] **Step 4: Rodar — passa**

Run: `pnpm vitest run tests/unit/http/auth.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
set -euo pipefail
cd media-forge
git add src/http/auth.ts tests/unit/http/auth.test.ts
git commit -m "feat(http): Bearer auth resolver (F-A bootstrap; tenant in F-C)"
```

### Task 3: Hono app com /health, /metrics, /mcp (auth + 401)

**Files:** Create `src/http/app.ts`, Test `tests/unit/http/app.test.ts`

- [ ] **Step 1: Test que falha**

```ts
// tests/unit/http/app.test.ts
import { describe, it, expect } from 'vitest';
import { buildHttpApp } from '../../../src/http/app.js';

const env = { MEDIA_FORGE_API_KEYS: 'key-aaa' } as NodeJS.ProcessEnv;

describe('buildHttpApp', () => {
  it('GET /health → 200 {ok:true}', async () => {
    const app = buildHttpApp({ env });
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('POST /mcp sem auth → 401', async () => {
    const app = buildHttpApp({ env });
    const res = await app.request('/mcp', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
  });

  it('GET /metrics → 200 text', async () => {
    const app = buildHttpApp({ env });
    const res = await app.request('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
  });
});
```

- [ ] **Step 2: Rodar — falha**

Run: `pnpm vitest run tests/unit/http/app.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3a: Criar o stub `src/http/app-internal.ts`**

Stub mínimo (a Task 4 substitui pela ligação real com o McpServer). Isola a Task 3 para passar antes do MCP estar ligado:

```ts
// src/http/app-internal.ts
import type { AuthContext } from './auth.js';

export async function handleMcpRequest(_req: Request, _ctx: AuthContext): Promise<Response> {
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
}
```

- [ ] **Step 3b: Criar `src/http/app.ts`**

```ts
// src/http/app.ts
// Hono app do transporte HTTP. /mcp delega a handleMcpRequest (Task 4 liga ao McpServer).
import { Hono } from 'hono';
import { resolveAuth } from './auth.js';
import { handleMcpRequest } from './app-internal.js';

export interface HttpAppOpts {
  env?: NodeJS.ProcessEnv;
}

export function buildHttpApp(opts: HttpAppOpts = {}) {
  const env = opts.env ?? process.env;
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true }));
  app.get('/metrics', (c) =>
    c.text('# media-forge metrics\n', 200, { 'content-type': 'text/plain; version=0.0.4' }),
  );

  app.post('/mcp', async (c) => {
    const auth = resolveAuth(c.req.header('Authorization'), env);
    if (!auth.ok) return c.json({ error: 'unauthorized', reason: auth.reason }, 401);
    return handleMcpRequest(c.req.raw, auth.ctx);
  });

  return app;
}
```

- [ ] **Step 4: Rodar — passa**

Run: `pnpm vitest run tests/unit/http/app.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck`
```bash
set -euo pipefail
cd media-forge
git add src/http/app.ts src/http/app-internal.ts tests/unit/http/app.test.ts
git commit -m "feat(http): Hono app with /health /metrics /mcp (auth gate)"
```

### Task 4: Ligar /mcp ao McpServer per-request (Streamable HTTP stateless)

**Files:** Modify `src/http/app-internal.ts`, Test `tests/integration/http-mcp.test.ts`

> Padrão oficial stateless: McpServer + `WebStandardStreamableHTTPServerTransport` frescos por request (`sessionIdGenerator: undefined`, `enableJsonResponse: true`). Reusa o `buildServer(opts)` existente.

- [ ] **Step 1: Test de integração que falha**

```ts
// tests/integration/http-mcp.test.ts
import { describe, it, expect } from 'vitest';
import { buildHttpApp } from '../../src/http/app.js';

const env = { MEDIA_FORGE_API_KEYS: 'key-aaa', GOOGLE_API_KEY: 'test' } as NodeJS.ProcessEnv;

const initBody = JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
});

describe('POST /mcp', () => {
  it('initialize autenticado retorna serverInfo', async () => {
    const app = buildHttpApp({ env });
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { Authorization: 'Bearer key-aaa', 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: initBody,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result.serverInfo.name).toBe('media-forge');
  });
});
```

- [ ] **Step 2: Rodar — falha**

Run: `pnpm vitest run tests/integration/http-mcp.test.ts`
Expected: FAIL (stub retorna `{}`, sem serverInfo).

- [ ] **Step 3: Implementar a ligação real**

```ts
// src/http/app-internal.ts
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { buildServer } from '../mcp/server.js';
import type { AuthContext } from './auth.js';

export async function handleMcpRequest(req: Request, _ctx: AuthContext): Promise<Response> {
  // Stateless: server + transport frescos por request. _ctx carrega o tenant
  // em F-C (injeção no buildServer/handlers); em F-A é só a apiKey.
  const server = buildServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}
```

- [ ] **Step 4: Rodar — passa**

Run: `pnpm vitest run tests/integration/http-mcp.test.ts`
Expected: PASS. Se a integração exigir env extra (config), passe via `env` no teste (já inclui `GOOGLE_API_KEY`).

- [ ] **Step 5: Commit**

```bash
set -euo pipefail
cd media-forge
git add src/http/app-internal.ts tests/integration/http-mcp.test.ts
git commit -m "feat(http): wire /mcp to per-request McpServer (stateless Streamable HTTP)"
```

### Task 5: `startHttpServer()` + script

**Files:** Create `src/http/server.ts`, Modify `package.json`

- [ ] **Step 1: Implementar o entrypoint**

```ts
// src/http/server.ts
import { serve } from '@hono/node-server';
import { buildHttpApp } from './app.js';
import { logger } from '../core/logger.js';

export function startHttpServer(): void {
  const port = Number(process.env['MEDIA_FORGE_HTTP_PORT'] ?? 8787);
  const app = buildHttpApp();
  serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });
  logger.info('media-forge MCP HTTP server ready', { port });
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startHttpServer();
}
```

- [ ] **Step 2: Adicionar script + entry do tsup**

Em `package.json` scripts: `"start:http": "node dist/http/server.js"`.
Em `tsup.config.ts` entry: adicionar `'http/server': 'src/http/server.ts'`.

- [ ] **Step 3: Smoke local (manual)**

Run:
```bash
set -euo pipefail
cd media-forge
pnpm build
MEDIA_FORGE_API_KEYS=key-aaa MEDIA_FORGE_HTTP_PORT=8787 node dist/http/server.js &
sleep 1
curl -s localhost:8787/health   # → {"ok":true}
curl -s -o /dev/null -w "%{http_code}" -X POST localhost:8787/mcp   # → 401
kill %1
```
Expected: `{"ok":true}` e `401`.

- [ ] **Step 4: Commit**

```bash
set -euo pipefail
cd media-forge
git add src/http/server.ts package.json tsup.config.ts
git commit -m "feat(http): startHttpServer entrypoint + build entry + start:http script"
```

### Task 6: Validação final F-A

- [ ] **Step 1: Suite + gates**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: tudo verde (novos testes http + suite existente).

- [ ] **Step 2: Confirmar stdio intacto**

Run: `grep -n "startStdioServer" src/mcp/server.ts`
Expected: presente — o caminho stdio não foi removido (self-host local segue funcionando).

**F-A exit criteria:** `pnpm test` verde; `/health` 200, `/mcp` sem auth 401, `/mcp` com Bearer válido faz handshake MCP; stdio intacto. Self-host já pode conectar um plugin via `type:http` apontando pro server local. **F-A é shippável.**

---

## Self-Review

**Spec coverage:** F-A cobre §3.1 (stdio→HTTP, Hono stateless, per-request, /health /mcp /metrics) e o pin SDK 1.29 (§10 recomendação). Auth Bearer mínima é a fundação do §6 (F-C completa hash+tenant). Demais §§ → fases F-B..F-I no índice.

**Placeholder scan:** sem placeholders. Task 3 está dividida em 3a (stub `app-internal.ts` limpo) + 3b (`app.ts` real); o stub é substituído pela ligação real na Task 4 — código completo e válido em cada step, sem TBD nem identificador inválido.

**Type consistency:** `AuthContext`/`AuthResult`/`resolveAuth` (Task 2) usados em `app.ts` (Task 3) e `app-internal.ts` (Task 4) com a mesma assinatura. `buildHttpApp({env})` consistente entre tasks 3/4/5. `buildServer()` reusado verbatim do `src/mcp/server.ts` existente.

**Known execution-time:** o `WebStandardStreamableHTTPServerTransport.handleRequest` é stateless single-use por request (cada request cria transport novo — já é o caso). Confirmar o nome exato do método (`handleRequest`) no SDK 1.29 instalado no Step 2 da Task 1; se a API diferir, ajustar a Task 4.

---

## Adendo F-A.7/8 — Imagem Docker + publish ghcr (deploy na VPS)

> Produz `ghcr.io/produtoramaxvision/media-forge-mcp` (linux/arm64) consumida pelo stack Swarm `media-forge-mcp` (já criado na VPS, aguardando imagem). Publicação via CI no tag `media-forge-v*` usando `GITHUB_TOKEN` com `packages:write` — **sem PAT local**. O server escuta em `MEDIA_FORGE_HTTP_PORT=3000` (casado com o Traefik do stack).

### Task 7: Dockerfile multi-stage (arm64, ffmpeg de sistema)

**Files:** Create `media-forge/Dockerfile`, `media-forge/.dockerignore`

- [ ] **Step 1: `.dockerignore`**

```
node_modules
dist
.git
tests
.fallow
*.log
```

- [ ] **Step 2: `Dockerfile`** (espelha a CI: `pnpm install --frozen-lockfile --ignore-workspace`; media-forge tem lockfile próprio)

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-workspace
COPY . .
RUN pnpm exec tsup

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production MEDIA_FORGE_HTTP_PORT=3000
# ffmpeg de sistema (LGPL-safe): resolveFfmpegPath() o encontra; ffmpeg-static foi removido na Fase 1
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate \
 && apk add --no-cache ffmpeg
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-workspace --prod
COPY --from=build /app/dist ./dist
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "dist/http/server.js"]
```

- [ ] **Step 3: Build local de fumaça (se houver Docker; senão a CI valida)**

Run (opcional, requer buildx): `docker build -t media-forge-mcp:smoke media-forge` → deve completar. Sem Docker local, pular: a CI (Task 8) faz o build arm64 real.

- [ ] **Step 4: Commit**

```bash
set -euo pipefail
git add media-forge/Dockerfile media-forge/.dockerignore
git commit -m "build(docker): media-forge-mcp arm64 image (system ffmpeg + /health)"
```

### Task 8: CI — build + push da imagem no release

**Files:** Modify `.github/workflows/release.yml` (job novo `docker`, após `release`)

- [ ] **Step 1: Adicionar o job `docker`**

```yaml
  docker:
    needs: release
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v6
      - id: version
        run: echo "version=${GITHUB_REF#refs/tags/media-forge-v}" >> "$GITHUB_OUTPUT"
      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: media-forge
          file: media-forge/Dockerfile
          platforms: linux/arm64
          push: true
          tags: |
            ghcr.io/produtoramaxvision/media-forge-mcp:${{ steps.version.outputs.version }}
            ghcr.io/produtoramaxvision/media-forge-mcp:latest
```

> O `defaults.run.working-directory: media-forge` do workflow afeta só `run:`; `build-push-action` usa `context: media-forge` a partir da raiz — independente do default.

- [ ] **Step 2: Commit**

```bash
set -euo pipefail
git add .github/workflows/release.yml
git commit -m "ci(release): build+push media-forge-mcp image to ghcr on media-forge-v* tag"
```

**NÃO empurrar tag, NÃO publicar imagem, NÃO fazer deploy.** O release tag (que dispara o publish) é passo final do controlador, após review. Deliverable do executor = Dockerfile + workflow commitados + suíte verde no branch do worktree.

**F-A.7/8 exit criteria:** `docker build media-forge` completa (ou CI verde); `release.yml` tem o job `docker` com `packages:write`. Imagem só publica quando o controlador empurrar `media-forge-vX.Y.Z`.

---

## Status dos planos de fase (2026-06-02)

| Fase | Status | Plano | Tasks |
|---|---|---|---|
| F-A | ✅ FEITO (deployado) | (acima) | — |
| F-B | 📝 PLANEJADO | `2026-06-02-F-B-async-output-delivery.md` | 9 |
| F-C | 📝 PLANEJADO | `2026-06-02-F-C-tenancy-tiers-ratelimit.md` | 12 |
| F-D | ✅ FEITO (deployado) | `2026-06-02-credit-core-implementation.md` | — |
| F-E | 📝 PLANEJADO | `2026-06-02-F-E-payments-billing.md` | 11 |
| F-F | 📝 PLANEJADO | `2026-06-02-F-F-license-selfhost.md` | 14 |
| F-G | 📝 PLANEJADO | `2026-06-02-F-G-marketplace-thin-plugin.md` | 8 |
| F-H | ✅ PRONTO (prompt Claude Design) | `.maxvision/specs/...landing...` | — |
| F-I | 📝 PLANEJADO | `2026-06-02-F-I-gallery-backup-observability.md` | 12 |

### Itens de reconciliação cross-fase (resolver ANTES da execução das fases citadas)

1. **🔴 DINHEIRO — unificar `external_id` de capture (F-E ↔ F-D).** O sweep do credit-core usa `sweep-cap-${suffix}` (`credit-core/src/sweep.ts:21`); o F-E propõe `cap-{jobId}`. IDs diferentes para a MESMA reserva ⇒ idempotência `(kind, external_id)` não dedup ⇒ **captura dobrada / cobrança em dobro**. Fix: ambos usam `cap-{reservationId}` (e `rel-{reservationId}` para release). Pequena mudança no sweep do credit-core + contrato do cliente F-E. **Bloqueia go-live do F-E.**
2. **Versão hardcoded:** `buildServer` fixa `version:'0.1.1'` (`src/mcp/server.ts`) vs package.json 0.2.0. Corrigir (ler de package.json) — pega F-G/onboarding.
3. **Licença do core (F-F):** core é MIT; spec §5 fala AGPL-3.0 + EULA. Relicenciar é decisão maior — o EULA de F-F cobre só a licença comercial self-host, não relicencia o core. **Decisão do dono.**
4. **context7 indisponível aos subagentes do planejamento:** shapes de Asaas/Stripe (F-E) e Workers KV/D1 (F-F) foram escritos de conhecimento estável e marcados "confirmar no sandbox/context7" — validar no início da execução dessas fases.

### Ordem de execução recomendada

- **Solo, sem dependência de você:** F-B → F-C → F-I (F-I depende de F-B+F-C).
- **Paralelo (Lane 3):** F-F (licença) + F-G (marketplace) — independentes de B/C.
- **F-E por último entre os de billing:** precisa F-C (tenant) + F-D (vivo) + suas credenciais (Asaas/Stripe) + o fix #1 acima.

Cada fase, ao ser executada, segue subagent-driven-development (worktree isolado, TDD, review de duas etapas), com o mesmo cuidado de integração (cherry-pick por base-antiga de worktree, gates verdes, deploy via Portainer, env contract enxuto, media-forge fixo em v0.2.0).
