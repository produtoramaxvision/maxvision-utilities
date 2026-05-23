import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { ValidationError } from '../core/errors.js';
import { prettyZodError } from '../core/zod-formatter.js';
import { logger } from '../core/logger.js';
import { render } from './template-renderer.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const TemplateVariable = z
  .object({
    name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
    required: z.boolean().default(false),
    default: z.string().optional(),
    description: z.string().optional(),
  })
  .strict();

export const Template = z
  .object({
    // Allow digits in both domain and slug portions (e.g. video-t2v/cinematic-establishing)
    id: z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+$/),
    domain: z.enum([
      'product',
      'character',
      'cinematic',
      'ad-creative',
      'hyperrealistic',
      'enterprise',
      'video-t2v',
      'video-i2v',
      'video-extension',
      'food-product-crossover',
    ]),
    description: z.string().min(20),
    variables: z.array(TemplateVariable).default([]),
    template: z.string().min(20),
    attribution: z.string().optional(),
  })
  .strict();

export type TemplateT = z.infer<typeof Template>;

// ---------------------------------------------------------------------------
// Index types
// ---------------------------------------------------------------------------

export interface IndexEntry {
  id: string;
  domain: string;
  path: string; // relative to plugin root
  description: string;
  variables: { name: string; required: boolean; default?: string }[];
}

export interface PromptIndex {
  generatedAt: string;
  count: number;
  entries: IndexEntry[];
}

// ---------------------------------------------------------------------------
// loadTemplate
// ---------------------------------------------------------------------------

export async function loadTemplate(filePath: string): Promise<TemplateT> {
  let raw: string;
  try {
    raw = await fs.promises.readFile(filePath, 'utf-8');
  } catch (err) {
    throw new ValidationError(`Failed to read template file: ${filePath}`, {
      cause: err instanceof Error ? err.message : String(err),
    });
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new ValidationError(
      `Malformed YAML in template: ${filePath}`,
      { cause: err instanceof Error ? err.message : String(err) },
    );
  }

  const result = Template.safeParse(parsed);
  if (!result.success) {
    throw new ValidationError(
      `Template validation failed: ${filePath}\n${prettyZodError(result.error)}`,
      { path: filePath, issues: result.error.issues },
    );
  }

  return result.data;
}

// ---------------------------------------------------------------------------
// loadAllTemplates
// ---------------------------------------------------------------------------

export async function loadAllTemplates(promptsDir: string): Promise<TemplateT[]> {
  let domainDirs: string[];
  try {
    const entries = await fs.promises.readdir(promptsDir, { withFileTypes: true });
    domainDirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch {
    return [];
  }

  const templates: TemplateT[] = [];

  for (const domain of domainDirs) {
    const domainPath = path.join(promptsDir, domain);
    let files: string[];
    try {
      files = await fs.promises.readdir(domainPath);
    } catch {
      continue;
    }

    for (const file of files) {
      // Skip hidden files, _index.json and non-yaml files
      if (file.startsWith('.') || file === '_index.json') continue;
      if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;

      const filePath = path.join(domainPath, file);
      try {
        const tpl = await loadTemplate(filePath);
        templates.push(tpl);
      } catch (err) {
        logger.warn(`Skipping template ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return templates;
}

// ---------------------------------------------------------------------------
// buildIndex
// ---------------------------------------------------------------------------

export async function buildIndex(promptsDir: string): Promise<PromptIndex> {
  const templates = await loadAllTemplates(promptsDir);

  // Sort by id
  templates.sort((a, b) => a.id.localeCompare(b.id));

  const entries: IndexEntry[] = templates.map((tpl) => {
    const [domain, slug] = tpl.id.split('/') as [string, string];
    const fileName = `${slug}.yml`;
    return {
      id: tpl.id,
      domain: domain,
      path: `prompts/${domain}/${fileName}`,
      description: tpl.description.trim(),
      variables: tpl.variables.map((v) => ({
        name: v.name,
        required: v.required,
        ...(v.default !== undefined ? { default: v.default } : {}),
      })),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    count: entries.length,
    entries,
  };
}

// ---------------------------------------------------------------------------
// writeIndex — atomic temp+rename
// ---------------------------------------------------------------------------

export async function writeIndex(promptsDir: string): Promise<PromptIndex> {
  const index = await buildIndex(promptsDir);
  const outFile = path.join(promptsDir, '_index.json');
  // Place the temp file alongside the destination so the rename stays within
  // the same volume. On Windows CI runners os.tmpdir() lives on C: but the
  // workspace clone is on D:, which breaks rename with EXDEV.
  const tmpFile = path.join(
    promptsDir,
    `.${path.basename(outFile)}.tmp.${process.pid}.${Date.now()}`,
  );

  await fs.promises.writeFile(tmpFile, JSON.stringify(index, null, 2), 'utf-8');
  await fs.promises.rename(tmpFile, outFile);

  logger.info(`writeIndex: wrote ${index.count} entries to ${outFile}`);
  return index;
}

// ---------------------------------------------------------------------------
// searchTemplates — fulltext ranked search
// ---------------------------------------------------------------------------

export function searchTemplates(index: PromptIndex, query: string): IndexEntry[] {
  if (!query.trim()) return [...index.entries];

  const q = query.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);

  type Scored = { entry: IndexEntry; score: number };

  const scored: Scored[] = index.entries
    .map((entry) => {
      const idLower = entry.id.toLowerCase();
      const descLower = entry.description.toLowerCase();

      let score = 0;

      // Substring match: id weight=3, description weight=1
      if (idLower.includes(q)) score += 3;
      if (descLower.includes(q)) score += 1;

      // Token-level matches
      for (const token of tokens) {
        if (idLower.includes(token)) score += 2;
        if (descLower.includes(token)) score += 1;
      }

      return { entry, score };
    })
    .filter((s) => s.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.entry);
}

// ---------------------------------------------------------------------------
// tryTemplate
// ---------------------------------------------------------------------------

export async function tryTemplate(opts: {
  promptsDir: string;
  id: string;
  vars: Record<string, string>;
  dryRun?: boolean;
}): Promise<{ rendered: string; templateId: string; missingRequired: string[] }> {
  const { promptsDir, id, vars, dryRun = false } = opts;

  const [domain, slug] = id.split('/');
  if (!domain || !slug) {
    throw new ValidationError(`Invalid template id: ${id}`);
  }

  // Try .yml first, then .yaml
  const candidates = [
    path.join(promptsDir, domain, `${slug}.yml`),
    path.join(promptsDir, domain, `${slug}.yaml`),
  ];

  let tpl: TemplateT | null = null;
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      tpl = await loadTemplate(candidate);
      break;
    }
  }

  if (!tpl) {
    throw new ValidationError(`Template not found: ${id}`, { id, promptsDir });
  }

  if (dryRun) {
    // In dryRun mode: attempt render but capture missingRequired without throwing
    const missingRequired: string[] = [];
    for (const varDef of tpl.variables) {
      if (varDef.required && !(varDef.name in vars) && varDef.default === undefined) {
        missingRequired.push(varDef.name);
      }
    }

    // Build vars with defaults filled in (skip required that are missing)
    const effectiveVars: Record<string, string> = {};
    for (const varDef of tpl.variables) {
      const val = vars[varDef.name];
      if (val !== undefined) {
        effectiveVars[varDef.name] = val;
      } else if (varDef.default !== undefined) {
        effectiveVars[varDef.name] = varDef.default;
      }
      // Missing required: leave out so renderer gets empty (we already tracked them)
    }

    // Render without throwing: override required=false so the renderer won't throw
    // on variables we already tracked in missingRequired above.
    const relaxedDefs = tpl.variables.map((v) => ({ ...v, required: false }));
    const renderResult = render({
      template: tpl.template,
      vars: effectiveVars,
      variableDefs: relaxedDefs,
      strict: false,
    });

    return {
      rendered: renderResult.rendered,
      templateId: tpl.id,
      missingRequired,
    };
  }

  // Normal mode: render will throw on missing required
  const renderResult = render({
    template: tpl.template,
    vars,
    variableDefs: tpl.variables,
    strict: false,
  });

  return {
    rendered: renderResult.rendered,
    templateId: tpl.id,
    missingRequired: renderResult.missingRequired,
  };
}
