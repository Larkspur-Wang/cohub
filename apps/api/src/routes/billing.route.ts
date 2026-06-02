import { Hono, type Context } from "hono";
import { ApiError } from "@talesofai-billing/sdk/base";
import { billingOperations, COHUB_BILLING_TOKEN_TYPES } from "../billing/index.js";
import { config } from "../config.js";
import { useAuth } from "../lib/middleware.js";

const router = new Hono();
const BILLING_PAGE_SIZE = 10;

function resolveTokenType(value: string | undefined) {
  const requestedTokenType = value?.trim();
  if (requestedTokenType && requestedTokenType !== COHUB_BILLING_TOKEN_TYPES.usdMicroCent) {
    return { error: "unsupported billing token type" as const };
  }
  return { tokenType: COHUB_BILLING_TOKEN_TYPES.usdMicroCent };
}

function parsePositiveInt(value: string | undefined, fallback: number, max: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function billingSettingsUrl(origin: string) {
  return new URL("/settings/billing", origin).toString();
}

function parseReturnUrl(value: unknown) {
  const fallback = config.webOrigin ? billingSettingsUrl(new URL(config.webOrigin).origin) : undefined;
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  try {
    const url = new URL(trimmed);
    const allowedOrigin = config.webOrigin ? new URL(config.webOrigin).origin : url.origin;
    if (url.origin !== allowedOrigin || url.pathname !== "/settings/billing") return fallback;
    return billingSettingsUrl(allowedOrigin);
  } catch {
    return fallback;
  }
}

async function readCheckoutBody(c: { req: { json: () => Promise<unknown> } }) {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

function parseRedemptionCode(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function billingApiErrorResponse(c: Context, error: ApiError) {
  return c.json({ message: error.message, code: error.code }, error.status as never);
}

router.get("/credits", async (c) => {
  const user = useAuth(c);
  const resolved = resolveTokenType(c.req.query("tokenType"));
  if ("error" in resolved) return c.json({ message: resolved.error }, 400);
  const credit = await billingOperations.getCreditStatus({
    userId: user.uuid,
    tokenType: resolved.tokenType,
  });
  return c.json({ credit });
});

router.get("/usage-records", async (c) => {
  const user = useAuth(c);
  const resolved = resolveTokenType(c.req.query("tokenType"));
  if ("error" in resolved) return c.json({ message: resolved.error }, 400);
  const usage = await billingOperations.listUsageRecords({
    userId: user.uuid,
    tokenType: resolved.tokenType,
    page: parsePositiveInt(c.req.query("page"), 1, 10_000),
    limit: parsePositiveInt(c.req.query("limit"), BILLING_PAGE_SIZE, BILLING_PAGE_SIZE),
  });
  return c.json({ usage });
});

router.get("/overages", async (c) => {
  const user = useAuth(c);
  const resolved = resolveTokenType(c.req.query("tokenType"));
  if ("error" in resolved) return c.json({ message: resolved.error }, 400);
  const overages = await billingOperations.listOpenOverages({
    userId: user.uuid,
    tokenType: resolved.tokenType,
    page: parsePositiveInt(c.req.query("page"), 1, 10_000),
    limit: parsePositiveInt(c.req.query("limit"), BILLING_PAGE_SIZE, BILLING_PAGE_SIZE),
  });
  return c.json({ overages });
});

router.get("/catalog", async (c) => {
  const user = useAuth(c);
  try {
    const catalog = await billingOperations.getCatalog({
      userId: user.uuid,
    });
    return c.json({ catalog });
  } catch (error) {
    if (error instanceof ApiError) return billingApiErrorResponse(c, error);
    throw error;
  }
});

router.post("/addons/:productKey/purchase", async (c) => {
  const user = useAuth(c);
  const body = await readCheckoutBody(c);
  try {
    const checkout = await billingOperations.purchaseAddon({
      userId: user.uuid,
      productKey: c.req.param("productKey"),
      returnUrl: parseReturnUrl((body as { returnUrl?: unknown }).returnUrl),
    });
    return c.json({ checkout });
  } catch (error) {
    if (error instanceof ApiError) return billingApiErrorResponse(c, error);
    throw error;
  }
});

router.post("/plans/:productKey/subscribe", async (c) => {
  const user = useAuth(c);
  const body = await readCheckoutBody(c);
  try {
    const checkout = await billingOperations.createSubscription({
      userId: user.uuid,
      productKey: c.req.param("productKey"),
      returnUrl: parseReturnUrl((body as { returnUrl?: unknown }).returnUrl),
    });
    return c.json({ checkout });
  } catch (error) {
    if (error instanceof ApiError) return billingApiErrorResponse(c, error);
    throw error;
  }
});

router.post("/redemption-codes/redeem", async (c) => {
  const user = useAuth(c);
  const body = await readCheckoutBody(c);
  const code = parseRedemptionCode((body as { code?: unknown }).code);
  if (!code) return c.json({ message: "Redemption code is required" }, 400);
  try {
    const redemption = await billingOperations.redeemCode({
      userId: user.uuid,
      code,
    });
    return c.json({ redemption });
  } catch (error) {
    if (error instanceof ApiError) return billingApiErrorResponse(c, error);
    throw error;
  }
});

export default router;
