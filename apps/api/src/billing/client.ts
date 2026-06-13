import {
  benefitsFeature,
  type Benefit,
  type CreditsBenefit,
} from "@talesofai-billing/sdk/admin/benefits";
import { businessesFeature } from "@talesofai-billing/sdk/admin/businesses";
import {
  creditsFeature,
  type CreditGrant,
  type CreditTransaction,
  type UsageOverage,
} from "@talesofai-billing/sdk/admin/credits";
import { customersFeature } from "@talesofai-billing/sdk/admin/customers";
import {
  type CreateOrderResponse,
  type Order,
  type OrderCheckout,
  ordersFeature,
} from "@talesofai-billing/sdk/admin/orders";
import {
  type Product,
  productsFeature,
} from "@talesofai-billing/sdk/admin/products";
import { redemptionCodesFeature } from "@talesofai-billing/sdk/admin/redemption-codes";
import { providersFeature } from "@talesofai-billing/sdk/admin/providers";
import {
  type CreateSubscriptionResponse,
  type Subscription,
  type SubscriptionCheckout,
  subscriptionsFeature,
} from "@talesofai-billing/sdk/admin/subscriptions";
import { ApiError, createSdk } from "@talesofai-billing/sdk/base";
import { createHash, randomUUID } from "node:crypto";
import { config } from "../config.js";
import { redisCommandClient } from "../redis.js";
import {
  COHUB_BILLING_CREDIT_UNITS,
  COHUB_BILLING_TOKEN_TYPES,
  type BillingAccountState,
  type BillingCatalog,
  type BillingCatalogProduct,
  type BillingCheckoutInput,
  type BillingCheckoutResult,
  type BillingProductCreditBenefit,
  type BillingCreditBalance,
  type BillingCreditExpiryGroup,
  type BillingCreditGrantStatus,
  type BillingCreditStatus,
  type BillingFeatureEntitlement,
  type BillingFeatureLimitCheck,
  type BillingFeatureLimitInput,
  type BillingHistoryListInput,
  type BillingOpenOverageList,
  type BillingOpenOverageListInput,
  type BillingOpenOverageStatus,
  type BillingOperations,
  type BillingOrderList,
  type BillingOrderStatus,
  type BillingPluginStatus,
  type BillingRedemptionInput,
  type BillingRedemptionResult,
  type BillingSubscriptionHistoryList,
  type BillingSubscriptionHistoryStatus,
  type BillingUsagePreflight,
  type BillingUsagePreflightInput,
  type BillingUsageRecordList,
  type BillingUsageRecordListInput,
  type BillingUsageRecordStatus,
  type BillingUsageRecordInput,
  type BillingUsageRecordResult,
  type BillingUserRef,
} from "./interfaces.js";

export type BillingClientConfig = {
  baseUrl: string;
  businessKey: string;
  adminApiKey: string;
};

export class BillingConfigurationError extends Error {
  constructor(message = "Talesofai Billing is not configured") {
    super(message);
    this.name = "BillingConfigurationError";
  }
}

export function resolveBillingClientConfig(): BillingClientConfig | null {
  const baseUrl = config.talesofaiBillingBaseUrl?.trim();
  const businessKey = config.talesofaiBillingBusinessKey?.trim();
  const adminApiKey = config.talesofaiBillingAdminApiKey?.trim();
  if (!baseUrl || !businessKey || !adminApiKey) return null;
  return { baseUrl, businessKey, adminApiKey };
}

export function isBillingConfigured(): boolean {
  return resolveBillingClientConfig() !== null;
}

function createConfiguredSdk(input: BillingClientConfig) {
  return createSdk({
    baseURL: input.baseUrl,
    adminApiKey: input.adminApiKey,
  })
    .useAdmin(benefitsFeature())
    .useAdmin(businessesFeature())
    .useAdmin(customersFeature())
    .useAdmin(creditsFeature())
    .useAdmin(productsFeature())
    .useAdmin(ordersFeature())
    .useAdmin(redemptionCodesFeature())
    .useAdmin(subscriptionsFeature())
    .useAdmin(providersFeature());
}

type ConfiguredBillingSdk = ReturnType<typeof createConfiguredSdk>;

const ENSURE_CUSTOMER_CACHE_TTL_MS = 5 * 60 * 1000;
const CHECKOUT_LOCK_TTL_MS = 30_000;
const CHECKOUT_LOCK_RETRY_DELAY_MS = 250;
const CHECKOUT_LOCK_RETRY_COUNT = 24;
const CREDIT_LIST_PAGE_LIMIT = 100;
const CREDIT_LIST_MAX_PAGES = 20;
const CREDIT_GRANT_DISPLAY_STATUSES = [
  "active",
  "depleted",
  "expired",
] as const;
const BILLING_CURRENT_SUBSCRIPTION_STATUSES = ["trialing", "active"] as const;
const BILLING_BLOCKING_SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "payment_conflicted",
] as const;
const BILLING_AUTO_RENEW_CANCELABLE_SUBSCRIPTION_STATUSES = [
  "active",
  "trialing",
] as const;
const CREDIT_BENEFIT_DISPLAY_NAMES: Record<string, string> = {
  free_monthly_credits: "Free Plan Credits",
};
type BillingListPage<T> = {
  items: T[];
  pagination: {
    page?: number;
    max_page: number;
  };
};
type CreditGrantDisplayStatus = (typeof CREDIT_GRANT_DISPLAY_STATUSES)[number];

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

function normalizeAmount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Number(value.toFixed(8));
}

function normalizeRedemptionCode(value: string): string {
  return value.trim();
}

function redemptionIdempotencyKey(input: {
  userId: string;
  code: string;
}): string {
  const codeHash = createHash("sha256")
    .update(normalizeRedemptionCode(input.code))
    .digest("hex");
  return `cohub:billing:redemption:${input.userId}:${codeHash}`;
}

function roundUsd(
  value: number,
  decimalPlaces = COHUB_BILLING_CREDIT_UNITS.usdMicroCent.usdDecimalPlaces,
): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(decimalPlaces));
}

function getCreditUnit(tokenType: string) {
  if (tokenType === COHUB_BILLING_TOKEN_TYPES.usdMicroCent)
    return COHUB_BILLING_CREDIT_UNITS.usdMicroCent;
  return {
    tokenType,
    displayCurrency: "USD" as const,
    displayUnit: COHUB_BILLING_CREDIT_UNITS.usdMicroCent.displayUnit,
    unitToUsd: COHUB_BILLING_CREDIT_UNITS.usdMicroCent.unitToUsd,
    unitsPerUsd: COHUB_BILLING_CREDIT_UNITS.usdMicroCent.unitsPerUsd,
    usdDecimalPlaces: COHUB_BILLING_CREDIT_UNITS.usdMicroCent.usdDecimalPlaces,
  };
}

function amountToUsd(amount: number, tokenType: string): number {
  const unit = getCreditUnit(tokenType);
  return roundUsd(amount * unit.unitToUsd, unit.usdDecimalPlaces);
}

function usdToAmount(amountUsd: number, tokenType: string): number {
  const unit = getCreditUnit(tokenType);
  const roundedUsd = roundUsd(amountUsd, unit.usdDecimalPlaces);
  if (roundedUsd <= 0) return 0;
  return Math.round(roundedUsd * unit.unitsPerUsd);
}

function mapCreditBalance(
  summary: BillingCreditBalance["raw"],
): BillingCreditBalance {
  return {
    tokenType: summary.token_type,
    availableBalance: summary.available_balance,
    openOverageBalance: summary.open_overage_balance,
    netBalance: summary.net_balance,
    raw: summary,
  };
}

function mergeFeatureMetadata(
  current: BillingFeatureEntitlement["metadata"],
  next: BillingFeatureEntitlement["metadata"],
): BillingFeatureEntitlement["metadata"] {
  const merged = { ...current };
  for (const [key, value] of Object.entries(next)) {
    const existing = merged[key];
    if (typeof value === "boolean") {
      merged[key] = existing === true || value;
      continue;
    }
    if (typeof value === "number") {
      merged[key] =
        typeof existing === "number" ? Math.max(existing, value) : value;
      continue;
    }
    if (existing === undefined) {
      merged[key] = value;
    }
  }
  return merged;
}

function mapFeatureEntitlements(
  activeBenefits: BillingFeatureEntitlement["grants"],
): BillingFeatureEntitlement[] {
  const byKey = new Map<string, BillingFeatureEntitlement>();
  for (const benefit of activeBenefits) {
    const metadata = benefit.config.metadata ?? {};
    const enabled = metadata.enabled !== false;
    const existing = byKey.get(benefit.benefit_key);
    if (existing) {
      existing.enabled = existing.enabled || enabled;
      existing.metadata = mergeFeatureMetadata(existing.metadata, metadata);
      existing.grants.push(benefit);
      continue;
    }
    byKey.set(benefit.benefit_key, {
      key: benefit.benefit_key,
      enabled,
      metadata: { ...metadata },
      grants: [benefit],
    });
  }
  return [...byKey.values()];
}

async function getCustomerStateOrEmpty(input: {
  sdk: ConfiguredBillingSdk;
  businessKey: string;
  userId: string;
}): Promise<BillingAccountState | null> {
  try {
    const state = await input.sdk.admin.customers.getState({
      external_user_id: input.userId,
      business_key: input.businessKey,
    });
    return {
      userId: input.userId,
      credits: state.credits.map(mapCreditBalance),
      entitlements: mapFeatureEntitlements(state.active_benefits),
    };
  } catch (error) {
    if (!isNotFound(error)) throw error;
    return null;
  }
}

async function getCustomerCreditsOrEmpty(input: {
  sdk: ConfiguredBillingSdk;
  businessKey: string;
  userId: string;
}): Promise<(BillingUserRef & { credits: BillingCreditBalance[] }) | null> {
  try {
    const credits = await input.sdk.admin.customers.getCredits({
      external_user_id: input.userId,
      business_key: input.businessKey,
    });
    return {
      userId: input.userId,
      credits: credits.credits.map(mapCreditBalance),
    };
  } catch (error) {
    if (!isNotFound(error)) throw error;
    return null;
  }
}

async function getCustomerEntitlementsOrEmpty(input: {
  sdk: ConfiguredBillingSdk;
  businessKey: string;
  userId: string;
}): Promise<
  (BillingUserRef & { entitlements: BillingFeatureEntitlement[] }) | null
> {
  try {
    const entitlements = await input.sdk.admin.customers.getEntitlements({
      external_user_id: input.userId,
      business_key: input.businessKey,
    });
    return {
      userId: input.userId,
      entitlements: mapFeatureEntitlements(entitlements.active_benefits),
    };
  } catch (error) {
    if (!isNotFound(error)) throw error;
    return null;
  }
}

function findBalance(
  credits: BillingCreditBalance[],
  tokenType: string,
): BillingCreditBalance | null {
  return credits.find((credit) => credit.tokenType === tokenType) ?? null;
}

function daysUntil(
  expiresAt: string | null | undefined,
  now = new Date(),
): number | null {
  if (!expiresAt) return null;
  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime())) return null;
  return Math.ceil((expires.getTime() - now.getTime()) / 86_400_000);
}

function getExpiryGroupKey(
  daysRemaining: number | null,
): BillingCreditExpiryGroup["key"] {
  if (daysRemaining === null) return "never";
  if (daysRemaining <= 0) return "expired";
  if (daysRemaining <= 7) return "lt_7d";
  if (daysRemaining <= 30) return "lt_30d";
  return "gte_30d";
}

function getExpiryGroupLabel(key: BillingCreditExpiryGroup["key"]): string {
  switch (key) {
    case "expired":
      return "Expired";
    case "lt_7d":
      return "Expires within 7 days";
    case "lt_30d":
      return "Expires within 30 days";
    case "gte_30d":
      return "Expires after 30 days";
    case "never":
      return "No expiration";
  }
}

function humanizeIdentifier(value: string): string {
  return value
    .split(/[_\s.-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function resolveCreditGrantBenefitName(grant: CreditGrant): string | null {
  const benefitName = grant.benefit_name?.trim();
  if (benefitName) return benefitName;
  const benefitKey = grant.benefit_key?.trim();
  if (!benefitKey) return null;
  return (
    CREDIT_BENEFIT_DISPLAY_NAMES[benefitKey] ?? humanizeIdentifier(benefitKey)
  );
}

function optionalAmount(value: number | undefined, tokenType: string) {
  if (typeof value !== "number") return { amount: null, amountUsd: null };
  return {
    amount: normalizeAmount(value),
    amountUsd: amountToUsd(value, tokenType),
  };
}

function getCreditGrantUnavailableReasons(
  grant: CreditGrant,
): string[] {
  return Array.isArray(grant.unavailable_reasons)
    ? grant.unavailable_reasons
    : [];
}

function isCreditGrantDisplayable(grant: CreditGrant): boolean {
  if (grant.available_now !== false) return true;
  const reasons = getCreditGrantUnavailableReasons(grant);
  return reasons.length > 0 && reasons.every((reason) => reason === "depleted");
}

function mapCreditGrant(
  grant: CreditGrant,
  now = new Date(),
): BillingCreditGrantStatus {
  const daysRemaining = daysUntil(grant.expires_at ?? null, now);
  const consumed = optionalAmount(grant.consumed_amount, grant.token_type);
  const usageConsumed = optionalAmount(
    grant.usage_consumed_amount,
    grant.token_type,
  );
  const settledOverage = optionalAmount(
    grant.settled_overage_amount,
    grant.token_type,
  );
  const originalAmount =
    typeof grant.original_amount === "number"
      ? normalizeAmount(grant.original_amount)
      : null;
  const originalAmountUsd =
    typeof grant.original_amount === "number"
      ? amountToUsd(grant.original_amount, grant.token_type)
      : null;
  const consumedPercent =
    originalAmount && consumed.amount !== null
      ? Math.min(
          100,
          Math.max(
            0,
            Number(((consumed.amount / originalAmount) * 100).toFixed(1)),
          ),
        )
      : null;
  return {
    id: grant.id,
    tokenType: grant.token_type,
    benefitKey: grant.benefit_key ?? null,
    benefitName: resolveCreditGrantBenefitName(grant),
    grantKind: grant.grant_kind ?? null,
    sourceType: grant.source_type ?? null,
    sourceId: grant.source_id ?? null,
    status: grant.status,
    availableNow: grant.available_now ?? null,
    unavailableReasons: getCreditGrantUnavailableReasons(grant),
    remainingAmount: normalizeAmount(grant.remaining_amount),
    remainingAmountUsd: amountToUsd(grant.remaining_amount, grant.token_type),
    originalAmount,
    originalAmountUsd,
    consumedAmount: consumed.amount,
    consumedAmountUsd: consumed.amountUsd,
    usageConsumedAmount: usageConsumed.amount,
    usageConsumedAmountUsd: usageConsumed.amountUsd,
    settledOverageAmount: settledOverage.amount,
    settledOverageAmountUsd: settledOverage.amountUsd,
    consumedPercent,
    effectiveAt: grant.effective_at ?? null,
    expiresAt: grant.expires_at ?? null,
    daysRemaining,
    createdAt: grant.created_at,
  };
}

function createdAtDesc(
  left: BillingCreditGrantStatus,
  right: BillingCreditGrantStatus,
): number {
  const leftTime = Date.parse(left.createdAt);
  const rightTime = Date.parse(right.createdAt);
  const leftValue = Number.isNaN(leftTime) ? 0 : leftTime;
  const rightValue = Number.isNaN(rightTime) ? 0 : rightTime;
  return rightValue - leftValue;
}

function groupCreditGrants(
  grants: BillingCreditGrantStatus[],
): BillingCreditExpiryGroup[] {
  const orderedKeys: BillingCreditExpiryGroup["key"][] = [
    "lt_7d",
    "lt_30d",
    "gte_30d",
    "never",
    "expired",
  ];
  const byKey = new Map<
    BillingCreditExpiryGroup["key"],
    BillingCreditExpiryGroup
  >();
  for (const key of orderedKeys) {
    byKey.set(key, {
      key,
      label: getExpiryGroupLabel(key),
      remainingAmountUsd: 0,
      grants: [],
    });
  }
  for (const grant of grants) {
    const key = getExpiryGroupKey(grant.daysRemaining);
    const group = byKey.get(key);
    if (!group) continue;
    group.remainingAmountUsd = normalizeAmount(
      group.remainingAmountUsd + grant.remainingAmountUsd,
    );
    group.grants.push(grant);
  }
  for (const group of byKey.values()) {
    group.grants.sort(createdAtDesc);
  }
  return orderedKeys
    .map((key) => byKey.get(key))
    .filter(
      (group): group is BillingCreditExpiryGroup =>
        !!group && group.grants.length > 0,
    );
}

function mapUsageOverage(overage: UsageOverage): BillingOpenOverageStatus {
  return {
    id: overage.id,
    tokenType: overage.token_type,
    usageType: overage.usage_type ?? null,
    sourceType: overage.source_type,
    sourceId: overage.source_id,
    operationId: overage.operation_id,
    originalAmountUsd: amountToUsd(overage.original_amount, overage.token_type),
    remainingAmountUsd: amountToUsd(
      overage.remaining_amount,
      overage.token_type,
    ),
    settledAmountUsd: amountToUsd(overage.settled_amount, overage.token_type),
    status: overage.status,
    reason: overage.reason ?? null,
    createdAt: overage.created_at,
  };
}

function mapUsageRecord(
  transaction: CreditTransaction,
): BillingUsageRecordStatus {
  return {
    id: transaction.id,
    tokenType: transaction.token_type,
    usageType: transaction.usage_type ?? null,
    sourceType: transaction.source_type ?? null,
    sourceId: transaction.source_id ?? null,
    operationId: transaction.operation_id ?? null,
    amount: normalizeAmount(transaction.amount),
    amountUsd: amountToUsd(transaction.amount, transaction.token_type),
    reason: transaction.reason ?? null,
    createdAt: transaction.created_at,
  };
}

function minorAmountToUsd(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Number((amount / 100).toFixed(2));
}

function normalizeBillingPage(value: number | undefined): number {
  return Math.max(1, Math.floor(value ?? 1));
}

function normalizeBillingLimit(value: number | undefined): number {
  return Math.min(10, Math.max(1, Math.floor(value ?? 10)));
}

function billingApiError(
  statusCode: number,
  message: string,
  code?: string,
): ApiError {
  return new ApiError({
    status: statusCode,
    message,
    code,
    responseBody: { message, code },
  });
}

function getCheckoutUnavailableReason(
  checkout: OrderCheckout | SubscriptionCheckout | undefined,
): string | null {
  if (checkout?.checkout_usable === true && checkout.checkout_url) return null;
  return checkout?.message ?? null;
}

function isProviderBackedSubscriptionCheckout(
  checkout: SubscriptionCheckout | undefined,
): boolean {
  return optionalString(checkout?.provider_key) !== null;
}

function mapOrderStatus(
  order: Order,
  checkout?: OrderCheckout,
): BillingOrderStatus {
  const canPay =
    order.status === "pending_checkout" &&
    checkout?.checkout_usable === true &&
    !!checkout.checkout_url;
  return {
    id: order.id,
    externalUserId: order.external_user_id,
    productKey: order.product_key_snapshot,
    productName: order.product_name_snapshot,
    subscriptionId: order.subscription_id,
    status: order.status,
    billingReason: order.billing_reason,
    amountMinor: order.amount_snapshot,
    amountUsd: minorAmountToUsd(order.amount_snapshot),
    paidAmountMinor: order.paid_amount_snapshot,
    paidAmountUsd: minorAmountToUsd(order.paid_amount_snapshot),
    currency: order.currency_snapshot,
    refundedAmountMinor: order.refunded_amount,
    refundedAmountUsd: minorAmountToUsd(order.refunded_amount),
    fulfillmentSource: order.fulfillment_source,
    checkoutExpiresAt: order.checkout_expires_at ?? null,
    paidAt: order.paid_at,
    checkoutCanceledAt: order.checkout_canceled_at,
    checkoutExpiredAt: order.checkout_expired_at,
    paymentConflictedAt: order.payment_conflicted_at,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    providerStatus:
      checkout?.order_status ?? checkout?.provider_request_status ?? null,
    checkoutStatus: checkout?.status ?? null,
    actions: {
      canPay,
      checkoutUrl: canPay ? (checkout?.checkout_url ?? null) : null,
      checkoutUsable: canPay,
      canCancelCheckout: order.status === "pending_checkout",
      canCancelAutoRenew: false,
      unavailableReason: canPay ? null : getCheckoutUnavailableReason(checkout),
    },
  };
}

function mapSubscriptionHistoryStatus(
  subscription: Subscription,
  checkout?: SubscriptionCheckout,
): BillingSubscriptionHistoryStatus {
  const providerStatus =
    checkout?.subscription_status ?? checkout?.provider_request_status ?? null;
  const canPay =
    subscription.status === "pending_checkout" &&
    checkout?.checkout_usable === true &&
    !!checkout.checkout_url;
  const canCancelAutoRenew =
    BILLING_AUTO_RENEW_CANCELABLE_SUBSCRIPTION_STATUSES.includes(
      subscription.status as (typeof BILLING_AUTO_RENEW_CANCELABLE_SUBSCRIPTION_STATUSES)[number],
    ) &&
    subscription.cancel_at_period_end === false &&
    subscription.current_period_end !== null &&
    isProviderBackedSubscriptionCheckout(checkout);
  return {
    id: subscription.id,
    externalUserId: subscription.external_user_id,
    productKey: subscription.product_key_snapshot,
    productName: subscription.product_name_snapshot,
    status: subscription.status,
    amountMinor: subscription.amount_snapshot,
    amountUsd: minorAmountToUsd(subscription.amount_snapshot),
    paidAmountMinor: subscription.paid_amount_snapshot,
    paidAmountUsd: minorAmountToUsd(subscription.paid_amount_snapshot),
    currency: subscription.currency_snapshot,
    billingPeriod: subscription.billing_period_snapshot,
    billingIntervalCount: subscription.billing_interval_count_snapshot,
    currentPeriodStart: subscription.current_period_start,
    currentPeriodEnd: subscription.current_period_end,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    canceledAt: subscription.canceled_at,
    checkoutExpiresAt: subscription.checkout_expires_at,
    checkoutCanceledAt: subscription.checkout_canceled_at,
    checkoutExpiredAt: subscription.checkout_expired_at,
    paymentConflictedAt: subscription.payment_conflicted_at,
    endedAt: subscription.ended_at,
    createdAt: subscription.created_at,
    updatedAt: subscription.updated_at,
    providerStatus,
    providerTerminal: false,
    checkoutStatus: checkout?.status ?? null,
    actions: {
      canPay,
      checkoutUrl: canPay ? (checkout?.checkout_url ?? null) : null,
      checkoutUsable: canPay,
      canCancelCheckout: subscription.status === "pending_checkout",
      canCancelAutoRenew,
      unavailableReason: canPay ? null : getCheckoutUnavailableReason(checkout),
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  );
}

function uniqueStringArray(value: unknown): string[] {
  return [
    ...new Set(
      stringArray(value)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getProductInterval(
  product: Product,
): BillingCatalogProduct["interval"] {
  if (product.billing_type === "one_time") return "one_time";
  if (
    product.billing_type !== "recurring" ||
    product.billing_period !== "month"
  )
    return "other";
  switch (product.billing_interval_count) {
    case 1:
      return "monthly";
    case 3:
      return "quarterly";
    case 12:
      return "yearly";
    default:
      return "other";
  }
}

function isCreditsBenefit(benefit: Benefit): benefit is CreditsBenefit {
  return benefit.type === "credits";
}

function isProductCreditsBenefit(
  product: Product,
  benefit: CreditsBenefit,
): boolean {
  const grantKind =
    product.billing_type === "recurring" ? "plan_period" : "purchased";
  if (benefit.config.grant_kind !== grantKind) return false;
  const meta = asRecord(product.meta) ?? {};
  const display = asRecord(meta.display) ?? {};
  const configuredKeys = uniqueStringArray(
    display.credit_benefit_keys ??
      display.creditBenefitKeys ??
      meta.credit_benefit_keys,
  );
  if (configuredKeys.length > 0) return configuredKeys.includes(benefit.key);
  const productKey = product.key.toLowerCase();
  const benefitKey = benefit.key.toLowerCase();
  const exactKeys = new Set([
    `${productKey}_credits`,
    `${productKey}_benefit`,
    `${productKey}_credits_benefit`,
  ]);
  if (exactKeys.has(benefitKey)) return true;
  return (
    benefitKey.startsWith(`${productKey}_`) && benefitKey.includes("credit")
  );
}

function mapProductCreditBenefit(
  product: Product,
  benefit: CreditsBenefit,
): BillingProductCreditBenefit {
  const cycleAmount = benefit.config.amount;
  const multiplier =
    benefit.config.grant_kind === "plan_period"
      ? Math.max(1, product.billing_interval_count)
      : 1;
  const periodAmount = cycleAmount * multiplier;
  return {
    key: benefit.key,
    name: benefit.name,
    tokenType: benefit.config.token_type,
    grantKind: benefit.config.grant_kind,
    scope: benefit.config.scope,
    cycleAmount,
    cycleAmountUsd: amountToUsd(cycleAmount, benefit.config.token_type),
    periodAmount,
    periodAmountUsd: amountToUsd(periodAmount, benefit.config.token_type),
    expiresInDays:
      "expires_in_days" in benefit.config
        ? (benefit.config.expires_in_days ?? null)
        : null,
  };
}

function mapCatalogProduct(
  product: Product,
  defaultPlanProductKey: string | null,
  creditBenefits: CreditsBenefit[],
): BillingCatalogProduct {
  const meta = asRecord(product.meta) ?? {};
  const pricing = asRecord(meta.pricing) ?? {};
  const display = asRecord(meta.display) ?? {};
  const compareAtAmountMinor =
    optionalNumber(pricing.compare_at_amount_minor) ??
    optionalNumber(pricing.compare_at_amount) ??
    null;
  const productCreditBenefits = creditBenefits
    .filter((benefit) => isProductCreditsBenefit(product, benefit))
    .map((benefit) => mapProductCreditBenefit(product, benefit));
  const creditsAmount =
    productCreditBenefits.length > 0
      ? productCreditBenefits.reduce(
          (sum, benefit) => sum + benefit.periodAmount,
          0,
        )
      : null;
  return {
    id: product.id,
    key: product.key,
    name: product.name,
    description: product.description,
    status: product.status,
    visibility: product.visibility,
    billingType: product.billing_type,
    billingPeriod: product.billing_period,
    billingIntervalCount: product.billing_interval_count,
    currency: product.currency,
    kind: product.billing_type === "recurring" ? "plan" : "addon",
    interval: getProductInterval(product),
    pricing: {
      amountMinor: product.amount,
      amountUsd: minorAmountToUsd(product.amount),
      compareAtAmountMinor,
      compareAtAmountUsd:
        compareAtAmountMinor === null
          ? null
          : minorAmountToUsd(compareAtAmountMinor),
      discountLabel: optionalString(pricing.discount_label),
      discountRate: optionalNumber(pricing.discount_rate),
    },
    display: {
      description: optionalString(display.description) ?? product.description,
      benefits: stringArray(display.benefits),
      creditsAmount,
      validity:
        optionalString(display.validity) ?? optionalString(meta.validity),
      creditBenefits: productCreditBenefits,
    },
    isDefaultPlan: product.key === defaultPlanProductKey,
  };
}

function mapSubscriptionSummary(subscription: Subscription) {
  return {
    id: subscription.id,
    productKey: subscription.product_key_snapshot ?? null,
    productName: subscription.product_name_snapshot ?? null,
    status: subscription.status,
    currentPeriodStart: subscription.current_period_start,
    currentPeriodEnd: subscription.current_period_end,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  };
}

function isSubscriptionExpiredAfterCancel(
  subscription: Subscription,
  now = new Date(),
): boolean {
  if (!subscription.cancel_at_period_end || !subscription.current_period_end)
    return false;
  const currentPeriodEnd = Date.parse(subscription.current_period_end);
  return !Number.isNaN(currentPeriodEnd) && currentPeriodEnd <= now.getTime();
}

async function resolvePaymentStatus(sdk: ConfiguredBillingSdk) {
  try {
    const response = await sdk.admin.providers.status();
    if (response.status !== "available" || !response.checkout_available) {
      return {
        available: false,
        reason:
          response.active_provider_key === "not_configured"
            ? "No active payment provider"
            : "Checkout is currently unavailable",
      };
    }
    return { available: true, reason: null };
  } catch (error) {
    return {
      available: false,
      reason:
        error instanceof Error
          ? error.message
          : "Provider status query failed",
    };
  }
}

function checkoutResultFromOrder(input: {
  userId: string;
  productKey: string;
  response: CreateOrderResponse;
  status: BillingPluginStatus;
  reused?: boolean;
}): BillingCheckoutResult {
  const checkout = input.response.checkout;
  const checkoutUsable =
    checkout?.checkout_usable === true && !!checkout.checkout_url;
  return {
    userId: input.userId,
    billing: input.status,
    payment: {
      available: checkoutUsable,
      reason: checkoutUsable
        ? null
        : (checkout?.message ?? "Checkout is not currently usable"),
    },
    productKey: input.productKey,
    checkoutUrl: checkout?.checkout_url ?? null,
    checkoutUsable,
    message: checkout?.message ?? null,
    orderId: input.response.order.id,
    subscriptionId: input.response.order.subscription_id,
    reused: input.reused === true,
  };
}

function checkoutResultFromSubscription(input: {
  userId: string;
  productKey: string;
  response: CreateSubscriptionResponse;
  status: BillingPluginStatus;
}): BillingCheckoutResult {
  const checkout = input.response.checkout;
  const checkoutUsable =
    checkout?.checkout_usable === true && !!checkout.checkout_url;
  return {
    userId: input.userId,
    billing: input.status,
    payment: {
      available: checkoutUsable,
      reason: checkoutUsable
        ? null
        : (checkout?.message ?? "Checkout is not currently usable"),
    },
    productKey: input.productKey,
    checkoutUrl: checkout?.checkout_url ?? null,
    checkoutUsable,
    message: checkout?.message ?? null,
    orderId: null,
    subscriptionId: input.response.subscription.id,
    reused: input.response.reused === true,
  };
}

function checkoutRedirects(returnUrl: string | undefined) {
  const resolved =
    returnUrl && /^https?:\/\//i.test(returnUrl) ? returnUrl : undefined;
  return {
    success_redirect_url: resolved,
    failed_redirect_url: resolved,
    cancel_redirect_url: resolved,
  };
}

async function withRedisCheckoutLock<T>(
  key: string,
  run: () => Promise<T>,
): Promise<T> {
  const lockKey = `billing:checkout:lock:${key}`;
  const lockValue = randomUUID();
  for (let attempt = 0; attempt < CHECKOUT_LOCK_RETRY_COUNT; attempt += 1) {
    const locked = await redisCommandClient
      .set(lockKey, lockValue, "PX", CHECKOUT_LOCK_TTL_MS, "NX")
      .catch(() => null);
    if (locked === "OK") {
      try {
        return await run();
      } finally {
        await redisCommandClient
          .eval(
            "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
            1,
            lockKey,
            lockValue,
          )
          .catch(() => undefined);
      }
    }
    await sleep(CHECKOUT_LOCK_RETRY_DELAY_MS);
  }
  return run();
}

function emptyCreditStatus(input: {
  userId: string;
  tokenType: string;
  status: BillingPluginStatus;
}): BillingCreditStatus {
  const unit = getCreditUnit(input.tokenType);
  return {
    userId: input.userId,
    billing: input.status,
    tokenType: input.tokenType,
    unit,
    balance: {
      availableUsd: 0,
      openOverageUsd: 0,
      netUsd: 0,
    },
    overage: {
      hasOpenOverage: false,
      openAmountUsd: 0,
      items: [],
    },
    groups: [],
  };
}

function emptyUsageRecordList(input: {
  userId: string;
  tokenType: string;
  status: BillingPluginStatus;
  page: number;
  limit: number;
}): BillingUsageRecordList {
  return {
    userId: input.userId,
    billing: input.status,
    tokenType: input.tokenType,
    unit: getCreditUnit(input.tokenType),
    page: input.page,
    limit: input.limit,
    items: [],
    pagination: {
      maxPage: 0,
      totalCount: 0,
    },
  };
}

function emptyOpenOverageList(input: {
  userId: string;
  tokenType: string;
  status: BillingPluginStatus;
  page: number;
  limit: number;
}): BillingOpenOverageList {
  return {
    userId: input.userId,
    billing: input.status,
    tokenType: input.tokenType,
    unit: getCreditUnit(input.tokenType),
    page: input.page,
    limit: input.limit,
    items: [],
    pagination: {
      maxPage: 0,
      totalCount: 0,
    },
  };
}

function emptyCatalog(input: {
  userId: string;
  status: BillingPluginStatus;
  paymentReason: string | null;
}): BillingCatalog {
  return {
    userId: input.userId,
    billing: input.status,
    payment: {
      available: false,
      reason: input.paymentReason,
    },
    products: [],
    plans: [],
    addons: [],
    currentSubscriptions: [],
    hasActiveSubscription: false,
    defaultPlanProductKey: null,
  };
}

function emptyOrderList(input: {
  userId: string;
  status: BillingPluginStatus;
  page: number;
  limit: number;
}): BillingOrderList {
  return {
    userId: input.userId,
    billing: input.status,
    page: input.page,
    limit: input.limit,
    items: [],
    pagination: {
      maxPage: 0,
      totalCount: 0,
    },
  };
}

function emptySubscriptionHistoryList(input: {
  userId: string;
  status: BillingPluginStatus;
  page: number;
  limit: number;
}): BillingSubscriptionHistoryList {
  return {
    userId: input.userId,
    billing: input.status,
    page: input.page,
    limit: input.limit,
    items: [],
    pagination: {
      maxPage: 0,
      totalCount: 0,
    },
  };
}

function disabledCheckoutResult(input: {
  userId: string;
  productKey: string;
  status: BillingPluginStatus;
  reason: string | null;
}): BillingCheckoutResult {
  return {
    userId: input.userId,
    billing: input.status,
    payment: {
      available: false,
      reason: input.reason,
    },
    productKey: input.productKey,
    checkoutUrl: null,
    checkoutUsable: false,
    message: input.reason,
    orderId: null,
    subscriptionId: null,
    reused: false,
  };
}

function disabledRedemptionResult(input: {
  userId: string;
  status: BillingPluginStatus;
  reason: string | null;
}): BillingRedemptionResult {
  return {
    userId: input.userId,
    billing: input.status,
    redeemed: false,
    message: input.reason,
    redemptionRecordId: null,
    itemCount: 0,
  };
}

function checkFeatureLimitFromEntitlement(input: {
  entitlement: BillingFeatureEntitlement | null;
  quantity: number;
  metadataKey: string;
  fallbackLimit?: number;
  missingEntitlementPolicy?: "allow" | "deny";
}): BillingFeatureLimitCheck {
  const unlimited = input.entitlement?.metadata.unlimited === true;
  const rawLimit = input.entitlement?.metadata[input.metadataKey];
  const entitlementLimit =
    typeof rawLimit === "number" && Number.isFinite(rawLimit) ? rawLimit : null;
  const limit = unlimited
    ? null
    : (entitlementLimit ?? input.fallbackLimit ?? null);
  const allowed =
    input.entitlement === null && limit === null
      ? input.missingEntitlementPolicy !== "deny"
      : unlimited || (limit !== null && input.quantity <= limit);
  return {
    allowed,
    quantity: input.quantity,
    limit,
    unlimited,
    entitlement: input.entitlement,
  };
}

export function createDisabledBillingOperations(
  reason = "billing configuration is missing",
): BillingOperations {
  const status: BillingPluginStatus = {
    provider: "disabled",
    configured: false,
    reason,
  };
  return {
    status,

    async ensureCustomer(input: BillingUserRef): Promise<BillingUserRef> {
      return input;
    },

    async getState(input: BillingUserRef): Promise<BillingAccountState> {
      return { userId: input.userId, credits: [], entitlements: [] };
    },

    async getCreditStatus(
      input: BillingUserRef & { tokenType?: string },
    ): Promise<BillingCreditStatus> {
      const tokenType =
        input.tokenType ?? COHUB_BILLING_TOKEN_TYPES.usdMicroCent;
      return emptyCreditStatus({ userId: input.userId, tokenType, status });
    },

    async listOpenOverages(
      input: BillingOpenOverageListInput,
    ): Promise<BillingOpenOverageList> {
      const tokenType =
        input.tokenType ?? COHUB_BILLING_TOKEN_TYPES.usdMicroCent;
      return emptyOpenOverageList({
        userId: input.userId,
        tokenType,
        status,
        page: input.page ?? 1,
        limit: input.limit ?? 10,
      });
    },

    async getCatalog(input?: BillingUserRef): Promise<BillingCatalog> {
      return emptyCatalog({
        userId: input?.userId ?? "anonymous",
        status,
        paymentReason: status.reason ?? "Billing integration is not configured",
      });
    },

    async listOrders(
      input: BillingHistoryListInput,
    ): Promise<BillingOrderList> {
      return emptyOrderList({
        userId: input.userId,
        status,
        page: input.page ?? 1,
        limit: input.limit ?? 10,
      });
    },

    async listSubscriptions(
      input: BillingHistoryListInput,
    ): Promise<BillingSubscriptionHistoryList> {
      return emptySubscriptionHistoryList({
        userId: input.userId,
        status,
        page: input.page ?? 1,
        limit: input.limit ?? 10,
      });
    },

    async purchaseAddon(
      input: BillingCheckoutInput,
    ): Promise<BillingCheckoutResult> {
      return disabledCheckoutResult({
        userId: input.userId,
        productKey: input.productKey,
        status,
        reason: status.reason ?? "Billing integration is not configured",
      });
    },

    async createSubscription(
      input: BillingCheckoutInput,
    ): Promise<BillingCheckoutResult> {
      return disabledCheckoutResult({
        userId: input.userId,
        productKey: input.productKey,
        status,
        reason: status.reason ?? "Billing integration is not configured",
      });
    },

    async cancelOrderCheckout(): Promise<BillingOrderStatus> {
      throw billingApiError(
        503,
        status.reason ?? "Billing integration is not configured",
        "billing_unavailable",
      );
    },

    async cancelSubscriptionCheckout(): Promise<BillingSubscriptionHistoryStatus> {
      throw billingApiError(
        503,
        status.reason ?? "Billing integration is not configured",
        "billing_unavailable",
      );
    },

    async cancelSubscriptionAutoRenew(): Promise<BillingSubscriptionHistoryStatus> {
      throw billingApiError(
        503,
        status.reason ?? "Billing integration is not configured",
        "billing_unavailable",
      );
    },

    async redeemCode(
      input: BillingRedemptionInput,
    ): Promise<BillingRedemptionResult> {
      return disabledRedemptionResult({
        userId: input.userId,
        status,
        reason: status.reason ?? "Billing integration is not configured",
      });
    },

    async preflightUsage(
      input: BillingUsagePreflightInput,
    ): Promise<BillingUsagePreflight> {
      const tokenType =
        input.tokenType ?? COHUB_BILLING_TOKEN_TYPES.usdMicroCent;
      return {
        allowed: true,
        tokenType,
        estimatedAmountUsd: roundUsd(
          input.estimatedAmountUsd,
          getCreditUnit(tokenType).usdDecimalPlaces,
        ),
        availableBalance: 0,
        netBalance: 0,
        shortfall: 0,
      };
    },

    async recordUsage(
      input: BillingUsageRecordInput,
    ): Promise<BillingUsageRecordResult> {
      const tokenType =
        input.tokenType ?? COHUB_BILLING_TOKEN_TYPES.usdMicroCent;
      return {
        tokenType,
        amountUsd: roundUsd(
          input.amountUsd,
          getCreditUnit(tokenType).usdDecimalPlaces,
        ),
        status: "disabled",
        response: null,
      };
    },

    async listUsageRecords(
      input: BillingUsageRecordListInput,
    ): Promise<BillingUsageRecordList> {
      const tokenType =
        input.tokenType ?? COHUB_BILLING_TOKEN_TYPES.usdMicroCent;
      return emptyUsageRecordList({
        userId: input.userId,
        tokenType,
        status,
        page: input.page ?? 1,
        limit: input.limit ?? 10,
      });
    },

    async getFeatureEntitlement(): Promise<BillingFeatureEntitlement | null> {
      return null;
    },

    async checkFeatureLimit(
      input: BillingFeatureLimitInput,
    ): Promise<BillingFeatureLimitCheck> {
      const limit = input.fallbackLimit ?? null;
      const allowed =
        limit === null
          ? input.missingEntitlementPolicy !== "deny"
          : input.quantity <= limit;
      return {
        allowed,
        quantity: input.quantity,
        limit,
        unlimited: limit === null,
        entitlement: null,
      };
    },
  };
}

export function createTalesofaiBillingOperations(
  clientConfig: BillingClientConfig,
): BillingOperations {
  const sdk = createConfiguredSdk(clientConfig);
  const businessKey = clientConfig.businessKey;
  const status: BillingPluginStatus = {
    provider: "talesofai",
    configured: true,
  };
  const ensuredCustomers = new Map<
    string,
    { value: BillingUserRef; expiresAt: number }
  >();
  const inflightEnsures = new Map<string, Promise<BillingUserRef>>();
  const inflightCheckouts = new Map<string, Promise<BillingCheckoutResult>>();

  const runCheckoutSingleflight = (
    input: { kind: "addon" | "plan"; userId: string; productKey: string },
    run: () => Promise<BillingCheckoutResult>,
  ): Promise<BillingCheckoutResult> => {
    const key = `${businessKey}:${input.kind}:${input.userId}:${input.productKey}`;
    const inflight = inflightCheckouts.get(key);
    if (inflight) return inflight;
    const promise = withRedisCheckoutLock(key, run).finally(() => {
      inflightCheckouts.delete(key);
    });
    inflightCheckouts.set(key, promise);
    return promise;
  };

  const cacheEnsuredCustomer = (input: BillingUserRef) => {
    ensuredCustomers.set(input.userId, {
      value: input,
      expiresAt: Date.now() + ENSURE_CUSTOMER_CACHE_TTL_MS,
    });
  };

  const forgetEnsuredCustomer = (userId: string) => {
    ensuredCustomers.delete(userId);
  };

  const ensureCustomer = async (
    input: BillingUserRef,
  ): Promise<BillingUserRef> => {
    const cached = ensuredCustomers.get(input.userId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const inflight = inflightEnsures.get(input.userId);
    if (inflight) return inflight;

    const promise = (async () => {
      try {
        const customer = await sdk.admin.customers.create({
          external_user_id: input.userId,
          status: "active",
        });
        const value = { userId: customer.external_user_id };
        cacheEnsuredCustomer(value);
        return value;
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 409) throw error;
        const customer = await sdk.admin.customers.get({
          external_user_id: input.userId,
        });
        const value = { userId: customer.external_user_id };
        cacheEnsuredCustomer(value);
        return value;
      }
    })();

    inflightEnsures.set(input.userId, promise);
    try {
      return await promise;
    } finally {
      inflightEnsures.delete(input.userId);
    }
  };

  const getStateAfterEnsure = async (
    userId: string,
  ): Promise<BillingAccountState> => {
    await ensureCustomer({ userId });
    const state = await getCustomerStateOrEmpty({ sdk, businessKey, userId });
    if (state) return state;

    forgetEnsuredCustomer(userId);
    await ensureCustomer({ userId });
    return (
      (await getCustomerStateOrEmpty({ sdk, businessKey, userId })) ?? {
        userId,
        credits: [],
        entitlements: [],
      }
    );
  };

  const getCreditsAfterEnsure = async (
    userId: string,
  ): Promise<BillingUserRef & { credits: BillingCreditBalance[] }> => {
    await ensureCustomer({ userId });
    const state = await getCustomerCreditsOrEmpty({ sdk, businessKey, userId });
    if (state) return state;

    forgetEnsuredCustomer(userId);
    await ensureCustomer({ userId });
    return (
      (await getCustomerCreditsOrEmpty({ sdk, businessKey, userId })) ?? {
        userId,
        credits: [],
      }
    );
  };

  const getEntitlementsAfterEnsure = async (
    userId: string,
  ): Promise<
    BillingUserRef & { entitlements: BillingFeatureEntitlement[] }
  > => {
    await ensureCustomer({ userId });
    const state = await getCustomerEntitlementsOrEmpty({
      sdk,
      businessKey,
      userId,
    });
    if (state) return state;

    forgetEnsuredCustomer(userId);
    await ensureCustomer({ userId });
    return (
      (await getCustomerEntitlementsOrEmpty({ sdk, businessKey, userId })) ?? {
        userId,
        entitlements: [],
      }
    );
  };

  const getFeatureEntitlement = async (input: {
    userId: string;
    featureKey: string;
  }): Promise<BillingFeatureEntitlement | null> => {
    const state = await getEntitlementsAfterEnsure(input.userId);
    return (
      state.entitlements.find(
        (entitlement) =>
          entitlement.key === input.featureKey && entitlement.enabled,
      ) ?? null
    );
  };

  const listAllPages = async <T>(
    fetchPage: (page: number, limit: number) => Promise<BillingListPage<T>>,
  ): Promise<T[]> => {
    const items: T[] = [];
    for (let page = 1; page <= CREDIT_LIST_MAX_PAGES; page += 1) {
      const response = await fetchPage(page, CREDIT_LIST_PAGE_LIMIT);
      items.push(...response.items);
      if (page >= response.pagination.max_page) break;
    }
    return items;
  };

  const listAllCreditGrants = async (input: {
    userId: string;
    tokenType: string;
    status?: CreditGrantDisplayStatus | "revoked";
  }): Promise<CreditGrant[]> =>
    listAllPages((page, limit) =>
      sdk.admin.credits.listGrants({
        business_key: businessKey,
        external_user_id: input.userId,
        token_type: input.tokenType,
        status: input.status,
        page,
        limit,
      }),
    );

  const listUsageRecords = async (
    input: BillingUsageRecordListInput,
  ): Promise<BillingUsageRecordList> => {
    const tokenType = input.tokenType ?? COHUB_BILLING_TOKEN_TYPES.usdMicroCent;
    const page = Math.max(1, Math.floor(input.page ?? 1));
    const limit = Math.min(10, Math.max(1, Math.floor(input.limit ?? 10)));
    await ensureCustomer({ userId: input.userId });
    const response = await sdk.admin.credits.listTransactions({
      business_key: businessKey,
      external_user_id: input.userId,
      token_type: tokenType,
      type: "consume",
      sorting: "-created_at",
      page,
      limit,
    });
    return {
      userId: input.userId,
      billing: status,
      tokenType,
      unit: getCreditUnit(tokenType),
      page,
      limit,
      items: response.items.map(mapUsageRecord),
      pagination: {
        maxPage: response.pagination.max_page,
        totalCount: response.pagination.total_count,
      },
    };
  };

  const listOpenOverages = async (
    input: BillingOpenOverageListInput,
  ): Promise<BillingOpenOverageList> => {
    const tokenType = input.tokenType ?? COHUB_BILLING_TOKEN_TYPES.usdMicroCent;
    const page = Math.max(1, Math.floor(input.page ?? 1));
    const limit = Math.min(10, Math.max(1, Math.floor(input.limit ?? 10)));
    await ensureCustomer({ userId: input.userId });
    const response = await sdk.admin.credits.listUsageOverages({
      business_key: businessKey,
      external_user_id: input.userId,
      token_type: tokenType,
      status: "open",
      sorting: "-created_at",
      page,
      limit,
    });
    return {
      userId: input.userId,
      billing: status,
      tokenType,
      unit: getCreditUnit(tokenType),
      page,
      limit,
      items: response.items.map(mapUsageOverage),
      pagination: {
        maxPage: response.pagination.max_page,
        totalCount: response.pagination.total_count,
      },
    };
  };

  const listPublicProducts = async (): Promise<Product[]> => {
    const products = await listAllPages((page, limit) =>
      sdk.admin.products.list({
        business_key: businessKey,
        page,
        limit,
      }),
    );
    return products.filter(
      (product) =>
        product.status === "active" && product.visibility === "public",
    );
  };

  const getProductOrNull = async (productKey: string): Promise<Product | null> => {
    try {
      return await sdk.admin.products.get({
        business_key: businessKey,
        product_key: productKey,
      });
    } catch (error) {
      if (!isNotFound(error)) throw error;
      return null;
    }
  };

  const appendReferencedSubscriptionProducts = async (input: {
    products: Product[];
    subscriptions: Subscription[];
  }): Promise<Product[]> => {
    const byKey = new Map(input.products.map((product) => [product.key, product]));
    const missingKeys = [...new Set(input.subscriptions
      .map((subscription) => subscription.product_key_snapshot)
      .filter((key): key is string => Boolean(key && !byKey.has(key))))];
    if (missingKeys.length === 0) return input.products;
    const referencedProducts = await Promise.all(missingKeys.map(getProductOrNull));
    for (const product of referencedProducts) {
      if (product?.status === "active") byKey.set(product.key, product);
    }
    return [...byKey.values()];
  };

  const listActiveCreditsBenefits = async (): Promise<CreditsBenefit[]> => {
    const benefits = await listAllPages((page, limit) =>
      sdk.admin.benefits.list({
        business_key: businessKey,
        page,
        limit,
      }),
    );
    return benefits.filter(
      (benefit): benefit is CreditsBenefit =>
        isCreditsBenefit(benefit) && benefit.status === "active",
    );
  };

  const getDefaultPlanProductKey = async (
    products: Product[],
  ): Promise<string | null> => {
    try {
      const defaultPlan = await sdk.admin.businesses.getDefaultPlan({
        business_key: businessKey,
      });
      if (defaultPlan.status !== "enabled") return null;
      return (
        products.find((product) => product.id === defaultPlan.product_id)
          ?.key ?? null
      );
    } catch (error) {
      if (!isNotFound(error)) throw error;
      return null;
    }
  };

  const listSubscriptionsByStatuses = async (
    userId: string,
    statuses: readonly string[],
  ): Promise<Subscription[]> => {
    const subscriptions = await listAllPages((page, limit) =>
      sdk.admin.subscriptions.list({
        business_key: businessKey,
        external_user_id: userId,
        sorting: "-created_at",
        page,
        limit,
      }),
    );
    return subscriptions.filter((subscription) =>
      statuses.includes(subscription.status),
    );
  };

  const listCurrentSubscriptions = async (
    userId: string,
  ): Promise<Subscription[]> =>
    (
      await listSubscriptionsByStatuses(
        userId,
        BILLING_CURRENT_SUBSCRIPTION_STATUSES,
      )
    ).filter((subscription) => !isSubscriptionExpiredAfterCancel(subscription));

  const listBlockingSubscriptions = async (
    userId: string,
  ): Promise<Subscription[]> => {
    return (
      await listSubscriptionsByStatuses(
        userId,
        BILLING_BLOCKING_SUBSCRIPTION_STATUSES,
      )
    ).filter((subscription) => !isSubscriptionExpiredAfterCancel(subscription));
  };

  const getCatalog = async (input?: BillingUserRef): Promise<BillingCatalog> => {
    const userId = input?.userId ?? "anonymous";
    if (input?.userId) await ensureCustomer({ userId: input.userId });
    const [
      publicProducts,
      payment,
      currentSubscriptions,
      blockingSubscriptions,
      creditBenefits,
    ] = await Promise.all([
      listPublicProducts(),
      resolvePaymentStatus(sdk),
      input?.userId ? listCurrentSubscriptions(input.userId) : Promise.resolve([]),
      input?.userId ? listBlockingSubscriptions(input.userId) : Promise.resolve([]),
      listActiveCreditsBenefits(),
    ]);
    const products = input?.userId
      ? await appendReferencedSubscriptionProducts({
          products: publicProducts,
          subscriptions: [...currentSubscriptions, ...blockingSubscriptions],
        })
      : publicProducts;
    const defaultPlanProductKey = await getDefaultPlanProductKey(products);
    const mappedProducts = products
      .map((product) =>
        mapCatalogProduct(product, defaultPlanProductKey, creditBenefits),
      )
      .sort(
        (left, right) => left.pricing.amountMinor - right.pricing.amountMinor,
      );
    const plans = mappedProducts.filter((product) => product.kind === "plan");
    const addons = mappedProducts.filter((product) => product.kind === "addon");
    return {
      userId,
      billing: status,
      payment,
      products: mappedProducts,
      plans,
      addons,
      currentSubscriptions: currentSubscriptions.map(mapSubscriptionSummary),
      hasActiveSubscription: blockingSubscriptions.some((subscription) =>
        BILLING_BLOCKING_SUBSCRIPTION_STATUSES.includes(
          subscription.status as (typeof BILLING_BLOCKING_SUBSCRIPTION_STATUSES)[number],
        ),
      ),
      defaultPlanProductKey,
    };
  };

  const findCheckoutProduct = async (input: {
    productKey: string;
    kind: "addon" | "plan";
  }): Promise<Product | null> => {
    try {
      const product = await sdk.admin.products.get({
        business_key: businessKey,
        product_key: input.productKey,
      });
      const expectedBillingType =
        input.kind === "addon" ? "one_time" : "recurring";
      if (
        product.status !== "active" ||
        product.visibility !== "public" ||
        product.billing_type !== expectedBillingType
      ) {
        return null;
      }
      return product;
    } catch (error) {
      if (!isNotFound(error)) throw error;
      return null;
    }
  };

  const createUnavailableCheckout = (input: {
    userId: string;
    productKey: string;
    reason: string;
  }) =>
    disabledCheckoutResult({
      userId: input.userId,
      productKey: input.productKey,
      status,
      reason: input.reason,
    });

  const findReusableAddonCheckout = async (input: {
    userId: string;
    productKey: string;
  }): Promise<BillingCheckoutResult | null> => {
    const response = await sdk.admin.orders.list({
      business_key: businessKey,
      external_user_id: input.userId,
      product_key: input.productKey,
      status: "pending_checkout",
      billing_reason: "purchase",
      sorting: "-created_at",
      page: 1,
      limit: 10,
    });
    for (const order of response.items) {
      try {
        const inspected = await sdk.admin.orders.inspect({
          order_id: order.id,
          business_key: businessKey,
        });
        if (
          inspected.checkout?.checkout_usable === true &&
          inspected.checkout.checkout_url
        ) {
          return checkoutResultFromOrder({
            userId: input.userId,
            productKey: input.productKey,
            response: inspected,
            status,
            reused: true,
          });
        }
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    }
    return null;
  };

  const findReusableSubscriptionCheckout = async (input: {
    userId: string;
    productKey: string;
  }): Promise<BillingCheckoutResult | null> => {
    const response = await sdk.admin.subscriptions.list({
      business_key: businessKey,
      external_user_id: input.userId,
      product_key: input.productKey,
      status: "pending_checkout",
      sorting: "-created_at",
      page: 1,
      limit: 10,
    });
    for (const subscription of response.items) {
      try {
        const inspected = await sdk.admin.subscriptions.inspect({
          subscription_id: subscription.id,
          business_key: businessKey,
        });
        if (
          inspected.checkout?.checkout_usable === true &&
          inspected.checkout.checkout_url
        ) {
          return checkoutResultFromSubscription({
            userId: input.userId,
            productKey: input.productKey,
            response: { ...inspected, reused: true },
            status,
          });
        }
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    }
    return null;
  };

  const purchaseAddon = async (
    input: BillingCheckoutInput,
  ): Promise<BillingCheckoutResult> => {
    return runCheckoutSingleflight(
      { kind: "addon", userId: input.userId, productKey: input.productKey },
      () => purchaseAddonUnprotected(input),
    );
  };

  const purchaseAddonUnprotected = async (
    input: BillingCheckoutInput,
  ): Promise<BillingCheckoutResult> => {
    const product = await findCheckoutProduct({
      productKey: input.productKey,
      kind: "addon",
    });
    if (!product) {
      return createUnavailableCheckout({
        userId: input.userId,
        productKey: input.productKey,
        reason: "Product is not available for purchase",
      });
    }

    await ensureCustomer({ userId: input.userId });
    const reusableCheckout = await findReusableAddonCheckout({
      userId: input.userId,
      productKey: product.key,
    });
    if (reusableCheckout) return reusableCheckout;

    const payment = await resolvePaymentStatus(sdk);
    if (!payment.available) {
      return createUnavailableCheckout({
        userId: input.userId,
        productKey: product.key,
        reason: payment.reason ?? "No available payment provider",
      });
    }

    const response = await sdk.admin.orders.create({
      business_key: businessKey,
      external_user_id: input.userId,
      product_key: product.key,
      billing_reason: "purchase",
      ...checkoutRedirects(input.returnUrl),
    });
    return checkoutResultFromOrder({
      userId: input.userId,
      productKey: product.key,
      response,
      status,
    });
  };

  const createSubscription = async (
    input: BillingCheckoutInput,
  ): Promise<BillingCheckoutResult> => {
    return runCheckoutSingleflight(
      { kind: "plan", userId: input.userId, productKey: input.productKey },
      () => createSubscriptionUnprotected(input),
    );
  };

  const createSubscriptionUnprotected = async (
    input: BillingCheckoutInput,
  ): Promise<BillingCheckoutResult> => {
    const product = await findCheckoutProduct({
      productKey: input.productKey,
      kind: "plan",
    });
    if (!product) {
      return createUnavailableCheckout({
        userId: input.userId,
        productKey: input.productKey,
        reason: "Plan is not available for subscription",
      });
    }

    await ensureCustomer({ userId: input.userId });
    const currentSubscriptions = await listBlockingSubscriptions(input.userId);
    if (currentSubscriptions.length > 0) {
      return createUnavailableCheckout({
        userId: input.userId,
        productKey: product.key,
        reason: "A subscription is already active",
      });
    }

    const reusableCheckout = await findReusableSubscriptionCheckout({
      userId: input.userId,
      productKey: product.key,
    });
    if (reusableCheckout) return reusableCheckout;

    const payment = await resolvePaymentStatus(sdk);
    if (!payment.available) {
      return createUnavailableCheckout({
        userId: input.userId,
        productKey: product.key,
        reason: payment.reason ?? "No available payment provider",
      });
    }

    const response = await sdk.admin.subscriptions.create({
      business_key: businessKey,
      external_user_id: input.userId,
      product_key: product.key,
      ...checkoutRedirects(input.returnUrl),
    });
    return checkoutResultFromSubscription({
      userId: input.userId,
      productKey: product.key,
      response,
      status,
    });
  };

  const shouldInspectSubscriptionForHistory = (
    subscription: Subscription,
  ): boolean => {
    if (subscription.status === "pending_checkout") return true;
    return (
      BILLING_AUTO_RENEW_CANCELABLE_SUBSCRIPTION_STATUSES.includes(
        subscription.status as (typeof BILLING_AUTO_RENEW_CANCELABLE_SUBSCRIPTION_STATUSES)[number],
      ) &&
      subscription.cancel_at_period_end === false &&
      subscription.current_period_end !== null
    );
  };

  const listOrders = async (
    input: BillingHistoryListInput,
  ): Promise<BillingOrderList> => {
    const page = normalizeBillingPage(input.page);
    const limit = normalizeBillingLimit(input.limit);
    await ensureCustomer({ userId: input.userId });
    const response = await sdk.admin.orders.list({
      business_key: businessKey,
      external_user_id: input.userId,
      sorting: "-created_at",
      page,
      limit,
    });
    const items = await Promise.all(
      response.items.map(async (order) => {
        if (order.status !== "pending_checkout") return mapOrderStatus(order);
        try {
          const inspected = await sdk.admin.orders.inspect({
            order_id: order.id,
            business_key: businessKey,
          });
          return mapOrderStatus(inspected.order, inspected.checkout);
        } catch (error) {
          if (!isNotFound(error)) throw error;
          return mapOrderStatus(order);
        }
      }),
    );
    return {
      userId: input.userId,
      billing: status,
      page,
      limit,
      items,
      pagination: {
        maxPage: response.pagination.max_page,
        totalCount: response.pagination.total_count,
      },
    };
  };

  const listSubscriptions = async (
    input: BillingHistoryListInput,
  ): Promise<BillingSubscriptionHistoryList> => {
    const page = normalizeBillingPage(input.page);
    const limit = normalizeBillingLimit(input.limit);
    await ensureCustomer({ userId: input.userId });
    const response = await sdk.admin.subscriptions.list({
      business_key: businessKey,
      external_user_id: input.userId,
      sorting: "-created_at",
      page,
      limit,
    });
    const items = await Promise.all(
      response.items.map(async (subscription) => {
        if (!shouldInspectSubscriptionForHistory(subscription)) {
          return mapSubscriptionHistoryStatus(subscription);
        }
        try {
          const inspected = await sdk.admin.subscriptions.inspect({
            subscription_id: subscription.id,
            business_key: businessKey,
          });
          return mapSubscriptionHistoryStatus(
            inspected.subscription,
            inspected.checkout,
          );
        } catch (error) {
          if (!isNotFound(error)) throw error;
          return mapSubscriptionHistoryStatus(subscription);
        }
      }),
    );
    return {
      userId: input.userId,
      billing: status,
      page,
      limit,
      items,
      pagination: {
        maxPage: response.pagination.max_page,
        totalCount: response.pagination.total_count,
      },
    };
  };

  const getOwnedOrder = async (input: {
    userId: string;
    orderId: string;
  }): Promise<Order> => {
    try {
      const order = await sdk.admin.orders.get({
        order_id: input.orderId,
        business_key: businessKey,
      });
      if (order.external_user_id !== input.userId) {
        throw billingApiError(404, "Order not found", "order_not_found");
      }
      return order;
    } catch (error) {
      if (isNotFound(error))
        throw billingApiError(404, "Order not found", "order_not_found");
      throw error;
    }
  };

  const getOwnedSubscription = async (input: {
    userId: string;
    subscriptionId: string;
  }): Promise<Subscription> => {
    try {
      const subscription = await sdk.admin.subscriptions.get({
        subscription_id: input.subscriptionId,
        business_key: businessKey,
      });
      if (subscription.external_user_id !== input.userId) {
        throw billingApiError(
          404,
          "Subscription not found",
          "subscription_not_found",
        );
      }
      return subscription;
    } catch (error) {
      if (isNotFound(error))
        throw billingApiError(
          404,
          "Subscription not found",
          "subscription_not_found",
        );
      throw error;
    }
  };

  const cancelOrderCheckout = async (
    input: BillingUserRef & { orderId: string },
  ): Promise<BillingOrderStatus> => {
    const order = await getOwnedOrder(input);
    if (order.status !== "pending_checkout") {
      throw billingApiError(
        409,
        "Only pending checkout orders can be canceled",
        "order_not_cancelable",
      );
    }
    const canceled = await sdk.admin.orders.cancelCheckout(
      { order_id: input.orderId },
      { business_key: businessKey },
      {
        idempotencyKey: `cohub:billing:order-cancel-checkout:${input.userId}:${input.orderId}`,
      },
    );
    return mapOrderStatus(canceled);
  };

  const cancelSubscriptionCheckout = async (
    input: BillingUserRef & { subscriptionId: string },
  ): Promise<BillingSubscriptionHistoryStatus> => {
    const subscription = await getOwnedSubscription(input);
    if (subscription.status !== "pending_checkout") {
      throw billingApiError(
        409,
        "Only pending checkout subscriptions can be canceled",
        "subscription_checkout_not_cancelable",
      );
    }
    const canceled = await sdk.admin.subscriptions.cancelCheckout(
      { subscription_id: input.subscriptionId },
      { business_key: businessKey },
      {
        idempotencyKey: `cohub:billing:subscription-cancel-checkout:${input.userId}:${input.subscriptionId}`,
      },
    );
    return mapSubscriptionHistoryStatus(canceled);
  };

  const cancelSubscriptionAutoRenew = async (
    input: BillingUserRef & { subscriptionId: string },
  ): Promise<BillingSubscriptionHistoryStatus> => {
    const subscription = await getOwnedSubscription(input);
    if (
      !BILLING_AUTO_RENEW_CANCELABLE_SUBSCRIPTION_STATUSES.includes(
        subscription.status as (typeof BILLING_AUTO_RENEW_CANCELABLE_SUBSCRIPTION_STATUSES)[number],
      ) ||
      subscription.cancel_at_period_end ||
      subscription.current_period_end === null
    ) {
      throw billingApiError(
        409,
        "Subscription auto-renew cannot be canceled",
        "subscription_auto_renew_not_cancelable",
      );
    }

    const inspected = await sdk.admin.subscriptions.inspect({
      subscription_id: input.subscriptionId,
      business_key: businessKey,
    });
    if (!isProviderBackedSubscriptionCheckout(inspected.checkout)) {
      throw billingApiError(
        409,
        "Subscription auto-renew cannot be canceled",
        "subscription_auto_renew_not_cancelable",
      );
    }
    const response = await sdk.admin.subscriptions.cancel(
      { subscription_id: input.subscriptionId },
      { business_key: businessKey },
      {
        idempotencyKey: `cohub:billing:subscription-cancel-auto-renew:${input.userId}:${input.subscriptionId}`,
      },
    );
    const cancellationCheckout = response.cancellation
      ? ({
          provider_key: response.cancellation.provider_key,
          provider_config_id: response.cancellation.provider_config_id,
          status: response.cancellation.status,
          message: response.cancellation.message,
          acquiring_subscription_id:
            response.cancellation.acquiring_subscription_id,
          subscription_status: response.cancellation.subscription_status,
        } satisfies SubscriptionCheckout)
      : inspected.checkout;
    return mapSubscriptionHistoryStatus(
      response.subscription,
      cancellationCheckout,
    );
  };

  const redeemCode = async (
    input: BillingRedemptionInput,
  ): Promise<BillingRedemptionResult> => {
    const code = normalizeRedemptionCode(input.code);
    if (!code) {
      return {
        userId: input.userId,
        billing: status,
        redeemed: false,
        message: "Redemption code is required",
        redemptionRecordId: null,
        itemCount: 0,
      };
    }
    await ensureCustomer({ userId: input.userId });
    const response = await sdk.admin.redemptionCodes.redeem(
      {
        code,
        external_user_id: input.userId,
      },
      {
        idempotencyKey: redemptionIdempotencyKey({
          userId: input.userId,
          code,
        }),
      },
    );
    return {
      userId: input.userId,
      billing: status,
      redeemed: true,
      message: null,
      redemptionRecordId: response.redemption_record.id,
      itemCount: response.redemption_record.items_snapshot.length,
    };
  };

  return {
    status,
    ensureCustomer,

    async getState(input: BillingUserRef): Promise<BillingAccountState> {
      return getStateAfterEnsure(input.userId);
    },

    async getCreditStatus(
      input: BillingUserRef & { tokenType?: string },
    ): Promise<BillingCreditStatus> {
      const tokenType =
        input.tokenType ?? COHUB_BILLING_TOKEN_TYPES.usdMicroCent;
      const state = await getCreditsAfterEnsure(input.userId);
      const balance = findBalance(state.credits, tokenType);
      const grants = (
        await listAllCreditGrants({ userId: input.userId, tokenType })
      ).filter(
        (grant) =>
          CREDIT_GRANT_DISPLAY_STATUSES.includes(
            grant.status as CreditGrantDisplayStatus,
          ) && isCreditGrantDisplayable(grant),
      );
      const grantStatuses = grants.map((grant) => mapCreditGrant(grant));
      const openOverageUsd = amountToUsd(
        balance?.openOverageBalance ?? 0,
        tokenType,
      );
      const netUsd = balance
        ? amountToUsd(balance.netBalance, tokenType)
        : -openOverageUsd;

      return {
        userId: input.userId,
        billing: status,
        tokenType,
        unit: getCreditUnit(tokenType),
        balance: {
          availableUsd: amountToUsd(balance?.availableBalance ?? 0, tokenType),
          openOverageUsd,
          netUsd,
        },
        overage: {
          hasOpenOverage: openOverageUsd > 0,
          openAmountUsd: openOverageUsd,
          items: [],
        },
        groups: groupCreditGrants(grantStatuses),
      };
    },

    listOpenOverages,

    getCatalog,

    listOrders,

    listSubscriptions,

    purchaseAddon,

    createSubscription,

    cancelOrderCheckout,

    cancelSubscriptionCheckout,

    cancelSubscriptionAutoRenew,

    redeemCode,

    async preflightUsage(
      input: BillingUsagePreflightInput,
    ): Promise<BillingUsagePreflight> {
      const tokenType =
        input.tokenType ?? COHUB_BILLING_TOKEN_TYPES.usdMicroCent;
      const estimatedAmountUsd = roundUsd(
        input.estimatedAmountUsd,
        getCreditUnit(tokenType).usdDecimalPlaces,
      );
      const estimatedAmount = usdToAmount(estimatedAmountUsd, tokenType);
      if (estimatedAmountUsd === 0) {
        return {
          allowed: true,
          tokenType,
          estimatedAmountUsd,
          availableBalance: 0,
          netBalance: 0,
          shortfall: 0,
        };
      }

      await ensureCustomer({ userId: input.userId });
      const preview = await sdk.admin.credits.previewConsume({
        business_key: businessKey,
        external_user_id: input.userId,
        token_type: tokenType,
        amount: estimatedAmount,
        source_type: "usage",
        source_id: `preflight:${input.usageType}`,
        usage_type: input.usageType,
      });
      const availableBalance = amountToUsd(preview.available_before, tokenType);
      const netBalance = amountToUsd(
        Math.max(
          0,
          preview.available_before -
            preview.historical_overage_settlement_amount,
        ),
        tokenType,
      );
      const shortfall = amountToUsd(
        preview.uncovered_current_usage_amount,
        tokenType,
      );
      return {
        allowed:
          !preview.would_create_overage &&
          preview.uncovered_current_usage_amount === 0,
        tokenType,
        estimatedAmountUsd,
        availableBalance,
        netBalance,
        shortfall,
      };
    },

    async recordUsage(
      input: BillingUsageRecordInput,
    ): Promise<BillingUsageRecordResult> {
      const tokenType =
        input.tokenType ?? COHUB_BILLING_TOKEN_TYPES.usdMicroCent;
      const amountUsd = roundUsd(
        input.amountUsd,
        getCreditUnit(tokenType).usdDecimalPlaces,
      );
      const amount = usdToAmount(amountUsd, tokenType);
      if (amount === 0) {
        return { tokenType, amountUsd, status: "skipped", response: null };
      }

      await ensureCustomer({ userId: input.userId });
      const response = await sdk.admin.credits.consume(
        {
          business_key: businessKey,
          external_user_id: input.userId,
          token_type: tokenType,
          amount,
          source_type: "usage",
          source_id: input.sourceId,
          usage_type: input.usageType,
          operation_id: input.operationId,
          reason: input.reason,
        },
        { idempotencyKey: input.operationId },
      );

      return {
        tokenType,
        amountUsd,
        status: response.overage ? "overage" : "recorded",
        response,
      };
    },

    listUsageRecords,

    getFeatureEntitlement,

    async checkFeatureLimit(
      input: BillingFeatureLimitInput,
    ): Promise<BillingFeatureLimitCheck> {
      const entitlement = await getFeatureEntitlement(input);
      return checkFeatureLimitFromEntitlement({
        entitlement,
        quantity: input.quantity,
        metadataKey: input.metadataKey ?? "limit",
        fallbackLimit: input.fallbackLimit,
        missingEntitlementPolicy: input.missingEntitlementPolicy,
      });
    },
  };
}

export function createBillingOperations(): BillingOperations {
  const clientConfig = resolveBillingClientConfig();
  return clientConfig
    ? createTalesofaiBillingOperations(clientConfig)
    : createDisabledBillingOperations();
}

export const billingOperations = createBillingOperations();
