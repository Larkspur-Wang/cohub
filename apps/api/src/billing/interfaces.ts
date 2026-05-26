import type { ConsumeCreditsResponse } from "@talesofai-billing/sdk/admin/credits";
import type { ActiveBenefit, CreditSummary } from "@talesofai-billing/sdk/admin/customers";

export const COHUB_BILLING_TOKEN_TYPES = {
  usdMicroCent: "usd_micro_cent",
} as const;

export const COHUB_BILLING_CREDIT_UNITS = {
  usdMicroCent: {
    tokenType: COHUB_BILLING_TOKEN_TYPES.usdMicroCent,
    displayCurrency: "USD",
    displayUnit: "micro-cent",
    unitToUsd: 0.00000001,
    unitsPerUsd: 100_000_000,
    usdDecimalPlaces: 8,
  },
} as const;

export const COHUB_BILLING_USAGE_TYPES = {
  generation: "generation",
  generationLlm: "generation.llm",
  generationImage: "generation.image",
  generationVideo: "generation.video",
  sandboxCompute: "sandbox.compute",
  spaceStorage: "space.storage",
} as const;

export const COHUB_BILLING_FEATURES = {
  generationAccess: "generation.access",
  sandboxAccess: "sandbox.access",
  spaceStorageMaxBytes: "space.storage.max_bytes",
  spaceModsMax: "space.mods.max",
} as const;

export type CohubBillingTokenType =
  typeof COHUB_BILLING_TOKEN_TYPES[keyof typeof COHUB_BILLING_TOKEN_TYPES]
  | (string & {});

export type CohubBillingUsageType =
  typeof COHUB_BILLING_USAGE_TYPES[keyof typeof COHUB_BILLING_USAGE_TYPES]
  | (string & {});

export type CohubBillingFeatureKey =
  typeof COHUB_BILLING_FEATURES[keyof typeof COHUB_BILLING_FEATURES]
  | (string & {});

export type BillingUserRef = {
  userId: string;
};

export type BillingProviderKind = "disabled" | "talesofai";

export type BillingPluginStatus = {
  provider: BillingProviderKind;
  configured: boolean;
  reason?: string;
};

export type BillingCreditBalance = {
  tokenType: string;
  availableBalance: number;
  openOverageBalance: number;
  netBalance: number;
  raw: CreditSummary;
};

export type BillingCreditUnit = {
  tokenType: string;
  displayCurrency: "USD";
  displayUnit: string;
  unitToUsd: number;
  unitsPerUsd: number;
  usdDecimalPlaces: number;
};

export type BillingCreditGrantStatus = {
  id: string;
  tokenType: string;
  benefitKey: string | null;
  grantKind: string | null;
  sourceType: string | null;
  sourceId: string | null;
  status: string;
  remainingAmount: number;
  remainingAmountUsd: number;
  originalAmount: number | null;
  originalAmountUsd: number | null;
  effectiveAt: string | null;
  expiresAt: string | null;
  daysRemaining: number | null;
};

export type BillingCreditExpiryGroup = {
  key: "expired" | "lt_7d" | "lt_30d" | "gte_30d" | "never";
  label: string;
  remainingAmountUsd: number;
  grants: BillingCreditGrantStatus[];
};

export type BillingOpenOverageStatus = {
  id: string;
  tokenType: string;
  usageType: string | null;
  sourceType: string;
  sourceId: string;
  operationId: string;
  originalAmountUsd: number;
  remainingAmountUsd: number;
  settledAmountUsd: number;
  status: string;
  reason: string | null;
  createdAt: string;
};

export type BillingCreditStatus = BillingUserRef & {
  billing: BillingPluginStatus;
  tokenType: string;
  unit: BillingCreditUnit;
  balance: {
    availableUsd: number;
    openOverageUsd: number;
    netUsd: number;
  };
  overage: {
    hasOpenOverage: boolean;
    openAmountUsd: number;
    items: BillingOpenOverageStatus[];
  };
  groups: BillingCreditExpiryGroup[];
};

export type BillingFeatureEntitlement = {
  key: string;
  enabled: boolean;
  metadata: Record<string, string | number | boolean>;
  grants: ActiveBenefit[];
};

export type BillingAccountState = BillingUserRef & {
  credits: BillingCreditBalance[];
  entitlements: BillingFeatureEntitlement[];
};

export type BillingUsagePreflightInput = BillingUserRef & {
  estimatedAmountUsd: number;
  usageType: CohubBillingUsageType;
  tokenType?: CohubBillingTokenType;
};

/**
 * Advisory balance check only. This does not reserve credits; callers must still
 * handle recordUsage returning "overage".
 */
export type BillingUsagePreflight = {
  allowed: boolean;
  tokenType: string;
  estimatedAmountUsd: number;
  availableBalance: number;
  netBalance: number;
  shortfall: number;
};

export type BillingUsageRecordInput = BillingUserRef & {
  amountUsd: number;
  usageType: CohubBillingUsageType;
  sourceId: string;
  operationId: string;
  tokenType?: CohubBillingTokenType;
  reason?: string;
};

export type BillingUsageRecordResult = {
  tokenType: string;
  amountUsd: number;
  status: "disabled" | "skipped" | "recorded" | "overage";
  response: ConsumeCreditsResponse | null;
};

export type BillingFeatureEntitlementInput = BillingUserRef & {
  featureKey: CohubBillingFeatureKey;
};

export type BillingFeatureLimitInput = BillingFeatureEntitlementInput & {
  quantity: number;
  metadataKey?: string;
  fallbackLimit?: number;
  missingEntitlementPolicy?: "allow" | "deny";
};

export type BillingFeatureLimitCheck = {
  allowed: boolean;
  quantity: number;
  limit: number | null;
  unlimited: boolean;
  entitlement: BillingFeatureEntitlement | null;
};

export interface BillingOperations {
  readonly status: BillingPluginStatus;
  ensureCustomer(input: BillingUserRef): Promise<BillingUserRef>;
  getState(input: BillingUserRef): Promise<BillingAccountState>;
  getCreditStatus(input: BillingUserRef & { tokenType?: CohubBillingTokenType }): Promise<BillingCreditStatus>;
  preflightUsage(input: BillingUsagePreflightInput): Promise<BillingUsagePreflight>;
  recordUsage(input: BillingUsageRecordInput): Promise<BillingUsageRecordResult>;
  getFeatureEntitlement(input: BillingFeatureEntitlementInput): Promise<BillingFeatureEntitlement | null>;
  checkFeatureLimit(input: BillingFeatureLimitInput): Promise<BillingFeatureLimitCheck>;
}
