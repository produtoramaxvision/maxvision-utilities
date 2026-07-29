export type ErrorCode =
  | 'GENERIC'
  | 'CONFIG'
  | 'VALIDATION'
  | 'CAPABILITY'
  | 'API'
  | 'RATE_LIMIT'
  | 'AUTH'
  | 'POLLING'
  | 'OUTPUT'
  | 'FILESYSTEM'
  | 'SAFETY_BLOCK'
  | 'COST_GUARD';

export class MediaForgeError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ConfigError extends MediaForgeError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CONFIG', context);
  }
}

export class ValidationError extends MediaForgeError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'VALIDATION', context);
  }
}

export class CapabilityError extends MediaForgeError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CAPABILITY', context);
  }
}

export class ApiFieldError extends CapabilityError {
  constructor(
    public readonly field: string,
    message: string,
    context?: Record<string, unknown>,
  ) {
    super(message, { ...context, field });
  }
}

export class ApiError extends MediaForgeError {
  constructor(
    message: string,
    code: ErrorCode = 'API',
    context?: Record<string, unknown>,
  ) {
    super(message, code, context);
  }
}

export class PollingError extends MediaForgeError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'POLLING', context);
  }
}

export class OutputError extends MediaForgeError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'OUTPUT', context);
  }
}

export class FileSystemError extends MediaForgeError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'FILESYSTEM', context);
  }
}

export interface SafetyBlockContext extends Record<string, unknown> {
  suggested_rephrasing?: boolean;
  blockReason?: string;
  finishReason?: string;
}

export class SafetyBlockError extends MediaForgeError {
  constructor(message: string, context?: SafetyBlockContext) {
    super(message, 'SAFETY_BLOCK', context);
  }
}

/**
 * Thrown by the cost guard (src/core/cost-guard.ts) when a generation request
 * is refused before hitting the provider — either a single-call estimate
 * above the hard block threshold, or the projected daily total (today's
 * spend + this estimate) above the daily cap. `kind` distinguishes the two
 * so callers can report which limit fired without re-parsing `message`.
 */
export class CostGuardError extends MediaForgeError {
  constructor(
    message: string,
    public readonly estimateUsd: number,
    public readonly limitUsd: number,
    public readonly kind: 'block' | 'daily-cap',
  ) {
    super(message, 'COST_GUARD', { estimateUsd, limitUsd, kind });
  }
}
