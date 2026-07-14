export class BillingApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;
  readonly requestId?: string;
  readonly responseBody: unknown;

  constructor(input: {
    status: number;
    message: string;
    code?: string;
    details?: unknown;
    requestId?: string;
    responseBody?: unknown;
  }) {
    super(input.message);
    this.name = "ApiError";
    this.status = input.status;
    this.code = input.code;
    this.details = input.details;
    this.requestId = input.requestId;
    this.responseBody = input.responseBody ?? null;
  }
}

/** Alias used by routes for continuity with the billing SDK error name. */
export class ApiError extends BillingApiError {}

/**
 * Detect billing/commerce API errors from either the local class or the
 * optional `@talesofai-billing/sdk` ApiError (different module identity).
 */
export function isBillingApiError(error: unknown): error is BillingApiError {
  if (error instanceof BillingApiError) return true;
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    name?: unknown;
    status?: unknown;
    message?: unknown;
  };
  if (typeof candidate.status !== "number" || !Number.isFinite(candidate.status)) {
    return false;
  }
  if (typeof candidate.message !== "string") return false;
  // SDK and local errors both use name "ApiError" / "BillingApiError".
  return candidate.name === "ApiError" || candidate.name === "BillingApiError";
}

export function getBillingApiErrorStatus(error: unknown): number | null {
  return isBillingApiError(error) ? error.status : null;
}
