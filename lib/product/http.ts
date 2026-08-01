import { ProductError } from "./errors";

export type JsonRecord = Record<string, unknown>;

const JSON_HEADERS = {
  "cache-control": "no-store, max-age=0",
  "content-type": "application/json; charset=utf-8",
};

export function productResponse(
  body: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers(JSON_HEADERS);
  new Headers(headers).forEach((value, key) => responseHeaders.set(key, value));
  return Response.json(body, { status, headers: responseHeaders });
}

export function productSuccess(
  requestId: string,
  data: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  return productResponse({ ok: true, data, meta: { requestId } }, status, headers);
}

export function productFailure(error: unknown, requestId: string): Response {
  if (error instanceof ProductError) {
    return productResponse(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
        meta: { requestId },
      },
      error.status,
    );
  }
  return productResponse(
    {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "The product request could not be completed safely.",
      },
      meta: { requestId },
    },
    500,
  );
}

export async function readJson(request: Request): Promise<JsonRecord> {
  const maxBytes = 64 * 1024;
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > maxBytes) {
    throw new ProductError(
      "PAYLOAD_TOO_LARGE",
      "Request body must be 64KB or smaller.",
      413,
    );
  }
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return {};
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw new ProductError(
      "PAYLOAD_TOO_LARGE",
      "Request body must be 64KB or smaller.",
      413,
    );
  }
  try {
    const value: unknown = JSON.parse(raw || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ProductError("INVALID_JSON", "Request body must be a JSON object.");
    }
    return value as JsonRecord;
  } catch (error) {
    if (error instanceof ProductError) throw error;
    throw new ProductError("INVALID_JSON", "Request body contains invalid JSON.");
  }
}

export function requireIdempotencyKey(request: Request): string {
  const value = request.headers.get("idempotency-key")?.trim();
  if (!value || value.length > 200) {
    throw new ProductError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "A valid Idempotency-Key header is required for production writes.",
      400,
    );
  }
  return value;
}

export function decodeCursor(value: string | null): { createdAt: string; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as JsonRecord).createdAt !== "string" ||
      typeof (parsed as JsonRecord).id !== "string"
    ) {
      throw new Error("invalid cursor");
    }
    return parsed as { createdAt: string; id: string };
  } catch {
    throw new ProductError("VALIDATION_ERROR", "Cursor is invalid.", 400);
  }
}

export function encodeCursor(value: { createdAt: string; id: string }): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function pageLimit(url: URL): number {
  const raw = Number(url.searchParams.get("limit") ?? "50");
  if (!Number.isInteger(raw) || raw < 1 || raw > 100) {
    throw new ProductError("VALIDATION_ERROR", "Limit must be between 1 and 100.");
  }
  return raw;
}

export function requestId(request: Request): string {
  return request.headers.get("x-request-id")?.slice(0, 200) || crypto.randomUUID();
}
