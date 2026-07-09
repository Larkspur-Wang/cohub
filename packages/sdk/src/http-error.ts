import { HttpError } from "./transport.js";

/** Shared HTTP error code for every plan entitlement gate (402). */
export const FEATURE_NOT_ENTITLED_ERROR_CODE = "feature_not_entitled" as const;

export function isHttpErrorCode(error: unknown, code: string): error is HttpError & { code: string } {
  return error instanceof HttpError && error.code === code;
}

export function isFeatureNotEntitledError(error: unknown): error is HttpError & { code: string } {
  return isHttpErrorCode(error, FEATURE_NOT_ENTITLED_ERROR_CODE);
}
