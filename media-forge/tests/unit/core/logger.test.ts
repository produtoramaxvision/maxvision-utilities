import { describe, it, expect, beforeEach } from 'vitest';
import { Logger } from '../../../src/core/logger.js';

interface CapturedLine {
  raw: string;
  json?: Record<string, unknown>;
}

function capture(): { write: (c: string) => void; lines: CapturedLine[] } {
  const lines: CapturedLine[] = [];
  return {
    lines,
    write: (chunk: string) => {
      const trimmed = chunk.replace(/\n$/, '');
      const captured: CapturedLine = { raw: trimmed };
      try {
        captured.json = JSON.parse(trimmed);
      } catch {
        // not JSON (pretty format)
      }
      lines.push(captured);
    },
  };
}

describe('Logger level filtering', () => {
  it('emits info+warn+error when level=info', () => {
    const cap = capture();
    const log = new Logger({ level: 'info', format: 'json', write: cap.write });
    log.debug('skipped');
    log.info('shown');
    log.warn('shown');
    log.error('shown');
    expect(cap.lines).toHaveLength(3);
    expect(cap.lines.map((l) => l.json?.['level'])).toEqual(['info', 'warn', 'error']);
  });

  it('emits all when level=debug', () => {
    const cap = capture();
    const log = new Logger({ level: 'debug', format: 'json', write: cap.write });
    log.debug('a');
    log.info('b');
    log.warn('c');
    log.error('d');
    expect(cap.lines).toHaveLength(4);
  });

  it('emits only error when level=error', () => {
    const cap = capture();
    const log = new Logger({ level: 'error', format: 'json', write: cap.write });
    log.debug('x');
    log.info('x');
    log.warn('x');
    log.error('boom');
    expect(cap.lines).toHaveLength(1);
    expect(cap.lines[0]?.json?.['level']).toBe('error');
  });
});

describe('Logger format', () => {
  it('json format emits valid JSON with ts/level/message/context', () => {
    const cap = capture();
    const log = new Logger({ level: 'info', format: 'json', write: cap.write });
    log.info('hello', { foo: 'bar' });
    expect(cap.lines).toHaveLength(1);
    const j = cap.lines[0]?.json;
    expect(j).toBeDefined();
    expect(j?.['level']).toBe('info');
    expect(j?.['message']).toBe('hello');
    expect(j?.['context']).toEqual({ foo: 'bar' });
    expect(typeof j?.['ts']).toBe('string');
    expect(j?.['ts']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('pretty format emits readable line WITHOUT JSON', () => {
    const cap = capture();
    const log = new Logger({ level: 'info', format: 'pretty', write: cap.write });
    log.warn('careful', { x: 1 });
    expect(cap.lines).toHaveLength(1);
    expect(cap.lines[0]?.raw).toMatch(/^\[.*\] WARN careful \{"x":1\}$/);
    expect(cap.lines[0]?.json).toBeUndefined();
  });

  it('json format omits context when not provided', () => {
    const cap = capture();
    const log = new Logger({ level: 'info', format: 'json', write: cap.write });
    log.info('no ctx');
    const j = cap.lines[0]?.json;
    expect(j?.['context']).toBeUndefined();
  });
});

describe('Logger auto-sanitization', () => {
  it('redacts api_key in context', () => {
    const cap = capture();
    const log = new Logger({ level: 'info', format: 'json', write: cap.write });
    log.info('call', { api_key: 'AIzaSyABCDEFGHIJ', prompt: 'hi' });
    const ctx = cap.lines[0]?.json?.['context'] as Record<string, unknown> | undefined;
    expect(ctx?.['api_key']).toBe('****GHIJ');
    expect(ctx?.['prompt']).toBe('hi');
  });

  it('redacts nested Authorization', () => {
    const cap = capture();
    const log = new Logger({ level: 'info', format: 'json', write: cap.write });
    log.info('req', {
      url: 'https://example.com',
      headers: { Authorization: 'Bearer secret-token-xyz' },
    });
    const ctx = cap.lines[0]?.json?.['context'] as Record<string, unknown> | undefined;
    const headers = ctx?.['headers'] as Record<string, unknown> | undefined;
    expect(headers?.['Authorization']).toBe('****-xyz');
  });
});

describe('Logger env reading', () => {
  const ORIGINAL_LEVEL = process.env['MEDIA_FORGE_LOG_LEVEL'];
  const ORIGINAL_FORMAT = process.env['MEDIA_FORGE_LOG_FORMAT'];

  beforeEach(() => {
    process.env['MEDIA_FORGE_LOG_LEVEL'] = ORIGINAL_LEVEL ?? '';
    process.env['MEDIA_FORGE_LOG_FORMAT'] = ORIGINAL_FORMAT ?? '';
  });

  it('reads MEDIA_FORGE_LOG_LEVEL=debug', () => {
    process.env['MEDIA_FORGE_LOG_LEVEL'] = 'debug';
    const cap = capture();
    const log = new Logger({ format: 'json', write: cap.write });
    log.debug('shown');
    expect(cap.lines).toHaveLength(1);
  });

  it('defaults to info level when env var invalid', () => {
    process.env['MEDIA_FORGE_LOG_LEVEL'] = 'bogus';
    const cap = capture();
    const log = new Logger({ format: 'json', write: cap.write });
    log.debug('skipped');
    log.info('shown');
    expect(cap.lines).toHaveLength(1);
  });

  it('reads MEDIA_FORGE_LOG_FORMAT=pretty', () => {
    process.env['MEDIA_FORGE_LOG_FORMAT'] = 'pretty';
    const cap = capture();
    const log = new Logger({ level: 'info', write: cap.write });
    log.info('hello');
    expect(cap.lines[0]?.json).toBeUndefined();
    expect(cap.lines[0]?.raw).toMatch(/INFO hello/);
  });
});
