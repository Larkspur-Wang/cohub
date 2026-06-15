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
  benefitName: string | null;
  grantKind: string | null;
  sourceType: string | null;
  sourceId: string | null;
  status: string;
  availableNow: boolean | null;
  unavailableReasons: string[];
  remainingAmount: number;
  remainingAmountUsd: number;
  originalAmount: number | null;
  originalAmountUsd: number | null;
  consumedAmount: number | null;
  consumedAmountUsd: number | null;
  usageConsumedAmount: number | null;
  usageConsumedAmountUsd: number | null;
  settledOverageAmount: number | null;
  settledOverageAmountUsd: number | null;
  consumedPercent: number | null;
  effectiveAt: string | null;
  expiresAt: string | null;
  daysRemaining: number | null;
  createdAt: string;
};

export type BillingCreditExpiryGroup = {
  key: "expired" | "lt_7d" | "lt_30d" | "gte_30d" | "never";
  remainingAmountUsd: number;
  grants: BillingCreditGrantStatus[];
};

export type BillingCreditStatus = {
  netUsd: number;
  groups: BillingCreditExpiryGroup[];
};

export type BillingProductKind = "plan" | "addon";

export type BillingProductBillingInterval = "monthly" | "quarterly" | "yearly" | "one_time" | "other";

export type BillingProductPricing = {
  amountMinor: number;
  amountUsd: number;
  compareAtAmountMinor: number | null;
  compareAtAmountUsd: number | null;
  discountLabel: string | null;
  discountRate: number | null;
};

export type BillingProductDisplay = {
  description: string | null;
  benefits: string[];
  creditsAmount: number | null;
  validity: string | null;
  creditBenefits: BillingProductCreditBenefit[];
};

export type BillingProductCreditBenefit = {
  key: string;
  name: string;
  tokenType: string;
  grantKind: string;
  scope: string;
  cycleAmount: number;
  cycleAmountUsd: number;
  periodAmount: number;
  periodAmountUsd: number;
  expiresInDays: number | null;
};

export type BillingCatalogProduct = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: string;
  visibility: string;
  billingType: string;
  billingPeriod: string;
  billingIntervalCount: number;
  currency: string;
  kind: BillingProductKind;
  interval: BillingProductBillingInterval;
  pricing: BillingProductPricing;
  display: BillingProductDisplay;
  isDefaultPlan: boolean;
};

export type BillingSubscriptionSummary = {
  id: string;
  productKey: string | null;
  productName: string | null;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export type BillingPaymentStatus = {
  available: boolean;
  reason: string | null;
};

export type BillingCatalog = BillingUserRef & {
  billing: BillingPluginStatus;
  payment: BillingPaymentStatus;
  products: BillingCatalogProduct[];
  plans: BillingCatalogProduct[];
  addons: BillingCatalogProduct[];
  currentSubscriptions: BillingSubscriptionSummary[];
  hasActiveSubscription: boolean;
  defaultPlanProductKey: string | null;
};

export type BillingHistoryPagination = {
  maxPage: number;
  totalCount: number;
};

export type BillingCheckoutActionState = {
  canPay: boolean;
  checkoutUrl: string | null;
  checkoutUsable: boolean;
  canCancelCheckout: boolean;
  canCancelAutoRenew: boolean;
  unavailableReason: string | null;
};

export type BillingHistoryListInput = BillingUserRef & {
  page?: number;
  limit?: number;
};

export type BillingOrderStatus = {
  id: string;
  externalUserId: string;
  productKey: string;
  productName: string;
  subscriptionId: string | null;
  status: string;
  billingReason: string;
  amountMinor: number;
  amountUsd: number;
  paidAmountMinor: number;
  paidAmountUsd: number;
  currency: string;
  refundedAmountMinor: number;
  refundedAmountUsd: number;
  fulfillmentSource: string;
  checkoutExpiresAt: string | null;
  paidAt: string | null;
  checkoutCanceledAt: string | null;
  checkoutExpiredAt: string | null;
  paymentConflictedAt: string | null;
  createdAt: string;
  updatedAt: string;
  providerStatus: string | null;
  checkoutStatus: string | null;
  actions: BillingCheckoutActionState;
};

export type BillingOrderList = BillingUserRef & {
  billing: BillingPluginStatus;
  page: number;
  limit: number;
  items: BillingOrderStatus[];
  pagination: BillingHistoryPagination;
};

export type BillingSubscriptionHistoryStatus = {
  id: string;
  externalUserId: string;
  productKey: string;
  productName: string;
  status: string;
  amountMinor: number;
  amountUsd: number;
  paidAmountMinor: number;
  paidAmountUsd: number;
  currency: string;
  billingPeriod: string;
  billingIntervalCount: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  checkoutExpiresAt: string | null;
  checkoutCanceledAt: string | null;
  checkoutExpiredAt: string | null;
  paymentConflictedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  providerStatus: string | null;
  providerTerminal: boolean;
  checkoutStatus: string | null;
  actions: BillingCheckoutActionState;
};

export type BillingSubscriptionHistoryList = BillingUserRef & {
  billing: BillingPluginStatus;
  page: number;
  limit: number;
  items: BillingSubscriptionHistoryStatus[];
  pagination: BillingHistoryPagination;
};

export type BillingCheckoutInput = BillingUserRef & {
  productKey: string;
  returnUrl?: string;
};

export type BillingCheckoutResult = BillingUserRef & {
  billing: BillingPluginStatus;
  payment: BillingPaymentStatus;
  productKey: string;
  checkoutUrl: string | null;
  checkoutUsable: boolean;
  message: string | null;
  orderId: string | null;
  subscriptionId: string | null;
  reused: boolean;
};

export type BillingRedemptionInput = BillingUserRef & {
  code: string;
};

export type BillingRedemptionResult = BillingUserRef & {
  billing: BillingPluginStatus;
  redeemed: boolean;
  message: string | null;
  redemptionRecordId: string | null;
  itemCount: number;
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

export type BillingBalanceActivityKind =
  | "grant"
  | "usage"
  | "refund"
  | "expire"
  | "revoke"
  | "adjust";

export type BillingBalanceActivityStatus = "covered" | "overage" | "partial" | null;

export type BillingBalanceActivity = {
  id: string;
  kind: BillingBalanceActivityKind;
  tokenType: string;
  title: string;
  description: string | null;
  sourceType: string | null;
  sourceId: string | null;
  operationId: string | null;
  amountUsd: number;
  status: BillingBalanceActivityStatus;
  createdAt: string;
};

export type BillingBalanceActivityList = BillingUserRef & {
  billing: BillingPluginStatus;
  tokenType: string;
  unit: BillingCreditUnit;
  page: number;
  limit: number;
  items: BillingBalanceActivity[];
  pagination: {
    maxPage: number;
    totalCount: number;
  };
};

export type BillingBalanceActivityListInput = BillingUserRef & {
  tokenType?: CohubBillingTokenType;
  page?: number;
  limit?: number;
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
  getCatalog(input?: BillingUserRef): Promise<BillingCatalog>;
  listOrders(input: BillingHistoryListInput): Promise<BillingOrderList>;
  listSubscriptions(input: BillingHistoryListInput): Promise<BillingSubscriptionHistoryList>;
  purchaseAddon(input: BillingCheckoutInput): Promise<BillingCheckoutResult>;
  createSubscription(input: BillingCheckoutInput): Promise<BillingCheckoutResult>;
  cancelOrderCheckout(input: BillingUserRef & { orderId: string }): Promise<BillingOrderStatus>;
  cancelSubscriptionCheckout(input: BillingUserRef & { subscriptionId: string }): Promise<BillingSubscriptionHistoryStatus>;
  cancelSubscriptionAutoRenew(input: BillingUserRef & { subscriptionId: string }): Promise<BillingSubscriptionHistoryStatus>;
  redeemCode(input: BillingRedemptionInput): Promise<BillingRedemptionResult>;
  preflightUsage(input: BillingUsagePreflightInput): Promise<BillingUsagePreflight>;
  recordUsage(input: BillingUsageRecordInput): Promise<BillingUsageRecordResult>;
  listBalanceActivities(input: BillingBalanceActivityListInput): Promise<BillingBalanceActivityList>;
  getFeatureEntitlement(input: BillingFeatureEntitlementInput): Promise<BillingFeatureEntitlement | null>;
  checkFeatureLimit(input: BillingFeatureLimitInput): Promise<BillingFeatureLimitCheck>;
}
