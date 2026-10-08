export type ErrorCode =
  | 'UNKNOWN_ERROR'
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_UNAVAILABLE'
  | 'PLAYER_ERROR'
  | 'VOICE_CONNECTION_FAILED'
  | 'USER_NOT_IN_VOICE'
  | 'BOT_NOT_IN_SAME_VOICE'
  | 'LAVALINK_UNAVAILABLE'
  | 'PERMISSION_DENIED'
  | 'DJ_ROLE_REQUIRED'
  | 'INVALID_QUERY'
  | 'QUEUE_EMPTY'
  | 'QUEUE_LIMIT_EXCEEDED'
  | 'RATE_LIMITED'
  | 'TRACK_UNAVAILABLE'
  | 'TRACK_NOT_FOUND'
  | 'COMMAND_NOT_FOUND'
  | 'EXECUTION_TIMEOUT'
  | 'SOURCE_TIMEOUT'
  | 'SOURCE_AUTH_FAILED'
  | 'SOURCE_RATE_LIMITED'
  | 'INVALID_SOURCE_URL'
  | 'UNSUPPORTED_SOURCE'
  | 'LOCAL_FILE_NOT_ALLOWED'
  | 'SECURITY_VIOLATION';

export interface VoidTuneErrorOptions {
  code: ErrorCode;
  message: string;
  userMessage?: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export type EchoTuneErrorOptions = VoidTuneErrorOptions;

export class VoidTuneError extends Error {
  public readonly code: ErrorCode;
  public readonly userMessage: string;
  public readonly details: Record<string, unknown>;

  constructor(options: VoidTuneErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = this.constructor.name;
    this.code = options.code;
    this.userMessage = options.userMessage || options.message;
    this.details = options.details || {};
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export const EchoTuneError = VoidTuneError;

export class VoiceError extends VoidTuneError {
  constructor(code: ErrorCode, message: string, userMessage?: string, details?: Record<string, unknown>) {
    super({
      code,
      message,
      userMessage: userMessage || 'Voice connection error. Please ensure you are in an accessible voice channel.',
      details,
    });
  }
}

export class MusicError extends VoidTuneError {
  constructor(code: ErrorCode, message: string, userMessage?: string, details?: Record<string, unknown>) {
    super({
      code,
      message,
      userMessage: userMessage || 'An error occurred during audio playback.',
      details,
    });
  }
}

export class SourceError extends VoidTuneError {
  constructor(code: ErrorCode, message: string, userMessage?: string, details?: Record<string, unknown>) {
    super({
      code,
      message,
      userMessage: userMessage || 'Could not retrieve or resolve audio from that source.',
      details,
    });
  }
}

export class PermissionError extends VoidTuneError {
  constructor(message: string, userMessage?: string, details?: Record<string, unknown>) {
    super({
      code: 'PERMISSION_DENIED',
      message,
      userMessage: userMessage || 'You do not have permission to use this command.',
      details,
    });
  }
}

export class RateLimitError extends VoidTuneError {
  constructor(retryAfterSeconds: number, details?: Record<string, unknown>) {
    super({
      code: 'RATE_LIMITED',
      message: `Rate limit exceeded. Retry after ${retryAfterSeconds}s`,
      userMessage: `Rate limit active. Please wait ${retryAfterSeconds}s before trying again.`,
      details: { retryAfterSeconds, ...details },
    });
  }
}
