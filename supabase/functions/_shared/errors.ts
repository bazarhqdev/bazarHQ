/**
 * Structured, user-safe errors.
 *
 * Every function answers failures as
 *   { "error": { "code": "VALIDATION", "message": "…", "fieldErrors"?: {…}, "reason"?: "BQ001" } }
 * with an HTTP status. Messages are plain English (NFR-U-01). Raw provider,
 * Postgres or stack details never reach the client; they are logged with the
 * request id only (without tokens, credentials or personal data).
 *
 * Postgres error contract (see migration 007 header):
 *   42501 forbidden · P0002 not found · 22023 invalid input · 23505 conflict/duplicate
 *   23514 business rule violated · 55000 immutable/append-only · BQ001 insufficient stock
 *   BQ002 price changed · BQ003 store/product unavailable · BQ004 rate limited
 *   BQ005 payment method unavailable
 */

/** Same vocabulary as packages/shared ServiceErrorCode. */
export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'LOCKED'
  | 'SUSPENDED'
  | 'UNVERIFIED'
  | 'UNKNOWN';

export class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fieldErrors?: Record<string, string>;
  /** Machine-readable sub-reason (e.g. the SQLSTATE BQ001) — never sensitive. */
  readonly reason?: string;

  constructor(status: number, code: ErrorCode, message: string, fieldErrors?: Record<string, string>, reason?: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
    this.reason = reason;
  }
}

export const GENERIC_MESSAGE: Record<ErrorCode, string> = {
  UNAUTHENTICATED: 'Please sign in to continue.',
  FORBIDDEN: 'You don’t have permission to do that.',
  NOT_FOUND: 'We couldn’t find that.',
  VALIDATION: 'Please check the highlighted fields.',
  CONFLICT: 'That can’t be done right now. Refresh and try again.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  LOCKED: 'This account is temporarily locked. Try again later.',
  SUSPENDED: 'This account is suspended.',
  UNVERIFIED: 'Please verify your email address first.',
  UNKNOWN: 'Something went wrong. Please try again.',
};

const PG_MAP: Record<string, [number, ErrorCode]> = {
  '42501': [403, 'FORBIDDEN'],
  P0002: [404, 'NOT_FOUND'],
  '22023': [422, 'VALIDATION'],
  '22P02': [422, 'VALIDATION'],
  '23502': [422, 'VALIDATION'],
  '23503': [422, 'VALIDATION'],
  '23505': [409, 'CONFLICT'],
  '23514': [409, 'CONFLICT'],
  '40001': [409, 'CONFLICT'],
  '55000': [409, 'CONFLICT'],
  BQ001: [409, 'CONFLICT'],
  BQ002: [409, 'CONFLICT'],
  BQ003: [404, 'NOT_FOUND'],
  BQ004: [429, 'RATE_LIMITED'],
  BQ005: [409, 'CONFLICT'],
};

/**
 * Messages written in the migrations are safe to show. Postgres' own messages
 * (constraint names, column names, permission errors) are not; those get the
 * generic text for their category.
 */
const SYSTEM_MESSAGE =
  /(constraint|violates|duplicate key|null value|relation "|column "|syntax|function |permission denied|schema |operator |type "|invalid input syntax|out of range|JWT|PGRST)/i;

export function isAuthoredMessage(message: string | undefined | null): message is string {
  return typeof message === 'string' && message.length > 0 && message.length <= 300 && !SYSTEM_MESSAGE.test(message);
}

/** Maps a PostgREST/RPC error ({ code, message }) to a safe HttpError. */
export function fromDbError(err: { code?: string | null; message?: string | null } | null | undefined): HttpError {
  const code = err?.code ?? '';
  const mapped = PG_MAP[code];
  if (!mapped) {
    return new HttpError(500, 'UNKNOWN', GENERIC_MESSAGE.UNKNOWN);
  }
  const [status, errorCode] = mapped;
  const message = isAuthoredMessage(err?.message) ? err!.message! : GENERIC_MESSAGE[errorCode];
  return new HttpError(status, errorCode, message, undefined, code);
}

export function errorBody(e: HttpError): { error: { code: ErrorCode; message: string; fieldErrors?: Record<string, string>; reason?: string } } {
  return {
    error: {
      code: e.code,
      message: e.message,
      ...(e.fieldErrors ? { fieldErrors: e.fieldErrors } : {}),
      ...(e.reason ? { reason: e.reason } : {}),
    },
  };
}

export const unauthenticated = (message = 'Your session has expired. Please sign in again.') => new HttpError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = GENERIC_MESSAGE.FORBIDDEN) => new HttpError(403, 'FORBIDDEN', message);
export const notFound = (message = GENERIC_MESSAGE.NOT_FOUND) => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (message: string, reason?: string) => new HttpError(409, 'CONFLICT', message, undefined, reason);
export const invalid = (message: string, fieldErrors?: Record<string, string>) => new HttpError(422, 'VALIDATION', message, fieldErrors);
export const rateLimited = (message = GENERIC_MESSAGE.RATE_LIMITED) => new HttpError(429, 'RATE_LIMITED', message);
