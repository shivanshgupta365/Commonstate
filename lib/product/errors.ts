export type ProductErrorCode =
  | "INVALID_JSON"
  | "PAYLOAD_TOO_LARGE"
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "AUTH_CONFIG_UNAVAILABLE"
  | "FORBIDDEN"
  | "SCOPE_DENIED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "CONCURRENT_UPDATE"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_KEY_REUSED"
  | "CONFIG_VERSION_MISMATCH"
  | "ACTION_DISALLOWED"
  | "CONNECTOR_UNAVAILABLE"
  | "RATE_LIMITED"
  | "STORAGE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export class ProductError extends Error {
  constructor(
    readonly code: ProductErrorCode,
    message: string,
    readonly status = 400,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ProductError";
  }
}

export function isDatabaseUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: string }).code;
  return (
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    error.message.includes("DATABASE_URL") ||
    error.message.includes("connect")
  );
}
