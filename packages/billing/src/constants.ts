export const COHUB_BILLING_POLICY = {
  hardNegativeLimitUsd: -1,
  minimumBalanceUsdByUsageKind: {
    "generation.video": 0.8,
  },
  failClosedUsageKinds: ["generation.video"],
} as const;
