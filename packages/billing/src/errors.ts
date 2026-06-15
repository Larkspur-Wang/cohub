import type { BillingAccessDecision } from "./usage-gate.js";

export class BillingAccessBlockedError extends Error {
  readonly code = "billing_credit_limit_exceeded";

  constructor(
    public readonly decision: Extract<BillingAccessDecision, { status: "blocked" }>,
  ) {
    super("Add credits to continue.");
    this.name = "BillingAccessBlockedError";
  }
}

export function isBillingAccessBlockedError(error: unknown): error is BillingAccessBlockedError {
  return error instanceof BillingAccessBlockedError;
}
