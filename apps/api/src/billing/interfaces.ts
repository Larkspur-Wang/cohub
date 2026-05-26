import type { ConsumeCreditsResponse } from "@talesofai-billing/sdk/admin/credits";
import type { ActiveBenefit, CreditSummary } from "@talesofai-billing/sdk/admin/customers";

export const COHUB_BILLING_TOKEN_TYPES = {
  usd: "usd",
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
  preflightUsage(input: BillingUsagePreflightInput): Promise<BillingUsagePreflight>;
  recordUsage(input: BillingUsageRecordInput): Promise<BillingUsageRecordResult>;
  getFeatureEntitlement(input: BillingFeatureEntitlementInput): Promise<BillingFeatureEntitlement | null>;
  checkFeatureLimit(input: BillingFeatureLimitInput): Promise<BillingFeatureLimitCheck>;
}
