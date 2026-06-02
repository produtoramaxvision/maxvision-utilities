# media-forge F-B — Async Output Delivery (MinIO/S3 + Webhook Endpoint)

> **For agentic workers:** REQUIRED SUB-SKILL: Use maxvision:subagent-driven-development (recommended) ou maxvision:executing-plans. Steps usam checkbox (`- [ ]`).

**Goal:** Substituir o disco efêmero do container como destino de artefatos gerados: toda mídia produzida pelos handlers (imagem síncrona, vídeo assíncrono) é enviada para o bucket MinIO da VPS e o resultado retornado ao cliente como `{ job_id, url, expires_at }` com URL assinada (presigned GET). Jobs longos retornam `job_id` imediatamente; o client faz poll via tool MCP existente e recebe a signed URL quando o job conclui. O webhook-router é promovido a endpoint público Hono na porta 3000, com TLS via Traefik já existente.

**Architecture:**
- `src/output/storage.ts` — novo módulo de storage que extende o `MinioClient` existente (`src/refs/minio-client.ts`) adicionando `putObject` (PutObjectCommand). Independente da flag `MEDIA_FORGE_REFS_ENABLED`.
- `src/output/output-storage.ts` — orquestra upload → presign → retorna `StoredArtifact { key, url, expiresAt }`. TTL padrão 7 dias (604800s), configurável via `MEDIA_FORGE_ARTIFACT_TTL_SECONDS`.
- `src/http/webhook-hono.ts` — monta as rotas `POST /:provider/:jobId` (relativas ao ponto de montagem `/webhooks`) como Hono app, reutilizando os validators HMAC/Ed25519 existentes (`createHmacValidator`, `verifyFalWebhookSignature`), com body-cap, origin-guard e rate-limit reimplementados via Hono middleware.
- `src/http/app.ts` (modificar) — montar `webhookMiddleware(secret)` quando `MEDIA_FORGE_WEBHOOK_SECRET` estiver presente.
- `src/http/app-internal.ts` (modificar) — passar `config` completo para `buildServer` incluindo MinIO; também ligar `setWebhookRouter` ao router Hono (expor `WebhookRouter`-like object para compatibilidade).
- `src/mcp/server.ts` (modificar) — `startHttpServer` levanta o webhook Hono; os handlers de provider (Higgsfield, Kling, Seedance) são registrados contra a interface do Hono webhook router.
- Handlers de imagem (`handlers.ts`) — após geração bem-sucedida, enviar o buffer para MinIO e retornar `{ job_id, url, expires_at }` em vez do path local.
- Handlers de webhook de vídeo (`createKlingWebhookHandler`, `createHiggsfieldWebhookHandler`, `createBytedanceWebhookHandler`) — quando `state=completed`, fazer upload do artefato para MinIO; poll usa `presignExistingArtifact` (stateless, MinIO como source of truth).
- `.maxvision/deploy/media-forge-mcp.stack.yml` (modificar) — adicionar as 7 vars MinIO/webhook consumidas.

**Decisão de arquitetura confirmada (opção A):** webhook como rota Hono na porta 3000, atrás do mesmo Traefik/TLS. Não um segundo servidor/porta. O `startWebhookRouter` (node:http, bind 127.0.0.1) **não é iniciado** no modo HTTP; as mesmas funções de validação criptográfica são reutilizadas.

**Limitação deliberada de escopo (nota para F-I):** `replicas: 1` mantido — o poll de status (video_jobs SQLite) é single-replica. Chave de artefato determinística (`outputs/{job_id}.{ext}`) permite que headObject/presign sejam stateless (MinIO como source of truth), mas o state de job em si (SQLite) limita escala horizontal. Documentado no stack.

**Tech Stack:** TypeScript ESM, Node ≥22.5, `@aws-sdk/client-s3` ^3.700.0 (já instalado), `@aws-sdk/s3-request-presigner` ^3.700.0 (já instalado), Hono ^4.6.0 (já instalado), vitest.

**Spec fonte:** `.maxvision/specs/2026-06-01-media-forge-infoproduct-design.md` §3.2 (async jobs), §3.3 (entrega via URL assinada), §8 (F-B exit criteria). Índice-mestre: `.maxvision/plans/2026-06-02-media-forge-infoproduct-implementation.md`.

**Versão:** v0.2.0 fixo — sem bump. Fixes force-movem a tag no CI.

---

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/output/storage.ts` | **Criar** | S3Client wrapper com `putObject` + `presignGet`; independente de `refsEnabled` |
| `src/output/output-storage.ts` | **Criar** | Orquestra upload → presign → `StoredArtifact`; TTL configurável |
| `src/http/webhook-hono.ts` | **Criar** | Hono app: rotas `POST /:provider/:jobId` (montado em `/webhooks`) com body-cap, origin-guard, rate-limit, HMAC/Ed25519 |
| `src/http/app.ts` | **Modificar** | Montar `webhookMiddleware` quando secret presente; passar env para `handleMcpRequest` |
| `src/http/app-internal.ts` | **Modificar** | Chamar `buildServer({ config })` com config completo; inicializar webhook Hono router e registrar handlers |
| `src/mcp/server.ts` | **Modificar** | `startHttpServer` ligar handlers de provider ao webhook Hono router |
| `src/mcp/handlers.ts` | **Modificar** | Handlers de imagem: upload pós-geração + retornar `url`/`expires_at`. Poll handlers: `presignExistingArtifact` (MinIO como source of truth). |
| `.maxvision/deploy/media-forge-mcp.stack.yml` | **Modificar** | Adicionar 7 vars MINIO_*/WEBHOOK_* consumidas |

---

## Provisão de Infra: MinIO na VPS

> Executar manualmente no servidor antes do redeploy. Não vai no código.

### Pré-requisito: `mc` disponível no servidor

```bash
# Verificar se mc já está instalado
mc --version
# Se não, instalar:
wget https://dl.min.io/client/mc/release/linux-arm64/mc -O /usr/local/bin/mc
chmod +x /usr/local/bin/mc
```

### Configurar alias pro MinIO da VPS

```bash
mc alias set myvps https://s3.meuagente.api.br \
  <MINIO_ROOT_ACCESS_KEY> \
  <MINIO_ROOT_SECRET_KEY>
```

### Criar bucket `media-forge-outputs` e access key dedicada

```bash
# 1. Criar bucket
mc mb myvps/media-forge-outputs

# 2. Criar service account (access key dedicada)
mc admin user svcacct add myvps <MINIO_ROOT_ACCESS_KEY> \
  --name media-forge-svc \
  --expiry 0
# Anotar AccessKey + SecretKey retornados — serão MINIO_ACCESS_KEY + MINIO_SECRET_KEY no stack

# 3. Criar policy mínima: GetObject + PutObject no bucket media-forge-outputs
cat > /tmp/media-forge-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:HeadObject"],
      "Resource": "arn:aws:s3:::media-forge-outputs/*"
    }
  ]
}
EOF
mc admin policy create myvps media-forge-outputs-rw /tmp/media-forge-policy.json

# 4. Associar policy ao service account
mc admin user svcacct edit myvps <ACCESS_KEY_GERADO> \
  --policy /tmp/media-forge-policy.json

# 5. Validar: deve listar objetos (vazio)
mc ls myvps/media-forge-outputs
```

> Os valores obtidos em (2) são as vars `MINIO_ACCESS_KEY` e `MINIO_SECRET_KEY` configuradas no Portainer.

---

## Task 1: Módulo de storage (`src/output/storage.ts`)

**Objetivo:** Estender o client MinIO existente com `putObject`, sem duplicar o setup do S3Client. Independente da flag `refsEnabled`.

**Files:** Create `src/output/storage.ts`, Create `tests/unit/output/storage.test.ts`

### Step 1: Teste que falha

```ts
// tests/unit/output/storage.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createOutputStorageClient } from '../../../src/output/storage.js';

describe('createOutputStorageClient', () => {
  it('retorna cliente com putObject e presignGet', () => {
    const client = createOutputStorageClient({
      endpoint: 'https://s3.meuagente.api.br',
      region: 'us-east-1',
      accessKey: 'ak',
      secretKey: 'sk',
      bucket: 'media-forge-outputs',
      useSsl: true,
    });
    expect(typeof client.putObject).toBe('function');
    expect(typeof client.presignGet).toBe('function');
  });

  it('lança quando credentials ausentes', () => {
    const client = createOutputStorageClient({
      endpoint: 'https://s3.meuagente.api.br',
      region: 'us-east-1',
      bucket: 'media-forge-outputs',
      useSsl: true,
    });
    expect(() => client.putObject('key', Buffer.from(''), 'video/mp4')).rejects.toThrow('MinIO credentials missing');
  });
});
```

### Step 2: Rodar — falha

```bash
cd /c/Users/MaxVision/Desktop/cursor-oficial/maxvision-utilities/media-forge
pnpm vitest run tests/unit/output/storage.test.ts
```

Expected: FAIL (módulo não existe).

### Step 3: Implementar

```ts
// src/output/storage.ts
// Thin S3/MinIO client para artefatos gerados (outputs). Independente de
// MEDIA_FORGE_REFS_ENABLED — entrega de artefato não pode ser bloqueada pela
// feature flag de refs. Usa os mesmos pacotes já instalados:
// @aws-sdk/client-s3 ^3.700.0 + @aws-sdk/s3-request-presigner ^3.700.0.
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface OutputStorageConfig {
  endpoint: string;
  region: string;
  accessKey?: string;
  secretKey?: string;
  bucket: string;
  useSsl: boolean;
}

export interface OutputStorageClient {
  /** Upload bytes. Returns the storage key. */
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Generate a presigned GET URL valid for `ttlSeconds`. */
  presignGet(key: string, ttlSeconds: number): Promise<string>;
  /** Check if a key exists (used by stateless poll path). */
  headObject(key: string): Promise<{ size: number; contentType?: string } | null>;
}

export function createOutputStorageClient(cfg: OutputStorageConfig): OutputStorageClient {
  if (!cfg.accessKey || !cfg.secretKey) {
    return {
      putObject: () => Promise.reject(new Error('MinIO credentials missing (MINIO_ACCESS_KEY / MINIO_SECRET_KEY)')),
      presignGet: () => Promise.reject(new Error('MinIO credentials missing')),
      headObject: () => Promise.reject(new Error('MinIO credentials missing')),
    };
  }

  const s3 = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
  });

  return {
    async putObject(key, body, contentType) {
      await s3.send(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },
    async presignGet(key, ttlSeconds) {
      const cmd = new GetObjectCommand({ Bucket: cfg.bucket, Key: key });
      return getSignedUrl(s3, cmd, { expiresIn: ttlSeconds });
    },
    async headObject(key) {
      try {
        const resp = await s3.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
        return { size: resp.ContentLength ?? 0, contentType: resp.ContentType };
      } catch (err) {
        // S3 throws NoSuchKey / NotFound on missing object
        const code = (err as { name?: string; $metadata?: { httpStatusCode?: number } })
          .$metadata?.httpStatusCode;
        if (code === 404 || (err as { name?: string }).name === 'NotFound') {
          return null;
        }
        throw err;
      }
    },
  };
}

/** Build from MediaForgeConfig (uses MINIO_* env already loaded by loadConfig). */
export function outputStorageFromConfig(
  cfg: Pick<
    import('../core/config.js').MediaForgeConfig,
    'minioEndpoint' | 'minioRegion' | 'minioBucket' | 'minioAccessKey' | 'minioSecretKey' | 'minioUseSsl'
  >,
): OutputStorageClient | null {
  if (!cfg.minioEndpoint) return null;
  return createOutputStorageClient({
    endpoint: cfg.minioEndpoint,
    region: cfg.minioRegion,
    accessKey: cfg.minioAccessKey,
    secretKey: cfg.minioSecretKey,
    bucket: cfg.minioBucket,
    useSsl: cfg.minioUseSsl,
  });
}
```

### Step 4: Rodar — passa

```bash
cd /c/Users/MaxVision/Desktop/cursor-oficial/maxvision-utilities/media-forge
pnpm vitest run tests/unit/output/storage.test.ts
```

Expected: PASS (2 tests).

### Step 5: Typecheck + commit

```bash
cd /c/Users/MaxVision/Desktop/cursor-oficial/maxvision-utilities/media-forge
pnpm typecheck
git add src/output/storage.ts tests/unit/output/storage.test.ts
git commit -m "feat(storage): OutputStorageClient with putObject + presignGet (MinIO/S3 artifact delivery)"
```

---

## Task 2: Orquestrador de storage (`src/output/output-storage.ts`)

**Objetivo:** Encapsular a lógica de upload + presign + TTL. Retorna `StoredArtifact { key, url, expiresAt }` para os handlers.

**Files:** Create `src/output/output-storage.ts`, Create `tests/unit/output/output-storage.test.ts`

### Step 1: Teste que falha

```ts
// tests/unit/output/output-storage.test.ts
import { describe, it, expect, vi } from 'vitest';
import { storeArtifact, artifactKey } from '../../../src/output/output-storage.js';
import type { OutputStorageClient } from '../../../src/output/storage.js';

describe('artifactKey', () => {
  it('gera chave determinística outputs/{job_id}.{ext}', () => {
    expect(artifactKey('20260602T120000Z-abc123-myjob', 'video/mp4')).toBe(
      'outputs/20260602T120000Z-abc123-myjob.mp4',
    );
    expect(artifactKey('somejob', 'image/png')).toBe('outputs/somejob.png');
    expect(artifactKey('somejob', 'image/jpeg')).toBe('outputs/somejob.jpg');
    expect(artifactKey('somejob', 'application/octet-stream')).toBe('outputs/somejob.bin');
  });
});

describe('storeArtifact', () => {
  it('chama putObject + presignGet e retorna StoredArtifact', async () => {
    const putObject = vi.fn().mockResolvedValue(undefined);
    const presignGet = vi.fn().mockResolvedValue('https://s3.example.com/outputs/job1.mp4?sig=xxx');
    const headObject = vi.fn();
    const storageClient: OutputStorageClient = { putObject, presignGet, headObject };

    const result = await storeArtifact({
      storage: storageClient,
      jobId: 'job1',
      bytes: Buffer.from('data'),
      contentType: 'video/mp4',
      ttlSeconds: 604800,
    });

    expect(putObject).toHaveBeenCalledWith('outputs/job1.mp4', expect.any(Buffer), 'video/mp4');
    expect(presignGet).toHaveBeenCalledWith('outputs/job1.mp4', 604800);
    expect(result.key).toBe('outputs/job1.mp4');
    expect(result.url).toBe('https://s3.example.com/outputs/job1.mp4?sig=xxx');
    expect(result.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
```

### Step 2: Rodar — falha

```bash
cd /c/Users/MaxVision/Desktop/cursor-oficial/maxvision-utilities/media-forge
pnpm vitest run tests/unit/output/output-storage.test.ts
```

Expected: FAIL (módulo não existe).

### Step 3: Implementar

```ts
// src/output/output-storage.ts
// Orquestra upload de artefato para MinIO + geração de presigned URL.
// TTL padrão: 7 dias (604800s). Configurável via MEDIA_FORGE_ARTIFACT_TTL_SECONDS.
import type { OutputStorageClient } from './storage.js';

export interface StoredArtifact {
  key: string;
  url: string;
  expiresAt: string; // ISO 8601
}

export interface StoreArtifactOpts {
  storage: OutputStorageClient;
  jobId: string;
  bytes: Buffer;
  contentType: string;
  ttlSeconds?: number;
}

const MIME_TO_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'application/octet-stream': 'bin',
};

/** Chave determinística: `outputs/{jobId}.{ext}`. Stateless — headObject/presign podem usar. */
export function artifactKey(jobId: string, contentType: string): string {
  const ext = MIME_TO_EXT[contentType] ?? 'bin';
  return `outputs/${jobId}.${ext}`;
}

/** Default TTL: 7 dias. Override: MEDIA_FORGE_ARTIFACT_TTL_SECONDS. */
export function defaultTtlSeconds(): number {
  const raw = process.env['MEDIA_FORGE_ARTIFACT_TTL_SECONDS'];
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 604800; // 7 days
}

export async function storeArtifact(opts: StoreArtifactOpts): Promise<StoredArtifact> {
  const ttl = opts.ttlSeconds ?? defaultTtlSeconds();
  const key = artifactKey(opts.jobId, opts.contentType);
  await opts.storage.putObject(key, opts.bytes, opts.contentType);
  const url = await opts.storage.presignGet(key, ttl);
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  return { key, url, expiresAt };
}

/**
 * Presign-only path para uso no poll handler.
 *
 * Design F-B: o upload para MinIO ocorre dentro do webhook handler do provider
 * (createKlingWebhookHandler / createHiggsfieldWebhookHandler /
 * createBytedanceWebhookHandler) no momento em que o job completa. O poll
 * handler apenas verifica se o objeto existe (headObject) e gera uma nova
 * URL assinada — sem re-baixar do CDN do provider. MinIO e a source of truth.
 *
 * Retorna null se o objeto nao existir ainda (job ainda nao concluido ou
 * upload nao aconteceu — fallback gracioso: o poll retorna assetUrls do provider).
 */
export async function presignExistingArtifact(opts: {
  storage: OutputStorageClient;
  jobId: string;
  contentType: string;
  ttlSeconds?: number;
}): Promise<StoredArtifact | null> {
  const ttl = opts.ttlSeconds ?? defaultTtlSeconds();
  const key = artifactKey(opts.jobId, opts.contentType);
  const head = await opts.storage.headObject(key);
  if (!head) return null;
  const url = await opts.storage.presignGet(key, ttl);
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  return { key, url, expiresAt };
}
```

### Step 4: Rodar — passa

```bash
cd /c/Users/MaxVision/Desktop/cursor-oficial/maxvision-utilities/media-forge
pnpm vitest run tests/unit/output/output-storage.test.ts
```

Expected: PASS (4 tests).

### Step 5: Typecheck + commit

```bash
cd /c/Users/MaxVision/Desktop/cursor-oficial/maxvision-utilities/media-forge
pnpm typecheck
git add src/output/output-storage.ts tests/unit/output/output-storage.test.ts
git commit -m "feat(storage): storeArtifact + presignExistingArtifact helpers (upload→presign→StoredArtifact)"
```

---

## Task 3: Webhook Hono middleware (`src/http/webhook-hono.ts`)

**Objetivo:** Promover o webhook-router de localhost a endpoint público, montado no Hono app da porta 3000 (opção A). Reutiliza `createHmacValidator` e `verifyFalWebhookSignature` existentes para verificação criptográfica; reimplementa body-cap, origin-guard e rate-limit como Hono middleware.

**Files:** Create `src/http/webhook-hono.ts`, Create `tests/unit/http/webhook-hono.test.ts`

### Step 1: Teste que falha

> `buildWebhookApp` retorna um Hono app com rotas **relativas** (sem prefixo `/webhooks`).
> Quando montado em `app.route('/webhooks', webhookApp)`, Hono concatena os caminhos.
> Os testes de unidade aqui batem direto no sub-app (sem mount), logo usam `/kling/job123`.
> Os testes de integração em `app-webhook.test.ts` batem no app montado e usam `/webhooks/...`.

```ts
// tests/unit/http/webhook-hono.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildWebhookApp } from '../../../src/http/webhook-hono.js';
import { createHmac } from 'node:crypto';

const SECRET = 'test-secret-12345678';

function signBody(body: string, timestamp: string): string {
  return (
    'sha256=' +
    createHmac('sha256', SECRET)
      .update(`${timestamp}.${body}`)
      .digest('hex')
  );
}

// NOTA: rotas relativas — sem prefixo /webhooks (esse vem do app.route() em app.ts).
describe('buildWebhookApp (sub-app, rotas relativas)', () => {
  it('GET / retorna status + handlers', async () => {
    const app = buildWebhookApp({ secret: SECRET });
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const json = await res.json() as { status: string; handlers: string[] };
    expect(json.status).toBe('ok');
    expect(Array.isArray(json.handlers)).toBe(true);
  });

  it('POST /:provider/:jobId sem content-type json → 415', async () => {
    const app = buildWebhookApp({ secret: SECRET });
    const res = await app.request('/kling/job123', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    });
    expect(res.status).toBe(415);
  });

  it('POST com Origin header → 403', async () => {
    const app = buildWebhookApp({ secret: SECRET });
    const res = await app.request('/kling/job123', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example.com' },
      body: '{}',
    });
    expect(res.status).toBe(403);
  });

  it('POST com assinatura HMAC invalida → 401', async () => {
    const app = buildWebhookApp({ secret: SECRET });
    const ts = String(Date.now());
    const res = await app.request('/kling/job123', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-timestamp': ts,
        'x-webhook-signature': 'sha256=invalidsig',
      },
      body: '{"status":"completed"}',
    });
    expect(res.status).toBe(401);
  });

  it('POST com HMAC valido e handler registrado → 200', async () => {
    const app = buildWebhookApp({ secret: SECRET });
    const handler = vi.fn().mockResolvedValue(undefined);
    app.webhookHandlers.set('kling', handler);

    const body = '{"status":"completed","output":{"video_url":"https://cdn.example.com/v.mp4"}}';
    const ts = String(Date.now());
    const sig = signBody(body, ts);

    const res = await app.request('/kling/job-abc', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-timestamp': ts,
        'x-webhook-signature': sig,
      },
      body,
    });
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'kling', jobId: 'job-abc' }),
    );
  });

  it('POST sem handler registrado → 404', async () => {
    const app = buildWebhookApp({ secret: SECRET });
    const body = '{}';
    const ts = String(Date.now());
    const sig = signBody(body, ts);
    const res = await app.request('/google/job-xyz', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-timestamp': ts,
        'x-webhook-signature': sig,
      },
      body,
    });
    expect(res.status).toBe(404);
  });
});
```

### Step 2: Rodar — falha

```bash
cd /c/Users/MaxVision/Desktop/cursor-oficial/maxvision-utilities/media-forge
pnpm vitest run tests/unit/http/webhook-hono.test.ts
```

Expected: FAIL (módulo não existe).

### Step 3: Implementar

```ts
// src/http/webhook-hono.ts
// Webhook endpoint público como Hono app — opcao A: mesma porta 3000 do /mcp.
// Montado em app.route('/webhooks', webhookApp) em app.ts — as rotas aqui sao
// RELATIVAS ao ponto de montagem (sem prefixo /webhooks).
// Reutiliza os validators criptograficos existentes:
//   - createHmacValidator (Higgsfield, Kling) de webhook-router.ts
//   - verifyFalWebhookSignature (fal.ai/Bytedance) de auth/fal-ed25519.ts
// Body-cap, origin-guard e rate-limit reimplementados como Hono middleware.
import { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Provider } from '../core/models.js';
import type { WebhookContext, WebhookHandler } from '../video/providers/webhook-router.js';
import { verifyFalWebhookSignature } from '../video/providers/auth/fal-ed25519.js';

const MAX_BODY_BYTES = 256 * 1024; // 256 KB
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000; // +-5 min
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 120;

// Per-IP rate limit (in-process; single replica).
// NOTE: behind Traefik req.socket.remoteAddress = proxy IP. Use
// X-Forwarded-For if available. Rate-limit cross-replica -> F-C (Redis).
const rateMap = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = rateMap.get(ip) ?? [];
  const recent = arr.filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  rateMap.set(ip, recent);
  return recent.length > RATE_MAX;
}

function verifyHmac(secret: string, timestamp: string, body: string, sigHeader: string): boolean {
  if (!sigHeader.startsWith('sha256=')) return false;
  const signedPayload = `${timestamp}.${body}`;
  const expected = createHmac('sha256', secret).update(signedPayload).digest('hex');
  const provided = sigHeader.slice('sha256='.length);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(provided, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// Intersection type (nao interface extends ReturnType<...> que nao compila).
export type WebhookHonoApp = Hono & {
  /** Mutable map: provider -> handler. Injetado por startHttpServer. */
  readonly webhookHandlers: Map<Provider, WebhookHandler>;
  /** Per-provider auth override (extensibilidade; fal.ai usa branch inline). */
  readonly authOverrides: Map<Provider, (headers: Record<string, string>, body: string) => Promise<boolean>>;
};

export interface BuildWebhookAppOpts {
  secret: string;
}

export function buildWebhookApp(opts: BuildWebhookAppOpts): WebhookHonoApp {
  const { secret } = opts;
  const honoApp = new Hono();
  const webhookHandlers = new Map<Provider, WebhookHandler>();
  const authOverrides = new Map<Provider, (headers: Record<string, string>, body: string) => Promise<boolean>>();

  // Cast to intersection type after attaching the extra maps.
  const app = honoApp as unknown as WebhookHonoApp;
  (app as unknown as Record<string, unknown>).webhookHandlers = webhookHandlers;
  (app as unknown as Record<string, unknown>).authOverrides = authOverrides;

  // Status endpoint (rota relativa — sera acessivel em GET /webhooks/ apos mount)
  honoApp.get('/', (c) =>
    c.json({ status: 'ok', handlers: Array.from(webhookHandlers.keys()) }),
  );

  // Webhook dispatch (rota relativa — sera POST /webhooks/:provider/:jobId apos mount)
  honoApp.post('/:provider/:jobId', async (c) => {
    const provider = c.req.param('provider') as Provider;
    const jobId = c.req.param('jobId');

    // Origin guard (block browser CORS requests)
    if (c.req.header('origin')) return c.body(null, 403);

    // Content-type guard
    const ct = c.req.header('content-type') ?? '';
    if (!ct.startsWith('application/json')) return c.body(null, 415);

    // Rate limit (keyed on X-Forwarded-For or remoteAddress from raw)
    const clientIp =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    if (isRateLimited(clientIp)) return c.body(null, 429);

    // Read body with cap
    const raw = await c.req.raw.arrayBuffer();
    if (raw.byteLength > MAX_BODY_BYTES) return c.body(null, 413);
    const bodyStr = Buffer.from(raw).toString('utf8');

    // Auth dispatch: fal.ai/bytedance → ED25519; everyone else → HMAC
    const isFalProvider = provider === 'bytedance';
    let authOk = false;

    if (isFalProvider) {
      // Map Hono headers to plain object for verifyFalWebhookSignature
      const headers: Record<string, string> = {};
      c.req.raw.headers.forEach((v, k) => {
        headers[k] = v;
      });
      try {
        const result = await verifyFalWebhookSignature({
          headers: headers as unknown as import('node:http').IncomingHttpHeaders,
          body: Buffer.from(raw),
        });
        authOk = result.valid;
      } catch {
        authOk = false;
      }
    } else {
      // Check custom override first (extensibility), then HMAC default
      const override = authOverrides.get(provider);
      if (override) {
        const headers: Record<string, string> = {};
        c.req.raw.headers.forEach((v, k) => { headers[k] = v; });
        authOk = await override(headers, bodyStr).catch(() => false);
      } else {
        const ts = c.req.header('x-webhook-timestamp');
        const sig = c.req.header('x-webhook-signature');
        if (
          ts &&
          sig &&
          Number.isFinite(Number(ts)) &&
          Math.abs(Date.now() - Number(ts)) <= TIMESTAMP_TOLERANCE_MS
        ) {
          authOk = verifyHmac(secret, ts, bodyStr, sig);
        }
      }
    }

    if (!authOk) return c.body(null, 401);

    const handler = webhookHandlers.get(provider);
    if (!handler) return c.body(null, 404);

    let payload: unknown;
    try {
      payload = bodyStr.length > 0 ? JSON.parse(bodyStr) : {};
    } catch {
      return c.body(null, 400);
    }

    const headers: Record<string, string | string[] | undefined> = {};
    c.req.raw.headers.forEach((v, k) => { headers[k] = v; });

    const ctx: WebhookContext = { provider, jobId, payload, headers };
    try {
      await handler(ctx);
      return c.body(null, 200);
    } catch (err) {
      process.stderr.write(
        `[webhook-hono] handler error for ${provider}/${jobId}: ${(err as Error).message}\n`,
      );
      return c.body(null, 500);
    }
  });

  return app;
}
```

### Step 4: Rodar — passa

```bash
cd /c/Users/MaxVision/Desktop/cursor-oficial/maxvision-utilities/media-forge
pnpm vitest run tests/unit/http/webhook-hono.test.ts
```

Expected: PASS (6 tests).

### Step 5: Typecheck + commit

```bash
cd /c/Users/MaxVision/Desktop/cursor-oficial/maxvision-utilities/media-forge
pnpm typecheck
git add src/http/webhook-hono.ts tests/unit/http/webhook-hono.test.ts
git commit -m "feat(http): Hono webhook sub-app POST /:provider/:jobId (HMAC+Ed25519, body-cap, origin-guard)"
```

---

## Task 4: Montar webhook no Hono app + ligar ao servidor HTTP

**Objetivo:** `app.ts` monta o `buildWebhookApp` como sub-app Hono quando `MEDIA_FORGE_WEBHOOK_SECRET` estiver presente; `app-internal.ts` inicializa os handlers de provider (Higgsfield, Kling, Seedance/Bytedance) no webhook Hono router; `server.ts` expõe o webhookApp via `startHttpServer`.

**Files:** Modify `src/http/app.ts`, Modify `src/http/app-internal.ts`, Modify `src/http/server.ts`, Create `tests/unit/http/app-webhook.test.ts`

### Step 1: Teste que falha

```ts
// tests/unit/http/app-webhook.test.ts
import { describe, it, expect } from 'vitest';
import { buildHttpApp } from '../../../src/http/app.js';
import { createHmac } from 'node:crypto';

const SECRET = 'webhook-secret-test';

function signBody(body: string, ts: string): string {
  return 'sha256=' + createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex');
}

describe('buildHttpApp com webhook secret', () => {
  const env = {
    MEDIA_FORGE_API_KEYS: 'key-test',
    MEDIA_FORGE_WEBHOOK_SECRET: SECRET,
    GOOGLE_API_KEY: 'test',
  } as NodeJS.ProcessEnv;

  it('GET /webhooks/ → 200 (status do webhook app)', async () => {
    const app = buildHttpApp({ env });
    const res = await app.request('/webhooks/');
    expect(res.status).toBe(200);
    const json = await res.json() as { status: string };
    expect(json.status).toBe('ok');
  });

  it('POST /webhooks/kling/job1 sem assinatura → 401', async () => {
    const app = buildHttpApp({ env });
    const res = await app.request('/webhooks/kling/job1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(401);
  });
});

describe('buildHttpApp sem webhook secret', () => {
  const env = { MEDIA_FORGE_API_KEYS: 'key-test', GOOGLE_API_KEY: 'test' } as NodeJS.ProcessEnv;

  it('GET /webhooks/ → 404 (webhook desabilitado)', async () => {
    const app = buildHttpApp({ env });
    const res = await app.request('/webhooks/');
    expect(res.status).toBe(404);
  });
});
```

### Step 2: Rodar — falha

```bash
cd /c/Users/MaxVision/Desktop/cursor-oficial/maxvision-utilities/media-forge
pnpm vitest run tests/unit/http/app-webhook.test.ts
```

Expected: FAIL (app.ts não tem o mount).

### Step 3: Modificar `src/http/app.ts`

```ts
// src/http/app.ts
import { Hono } from 'hono';
import { resolveAuth } from './auth.js';
import { handleMcpRequest } from './app-internal.js';
import { buildWebhookApp } from './webhook-hono.js';

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
    return handleMcpRequest(c.req.raw, auth.ctx, env);
  });

  // Mount webhook app when secret is configured. Absent secret = endpoint disabled.
  const secret = env['MEDIA_FORGE_WEBHOOK_SECRET'];
  if (secret && secret.length > 0) {
    const webhookApp = buildWebhookApp({ secret });
    // Store on the Hono app for handler injection by startHttpServer / tests.
    (app as unknown as Record<string, unknown>).webhookApp = webhookApp;
    app.route('/webhooks', webhookApp as unknown as Hono);
  }

  return app;
}
```

### Step 4: Modificar `src/http/app-internal.ts` — passar config + expor webhookApp setup

```ts
// src/http/app-internal.ts
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { buildServer } from '../mcp/server.js';
import { loadConfig } from '../core/config.js';
import { outputStorageFromConfig } from '../output/output-storage.js';
import type { AuthContext } from './auth.js';

export async function handleMcpRequest(
  req: Request,
  _ctx: AuthContext,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Response> {
  // Stateless: server + transport frescos por request.
  // env passado para loadConfig para que testes injetem variáveis sem afetar process.env.
  // _ctx carrega o tenant em F-C (injeção nos handlers); em F-A/F-B é só a apiKey.
  const config = loadConfig(env);
  const storage = outputStorageFromConfig(config);
  const server = buildServer({ config, storage: storage ?? undefined });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}
```

### Step 5: Modificar `src/http/server.ts` — ligar handlers de provider ao webhook

```ts
// src/http/server.ts
// NOTA: Task 7 ira adicionar `storage` aos createXxxWebhookHandler calls abaixo.
// Este bloco (Task 4) conecta o webhook Hono sem storage ainda — storage e adicionado
// na Task 7 Step 4, que modifica este mesmo arquivo.
import { serve } from '@hono/node-server';
import { buildHttpApp } from './app.js';
import { logger } from '../core/logger.js';
import { loadConfig } from '../core/config.js';
import { outputStorageFromConfig } from '../output/output-storage.js';
import { createKlingWebhookHandler } from '../video/providers/kling-webhook-handler.js';
import { createHiggsfieldWebhookHandler } from '../video/providers/higgsfield-webhook-handler.js';
import { createBytedanceWebhookHandler } from '../video/providers/bytedance-webhook-handler.js';
import { isSeedanceEnabled } from '../core/feature-flags.js';
import { join } from 'node:path';
import type { WebhookHonoApp } from './webhook-hono.js';

export function startHttpServer(): void {
  const port = Number(process.env['MEDIA_FORGE_HTTP_PORT'] ?? 8787);
  const config = loadConfig(process.env);
  // storage sera passado para os handlers na Task 7; importado ja aqui para evitar
  // uma segunda modificacao deste arquivo que quebre o typecheck.
  const _storage = outputStorageFromConfig(config) ?? undefined;
  const app = buildHttpApp();
  const appRec = app as unknown as Record<string, unknown>;

  // Wire provider webhook handlers into the Hono webhook app if it was mounted.
  const webhookApp = appRec['webhookApp'] as WebhookHonoApp | undefined;
  if (webhookApp) {
    const projectDir = process.env['MEDIA_FORGE_PROJECT_DIR'] ?? join(process.cwd(), '.media-forge');
    const dbPath = join(projectDir, 'cost.db');

    // Higgsfield HMAC handler (storage adicionado na Task 7)
    webhookApp.webhookHandlers.set(
      'higgsfield',
      createHiggsfieldWebhookHandler({ dbPath }),
    );

    // Kling HMAC handler (storage adicionado na Task 7)
    webhookApp.webhookHandlers.set(
      'kling',
      createKlingWebhookHandler({
        dbPath,
        outputsDir: join(projectDir, 'outputs', 'kling'),
        env: process.env as never,
      }),
    );

    // fal.ai / Bytedance-Seedance — ED25519 auth branch inline em webhook-hono.ts.
    // Drain quando MEDIA_FORGE_SEEDANCE_ENABLED=false para ACK in-flight jobs.
    const seedanceOutputsDir = join(projectDir, 'outputs', 'seedance');
    if (isSeedanceEnabled()) {
      webhookApp.webhookHandlers.set(
        'bytedance',
        createBytedanceWebhookHandler({ dbPath, outputsDir: seedanceOutputsDir }),
      );
    } else {
      webhookApp.webhookHandlers.set('bytedance', async (ctx) => {
        process.stderr.write(
          `[bytedance-webhook] drained (MEDIA_FORGE_SEEDANCE_ENABLED=false). jobId='${ctx.jobId}'.\n`,
        );
      });
    }

    logger.info('webhook Hono endpoint active', {
      path: '/webhooks/:provider/:jobId',
      handlers: Array.from(webhookApp.webhookHandlers.keys()),
    });
  } else {
    logger.warn('webhook endpoint disabled (MEDIA_FORGE_WEBHOOK_SECRET unset)');
  }

  serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });
  logger.info('media-forge MCP HTTP server ready', { port });
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startHttpServer();
}
```

### Step 6: Rodar — passa

```bash
cd /c/Users/MaxVision/Desktop/cursor-oficial/maxvision-utilities/media-forge
pnpm vitest run tests/unit/http/app-webhook.test.ts
```

Expected: PASS (3 tests).

### Step 7: Typecheck + commit

```bash
cd /c/Users/MaxVision/Desktop/cursor-oficial/maxvision-utilities/media-forge
pnpm typecheck
git add src/http/app.ts src/http/app-internal.ts src/http/server.ts tests/unit/http/app-webhook.test.ts
git commit -m "feat(http): mount Hono webhook endpoint + wire provider handlers in startHttpServer"
```

---

## Task 5: Passar `storage` para `buildServer` e `registerAllTools`

**Objetivo:** Injetar o `OutputStorageClient` nos handlers via `BuildServerOpts` e `HandlersDeps`, sem quebrar testes existentes (storage opcional → graceful degradation).

**Files:** Modify `src/mcp/server.ts` (buildServer), Modify `src/mcp/handlers.ts` (HandlersDeps + registerAllTools), Create `tests/unit/mcp/storage-injection.test.ts`

### Step 1: Teste que falha

```ts
// tests/unit/mcp/storage-injection.test.ts
import { describe, it, expect } from 'vitest';
import { buildServer } from '../../../src/mcp/server.js';

describe('buildServer com storage injetado', () => {
  it('não lança sem storage (degradação graciosa)', () => {
    // Sem storage: handlers funcionam, artefatos ficam no disco (modo legado)
    expect(() => buildServer({})).not.toThrow();
  });

  it('não lança com storage null', () => {
    expect(() => buildServer({ storage: undefined })).not.toThrow();
  });
});
```

### Step 2: Rodar — falha

```bash
cd /c/Users/MaxVision/Desktop/cursor-oficial/maxvision-utilities/media-forge
pnpm vitest run tests/unit/mcp/storage-injection.test.ts
```

Expected: FAIL (buildServer não aceita `storage` em BuildServerOpts).

### Step 3: Modificar `src/mcp/server.ts` — adicionar `storage` em `BuildServerOpts`

Em `BuildServerOpts`, adicionar:

```ts
// Antes da interface BuildServerOpts
import type { OutputStorageClient } from '../output/storage.js';

export interface BuildServerOpts {
  config?: ReturnType<typeof loadConfig>;
  client?: ReturnType<typeof createClient>;
  /** F-B: artifact storage client. When undefined, handlers write to local disk (graceful degradation). */
  storage?: OutputStorageClient;
}
```

No corpo de `buildServer`, passar para `registerAllTools`:

```ts
registerAllTools(server, { client, config, storage: opts.storage });
```

### Step 4: Modificar `src/mcp/handlers.ts` — adicionar `storage` em `HandlersDeps`

```ts
// Em HandlersDeps (linha ~1568):
import type { OutputStorageClient } from '../output/storage.js';

export interface HandlersDeps {
  client: MediaForgeClient;
  config: MediaForgeConfig;
  outputManager?: OutputManager;
  /** F-B: quando presente, artefatos são enviados para MinIO; resultado retorna url + expires_at. */
  storage?: OutputStorageClient;
}
```

No corpo de `registerAllTools`:

```ts
const { client, config, storage } = deps;
```

### Step 5: Rodar — passa

```bash
cd /c/Users/MaxVision/Desktop/cursor-oficial/maxvision-utilities/media-forge
pnpm vitest run tests/unit/mcp/storage-injection.test.ts
pnpm vitest run tests/unit/http/  # suite existente não quebra
```

Expected: PASS.

### Step 6: Typecheck + commit

```bash
cd /c/Users/MaxVision/Desktop/cursor-oficial/maxvision-utilities/media-forge
pnpm typecheck
git add src/mcp/server.ts src/mcp/handlers.ts tests/unit/mcp/storage-injection.test.ts
git commit -m "feat(mcp): thread OutputStorageClient through BuildServerOpts→HandlersDeps (F-B injection point)"
```

---

## Task 6: Upload pós-geração nos handlers de imagem

**Objetivo:** Quando `storage` estiver disponível, os handlers `media_generate_image` e `media_generate_imagen` fazem upload do buffer gerado para MinIO e retornam `{ job_id, url, expires_at, ...metadados }` em vez de `localPath`. Degradação graciosa: sem storage, comportamento F-A inalterado.

**Arquitetura:** Os handlers de imagem em `handlers.ts` chamam `generateImageNanoBananaPro`/`generateImageImagen4Ultra`, que retornam um buffer + metadata (verificar em `image-service.ts`). Após o retorno da chamada de geração, o handler armazena o artefato com `storeArtifact` usando o `jobId` do tool call (gerado via `generateJobId` ou extraído do resultado).

**Files:** Modify `src/mcp/handlers.ts` (handlers de imagem), Create `tests/unit/mcp/image-storage.test.ts`

### Step 1: Ler `src/image/image-service.ts` para confirmar shape do retorno

> O executor deve ler `src/image/image-service.ts` antes de implementar este step para confirmar o tipo retornado por `generateImageNanoBananaPro` e `generateImageImagen4Ultra` (bytes Buffer, path local, ou URL base64). O plano assume que esses retornam um objeto com `bytes?: Buffer` ou `localPath: string` — ajustar conforme o shape real encontrado.

### Step 2: Teste que falha

```ts
// tests/unit/mcp/image-storage.test.ts
import { describe, it, expect, vi } from 'vitest';

// Este teste verifica o comportamento do wrapper storeArtifact
// dentro dos handlers de imagem via mock do storage.
// A implementação final é integração; este teste é de unidade do wrapper.
import { storeArtifact, artifactKey } from '../../../src/output/output-storage.js';

describe('storeArtifact para imagens', () => {
  it('gera chave correta para image/png', () => {
    expect(artifactKey('img-job-01', 'image/png')).toBe('outputs/img-job-01.png');
  });
  it('gera chave correta para image/webp', () => {
    expect(artifactKey('img-job-02', 'image/webp')).toBe('outputs/img-job-02.webp');
  });
  it('storeArtifact retorna url + expiresAt', async () => {
    const putObject = vi.fn().mockResolvedValue(undefined);
    const presignGet = vi.fn().mockResolvedValue('https://s3.example.com/outputs/img1.png?s=x');
    const result = await storeArtifact({
      storage: { putObject, presignGet, headObject: vi.fn() },
      jobId: 'img1',
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      contentType: 'image/png',
      ttlSeconds: 604800,
    });
    expect(result.url).toContain('s3.example.com');
    expect(result.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
```

### Step 3: Rodar — deve passar (usa código da Task 2)

```bash
cd /c/Users/MaxVision/Desktop/cursor-oficial/maxvision-utilities/media-forge
pnpm vitest run tests/unit/mcp/image-storage.test.ts
```

Expected: PASS (3 tests — reutiliza output-storage.ts da Task 2).

### Step 4: Implementar wiring nos handlers de imagem em `handlers.ts`

Dentro de `registerAllTools`, modificar o bloco do tool `media_generate_image`:

```ts
// Dentro de registerAllTools, substituir o handler de media_generate_image:
{
  const t = getTool('media_generate_image');
  reg(
    t.name,
    { title: 'Generate Image (Nano Banana Pro)', description: t.description, inputSchema: t.inputSchema as never },
    wrap(t.name, async (input) => {
      const result = await generateImageNanoBananaPro(validateInput(t, input), client);
      // F-B: se storage disponível, enviar para MinIO e retornar URL assinada.
      if (storage && result.bytes && result.jobId) {
        const { storeArtifact } = await import('../output/output-storage.js');
        const artifact = await storeArtifact({
          storage,
          jobId: result.jobId,
          bytes: result.bytes,
          contentType: result.mimeType ?? 'image/png',
        });
        return asResult({ ...result, url: artifact.url, expires_at: artifact.expiresAt });
      }
      return asResult(result);
    }),
  );
}
```

> Repetir o mesmo padrão para `media_generate_imagen` (`generateImageImagen4Ultra`).
> O executor deve confirmar os campos `bytes`, `jobId`, `mimeType` no shape do retorno de `image-service.ts` e ajustar os field accessors conforme o tipo real.

### Step 5: Typecheck + commit

```bash
cd /c/Users/MaxVision/Desktop/cursor-oficial/maxvision-utilities/media-forge
pnpm typecheck
git add src/mcp/handlers.ts tests/unit/mcp/image-storage.test.ts
git commit -m "feat(handlers): upload image artifacts to MinIO and return signed URL when storage configured"
```

---

## Task 7: Signed URL no poll de video (Higgsfield, Kling, Seedance)

**Objetivo e design F-B:**

O upload para MinIO ocorre **no webhook handler do provider**, no momento em que o job completa (nao no poll handler). O poll handler chama `presignExistingArtifact` — que e stateless (headObject + presignGet) e nao re-baixa nada do CDN do provider. Isso garante que o artefato so e requisitado do provider uma vez e que o poll e idempotente.

Fluxo completo:
1. Provider envia callback a `POST /webhooks/{provider}/{job_id}`.
2. Webhook handler (`createKlingWebhookHandler` etc.) recebe o buffer do CDN e faz `storeArtifact` no MinIO.
3. Poll handler (`handleKlingPoll` etc.) chama `presignExistingArtifact`: se objeto existe no MinIO, retorna `url` + `expires_at`; senao, retorna `assetUrls` do provider como fallback.

**Consequencia arquitetural:** os tres handler factories precisam receber `storage?` como nova dependencia injetada por `startHttpServer` (via `webhookApp.webhookHandlers.set`).

**Files:**
- Modify `src/mcp/handlers.ts` (`handleHiggsfieldPoll`, `handleKlingPoll` — assinatura + poll logic)
- Modify `src/video/providers/kling-webhook-handler.ts` — aceitar `storage?`, fazer upload em `state=completed`
- Modify `src/video/providers/higgsfield-webhook-handler.ts` — idem
- Modify `src/video/providers/bytedance-webhook-handler.ts` — idem
- Modify `src/http/server.ts` — injetar `storage` ao criar os handlers
- Create `tests/unit/mcp/video-poll-storage.test.ts`

### Step 1: Teste que falha

```ts
// tests/unit/mcp/video-poll-storage.test.ts
import { describe, it, expect, vi } from 'vitest';
import { artifactKey, presignExistingArtifact } from '../../../src/output/output-storage.js';
import type { OutputStorageClient } from '../../../src/output/storage.js';

describe('artifactKey para video', () => {
  it('gera chave mp4 correta', () => {
    expect(artifactKey('20260602T120000Z-kl3j9d-kling-t2v', 'video/mp4')).toBe(
      'outputs/20260602T120000Z-kl3j9d-kling-t2v.mp4',
    );
  });
  it('gera chave webm correta', () => {
    expect(artifactKey('job-webm-01', 'video/webm')).toBe('outputs/job-webm-01.webm');
  });
});

describe('presignExistingArtifact', () => {
  it('retorna StoredArtifact quando objeto existe no MinIO', async () => {
    const storage: OutputStorageClient = {
      putObject: vi.fn(),
      presignGet: vi.fn().mockResolvedValue('https://s3.example.com/outputs/job1.mp4?sig=x'),
      headObject: vi.fn().mockResolvedValue({ size: 1024, contentType: 'video/mp4' }),
    };
    const result = await presignExistingArtifact({
      storage,
      jobId: 'job1',
      contentType: 'video/mp4',
      ttlSeconds: 3600,
    });
    expect(result).not.toBeNull();
    expect(result!.url).toContain('s3.example.com');
    expect(result!.key).toBe('outputs/job1.mp4');
  });

  it('retorna null quando objeto nao existe (job nao concluido)', async () => {
    const storage: OutputStorageClient = {
      putObject: vi.fn(),
      presignGet: vi.fn(),
      headObject: vi.fn().mockResolvedValue(null),
    };
    const result = await presignExistingArtifact({
      storage,
      jobId: 'job-pending',
      contentType: 'video/mp4',
    });
    expect(result).toBeNull();
  });
});
```

### Step 2: Rodar — deve passar (reutiliza codigo da Task 2)

```bash
cd /c/Users/MaxVision/Desktop/cursor-oficial/maxvision-utilities/media-forge
pnpm vitest run tests/unit/mcp/video-poll-storage.test.ts
```

Expected: PASS (4 tests).

### Step 3: Adicionar `storage?` nos webhook handler factories

Para cada um dos tres handlers, o executor deve ler o arquivo antes de modificar.
O padrao e identico — mostrado aqui para `kling-webhook-handler.ts` como referencia:

```ts
// src/video/providers/kling-webhook-handler.ts — adicionar storage ao opts
// (leia o arquivo antes de implementar; ajuste para o shape real)
import type { OutputStorageClient } from '../../output/storage.js';
import { storeArtifact } from '../../output/output-storage.js';

// Dentro de createKlingWebhookHandler, adicionar storage? ao opts:
export function createKlingWebhookHandler(opts: {
  dbPath: string;
  outputsDir: string;
  env: KlingEnv;
  storage?: OutputStorageClient;  // <-- novo
}): WebhookHandler {
  return async (ctx) => {
    // ... logica existente de completar o job ...
    // Quando state=completed e asset disponivel, fazer upload:
    if (isCompleted && assetBuffer && opts.storage) {
      await storeArtifact({
        storage: opts.storage,
        jobId: ctx.jobId,
        bytes: assetBuffer,
        contentType: 'video/mp4',
      }).catch((err) => {
        process.stderr.write(
          `[kling-webhook] storage upload failed for ${ctx.jobId}: ${(err as Error).message}\n`,
        );
        // Nao lancar — job ja foi marcado completed no DB; o upload e best-effort.
      });
    }
    // ... resto da logica ...
  };
}
```

Repetir o mesmo padrao para `higgsfield-webhook-handler.ts` e `bytedance-webhook-handler.ts`.

> **Instrucao ao executor:** leia cada um dos tres arquivos handler antes de implementar
> para identificar onde `isCompleted` e o buffer do asset sao resolvidos. O codigo acima
> e esquematico — os field names reais dependem do shape de cada handler.

### Step 4: Injetar `storage` em `startHttpServer`

Em `src/http/server.ts`, ao registrar os handlers no `webhookApp`, adicionar `storage`:

```ts
// Dentro de startHttpServer(), apos const storage = outputStorageFromConfig(config):
const storage = outputStorageFromConfig(config) ?? undefined;

webhookApp.webhookHandlers.set(
  'kling',
  createKlingWebhookHandler({
    dbPath,
    outputsDir: join(projectDir, 'outputs', 'kling'),
    env: process.env as never,
    storage,  // <-- injetado
  }),
);
webhookApp.webhookHandlers.set(
  'higgsfield',
  createHiggsfieldWebhookHandler({ dbPath, storage }),  // <-- injetado
);
// Bytedance/Seedance: idem quando habilitado
```

### Step 5: Modificar poll handlers para usar `presignExistingArtifact`

Definir tipo local nomeado para o resultado do poll (evita referencia circular):

```ts
// Em handlers.ts, antes de handleHiggsfieldPoll:
interface HiggsfieldPollResult {
  jobId: string;
  state: string;
  progress?: number;
  assetUrls?: ReadonlyArray<string>;
  url?: string;
  expires_at?: string;
  errorMessage?: string;
}

export async function handleHiggsfieldPoll(
  rawInput: unknown,
  opts: { storage?: import('../output/storage.js').OutputStorageClient } = {},
): Promise<HiggsfieldPollResult> {
  const input = rawInput as { jobId?: unknown };
  if (typeof input?.jobId !== 'string' || input.jobId.length === 0) {
    throw new Error('media_higgsfield_poll requires { jobId: string }');
  }
  const provider = higgsfieldProvider();
  const status = await provider.pollStatus(input.jobId);

  // F-B: quando completed e storage configurado, tentar presign do objeto ja no MinIO.
  // O upload foi feito pelo webhook handler. Se objeto nao existe ainda (webhook ainda
  // nao chegou), cair no fallback assetUrls do provider.
  let signedUrl: string | undefined;
  let expiresAt: string | undefined;
  if (status.state === 'completed' && opts.storage) {
    const { presignExistingArtifact } = await import('../output/output-storage.js');
    const artifact = await presignExistingArtifact({
      storage: opts.storage,
      jobId: input.jobId,
      contentType: 'video/mp4',
    }).catch(() => null);
    if (artifact) {
      signedUrl = artifact.url;
      expiresAt = artifact.expiresAt;
    }
  }

  return {
    jobId: status.jobId,
    state: status.state,
    ...(status.progress !== undefined ? { progress: status.progress } : {}),
    ...(status.assetUrls ? { assetUrls: status.assetUrls } : {}),
    ...(status.errorMessage ? { errorMessage: status.errorMessage } : {}),
    ...(signedUrl !== undefined ? { url: signedUrl, expires_at: expiresAt } : {}),
  };
}
```

Repetir o padrao para `handleKlingPoll` com tipo `KlingPollResult` analogamente.

Para Seedance: o artefato e entregue via webhook fal.ai (`createBytedanceWebhookHandler`).
O poll de Seedance e implicito (fal.ai nao expoe poll externo — o resultado chega so pelo webhook).
Nao ha `handleSeedancePoll`; o cliente deve aguardar o webhook e entao usar
`presignExistingArtifact` diretamente (ou via `handleKlingPoll`-equivalente se implementado).
O executor deve verificar em `bytedance-seedance.ts` se existe um `pollStatus` e documentar.

### Step 6: Ligar `storage` nos tool handlers de poll em `registerAllTools`

```ts
// Dentro de registerAllTools, para media_higgsfield_poll:
{
  const t = getTool('media_higgsfield_poll');
  reg(
    t.name,
    { title: 'Higgsfield Poll', description: t.description, inputSchema: t.inputSchema as never },
    wrap(t.name, async (input) => asResult(await handleHiggsfieldPoll(input, { storage }))),
  );
}
// Idem para media_kling_poll com handleKlingPoll(input, { storage })
```

### Step 7: Typecheck + commit

```bash
cd /c/Users/MaxVision/Desktop/cursor-oficial/maxvision-utilities/media-forge
pnpm typecheck
git add \
  src/mcp/handlers.ts \
  src/http/server.ts \
  src/video/providers/kling-webhook-handler.ts \
  src/video/providers/higgsfield-webhook-handler.ts \
  src/video/providers/bytedance-webhook-handler.ts \
  tests/unit/mcp/video-poll-storage.test.ts
git commit -m "feat(handlers): inject storage into webhook handlers; poll uses presignExistingArtifact (MinIO source of truth)"
```

---

## Task 8: Atualizar o stack Swarm

**Objetivo:** Adicionar ao `media-forge-mcp.stack.yml` as 7 variáveis MINIO_*/WEBHOOK_* que o servidor passa a consumir, sem reintroduzir env morta.

**Files:** Modify `.maxvision/deploy/media-forge-mcp.stack.yml`

### Step 1: Editar o stack

Adicionar na seção `environment` do serviço `mcp-server`, após `MEDIA_FORGE_API_KEYS`:

```yaml
      # F-B: artifact delivery via MinIO/S3 (presigned URLs)
      # Bucket dedicado: media-forge-outputs (ver provisão de infra no plano F-B).
      # Valores obtidos em: Portainer → Stack 69 → Environment → MINIO_*
      MINIO_ENDPOINT: ${MINIO_ENDPOINT}
      MINIO_REGION: ${MINIO_REGION:-us-east-1}
      MINIO_BUCKET: ${MINIO_BUCKET:-media-forge-outputs}
      MINIO_ACCESS_KEY: ${MINIO_ACCESS_KEY}
      MINIO_SECRET_KEY: ${MINIO_SECRET_KEY}
      MINIO_USE_SSL: ${MINIO_USE_SSL:-true}
      # F-B: webhook endpoint público para callbacks de provider
      # MEDIA_FORGE_WEBHOOK_SECRET: segredo HMAC compartilhado (gerar: openssl rand -hex 32)
      # Providers devem enviar callbacks para: https://media-forge.produtoramaxvision.com.br/webhooks/{provider}/{job_id}
      MEDIA_FORGE_WEBHOOK_SECRET: ${MEDIA_FORGE_WEBHOOK_SECRET}
      # MEDIA_FORGE_ARTIFACT_TTL_SECONDS: TTL das signed URLs (padrão 604800 = 7 dias)
      MEDIA_FORGE_ARTIFACT_TTL_SECONDS: ${MEDIA_FORGE_ARTIFACT_TTL_SECONDS:-604800}
```

Atualizar o comentário de cabeçalho para mencionar F-B:

```yaml
# ADICIONADO EM F-B (2026-06-02):
#   MINIO_ENDPOINT                    OBRIGATÓRIO p/ entrega via signed URL (ex: https://s3.meuagente.api.br)
#   MINIO_REGION                      padrão: us-east-1
#   MINIO_BUCKET                      padrão: media-forge-outputs (bucket dedicado, diferente de media-forge-refs)
#   MINIO_ACCESS_KEY                  access key do service account media-forge-svc (ver plano F-B provisão infra)
#   MINIO_SECRET_KEY                  secret key do service account media-forge-svc
#   MINIO_USE_SSL                     padrão: true
#   MEDIA_FORGE_WEBHOOK_SECRET        HMAC secret para callbacks de provider (openssl rand -hex 32)
#   MEDIA_FORGE_ARTIFACT_TTL_SECONDS  TTL signed URLs em segundos (padrão: 604800 = 7 dias)
#
# REMOVIDOS — ainda não há consumidor (F-C):
#   REDIS_URL, rate-limit, tenancy (entram em F-C)
```

### Step 2: Commit

```bash
cd /c/Users/MaxVision/Desktop/cursor-oficial/maxvision-utilities
git add .maxvision/deploy/media-forge-mcp.stack.yml
git commit -m "chore(deploy): add MINIO_* + WEBHOOK_* env to media-forge-mcp stack (F-B)"
```

### Step 3: Redeploy via Portainer (manual, pós-merge)

1. Acessar Portainer → Stacks → `media-forge-mcp` (id 69).
2. Adicionar as variáveis MINIO_* e MEDIA_FORGE_WEBHOOK_SECRET na aba "Environment".
3. Clicar "Update the stack" com o novo `media-forge-mcp.stack.yml`.
4. Verificar health: `curl https://media-forge.produtoramaxvision.com.br/health` → `{"ok":true}`.
5. Verificar webhook endpoint: `curl https://media-forge.produtoramaxvision.com.br/webhooks/` → `{"status":"ok","handlers":[...]}`.

---

## Task 9: Validação final F-B (suite completa + smoke)

**Files:** Nenhum novo — validação de todos os testes criados + tests existentes.

### Step 1: Suite completa

```bash
cd /c/Users/MaxVision/Desktop/cursor-oficial/maxvision-utilities/media-forge
pnpm typecheck && pnpm lint && pnpm test
```

Expected: todos os testes passam, sem regressão na suite F-A.

### Step 2: Verificar que stdio ainda está intacto

```bash
grep -n "startStdioServer" /c/Users/MaxVision/Desktop/cursor-oficial/maxvision-utilities/media-forge/src/mcp/server.ts
```

Expected: função ainda presente (self-host stdio não foi removido).

### Step 3: Verificar env contract no stack

```bash
grep -E "MINIO_|WEBHOOK_" /c/Users/MaxVision/Desktop/cursor-oficial/maxvision-utilities/.maxvision/deploy/media-forge-mcp.stack.yml
```

Expected: 7 vars `MINIO_ENDPOINT`, `MINIO_REGION`, `MINIO_BUCKET`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_USE_SSL`, `MEDIA_FORGE_WEBHOOK_SECRET` presentes.

### Step 4: Smoke local com MinIO mock

```bash
cd /c/Users/MaxVision/Desktop/cursor-oficial/maxvision-utilities/media-forge
pnpm build
MEDIA_FORGE_API_KEYS=key-aaa \
MEDIA_FORGE_HTTP_PORT=8787 \
MEDIA_FORGE_WEBHOOK_SECRET=local-secret-abc \
MINIO_ENDPOINT=http://localhost:9000 \
MINIO_BUCKET=media-forge-outputs \
MINIO_ACCESS_KEY=minioadmin \
MINIO_SECRET_KEY=minioadmin \
node dist/http/server.js &
sleep 1
curl -s http://localhost:8787/health           # → {"ok":true}
curl -s http://localhost:8787/webhooks/        # → {"status":"ok","handlers":["higgsfield","kling","bytedance"]}
kill %1
```

Expected: `/health` 200 e `/webhooks/` 200 com handlers listados.

### Step 5: Commit de encerramento da fase

```bash
cd /c/Users/MaxVision/Desktop/cursor-oficial/maxvision-utilities
git add .
git commit -m "feat(F-B): async output delivery — MinIO artifact storage + Hono webhook endpoint

- Artifacts uploaded to MinIO/S3; tool results return signed URL + expires_at
- POST /webhooks/:provider/:jobId public Hono endpoint (HMAC + Ed25519 reused)
- Graceful degradation: storage optional, falls back to local disk if unconfigured
- Stack env: 7 MINIO_*/WEBHOOK_* vars added (media-forge-mcp.stack.yml)
- replicas:1 documented (SQLite job-state limit; cross-replica deferred to F-I)"
```

**F-B exit criteria:** `pnpm test` verde; `/webhooks/` 200 quando secret configurado; job longo retorna `job_id`; poll em `state=completed` retorna `url` + `expires_at` via MinIO signed URL quando `MINIO_*` configurado; disco efêmero não é mais o destino primário de artefatos.

---

## Self-Review

### Spec coverage

| Requisito spec §3.2/§3.3/F-B | Coberto? | Task |
|---|---|---|
| Jobs longos retornam `job_id` imediatamente | Sim — padrão existente (Higgsfield, Kling, Seedance já retornam job_id) | — |
| Resultado entregue via signed URL, nao disco efemero | Sim | T1, T2, T6, T7 |
| Upload ocorre no webhook handler (nao re-baixa CDN no poll) | Sim — T7 injeta storage nos handler factories; poll usa presignExistingArtifact | T7 |
| webhook-router promovido a endpoint hospedado de primeira classe | Sim (Hono /webhooks/:provider/:jobId) | T3, T4 |
| HMAC/Ed25519 mantidos | Sim — reutilizados de webhook-router.ts e fal-ed25519.ts | T3 |
| MinIO/S3 usando `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` | Sim — mesmos pacotes já instalados (^3.700.0) | T1 |
| TTL configurável | Sim — `MEDIA_FORGE_ARTIFACT_TTL_SECONDS` (padrão 7 dias) | T2 |
| `{ job_id, url, expires_at }` no resultado | Sim | T6, T7 |
| Provisão de infra MinIO (bucket + access key) | Sim | Seção "Provisão de Infra" |
| Stack atualizado com MINIO_* + WEBHOOK_* | Sim | T8 |
| Sem env morta (Redis/tenancy = F-C) | Sim | T8 |

### Placeholder scan

- Sem `TODO`, `FIXME`, `placeholder`, `<your-value>` no codigo dos steps.
- Task 6 Step 4: "verificar shape real de `image-service.ts`" e instrucao deliberada ao executor (nao placeholder no codigo). O commit do step SO compila apos reconciliar os field names `bytes`/`jobId`/`mimeType` com o tipo real retornado pelos servicos de imagem.
- Task 7 Step 3: codigo dos webhook handlers e esquematico (shape real depende de cada arquivo). Instrucao ao executor para ler cada arquivo antes de implementar.
- Task 7 Step 5 (Seedance): instrucao deliberada ao executor verificar `bytedance-seedance.ts` para confirmar se existe `pollStatus` ou se o resultado so chega via webhook.

### Type consistency

- `OutputStorageClient` definido em `src/output/storage.ts`, importado em `src/output/output-storage.ts`, `src/http/app-internal.ts`, `src/mcp/server.ts`, `src/mcp/handlers.ts`, webhook handlers — uma unica fonte de verdade.
- `StoredArtifact { key, url, expiresAt }` retornado por `storeArtifact` e `presignExistingArtifact`.
- `BuildServerOpts.storage?: OutputStorageClient` opcional — nao quebra testes existentes sem injec ao.
- `HandlersDeps.storage?: OutputStorageClient` opcional — graceful degradation em todos os handlers.
- `WebhookHonoApp = Hono & { webhookHandlers, authOverrides }` — intersection type (compila); nao `interface extends ReturnType<...>` (nao compila).
- `HiggsfieldPollResult` e `KlingPollResult` sao interfaces nomeadas — sem referencia circular ao tipo da propria funcao.
- `WebhookHandler` importado de `webhook-router.ts` nos webhook handlers — tipo compartilhado, sem redefinicao.

### Limitações documentadas (não são gaps, são decisões)

- `replicas: 1` mantido: SQLite `video_jobs` é single-replica. Deferred para F-I (galeria Postgres).
- Rate-limit por-IP fica ineficaz atrás de Traefik (todos os requests têm mesmo `remoteAddress`). Mitigado: usa `X-Forwarded-For` quando disponível. Rate-limit cross-instância com Redis → F-C.
- Chave de artefato (`outputs/{job_id}.ext`) é determinística — poll stateless é possível; mas `headObject` numa segunda réplica ainda precisaria de acesso ao `video_jobs` SQLite para saber o `contentType`. Deferred.

---

## Decisoes em Aberto (para o usuario resolver antes da execucao)

1. **Shape do retorno de `generateImageNanoBananaPro` e `generateImageImagen4Ultra`:** O executor deve ler `src/image/image-service.ts` antes da Task 6 e confirmar os field names para `bytes` (Buffer), `jobId` e `mimeType`. O plano usa esses nomes como hipotese — ajustar se diferir. O commit da Task 6 Step 5 so compila apos essa reconciliacao.

2. **Shape dos webhook handlers (Kling, Higgsfield, Bytedance) na Task 7:** O codigo esquematico da Task 7 Step 3 usa `isCompleted` e `assetBuffer` como nomes hipoteticos. O executor deve ler cada arquivo antes de implementar para identificar onde o estado `completed` e o buffer/URL do asset sao resolvidos e em que momento o upload pode ocorrer.

3. **Ponto de upload para Seedance:** O artefato Seedance e entregue via webhook fal.ai (`createBytedanceWebhookHandler`) e nao via poll externo (fal.ai nao expoe poll para o cliente). O executor deve confirmar em `bytedance-seedance.ts` e `bytedance-webhook-handler.ts` que o handler ja tem acesso ao buffer do asset quando o callback chega, e injetar `storage` analogamente ao Kling/Higgsfield.

4. **`MEDIA_FORGE_WEBHOOK_PUBLIC_URL` no stack:** O env ja e lido por `HiggsfieldProvider` (`handlers.ts` linha ~217: `publicWebhookBaseUrl: process.env['MEDIA_FORGE_WEBHOOK_PUBLIC_URL']`). Com F-B, o valor correto e `https://media-forge.produtoramaxvision.com.br/webhooks`. **Decisao necessaria:** adicionar ao `media-forge-mcp.stack.yml` na Task 8 (recomendado, para documentar o contrato) ou configurar so no Portainer?

5. **Higgsfield webhook path no submit:** Verificar se `HiggsfieldProvider` constroi a URL de callback como `{publicWebhookBaseUrl}/higgsfield/{jobId}` (path correto para o novo endpoint Hono) ou usa outro formato. Ajustar o provider se necessario antes de testar com callbacks reais da Higgsfield.
