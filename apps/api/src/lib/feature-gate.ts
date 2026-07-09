import type { Context } from "hono";
import {
  createFeatureGateConversionIntent,
  FEATURE_NOT_ENTITLED_ERROR_CODE,
} from "@cohub/billing";
import { jsonError } from "./json-error.js";

/**
 * Standard 402 response for plan entitlement gates. Carries a shared error
 * code and a billing conversion intent so web/CLI clients can open the same
 * upgrade UI regardless of which feature was blocked.
 */
export function featureGateResponse(
  c: Context,
  input: {
    source: string;
    message: string;
    title?: string;
    conversionMessage?: string;
  },
) {
  return jsonError(c, {
    status: 402,
    message: input.message,
    code: FEATURE_NOT_ENTITLED_ERROR_CODE,
    extra: {
      billing: {
        conversion: createFeatureGateConversionIntent({
          source: input.source,
          title: input.title,
          message: input.conversionMessage ?? input.message,
        }),
      },
    },
  });
}
