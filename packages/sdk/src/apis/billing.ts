import type {
  BillingCatalog,
  BillingCheckoutResult,
  BillingCreditStatus,
  BillingOpenOverageList,
  BillingRedemptionResult,
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

  async purchaseAddon(productKey: string, input?: { returnUrl?: string }) {
    return this.transport.request<{ checkout: BillingCheckoutResult }>(
      `/api/billing/addons/${encodeURIComponent(productKey)}/purchase`,
      {
        method: "POST",
        body: JSON.stringify(input ?? {}),
      },
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
