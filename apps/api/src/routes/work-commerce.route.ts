import { Hono, type Context } from "hono";
import { ApiError } from "@talesofai-billing/sdk/base";
import type { Order } from "@talesofai-billing/sdk/admin/orders";
import { authzDenied, getOptionalAuth, requireValidId, useAuth } from "../lib/middleware.js";
import { hasPermission } from "../permissions.js";
import {
  buildWorkCheckoutReturnUrls,
  createSpaceCommerceSdk,
  getSpaceCommerceBusinessKey,
  getWorkCommerceContextById,
} from "../lib/space-commerce.js";
import { db } from "../db/index.js";
import { spaces, userProfiles } from "@cohub/db";
import { eq } from "drizzle-orm";
import { config } from "../config.js";

const router = new Hono();

function apiErrorResponse(c: Context, error: ApiError) {
  const status = error.status >= 500 ? 502 : error.status;
  const message =
    status === 400 ? "Invalid commerce request" :
    status === 401 ? "Unauthorized" :
    status === 403 ? "Forbidden" :
    status === 404 ? "Commerce resource not found" :
    status === 409 ? "Checkout is not available" :
    "Commerce request failed";
  return c.json({ message }, status as never);
}

async function requireWorkCommerceBusinessKey(spaceId: string) {
  const businessKey = await getSpaceCommerceBusinessKey(spaceId);
  if (!businessKey) throw new Error("Space commerce is not initialized");
  return businessKey;
}

async function getPublishedWorkOrDeny(workId: string, userUuid?: string | null) {
  const work = await getWorkCommerceContextById(workId);
  if (work?.workStatus !== "published") return { error: "work not found" as const };
  if ((work.workVisibility ?? "public") === "space") {
    if (!userUuid) return { auth: "required" as const, work };
  }
  return { work };
}

function serializeProduct(product: {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: string;
  visibility: string;
  billing_type?: string;
  billing_period?: string;
  billing_interval_count?: number;
  amount?: number;
  currency?: string;
}) {
  const amountMinor = product.amount ?? 0;
  const amountUsd = amountMinor / 100;
  return {
    id: product.id,
    key: product.key,
    name: product.name,
    description: product.description,
    status: product.status,
    visibility: product.visibility,
    billingType: product.billing_type ?? "one_time",
    billingPeriod: product.billing_period ?? "one_time",
    billingIntervalCount: product.billing_interval_count ?? 1,
    currency: product.currency ?? "USD",
    kind: "addon",
    interval: "one_time",
    pricing: {
      amountMinor,
      amountUsd,
      compareAtAmountMinor: null,
      compareAtAmountUsd: null,
      discountLabel: null,
      discountRate: null,
    },
    display: {
      description: product.description,
      benefits: [],
      creditsAmount: null,
      validity: null,
      creditBenefits: [],
    },
    isDefaultPlan: false,
  };
}

function serializeEntitlement(input: {
  benefit_key: string;
  enabled: boolean;
  reason: "active_grant" | "no_active_grant" | "benefit_not_found" | "benefit_not_feature";
  metadata: Record<string, string | number | boolean> | null;
}) {
  return {
    benefitKey: input.benefit_key,
    enabled: input.enabled,
    reason: input.reason,
    metadata: input.metadata,
  };
}

function serializeWorkCommerceOrder(order: Order) {
  return {
    id: order.id,
    productKeySnapshot: order.product_key_snapshot,
    productNameSnapshot: order.product_name_snapshot,
    status: order.status,
    amountSnapshot: order.amount_snapshot,
    paidAmountSnapshot: order.paid_amount_snapshot,
    createdAt: order.created_at,
    paidAt: order.paid_at,
  };
}

async function resolvePublicWorkUrl(input: { spaceId: string; workSlug: string }) {
  const [row] = await db
    .select({ username: userProfiles.username, spaceSlug: spaces.slug })
    .from(spaces)
    .innerJoin(userProfiles, eq(userProfiles.userUuid, spaces.userUuid))
    .where(eq(spaces.id, input.spaceId))
    .limit(1);
  if (!row?.username || !row.spaceSlug) return null;
  const origin = config.webOrigin?.replace(/\/+$/, "") ?? "https://dev.cohub.run";
  return `${origin}/${encodeURIComponent(row.username)}/${encodeURIComponent(row.spaceSlug)}/w/${encodeURIComponent(input.workSlug)}`;
}

router.post("/works/:id/commerce/products/resolve", async (c) => {
  const principal = getOptionalAuth(c);
  const workId = c.req.param("id");
  if (!requireValidId(workId)) return c.json({ message: "work not found" }, 404);
  const resolved = await getPublishedWorkOrDeny(workId, principal?.uuid ?? null);
  if ("error" in resolved) return c.json({ message: resolved.error }, 404);
  if ("auth" in resolved) return authzDenied(c);
  if ((resolved.work.workVisibility ?? "public") === "space" && !(await hasPermission(principal, "space.view", { spaceId: resolved.work.spaceId }))) return authzDenied(c);
  const body = await c.req.json().catch(() => null) as { productKeys?: unknown } | null;
  const requested = Array.isArray(body?.productKeys)
    ? [...new Set(body.productKeys.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
    : [];
  if (requested.length === 0) return c.json({ message: "productKeys is required" }, 400);
  try {
    const businessKey = await requireWorkCommerceBusinessKey(resolved.work.spaceId);
    const sdk = createSpaceCommerceSdk();
    const products = await Promise.all(requested.map(async (productKey) => {
      try {
        const product = await sdk.admin.products.get({ business_key: businessKey, product_key: productKey });
        if (product.status !== "active" || product.visibility !== "public" || product.billing_type !== "one_time") return null;
        return product;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    }));
    return c.json({ products: products.filter((item): item is NonNullable<typeof item> => Boolean(item)).map((item) => serializeProduct(item)) });
  } catch (error) {
    if (error instanceof ApiError) return apiErrorResponse(c, error);
    if (error instanceof Error && error.message === "Space commerce is not initialized") {
      return c.json({ message: "Commerce is not available for this work yet" }, 409);
    }
    throw error;
  }
});

router.post("/works/:id/commerce/entitlements/check", async (c) => {
  const user = useAuth(c);
  const workId = c.req.param("id");
  if (!requireValidId(workId)) return c.json({ message: "work not found" }, 404);
  const resolved = await getPublishedWorkOrDeny(workId, user.uuid);
  if ("error" in resolved) return c.json({ message: resolved.error }, 404);
  if ((resolved.work.workVisibility ?? "public") === "space" && !(await hasPermission(user, "space.view", { spaceId: resolved.work.spaceId }))) return authzDenied(c);
  const body = await c.req.json().catch(() => null) as { benefitKeys?: unknown } | null;
  const benefitKeys = Array.isArray(body?.benefitKeys)
    ? [...new Set(body.benefitKeys.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
    : [];
  if (benefitKeys.length === 0) return c.json({ message: "benefitKeys is required" }, 400);
  try {
    const businessKey = await requireWorkCommerceBusinessKey(resolved.work.spaceId);
    const sdk = createSpaceCommerceSdk();
    const result = await sdk.admin.customers.checkEntitlements({
      external_user_id: user.uuid,
      business_key: businessKey,
      benefit_keys: benefitKeys,
    });
    return c.json({ entitlements: result.entitlements.map(serializeEntitlement), checkedAt: result.checked_at, businessKey: result.business_key });
  } catch (error) {
    if (error instanceof ApiError) return apiErrorResponse(c, error);
    if (error instanceof Error && error.message === "Space commerce is not initialized") {
      return c.json({ message: "Commerce is not available for this work yet" }, 409);
    }
    throw error;
  }
});

router.post("/works/:id/commerce/purchase", async (c) => {
  const user = useAuth(c);
  const workId = c.req.param("id");
  if (!requireValidId(workId)) return c.json({ message: "work not found" }, 404);
  const resolved = await getPublishedWorkOrDeny(workId, user.uuid);
  if ("error" in resolved) return c.json({ message: resolved.error }, 404);
  if ((resolved.work.workVisibility ?? "public") === "space" && !(await hasPermission(user, "space.view", { spaceId: resolved.work.spaceId }))) return authzDenied(c);
  const body = await c.req.json().catch(() => null) as { productKey?: unknown } | null;
  const productKey = typeof body?.productKey === "string" ? body.productKey.trim() : "";
  if (!productKey) return c.json({ message: "productKey is required" }, 400);
  try {
    const businessKey = await requireWorkCommerceBusinessKey(resolved.work.spaceId);
    const sdk = createSpaceCommerceSdk();
    const product = await sdk.admin.products.get({ business_key: businessKey, product_key: productKey });
    if (product.status !== "active" || product.visibility !== "public" || product.billing_type !== "one_time") {
      return c.json({ message: "product is not available" }, 400);
    }
    const workUrl = await resolvePublicWorkUrl({
      spaceId: resolved.work.spaceId,
      workSlug: resolved.work.workSlug,
    });
    if (!workUrl) return c.json({ message: "work public url is unavailable" }, 409);
    const provisionalRedirects = buildWorkCheckoutReturnUrls({ workUrl });
    const result = await sdk.admin.orders.create({
      business_key: businessKey,
      external_user_id: user.uuid,
      product_key: product.key,
      billing_reason: "purchase",
      success_redirect_url: provisionalRedirects.successRedirectUrl,
      failed_redirect_url: provisionalRedirects.failedRedirectUrl,
      cancel_redirect_url: provisionalRedirects.cancelRedirectUrl,
      metadata: {
        source: "cohub",
        source_type: "work",
        cohub_space_id: resolved.work.spaceId,
        cohub_work_id: resolved.work.workId,
      },
    });
    return c.json({ checkout: {
      providerKey: result.checkout?.provider_key ?? null,
      checkoutUrl: result.checkout?.checkout_url ?? null,
      checkoutUsable: result.checkout?.checkout_usable === true,
      status: result.checkout?.status ?? null,
      message: result.checkout?.message ?? null,
      orderId: result.order.id,
      productKey: result.order.product_key_snapshot,
    } });
  } catch (error) {
    if (error instanceof ApiError) return apiErrorResponse(c, error);
    if (error instanceof Error && error.message === "Space commerce is not initialized") {
      return c.json({ message: "Commerce is not available for this work yet" }, 409);
    }
    throw error;
  }
});

router.get("/works/:id/commerce/orders/:orderId", async (c) => {
  const user = useAuth(c);
  const workId = c.req.param("id");
  const orderId = c.req.param("orderId");
  if (!requireValidId(workId)) return c.json({ message: "work not found" }, 404);
  if (!requireValidId(orderId)) return c.json({ message: "order not found" }, 404);
  const resolved = await getPublishedWorkOrDeny(workId, user.uuid);
  if ("error" in resolved) return c.json({ message: resolved.error }, 404);
  if ((resolved.work.workVisibility ?? "public") === "space" && !(await hasPermission(user, "space.view", { spaceId: resolved.work.spaceId }))) return authzDenied(c);
  try {
    const businessKey = await requireWorkCommerceBusinessKey(resolved.work.spaceId);
    const sdk = createSpaceCommerceSdk();
    const order = await sdk.admin.orders.get({
      business_key: businessKey,
      order_id: orderId,
    });
    if (order.external_user_id !== user.uuid) return authzDenied(c);
    return c.json({ order: serializeWorkCommerceOrder(order) });
  } catch (error) {
    if (error instanceof ApiError) return apiErrorResponse(c, error);
    if (error instanceof Error && error.message === "Space commerce is not initialized") {
      return c.json({ message: "Commerce is not available for this work yet" }, 409);
    }
    throw error;
  }
});

export default router;
