import type { BillingCreditStatus } from "../types.js";
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
}
