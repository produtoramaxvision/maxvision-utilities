// A blank environment variable must read as absent, not as an empty value.
//
// `.mcp.json` forwards every variable as `"NAME": "${NAME}"`. The Claude Code
// docs specify `${VAR}` and `${VAR:-default}` expansion but do not say what an
// unset `${VAR}` without a default produces — the key may be dropped, or it may
// arrive as the empty string. `process.env['X'] ?? fallback` only rejects
// `undefined`, so under the second behaviour the fallback never runs.
//
// This was introduced by the fix that started forwarding these variables at all:
// before that change they could not arrive blank because they could not arrive.

import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { envOrUndefined } from '../../src/core/env.js';

const NAME = 'MEDIA_FORGE_TEST_BLANK_PROBE';

afterEach(() => {
  delete process.env[NAME];
});

describe('envOrUndefined', () => {
  it('returns undefined when the variable is unset', () => {
    expect(envOrUndefined(NAME)).toBeUndefined();
  });

  it('returns undefined when the variable is empty', () => {
    process.env[NAME] = '';
    expect(envOrUndefined(NAME)).toBeUndefined();
  });

  it('returns undefined when the variable is whitespace only', () => {
    process.env[NAME] = '   ';
    expect(envOrUndefined(NAME)).toBeUndefined();
  });

  it('returns the trimmed value when set', () => {
    process.env[NAME] = '  /var/outputs  ';
    expect(envOrUndefined(NAME)).toBe('/var/outputs');
  });

  it('makes ?? reach the fallback where the raw read would not', () => {
    process.env[NAME] = '';
    const fallback = join('project', 'outputs');

    // The idiom this replaces. mkdirSync('') throws ENOENT.
    expect(process.env[NAME] ?? fallback).toBe('');

    expect(envOrUndefined(NAME) ?? fallback).toBe(fallback);
  });

  it('makes Number() reach the numeric default where the raw read would not', () => {
    process.env[NAME] = '';

    // Number('') is 0 — a category limit of zero returns nothing, silently.
    expect(Number(process.env[NAME] ?? '10000')).toBe(0);

    expect(Number(envOrUndefined(NAME) ?? '10000')).toBe(10000);
  });
});
