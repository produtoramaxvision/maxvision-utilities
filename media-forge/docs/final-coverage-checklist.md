# media-forge — P15 Final Coverage Checklist

This checklist must be completed in full during P15 (Production Validation) before tagging v0.1.0. Each item requires manual verification by the controller session. Check off each box as it passes.

---

## P15.2 Manual Verification (16 boxes)

- [ ] Plugin loads in Claude Code via `claude plugin install ./media-forge` (or `--plugin-dir .`)
- [ ] All 10 agents are discoverable via the `/agents` panel
- [ ] MCP server boots and `tools/list` returns 22 tools
- [ ] `/media-forge` zero-argument help renders the command index
- [ ] All slash commands appear in autocomplete (10 commands: create, campaign, character, cinematic, extend, audit, cost, models, setup, + zero-arg)
- [ ] `media-forge doctor` returns `ok` with valid environment keys
- [ ] `media-forge image generate --dry-run --json` returns valid JSON payload for Nano Banana Pro
- [ ] `media-forge video t2v --dry-run --json` returns valid JSON payload for Veo 3.1 Pro
- [ ] Each of the 10 agent `.md` files has valid frontmatter (name, description, tools, model, effort)
- [ ] `.mcp.json` env interpolation works: `${GOOGLE_API_KEY}` is resolved correctly at session start
- [ ] Hook events fire: `SubagentStart` injects trace header; `SessionEnd` runs cleanup
- [ ] `prompts/_index.json` has exactly 30 entries (3 per domain × 10 domains)
- [ ] Reviewer calibration eval passes at ≥80% accuracy (requires `ANTHROPIC_API_KEY` set): `pnpm test:evals`
- [ ] Live API smoke test succeeds at approximately $0.33 cost (requires `MEDIA_FORGE_RUN_LIVE_TESTS=true`): `pnpm test:integration:live`
- [ ] Cross-platform: same flow passes on Ubuntu CI matrix (GitHub Actions)
- [ ] Zero unresolved high-severity DEBTs (see debt review section below)

---

## Debt Review Before v0.1.0

Before marking the checklist complete, each open DEBT must have an explicit accept or mitigate decision recorded here.

- [ ] **DEBT-002** (Cosmetic) — `ApiFieldError` re-exported from `capabilities.ts`. Accept (no functional impact).
- [ ] **DEBT-003** (Medium) — Openclaw global-install pollution. Defer as out-of-band environment cleanup (not media-forge-specific). Record as "deferred — dedicated cleanup session".
- [ ] **DEBT-004** (None) — `eslint.config.js` `ignores` for generated dirs. Accept (standard practice).
- [ ] **DEBT-005** (Low) — `ImageInput`/`VideoInput` discriminated unions skip `superRefine`. Accept — MCP layer uses individual schemas (verified). Document in specification.md.
- [ ] **DEBT-006** (Low) — Imagen 4 Ultra `imageSize` silently dropped by SDK. Accept pending SDK update. `logger.warn` is in place.
- [ ] **DEBT-007** (Low) — `paddleocr-wasm` backend stubbed. Defer to v0.2.0. Cloud Vision default is production-ready.
- [ ] **DEBT-008** (**Medium — requires explicit decision**) — MCP `tools/list` returns empty `{}` inputSchema for ~10 of 22 tools (ZodEffects/superRefine constraint). Runtime validation is correct; client UI introspection is degraded. Options:
  - **Mitigate (recommended):** Apply Option A from `docs/troubleshooting.md` — register `_Base` ZodObject for introspection, full schema in handler. Improves UX for non-Claude-Code MCP clients.
  - **Accept for v0.1.0:** If mitigation is deferred, explicitly document in CHANGELOG as a known limitation. Full fix target: v0.2.0.

---

## Full Validation Gate (P15.1)

Run before checking off any manual boxes:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:coverage && pnpm build
```

Expected:
- `pnpm typecheck`: 0 errors
- `pnpm lint`: 0 warnings
- `pnpm test`: 760 unit tests passing
- `pnpm test:coverage`: ≥95% line coverage, ≥88% branch coverage
- `pnpm build`: produces `dist/index.js`, `dist/mcp/server.js`, `dist/cli/cli.js`

---

## Sign-off

When all 16 manual boxes and all 7 DEBT review boxes are checked:

1. Record the sign-off date and session.
2. Proceed to P14 (marketplace integration).
3. P15.3: push branch + create PR + auto-merge after CI green.
4. Tag: `git tag v0.1.0 -m "v0.1.0 production release"`.
