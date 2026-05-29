# media-forge — Troubleshooting

This document covers known failure modes with their root causes and resolution steps.

---

## Failure Mode Reference

### Environment and configuration errors

| Symptom | Root cause | Resolution |
|---|---|---|
| `ConfigError: Missing API key. Set GOOGLE_API_KEY or GEMINI_API_KEY...` | `GOOGLE_API_KEY` and `GEMINI_API_KEY` are both absent, and `GOOGLE_GENAI_USE_VERTEXAI` is not set | Set `GOOGLE_API_KEY=AIza...` in your shell or in `.mcp.json` env block. See README §Required API Keys. |
| `ConfigError: Vertex AI mode requires GOOGLE_CLOUD_PROJECT.` | `GOOGLE_GENAI_USE_VERTEXAI=true` but `GOOGLE_CLOUD_PROJECT` is missing | Set `GOOGLE_CLOUD_PROJECT=my-project` alongside the Vertex AI flag. |
| `media-forge doctor` reports key invalid | The API key exists but is revoked, has wrong project scopes, or is a Vertex SA key used with the Gemini API endpoint | Regenerate at [AI Studio](https://aistudio.google.com/app/apikey). Verify the key works: `curl -H "x-goog-api-key: $GOOGLE_API_KEY" https://generativelanguage.googleapis.com/v1/models` |
| MCP server not appearing in client | `.mcp.json` not found or malformed JSON | Run `media-forge doctor` to verify. Check `cat .mcp.json` for JSON syntax errors. |
| Plugin not appearing after `claude plugin install ./media-forge` | Plugin manifest invalid or `plugin.json` missing | Run `pnpm validate:plugin` (calls `claude plugin validate . --strict`). Check `.claude-plugin/plugin.json` exists. |

---

### API errors

| Symptom | Root cause | Resolution |
|---|---|---|
| `ApiError: 403 Forbidden` | API key lacks the Generative Language API scope | Enable "Generative Language API" in your GCP project. |
| `ApiError: 429 Too Many Requests` | Rate limit exceeded | The SDK auto-retries with exponential backoff. If persistent, add `MEDIA_FORGE_POLL_INTERVAL_MS=15000` to slow polling. For image generation, space out calls or reduce batch size. |
| `ApiError: 400 Bad Request — invalid parameter` | A parameter value is not in the allowed set | Run with `--dry-run --json` to inspect the assembled payload. Compare against `media-forge models` output. |

---

### Safety block

| Symptom | Root cause | Resolution |
|---|---|---|
| `SafetyBlockError: Generation blocked — finishReason: SAFETY` | The prompt triggered Google's safety filters | See suggested rephrasing strategies below. |

**Suggested rephrasing strategies for safety blocks:**

1. Remove subjective intensity words ("extreme", "violent", "explicit") and replace with neutral descriptors.
2. Add context to ambiguous prompts: "product photography" or "fashion editorial" frames intent clearly.
3. Avoid real people's names; use descriptive character attributes instead ("a tall woman with short blonde hair").
4. For body-adjacent content, add `person_generation: ALLOW_ADULT` and frame as professional context.
5. If the prompt contains a brand name, check that it doesn't conflict with Google's advertising policies.

The `prompt-engineer` agent applies these strategies automatically when the quality-reviewer routes `error_class: "safety_blocked"` back to it.

---

### Video lifecycle errors

| Symptom | Root cause | Resolution |
|---|---|---|
| `PollingError: Polling timed out after 15 minutes` | Veo 3.1 generation exceeded the 15-minute polling cap | The operation may still be running on Google's servers. Re-poll manually: `media-forge video poll <operation-name> --timeout-ms 1800000`. If done, proceed to download. |
| `media_download_video` returns `ok: false, note: "...requires a resolved video URI"` | Caller passed an operation name instead of a video URI | Call `media_poll_video_operation` first. Extract the `uri` from `response.generateVideoResponse.generatedSamples[0].video.uri`, then pass that to `media_download_video`. |
| Video downloaded as 0 bytes or HTTP 404 | 2-day TTL expired on Google's servers | The video can no longer be retrieved. Re-generate. The plugin downloads immediately on operation completion to prevent this — only occurs if the download step was skipped or failed silently. |
| Extension hop produces 720p output | Google API constraint | Extension hops always output at 720p regardless of original resolution. This is expected and documented in `docs/specification.md §2.3`. |

---

### OCR and brand check failures

| Symptom | Root cause | Resolution |
|---|---|---|
| `skipped: true` in OCR result | `GOOGLE_APPLICATION_CREDENTIALS` not set and Cloud Vision is the configured backend | Set `GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json` or switch to PaddleOCR stub (`MEDIA_FORGE_OCR=paddleocr-wasm`) — but note the stub throws `MediaForgeError('paddleocr-wasm backend not implemented yet — DEBT-007')`. Full offline OCR deferred to v0.2.0. |
| Brand check fails with high ΔE | Image dominant color exceeds brand tolerance (default ΔE2000 ≤ 5) | Tighten the prompt with explicit hex codes: `"primary color #0055A4 blue"`. The `enterprise-corrector` agent adds hex anchoring to the re-generation prompt automatically. |

---

### MCP `tools/list` empty `{}` inputSchema (DEBT-008 — RESOLVED in v0.1.0)

Previously, `ZodEffects`/`.superRefine()` tools emitted an empty `{}` inputSchema in `tools/list`, so clients showed no parameter hints. **Fixed:** the plain `_Base` ZodObject is registered for JSON Schema emission while the full `validationSchema` is re-parsed at the handler boundary — clients get accurate field hints and cross-field validation stays enforced. Upstream issue: `modelcontextprotocol/typescript-sdk#2145`. If you still see empty schemas, rebuild (`pnpm build`) and restart the MCP client.

---

### Subagent dispatch errors

| Symptom | Root cause | Resolution |
|---|---|---|
| `Agent tool not available in this context` | The `media-forge:create` skill was invoked outside Claude Code (e.g., from CLI or standalone MCP server) | Skills that dispatch subagents require a Claude Code session. Use the MCP tools directly from CLI or standalone server. |
| Quality reviewer always returns `pass` without checking | `ANTHROPIC_API_KEY` not set in standalone mode | Set `ANTHROPIC_API_KEY` for the LLM judge's direct SDK path. Without it, the judge falls back to `pass with warning` in non-strict mode. Set `MEDIA_FORGE_REVIEW_THRESHOLD=0` to skip review entirely (dev/test only). |
| Only 2-3 agents show in `/agents` panel | Plugin manifest caching | Run `/restart` in Claude Code after plugin install or after modifying `agents/`. |

---

### Windows and cross-platform issues

| Symptom | Root cause | Resolution |
|---|---|---|
| Agent or skill not found: `media-forge:create:SKILL.md` (U+F03A colon) | Git Bash on Windows encodes `:` in directory names as U+F03A (private use area) | This was fixed in P10 by removing colons from all skill and agent directory names. If you see this error, ensure you have the latest build with the `media-forge:` prefix removed from `skills/` directories. |
| `Error: Cannot find module './foo'` (missing `.js` extension) | TypeScript NodeNext resolution requires explicit `.js` extensions | This is a build issue, not a usage issue. If you are contributing, ensure all internal imports in `src/` end with `.js`. Run `pnpm typecheck` to verify. |
| Path traversal or ENOENT on Windows paths | Backslash vs forward-slash path mixing | The `safeJoin` utility in `src/utils/paths.ts` normalizes paths. If you are passing paths from Windows Explorer (with backslashes), convert them first: `path.replace(/\\/g, '/')`. |

---

### Plugin installation and loading

| Symptom | Root cause | Resolution |
|---|---|---|
| Plugin loads but all 14 agents show as "unavailable" | `dist/` not built — agents depend on the MCP server binary | Run `pnpm build` before installing. The `dist/mcp/server.js` must exist. |
| `tools/list` returns 0 tools | MCP server started but `registerAllTools` failed silently | Check stderr output (`MEDIA_FORGE_LOG_LEVEL=debug media-forge mcp:start`). Most common cause is missing `GOOGLE_API_KEY` — the server will start but config initialization throws inside the first handler call. |
| Skills appear in autocomplete but don't run | Claude Code session doesn't have `GOOGLE_API_KEY` in its environment | Add the key to `.mcp.json` env block: `"env": {"GOOGLE_API_KEY": "${GOOGLE_API_KEY}"}` — Claude Code interpolates `${VAR}` at session start. |
| Hook events not firing | Hooks require the plugin to be installed at the project level, not just `--plugin-dir` | For production use, install with `claude plugin install ./media-forge`. The `--plugin-dir` flag is for development only and may not trigger all hooks. |
