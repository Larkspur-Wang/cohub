import { createHash } from "node:crypto";

const PURCHASE_ATTEMPT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export function normalizePurchaseAttemptId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return PURCHASE_ATTEMPT_ID_PATTERN.test(normalized) ? normalized : null;
}

export function toPromotionMoney(amountMinor: number, rawCurrency: unknown) {
  const currency = typeof rawCurrency === "string" ? rawCurrency.trim().toUpperCase() : "";
  if (!Number.isFinite(amountMinor) || amountMinor < 0 || !/^[A-Z]{3}$/.test(currency)) return null;
  try {
    const digits = new Intl.NumberFormat("en", { style: "currency", currency })
      .resolvedOptions().maximumFractionDigits ?? 2;
    return { value: amountMinor / (10 ** digits), currency };
  } catch {
    return null;
  }
}

export type WorkPurchaseAttemptIdentity = {
  appId: string;
  buyerUserUuid: string;
  productKey: string;
  purchaseAttemptId: string;
};

export function createAppPurchaseIdempotencyKey(input: WorkPurchaseAttemptIdentity): string {
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        input.appId,
        input.buyerUserUuid,
        input.productKey,
        input.purchaseAttemptId,
      ]),
    )
    .digest("hex");
  // The prefix is an external billing-provider identifier; it stays stable so
  // in-flight retries keep hitting the same idempotency key.
  return `cohub-work-purchase-v1-${fingerprint}`;
}
