import { creditsFeature } from "@talesofai-billing/sdk/admin/credits";
import { customersFeature } from "@talesofai-billing/sdk/admin/customers";
import { ApiError, createSdk } from "@talesofai-billing/sdk/base";
import { config } from "../config.js";
import {
  COHUB_BILLING_TOKEN_TYPES,
  type BillingAccountState,
  type BillingCreditBalance,
  type BillingFeatureEntitlement,
  type BillingFeatureLimitCheck,
  type BillingFeatureLimitInput,
  type BillingOperations,
  type BillingPluginStatus,
  type BillingUsagePreflight,
  type BillingUsagePreflightInput,
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

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

function normalizeAmount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Number(value.toFixed(8));
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

function findCreditBalance(state: BillingAccountState, tokenType: string): BillingCreditBalance | null {
  return state.credits.find((credit) => credit.tokenType === tokenType) ?? null;
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

    async preflightUsage(input: BillingUsagePreflightInput): Promise<BillingUsagePreflight> {
      const tokenType = input.tokenType ?? COHUB_BILLING_TOKEN_TYPES.usd;
      return {
        allowed: true,
        tokenType,
        estimatedAmountUsd: normalizeAmount(input.estimatedAmountUsd),
        availableBalance: 0,
        netBalance: 0,
        shortfall: 0,
      };
    },

    async recordUsage(input: BillingUsageRecordInput): Promise<BillingUsageRecordResult> {
      const tokenType = input.tokenType ?? COHUB_BILLING_TOKEN_TYPES.usd;
      return {
        tokenType,
        amountUsd: normalizeAmount(input.amountUsd),
        status: "disabled",
        response: null,
      };
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

  const getFeatureEntitlement = async (input: {
    userId: string;
    featureKey: string;
  }): Promise<BillingFeatureEntitlement | null> => {
    const state = await getStateAfterEnsure(input.userId);
    return state.entitlements.find((entitlement) => entitlement.key === input.featureKey && entitlement.enabled) ?? null;
  };

  return {
    status,
    ensureCustomer,

    async getState(input: BillingUserRef): Promise<BillingAccountState> {
      return getStateAfterEnsure(input.userId);
    },

    async preflightUsage(input: BillingUsagePreflightInput): Promise<BillingUsagePreflight> {
      const tokenType = input.tokenType ?? COHUB_BILLING_TOKEN_TYPES.usd;
      const estimatedAmountUsd = normalizeAmount(input.estimatedAmountUsd);
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

      const state = await getStateAfterEnsure(input.userId);
      const balance = findCreditBalance(state, tokenType);
      const availableBalance = balance?.availableBalance ?? 0;
      const netBalance = balance?.netBalance ?? 0;
      const shortfall = Math.max(0, estimatedAmountUsd - netBalance);
      return {
        allowed: shortfall === 0,
        tokenType,
        estimatedAmountUsd,
        availableBalance,
        netBalance,
        shortfall,
      };
    },

    async recordUsage(input: BillingUsageRecordInput): Promise<BillingUsageRecordResult> {
      const tokenType = input.tokenType ?? COHUB_BILLING_TOKEN_TYPES.usd;
      const amountUsd = normalizeAmount(input.amountUsd);
      if (amountUsd === 0) {
        return { tokenType, amountUsd, status: "skipped", response: null };
      }

      await ensureCustomer({ userId: input.userId });
      const response = await sdk.admin.credits.consume({
        business_key: businessKey,
        external_user_id: input.userId,
        token_type: tokenType,
        amount: amountUsd,
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
