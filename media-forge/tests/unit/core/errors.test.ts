import { describe, it, expect } from 'vitest';
import {
  MediaForgeError,
  ConfigError,
  ValidationError,
  CapabilityError,
  ApiError,
  ApiFieldError,
  PollingError,
  OutputError,
  FileSystemError,
  SafetyBlockError,
} from '../../../src/core/errors.js';

describe('MediaForgeError', () => {
  it('carries code, message, context', () => {
    const e = new MediaForgeError('boom', 'GENERIC', { foo: 1 });
    expect(e.code).toBe('GENERIC');
    expect(e.message).toBe('boom');
    expect(e.context).toEqual({ foo: 1 });
    expect(e.name).toBe('MediaForgeError');
    expect(e instanceof Error).toBe(true);
  });
});

describe('error subclasses', () => {
  it('ConfigError has code CONFIG and preserves instanceof', () => {
    const e = new ConfigError('missing api key');
    expect(e.code).toBe('CONFIG');
    expect(e instanceof ConfigError).toBe(true);
    expect(e instanceof MediaForgeError).toBe(true);
    expect(e.name).toBe('ConfigError');
  });

  it('ValidationError has code VALIDATION', () => {
    expect(new ValidationError('bad input').code).toBe('VALIDATION');
  });

  it('CapabilityError has code CAPABILITY', () => {
    expect(new CapabilityError('illegal combo').code).toBe('CAPABILITY');
  });

  it('ApiError defaults to code API but accepts override (RATE_LIMIT, AUTH)', () => {
    expect(new ApiError('500').code).toBe('API');
    expect(new ApiError('429', 'RATE_LIMIT').code).toBe('RATE_LIMIT');
    expect(new ApiError('401', 'AUTH').code).toBe('AUTH');
  });

  it('ApiError carries context', () => {
    const e = new ApiError('429', 'RATE_LIMIT', { status: 429 });
    expect(e.context).toEqual({ status: 429 });
  });

  it('PollingError has code POLLING', () => {
    expect(new PollingError('timeout').code).toBe('POLLING');
  });

  it('OutputError has code OUTPUT', () => {
    expect(new OutputError('disk full').code).toBe('OUTPUT');
  });

  it('FileSystemError has code FILESYSTEM', () => {
    expect(new FileSystemError('permission denied').code).toBe('FILESYSTEM');
  });
});

describe('ApiFieldError', () => {
  it('carries field, message, code CAPABILITY and merges field into context', () => {
    const e = new ApiFieldError('aspectRatio', 'aspectRatio is invalid', { received: '7:7' });
    expect(e.field).toBe('aspectRatio');
    expect(e.message).toBe('aspectRatio is invalid');
    expect(e.code).toBe('CAPABILITY');
    expect(e.context).toEqual({ received: '7:7', field: 'aspectRatio' });
  });

  it('preserves instanceof chain (ApiFieldError -> CapabilityError -> MediaForgeError -> Error)', () => {
    const e = new ApiFieldError('x', 'y');
    expect(e instanceof ApiFieldError).toBe(true);
    expect(e instanceof CapabilityError).toBe(true);
    expect(e instanceof MediaForgeError).toBe(true);
    expect(e instanceof Error).toBe(true);
    expect(e.name).toBe('ApiFieldError');
  });
});

describe('SafetyBlockError', () => {
  it('has code SAFETY_BLOCK', () => {
    const e = new SafetyBlockError('prompt rejected');
    expect(e.code).toBe('SAFETY_BLOCK');
  });

  it('carries suggested_rephrasing flag', () => {
    const e = new SafetyBlockError('blocked', {
      suggested_rephrasing: true,
      blockReason: 'SAFETY',
    });
    expect(e.context?.suggested_rephrasing).toBe(true);
    expect(e.context?.blockReason).toBe('SAFETY');
  });

  it('preserves instanceof chain', () => {
    const e = new SafetyBlockError('blocked');
    expect(e instanceof SafetyBlockError).toBe(true);
    expect(e instanceof MediaForgeError).toBe(true);
  });
});
