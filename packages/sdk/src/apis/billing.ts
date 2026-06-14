import type {
  BillingBalanceActivityList,
  BillingCatalog,
  BillingCheckoutResult,
  BillingCreditStatus,
  BillingOpenOverageList,
  BillingOrderList,
  BillingOrderStatus,
  BillingRedemptionResult,
  BillingSubscriptionHistoryList,
  BillingSubscriptionHistoryStatus,
  BillingUsageRecordList,
} from "../types.js";
import type { HttpTransport } from "../transport.js";

export class BillingApi {
  constructor(private readonly transport: HttpTransport) {}

  async getCredits(input?: { tokenType?: string }) {
    const query = input?.tokenType
      ? `?tokenType=${encodeURIComponent(input.tokenType)}`
      : "";
    return this.transport.request<{ credit: BillingCreditStatus }>(
      `/api/billing/credits${query}`,
    );
  }

  async getBalanceActivities(input?: { tokenType?: string; page?: number; limit?: number }) {
    const params = new URLSearchParams();
    if (input?.tokenType) params.set("tokenType", input.tokenType);
    if (input?.page) params.set("page", String(input.page));
    if (input?.limit) params.set("limit", String(input.limit));
    const query = params.toString();
    return this.transport.request<{ activities: BillingBalanceActivityList }>(
      `/api/billing/balance-activities${query ? `?${query}` : ""}`,
    );
  }

  async getUsageRecords(input?: { tokenType?: string; page?: number; limit?: number }) {
    const params = new URLSearchParams();
    if (input?.tokenType) params.set("tokenType", input.tokenType);
    if (input?.page) params.set("page", String(input.page));
    if (input?.limit) params.set("limit", String(input.limit));
    const query = params.toString();
    return this.transport.request<{ usage: BillingUsageRecordList }>(
      `/api/billing/usage-records${query ? `?${query}` : ""}`,
    );
  }

  async getOverages(input?: { tokenType?: string; page?: number; limit?: number }) {
    const params = new URLSearchParams();
    if (input?.tokenType) params.set("tokenType", input.tokenType);
    if (input?.page) params.set("page", String(input.page));
    if (input?.limit) params.set("limit", String(input.limit));
    const query = params.toString();
    return this.transport.request<{ overages: BillingOpenOverageList }>(
      `/api/billing/overages${query ? `?${query}` : ""}`,
    );
  }

  async getCatalog() {
    return this.transport.request<{ catalog: BillingCatalog }>(
      "/api/billing/catalog",
    );
  }

  async getOrders(input?: { page?: number; limit?: number }) {
    const params = new URLSearchParams();
    if (input?.page) params.set("page", String(input.page));
    if (input?.limit) params.set("limit", String(input.limit));
    const query = params.toString();
    return this.transport.request<{ orders: BillingOrderList }>(
      `/api/billing/orders${query ? `?${query}` : ""}`,
    );
  }

  async getSubscriptions(input?: { page?: number; limit?: number }) {
    const params = new URLSearchParams();
    if (input?.page) params.set("page", String(input.page));
    if (input?.limit) params.set("limit", String(input.limit));
    const query = params.toString();
    return this.transport.request<{ subscriptions: BillingSubscriptionHistoryList }>(
      `/api/billing/subscriptions${query ? `?${query}` : ""}`,
    );
  }

  async purchaseAddon(productKey: string, input?: { returnUrl?: string }) {
    return this.transport.request<{ checkout: BillingCheckoutResult }>(
      `/api/billing/addons/${encodeURIComponent(productKey)}/purchase`,
      {
        method: "POST",
        body: JSON.stringify(input ?? {}),
      },
    );
  }

  async cancelOrderCheckout(orderId: string) {
    return this.transport.request<{ order: BillingOrderStatus }>(
      `/api/billing/orders/${encodeURIComponent(orderId)}/cancel-checkout`,
      { method: "POST" },
    );
  }

  async subscribePlan(productKey: string, input?: { returnUrl?: string }) {
    return this.transport.request<{ checkout: BillingCheckoutResult }>(
      `/api/billing/plans/${encodeURIComponent(productKey)}/subscribe`,
      {
        method: "POST",
        body: JSON.stringify(input ?? {}),
      },
    );
  }

  async cancelSubscriptionCheckout(subscriptionId: string) {
    return this.transport.request<{ subscription: BillingSubscriptionHistoryStatus }>(
      `/api/billing/subscriptions/${encodeURIComponent(subscriptionId)}/cancel-checkout`,
      { method: "POST" },
    );
  }

  async cancelSubscriptionAutoRenew(subscriptionId: string) {
    return this.transport.request<{ subscription: BillingSubscriptionHistoryStatus }>(
      `/api/billing/subscriptions/${encodeURIComponent(subscriptionId)}/cancel-auto-renew`,
      { method: "POST" },
    );
  }

  async redeemCode(input: { code: string }) {
    return this.transport.request<{ redemption: BillingRedemptionResult }>(
      "/api/billing/redemption-codes/redeem",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }
}
