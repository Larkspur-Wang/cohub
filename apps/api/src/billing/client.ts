import { creditsFeature, type CreditGrant, type CreditTransaction, type UsageOverage } from "@talesofai-billing/sdk/admin/credits";
import { customersFeature } from "@talesofai-billing/sdk/admin/customers";
import { ApiError, createSdk } from "@talesofai-billing/sdk/base";
import { config } from "../config.js";
import {
  COHUB_BILLING_CREDIT_UNITS,
  COHUB_BILLING_TOKEN_TYPES,
  type BillingAccountState,
  type BillingCreditBalance,
  type BillingCreditExpiryGroup,
  type BillingCreditGrantStatus,
  type BillingCreditStatus,
  type BillingFeatureEntitlement,
  type BillingFeatureLimitCheck,
  type BillingFeatureLimitInput,
  type BillingOpenOverageList,
  type BillingOpenOverageListInput,
  type BillingOpenOverageStatus,
  type BillingOperations,
  type BillingPluginStatus,
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
    .useAdmin(customersFeature())
    .useAdmin(creditsFeature());
}

type ConfiguredBillingSdk = ReturnType<typeof createConfiguredSdk>;

const ENSURE_CUSTOMER_CACHE_TTL_MS = 5 * 60 * 1000;
const CREDIT_LIST_PAGE_LIMIT = 100;
const CREDIT_LIST_MAX_PAGES = 20;
const CREDIT_GRANT_DISPLAY_STATUSES = ["active", "depleted", "expired"] as const;
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
type CreditGrantDisplayStatus = typeof CREDIT_GRANT_DISPLAY_STATUSES[number];

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

function normalizeAmount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Number(value.toFixed(8));
}

function roundUsd(value: number, decimalPlaces = COHUB_BILLING_CREDIT_UNITS.usdMicroCent.usdDecimalPlaces): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(decimalPlaces));
}

function getCreditUnit(tokenType: string) {
  if (tokenType === COHUB_BILLING_TOKEN_TYPES.usdMicroCent) return COHUB_BILLING_CREDIT_UNITS.usdMicroCent;
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

function mapCreditBalance(summary: BillingCreditBalance["raw"]): BillingCreditBalance {
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
      merged[key] = typeof existing === "number" ? Math.max(existing, value) : value;
      continue;
    }
    if (existing === undefined) {
      merged[key] = value;
    }
  }
  return merged;
}

function mapFeatureEntitlements(activeBenefits: BillingFeatureEntitlement["grants"]): BillingFeatureEntitlement[] {
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
}): Promise<(BillingUserRef & { entitlements: BillingFeatureEntitlement[] }) | null> {
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

function findBalance(credits: BillingCreditBalance[], tokenType: string): BillingCreditBalance | null {
  return credits.find((credit) => credit.tokenType === tokenType) ?? null;
}

function daysUntil(expiresAt: string | null | undefined, now = new Date()): number | null {
  if (!expiresAt) return null;
  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime())) return null;
  return Math.ceil((expires.getTime() - now.getTime()) / 86_400_000);
}

function getExpiryGroupKey(daysRemaining: number | null): BillingCreditExpiryGroup["key"] {
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
  return CREDIT_BENEFIT_DISPLAY_NAMES[benefitKey] ?? humanizeIdentifier(benefitKey);
}

function optionalAmount(value: number | undefined, tokenType: string) {
  if (typeof value !== "number") return { amount: null, amountUsd: null };
  return {
    amount: normalizeAmount(value),
    amountUsd: amountToUsd(value, tokenType),
  };
}

function mapCreditGrant(grant: CreditGrant, now = new Date()): BillingCreditGrantStatus {
  const daysRemaining = daysUntil(grant.expires_at ?? null, now);
  const consumed = optionalAmount(grant.consumed_amount, grant.token_type);
  const usageConsumed = optionalAmount(grant.usage_consumed_amount, grant.token_type);
  const settledOverage = optionalAmount(grant.settled_overage_amount, grant.token_type);
  const originalAmount = typeof grant.original_amount === "number" ? normalizeAmount(grant.original_amount) : null;
  const originalAmountUsd = typeof grant.original_amount === "number" ? amountToUsd(grant.original_amount, grant.token_type) : null;
  const consumedPercent = originalAmount && consumed.amount !== null
    ? Math.min(100, Math.max(0, Number(((consumed.amount / originalAmount) * 100).toFixed(1))))
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
  };
}

function groupCreditGrants(grants: BillingCreditGrantStatus[]): BillingCreditExpiryGroup[] {
  const orderedKeys: BillingCreditExpiryGroup["key"][] = ["lt_7d", "lt_30d", "gte_30d", "never", "expired"];
  const byKey = new Map<BillingCreditExpiryGroup["key"], BillingCreditExpiryGroup>();
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
    group.remainingAmountUsd = normalizeAmount(group.remainingAmountUsd + grant.remainingAmountUsd);
    group.grants.push(grant);
  }
  return orderedKeys
    .map((key) => byKey.get(key))
    .filter((group): group is BillingCreditExpiryGroup => !!group && group.grants.length > 0);
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
    remainingAmountUsd: amountToUsd(overage.remaining_amount, overage.token_type),
    settledAmountUsd: amountToUsd(overage.settled_amount, overage.token_type),
    status: overage.status,
    reason: overage.reason ?? null,
    createdAt: overage.created_at,
  };
}

function mapUsageRecord(transaction: CreditTransaction): BillingUsageRecordStatus {
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

function checkFeatureLimitFromEntitlement(input: {
  entitlement: BillingFeatureEntitlement | null;
  quantity: number;
  metadataKey: string;
  fallbackLimit?: number;
  missingEntitlementPolicy?: "allow" | "deny";
}): BillingFeatureLimitCheck {
  const unlimited = input.entitlement?.metadata.unlimited === true;
  const rawLimit = input.entitlement?.metadata[input.metadataKey];
  const entitlementLimit = typeof rawLimit === "number" && Number.isFinite(rawLimit) ? rawLimit : null;
  const limit = unlimited ? null : entitlementLimit ?? input.fallbackLimit ?? null;
  const allowed = input.entitlement === null && limit === null
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

export function createDisabledBillingOperations(reason = "billing configuration is missing"): BillingOperations {
  const status: BillingPluginStatus = { provider: "disabled", configured: false, reason };
  return {
    status,

    async ensureCustomer(input: BillingUserRef): Promise<BillingUserRef> {
      return input;
    },

    async getState(input: BillingUserRef): Promise<BillingAccountState> {
      return { userId: input.userId, credits: [], entitlements: [] };
    },

    async getCreditStatus(input: BillingUserRef & { tokenType?: string }): Promise<BillingCreditStatus> {
      const tokenType = input.tokenType ?? COHUB_BILLING_TOKEN_TYPES.usdMicroCent;
      return emptyCreditStatus({ userId: input.userId, tokenType, status });
    },

    async listOpenOverages(input: BillingOpenOverageListInput): Promise<BillingOpenOverageList> {
      const tokenType = input.tokenType ?? COHUB_BILLING_TOKEN_TYPES.usdMicroCent;
      return emptyOpenOverageList({
        userId: input.userId,
        tokenType,
        status,
        page: input.page ?? 1,
        limit: input.limit ?? 10,
      });
    },

    async preflightUsage(input: BillingUsagePreflightInput): Promise<BillingUsagePreflight> {
      const tokenType = input.tokenType ?? COHUB_BILLING_TOKEN_TYPES.usdMicroCent;
      return {
        allowed: true,
        tokenType,
        estimatedAmountUsd: roundUsd(input.estimatedAmountUsd, getCreditUnit(tokenType).usdDecimalPlaces),
        availableBalance: 0,
        netBalance: 0,
        shortfall: 0,
      };
    },

    async recordUsage(input: BillingUsageRecordInput): Promise<BillingUsageRecordResult> {
      const tokenType = input.tokenType ?? COHUB_BILLING_TOKEN_TYPES.usdMicroCent;
      return {
        tokenType,
        amountUsd: roundUsd(input.amountUsd, getCreditUnit(tokenType).usdDecimalPlaces),
        status: "disabled",
        response: null,
      };
    },

    async listUsageRecords(input: BillingUsageRecordListInput): Promise<BillingUsageRecordList> {
      const tokenType = input.tokenType ?? COHUB_BILLING_TOKEN_TYPES.usdMicroCent;
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

    async checkFeatureLimit(input: BillingFeatureLimitInput): Promise<BillingFeatureLimitCheck> {
      const limit = input.fallbackLimit ?? null;
      const allowed = limit === null
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

export function createTalesofaiBillingOperations(clientConfig: BillingClientConfig): BillingOperations {
  const sdk = createConfiguredSdk(clientConfig);
  const businessKey = clientConfig.businessKey;
  const status: BillingPluginStatus = { provider: "talesofai", configured: true };
  const ensuredCustomers = new Map<string, { value: BillingUserRef; expiresAt: number }>();
  const inflightEnsures = new Map<string, Promise<BillingUserRef>>();

  const cacheEnsuredCustomer = (input: BillingUserRef) => {
    ensuredCustomers.set(input.userId, {
      value: input,
      expiresAt: Date.now() + ENSURE_CUSTOMER_CACHE_TTL_MS,
    });
  };

  const forgetEnsuredCustomer = (userId: string) => {
    ensuredCustomers.delete(userId);
  };

  const ensureCustomer = async (input: BillingUserRef): Promise<BillingUserRef> => {
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
        const customer = await sdk.admin.customers.get({ external_user_id: input.userId });
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

  const getStateAfterEnsure = async (userId: string): Promise<BillingAccountState> => {
    await ensureCustomer({ userId });
    const state = await getCustomerStateOrEmpty({ sdk, businessKey, userId });
    if (state) return state;

    forgetEnsuredCustomer(userId);
    await ensureCustomer({ userId });
    return await getCustomerStateOrEmpty({ sdk, businessKey, userId }) ?? { userId, credits: [], entitlements: [] };
  };

  const getCreditsAfterEnsure = async (userId: string): Promise<BillingUserRef & { credits: BillingCreditBalance[] }> => {
    await ensureCustomer({ userId });
    const state = await getCustomerCreditsOrEmpty({ sdk, businessKey, userId });
    if (state) return state;

    forgetEnsuredCustomer(userId);
    await ensureCustomer({ userId });
    return await getCustomerCreditsOrEmpty({ sdk, businessKey, userId }) ?? { userId, credits: [] };
  };

  const getEntitlementsAfterEnsure = async (
    userId: string,
  ): Promise<BillingUserRef & { entitlements: BillingFeatureEntitlement[] }> => {
    await ensureCustomer({ userId });
    const state = await getCustomerEntitlementsOrEmpty({ sdk, businessKey, userId });
    if (state) return state;

    forgetEnsuredCustomer(userId);
    await ensureCustomer({ userId });
    return await getCustomerEntitlementsOrEmpty({ sdk, businessKey, userId }) ?? { userId, entitlements: [] };
  };

  const getFeatureEntitlement = async (input: {
    userId: string;
    featureKey: string;
  }): Promise<BillingFeatureEntitlement | null> => {
    const state = await getEntitlementsAfterEnsure(input.userId);
    return state.entitlements.find((entitlement) => entitlement.key === input.featureKey && entitlement.enabled) ?? null;
  };

  const listAllPages = async <T>(fetchPage: (page: number, limit: number) => Promise<BillingListPage<T>>): Promise<T[]> => {
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
      })
    );

  const listUsageRecords = async (input: BillingUsageRecordListInput): Promise<BillingUsageRecordList> => {
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

  const listOpenOverages = async (input: BillingOpenOverageListInput): Promise<BillingOpenOverageList> => {
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

  return {
    status,
    ensureCustomer,

    async getState(input: BillingUserRef): Promise<BillingAccountState> {
      return getStateAfterEnsure(input.userId);
    },

    async getCreditStatus(input: BillingUserRef & { tokenType?: string }): Promise<BillingCreditStatus> {
      const tokenType = input.tokenType ?? COHUB_BILLING_TOKEN_TYPES.usdMicroCent;
      const state = await getCreditsAfterEnsure(input.userId);
      const balance = findBalance(state.credits, tokenType);
      const grants = (await listAllCreditGrants({ userId: input.userId, tokenType }))
        .filter((grant) =>
          CREDIT_GRANT_DISPLAY_STATUSES.includes(grant.status as CreditGrantDisplayStatus)
        );
      const grantStatuses = grants.map((grant) => mapCreditGrant(grant));
      const openOverageUsd = amountToUsd(balance?.openOverageBalance ?? 0, tokenType);
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

    async preflightUsage(input: BillingUsagePreflightInput): Promise<BillingUsagePreflight> {
      const tokenType = input.tokenType ?? COHUB_BILLING_TOKEN_TYPES.usdMicroCent;
      const estimatedAmountUsd = roundUsd(input.estimatedAmountUsd, getCreditUnit(tokenType).usdDecimalPlaces);
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

      const state = await getCreditsAfterEnsure(input.userId);
      const balance = findBalance(state.credits, tokenType);
      const availableBalance = amountToUsd(balance?.availableBalance ?? 0, tokenType);
      const netBalance = amountToUsd(balance?.netBalance ?? 0, tokenType);
      const shortfall = Math.max(0, estimatedAmountUsd - netBalance);
      return {
        allowed: shortfall === 0,
        tokenType,
        estimatedAmountUsd,
        availableBalance,
        netBalance,
        shortfall: roundUsd(shortfall, getCreditUnit(tokenType).usdDecimalPlaces),
      };
    },

    async recordUsage(input: BillingUsageRecordInput): Promise<BillingUsageRecordResult> {
      const tokenType = input.tokenType ?? COHUB_BILLING_TOKEN_TYPES.usdMicroCent;
      const amountUsd = roundUsd(input.amountUsd, getCreditUnit(tokenType).usdDecimalPlaces);
      const amount = usdToAmount(amountUsd, tokenType);
      if (amount === 0) {
        return { tokenType, amountUsd, status: "skipped", response: null };
      }

      await ensureCustomer({ userId: input.userId });
      const response = await sdk.admin.credits.consume({
        business_key: businessKey,
        external_user_id: input.userId,
        token_type: tokenType,
        amount,
        source_type: "usage",
        source_id: input.sourceId,
        usage_type: input.usageType,
        operation_id: input.operationId,
        reason: input.reason,
      }, { idempotencyKey: input.operationId });

      return {
        tokenType,
        amountUsd,
        status: response.overage ? "overage" : "recorded",
        response,
      };
    },

    listUsageRecords,

    getFeatureEntitlement,

    async checkFeatureLimit(input: BillingFeatureLimitInput): Promise<BillingFeatureLimitCheck> {
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
