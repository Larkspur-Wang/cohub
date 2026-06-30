import type { Context } from "hono";
import { ApiError } from "@talesofai-billing/sdk/base";
import { jsonError } from "./json-error.js";
import { SpaceCommerceNotInitializedError } from "./space-commerce.js";

export const SPACE_COMMERCE_NOT_INITIALIZED_CODE = "space_commerce_not_initialized";

function commerceApiErrorResponse(c: Context, error: ApiError, input: { conflictMessage: string }) {
  const status = error.status >= 500 ? 502 : error.status;
  const message =
    status === 400 ? "Invalid commerce request" :
    status === 401 ? "Unauthorized" :
    status === 403 ? "Forbidden" :
    status === 404 ? "Commerce resource not found" :
    status === 409 ? input.conflictMessage :
    "Commerce request failed";
  return jsonError(c, { status, message });
}

export function handleSpaceCommerceRouteError(c: Context, error: unknown) {
  if (error instanceof ApiError) {
    return commerceApiErrorResponse(c, error, { conflictMessage: "Commerce request conflicted" });
  }
  if (error instanceof SpaceCommerceNotInitializedError) {
    return jsonError(c, {
      status: 409,
      message: "Space commerce is not initialized",
      code: SPACE_COMMERCE_NOT_INITIALIZED_CODE,
    });
  }
  return null;
}

export function handleWorkCommerceRouteError(c: Context, error: unknown) {
  if (error instanceof ApiError) {
    return commerceApiErrorResponse(c, error, { conflictMessage: "Checkout is not available" });
  }
  if (error instanceof SpaceCommerceNotInitializedError) {
    return jsonError(c, {
      status: 409,
      message: "Commerce is not available for this work yet",
      code: SPACE_COMMERCE_NOT_INITIALIZED_CODE,
    });
  }
  return null;
}
