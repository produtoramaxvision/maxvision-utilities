import { sanitizePayload } from './sanitize.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LoggerOptions {
  level?: LogLevel;
  format?: 'json' | 'pretty';
  /** Inject a custom writer for testing. Defaults to process.stderr.write. */
  write?: (chunk: string) => void;
}

export class Logger {
  private readonly level: LogLevel;
  private readonly format: 'json' | 'pretty';
  private readonly writer: (chunk: string) => void;

  constructor(opts: LoggerOptions = {}) {
    this.level =
      opts.level ??
      (this.parseLevel(process.env['MEDIA_FORGE_LOG_LEVEL']) ?? 'info');
    this.format =
      opts.format ??
      (process.env['MEDIA_FORGE_LOG_FORMAT'] === 'pretty' ? 'pretty' : 'json');
    this.writer =
      opts.write ??
      ((chunk: string) => {
        process.stderr.write(chunk);
      });
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.emit('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.emit('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.emit('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.emit('error', message, context);
  }

  private emit(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
    const safeContext =
      context !== undefined ? sanitizePayload(context) : undefined;
    const line = this.format === 'json'
      ? this.formatJson(level, message, safeContext)
      : this.formatPretty(level, message, safeContext);
    this.writer(line);
  }

  private formatJson(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
  ): string {
    const record: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      message,
    };
    if (context !== undefined) record['context'] = context;
    return JSON.stringify(record) + '\n';
  }

  private formatPretty(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
  ): string {
    const ts = new Date().toISOString();
    const ctx =
      context !== undefined && Object.keys(context).length > 0
        ? ' ' + JSON.stringify(context)
        : '';
    return `[${ts}] ${level.toUpperCase()} ${message}${ctx}\n`;
  }

  private parseLevel(raw: string | undefined): LogLevel | undefined {
    if (!raw) return undefined;
    const lower = raw.toLowerCase();
    if (lower === 'debug' || lower === 'info' || lower === 'warn' || lower === 'error') {
      return lower;
    }
    return undefined;
  }
}

/** Default logger reading config from env. */
export const logger = new Logger();
