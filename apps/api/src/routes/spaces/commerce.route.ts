import { Hono } from "hono";
import { ApiError } from "@talesofai-billing/sdk/base";
import { authzDenied, requireValidId, useAuth } from "../../lib/middleware.js";
import {
  handleSpaceCommerceRouteError,
  requireSpaceCommerceEntitlement,
} from "../../lib/commerce-http.js";
import { hasPermission } from "../../permissions.js";
import { createCommerceKey } from "../../lib/commerce-key.js";
import {
  createSpaceCommerceSdk,
  ensureSpaceCommerceBusiness,
  requireSpaceCommerceBusiness,
} from "../../lib/space-commerce.js";
import type { SpaceCommerceSdk } from "../../lib/space-commerce.js";

const router = new Hono();

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

function isFeatureBenefit(value: unknown): value is {
  type: "feature";
  key: string;
  name: string;
  description: string | null;
  status: string;
  config: { metadata?: Record<string, string | number | boolean> };
} {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { type?: unknown }).type === "feature" &&
      typeof (value as { key?: unknown }).key === "string",
  );
}

function serializeBenefit(benefit: {
  key: string;
  name: string;
  description: string | null;
  status: string;
  config: { metadata?: Record<string, string | number | boolean> };
}) {
  return {
    key: benefit.key,
    name: benefit.name,
    description: benefit.description,
    status: benefit.status,
    config: {
      metadata: benefit.config?.metadata ?? {},
    },
  };
}

function serializeOrder(order: {
  id: string;
  product_key_snapshot: string;
  product_name_snapshot: string;
  status: string;
  amount_snapshot: number;
  paid_amount_snapshot: number;
  created_at: string;
  paid_at: string | null;
}) {
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

async function collectCommerceKeys<T extends { key: string }>(
  loadPage: (page: number) => Promise<{ items: T[]; pagination: { has_more: boolean } }>,
): Promise<Set<string>> {
  const keys = new Set<string>();
  let page = 1;
  while (true) {
    const result = await loadPage(page);
    for (const item of result.items) keys.add(item.key);
    if (!result.pagination.has_more) break;
    page += 1;
  }
  return keys;
}

function isCommerceConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}

function mergeKeys(target: Set<string>, source: Iterable<string>): Set<string> {
  for (const key of source) target.add(key);
  return target;
}

async function listProductKeys(sdk: SpaceCommerceSdk, businessKey: string): Promise<Set<string>> {
  return collectCommerceKeys((page) => sdk.admin.products.list({
    business_key: businessKey,
    include_count: false,
    limit: 100,
    page,
  }));
}

async function listBenefitKeys(sdk: SpaceCommerceSdk, businessKey: string): Promise<Set<string>> {
  return collectCommerceKeys((page) => sdk.admin.benefits.list({
    business_key: businessKey,
    include_count: false,
    limit: 100,
    page,
  }));
}

router.post("/:id/commerce/setup", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "space.commerce.manage", { spaceId }))) return authzDenied(c);
  const entitlementDenied = await requireSpaceCommerceEntitlement(c, user.uuid);
  if (entitlementDenied) return entitlementDenied;
  try {
    const mapping = await ensureSpaceCommerceBusiness(spaceId);
    return c.json({ businessKey: mapping.billingBusinessKey });
  } catch (error) {
    const response = handleSpaceCommerceRouteError(c, error);
    if (response) return response;
    throw error;
  }
});

router.get("/:id/commerce/products", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "space.commerce.view", { spaceId }))) return authzDenied(c);
  try {
    const mapping = await requireSpaceCommerceBusiness(spaceId);
    const sdk = createSpaceCommerceSdk();
    const result = await sdk.admin.products.list({
      business_key: mapping.billingBusinessKey,
      include_count: false,
      limit: 100,
      page: 1,
    });
    return c.json({ products: result.items.map(serializeProduct), businessKey: mapping.billingBusinessKey });
  } catch (error) {
    const response = handleSpaceCommerceRouteError(c, error);
    if (response) return response;
    throw error;
  }
});

router.post("/:id/commerce/products", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "space.commerce.manage", { spaceId }))) return authzDenied(c);
  const entitlementDenied = await requireSpaceCommerceEntitlement(c, user.uuid);
  if (entitlementDenied) return entitlementDenied;
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const explicitKey = typeof body?.key === "string" ? body.key.trim() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : undefined;
  const visibility = body?.visibility === "private" ? "private" : "public";
  const status = body?.status === "draft" ? "draft" : "active";
  const amount = Number(body?.amountUsd);
  if (!name) return c.json({ message: "name is required" }, 400);
  if (!Number.isFinite(amount) || amount < 0) return c.json({ message: "amountUsd must be a non-negative number" }, 400);
  try {
    const mapping = await requireSpaceCommerceBusiness(spaceId);
    const sdk = createSpaceCommerceSdk();
    const createProduct = (key: string) => sdk.admin.products.create({
      business_key: mapping.billingBusinessKey,
      key,
      name,
      description,
      status,
      visibility,
      amount: Math.round(amount * 100),
      currency: "USD",
      billing_type: "one_time",
      billing_period: "one_time",
      billing_interval_count: 1,
    });
    let product: Awaited<ReturnType<typeof createProduct>>;
    if (explicitKey) {
      product = await createProduct(explicitKey);
    } else {
      const occupiedKeys = await listProductKeys(sdk, mapping.billingBusinessKey);
      let generatedKey = createCommerceKey({ name, fallback: "product", occupiedKeys });
      try {
        product = await createProduct(generatedKey);
      } catch (error) {
        if (!isCommerceConflict(error)) throw error;
        occupiedKeys.add(generatedKey);
        mergeKeys(occupiedKeys, await listProductKeys(sdk, mapping.billingBusinessKey));
        generatedKey = createCommerceKey({ name, fallback: "product", occupiedKeys });
        product = await createProduct(generatedKey);
      }
    }
    return c.json({ product: serializeProduct(product), businessKey: mapping.billingBusinessKey });
  } catch (error) {
    const response = handleSpaceCommerceRouteError(c, error);
    if (response) return response;
    throw error;
  }
});

router.patch("/:id/commerce/products/:productKey", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  const productKey = c.req.param("productKey").trim();
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!productKey) return c.json({ message: "product not found" }, 404);
  if (!(await hasPermission(user, "space.commerce.manage", { spaceId }))) return authzDenied(c);
  const entitlementDenied = await requireSpaceCommerceEntitlement(c, user.uuid);
  if (entitlementDenied) return entitlementDenied;
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const patch: Record<string, unknown> = {};
  if (typeof body?.name === "string") patch.name = body.name.trim();
  if (typeof body?.description === "string") patch.description = body.description.trim();
  if (body?.description === null) patch.description = null;
  if (body?.status === "draft" || body?.status === "active" || body?.status === "archived") patch.status = body.status;
  if (body?.visibility === "public" || body?.visibility === "private") patch.visibility = body.visibility;
  if (Object.keys(patch).length === 0) return c.json({ message: "nothing to update" }, 400);
  try {
    const mapping = await requireSpaceCommerceBusiness(spaceId);
    const sdk = createSpaceCommerceSdk();
    const product = await sdk.admin.products.update({
      product_key: productKey,
      patch: {
        business_key: mapping.billingBusinessKey,
        ...(patch as {
          name?: string;
          description?: string | null;
          status?: "draft" | "active" | "archived";
          visibility?: "public" | "private";
        }),
      },
    });
    return c.json({ product: serializeProduct(product), businessKey: mapping.billingBusinessKey });
  } catch (error) {
    const response = handleSpaceCommerceRouteError(c, error);
    if (response) return response;
    throw error;
  }
});

router.get("/:id/commerce/benefits", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "space.commerce.view", { spaceId }))) return authzDenied(c);
  try {
    const mapping = await requireSpaceCommerceBusiness(spaceId);
    const sdk = createSpaceCommerceSdk();
    const result = await sdk.admin.benefits.list({
      business_key: mapping.billingBusinessKey,
      include_count: false,
      limit: 100,
      page: 1,
    });
    return c.json({ benefits: result.items.filter((item) => item.type === "feature").map((item) => serializeBenefit(item)), businessKey: mapping.billingBusinessKey });
  } catch (error) {
    const response = handleSpaceCommerceRouteError(c, error);
    if (response) return response;
    throw error;
  }
});

router.post("/:id/commerce/benefits", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "space.commerce.manage", { spaceId }))) return authzDenied(c);
  const entitlementDenied = await requireSpaceCommerceEntitlement(c, user.uuid);
  if (entitlementDenied) return entitlementDenied;
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const explicitKey = typeof body?.key === "string" ? body.key.trim() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : undefined;
  const metadata = typeof body?.metadata === "object" && body.metadata && !Array.isArray(body.metadata)
    ? body.metadata as Record<string, string | number | boolean>
    : {};
  if (!name) return c.json({ message: "name is required" }, 400);
  try {
    const mapping = await requireSpaceCommerceBusiness(spaceId);
    const sdk = createSpaceCommerceSdk();
    const createBenefit = (key: string) => sdk.admin.benefits.create({
      business_key: mapping.billingBusinessKey,
      key,
      type: "feature" as const,
      name,
      description,
      config: { metadata },
      status: "active" as const,
    });
    let benefit: Awaited<ReturnType<typeof createBenefit>>;
    if (explicitKey) {
      benefit = await createBenefit(explicitKey);
    } else {
      const occupiedKeys = await listBenefitKeys(sdk, mapping.billingBusinessKey);
      let generatedKey = createCommerceKey({ name, fallback: "benefit", occupiedKeys });
      try {
        benefit = await createBenefit(generatedKey);
      } catch (error) {
        if (!isCommerceConflict(error)) throw error;
        occupiedKeys.add(generatedKey);
        mergeKeys(occupiedKeys, await listBenefitKeys(sdk, mapping.billingBusinessKey));
        generatedKey = createCommerceKey({ name, fallback: "benefit", occupiedKeys });
        benefit = await createBenefit(generatedKey);
      }
    }
    if (!isFeatureBenefit(benefit)) return c.json({ message: "feature benefit is required" }, 400);
    return c.json({ benefit: serializeBenefit(benefit), businessKey: mapping.billingBusinessKey });
  } catch (error) {
    const response = handleSpaceCommerceRouteError(c, error);
    if (response) return response;
    throw error;
  }
});

router.patch("/:id/commerce/benefits/:benefitKey", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  const benefitKey = c.req.param("benefitKey").trim();
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!benefitKey) return c.json({ message: "benefit not found" }, 404);
  if (!(await hasPermission(user, "space.commerce.manage", { spaceId }))) return authzDenied(c);
  const entitlementDenied = await requireSpaceCommerceEntitlement(c, user.uuid);
  if (entitlementDenied) return entitlementDenied;
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const patch: Record<string, unknown> = {};
  if (typeof body?.name === "string") patch.name = body.name.trim();
  if (typeof body?.description === "string") patch.description = body.description.trim();
  if (body?.description === null) patch.description = null;
  if (body?.status === "active" || body?.status === "archived") patch.status = body.status;
  if (typeof body?.metadata === "object" && body.metadata && !Array.isArray(body.metadata)) {
    patch.config = { metadata: body.metadata as Record<string, string | number | boolean> };
  }
  if (Object.keys(patch).length === 0) return c.json({ message: "nothing to update" }, 400);
  try {
    const mapping = await requireSpaceCommerceBusiness(spaceId);
    const sdk = createSpaceCommerceSdk();
    const benefit = await sdk.admin.benefits.update({
      benefit_key: benefitKey,
      patch: {
        business_key: mapping.billingBusinessKey,
        ...(patch as {
          name?: string;
          description?: string | null;
          status?: "active" | "archived";
          config?: { metadata: Record<string, string | number | boolean> };
        }),
      },
    });
    if (!isFeatureBenefit(benefit)) return c.json({ message: "feature benefit is required" }, 400);
    return c.json({ benefit: serializeBenefit(benefit), businessKey: mapping.billingBusinessKey });
  } catch (error) {
    const response = handleSpaceCommerceRouteError(c, error);
    if (response) return response;
    throw error;
  }
});

router.post("/:id/commerce/product-benefits", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "space.commerce.manage", { spaceId }))) return authzDenied(c);
  const entitlementDenied = await requireSpaceCommerceEntitlement(c, user.uuid);
  if (entitlementDenied) return entitlementDenied;
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const productKey = typeof body?.productKey === "string" ? body.productKey.trim() : "";
  const benefitKey = typeof body?.benefitKey === "string" ? body.benefitKey.trim() : "";
  if (!productKey) return c.json({ message: "productKey is required" }, 400);
  if (!benefitKey) return c.json({ message: "benefitKey is required" }, 400);
  try {
    const mapping = await requireSpaceCommerceBusiness(spaceId);
    const sdk = createSpaceCommerceSdk();
    const productBenefit = await sdk.admin.products.bindBenefit({
      business_key: mapping.billingBusinessKey,
      product_key: productKey,
      benefit_key: benefitKey,
    });
    return c.json({ productBenefit, businessKey: mapping.billingBusinessKey });
  } catch (error) {
    const response = handleSpaceCommerceRouteError(c, error);
    if (response) return response;
    throw error;
  }
});

router.delete("/:id/commerce/product-benefits", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "space.commerce.manage", { spaceId }))) return authzDenied(c);
  const entitlementDenied = await requireSpaceCommerceEntitlement(c, user.uuid);
  if (entitlementDenied) return entitlementDenied;
  const productKey = c.req.query("productKey")?.trim() ?? "";
  const benefitKey = c.req.query("benefitKey")?.trim() ?? "";
  if (!productKey) return c.json({ message: "productKey is required" }, 400);
  if (!benefitKey) return c.json({ message: "benefitKey is required" }, 400);
  try {
    const mapping = await requireSpaceCommerceBusiness(spaceId);
    const sdk = createSpaceCommerceSdk();
    await sdk.admin.products.unbindBenefit({
      business_key: mapping.billingBusinessKey,
      product_key: productKey,
      benefit_key: benefitKey,
    });
    return c.json({ ok: true, businessKey: mapping.billingBusinessKey });
  } catch (error) {
    const response = handleSpaceCommerceRouteError(c, error);
    if (response) return response;
    throw error;
  }
});

router.get("/:id/commerce/orders", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "space.commerce.view", { spaceId }))) return authzDenied(c);
  const page = Math.max(1, Number.parseInt(c.req.query("page") ?? "1", 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(c.req.query("limit") ?? "20", 10) || 20));
  try {
    const mapping = await requireSpaceCommerceBusiness(spaceId);
    const sdk = createSpaceCommerceSdk();
    const result = await sdk.admin.orders.list({
      business_key: mapping.billingBusinessKey,
      include_count: false,
      page,
      limit,
      sorting: "-created_at",
    });
    return c.json({ orders: result.items.map(serializeOrder), pagination: { hasMore: result.pagination.has_more, nextPage: result.pagination.has_more ? page + 1 : null }, businessKey: mapping.billingBusinessKey });
  } catch (error) {
    const response = handleSpaceCommerceRouteError(c, error);
    if (response) return response;
    throw error;
  }
});

export default router;
