import type { HttpTransport } from "../transport.js";
import type { BillingCatalogProduct } from "../types.js";

export type WorkCommerceEntitlementCheckItem = {
  benefitKey: string;
  enabled: boolean;
  reason: "active_grant" | "no_active_grant" | "benefit_not_found" | "benefit_not_feature";
  metadata: Record<string, string | number | boolean> | null;
};

export type WorkCommerceCheckoutStatus = "success" | "failed" | "cancel" | null;

export type WorkCommerceProductResolveResponse = {
  products: BillingCatalogProduct[];
};

export type WorkCommerceEntitlementsResponse = {
  entitlements: WorkCommerceEntitlementCheckItem[];
  checkedAt: string;
  businessKey: string;
};

export type WorkCommercePurchaseResponse = {
  checkout: {
    providerKey: string | null;
    checkoutUrl: string | null;
    checkoutUsable: boolean;
    status: string | null;
    message: string | null;
    orderId: string;
    productKey: string;
  };
};

export type WorkCommerceOrder = {
  id: string;
  productKeySnapshot: string;
  productNameSnapshot: string;
  status: string;
  amountSnapshot: number;
  paidAmountSnapshot: number;
  createdAt: string;
  paidAt: string | null;
};

export class WorkCommerceApi {
  constructor(private readonly transport: HttpTransport) {}

  resolveProducts(workId: string, input: { productKeys: string[] }) {
    return this.transport.request<WorkCommerceProductResolveResponse>(
      `/api/works/${encodeURIComponent(workId)}/commerce/products/resolve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  }

  checkEntitlements(workId: string, input: { benefitKeys: string[] }) {
    return this.transport.request<WorkCommerceEntitlementsResponse>(
      `/api/works/${encodeURIComponent(workId)}/commerce/entitlements/check`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  }

  purchase(workId: string, input: { productKey: string }) {
    return this.transport.request<WorkCommercePurchaseResponse>(
      `/api/works/${encodeURIComponent(workId)}/commerce/purchase`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  }

  getOrder(workId: string, orderId: string) {
    return this.transport.request<{ order: WorkCommerceOrder }>(
      `/api/works/${encodeURIComponent(workId)}/commerce/orders/${encodeURIComponent(orderId)}`,
    );
  }
}
