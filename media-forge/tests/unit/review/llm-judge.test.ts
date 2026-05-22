import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type Anthropic from '@anthropic-ai/sdk';
import { judgeAsset } from '../../../src/review/llm-judge.js';
import { ValidationError } from '../../../src/core/errors.js';
import { TINY_PNG_BASE64 } from '../../helpers/fixtures.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): { dir: string; imgPath: string; videoPath: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-test-'));
  const imgPath = path.join(dir, 'asset.png');
  const videoPath = path.join(dir, 'asset.mp4');
  fs.writeFileSync(imgPath, Buffer.from(TINY_PNG_BASE64, 'base64'));
  fs.writeFileSync(videoPath, Buffer.from('fakemp4data'));
  return {
    dir,
    imgPath,
    videoPath,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

const VALID_VERDICT_JSON = JSON.stringify({
  verdict: 'pass',
  scores: {
    adherence: 9,
    quality: 8,
    alignment: 9,
    safety: 10,
    overall: 9,
  },
  rootCauseStage: 'none',
  errors: [],
});

const FAIL_VERDICT_JSON = JSON.stringify({
  verdict: 'fail',
  scores: {
    adherence: 5,
    quality: 5,
    alignment: 5,
    safety: 10,
    overall: 6,
  },
  rootCauseStage: 'prompt-engineer',
  errors: [
    {
      class: 'semantic_object_wrong',
      severity: 'major',
      detail: 'Wrong object in scene',
    },
  ],
});

function makeAnthropicClient(responseText: string): Anthropic {
  return {
    messages: {
      create: vi.fn(async () => ({
        content: [{ type: 'text', text: responseText }],
      })),
    },
  } as unknown as Anthropic;
}

const SAMPLE_INPUT = {
  refinedSpec: { domain: 'product-photographer', prompt: 'A leather bag' },
  assetPath: '',
  traceExcerpt: 'stage: image-generate\nduration: 14000ms',
  jobId: 'test-job-001',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('judgeAsset', () => {
  let tmp: ReturnType<typeof makeTmpDir>;

  beforeEach(() => {
    tmp = makeTmpDir();
  });

  afterEach(() => {
    tmp.cleanup();
    vi.restoreAllMocks();
    delete process.env['CLAUDE_CODE_SESSION_ID'];
    delete process.env['MEDIA_FORGE_REVIEW_THRESHOLD'];
  });

  // 1. CLAUDE_CODE_SESSION_ID set → returns directive
  it('returns JudgeDirective when CLAUDE_CODE_SESSION_ID is set', async () => {
    process.env['CLAUDE_CODE_SESSION_ID'] = 'test-session-123';
    const result = await judgeAsset({ ...SAMPLE_INPUT, assetPath: tmp.imgPath });
    expect(result).toMatchObject({
      mode: 'subagent',
      agentName: 'media-forge:quality-reviewer',
    });
    if ('mode' in result) {
      expect(result.payload.jobId).toBe('test-job-001');
    }
  });

  // 2. forceMode='sdk' bypasses env detection
  it('uses SDK mode when forceMode=sdk regardless of CLAUDE_CODE_SESSION_ID', async () => {
    process.env['CLAUDE_CODE_SESSION_ID'] = 'test-session-123';
    const client = makeAnthropicClient(VALID_VERDICT_JSON);
    const result = await judgeAsset(
      { ...SAMPLE_INPUT, assetPath: tmp.imgPath },
      { forceMode: 'sdk', _anthropicClient: client },
    );
    // Should be a verdict, not a directive
    expect('verdict' in result).toBe(true);
  });

  // 3. SDK path happy: mocked response returns valid JSON → parsed verdict
  it('parses valid JSON response from mocked Anthropic client', async () => {
    const client = makeAnthropicClient(VALID_VERDICT_JSON);
    const result = await judgeAsset(
      { ...SAMPLE_INPUT, assetPath: tmp.imgPath },
      { forceMode: 'sdk', _anthropicClient: client },
    );
    expect('verdict' in result).toBe(true);
    if ('verdict' in result) {
      expect(result.verdict).toBe('pass');
      expect(result.scores.overall).toBe(9);
      expect(result.errors).toHaveLength(0);
    }
  });

  // 4. SDK path: malformed JSON → throws ValidationError
  it('throws ValidationError when model returns non-JSON response', async () => {
    const client = makeAnthropicClient('No JSON here at all');
    await expect(
      judgeAsset(
        { ...SAMPLE_INPUT, assetPath: tmp.imgPath },
        { forceMode: 'sdk', _anthropicClient: client },
      ),
    ).rejects.toThrow(ValidationError);
  });

  // 5. SDK path: overall=8 + threshold=7.5 → verdict='pass'
  it('keeps verdict=pass when overall >= threshold', async () => {
    const client = makeAnthropicClient(VALID_VERDICT_JSON); // overall=9
    const result = await judgeAsset(
      { ...SAMPLE_INPUT, assetPath: tmp.imgPath },
      { forceMode: 'sdk', _anthropicClient: client, threshold: 7.5 },
    );
    if ('verdict' in result) {
      expect(result.verdict).toBe('pass');
    }
  });

  // 6. SDK path: overall=6 + threshold=7.5 → verdict='fail'
  it('downgrades verdict to fail when overall < threshold', async () => {
    const partialJson = JSON.stringify({
      verdict: 'partial',
      scores: { adherence: 6, quality: 6, alignment: 6, safety: 8, overall: 6 },
      rootCauseStage: 'prompt-engineer',
      errors: [],
    });
    const client = makeAnthropicClient(partialJson);
    const result = await judgeAsset(
      { ...SAMPLE_INPUT, assetPath: tmp.imgPath },
      { forceMode: 'sdk', _anthropicClient: client, threshold: 7.5 },
    );
    if ('verdict' in result) {
      expect(result.verdict).toBe('fail');
    }
  });

  // 7. SDK path: extracts JSON even when wrapped in prose / code fences
  it('extracts JSON from response wrapped in prose and code fences', async () => {
    const wrapped = `Here is my evaluation:\n\`\`\`json\n${VALID_VERDICT_JSON}\n\`\`\`\nEnd of evaluation.`;
    const client = makeAnthropicClient(wrapped);
    const result = await judgeAsset(
      { ...SAMPLE_INPUT, assetPath: tmp.imgPath },
      { forceMode: 'sdk', _anthropicClient: client },
    );
    expect('verdict' in result).toBe(true);
    if ('verdict' in result) {
      expect(result.verdict).toBe('pass');
    }
  });

  // 8. Threshold override via env MEDIA_FORGE_REVIEW_THRESHOLD
  it('respects MEDIA_FORGE_REVIEW_THRESHOLD env var', async () => {
    process.env['MEDIA_FORGE_REVIEW_THRESHOLD'] = '9.5'; // Very high threshold
    const client = makeAnthropicClient(VALID_VERDICT_JSON); // overall=9 < 9.5 → fail
    const result = await judgeAsset(
      { ...SAMPLE_INPUT, assetPath: tmp.imgPath },
      { forceMode: 'sdk', _anthropicClient: client },
    );
    if ('verdict' in result) {
      expect(result.verdict).toBe('fail');
    }
  });

  // 9. Image asset → vision attachment included in messages
  it('includes image block in Anthropic call for image asset', async () => {
    const client = makeAnthropicClient(VALID_VERDICT_JSON);
    await judgeAsset(
      { ...SAMPLE_INPUT, assetPath: tmp.imgPath },
      { forceMode: 'sdk', _anthropicClient: client },
    );
    const createFn = (client.messages.create as ReturnType<typeof vi.fn>);
    expect(createFn).toHaveBeenCalledOnce();
    const callArgs = createFn.mock.calls[0]?.[0] as { messages: Array<{ content: unknown[] }> };
    const userContent = callArgs.messages[0]?.content ?? [];
    const hasImageBlock = Array.isArray(userContent) &&
      userContent.some((b: unknown) => {
        return typeof b === 'object' && b !== null && 'type' in b && (b as { type: string }).type === 'image';
      });
    expect(hasImageBlock).toBe(true);
  });

  // 10. Video asset (mp4) → no vision attachment (just text)
  it('does not include image block for video asset', async () => {
    const client = makeAnthropicClient(VALID_VERDICT_JSON);
    await judgeAsset(
      { ...SAMPLE_INPUT, assetPath: tmp.videoPath },
      { forceMode: 'sdk', _anthropicClient: client },
    );
    const createFn = (client.messages.create as ReturnType<typeof vi.fn>);
    const callArgs = createFn.mock.calls[0]?.[0] as { messages: Array<{ content: unknown[] }> };
    const userContent = callArgs.messages[0]?.content ?? [];
    const hasImageBlock = Array.isArray(userContent) &&
      userContent.some((b: unknown) => {
        return typeof b === 'object' && b !== null && 'type' in b && (b as { type: string }).type === 'image';
      });
    expect(hasImageBlock).toBe(false);
  });

  // 11. Invalid verdict shape → throws ValidationError
  it('throws ValidationError when JSON has wrong verdict shape', async () => {
    const badJson = JSON.stringify({
      verdict: 'pass',
      scores: { adherence: 9 }, // missing required fields
      rootCauseStage: 'none',
      errors: [],
    });
    const client = makeAnthropicClient(badJson);
    await expect(
      judgeAsset(
        { ...SAMPLE_INPUT, assetPath: tmp.imgPath },
        { forceMode: 'sdk', _anthropicClient: client },
      ),
    ).rejects.toThrow(ValidationError);
  });

  // 12. FAIL verdict already set → not changed even if above threshold
  it('keeps verdict=fail unchanged when already set by model', async () => {
    const client = makeAnthropicClient(FAIL_VERDICT_JSON); // overall=6, verdict=fail
    const result = await judgeAsset(
      { ...SAMPLE_INPUT, assetPath: tmp.imgPath },
      { forceMode: 'sdk', _anthropicClient: client, threshold: 7.5 },
    );
    if ('verdict' in result) {
      expect(result.verdict).toBe('fail');
      expect(result.errors).toHaveLength(1);
    }
  });
});
