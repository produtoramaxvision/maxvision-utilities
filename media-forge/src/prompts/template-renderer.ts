import { ValidationError } from '../core/errors.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RenderOpts {
  template: string;
  vars: Record<string, string>;
  variableDefs?: { name: string; required: boolean; default?: string }[];
  /** strict=true rejects extra keys in `vars` not present in variableDefs */
  strict?: boolean;
}

export interface RenderResult {
  rendered: string;
  usedVars: string[];
  missingRequired: string[];
}

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------

const VAR_RE = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

export function render(opts: RenderOpts): RenderResult {
  const { template, vars, variableDefs = [], strict = false } = opts;

  // Build lookup maps from variableDefs
  const defMap = new Map<string, { required: boolean; default?: string }>();
  for (const def of variableDefs) {
    defMap.set(def.name, { required: def.required, default: def.default });
  }

  // strict mode: reject extra vars keys not in variableDefs
  if (strict && variableDefs.length > 0) {
    for (const key of Object.keys(vars)) {
      if (!defMap.has(key)) {
        throw new ValidationError(`unknown var: ${key}`, { var: key });
      }
    }
  }

  const usedVars: string[] = [];
  const missingRequired: string[] = [];

  const rendered = template.replace(VAR_RE, (_match, varName: string) => {
    const supplied = vars[varName];

    if (supplied !== undefined) {
      // Value explicitly provided
      if (!usedVars.includes(varName)) usedVars.push(varName);
      return supplied;
    }

    const def = defMap.get(varName);

    if (def !== undefined) {
      // Variable is declared in variableDefs
      if (def.default !== undefined) {
        // Has a default — use it
        if (!usedVars.includes(varName)) usedVars.push(varName);
        return def.default;
      }
      if (def.required) {
        // Required, no value, no default — collect as missing
        if (!missingRequired.includes(varName)) missingRequired.push(varName);
        return ''; // placeholder — will throw after scan
      }
      // Non-required, no value, no default → empty string
      if (!usedVars.includes(varName)) usedVars.push(varName);
      return '';
    }

    // Variable not in variableDefs at all → preserve literal ${varName}
    return `\${${varName}}`;
  });

  if (missingRequired.length > 0) {
    throw new ValidationError(
      `missing required vars: ${missingRequired.join(', ')}`,
      { path: missingRequired },
    );
  }

  return { rendered, usedVars, missingRequired };
}
