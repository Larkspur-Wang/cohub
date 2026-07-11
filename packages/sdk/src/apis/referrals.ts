import type { HttpTransport } from "../transport.js";
import type {
  ClaimReferralResponse,
  PublicReferral,
  ReferralDashboard,
} from "../types.js";

export class ReferralsApi {
  constructor(private readonly transport: HttpTransport) {}

  get(code: string) {
    return this.transport.request<PublicReferral>(
      `/api/referrals/${encodeURIComponent(code)}`,
    );
  }

  claim(code: string) {
    return this.transport.request<ClaimReferralResponse>(
      `/api/referrals/${encodeURIComponent(code)}/claim`,
      { method: "POST" },
    );
  }

  getMine() {
    return this.transport.request<ReferralDashboard>("/api/me/referrals");
  }

  rotateCode() {
    return this.transport.request<{ code: string }>(
      "/api/me/referrals/code/rotate",
      { method: "POST" },
    );
  }
}
