export const COHUB_BILLING_POLICY = {
  hardNegativeLimitUsd: -1,
  minimumBalanceUsdByUsageKind: {
    "generation.video": 0.6,
  },
  failClosedUsageKinds: ["generation.video"],
} as const;
