// Ports the intent of upstream's scripts/validate_skills.py (structural
// checks) and scripts/behavior_contract_check.py (cross-reference existence)
// to Vitest. Upstream is czlonkowski-style vendoring of Emily2040/seedance-2.0
// (MIT, see NOTICE) and its scripts were written for upstream's own file
// layout and single-repo versioning scheme -- most of validate_skills.py does
// not apply here and is deliberately NOT ported (see "Dropped rules" below).
// What *is* ported, generalized to media-forge's 40 shipped skills (13
// first-party + 27 absorbed `mf-*`, see skills/ and NOTICE):
//
//   1. Every skill directory ships a parseable SKILL.md with frontmatter.
//   2. `name` and `description` are present, non-empty.
//   3. `name` matches its directory (bare, or `media-forge:`-prefixed --
//      both forms are shipped; see the two frontmatter conventions below).
//   4. No two skills declare the same `name`.
//   5. `name` <= 64 chars, `description` <= 1024 chars -- Anthropic's actual
//      Agent Skills platform limits (see
//      ~/.claude/plugins/marketplaces/anthropic-agent-skills/skills/
//      skill-creator/scripts/quick_validate.py:69,83), NOT a bound
//      `validate_skills.py` itself enforces (it has no description-length
//      check at all). A description over 1024 chars is a real platform
//      defect, not a style nit.
//   6. `[skill:...]` and `[ref:...]` cross-references resolve to something
//      that exists on disk. This is upstream's `REQUIRED_REFERENCES` /
//      `REQUIRED_FILES` existence-checking idea from validate_skills.py,
//      generalized from upstream's hardcoded file list to media-forge's
//      actual cross-reference syntax -- and it is the highest-value check
//      this file adds: T9 hand-rewrote ~90 files of cross-references during
//      rebranding and nothing previously proved they all still resolve.
//
// Dropped rules (upstream convention we do not share, not a defect):
// - `license`, `tags`, `metadata` (incl. `metadata.version`,
//   `metadata.parent`) as required frontmatter fields. Upstream pins every
//   skill to one synchronized `metadata.version` across the whole repo
//   (EXPECTED_VERSION = "6.6.0" in validate_skills.py) -- a single-version
//   monorepo-of-clones scheme media-forge explicitly reversed for its own
//   skills/packages (see memory: "single-version policy REVERSED 2026-06-20:
//   now proper semver patch bumps"). None of our 40 skills carry `license`,
//   `tags`, or `metadata` at all; requiring them would mean inventing a
//   convention we never adopted, not catching a defect.
// - `description` must start with "This skill should be used when" (upstream
//   third-person activation wording). Not one of our 40 descriptions uses
//   this boilerplate; both first-party and mf-* skills write natural,
//   varied descriptions. Enforcing this would fail all 40 skills for a
//   phrasing preference, not a structural problem.
// - Required top-level `## Intent` section per sub-skill. Present in all 27
//   `mf-*` skills (inherited from upstream), absent from all 13 first-party
//   skills, which use their own sections (`## Workflow`, `## When to use`,
//   `## Outputs`, etc). Enforcing `## Intent` would force mass-editing the
//   13 first-party skills to match a convention they never adopted --
//   exactly what this task says not to do.
// - `behavior_contract_check.py`'s REQUIRED_SNIPPETS / DOMAIN_FILES: entirely
//   hardcoded to upstream's own file paths (`skills/seedance-sequence/
//   SKILL.md`, a root `SKILL.md`, `references/prompt-compiler.md` at repo
//   root) and upstream's own exact prose. None of those paths exist in
//   media-forge (no root SKILL.md; references live under
//   skills/_shared/references/). Grep confirms the *equivalent* phrases
//   (e.g. "Do not hide this uncertainty", the accepted-state-overrides-
//   planned-state rule) did survive the T9 rebrand into mf-sequence,
//   mf-continuation, and skills/_shared/references/prompt-compiler.md in
//   reworded form -- so a phrase-pinning test could be built from verified
//   evidence, but it isn't part of this file's enumerated scope. Left out
//   deliberately rather than silently ported or silently skipped.
// - upstream's REQUIRED_FILES / REQUIRED_FILES + REQUIRED_REFERENCES lists,
//   EXPECTED_SKILLS name list, __pycache__/*.pyc checks, evals.json case
//   count, agents/openai.yaml exact-string checks: all upstream-repo-layout
//   specific (Python cache files, a `seedance-*` naming scheme, an
//   openai.yaml this package does not ship the same way). None apply.
//
// Reported, not fixed (see task report): `higgsfield-prompting/SKILL.md` has
// no tools field at all, unlike its structural sibling `kling-prompting`
// (`allowed-tools: [Read, Grep]`). A "tools field required" rule would force
// a fix here and would be the one rule that changes behavior rather than
// just catching a defect, so `name` + `description` stay the only required
// fields -- the asymmetry is real but is a judgment call for a human, not
// this test.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dir = dirname(fileURLToPath(import.meta.url));
const skillsDir = join(__dir, '..', '..', 'skills');
const referencesDir = join(skillsDir, '_shared', 'references');

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

const ANTHROPIC_NAME_MAX = 64;
const ANTHROPIC_DESCRIPTION_MAX = 1024;

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

const skillDirNames = readdirSync(skillsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== '_shared')
  .map((d) => d.name)
  .sort();

interface ParsedSkill {
  dirName: string;
  relPath: string;
  raw: string;
  frontmatter: Record<string, unknown> | undefined;
  frontmatterError: string | undefined;
}

function splitFrontmatter(text: string): { frontmatter: string; body: string } | undefined {
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines[0]?.trim() !== '---') return undefined;
  const endIndex = lines.slice(1).findIndex((line) => line.trim() === '---');
  if (endIndex === -1) return undefined;
  return {
    frontmatter: lines.slice(1, endIndex + 1).join('\n'),
    body: lines.slice(endIndex + 2).join('\n'),
  };
}

const skills: ParsedSkill[] = skillDirNames.map((dirName) => {
  const skillPath = join(skillsDir, dirName, 'SKILL.md');
  const relPath = relative(skillsDir, skillPath).replace(/\\/g, '/');
  if (!existsSync(skillPath)) {
    return { dirName, relPath, raw: '', frontmatter: undefined, frontmatterError: 'missing SKILL.md' };
  }
  const raw = readFileSync(skillPath, 'utf-8');
  const split = splitFrontmatter(raw);
  if (!split) {
    return { dirName, relPath, raw, frontmatter: undefined, frontmatterError: 'no --- delimited frontmatter block' };
  }
  try {
    const frontmatter = parseYaml(split.frontmatter) as Record<string, unknown>;
    return { dirName, relPath, raw, frontmatter, frontmatterError: undefined };
  } catch (err) {
    return { dirName, relPath, raw, frontmatter: undefined, frontmatterError: `YAML parse error: ${(err as Error).message}` };
  }
});

// ---------------------------------------------------------------------------
// Cross-reference extraction ([skill:x] and [ref:y]), scanned across every
// markdown file under skills/ -- not just SKILL.md -- because references in
// skills/_shared/references/*.md cross-link to each other and to skills too.
// ---------------------------------------------------------------------------

const allMarkdownFiles = findMarkdownFiles(skillsDir);

const SKILL_REF_RE = /\[skill:([a-zA-Z0-9_.:-]+)\]/g;
const REF_REF_RE = /\[ref:([a-zA-Z0-9_./:-]+)\]/g;

interface CrossRef {
  file: string;
  kind: 'skill' | 'ref';
  target: string;
}

const crossRefs: CrossRef[] = [];
for (const absPath of allMarkdownFiles) {
  const relPath = relative(skillsDir, absPath).replace(/\\/g, '/');
  const text = readFileSync(absPath, 'utf-8');
  for (const m of text.matchAll(SKILL_REF_RE)) {
    const target = m[1];
    if (target === undefined) continue; // capture group always present when the outer match fires
    crossRefs.push({ file: relPath, kind: 'skill', target });
  }
  for (const m of text.matchAll(REF_REF_RE)) {
    const target = m[1];
    if (target === undefined) continue;
    crossRefs.push({ file: relPath, kind: 'ref', target });
  }
}

function resolveCrossRef(ref: CrossRef): boolean {
  if (ref.kind === 'skill') {
    const target = ref.target.replace(/^media-forge:/, '');
    return existsSync(join(skillsDir, target, 'SKILL.md'));
  }
  return existsSync(join(referencesDir, `${ref.target}.md`));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('skills -- discovery (vacuity floors)', () => {
  it('discovers at least the 40 shipped skill directories (13 first-party + 27 mf-*)', () => {
    expect(skillDirNames.length).toBeGreaterThanOrEqual(40);
  });

  it('walks at least 100 markdown files under skills/', () => {
    expect(allMarkdownFiles.length).toBeGreaterThanOrEqual(100);
  });

  it('extracts at least 14 distinct [skill:...] targets across 51+ occurrences', () => {
    const distinct = new Set(crossRefs.filter((r) => r.kind === 'skill').map((r) => r.target));
    expect(distinct.size).toBeGreaterThanOrEqual(14);
    expect(crossRefs.filter((r) => r.kind === 'skill').length).toBeGreaterThanOrEqual(51);
  });

  it('extracts at least 40 distinct [ref:...] targets across 102+ occurrences', () => {
    const distinct = new Set(crossRefs.filter((r) => r.kind === 'ref').map((r) => r.target));
    expect(distinct.size).toBeGreaterThanOrEqual(40);
    expect(crossRefs.filter((r) => r.kind === 'ref').length).toBeGreaterThanOrEqual(102);
  });
});

describe('skills -- frontmatter structure', () => {
  it('every skill has SKILL.md with a parseable --- delimited frontmatter block', () => {
    const violations = skills
      .filter((s) => s.frontmatterError)
      .map((s) => `${s.relPath}: ${s.frontmatterError}`);
    expect(violations).toEqual([]);
  });

  it('every skill declares non-empty `name` and `description`', () => {
    const violations: string[] = [];
    for (const skill of skills) {
      if (!skill.frontmatter) continue;
      const name = skill.frontmatter.name;
      const description = skill.frontmatter.description;
      if (typeof name !== 'string' || name.trim() === '') {
        violations.push(`${skill.relPath}: missing or empty \`name\``);
      }
      if (typeof description !== 'string' || description.trim() === '') {
        violations.push(`${skill.relPath}: missing or empty \`description\``);
      }
    }
    expect(violations).toEqual([]);
  });

  it('`name` matches its directory, bare or media-forge:-prefixed', () => {
    const violations: string[] = [];
    for (const skill of skills) {
      if (!skill.frontmatter) continue;
      const name = skill.frontmatter.name;
      if (typeof name !== 'string') continue;
      const ok = name === skill.dirName || name === `media-forge:${skill.dirName}`;
      if (!ok) {
        violations.push(`${skill.relPath}: name \`${name}\` does not match directory \`${skill.dirName}\``);
      }
    }
    expect(violations).toEqual([]);
  });

  it('no two skills declare the same `name`', () => {
    const seen = new Map<string, string>();
    const violations: string[] = [];
    for (const skill of skills) {
      const name = skill.frontmatter?.name;
      if (typeof name !== 'string') continue;
      const existing = seen.get(name);
      if (existing) {
        violations.push(`${skill.relPath} duplicates name \`${name}\` already used by ${existing}`);
      } else {
        seen.set(name, skill.relPath);
      }
    }
    expect(violations).toEqual([]);
  });

  it(`\`name\` stays within Anthropic's ${ANTHROPIC_NAME_MAX}-char platform limit`, () => {
    const violations: string[] = [];
    for (const skill of skills) {
      const name = skill.frontmatter?.name;
      if (typeof name === 'string' && name.length > ANTHROPIC_NAME_MAX) {
        violations.push(`${skill.relPath}: name is ${name.length} chars (max ${ANTHROPIC_NAME_MAX})`);
      }
    }
    expect(violations).toEqual([]);
  });

  it(`\`description\` stays within Anthropic's ${ANTHROPIC_DESCRIPTION_MAX}-char platform limit`, () => {
    const violations: string[] = [];
    for (const skill of skills) {
      const description = skill.frontmatter?.description;
      if (typeof description === 'string' && description.length > ANTHROPIC_DESCRIPTION_MAX) {
        violations.push(
          `${skill.relPath}: description is ${description.length} chars (max ${ANTHROPIC_DESCRIPTION_MAX})`,
        );
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('skills -- cross-reference resolution ([skill:...] / [ref:...])', () => {
  it('every [skill:...] and [ref:...] reference resolves to something on disk', () => {
    const violations = crossRefs
      .filter((ref) => !resolveCrossRef(ref))
      .map((ref) => `${ref.file}: [${ref.kind}:${ref.target}] does not resolve`);
    expect(violations).toEqual([]);
  });
});
