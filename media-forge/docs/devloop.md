# media-forge — Development Loop

This document explains the recommended development workflow for iterating on media-forge in a live Claude Code session.

---

## TL;DR

| Goal | Command | Notes |
|---|---|---|
| Cold start (plugin dev) | `pnpm dev:claude` | One-shot: build + launch Claude Code with `--plugin-dir .` |
| Watch MCP server only | `pnpm dev:mcp` | tsx watch rebuild on every `.ts` save |
| Run targeted tests | `pnpm test tests/unit/<area>/` | Fast feedback loop |
| Full validation | `pnpm typecheck && pnpm lint && pnpm test` | Pre-merge gate |
| Regenerate prompt index | `pnpm build:prompts` | After adding/modifying YAML templates |
| Validate plugin manifest | `pnpm validate:plugin` | After editing `.claude-plugin/plugin.json` |

---

## Scripts explained

### `pnpm dev:claude`

```
pnpm build && claude --plugin-dir .
```

**What it does:** Runs a full `pnpm build` (prompts index + tsup compilation → `dist/`), then launches Claude Code with the plugin directory set to the current folder. This is a **one-shot cold start** — it does not watch for changes. Use it to:

- Start a fresh Claude Code session with the current plugin state loaded.
- Verify that a newly built version of the plugin installs and initializes correctly.

**After editing source files:** The Claude Code session has already loaded `dist/`. You must rebuild and restart for code changes to take effect. Exit the session, run `pnpm build`, then `pnpm dev:claude` again.

> **Known limitation:** If you modify hook scripts in `hooks/`, agent `.md` files, or skill `SKILL.md` files, those are loaded from the filesystem at session start and may be picked up on the next tool invocation without a full restart — but this behavior is not guaranteed across all Claude Code versions. When in doubt, restart the session.

### `pnpm dev:mcp`

```
tsx watch src/mcp/server.ts
```

**What it does:** Starts the MCP server with `tsx watch`, which monitors all TypeScript source files and re-compiles + re-starts the process on any `.ts` save. This is the **hot-reload path** for the MCP server in isolation.

**Use with standalone MCP clients:** If you are testing with a non-Claude-Code MCP client (e.g., Cursor, or a custom client), configure it to connect to the tsx watch process on stdio. Your client will re-connect automatically after each restart.

**Not suitable for Claude Code plugin dev:** Claude Code launches the MCP server as a subprocess from `.mcp.json`. To get code changes into a running Claude Code session, you need the full `pnpm dev:claude` cold-start cycle.

---

## 30-Second Edit Cycle (MCP standalone mode)

For iterating on MCP tool implementations without restarting Claude Code:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Terminal 1: tsx watch (auto-restarts on .ts save)                  │
│  $ pnpm dev:mcp                                                     │
│  ✓ MCP server listening on stdio                                    │
└───────────────────────────────────┬─────────────────────────────────┘
                                    │
    ┌───────────────────────────────▼──────────────────────────────┐
    │  You edit src/mcp/handlers.ts or src/image/nano-banana-pro.ts │
    │  tsx detects change → rebuilds in memory → restarts server   │
    │  (typically < 3 seconds)                                     │
    └───────────────────────────────┬──────────────────────────────┘
                                    │
    ┌───────────────────────────────▼──────────────────────────────┐
    │  Terminal 2: your MCP client re-sends the tool call          │
    │  (or you re-trigger from Claude Code with /restart)          │
    │  → new code path executes                                    │
    └──────────────────────────────────────────────────────────────┘
```

ASCII flowchart:

```
edit .ts file
     │
     ▼
tsx watch detects change
     │
     ▼
in-memory TypeScript compile
     │
     ├── compile error → printed to stderr; server keeps running
     │
     └── compile ok → server process restarts
               │
               ▼
          new tool call executes updated code
```

---

## Plugin development cycle (Claude Code)

For plugin changes (agents, skills, hooks), the cycle is longer because Claude Code caches the plugin at session start:

```
edit agents/<name>.md  or  src/image/image-service.ts
     │
     ▼
pnpm build          ← rebuilds dist/ (tsup)
     │
     ▼
exit Claude Code session
     │
     ▼
pnpm dev:claude     ← launches fresh session with --plugin-dir .
     │
     ▼
invoke skill / tool to verify
```

**When `/restart` is enough:** If you only modified `.md` files (agents, skills) and not TypeScript source, Claude Code's `/restart` command may reload them without a full exit → rebuild → relaunch cycle. This is not guaranteed for all hook and manifest changes.

---

## Agent `.md` changes (live-ish)

Agent `.md` files and skill `SKILL.md` files are read from disk by the Claude Code runtime on each invocation (not compiled). Changes to the body text of these files may take effect on the next tool call without a rebuild. Frontmatter changes (model, effort, tools list) typically require a session restart.

---

## Prompt template changes

1. Edit or add `prompts/<domain>/<name>.yml`
2. Run `pnpm build:prompts` — regenerates `prompts/_index.json`
3. Verify: `media-forge prompts list` shows the new entry
4. No server restart required — the template loader reads the index from disk on each call

---

## Environment variable changes

Changes to `.env` or shell environment variables take effect on the next process start. For the MCP server (`pnpm dev:mcp`), kill and restart the tsx watch process. For Claude Code plugin, restart the session.

---

## Caveats and known limitations

- **`pnpm dev:claude` is one-shot, not watch-based.** The `pnpm build && claude ...` sequence runs once. For a watch loop, run `pnpm dev:mcp` in parallel for MCP-only work, and do a full cold restart for plugin changes.
- **Hook changes always require session restart.** Hook scripts in `hooks/hooks.json` are loaded at session initialization.
- **Windows Git Bash and colon-encoded paths.** If you create skill or agent directories with colons in the name on Git Bash (Windows), the path will be corrupted to U+F03A. Always use short names without colons (the plugin loader adds the `media-forge:` prefix at runtime).
- **`dist/` must exist before `pnpm dev:claude`.** If you did a `rimraf dist` manually, run `pnpm build` before launching.
