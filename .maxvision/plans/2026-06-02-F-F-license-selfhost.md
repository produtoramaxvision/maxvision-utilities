# media-forge Infoproduto — Fase F-F: Licença C1 (self-host licenciado)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `maxvision:subagent-driven-development` (recomendado) ou `maxvision:executing-plans` para executar task-by-task. Steps usam checkbox (`- [ ]`). Commits em inglês, Conventional Commits. Trabalhar de `homolog`.

**Goal:** Habilitar o modo **C1 — self-hosted licenciado** da spec: a MESMA imagem `ghcr.io/produtoramaxvision/media-forge-mcp` roda on-prem numa agência, mas com gating de licença. No boot e periodicamente o server valida uma chave de licença contra um **servidor de licença próprio (Cloudflare Worker)**; licença inválida/revogada → **403 em `/mcp`** (degrada gracioso: `/health` e `/metrics` seguem 200). Inclui imagem Docker **multi-arch** (amd64+arm64 para agências x86 on-prem) e **EULA comercial**.

**Architecture:**
- **Servidor de licença** = Cloudflare Worker (Hono) com store em KV (ou D1) → `POST /validate {licenseKey, instanceId}` → `{valid, tier, expiresAt, revoked}`; endpoints admin `issue`/`revoke` protegidos por secret.
- **Cliente de licença** no media-forge = módulo `src/license/` que valida no boot + cache em memória + revalidação periódica (`setInterval`). O gate é um **middleware Hono** em `/mcp` (lê o cache de forma síncrona — NÃO chama o Worker por request). Auth (401) roda ANTES do gate de licença (403).
- **Self-host vs hosted:** `LICENSE_CHECK_ENABLED=true` ativa o gate (modo C1 self-host). No modo hosted (B), a flag fica `false` → middleware é no-op total (o gating de tier no hosted é F-C, não F-F).
- **Grace period offline** (spec §5): rede inacessível → continua servindo do último cache válido dentro de um TTL de graça; revogação explícita → 403 imediato; graça expirada sem sucesso → 403.

**Tech Stack:** TypeScript ESM, Node ≥22, Hono (já no media-forge e no Worker), vitest, Cloudflare Workers + Wrangler + KV/D1, Docker buildx multi-arch.

**Spec fonte:** `.maxvision/specs/2026-06-01-media-forge-infoproduct-design.md` §5 (Licença C1), §6 (Segurança). Índice: `.maxvision/plans/2026-06-02-media-forge-infoproduct-implementation.md` (F-F, Lane 3, depende de F-A).

**Exit criteria (do índice):** self-host gated por licença válida; **403 quando a licença é revogada**; `/health` segue 200.

---

## DECISÃO QUE O USUÁRIO PRECISA CRAVAR (antes do deploy, não bloqueia escrever código)

### Modelo de licença: Cloudflare Worker próprio (RECOMENDADO) vs Keygen (alternativa)

| Critério | **Cloudflare Worker (RECOMENDADO)** | Keygen (SaaS) |
|---|---|---|
| Custo | ~grátis (free tier Workers + KV cobre volume de agência) | plano pago por licença/MAU |
| Propriedade | owned, account Cloudflare já configurado | dependência externa |
| MCP disponível | sim (cloudflare MCP no ambiente) | não |
| Time-to-ship | médio (escrever Worker + store) | rápido (API pronta) |
| Lock-in | nenhum | médio |

**Recomendação:** Worker próprio como caminho primário (Tasks 2–4). O cliente de licença (Task 5/6) fala um contrato **agnóstico** (`POST /validate` → `{valid, tier, expiresAt, revoked}`), então Keygen vira **drop-in alternativo**: troca-se só `MAXVISION_LICENSE_SERVER_URL` para o endpoint Keygen e adapta-se o shape da resposta num adapter. Ver "Alternativa Keygen (drop-in)" no fim.

### Credenciais a prover no deploy (prerequisites — não bloqueiam o plano)
- **Cloudflare Account ID** (deploy do Worker).
- **Wrangler API token** com permissão de deploy de Workers + edição de KV/D1.
- **KV namespace ID** (ou **D1 database ID**) para o store de licenças.
- **`LICENSE_ADMIN_SECRET`** — secret do Worker que protege os endpoints `issue`/`revoke` (Bearer admin). Guardar em `wrangler secret put`, nunca no código.
- (self-host) por instância da agência: um **`MEDIA_FORGE_LICENSE_KEY`** emitido via `issue`.

### Open items (FLAG — não agir nesta fase)
- **MIT → AGPL-3.0:** a spec §5 diz "core AGPL-3.0 + EULA comercial", mas `media-forge/LICENSE` hoje é **MIT**. Relicenciar o core envolve contribuidores + marketplace + é decisão maior — **fora do exit de F-F** (que só pede o arquivo EULA + referência). Surge como decisão a cravar; F-F NÃO relicencia silenciosamente. O EULA comercial referencia o modelo de licença dual; se o core continuar MIT, ajustar a linguagem do EULA.
- **`buildServer` hardcoda `version:'0.1.1'`** (`src/mcp/server.ts:60`) enquanto `package.json` é `0.2.0`. Fora do escopo F-F; anotar.
- **media-forge fica fixo em v0.2.0** (sem bump) — a imagem multi-arch sai por **force-move da tag `media-forge-v0.2.0`** (ação do controlador, não do executor, igual à postura de F-A Task 8).

---

## File Structure

```
media-forge/
  src/
    core/
      config.ts                        # MODIFY: reintroduz 3 envs de licença em loadConfig + MediaForgeConfig
    license/
      types.ts                         # CREATE: contrato ValidateResponse, LicenseState, LicenseStatus
      client.ts                        # CREATE: validateLicense() — fetch ao Worker (agnóstico de provider)
      cache.ts                         # CREATE: LicenseCache (boot + setInterval + grace TTL) → estado p/ o gate
      middleware.ts                    # CREATE: licenseGate() Hono middleware (403/200, no-op se disabled)
    http/
      app.ts                           # MODIFY: monta licenseGate ANTES de /mcp (após auth)
      server.ts                        # MODIFY: inicia o LicenseCache no boot (start/stop)
  tests/
    unit/license/
      client.test.ts                   # CREATE
      cache.test.ts                    # CREATE
      middleware.test.ts               # CREATE
    integration/
      license-gate.test.ts             # CREATE: POST /mcp 403 revogado, /health 200 — prova do exit
  commands/
    setup.md                           # MODIFY: seção self-host C1 + referência ao EULA + envs de licença
  LICENSE-COMMERCIAL/
    EULA.md                            # CREATE: EULA comercial (uso interno agência, não-revenda)
  Dockerfile                           # (sem mudança — já multi-arch-ready)

license-worker/                        # CREATE: projeto Cloudflare Worker (deploy independente)
  src/
    index.ts                           # Hono app: POST /validate + admin issue/revoke
    store.ts                           # abstração KV/D1 (get/put/list de licenças)
  wrangler.toml                        # binding KV (ou D1), vars, rotas
  package.json                         # hono + wrangler + vitest
  tsconfig.json
  test/
    validate.test.ts                   # unit dos handlers (Miniflare/workers vitest pool)

.github/workflows/
  release.yml                          # MODIFY: platforms linux/amd64,linux/arm64 (era só arm64)

.maxvision/deploy/
  media-forge-mcp.stack.yml            # MODIFY: reintroduz 3 envs de licença (documentadas, não-mortas)
```

---

## Tasks

### Task 1: Reintroduzir as envs de licença em `config.ts`

> A spec exige que o env contract = só o que `loadConfig` consome (`media-forge-mcp.stack.yml` linhas 17-24 documentam a remoção das envs de licença "por não terem consumidor"). F-F as REINTRODUZ junto com o consumidor. Esta task adiciona os campos ao `MediaForgeConfig`; o consumidor (cliente/cache/middleware) vem nas Tasks 5-7.

**Files:** Modify `src/core/config.ts`, Test `tests/unit/license/config-license.test.ts`

- [ ] **Step 1: Test que falha**

```ts
// tests/unit/license/config-license.test.ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../../src/core/config.js';

describe('loadConfig — license fields (F-F)', () => {
  it('default: license check desabilitado', () => {
    const c = loadConfig({} as NodeJS.ProcessEnv);
    expect(c.licenseCheckEnabled).toBe(false);
    expect(c.licenseServerUrl).toBeUndefined();
    expect(c.licenseKey).toBeUndefined();
    expect(c.licenseRevalidateMs).toBe(3_600_000); // 1h default
    expect(c.licenseGraceMs).toBe(259_200_000);     // 72h default
  });

  it('self-host: lê as 3 envs + instanceId', () => {
    const c = loadConfig({
      LICENSE_CHECK_ENABLED: 'true',
      MAXVISION_LICENSE_SERVER_URL: 'https://lic.example/validate',
      MEDIA_FORGE_LICENSE_KEY: 'MFK-abc123',
      MEDIA_FORGE_LICENSE_INSTANCE_ID: 'agency-001',
    } as NodeJS.ProcessEnv);
    expect(c.licenseCheckEnabled).toBe(true);
    expect(c.licenseServerUrl).toBe('https://lic.example/validate');
    expect(c.licenseKey).toBe('MFK-abc123');
    expect(c.licenseInstanceId).toBe('agency-001');
  });
});
```

- [ ] **Step 2: Rodar — falha**

Run: `cd media-forge && pnpm vitest run tests/unit/license/config-license.test.ts`
Expected: FAIL (campos inexistentes no tipo/retorno).

- [ ] **Step 3: Implementar — campos no tipo**

Em `src/core/config.ts`, adicionar ao `interface MediaForgeConfig` (após `refMatchThreshold`):

```ts
  // License C1 self-host gating (F-F). Reintroduzidas com consumidor real
  // (src/license/*). Default OFF → modo hosted (B) não é afetado.
  readonly licenseCheckEnabled: boolean;
  readonly licenseServerUrl: string | undefined;
  readonly licenseKey: string | undefined;
  readonly licenseInstanceId: string | undefined;
  readonly licenseRevalidateMs: number;
  readonly licenseGraceMs: number;
```

- [ ] **Step 4: Implementar — leitura no `loadConfig`**

No objeto `Object.freeze({...})` de `loadConfig`, adicionar (após `refMatchThreshold`):

```ts
    // License C1 (F-F)
    licenseCheckEnabled: envBool(env, 'LICENSE_CHECK_ENABLED', false),
    licenseServerUrl: envStr(env, 'MAXVISION_LICENSE_SERVER_URL'),
    licenseKey: envStr(env, 'MEDIA_FORGE_LICENSE_KEY'),
    licenseInstanceId: envStr(env, 'MEDIA_FORGE_LICENSE_INSTANCE_ID'),
    licenseRevalidateMs: envInt(env, 'MEDIA_FORGE_LICENSE_REVALIDATE_MS', 3_600_000),
    licenseGraceMs: envInt(env, 'MEDIA_FORGE_LICENSE_GRACE_MS', 259_200_000),
```

- [ ] **Step 5: Rodar — passa**

Run: `cd media-forge && pnpm vitest run tests/unit/license/config-license.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
set -euo pipefail
cd media-forge
git add src/core/config.ts tests/unit/license/config-license.test.ts
git commit -m "feat(config): reintroduce license envs (LICENSE_CHECK_ENABLED, server URL, key) with consumer in F-F"
```

---

### Task 2: Bootstrap do projeto `license-worker` (Cloudflare Worker + Hono + KV)

> Confirmar a superfície de API de **Workers KV** (`env.KV.get/put/list`), **D1** (`env.DB.prepare().bind().first()`) e os **bindings do `wrangler.toml`** via context7-mcp ou cloudflare MCP **antes de implementar** (a API é estável, mas confirme a versão do `compatibility_date` e o pool de teste). KV é suficiente para o store de licenças (chave→registro JSON); D1 só se quiser queries por tier/lista — anotado como alternativa no Task 3.

**Files:** Create `license-worker/{package.json,tsconfig.json,wrangler.toml,src/store.ts,src/index.ts,test/validate.test.ts}`

- [ ] **Step 1: `package.json`**

```json
{
  "name": "media-forge-license-worker",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "hono": "^4.6.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.0",
    "wrangler": "^3.90.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: `wrangler.toml`** (binding KV; `LICENSE_ADMIN_SECRET` via `wrangler secret put`, nunca aqui)

```toml
name = "media-forge-license"
main = "src/index.ts"
compatibility_date = "2025-05-01"

[[kv_namespaces]]
binding = "LICENSES"
id = "REPLACE_WITH_KV_NAMESPACE_ID"

# LICENSE_ADMIN_SECRET é secret (wrangler secret put LICENSE_ADMIN_SECRET), não var.
```

- [ ] **Step 3: `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  }
}
```

- [ ] **Step 4: `pnpm install` no worker**

Run: `cd license-worker && pnpm install`
Expected: lockfile criado, sem erro.

- [ ] **Step 5: Commit**

```bash
set -euo pipefail
cd license-worker
git add package.json pnpm-lock.yaml tsconfig.json wrangler.toml
git commit -m "build(license-worker): scaffold Cloudflare Worker (Hono + KV binding)"
```

---

### Task 3: Store de licenças (abstração KV)

**Files:** Create `license-worker/src/store.ts`

> Registro de licença persistido em KV: chave = `licenseKey`, valor = JSON `LicenseRecord`. Validação por chave + (opcional) binding a `instanceId` na primeira ativação. **Alternativa D1:** se quiser listar/auditar por tier, trocar `KVStore` por uma impl D1 com a mesma interface `LicenseStore` — o `index.ts` não muda.

- [ ] **Step 1: Implementar `store.ts`**

```ts
// license-worker/src/store.ts
export interface LicenseRecord {
  licenseKey: string;
  tier: 'self' | 'agency' | 'enterprise';
  /** ISO date; undefined = perpétua */
  expiresAt?: string;
  revoked: boolean;
  /** preso à primeira instância que validar (anti-compartilhamento) */
  boundInstanceId?: string;
  issuedAt: string;
}

export interface LicenseStore {
  get(licenseKey: string): Promise<LicenseRecord | null>;
  put(rec: LicenseRecord): Promise<void>;
}

export class KVStore implements LicenseStore {
  constructor(private kv: KVNamespace) {}

  async get(licenseKey: string): Promise<LicenseRecord | null> {
    return this.kv.get<LicenseRecord>(licenseKey, 'json');
  }

  async put(rec: LicenseRecord): Promise<void> {
    await this.kv.put(rec.licenseKey, JSON.stringify(rec));
  }
}
```

- [ ] **Step 2: Commit**

```bash
set -euo pipefail
cd license-worker
git add src/store.ts
git commit -m "feat(license-worker): KV-backed license store (LicenseRecord, LicenseStore)"
```

---

### Task 4: Endpoints do Worker — `POST /validate` + admin `issue`/`revoke`

**Files:** Create `license-worker/src/index.ts`, Test `license-worker/test/validate.test.ts`

> Contrato público: `POST /validate {licenseKey, instanceId}` → `{valid, tier, expiresAt, revoked}`. Admin (`Authorization: Bearer <LICENSE_ADMIN_SECRET>`): `POST /admin/issue {tier, expiresAt?}` → `{licenseKey}`; `POST /admin/revoke {licenseKey}` → `{ok}`. Bind de `instanceId` na primeira validação (anti-compartilhamento): se `boundInstanceId` vazio, grava o atual; se já preso a outro, `valid:false`.

- [ ] **Step 1: Test que falha** (vitest pool workers)

```ts
// license-worker/test/validate.test.ts
import { describe, it, expect } from 'vitest';
import { env, SELF } from 'cloudflare:test';

const ADMIN = { Authorization: 'Bearer test-admin-secret', 'content-type': 'application/json' };

async function issue(tier = 'agency') {
  const r = await SELF.fetch('https://x/admin/issue', {
    method: 'POST', headers: ADMIN, body: JSON.stringify({ tier }),
  });
  return (await r.json()).licenseKey as string;
}

describe('license worker', () => {
  it('issue → validate válido (bind instance) → revoke → 403-equivalente', async () => {
    const key = await issue();

    const ok = await (await SELF.fetch('https://x/validate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ licenseKey: key, instanceId: 'inst-1' }),
    })).json();
    expect(ok).toMatchObject({ valid: true, tier: 'agency', revoked: false });

    // chave presa a inst-1 → inst-2 rejeitada
    const other = await (await SELF.fetch('https://x/validate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ licenseKey: key, instanceId: 'inst-2' }),
    })).json();
    expect(other.valid).toBe(false);

    await SELF.fetch('https://x/admin/revoke', {
      method: 'POST', headers: ADMIN, body: JSON.stringify({ licenseKey: key }),
    });
    const after = await (await SELF.fetch('https://x/validate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ licenseKey: key, instanceId: 'inst-1' }),
    })).json();
    expect(after).toMatchObject({ valid: false, revoked: true });
  });

  it('admin sem secret → 401', async () => {
    const r = await SELF.fetch('https://x/admin/issue', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    expect(r.status).toBe(401);
  });

  it('chave inexistente → valid:false', async () => {
    const r = await (await SELF.fetch('https://x/validate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ licenseKey: 'nope', instanceId: 'i' }),
    })).json();
    expect(r.valid).toBe(false);
  });
});
```

> Em `wrangler.toml` de teste, definir `LICENSE_ADMIN_SECRET = "test-admin-secret"` via `[vars]` no bloco de teste OU `vitest.config` (`miniflare.bindings`). Confirmar o mecanismo exato do `@cloudflare/vitest-pool-workers` via context7/cloudflare MCP no Step 0.

- [ ] **Step 2: Implementar `index.ts`**

```ts
// license-worker/src/index.ts
import { Hono } from 'hono';
import { KVStore, type LicenseRecord } from './store.js';

interface Env {
  LICENSES: KVNamespace;
  LICENSE_ADMIN_SECRET: string;
}

const app = new Hono<{ Bindings: Env }>();

function genKey(): string {
  // MFK- + 32 hex (crypto.randomUUID sem hifens, 2x p/ entropia)
  const a = crypto.randomUUID().replace(/-/g, '');
  const b = crypto.randomUUID().replace(/-/g, '');
  return `MFK-${(a + b).slice(0, 40)}`;
}

function isExpired(rec: LicenseRecord): boolean {
  return rec.expiresAt !== undefined && Date.parse(rec.expiresAt) < Date.now();
}

// ---- public ----
app.post('/validate', async (c) => {
  const { licenseKey, instanceId } = await c.req.json<{ licenseKey?: string; instanceId?: string }>();
  if (!licenseKey || !instanceId) {
    return c.json({ valid: false, revoked: false, reason: 'missing licenseKey/instanceId' }, 400);
  }
  const store = new KVStore(c.env.LICENSES);
  const rec = await store.get(licenseKey);
  if (!rec) return c.json({ valid: false, revoked: false, reason: 'unknown key' });
  if (rec.revoked) return c.json({ valid: false, revoked: true, tier: rec.tier });
  if (isExpired(rec)) return c.json({ valid: false, revoked: false, tier: rec.tier, expiresAt: rec.expiresAt });

  // bind anti-compartilhamento
  if (!rec.boundInstanceId) {
    rec.boundInstanceId = instanceId;
    await store.put(rec);
  } else if (rec.boundInstanceId !== instanceId) {
    return c.json({ valid: false, revoked: false, reason: 'bound to another instance' });
  }
  return c.json({ valid: true, revoked: false, tier: rec.tier, expiresAt: rec.expiresAt ?? null });
});

// ---- admin (Bearer LICENSE_ADMIN_SECRET) ----
app.use('/admin/*', async (c, next) => {
  const auth = c.req.header('Authorization');
  if (auth !== `Bearer ${c.env.LICENSE_ADMIN_SECRET}`) return c.json({ error: 'unauthorized' }, 401);
  await next();
});

app.post('/admin/issue', async (c) => {
  const { tier, expiresAt } = await c.req.json<{ tier?: LicenseRecord['tier']; expiresAt?: string }>();
  const rec: LicenseRecord = {
    licenseKey: genKey(),
    tier: tier ?? 'agency',
    revoked: false,
    issuedAt: new Date().toISOString(),
    ...(expiresAt ? { expiresAt } : {}),
  };
  await new KVStore(c.env.LICENSES).put(rec);
  return c.json({ licenseKey: rec.licenseKey, tier: rec.tier });
});

app.post('/admin/revoke', async (c) => {
  const { licenseKey } = await c.req.json<{ licenseKey?: string }>();
  if (!licenseKey) return c.json({ error: 'missing licenseKey' }, 400);
  const store = new KVStore(c.env.LICENSES);
  const rec = await store.get(licenseKey);
  if (!rec) return c.json({ error: 'unknown key' }, 404);
  rec.revoked = true;
  await store.put(rec);
  return c.json({ ok: true });
});

export default app;
```

- [ ] **Step 3: Rodar — passa**

Run: `cd license-worker && pnpm test`
Expected: PASS (3 tests). Se o pool de workers exigir ajuste no `vitest.config`, criar `license-worker/vitest.config.ts` apontando para `@cloudflare/vitest-pool-workers` com `wrangler.toml` + binding `LICENSE_ADMIN_SECRET`.

- [ ] **Step 4: typecheck + commit**

Run: `cd license-worker && pnpm typecheck`
```bash
set -euo pipefail
cd license-worker
git add src/index.ts test/validate.test.ts vitest.config.ts
git commit -m "feat(license-worker): POST /validate + admin issue/revoke (instance-bind, revoke)"
```

> **NÃO fazer `wrangler deploy`.** Deploy é ação do controlador após criar o KV namespace, setar `LICENSE_ADMIN_SECRET` e o KV id no `wrangler.toml`. Deliverable do executor = Worker + testes verdes.

---

### Task 5: Cliente de licença no media-forge (`validateLicense` + tipos)

**Files:** Create `src/license/types.ts`, `src/license/client.ts`, Test `tests/unit/license/client.test.ts`

> Contrato **agnóstico de provider** (Worker hoje, Keygen drop-in). `validateLicense` faz `POST {licenseKey, instanceId}` ao `licenseServerUrl` e normaliza a resposta. Timeout curto (rede de agência); erro de rede vira `status:'unreachable'` (NÃO `invalid`) para o grace period decidir.

- [ ] **Step 1: Test que falha**

```ts
// tests/unit/license/client.test.ts
import { describe, it, expect, vi } from 'vitest';
import { validateLicense } from '../../../src/license/client.js';

describe('validateLicense', () => {
  it('200 valid → status ok + tier', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ valid: true, tier: 'agency', revoked: false, expiresAt: null }), { status: 200 }),
    );
    const r = await validateLicense(
      { url: 'https://lic/validate', licenseKey: 'k', instanceId: 'i' },
      { fetchFn },
    );
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.tier).toBe('agency');
  });

  it('200 revoked → status revoked', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ valid: false, revoked: true }), { status: 200 }),
    );
    const r = await validateLicense({ url: 'https://lic/validate', licenseKey: 'k', instanceId: 'i' }, { fetchFn });
    expect(r.status).toBe('revoked');
  });

  it('erro de rede → status unreachable (não invalid)', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await validateLicense({ url: 'https://lic/validate', licenseKey: 'k', instanceId: 'i' }, { fetchFn });
    expect(r.status).toBe('unreachable');
  });

  it('200 valid:false sem revoked → status invalid', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ valid: false, revoked: false }), { status: 200 }),
    );
    const r = await validateLicense({ url: 'https://lic/validate', licenseKey: 'k', instanceId: 'i' }, { fetchFn });
    expect(r.status).toBe('invalid');
  });
});
```

- [ ] **Step 2: Rodar — falha**

Run: `cd media-forge && pnpm vitest run tests/unit/license/client.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar `types.ts`**

```ts
// src/license/types.ts
export type LicenseTier = 'self' | 'agency' | 'enterprise';

/** Resultado normalizado de uma chamada de validação. */
export type LicenseStatus =
  | { status: 'ok'; tier: LicenseTier; expiresAt: string | null }
  | { status: 'invalid'; reason: string }
  | { status: 'revoked'; reason: string }
  | { status: 'unreachable'; reason: string };

/** Estado de gate que o middleware lê (derivado do cache + grace). */
export interface LicenseState {
  /** true → /mcp permitido; false → 403 */
  allowed: boolean;
  reason: string;
  tier: LicenseTier | null;
  lastCheckedAt: number;
}
```

- [ ] **Step 4: Implementar `client.ts`**

```ts
// src/license/client.ts
import type { LicenseStatus, LicenseTier } from './types.js';

export interface ValidateParams {
  url: string;
  licenseKey: string;
  instanceId: string;
  timeoutMs?: number;
}
export interface ValidateDeps {
  fetchFn?: typeof fetch;
}

interface RawResponse {
  valid?: boolean;
  revoked?: boolean;
  tier?: LicenseTier;
  expiresAt?: string | null;
  reason?: string;
}

export async function validateLicense(
  params: ValidateParams,
  deps: ValidateDeps = {},
): Promise<LicenseStatus> {
  const fetchFn = deps.fetchFn ?? fetch;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), params.timeoutMs ?? 5000);
  try {
    const res = await fetchFn(params.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ licenseKey: params.licenseKey, instanceId: params.instanceId }),
      signal: ctrl.signal,
    });
    if (!res.ok) return { status: 'unreachable', reason: `HTTP ${res.status}` };
    const body = (await res.json()) as RawResponse;
    if (body.valid === true) {
      return { status: 'ok', tier: body.tier ?? 'agency', expiresAt: body.expiresAt ?? null };
    }
    if (body.revoked === true) return { status: 'revoked', reason: 'license revoked' };
    return { status: 'invalid', reason: body.reason ?? 'license invalid' };
  } catch (err) {
    return { status: 'unreachable', reason: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(t);
  }
}
```

- [ ] **Step 5: Rodar — passa**

Run: `cd media-forge && pnpm vitest run tests/unit/license/client.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
set -euo pipefail
cd media-forge
git add src/license/types.ts src/license/client.ts tests/unit/license/client.test.ts
git commit -m "feat(license): provider-agnostic validateLicense client + normalized status"
```

---

### Task 6: `LicenseCache` — boot check + revalidação periódica + grace period

**Files:** Create `src/license/cache.ts`, Test `tests/unit/license/cache.test.ts`

> O middleware lê `cache.getState()` de forma **síncrona** (sem rede no caminho do request). O cache: valida no `start()`, agenda `setInterval(revalidateMs)`, e mantém grace TTL. Regras (spec §5):
> - `revoked` ou `invalid` explícito → `allowed:false` imediato.
> - `unreachable` → mantém último estado bom enquanto `now - lastGoodAt < graceMs`; passou → `allowed:false`.
> - Antes do primeiro check bem-sucedido, `unreachable` → `allowed:false` (fail-closed no boot; sem cache bom para herdar).

- [ ] **Step 1: Test que falha**

```ts
// tests/unit/license/cache.test.ts
import { describe, it, expect, vi } from 'vitest';
import { LicenseCache } from '../../../src/license/cache.js';
import type { LicenseStatus } from '../../../src/license/types.js';

function cacheWith(seq: LicenseStatus[]) {
  const calls = [...seq];
  const validate = vi.fn(async () => calls.shift() ?? { status: 'unreachable', reason: 'drained' } as LicenseStatus);
  return new LicenseCache({
    url: 'https://lic/validate', licenseKey: 'k', instanceId: 'i',
    revalidateMs: 1000, graceMs: 10_000,
  }, { validate });
}

describe('LicenseCache', () => {
  it('boot ok → allowed', async () => {
    const c = cacheWith([{ status: 'ok', tier: 'agency', expiresAt: null }]);
    await c.start();
    expect(c.getState().allowed).toBe(true);
    c.stop();
  });

  it('boot unreachable (sem cache bom) → fail-closed', async () => {
    const c = cacheWith([{ status: 'unreachable', reason: 'net' }]);
    await c.start();
    expect(c.getState().allowed).toBe(false);
    c.stop();
  });

  it('ok depois revoked → allowed false imediato', async () => {
    const c = cacheWith([{ status: 'ok', tier: 'agency', expiresAt: null }]);
    await c.start();
    expect(c.getState().allowed).toBe(true);
    await c.revalidateNow({ status: 'revoked', reason: 'r' });
    expect(c.getState().allowed).toBe(false);
    c.stop();
  });

  it('ok depois unreachable dentro da graça → allowed (grace)', async () => {
    const c = cacheWith([{ status: 'ok', tier: 'agency', expiresAt: null }]);
    await c.start();
    await c.revalidateNow({ status: 'unreachable', reason: 'net' });
    expect(c.getState().allowed).toBe(true); // dentro de graceMs
    c.stop();
  });

  it('ok depois unreachable além da graça → allowed false', async () => {
    vi.useFakeTimers();
    const c = cacheWith([{ status: 'ok', tier: 'agency', expiresAt: null }]);
    await c.start();
    vi.advanceTimersByTime(20_000); // > graceMs
    await c.revalidateNow({ status: 'unreachable', reason: 'net' });
    expect(c.getState().allowed).toBe(false);
    c.stop();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Rodar — falha**

Run: `cd media-forge && pnpm vitest run tests/unit/license/cache.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar `cache.ts`**

```ts
// src/license/cache.ts
import { logger } from '../core/logger.js';
import { validateLicense, type ValidateParams } from './client.js';
import type { LicenseState, LicenseStatus } from './types.js';

export interface LicenseCacheOpts {
  url: string;
  licenseKey: string;
  instanceId: string;
  revalidateMs: number;
  graceMs: number;
}
export interface LicenseCacheDeps {
  /** override para testes; default = validateLicense */
  validate?: (p: ValidateParams) => Promise<LicenseStatus>;
}

export class LicenseCache {
  private state: LicenseState;
  private lastGoodAt = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly validate: (p: ValidateParams) => Promise<LicenseStatus>;

  constructor(private opts: LicenseCacheOpts, deps: LicenseCacheDeps = {}) {
    this.validate = deps.validate ?? validateLicense;
    // fail-closed até o primeiro check
    this.state = { allowed: false, reason: 'license not yet validated', tier: null, lastCheckedAt: 0 };
  }

  getState(): LicenseState {
    return this.state;
  }

  async start(): Promise<void> {
    await this.revalidateNow();
    this.timer = setInterval(() => {
      void this.revalidateNow();
    }, this.opts.revalidateMs);
    // não segurar o event loop do processo
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Revalida (ou aplica um status injetado em teste) e recomputa o gate. */
  async revalidateNow(injected?: LicenseStatus): Promise<void> {
    const status =
      injected ??
      (await this.validate({
        url: this.opts.url,
        licenseKey: this.opts.licenseKey,
        instanceId: this.opts.instanceId,
      }));
    const now = Date.now();
    this.state = this.derive(status, now);
    logger.info('license revalidated', { status: status.status, allowed: this.state.allowed });
  }

  private derive(status: LicenseStatus, now: number): LicenseState {
    switch (status.status) {
      case 'ok':
        this.lastGoodAt = now;
        return { allowed: true, reason: 'ok', tier: status.tier, lastCheckedAt: now };
      case 'revoked':
        return { allowed: false, reason: 'license revoked', tier: null, lastCheckedAt: now };
      case 'invalid':
        return { allowed: false, reason: status.reason, tier: null, lastCheckedAt: now };
      case 'unreachable': {
        const withinGrace = this.lastGoodAt > 0 && now - this.lastGoodAt < this.opts.graceMs;
        return withinGrace
          ? { allowed: true, reason: 'grace period (server unreachable)', tier: this.state.tier, lastCheckedAt: now }
          : { allowed: false, reason: 'license server unreachable, grace expired', tier: null, lastCheckedAt: now };
      }
    }
  }
}
```

- [ ] **Step 4: Rodar — passa**

Run: `cd media-forge && pnpm vitest run tests/unit/license/cache.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
set -euo pipefail
cd media-forge
git add src/license/cache.ts tests/unit/license/cache.test.ts
git commit -m "feat(license): LicenseCache with boot check, periodic revalidation, offline grace period"
```

---

### Task 7: Middleware Hono `licenseGate` + montagem em `/mcp`

**Files:** Create `src/license/middleware.ts`, Test `tests/unit/license/middleware.test.ts`, Modify `src/http/app.ts`

> O gate roda **depois** do auth (401) e **antes** de `handleMcpRequest`. Só em `/mcp`. `/health` e `/metrics` nunca passam pelo gate. Quando `LICENSE_CHECK_ENABLED=false`, `buildHttpApp` não monta o gate (no-op total — modo hosted B).

- [ ] **Step 1: Test que falha (middleware isolado)**

```ts
// tests/unit/license/middleware.test.ts
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { licenseGate } from '../../../src/license/middleware.js';
import type { LicenseState } from '../../../src/license/types.js';

function appWith(state: LicenseState) {
  const app = new Hono();
  app.use('/mcp', licenseGate({ getState: () => state }));
  app.post('/mcp', (c) => c.json({ ok: true }));
  return app;
}

describe('licenseGate', () => {
  it('allowed → passa', async () => {
    const app = appWith({ allowed: true, reason: 'ok', tier: 'agency', lastCheckedAt: 1 });
    const res = await app.request('/mcp', { method: 'POST' });
    expect(res.status).toBe(200);
  });

  it('not allowed → 403 com reason', async () => {
    const app = appWith({ allowed: false, reason: 'license revoked', tier: null, lastCheckedAt: 1 });
    const res = await app.request('/mcp', { method: 'POST' });
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toContain('revoked');
  });
});
```

- [ ] **Step 2: Rodar — falha**

Run: `cd media-forge && pnpm vitest run tests/unit/license/middleware.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar `middleware.ts`**

```ts
// src/license/middleware.ts
import type { MiddlewareHandler } from 'hono';
import type { LicenseState } from './types.js';

export interface LicenseGateDeps {
  getState: () => LicenseState;
}

/** Hono middleware: 403 quando a licença não está válida. Leitura síncrona do cache. */
export function licenseGate(deps: LicenseGateDeps): MiddlewareHandler {
  return async (c, next) => {
    const state = deps.getState();
    if (!state.allowed) {
      return c.json({ error: 'license_invalid', reason: state.reason }, 403);
    }
    await next();
  };
}
```

- [ ] **Step 4: Rodar — passa**

Run: `cd media-forge && pnpm vitest run tests/unit/license/middleware.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Montar em `app.ts`** (gate condicional, após auth, só `/mcp`)

`buildHttpApp` ganha um opcional `licenseState?: () => LicenseState`. Quando presente, monta o gate. `src/http/app.ts` vira:

```ts
// src/http/app.ts
import { Hono } from 'hono';
import { resolveAuth } from './auth.js';
import { handleMcpRequest } from './app-internal.js';
import { licenseGate } from '../license/middleware.js';
import type { LicenseState } from '../license/types.js';

export interface HttpAppOpts {
  env?: NodeJS.ProcessEnv;
  /** Presente só quando LICENSE_CHECK_ENABLED=true (self-host C1). */
  licenseState?: () => LicenseState;
}

export function buildHttpApp(opts: HttpAppOpts = {}) {
  const env = opts.env ?? process.env;
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true }));
  app.get('/metrics', (c) =>
    c.text('# media-forge metrics\n', 200, { 'content-type': 'text/plain; version=0.0.4' }),
  );

  app.post('/mcp', async (c) => {
    // 1) auth (401) ANTES da licença (403) — não vazar estado de licença a anônimos
    const auth = resolveAuth(c.req.header('Authorization'), env);
    if (!auth.ok) return c.json({ error: 'unauthorized', reason: auth.reason }, 401);
    // 2) gate de licença (só self-host; no-op no hosted)
    if (opts.licenseState) {
      const state = opts.licenseState();
      if (!state.allowed) return c.json({ error: 'license_invalid', reason: state.reason }, 403);
    }
    return handleMcpRequest(c.req.raw, auth.ctx, env);
  });

  return app;
}
```

> Nota: o `licenseGate` middleware (Step 3) fica como unidade testável reutilizável; `app.ts` inlina a mesma lógica no handler `/mcp` para manter a ordem auth→licença num único ponto. Ambos compartilham a checagem `state.allowed → 403`. (Se preferir não duplicar, montar `app.use('/mcp', licenseGate({getState: opts.licenseState}))` ANTES do auth quebraria a ordem auth-primeiro; por isso a checagem inline.)

- [ ] **Step 6: Atualizar o teste existente de `app.test.ts`** (garantir que sem `licenseState` nada muda — modo hosted)

Run: `cd media-forge && pnpm vitest run tests/unit/http/app.test.ts`
Expected: PASS (3 tests originais inalterados — gate ausente = comportamento F-A).

- [ ] **Step 7: Commit**

```bash
set -euo pipefail
cd media-forge
git add src/license/middleware.ts tests/unit/license/middleware.test.ts src/http/app.ts
git commit -m "feat(http): license gate on /mcp (403 when invalid, auth-first, hosted no-op)"
```

---

### Task 8: Wire do `LicenseCache` no boot do server (`server.ts`)

**Files:** Modify `src/http/server.ts`

> Quando `LICENSE_CHECK_ENABLED=true`, `startHttpServer` cria o `LicenseCache`, faz `await cache.start()` (boot check), e passa `cache.getState` como `licenseState` ao `buildHttpApp`. SIGTERM/SIGINT → `cache.stop()`.

- [ ] **Step 1: Implementar**

```ts
// src/http/server.ts
import { serve } from '@hono/node-server';
import { buildHttpApp } from './app.js';
import { logger } from '../core/logger.js';
import { loadConfig } from '../core/config.js';
import { LicenseCache } from '../license/cache.js';
import { hostname } from 'node:os';

export async function startHttpServer(): Promise<void> {
  const config = loadConfig(process.env as NodeJS.ProcessEnv);
  const port = Number(process.env['MEDIA_FORGE_HTTP_PORT'] ?? 8787);

  let cache: LicenseCache | undefined;
  if (config.licenseCheckEnabled) {
    if (!config.licenseServerUrl || !config.licenseKey) {
      logger.error('LICENSE_CHECK_ENABLED=true but MAXVISION_LICENSE_SERVER_URL or MEDIA_FORGE_LICENSE_KEY missing');
      process.exit(2);
    }
    cache = new LicenseCache({
      url: config.licenseServerUrl,
      licenseKey: config.licenseKey,
      instanceId: config.licenseInstanceId ?? hostname(),
      revalidateMs: config.licenseRevalidateMs,
      graceMs: config.licenseGraceMs,
    });
    await cache.start();
    logger.info('license check enabled (self-host C1)', { allowed: cache.getState().allowed });
  }

  const app = buildHttpApp(cache ? { licenseState: () => cache!.getState() } : {});
  const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });
  logger.info('media-forge MCP HTTP server ready', { port, licenseGated: Boolean(cache) });

  const shutdown = (): void => {
    cache?.stop();
    server.close();
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void startHttpServer();
}
```

> `startHttpServer` passa de `void` para `Promise<void>` (boot check é async). Confirmar que nenhum caller espera a versão síncrona (era chamado só pelo guard de entrypoint, que agora usa `void`).

- [ ] **Step 2: typecheck**

Run: `cd media-forge && pnpm typecheck`
Expected: limpo.

- [ ] **Step 3: Commit**

```bash
set -euo pipefail
cd media-forge
git add src/http/server.ts
git commit -m "feat(http): start LicenseCache at boot when LICENSE_CHECK_ENABLED (self-host C1)"
```

---

### Task 9: Teste de integração — prova do exit criteria (403 revogado, /health 200)

**Files:** Create `tests/integration/license-gate.test.ts`

> Prova literal do exit: `POST /mcp → 403` sob licença revogada; `GET /health → 200`; `GET /metrics → 200`. Usa `buildHttpApp` com um `licenseState` injetado (não precisa do Worker real). Importante: o gate emite **403** (status HTTP) — `wrap()` per-tool só emitiria JSON-RPC error com HTTP 200, por isso o gate vive no middleware HTTP.

- [ ] **Step 1: Test**

```ts
// tests/integration/license-gate.test.ts
import { describe, it, expect } from 'vitest';
import { buildHttpApp } from '../../src/http/app.js';
import type { LicenseState } from '../../src/license/types.js';

const env = { MEDIA_FORGE_API_KEYS: 'key-aaa', GOOGLE_API_KEY: 'test' } as NodeJS.ProcessEnv;
const revoked: LicenseState = { allowed: false, reason: 'license revoked', tier: null, lastCheckedAt: 1 };
const valid: LicenseState = { allowed: true, reason: 'ok', tier: 'agency', lastCheckedAt: 1 };

describe('license gate (self-host C1) — exit criteria', () => {
  it('licença revogada → POST /mcp 403, mas /health e /metrics 200', async () => {
    const app = buildHttpApp({ env, licenseState: () => revoked });
    const mcp = await app.request('/mcp', {
      method: 'POST',
      headers: { Authorization: 'Bearer key-aaa', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(mcp.status).toBe(403);

    expect((await app.request('/health')).status).toBe(200);
    expect((await app.request('/metrics')).status).toBe(200);
  });

  it('auth-first: sem Bearer → 401 mesmo com licença válida', async () => {
    const app = buildHttpApp({ env, licenseState: () => valid });
    const res = await app.request('/mcp', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
  });

  it('licença válida + auth ok → /mcp não é 401/403', async () => {
    const app = buildHttpApp({ env, licenseState: () => valid });
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { Authorization: 'Bearer key-aaa', 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } }),
    });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
```

- [ ] **Step 2: Rodar — passa**

Run: `cd media-forge && pnpm vitest run tests/integration/license-gate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 3: Commit**

```bash
set -euo pipefail
cd media-forge
git add tests/integration/license-gate.test.ts
git commit -m "test(license): integration proof — revoked → 403 on /mcp, /health stays 200"
```

---

### Task 10: Multi-arch na imagem Docker (release.yml)

**Files:** Modify `.github/workflows/release.yml`

> Hoje o job `docker` builda só `linux/arm64` (linha 79). Agências on-prem rodam x86 → adicionar `linux/amd64`. `setup-qemu-action` já está presente (emula amd64 no runner). O `Dockerfile` não muda (sem deps arch-específicas problemáticas: `apk add ffmpeg` resolve por arch; sem `ffmpeg-static`).

- [ ] **Step 1: Editar a linha `platforms`**

Em `.github/workflows/release.yml`, no job `docker`, trocar:

```yaml
          platforms: linux/arm64
```

por:

```yaml
          platforms: linux/amd64,linux/arm64
```

- [ ] **Step 2: Commit**

```bash
set -euo pipefail
git add .github/workflows/release.yml
git commit -m "ci(release): build media-forge-mcp image for linux/amd64,linux/arm64 (on-prem x86 agencies)"
```

> **NÃO empurrar tag.** A imagem multi-arch sai por **force-move da tag `media-forge-v0.2.0`** (media-forge fica fixo em v0.2.0, sem bump) — ação do controlador após review, igual à postura de F-A Task 8. O executor entrega só o workflow editado + suíte verde.

---

### Task 11: Reintroduzir as envs de licença no stack yml (documentadas, sem env morta)

**Files:** Modify `.maxvision/deploy/media-forge-mcp.stack.yml`

> Agora que `config.ts` (Task 1) CONSOME as envs, elas voltam ao contrato. Reverter a remoção documentada nas linhas 17-24. As envs são **comentadas como self-host-only** (no hosted ficam ausentes/false → no-op).

- [ ] **Step 1: Atualizar o bloco de comentário do topo**

Remover de "REMOVIDOS por não serem lidos" as linhas `MASTER_KEY · MAXVISION_LICENSE_SERVER_URL · LICENSE_CHECK_ENABLED` (manter `MASTER_KEY`, `MCP_PORT`, etc. que seguem mortas). Adicionar uma seção nova:

```yaml
#   --- Licença C1 self-host (F-F) — usadas SÓ no modo self-host on-prem da agência ---
#   LICENSE_CHECK_ENABLED            ativa o gate de licença (default false = hosted). config.ts:loadConfig.
#   MAXVISION_LICENSE_SERVER_URL     URL do /validate do Worker de licença. Obrigatória se check=true.
#   MEDIA_FORGE_LICENSE_KEY          chave emitida via Worker admin/issue. Obrigatória se check=true.
#   MEDIA_FORGE_LICENSE_INSTANCE_ID  id da instância (default = hostname). Anti-compartilhamento.
#   (No deploy HOSTED da VPS estas ficam AUSENTES → gate no-op. Só a imagem on-prem da agência as define.)
```

- [ ] **Step 2: Adicionar as envs ao `environment:` do service** (comentadas para o hosted, com default que mantém no-op)

```yaml
      # Licença C1: no hosted ficam vazias → LICENSE_CHECK_ENABLED default false → gate no-op.
      # Na imagem on-prem da agência, a agência define estas (não este arquivo da VPS).
      LICENSE_CHECK_ENABLED: ${LICENSE_CHECK_ENABLED:-false}
      MAXVISION_LICENSE_SERVER_URL: ${MAXVISION_LICENSE_SERVER_URL:-}
      MEDIA_FORGE_LICENSE_KEY: ${MEDIA_FORGE_LICENSE_KEY:-}
      MEDIA_FORGE_LICENSE_INSTANCE_ID: ${MEDIA_FORGE_LICENSE_INSTANCE_ID:-}
```

> Justificativa anti-env-morta: agora HÁ consumidor (`config.ts` → `LicenseCache` → gate). Com `LICENSE_CHECK_ENABLED:-false` no hosted, o código lê a env (default false) e não monta o cache → zero overhead, zero rede. A env existe no contrato porque o código a lê — não é morta.

- [ ] **Step 3: Commit**

```bash
set -euo pipefail
git add .maxvision/deploy/media-forge-mcp.stack.yml
git commit -m "chore(deploy): reintroduce license envs in stack yml (consumed by F-F license gate)"
```

---

### Task 12: EULA comercial + referência no onboarding

**Files:** Create `media-forge/LICENSE-COMMERCIAL/EULA.md`, Modify `media-forge/commands/setup.md`

> Modelo n8n SUL / Sidekiq Pro (spec §5): a agência usa **internamente**, **não revende** o media-forge como serviço a terceiros. NOTA: o core hoje é MIT (open item acima) — o EULA cobre a **licença comercial de uso self-host** (a chave C1), não relicencia o core. Se/quando o core virar AGPL, ajustar a cláusula de dual-license.

- [ ] **Step 1: Criar `LICENSE-COMMERCIAL/EULA.md`**

```md
# media-forge — End User License Agreement (Commercial Self-Host / C1)

**Version 1.0 — 2026-06-02 · Produtora MaxVision**

This End User License Agreement ("Agreement") governs the use of the **media-forge**
self-hosted commercial distribution ("Software") by a licensee ("You") under a
valid commercial license key issued by Produtora MaxVision ("Licensor").

## 1. Grant of License
Subject to a valid, non-revoked license key and payment of applicable fees,
Licensor grants You a non-exclusive, non-transferable, revocable license to
install and run the Software **on infrastructure You control**, for **Your own
internal business operations**, including serving Your own clients' media
production needs.

## 2. Restrictions
You may **NOT**:
(a) resell, sublicense, rent, lease, or offer the Software itself as a hosted
    service, SaaS, or API to third parties (the "non-compete" / anti-resale clause,
    modeled on the n8n Sustainable Use License and Sidekiq Pro);
(b) remove, disable, or circumvent the license validation mechanism;
(c) share, publish, or transfer Your license key or bind it to instances You do
    not control;
(d) use the Software to build a competing media-generation hosted product.

Using the Software internally to produce media **for** Your clients is permitted.
Reselling **access to the running Software** to Your clients is not.

## 3. License Validation
The Software validates Your license key against Licensor's license server at
startup and periodically. Upon **revocation** or **expiry**, the Software's
generation tools return HTTP 403 and cease to operate; liveness endpoints
(`/health`, `/metrics`) remain available. A limited **offline grace period**
applies when the license server is temporarily unreachable.

## 4. AI Provider Keys
In the self-host (C1) model, **You supply Your own** AI provider credentials
(Google, fal.ai, etc.). Licensor does not provide AI compute under this Agreement
and is not responsible for Your provider costs.

## 5. Term & Termination
This Agreement is effective until terminated. Licensor may revoke the license key
upon material breach (including Section 2 violations) or non-payment. Upon
termination You must cease all use of the Software.

## 6. Warranty & Liability
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND. TO THE MAXIMUM
EXTENT PERMITTED BY LAW, LICENSOR SHALL NOT BE LIABLE FOR ANY INDIRECT,
INCIDENTAL, OR CONSEQUENTIAL DAMAGES, INCLUDING AI PROVIDER COSTS INCURRED BY YOU.

## 7. Governing Law
This Agreement is governed by the laws of Brazil (Brasil), without regard to
conflict-of-law provisions.

---
Contact: produtoramaxvision@gmail.com
```

- [ ] **Step 2: Referenciar no `commands/setup.md`** (seção self-host C1)

Adicionar uma seção ao fim de `media-forge/commands/setup.md`:

```md
## Self-host licenciado (C1 — agências)

A imagem `ghcr.io/produtoramaxvision/media-forge-mcp` roda na sua infra. O uso
self-host comercial é regido pelo **EULA** em
[`LICENSE-COMMERCIAL/EULA.md`](../LICENSE-COMMERCIAL/EULA.md) (uso interno;
não-revenda como serviço).

Para ativar o gating de licença, defina no ambiente do container:

- `LICENSE_CHECK_ENABLED=true`
- `MAXVISION_LICENSE_SERVER_URL=https://<seu-worker>/validate`
- `MEDIA_FORGE_LICENSE_KEY=<chave emitida pela MaxVision>`
- `MEDIA_FORGE_LICENSE_INSTANCE_ID=<id estável da instância>` (opcional; default = hostname)

No boot e a cada `MEDIA_FORGE_LICENSE_REVALIDATE_MS` (default 1h) o servidor valida
a chave. Licença revogada/expirada → as tools retornam **403**; `/health` segue 200.
Há um período de graça offline (`MEDIA_FORGE_LICENSE_GRACE_MS`, default 72h) se o
servidor de licença ficar temporariamente inacessível.

No modo **hosted** (assinatura/créditos, B), `LICENSE_CHECK_ENABLED` fica `false`
e este gating não se aplica.
```

- [ ] **Step 3: Commit**

```bash
set -euo pipefail
cd media-forge
git add LICENSE-COMMERCIAL/EULA.md commands/setup.md
git commit -m "docs(license): commercial EULA (self-host C1, anti-resale) + setup.md reference"
```

---

### Task 13: Validação final F-F

- [ ] **Step 1: Suite + gates (media-forge)**

Run: `cd media-forge && pnpm typecheck && pnpm lint && pnpm test`
Expected: tudo verde (novos testes license + http + suíte existente). Confirmar que `tests/unit/http/app.test.ts` e `tests/integration/http-mcp.test.ts` (F-A) seguem passando — o gate é opcional/no-op sem `licenseState`.

- [ ] **Step 2: Suite do Worker**

Run: `cd license-worker && pnpm typecheck && pnpm test`
Expected: verde (3 tests do validate/issue/revoke).

- [ ] **Step 3: fallow gate (media-forge)**

Run: `cd media-forge && pnpm exec fallow audit --format json --quiet`
Expected: verdict `pass` (ou `warn` justificado). Aplicar `actions[]` auto_fixable se houver.

- [ ] **Step 4: Confirmar exit criteria**

- `tests/integration/license-gate.test.ts` verde = prova de "403 quando revogada, /health 200".
- `release.yml` tem `platforms: linux/amd64,linux/arm64`.
- `EULA.md` existe e é referenciado em `setup.md`.
- 3 envs de licença em `config.ts` + stack yml, com consumidor real.

**F-F exit criteria:** self-host gated por licença válida; **403 quando a licença é revogada** (`/mcp`); `/health` segue 200; imagem multi-arch; EULA presente. **F-F é shippável** após o controlador: criar KV namespace, `wrangler secret put LICENSE_ADMIN_SECRET`, `wrangler deploy`, emitir uma chave, e force-move da tag `media-forge-v0.2.0`.

---

## Alternativa Keygen (drop-in)

Se o usuário cravar **Keygen** em vez do Worker próprio:

- **Pular Tasks 2-4** (não há Worker a escrever).
- **Manter Tasks 5-9, 11-13** quase intactas — o cliente (`client.ts`) já é agnóstico. Mudanças:
  - `MAXVISION_LICENSE_SERVER_URL` aponta para o endpoint Keygen `POST /v1/accounts/<acct>/licenses/actions/validate-key`.
  - Keygen retorna `{ meta: { valid, detail, code }, data: {...} }` — adicionar um pequeno **adapter** em `client.ts` que detecta o shape Keygen (presença de `meta.code`) e mapeia: `code === 'VALID'` → `ok`; `code === 'SUSPENDED'|'BANNED'` → `revoked`; `EXPIRED` → `invalid`; erro de rede → `unreachable`.
  - `instanceId` vira o **fingerprint** do machine activation do Keygen (Keygen tem node-locking nativo → substitui o `boundInstanceId` do Worker).
  - issue/revoke = painel/API do Keygen (não há admin endpoint próprio a manter).
- Trade-off: menos código a manter (sem Worker), mas dependência externa + custo por licença + chave de API do Keygen a guardar como secret (`KEYGEN_TOKEN`).

O contrato `LicenseStatus` e o gate (Tasks 6-9) são idênticos nos dois caminhos — a escolha Worker vs Keygen afeta só o transporte em `client.ts` e a existência do projeto `license-worker/`.

---

## Self-Review

**Spec coverage:** F-F cobre §5 (Licença C1 — validate-by-key boot + re-check periódico, 403 em revogação, grace period offline; EULA comercial modelo n8n SUL) e a parte de §6 relevante (gating server-side, nunca confiar no plugin — o gate vive no servidor HTTP). Multi-arch atende ao requisito de agências on-prem x86. Billing/tenancy/tier real = F-C/F-D/F-E (fora daqui).

**Gate location (load-bearing):** o gate emite **HTTP 403** porque vive no middleware/handler HTTP de `/mcp`. O `wrap()` per-tool (`handlers.ts:1607`) só retorna `{isError:true}` = JSON-RPC error com **HTTP 200** — fisicamente incapaz de satisfazer o exit "403 quando revogada". Por isso o gate NÃO está em `wrap`; está em `app.ts`/`middleware.ts`. O teste de integração (Task 9) asserta o status 403 literal — é a prova do exit.

**Ordem auth→licença:** `app.ts` checa auth (401) ANTES da licença (403) para não vazar estado de licença a chamadas anônimas. Testado na Task 9 ("auth-first").

**Cache, não rede-por-request:** o middleware lê `cache.getState()` síncrono; a rede só roda no `start()` e no `setInterval`. Preserva p95<100ms (§3 perf) e custo do Worker. Grace period (spec §5): `unreachable` dentro de `graceMs` mantém último estado bom; expirado → 403; boot sem cache bom → fail-closed.

**Env não-morta:** as 3 envs voltam ao contrato (Task 1 `config.ts` + Task 11 stack yml) SÓ porque agora HÁ consumidor (`LicenseCache`→gate). No hosted, `LICENSE_CHECK_ENABLED:-false` → código lê (default false), não monta cache → existe no contrato porque é lida, conforme a regra do stack yml.

**Placeholder scan:** sem placeholders de código. Únicos `REPLACE_*`: `wrangler.toml` KV id (valor de deploy, não código) e `<seu-worker>`/`<chave>` na doc de onboarding (instruções ao operador). Marcados como prerequisites de deploy, não TBDs de implementação.

**Type consistency:** `LicenseStatus`/`LicenseState`/`LicenseTier` (`types.ts`) usados em `client.ts`, `cache.ts`, `middleware.ts`, `app.ts`, `server.ts` e nos testes com a mesma forma. `LicenseRecord`/`LicenseStore` compartilhados entre `store.ts` e `index.ts` do Worker. `buildHttpApp({licenseState})` consistente entre Tasks 7/8/9.

**Known execution-time / confirmar no executor:**
1. **Workers KV/D1 + Wrangler bindings + vitest pool:** context7-mcp NÃO está acessível neste ambiente (apesar do banner MCP). O executor DEVE confirmar `env.KV.get/put` (json mode), o `compatibility_date`, e o setup do `@cloudflare/vitest-pool-workers` (binding `LICENSE_ADMIN_SECRET` no teste) via context7-mcp ou cloudflare MCP no Step 0 da Task 2/4 antes de codar. A superfície usada é estável, mas a versão do pool de teste muda o `vitest.config`.
2. **`startHttpServer` vira async** (`Promise<void>`): confirmar que nenhum import externo espera a assinatura síncrona de F-A (era chamado só pelo guard de entrypoint).
3. **`hostname()` como instanceId default:** em Swarm/escala o hostname muda por réplica → no self-host de réplica única é estável; se a agência escalar réplicas, exigir `MEDIA_FORGE_LICENSE_INSTANCE_ID` explícito (documentado no setup.md).

**Open decisions surfaced (não resolvidas aqui):** (a) Worker vs Keygen — usuário crava; (b) MIT→AGPL do core — decisão maior, fora do exit; (c) `buildServer` version hardcoded 0.1.1 vs package 0.2.0 — fora do escopo.
