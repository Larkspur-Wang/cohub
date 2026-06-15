export type BillingConversionLevel = "soft" | "hard";

export type BillingConversionReason =
  | "negative_balance"
  | "negative_balance_limit_exceeded";

export type BillingConversionAudience = "free" | "paid" | "unknown";

export type BillingPreferredOfferKind = "plan" | "upgrade" | "addon" | "mixed";

export type BillingConversionIntent = {
  level: BillingConversionLevel;
  reason: BillingConversionReason;
  audience: BillingConversionAudience;
  preferredOfferKind: BillingPreferredOfferKind;
  title: string;
  message: string;
  primaryAction: {
    label: string;
    action: "open_billing_conversion";
  };
  source: string;
};

export function createBillingConversionIntent(input: {
  level: BillingConversionLevel;
  reason: BillingConversionReason;
  source: string;
  audience?: BillingConversionAudience;
  preferredOfferKind?: BillingPreferredOfferKind;
}): BillingConversionIntent {
  const isHard = input.level === "hard";
  return {
    level: input.level,
    reason: input.reason,
    audience: input.audience ?? "unknown",
    preferredOfferKind: input.preferredOfferKind ?? "mixed",
    title: isHard ? "Add credits to continue" : "Balance below zero",
    message: isHard
      ? "Your balance has passed the temporary usage limit. Add credits to resume AI requests."
      : "Your work can continue for now. Add credits to avoid interruption.",
    primaryAction: {
      label: isHard ? "Add credits" : "View options",
      action: "open_billing_conversion",
    },
    source: input.source,
  };
}
