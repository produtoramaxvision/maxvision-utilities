// Ports the intent of upstream's scripts/prompt_lint.py (czlonkowski-style
// absorption from Emily2040/seedance-2.0, MIT, see NOTICE) to Vitest.
//
// One rule ported, two dropped -- this file is short on purpose; padding it
// with rules that would misfire on real content is worse than a thin file.
//
// Ported: BLOCKED_MARKERS. Upstream fails a build if a shipped markdown file
// contains the literal (case-sensitive) strings "TODO" or "PLACEHOLDER" --
// draft artifacts that should never reach a shipped file. Upstream scopes
// this to `examples/**/*.md`; media-forge has no `examples/` directory (its
// examples live inline inside SKILL.md, see mf-examples-ja/ko/zh), so this
// scopes the same check to every markdown file under skills/, which is
// where media-forge's equivalent prompt-authoring content actually lives.
// Verified case-sensitive (not case-insensitive) before porting: kling-
// prompting/SKILL.md legitimately uses the lowercase word "placeholder"
// three times, as a real, deliberate annotation that its Kling pricing rates
// are unverified (see plan T4: "verificar todas as rates Kling, não só as 2
// PLACEHOLDER"). A case-insensitive version of this rule would misfire on
// that legitimate content; upstream's own exact-case choice already avoids
// this, which is presumably why upstream spells the markers as concatenated
// string literals ("TO" "DO", "PLACE" "HOLDER") -- so its own source file
// doesn't trip its own check. This file does the same for the same reason.
//
// Dropped (upstream convention we do not share, not a defect):
// - REQUIRED_GOLDEN_SECTIONS ("## Source Brief", "## Internal Prompt
//   Specification", "## Compiled Natural-Language Prompt", "## Lint
//   Result", "## Control-Critical Sentences") and the "examples/golden-
//   prompts/*.md must have all five" rule. media-forge has no `examples/`
//   directory and no golden-prompt-per-file convention at all -- our worked
//   examples live as backtick-quoted bullet items inside SKILL.md (see
//   mf-examples-ja/SKILL.md's "## Safe Example Patterns" section), not as
//   standalone documents with these five fixed headings. Enforcing this
//   would mean inventing a directory layout and section scheme media-forge
//   never adopted, not catching a real gap.
// - The JSON-vs-natural-language "compiled prompt must not be JSON" check
//   (upstream's `JSON_START` regex against the golden-prompt section body).
//   Structurally this depends on the golden-prompt section anchor above,
//   which we don't have. Adapting it to "any backtick-quoted example prompt
//   in a skill" was tried and rejected: it produces real false positives
//   against legitimate JSON-shape return-value documentation elsewhere in
//   the corpus -- e.g. `skills/brand-check/SKILL.md:19` (``Return structured
//   result: `{ "pass": boolean, "violations": [] }`.``) and
//   `skills/ocr-validate/SKILL.md:19` (the equivalent OCR result shape).
//   Both are legitimate internal-skill API documentation, not video prompts,
//   and both would trip a bare "backtick span starting with `{`" rule.
//   There is no reliable structural anchor in media-forge's corpus that
//   scopes "this backtick span is meant to be a natural-language video
//   prompt" without inventing a new, unvalidated convention -- so this rule
//   is left out rather than weakened or overfit to specific directories.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const skillsDir = join(__dir, '..', '..', 'skills');

function findMarkdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findMarkdownFiles(full));
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
      out.push(full);
    }
  }
  return out;
}

const markdownFiles = findMarkdownFiles(skillsDir);

// Spelled as concatenation, same reason upstream does it: so this checker's
// own source text does not trip its own rule.
const BLOCKED_MARKERS = ['TO' + 'DO', 'PLACE' + 'HOLDER'];

describe('skills markdown -- prompt/draft-quality lint', () => {
  it('walks at least 100 markdown files under skills/', () => {
    // Vacuity floor: a typo in the walk would make the check below pass
    // over zero files.
    expect(markdownFiles.length).toBeGreaterThanOrEqual(100);
  });

  it('contains no case-sensitive TODO or PLACEHOLDER draft markers', () => {
    const violations: string[] = [];
    for (const absPath of markdownFiles) {
      const relPath = relative(skillsDir, absPath).replace(/\\/g, '/');
      const text = readFileSync(absPath, 'utf-8');
      for (const marker of BLOCKED_MARKERS) {
        if (text.includes(marker)) {
          violations.push(`${relPath}: contains blocked draft marker "${marker}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
