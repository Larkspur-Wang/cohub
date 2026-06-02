import { Hono } from "hono";
import { billingOperations, COHUB_BILLING_TOKEN_TYPES } from "../billing/index.js";
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

export default router;
