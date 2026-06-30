import { and, eq } from "drizzle-orm";
import { spaceCommerceBusinesses, spaces, works } from "@cohub/db";
import { db } from "../db/index.js";
import { config } from "../config.js";
import { ApiError, createSdk } from "@talesofai-billing/sdk/base";
import { benefitsFeature } from "@talesofai-billing/sdk/admin/benefits";
import { businessesFeature } from "@talesofai-billing/sdk/admin/businesses";
import { customersFeature } from "@talesofai-billing/sdk/admin/customers";
import { ordersFeature } from "@talesofai-billing/sdk/admin/orders";
import { productsFeature } from "@talesofai-billing/sdk/admin/products";

const BILLING_NAMESPACE = "cohub_space";

export class SpaceCommerceNotInitializedError extends Error {
  override name = "SpaceCommerceNotInitializedError";

  constructor(readonly spaceId: string) {
    super("Space commerce is not initialized");
  }
}

function requireBillingClientConfig() {
  const baseURL = config.talesofaiBillingBaseUrl?.trim();
  const adminApiKey = config.talesofaiBillingAdminApiKey?.trim();
  if (!baseURL || !adminApiKey) {
    throw new Error("Billing is not configured");
  }
  return { baseURL, adminApiKey };
}

export function createSpaceCommerceSdk() {
  const client = requireBillingClientConfig();
  return createSdk(client)
    .useAdmin(businessesFeature())
    .useAdmin(productsFeature())
    .useAdmin(benefitsFeature())
    .useAdmin(customersFeature())
    .useAdmin(ordersFeature());
}

export type SpaceCommerceSdk = ReturnType<typeof createSpaceCommerceSdk>;

function normalizeBusinessKeyValue(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
}

function buildBillingBusinessKey(spaceId: string) {
  return `${BILLING_NAMESPACE}_${normalizeBusinessKeyValue(spaceId)}`;
}

function appendCheckoutQuery(urlString: string, input: { status: "success" | "failed" | "cancel"; orderId?: string | null }) {
  const url = new URL(urlString);
  url.searchParams.set("cohub_checkout", input.status);
  if (input.orderId) url.searchParams.set("cohub_order", input.orderId);
  return url.toString();
}

function buildBillingBusinessName(input: { spaceName: string; spaceId: string }) {
  const name = input.spaceName.trim() || input.spaceId;
  const suffix = input.spaceId.slice(0, 8);
  return `Cohub Space · ${name} · ${suffix}`.slice(0, 256);
}

export async function getSpaceCommerceBusiness(spaceId: string) {
  const [mapping] = await db
    .select()
    .from(spaceCommerceBusinesses)
    .where(eq(spaceCommerceBusinesses.spaceId, spaceId))
    .limit(1);
  return mapping ?? null;
}

export async function ensureSpaceCommerceBusiness(spaceId: string) {
  const existing = await getSpaceCommerceBusiness(spaceId);
  if (existing) return existing;

  const [space] = await db
    .select({ id: spaces.id, name: spaces.name })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);
  if (!space) throw new Error("Space not found");

  const businessKey = buildBillingBusinessKey(space.id);
  const sdk = createSpaceCommerceSdk();
  try {
    await sdk.admin.businesses.create({
      key: businessKey,
      name: buildBillingBusinessName({ spaceName: space.name, spaceId: space.id }),
      status: "active",
    });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error;
  }

  const [mapping] = await db
    .insert(spaceCommerceBusinesses)
    .values({
      spaceId: space.id,
      billingBusinessKey: businessKey,
    })
    .onConflictDoUpdate({
      target: spaceCommerceBusinesses.spaceId,
      set: {
        billingBusinessKey: businessKey,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!mapping) throw new Error("Failed to persist space commerce business mapping");
  return mapping;
}

export async function requireSpaceCommerceBusiness(spaceId: string) {
  const mapping = await getSpaceCommerceBusiness(spaceId);
  if (!mapping) throw new SpaceCommerceNotInitializedError(spaceId);
  return mapping;
}

export async function getSpaceCommerceBusinessKey(spaceId: string) {
  return (await getSpaceCommerceBusiness(spaceId))?.billingBusinessKey ?? null;
}

export async function requireSpaceCommerceBusinessKey(spaceId: string) {
  return (await requireSpaceCommerceBusiness(spaceId)).billingBusinessKey;
}

export async function ensureSpaceCommerceBusinessKey(spaceId: string) {
  return (await ensureSpaceCommerceBusiness(spaceId)).billingBusinessKey;
}

export async function getWorkCommerceContextById(workId: string) {
  const [row] = await db
    .select({
      workId: works.id,
      workSlug: works.slug,
      workStatus: works.status,
      workVisibility: works.visibility,
      spaceId: works.spaceId,
    })
    .from(works)
    .where(eq(works.id, workId))
    .limit(1);
  if (!row) return null;
  return row;
}

export async function getWorkCommerceContextBySpaceAndSlug(input: {
  spaceId: string;
  workSlug: string;
}) {
  const [row] = await db
    .select({
      workId: works.id,
      workSlug: works.slug,
      workStatus: works.status,
      workVisibility: works.visibility,
      spaceId: works.spaceId,
    })
    .from(works)
    .where(and(eq(works.spaceId, input.spaceId), eq(works.slug, input.workSlug)))
    .limit(1);
  return row ?? null;
}

export function buildWorkCheckoutReturnUrls(input: { workUrl: string; orderId?: string | null }) {
  return {
    successRedirectUrl: appendCheckoutQuery(input.workUrl, { status: "success", orderId: input.orderId }),
    failedRedirectUrl: appendCheckoutQuery(input.workUrl, { status: "failed", orderId: input.orderId }),
    cancelRedirectUrl: appendCheckoutQuery(input.workUrl, { status: "cancel", orderId: input.orderId }),
  };
}
