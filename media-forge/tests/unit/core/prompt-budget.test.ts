// tests/unit/core/prompt-budget.test.ts
//
// Gate for src/core/prompt-budget.ts: the per-provider prompt-length contract
// enforced at the provider boundary (before a submit ever reaches the
// network, before the cost guard and ledger row a submit triggers).
//
// Also gates skills/_shared/references/surface-prompt-profiles.md — the two
// must agree, and this file asserts that agreement directly rather than
// trusting it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertPromptWithinBudget,
  assertMultiShotWithinBudget,
  SURFACE_PROMPT_PROFILES,
} from '../../../src/core/prompt-budget.js';
import { ValidationError } from '../../../src/core/errors.js';
import { wrap } from '../../../src/mcp/handlers/plumbing.js';
import { handleKlingMotionBrush } from '../../../src/mcp/handlers/kling.js';
import { openDb, runMigrations, closeDb } from '../../../src/core/db.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const REFERENCE_MD_PATH = join(__dir, '..', '..', '..', 'skills', '_shared', 'references', 'surface-prompt-profiles.md');

function charsOf(n: number): string {
  return 'a'.repeat(n);
}

// ---------------------------------------------------------------------------
// Kling — main prompt boundary (2,500 chars per SURFACE_PROMPT_PROFILES.kling)
// ---------------------------------------------------------------------------
describe('assertPromptWithinBudget — kling prompt', () => {
  it('a 2,500-char prompt passes', () => {
    expect(() =>
      assertPromptWithinBudget({ provider: 'kling', prompt: charsOf(2500), field: 'prompt' }),
    ).not.toThrow();
  });

  it('a 2,501-char prompt throws ValidationError naming length, limit, and provider', () => {
    let caught: unknown;
    try {
      assertPromptWithinBudget({ provider: 'kling', prompt: charsOf(2501), field: 'prompt' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    const message = (caught as Error).message;
    expect(message).toContain('2501');
    expect(message).toContain('2500');
    expect(message).toContain('kling');
  });
});

// ---------------------------------------------------------------------------
// Kling — negative prompt boundary (same 2,500-char limit, separate field)
// ---------------------------------------------------------------------------
describe('assertPromptWithinBudget — kling negativePrompt', () => {
  it('a 2,500-char negative prompt passes', () => {
    expect(() =>
      assertPromptWithinBudget({
        provider: 'kling',
        prompt: charsOf(2500),
        kind: 'negativePrompt',
        field: 'negativePrompt',
      }),
    ).not.toThrow();
  });

  it('a 2,501-char negative prompt throws ValidationError naming length, limit, and provider', () => {
    let caught: unknown;
    try {
      assertPromptWithinBudget({
        provider: 'kling',
        prompt: charsOf(2501),
        kind: 'negativePrompt',
        field: 'negativePrompt',
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    const message = (caught as Error).message;
    expect(message).toContain('2501');
    expect(message).toContain('2500');
    expect(message).toContain('kling');
  });
});

// ---------------------------------------------------------------------------
// Kling — multi-shot: shot count cap (6) and per-shot char cap (512)
// ---------------------------------------------------------------------------
describe('assertMultiShotWithinBudget — kling', () => {
  it('6 shots (each within the 512-char per-shot limit) pass', () => {
    const prompts = Array.from({ length: 6 }, () => charsOf(512));
    expect(() => assertMultiShotWithinBudget({ provider: 'kling', prompts })).not.toThrow();
  });

  it('7 shots throws ValidationError naming the shot count and the provider limit', () => {
    const prompts = Array.from({ length: 7 }, () => charsOf(10));
    let caught: unknown;
    try {
      assertMultiShotWithinBudget({ provider: 'kling', prompts });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    const message = (caught as Error).message;
    expect(message).toContain('7 shots');
    expect(message).toContain('6');
    expect(message).toContain('kling');
  });

  it('a 512-char shot passes', () => {
    const prompts = [charsOf(100), charsOf(512), charsOf(100)];
    expect(() => assertMultiShotWithinBudget({ provider: 'kling', prompts })).not.toThrow();
  });

  it('a 513-char shot throws, and the error identifies WHICH shot index failed', () => {
    // Shot index 2 (1-based "shot 3") is the offender; the other two are short.
    const prompts = [charsOf(10), charsOf(10), charsOf(513)];
    let caught: unknown;
    try {
      assertMultiShotWithinBudget({ provider: 'kling', prompts });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    const message = (caught as Error).message;
    expect(message).toContain('shot 3 prompt');
    expect(message).toContain('513');
    expect(message).toContain('512');
  });
});

// ---------------------------------------------------------------------------
// Higgsfield / Google / ByteDance — no published bound, so no length is ever
// rejected. Assert this happens BECAUSE the profile says `null`, not because
// of some incidental accident (e.g. a check that silently never ran).
// ---------------------------------------------------------------------------
describe('assertPromptWithinBudget — providers with no published bound', () => {
  const unbounded: ReadonlyArray<'higgsfield' | 'google' | 'bytedance'> = [
    'higgsfield',
    'google',
    'bytedance',
  ];

  for (const provider of unbounded) {
    it(`${provider}: profile.promptMaxChars is null (the reason nothing is enforced)`, () => {
      expect(SURFACE_PROMPT_PROFILES[provider].promptMaxChars).toBeNull();
    });

    it(`${provider}: an arbitrarily long prompt (50,000 chars) passes`, () => {
      expect(() =>
        assertPromptWithinBudget({ provider, prompt: charsOf(50_000), field: 'prompt' }),
      ).not.toThrow();
    });

    it(`${provider}: an arbitrarily long negative prompt passes (profile.negativePromptMaxChars is null)`, () => {
      expect(SURFACE_PROMPT_PROFILES[provider].negativePromptMaxChars).toBeNull();
      expect(() =>
        assertPromptWithinBudget({
          provider,
          prompt: charsOf(50_000),
          kind: 'negativePrompt',
          field: 'negativePrompt',
        }),
      ).not.toThrow();
    });
  }
});

// ---------------------------------------------------------------------------
// Doc/code agreement — skills/_shared/references/surface-prompt-profiles.md
// must state the same Kling numbers as SURFACE_PROMPT_PROFILES.kling.
//
// Full-markdown-table parsing is brittle (headings, cell wrapping, prose
// asides all shift easily). Instead this narrows to the smallest reliable
// invariant: three targeted regexes anchored on the literal labels the doc
// uses ("Prompt budget", "Negative prompt", "Multi-shot"), scoped to the
// Kling section only (between the "## Kling" heading and the next "## "
// heading) so a similar-looking number elsewhere in the file (e.g. Veo's
// "no published bound" prose) cannot be matched by accident. Each regex pulls
// exactly the bolded number the doc presents as authoritative and compares it
// to the corresponding field on SURFACE_PROMPT_PROFILES.kling. This is
// deliberately narrower than validating the doc's prose/structure — it only
// gates the numbers a future edit could silently drift out of sync with the
// code, which is the actual failure mode this test exists to catch.
// ---------------------------------------------------------------------------
describe('doc/code agreement — surface-prompt-profiles.md vs SURFACE_PROMPT_PROFILES.kling', () => {
  const md = readFileSync(REFERENCE_MD_PATH, 'utf-8');
  const klingSection = md.match(/## Kling \(direct API\)[\s\S]*?(?=\n## )/);

  it('the Kling section exists in the reference file', () => {
    expect(klingSection).not.toBeNull();
  });

  const section = klingSection ? klingSection[0] : '';

  it('doc prompt budget matches SURFACE_PROMPT_PROFILES.kling.promptMaxChars', () => {
    const match = section.match(/Prompt budget \| \*\*([\d,]+) characters\*\*/);
    expect(match).not.toBeNull();
    const docValue = Number(match![1]!.replace(/,/g, ''));
    expect(docValue).toBe(SURFACE_PROMPT_PROFILES.kling.promptMaxChars);
  });

  it('doc negative-prompt budget matches SURFACE_PROMPT_PROFILES.kling.negativePromptMaxChars', () => {
    const match = section.match(/Negative prompt \| \*\*([\d,]+) characters\*\*/);
    expect(match).not.toBeNull();
    const docValue = Number(match![1]!.replace(/,/g, ''));
    expect(docValue).toBe(SURFACE_PROMPT_PROFILES.kling.negativePromptMaxChars);
  });

  it('doc multi-shot caps match SURFACE_PROMPT_PROFILES.kling.multiShotMaxShots / multiShotPromptMaxChars', () => {
    const match = section.match(/up to (\d+) storyboards\*\*, \*\*([\d,]+) characters each/);
    expect(match).not.toBeNull();
    const docMaxShots = Number(match![1]);
    const docPerShotChars = Number(match![2]!.replace(/,/g, ''));
    expect(docMaxShots).toBe(SURFACE_PROMPT_PROFILES.kling.multiShotMaxShots);
    expect(docPerShotChars).toBe(SURFACE_PROMPT_PROFILES.kling.multiShotPromptMaxChars);
  });
});

// ---------------------------------------------------------------------------
// Wiring proof: a Kling MCP tool must return { isError: true } when the
// prompt is over budget, via the exact `wrap()` mechanism register.ts uses to
// convert a handler throw into a tool response — and the provider (network)
// must never be reached.
// ---------------------------------------------------------------------------
describe('wiring — over-budget Kling prompt surfaces as isError, provider never called', () => {
  // Credentials + a real (tmp) cost-tracker DB are required here, not for their
  // own sake, but so the "provider never called" assertion is load-bearing: a
  // handler that throws before construction (e.g. missing Kling auth) would
  // also leave fetchImpl uncalled, making that half of the assertion pass for
  // the wrong reason. With valid auth, an under-budget prompt WOULD reach
  // fetchImpl — see the parity test below — so an over-budget prompt failing
  // to reach it is attributable to the budget check, not to an unrelated
  // pre-flight failure. Mirrors tests/mcp/kling-motion-brush-handler.test.ts.
  let tmpDir: string;
  let dbPath: string;
  let prevProjectDir: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-prompt-budget-'));
    dbPath = join(tmpDir, 'cost.db');
    prevProjectDir = process.env['MEDIA_FORGE_PROJECT_DIR'];
    process.env['MEDIA_FORGE_PROJECT_DIR'] = tmpDir;
    process.env['KLING_ACCESS_KEY'] = 'ak_test';
    process.env['KLING_SECRET_KEY'] = 'sk_test';
    const db = openDb(dbPath);
    runMigrations(db);
  });

  afterEach(() => {
    closeDb(dbPath);
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // EPERM on Windows — ignore
    }
    if (prevProjectDir === undefined) delete process.env['MEDIA_FORGE_PROJECT_DIR'];
    else process.env['MEDIA_FORGE_PROJECT_DIR'] = prevProjectDir;
    delete process.env['KLING_ACCESS_KEY'];
    delete process.env['KLING_SECRET_KEY'];
    vi.restoreAllMocks();
  });

  it('sanity: with valid credentials, an UNDER-budget prompt DOES reach fetchImpl', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { task_id: 'kling-under-budget' } }),
    });
    const tool = wrap('media_kling_motion_brush', (input) =>
      handleKlingMotionBrush(input, { fetchImpl: fetchImpl as unknown as typeof fetch }),
    );

    const result = await tool({
      prompt: 'a short prompt, well within budget',
      imageUrl: 'https://example/scene.png',
      regions: [{ id: 'r1', polygon: [[0, 0], [1, 0], [1, 1]], motionVector: [1, 0] }],
      durationSec: 5,
    });

    expect(result.isError).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('media_kling_motion_brush returns isError:true and never calls fetchImpl', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { task_id: 'kling-over-budget' } }),
    });
    const tool = wrap('media_kling_motion_brush', (input) =>
      handleKlingMotionBrush(input, { fetchImpl: fetchImpl as unknown as typeof fetch }),
    );

    const result = await tool({
      prompt: charsOf(2501),
      imageUrl: 'https://example/scene.png',
      regions: [{ id: 'r1', polygon: [[0, 0], [1, 0], [1, 1]], motionVector: [1, 0] }],
      durationSec: 5,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('ValidationError');
    expect(result.content[0]!.text).toContain('2501');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
