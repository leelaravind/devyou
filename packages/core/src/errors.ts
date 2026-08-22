/**
 * Application errors.
 *
 * One class, a fixed code set, and a deliberate split between what the caller is
 * told and what the log records. `internalDetail` never reaches a response body:
 * the difference between "not found" and "found but you may not see it" is exactly
 * the kind of thing an attacker enumerates with.
 */

export const ERROR_CODES = [
  "BAD_REQUEST",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "PAYLOAD_TOO_LARGE",
  "UNPROCESSABLE",
  "INTERNAL",
  "UNAVAILABLE",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE: 422,
  INTERNAL: 500,
  UNAVAILABLE: 503,
};

/** Safe, generic text. Anything specific goes in `internalDetail`. */
const PUBLIC_MESSAGE: Record<ErrorCode, string> = {
  BAD_REQUEST: "The request could not be understood.",
  UNAUTHENTICATED: "Sign in to continue.",
  FORBIDDEN: "You do not have access to this.",
  NOT_FOUND: "Not found.",
  CONFLICT: "That conflicts with the current state.",
  RATE_LIMITED: "Too many requests. Try again shortly.",
  PAYLOAD_TOO_LARGE: "That submission is too large.",
  UNPROCESSABLE: "That submission could not be processed.",
  INTERNAL: "Something went wrong at our end.",
  UNAVAILABLE: "Temporarily unavailable.",
};

export interface ApiErrorOptions {
  /** Shown to the caller. Falls back to the code's generic text. Never include
   *  identifiers, query fragments, or anything describing internal structure. */
  publicMessage?: string;
  /** Logged, never serialised into a response. */
  internalDetail?: string;
  /** Field-level validation problems, safe to return. */
  fieldErrors?: Record<string, string>;
  cause?: unknown;
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly publicMessage: string;
  readonly internalDetail: string | undefined;
  readonly fieldErrors: Record<string, string> | undefined;

  constructor(code: ErrorCode, options: ApiErrorOptions = {}) {
    super(options.internalDetail ?? PUBLIC_MESSAGE[code], { cause: options.cause });
    this.name = "ApiError";
    this.code = code;
    this.status = STATUS[code];
    this.publicMessage = options.publicMessage ?? PUBLIC_MESSAGE[code];
    this.internalDetail = options.internalDetail;
    this.fieldErrors = options.fieldErrors;
  }

  /** The response body. Note what is absent: `internalDetail` and `cause`. */
  toPublicJSON(): { error: { code: ErrorCode; message: string; fields?: Record<string, string> } } {
    return {
      error: {
        code: this.code,
        message: this.publicMessage,
        ...(this.fieldErrors ? { fields: this.fieldErrors } : {}),
      },
    };
  }

  static is(value: unknown): value is ApiError {
    return value instanceof ApiError;
  }
}

/**
 * Ownership failures on the public object API return 404, not 403.
 *
 * A 403 confirms the object exists, which turns every object endpoint into an
 * existence oracle. Inside the admin Worker the opposite is correct — every caller
 * there has already passed Cloudflare Access, so an honest 403 makes a permissions
 * problem diagnosable instead of looking like missing data.
 */
export function notFoundOrForbidden(surface: "public" | "admin", detail: string): ApiError {
  return surface === "admin"
    ? new ApiError("FORBIDDEN", { internalDetail: detail })
    : new ApiError("NOT_FOUND", { internalDetail: detail });
}
