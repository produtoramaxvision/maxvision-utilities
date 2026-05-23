# Contributing to media-forge

Three common extension paths are described below. The general workflow is at the end.

---

## Adding a new agent

Agents live in `agents/<name>.md`. The plugin loader builds the fully-qualified name `media-forge:<name>` at runtime — do not include the `media-forge:` prefix in the filename or in the frontmatter `name:` field (this caused the Windows Git Bash U+F03A path corruption that was fixed in P10).

### Steps

1. **Create `agents/<name>.md`** with valid frontmatter:

   ```yaml
   ---
   name: <name>              # short name only — no "media-forge:" prefix
   description: "<≤200 chars summary for routing by the orchestrator>"
   tools: Read, Write, Bash, Grep, Glob
   model: sonnet             # use opus only for read-heavy review agents (cost discipline)
   effort: medium            # low | medium | high | xhigh
   color: '#4A90D9'          # any hex color for the panel UI
   maxTurns: 12              # safety cap; reduce for narrower agents
   skills:
     - media-forge:capability-matrix   # always include for model reference
   memory: project
   ---
   ```

2. **Write the agent body.** The body should describe: role, workflow steps (numbered), which MCP tools to call, how to read `refined_spec.json`, and what to write to the job directory.

3. **Update `docs/specification.md §5`** — add a row to the Agent Registry table.

4. **Update `README.md` feature matrix** — if the agent exposes a new capability, add it to the feature matrix table.

5. **No source code required.** Agents are pure markdown. The plugin loader handles registration.

### Validation

Run the standard gate:

```bash
pnpm typecheck && pnpm lint
```

For agent-only changes (no source code touched) this is sufficient — agent
files are loaded by Claude Code at runtime and their frontmatter is parsed
by the plugin loader, not by a build step. If your edit affects any
TypeScript, also run `pnpm test` against the relevant unit files.

A dedicated `validate:agents` helper and a `scaffold:agent` generator are
roadmapped for v0.2.0; until then, copy an existing `agents/*.md` as a
template when adding a new agent.

---

## Adding a new prompt template

Templates live in `prompts/<domain>/<name>.yml`. The `_index.json` is auto-generated.

### Steps

1. **Drop a YAML file** in `prompts/<domain>/`:

   ```yaml
   id: <domain>/<template-name>
   version: v1
   description: <one-line description>
   domain: <domain>            # must match the directory name
   recommended_model: gemini-3-pro-image-preview
   recommended_aspect: "1:1"
   recommended_size: "4K"
   variables:
     - name: product_name
       required: true
     - name: lighting_setup
       default: "three-point softbox key+fill+hair"
   template: |
     Professional photography of ${product_name}.
     ${lighting_setup}.
   expected_text_in_output: false
   attribution: |
     Original pattern from <source>. All values configurable.
   ```

2. **Run `pnpm build:prompts`** to regenerate `prompts/_index.json`. The loader (`src/prompts/template-loader.ts`) walks all `*.yml` files in `prompts/` and rebuilds the index.

   ```bash
   pnpm build:prompts
   ```

3. **Verify the index** — check that `_index.json` contains your new entry and that `count` increased by 1.

4. **Update `docs/usage.md`** — add the template to the relevant recipe section if it introduces a new use case.

### Accepted domains (v0.1.0)

`product`, `character`, `cinematic`, `ad-creative`, `hyperrealistic`, `enterprise`, `food-product-crossover`, `video-t2v`, `video-i2v`, `video-extension`

New domains (targeting v0.2.0): `illustration`, `cartoon`, `3d-render`, `social-content`, `motion-graphics`, `comic-panel`, `infographic`, `architectural`, `food-photography`, `fashion`

### Template renderer

The renderer (`src/prompts/template-renderer.ts`) supports `${var}` interpolation. In strict mode, it throws if a required variable is missing. Test your template with:

```bash
media-forge prompts show <domain>/<name>
```

---

## Adding a new MCP tool

Tools are defined in three files: `src/mcp/schemas.ts` (schema), `src/mcp/handlers.ts` (handler), and tested in `tests/unit/mcp/`.

### Steps

1. **Define the Zod schema in `src/mcp/schemas.ts`:**

   ```typescript
   // Use individual schema, NOT a union, for ZodEffects compat (DEBT-005 / DEBT-008)
   export const MyNewToolInput = z.object({
     param1: z.string().min(1),
     param2: z.number().int().optional(),
   });
   // For cross-field validation — use superRefine AFTER defining a base:
   const _MyNewToolBase = z.object({ param1: z.string(), param2: z.number().optional() });
   export const MyNewToolInput = _MyNewToolBase.superRefine((data, ctx) => {
     // cross-field rules here
   });
   ```

   > **DEBT-008 note:** If you use `.superRefine()`, the MCP SDK will emit `inputSchema: {}` for this tool in `tools/list`. To avoid this, register `_MyNewToolBase` (the plain ZodObject) as `inputSchema` in the tool registration, and re-validate inside the handler with the full `MyNewToolInput`. This gives clients accurate field hints while preserving runtime cross-field validation.

   Add the tool to the `MCP_TOOLS` array:

   ```typescript
   export const MCP_TOOLS = [
     // ... existing tools ...
     {
       name: 'media_my_new_tool',
       description: 'One-line description for tools/list.',
       inputSchema: MyNewToolInput,  // or _MyNewToolBase if using workaround
     },
   ];
   ```

2. **Wire the handler in `src/mcp/handlers.ts`:**

   ```typescript
   {
     const t = getTool('media_my_new_tool');
     reg(
       t.name,
       { title: 'My New Tool', description: t.description, inputSchema: t.inputSchema as never },
       wrap(t.name, async (input) => {
         const inp = MyNewToolInput.parse(input);  // full schema for runtime validation
         // ... implementation ...
         return asResult({ result: 'done' });
       }),
     );
   }
   ```

   The `wrap()` function catches all exceptions and returns `{isError: true}`. Do not throw from handlers.

3. **Add a unit test in `tests/unit/mcp/`:**

   ```typescript
   import { MyNewToolInput } from '../../../src/mcp/schemas.js';

   test('MyNewToolInput validates correctly', () => {
     expect(MyNewToolInput.safeParse({ param1: 'hello' }).success).toBe(true);
     expect(MyNewToolInput.safeParse({}).success).toBe(false);
   });
   ```

4. **Run targeted tests:**

   ```bash
   pnpm test tests/unit/mcp/
   ```

5. **Update `docs/specification.md §3`** — add the tool to the MCP Tool Registry table.

6. **Update `docs/usage.md`** — add a minimal invocation example.

---

## Development workflow

### Branch convention

Always work from `homolog`, never from `main` (per CLAUDE.md project rules):

```bash
git checkout homolog
git checkout -b feat/my-change
```

Push to `origin feat/my-change` and open a PR targeting `homolog`.

### Validation gate (required before merge)

```bash
pnpm typecheck && pnpm lint && pnpm test
```

All three must pass with zero errors and zero warnings.

### Commit convention

Conventional Commits format:

```
feat(agents): add architectural-viz agent for interior rendering
fix(video): handle missing videoUri gracefully in extend handler
docs(usage): add architectural recipe to cookbook
chore(deps): update @google/genai to 2.7.0
```

### Hot-reload dev loop

See `docs/devloop.md` for the recommended 30-second edit → rebuild → test cycle.

### Test strategy

- **Per commit:** run only the tests relevant to your change area (e.g., `pnpm test tests/unit/mcp/` for tool changes).
- **Before opening a PR:** run `pnpm test` (full unit suite).
- **Full phase gate:** `pnpm test && pnpm test:coverage && pnpm build`.
- **Live API tests** are gated behind `MEDIA_FORGE_RUN_LIVE_TESTS=true` — do not run these in CI unless the project key allows it.

### No Co-Authored-By in commits

Per project style, do not add `Co-Authored-By` trailers to doc or chore commits.
