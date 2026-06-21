---
description: "First-time onboarding: API keys, output dir, webhook secret, smoke test"
argument-hint: ""
allowed-tools: Read, Write, Bash, Grep, Glob
---

# /media-forge:setup

Onboarding wizard. Run this once after installing media-forge to configure your API key, output directory, webhook router secret (optional for P13, required for P14+), and verify the installation.

## Instructions

1. Invoke the `media-forge:setup` skill with no arguments.
2. Guide the user through each configuration step interactively.
3. Webhook router setup (provider abstraction P13+):
   - Ask the user whether they plan to use non-Veo providers (Higgsfield, Kling, Seedance — P14+). If yes, walk them through generating a webhook secret and setting `MEDIA_FORGE_WEBHOOK_SECRET` + (optionally) `MEDIA_FORGE_WEBHOOK_PORT`.
   - Default port: `7733` (bind 127.0.0.1 only). Override with `MEDIA_FORGE_WEBHOOK_PORT`.
   - Generate a 32-byte hex secret with one of:
     - `openssl rand -hex 32`
     - `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`
   - **Graceful degradation**: if `MEDIA_FORGE_WEBHOOK_SECRET` is unset, the router stays disabled and the `media_video_webhook_status` MCP tool reports `running: false`. P13 (Veo only) works fine without it — Veo polls GCS for completion. P14+ providers will fall back to polling when callbacks are unavailable.
4. Higgsfield credentials + plan selection (required for P14 onward):

   Ask the user (in order):

   1. **API credentials**:
      > "Paste your Higgsfield API key and secret from https://cloud.higgsfield.ai/api-keys. They unlock the Higgsfield provider (Soul / Soul ID / DoP / Cinema Studio / Speak / Marketing Studio / Recast / Virality Predictor)."

      Write `HF_API_KEY` and `HF_API_SECRET` to the project `.env`. NEVER echo the secret value in confirmation — show only the last 4 chars (e.g. `****ab12`).

   2. **Plan + usdPerCredit**:
      > "Which Higgsfield plan are you on?"
      > - **Plus** — $39/month, 1000 credits → 0.039 USD/credit
      > - **Ultra** — $79/month, 2500 credits → 0.0316 USD/credit
      > - **Business** — $399/month, 15000 credits → 0.0266 USD/credit
      > - **Custom / enterprise** — paste your effective USD/credit rate manually

      Write the chosen value to `MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT` in the project `.env`.

   3. **Webhook public URL** (optional):
      > "If you want Higgsfield to push completion events instead of media-forge polling, paste your public-facing URL (the one media-forge's webhook router is reachable from)."

      Write to `MEDIA_FORGE_WEBHOOK_PUBLIC_URL`. When unset, generate() omits `?hf_webhook=...` and the director falls back to polling `status_url`.

   4. **Confirm `MEDIA_FORGE_WEBHOOK_SECRET`** was generated in P13 setup; if not, prompt user to run `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and paste.

   ### Local-dev webhook URL via tunnel (optional, for P14.1 forward)

   P14 ships polling-only (D-2) — webhook URL is unused. When P14.1 lights up the webhook receiver, you'll need a publicly reachable URL pointing at your local MCP server. Two zero-config options:

   **ngrok** (recommended for casual dev):

   ```bash
   # 1. install once
   pnpm dlx ngrok config add-authtoken <token-from-dashboard.ngrok.com>

   # 2. start the tunnel (in a separate terminal — leave running)
   pnpm dlx ngrok http 3001     # match your MCP server's webhook port

   # 3. copy the https URL ngrok prints (e.g. https://abc-123.ngrok-free.app)
   # 4. write to .env
   echo 'MEDIA_FORGE_WEBHOOK_PUBLIC_URL=https://abc-123.ngrok-free.app' >> .env
   ```

   **cloudflared** (more stable for long-running dev sessions):

   ```bash
   # 1. install cloudflared (macOS: brew install cloudflared / Windows: scoop install cloudflared)
   # 2. start a quick tunnel (no account needed)
   cloudflared tunnel --url http://localhost:3001

   # 3. copy the trycloudflare.com URL printed in stdout
   # 4. write to .env
   echo 'MEDIA_FORGE_WEBHOOK_PUBLIC_URL=https://<random>.trycloudflare.com' >> .env
   ```

   Notes:
   - The path the platform calls is `${MEDIA_FORGE_WEBHOOK_PUBLIC_URL}/webhooks/higgsfield/${jobId}` — your MCP server must mount the webhook router at `/webhooks/higgsfield/:jobId` to receive callbacks.
   - Both tunnel URLs rotate when you restart — re-export to `.env` each session.
   - For production, use your real public hostname (not a tunnel).
   - P14 leaves `MEDIA_FORGE_HF_WEBHOOK_ENABLE` UNSET (polling-only). Do not set it to `true` until P14.1 lands.

   **Default provider (P14)**:
   - Ask the user which provider they want as their default.
   - Set `MEDIA_FORGE_DEFAULT_PROVIDER` in their environment or `.env`.
   - If the user does not specify a value, default to `google` silently. Do not error on omission.
   - With P14 shipped you can now answer `higgsfield` to default new requests to Higgsfield. Each MCP tool still accepts an explicit `preferProvider` override.
4. After configuration, display the doctor check results.
5. On success, suggest the first generation command as an example.
6. On failure, display the specific error and a troubleshooting tip.

## Step N+2: Kling credentials (P15+)

Ask the user:

> "Do you have a Kling account? If yes, paste your Access Key and Secret Key from
> https://klingai.com -> Console -> API Keys. These unlock the Kling provider
> (multi-shot Omni, 4K Master, motion brush, elements, lip-sync). Leave blank to
> skip; Kling MCP tools will throw KlingAuthConfigError until set."

Write to project `.env`:
- `KLING_ACCESS_KEY=<access-key>`
- `KLING_SECRET_KEY=<secret-key>`

Optional:
- `KLING_WATERMARK_DEFAULT=false` (paid keys default — recommended `false`)
- `KLING_JWT_CACHE_TTL_SEC=1500` (default 25min — adjust between 60 and 1800)
- `MEDIA_FORGE_WEBHOOK_PUBLIC_URL=<https://your.public.url>` (required for
  webhook callbacks; without it, KlingProvider falls back to polling)

NEVER echo the secret value back. Show only the last 4 chars in confirmation
output (e.g. `****ab12`) per project security policy.

## Step N+3: Seedance 2.0 credentials (P16+)

Seedance 2.0 is ByteDance's video model. media-forge accesses it via two paths:

**Primary (recommended):** `@fal-ai/client` — USD billing, no China-region KYC, simplest auth.

Ask the user:

> "Do you have a fal.ai API key? Generate one at https://fal.ai/dashboard/keys. Paste it now to enable Seedance 2.0 (Fast and Standard tiers). Leave blank to skip — Seedance generation will throw `FalAuthConfigError` until set."

Write `FAL_KEY` to project `.env`. Display only last 4 chars on confirm (`****<last4>`). NEVER echo the full key.

**Fallback (optional):** Direct BytePlus ModelArk REST — activates automatically when fal.ai returns 5xx errors.

Ask the user:

> "Do you also want to configure the BytePlus ModelArk fallback? Generate a key at https://console.byteplus.com/auth/api-key. Leave blank to skip — generation will fail over to an error when fal.ai is unavailable and this fallback is unset."

Write `BYTEPLUS_ARK_API_KEY` to project `.env` (same masking rules).

**Feature flag (optional, defaults to enabled):**

`MEDIA_FORGE_SEEDANCE_ENABLED=true` — set to `false` for emergency removal without code changes. Pre-shipped by P16 Task 8.5; the flag is already declared in `.mcp.json` and `.env.example`.

**IP risk advisory (informational — no runtime gate):**

> Seedance 2.0 carries high IP risk (Disney/Paramount C&Ds, MPA criticism). The operator assumes full responsibility for compliance with applicable IP law in their jurisdiction. See README "Legal Note on Seedance 2.0" for full context.

Display this notice during setup. Do NOT make it gating.

## Note: Higgsfield official MCP connector (optional, user-side)

Higgsfield publishes an official OAuth-based MCP connector at `https://mcp.higgsfield.ai/mcp`. This is a **separate product** from the media-forge plugin server and its Higgsfield provider integration:

- The official connector is user-installed and authenticates via Higgsfield's own OAuth flow (no `HF_API_KEY` / `HF_API_SECRET` env vars needed on your side).
- The media-forge plugin uses the Higgsfield platform REST API directly with `HF_API_KEY` + `HF_API_SECRET` (two-header auth, as documented in step 4 above).
- Both can coexist — they operate independently. The official MCP connector is not required for media-forge to call Higgsfield; it is simply another way to access Higgsfield capabilities from an MCP client.
- To explore the official connector, visit `https://mcp.higgsfield.ai/mcp` and follow the OAuth pairing instructions provided there.

## Self-host licenciado (C1 — agencias)

A imagem `ghcr.io/produtoramaxvision/media-forge-mcp` roda na sua infra. O uso
self-host comercial e regido pelo **EULA** em
[`LICENSE-COMMERCIAL/EULA.md`](../LICENSE-COMMERCIAL/EULA.md) (uso interno;
nao-revenda como servico).

Para ativar o gating de licenca, defina no ambiente do container:

- `LICENSE_CHECK_ENABLED=true`
- `MAXVISION_LICENSE_SERVER_URL=https://<seu-worker>/validate`
- `MEDIA_FORGE_LICENSE_KEY=<chave emitida pela MaxVision>`
- `MEDIA_FORGE_LICENSE_INSTANCE_ID=<id estavel da instancia>` (opcional; default = hostname)

No boot e a cada `MEDIA_FORGE_LICENSE_REVALIDATE_MS` (default 1h) o servidor valida
a chave. Licenca revogada/expirada as tools retornam **403**; `/health` segue 200.
Ha um periodo de graca offline (`MEDIA_FORGE_LICENSE_GRACE_MS`, default 72h) se o
servidor de licenca ficar temporariamente inacessivel.

No modo **hosted** (assinatura/creditos, B), `LICENSE_CHECK_ENABLED` fica `false`
e este gating nao se aplica.
