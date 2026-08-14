export const COHUB_BILLING_POLICY = {
  hardNegativeLimitUsd: 0,
  minimumBalanceUsdByUsageKind: {
    "generation.video": 0.6,
  },
  failClosedUsageKinds: ["generation.video"],
} as const;
