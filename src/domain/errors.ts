export type ErrorCode =
  | "invalid_input"
  | "not_found"
  | "expired"
  | "revoked"
  | "idempotency_conflict"
  | "attachment_not_ready"
  | "unsupported_type"
  | "too_large"
  | "import_rejected"
  | "ticket_invalid"
  | "no_representation"
  | "upload_conflict"
  | "unavailable"
  | "quota_exceeded";

const STATUS: Record<ErrorCode, number> = {
  invalid_input: 400,
  not_found: 404,
  expired: 410,
  revoked: 410,
  idempotency_conflict: 409,
  attachment_not_ready: 409,
  unsupported_type: 415,
  too_large: 413,
  import_rejected: 400,
  ticket_invalid: 401,
  no_representation: 422,
  upload_conflict: 409,
  unavailable: 410,
  quota_exceeded: 429,
};

export class HandoffError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "HandoffError";
    this.code = code;
    this.status = STATUS[code];
  }
}

export class AuthError extends Error {
  readonly error: "invalid_token" | "insufficient_scope" | "invalid_request";
  /** Set only when the token's signature was valid, so the member and client are known (a revoked token). */
  readonly subject: string | null;
  readonly clientId: string | null;
  constructor(error: AuthError["error"], description: string, who: { subject?: string; clientId?: string } = {}) {
    super(description);
    this.name = "AuthError";
    this.error = error;
    this.subject = who.subject ?? null;
    this.clientId = who.clientId ?? null;
  }
}

/** Ticket tokens and JWTs are long base64url runs; ids are shorter. Replace any such run before logging. */
export const redactSecrets = (text: string): string => text.replace(/[A-Za-z0-9_\-.]{32,}/g, "[redacted]");
